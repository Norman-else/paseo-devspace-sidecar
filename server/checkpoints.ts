import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import type { Review, ReviewFile, Snapshot } from "../shared/diff";
import { diffLines } from "../shared/diff";
const exec = promisify(execFile);
const stored = z.object({ workspaceId: z.string(), root: z.string(), comparison: z.string(), prNumber: z.number().optional(), createdAt: z.string(), ref: z.string(), repository: z.string().optional(), contents: z.record(z.string(), z.string().nullable()), omitted: z.array(z.string()) });
type Stored = z.infer<typeof stored>;
export async function textPatch(path: string, before: string | null, after: string | null): Promise<ReviewFile | null> {
  if (before === after) return null;
  const temp = await mkdtemp(join(tmpdir(), "sidecar-diff-"));
  try {
    const left = join(temp, "before"), right = join(temp, "after");
    await writeFile(left, before ?? "", { mode: 0o600 }); await writeFile(right, after ?? "", { mode: 0o600 });
    let raw = "";
    try { raw = (await exec("git", ["--no-optional-locks", "--no-pager", "diff", "--no-index", "--no-ext-diff", "--no-textconv", "--unified=3", "--", left, right], { cwd: temp, encoding: "utf8", timeout: 10000, maxBuffer: 768 * 1024 })).stdout; }
    catch (error) { if ((error as { code?: number }).code !== 1) throw error; raw = String((error as { stdout?: string }).stdout ?? ""); }
    const hunk = raw.indexOf("@@");
    const patch = hunk >= 0 ? `--- ${before === null ? "/dev/null" : "a/" + path}\n+++ ${after === null ? "/dev/null" : "b/" + path}\n${raw.slice(hunk)}` : "";
    const lines = diffLines(patch);
    return { path, status: before === null ? "A" : after === null ? "D" : "M", additions: lines.filter((line) => line.kind === "add").length, deletions: lines.filter((line) => line.kind === "remove").length, binary: false, patch,
      hash: createHash("sha256").update(JSON.stringify([before, after])).digest("hex"), ...(!patch ? { notice: "Empty file added or removed." } : {}) };
  } finally { await rm(temp, { recursive: true, force: true }); }
}
export class Checkpoints {
  constructor(private directory: string) {}
  private path(id: string) { if (!/^[a-f0-9]{64}$/.test(id)) throw new Error("Invalid review point."); return join(this.directory, id + ".json"); }
  async load(id: string, workspaceId: string, root: string, comparison: string, prNumber?: number) {
    const value = stored.parse(JSON.parse(await readFile(this.path(id), "utf8")));
    if (value.workspaceId !== workspaceId || value.root !== root || value.comparison !== comparison || value.prNumber !== prNumber) throw new Error("Review point belongs to a different workspace or comparison.");
    return value;
  }
  async save(review: Review, root: string, agentId: string, prNumber: number | undefined, read: (path: string) => Promise<string | null>) {
    const contents: Record<string, string | null> = Object.create(null), omitted: string[] = [];
    let bytes = 0;
    for (const file of review.files) {
      if (Object.keys(contents).length >= 200) { omitted.push(file.path); continue; }
      try {
        const text = await read(file.path);
        const size = Buffer.byteLength(text ?? "");
        if (size > 512 * 1024 || bytes + size > 8 * 1024 * 1024 || text?.includes("\0")) throw new Error("Checkpoint limit");
        contents[file.path] = text; bytes += size;
        if (file.status === "R" && file.oldPath) contents[file.oldPath] = null;
      } catch { omitted.push(file.path); }
    }
    const createdAt = new Date().toISOString();
    const id = createHash("sha256").update(JSON.stringify([review.snapshot.workspace.id, agentId, createdAt, randomUUID()])).digest("hex");
    const value: Stored = { workspaceId: review.snapshot.workspace.id, root, comparison: review.snapshot.comparison, prNumber, createdAt, ref: review.snapshot.comparison === "pr" ? review.snapshot.headSha! : review.snapshot.ref, repository: review.snapshot.repository, contents, omitted };
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const temp = this.path(id) + ".tmp";
    await writeFile(temp, JSON.stringify(value), { mode: 0o600 }); await rename(temp, this.path(id));
    return { id, createdAt, omitted: omitted.length };
  }
  async compare(id: string, baseline: Stored, current: Snapshot, read: (path: string, previous: boolean) => Promise<string | null>): Promise<Review> {
    const paths = new Set([...Object.keys(baseline.contents), ...baseline.omitted, ...current.files.map((file) => file.path)]);
    const files: ReviewFile[] = [];
    for (const path of paths) {
      try {
        if (baseline.omitted.includes(path)) throw new Error("File was not captured at the review point.");
        const before = Object.hasOwn(baseline.contents, path) ? baseline.contents[path] : await read(path, true);
        const file = await textPatch(path, before, await read(path, false));
        if (file) files.push(file);
      } catch { files.push({ path, status: "M", additions: null, deletions: null, binary: false, patch: "", hash: "", notice: "This file could not be compared with the review point." }); }
    }
    files.sort((a, b) => a.path.localeCompare(b.path));
    const revision = createHash("sha256").update(id).update(current.revision).update(JSON.stringify(files)).digest("hex");
    return { snapshot: { ...current, ref: baseline.ref, revision, files, totalFiles: files.length, checkpoint: { id, createdAt: baseline.createdAt, omitted: baseline.omitted.length } }, files };
  }
}
