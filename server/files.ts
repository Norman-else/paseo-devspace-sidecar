import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, readdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { isRelativeFile, isWithin } from "./paths";
import { FILE_EDIT_LIMIT, type FileEntry, type FileRead, type FileWriteRequest, type FileWriteResult } from "../shared/files";

const exec = promisify(execFile);
const LIST_LIMIT = 2000, UPLOAD_LIMIT = FILE_EDIT_LIMIT * 2, UPLOAD_TTL = 2 * 60 * 1000;
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

/** Workspace-relative paths only: no absolute paths, no "..", nothing inside .git. */
function checkedPath(path: string) {
  const clean = path.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  if (clean && (!isRelativeFile(clean) || clean.split("/").some((part) => part === ".git" || part === "." || !part))) throw new Error("This path is outside the workspace.");
  return clean;
}
/** Resolve symlinks and refuse anything that lands outside the workspace root. */
async function inside(root: string, path: string) {
  const target = await realpath(join(root, path));
  if (!isWithin(root, target)) throw new Error("This path is outside the workspace.");
  return target;
}

async function ignoredSet(root: string, paths: string[]) {
  if (!paths.length) return new Set<string>();
  try {
    const child = exec("git", ["--no-optional-locks", "-C", root, "check-ignore", "-z", "--stdin"], { encoding: "utf8", timeout: 10000, maxBuffer: 4 * 1024 * 1024 });
    child.child.stdin?.end(paths.join("\0"));
    return new Set((await child).stdout.split("\0").filter(Boolean));
  } catch (error) {
    // Exit code 1 means nothing is ignored; anything else just leaves entries unmarked.
    const stdout = (error as { stdout?: string }).stdout ?? "";
    return new Set(stdout.split("\0").filter(Boolean));
  }
}

export async function listDirectory(root: string, requested: string): Promise<{ path: string; entries: FileEntry[]; truncated: boolean }> {
  const path = checkedPath(requested);
  const directory = await inside(root, path);
  if (!(await stat(directory)).isDirectory()) throw new Error("This path is not a folder.");
  const dirents = (await readdir(directory, { withFileTypes: true })).filter((entry) => entry.name !== ".git");
  const truncated = dirents.length > LIST_LIMIT;
  const entries: FileEntry[] = dirents.slice(0, LIST_LIMIT).map((entry) => ({
    name: entry.name, path: path ? `${path}/${entry.name}` : entry.name,
    type: entry.isDirectory() ? "dir" : entry.isSymbolicLink() ? "symlink" : "file", ignored: false,
  }));
  const ignored = await ignoredSet(root, entries.map((entry) => entry.type === "dir" ? `${entry.path}/` : entry.path));
  for (const entry of entries) entry.ignored = ignored.has(entry.path) || ignored.has(`${entry.path}/`);
  entries.sort((a, b) => (a.type === "dir" ? 0 : 1) - (b.type === "dir" ? 0 : 1) || a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true }));
  return { path, entries, truncated };
}

export async function readWorkspaceFile(root: string, requested: string): Promise<FileRead> {
  const path = checkedPath(requested);
  if (!path) throw new Error("Choose a file.");
  const target = await inside(root, path);
  const info = await stat(target);
  if (!info.isFile()) throw new Error("This path is not a file.");
  const base = { path, size: info.size, mtimeMs: info.mtimeMs };
  if (info.size > FILE_EDIT_LIMIT) return { ...base, kind: "too_large", hash: null, content: null, eol: "lf" };
  const bytes = await readFile(target);
  if (bytes.subarray(0, 8000).includes(0)) return { ...base, kind: "binary", hash: hash(bytes), content: null, eol: "lf" };
  let content: string;
  try { content = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { return { ...base, kind: "binary", hash: hash(bytes), content: null, eol: "lf" }; }
  return { ...base, kind: "text", hash: hash(bytes), content, eol: content.includes("\r\n") ? "crlf" : "lf" };
}

type Upload = { workspaceId: string; path: string; total: number; chunks: (string | undefined)[]; size: number; expires: number };
const uploads = new Map<string, Upload>();

/**
 * Saves arrive in chunks because DevSpace accepts at most ~100KB per request. The last chunk triggers the write,
 * which only happens when the file still has the content the editor started from (unless the user forces it).
 */
export async function writeWorkspaceFile(root: string, workspaceId: string, input: FileWriteRequest): Promise<FileWriteResult> {
  const path = checkedPath(input.path);
  if (!path) throw new Error("Choose a file.");
  const now = Date.now();
  for (const [key, upload] of uploads) if (upload.expires < now) uploads.delete(key);
  let upload = uploads.get(input.uploadId);
  if (!upload) {
    if (uploads.size >= 20) throw new Error("Too many saves are in progress. Try again shortly.");
    upload = { workspaceId, path, total: input.total, chunks: new Array(input.total), size: 0, expires: now + UPLOAD_TTL };
    uploads.set(input.uploadId, upload);
  }
  if (upload.workspaceId !== workspaceId || upload.path !== path || upload.total !== input.total || input.index >= input.total) { uploads.delete(input.uploadId); throw new Error("The save request changed while uploading. Save again."); }
  if (upload.chunks[input.index] === undefined) { upload.chunks[input.index] = input.chunk; upload.size += input.chunk.length; }
  if (upload.size > UPLOAD_LIMIT) { uploads.delete(input.uploadId); throw new Error("This file is too large to edit here."); }
  const received = upload.chunks.filter((chunk) => chunk !== undefined).length;
  if (received < upload.total) return { status: "partial", received };
  uploads.delete(input.uploadId);
  const content = Buffer.from(upload.chunks.join(""), "utf8");
  if (content.length > FILE_EDIT_LIMIT) throw new Error("This file is too large to edit here.");
  const target = join(root, path);
  if (!isWithin(root, await realpath(dirname(target)))) throw new Error("This path is outside the workspace.");
  const existing = await lstat(target).catch(() => null);
  if (existing?.isSymbolicLink()) throw new Error("Symbolic links cannot be edited here.");
  if (existing && !existing.isFile()) throw new Error("This path is not a file.");
  const current = existing ? hash(await readFile(target)) : null;
  if (!input.force && current !== input.expectedHash) return { status: "conflict", hash: current };
  await writeFile(target, content);
  const info = await stat(target);
  return { status: "saved", hash: hash(content), size: info.size, mtimeMs: info.mtimeMs };
}
