import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, readFile, readlink, realpath } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { promisify } from "node:util";
import type { BridgeRequest, ChangedFile, Review, ReviewFile, Snapshot, Workspace } from "../shared/diff";
import { isRelativeFile, isWithin, samePath } from "./paths";

const exec = promisify(execFile);
const MAX_FILES = 2000;
const MAX_PATCH = 768 * 1024;
const MAX_CONTENT = 512 * 1024;
export async function git(root: string, args: string[], maxBuffer = 8 * 1024 * 1024) {
  return (await exec("git", ["--no-optional-locks", "--literal-pathspecs", "-C", root, ...args], {
    timeout: 15000, maxBuffer, encoding: "utf8", env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  })).stdout;
}
type StoredWorkspace = { id: string; root: string; source_root: string | null; mode: string; base_sha: string | null; last_used_at: string };
export class LocalDiff {
  private reviews = new Map<string, { revision: string; promise: Promise<Review> }>();
  constructor(private databasePath: string) {}
  private rows(): StoredWorkspace[] {
    const db = new DatabaseSync(this.databasePath, { readOnly: true });
    try {
      db.exec("PRAGMA query_only = ON; PRAGMA busy_timeout = 2000;");
      return db.prepare("SELECT id, root, source_root, mode, base_sha, last_used_at FROM workspace_sessions WHERE status = 'active' ORDER BY last_used_at DESC LIMIT 500").all() as StoredWorkspace[];
    } finally { db.close(); }
  }
  private async describe(row: StoredWorkspace): Promise<Workspace> {
    let branch: string | null = null;
    try { branch = (await git(row.root, ["symbolic-ref", "--short", "HEAD"])).trim(); } catch { /* detached or unavailable */ }
    return { id: row.id, root: row.root, sourceRoot: row.source_root, mode: row.mode, baseSha: row.base_sha, branch, lastUsedAt: row.last_used_at };
  }
  async catalog(): Promise<Workspace[]> { return Promise.all(this.rows().map((row) => this.describe(row))); }
  private async workspace(id: string) {
    const row = this.rows().find((candidate) => candidate.id === id);
    if (!row) throw new Error("DevSpace workspace is unavailable or no longer active. Choose another workspace.");
    const root = await realpath(row.root);
    const top = (await git(root, ["rev-parse", "--show-toplevel"])).trim();
    if (!samePath(await realpath(top), root)) throw new Error("DevSpace workspace must be the root of a Git checkout.");
    return { workspace: await this.describe(row), root };
  }
  private async ref(root: string, workspace: Workspace, comparison: "task" | "uncommitted") {
    const ref = comparison === "task" ? workspace.baseSha : "HEAD";
    if (!ref) throw new Error("This workspace has no task starting commit. Choose Uncommitted instead.");
    return (await git(root, ["rev-parse", "--verify", `${ref}^{commit}`])).trim();
  }
  async snapshot(id: string, comparison: "task" | "uncommitted"): Promise<Snapshot> {
    const { workspace, root } = await this.workspace(id);
    const ref = await this.ref(root, workspace, comparison);
    const common = ["--no-ext-diff", "--no-textconv", "--find-renames"];
    const [names, stats, untracked] = await Promise.all([
      git(root, ["diff", ...common, "--name-status", "-z", ref, "--"]),
      git(root, ["diff", ...common, "--numstat", "-z", ref, "--"]),
      git(root, ["ls-files", "--others", "--exclude-standard", "-z"]),
    ]);
    const files = new Map<string, ChangedFile>();
    const tokens = names.split("\0");
    for (let i = 0; i < tokens.length && tokens[i];) {
      const status = tokens[i++];
      const first = tokens[i++];
      const renamed = status.startsWith("R") || status.startsWith("C");
      const path = renamed ? tokens[i++] : first;
      files.set(path, { path, ...(renamed ? { oldPath: first } : {}), status: status[0], additions: 0, deletions: 0, binary: false });
    }
    const counts = stats.split("\0");
    for (let i = 0; i < counts.length && counts[i];) {
      const entry = counts[i++];
      const firstTab = entry.indexOf("\t"), secondTab = entry.indexOf("\t", firstTab + 1);
      const added = entry.slice(0, firstTab), removed = entry.slice(firstTab + 1, secondTab);
      let path = entry.slice(secondTab + 1);
      if (!path) { i++; path = counts[i++]; }
      const file = files.get(path);
      if (file) Object.assign(file, { additions: added === "-" ? null : Number(added), deletions: removed === "-" ? null : Number(removed), binary: added === "-" });
    }
    for (const path of untracked.split("\0").filter(Boolean)) files.set(path, { path, status: "?", additions: null, deletions: 0, binary: false });
    const visible = [...files.values()].sort((a, b) => a.path.localeCompare(b.path)).slice(0, MAX_FILES);
    const stamps = await Promise.all(visible.map(async (file) => {
      try { const stat = await lstat(join(root, file.path)); return [file.path, stat.mtimeMs, stat.ctimeMs, stat.size]; }
      catch { return [file.path, "missing"]; }
    }));
    const indexPath = (await git(root, ["rev-parse", "--git-path", "index"])).trim();
    let indexStamp = 0;
    try { indexStamp = (await lstat(resolve(root, indexPath))).mtimeMs; } catch { /* unborn index */ }
    const revision = createHash("sha256").update(JSON.stringify([ref, visible, stamps, indexStamp])).digest("hex");
    return { workspace, comparison, ref, revision, files: visible, totalFiles: files.size, capturedAt: new Date().toISOString() };
  }
  async file(id: string, comparison: "task" | "uncommitted", path: string) {
    if (!isRelativeFile(path)) throw new Error("Invalid file path.");
    const snapshot = await this.snapshot(id, comparison);
    const file = snapshot.files.find((candidate) => candidate.path === path);
    if (!file) throw new Error("This file is no longer in the changed-file list. Refresh the panel.");
    const { root } = await this.workspace(id);
    return this.readPatch(root, snapshot, file);
  }
  async review(id: string, comparison: "task" | "uncommitted"): Promise<Review> {
    const snapshot = await this.snapshot(id, comparison);
    const key = `${id}:${comparison}`;
    const previous = this.reviews.get(key);
    if (previous?.revision === snapshot.revision) return previous.promise;
    const build = async () => {
      const { root } = await this.workspace(id);
      const files: ReviewFile[] = new Array(snapshot.files.length);
      let cursor = 0;
      const worker = async () => {
        while (cursor < snapshot.files.length) {
          const index = cursor++, file = snapshot.files[index];
          if (index >= 80) { files[index] = { ...file, patch: "", hash: "", deferred: true }; continue; }
          try {
            const result = await this.readPatch(root, snapshot, file);
            files[index] = { ...file, ...result, hash: createHash("sha256").update(result.patch).update(result.notice ?? "").digest("hex") };
          } catch { files[index] = { ...file, patch: "", hash: "", notice: "Unable to read this file. Refresh and try again.", deferred: true }; }
        }
      };
      await Promise.all(Array.from({ length: 4 }, worker));
      let bytes = 0;
      for (let i = 0; i < files.length; i++) {
        bytes += Buffer.byteLength(files[i].patch);
        if (bytes > 4 * 1024 * 1024) files[i] = { ...snapshot.files[i], patch: "", hash: "", deferred: true };
      }
      return { snapshot, files };
    };
    const promise = build();
    this.reviews.set(key, { revision: snapshot.revision, promise });
    if (this.reviews.size > 8) this.reviews.delete(this.reviews.keys().next().value!);
    try { return await promise; } catch (error) { this.reviews.delete(key); throw error; }
  }
  private async readPatch(root: string, snapshot: Snapshot, file: ChangedFile) {
    const path = file.path;
    if (file.binary) return { patch: "", notice: "Binary file changed. Text diff is unavailable." };
    try {
      if (file.status === "?") {
        const absolute = join(root, path);
        // Do not follow an untracked directory symlink out of the registered checkout.
        const parent = await realpath(dirname(absolute));
        if (!isWithin(root, parent)) throw new Error("File is outside the workspace.");
        const stat = await lstat(absolute);
        if (stat.size > MAX_CONTENT) return { patch: "", notice: "New file exceeds the 512 KiB text preview limit." };
        const bytes = stat.isSymbolicLink() ? Buffer.from(await readlink(absolute)) : await readFile(absolute);
        if (bytes.includes(0)) return { patch: "", notice: "New binary file. Text diff is unavailable." };
        const text = bytes.toString("utf8").replace(/\r\n/g, "\n"), lines = text.replace(/\n$/, "").split("\n");
        if (!text) return { patch: `diff --git a/${path} b/${path}\nnew file mode 100644\n`, notice: "New empty file." };
        const patch = `diff --git a/${path} b/${path}\nnew file mode ${stat.isSymbolicLink() ? "120000" : "100644"}\n--- /dev/null\n+++ b/${path}\n@@ -0,0 +1,${lines.length} @@\n${lines.map((line) => "+" + line).join("\n")}\n${text.endsWith("\n") ? "" : "\\ No newline at end of file\n"}`;
        return { patch };
      }
      const patch = await git(root, ["diff", "--no-ext-diff", "--no-textconv", "--find-renames", "--unified=3", snapshot.ref, "--", ...(file.oldPath ? [file.oldPath] : []), path], MAX_PATCH);
      return { patch, ...(!patch ? { notice: "No text difference remains. Refresh the file list." } : {}) };
    } catch (error) {
      if ((error as { code?: string }).code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") return { patch: "", notice: "Diff exceeds the 768 KiB preview limit." };
      throw error;
    }
  }
  dispatch(input: BridgeRequest): Promise<unknown> {
    if (input.op === "catalog") return this.catalog();
    if (input.op === "snapshot") return this.snapshot(input.workspaceId, input.comparison);
    if (input.op === "review") return this.review(input.workspaceId, input.comparison);
    return this.file(input.workspaceId, input.comparison, input.path);
  }
}
