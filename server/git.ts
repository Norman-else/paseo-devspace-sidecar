import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, readFile, readlink, realpath } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { promisify } from "node:util";
import type { BridgeRequest, ChangedFile, Review, ReviewFile, Snapshot, Workspace } from "../shared/diff";
import { isRelativeFile, isWithin, samePath } from "./paths";
import { PullRequests } from "./pull-requests";
import { GitHubReview } from "./github-review";
import { Checkpoints } from "./checkpoints";
import type { ReviewOptions } from "../shared/review-details";
type Comparison = Snapshot["comparison"];

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
  private github: PullRequests;
  private githubReview: GitHubReview;
  private checkpoints: Checkpoints;
  private pullCache = new Map<string, { expires: number; value: ReturnType<LocalDiff["readPullRequests"]> }>();
  constructor(private databasePath: string, stateDirectory = join(homedir(), ".config/paseo-devspace-sidecar/reviews"), dependencies?: { github?: PullRequests; review?: GitHubReview }) {
    this.github = dependencies?.github ?? new PullRequests(); this.githubReview = dependencies?.review ?? new GitHubReview(); this.checkpoints = new Checkpoints(stateDirectory);
  }
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
  private async ref(root: string, workspace: Workspace, comparison: Comparison, options: ReviewOptions = {}) {
    const ref = comparison === "local" ? (await this.knownPr(workspace.id, options.prNumber)).pr.headSha : comparison === "task" ? workspace.baseSha : "HEAD";
    if (!ref) throw new Error("This workspace has no task starting commit. Choose Uncommitted instead.");
    try { return (await git(root, ["rev-parse", "--verify", `${ref}^{commit}`])).trim(); }
    catch { throw new Error("The comparison commit is unavailable on the project host."); }
  }
  async pullRequests(id: string) {
    const context = await this.workspace(id);
    const key = `${id}:${context.root}:${context.workspace.branch}`;
    const previous = this.pullCache.get(key);
    if (previous && previous.expires > Date.now()) return previous.value;
    const value = this.readPullRequests(id, context).catch((error) => { this.pullCache.delete(key); throw error; });
    this.pullCache.set(key, { expires: Date.now() + 5000, value });
    if (this.pullCache.size > 32) this.pullCache.delete(this.pullCache.keys().next().value!);
    return value;
  }
  private async readPullRequests(id: string, context?: { workspace: Workspace; root: string }) {
    const { workspace, root } = context ?? await this.workspace(id);
    if (!workspace.branch) return this.github.unavailable("detached_head");
    try {
      const names = (await git(root, ["remote"])).trim().split(/\r?\n/).filter(Boolean);
      const preferences = await Promise.all([`branch.${workspace.branch}.pushRemote`, "remote.pushDefault", `branch.${workspace.branch}.remote`].map(async (key) => (await git(root, ["config", "--get", key]).catch(() => "")).trim()));
      const remoteName = preferences.find((name) => names.includes(name)) ?? (names.includes("origin") ? "origin" : names.length === 1 ? names[0] : null);
      if (!remoteName) return this.github.unavailable("no_remote");
      const [remote, localHeadSha] = await Promise.all([git(root, ["remote", "get-url", "--push", "--", remoteName]), git(root, ["rev-parse", "HEAD"])]);
      return this.github.read({ root, branch: workspace.branch, remote: remote.trim(), localHeadSha: localHeadSha.trim() });
    } catch { return this.github.unavailable("request_failed"); }
  }
  async snapshot(id: string, comparison: Comparison, options: ReviewOptions = {}): Promise<Snapshot> {
    if (options.since) return (await this.sinceReview(id, comparison, options)).snapshot;
    if (comparison === "pr") return (await this.prReview(id, options.prNumber)).snapshot;
    const { workspace, root } = await this.workspace(id);
    const ref = await this.ref(root, workspace, comparison, options);
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
    let indexHash = "";
    // A stat-cache refresh can touch the index without changing its contents.
    // Content identity tracks staging changes without invalidating contextual reads.
    try { indexHash = createHash("sha256").update(await readFile(resolve(root, indexPath))).digest("hex"); } catch { /* unborn index */ }
    const revision = createHash("sha256").update(JSON.stringify([ref, visible, stamps, indexHash])).digest("hex");
    return { workspace, comparison, ref, revision, files: visible, totalFiles: files.size, capturedAt: new Date().toISOString(), ...(comparison === "local" ? { prNumber: options.prNumber } : {}) };
  }
  async file(id: string, comparison: Comparison, path: string, options: ReviewOptions = {}) {
    if (!isRelativeFile(path)) throw new Error("Invalid file path.");
    if (comparison === "pr" || options.since) {
      const review = options.since ? await this.sinceReview(id, comparison, options) : await this.prReview(id, options.prNumber);
      const file = review.files.find((file) => file.path === path);
      if (!file) throw new Error("This file is no longer in the changed-file list. Refresh the panel.");
      return { patch: file.patch, notice: file.notice };
    }
    const snapshot = await this.snapshot(id, comparison, options);
    const file = snapshot.files.find((candidate) => candidate.path === path);
    if (!file) throw new Error("This file is no longer in the changed-file list. Refresh the panel.");
    const { root } = await this.workspace(id);
    return this.readPatch(root, snapshot, file);
  }
  async review(id: string, comparison: Comparison, options: ReviewOptions = {}): Promise<Review> {
    if (options.since) return this.sinceReview(id, comparison, options);
    if (comparison === "pr") return this.prReview(id, options.prNumber);
    const snapshot = await this.snapshot(id, comparison, options);
    const key = `${id}:${comparison}:${options.prNumber ?? ""}`;
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
  private async knownPr(id: string, number?: number) {
    const result = await this.pullRequests(id);
    if (result.status !== "available") throw new Error("PR status is unavailable. Refresh to retry.");
    const pr = number ? result.pullRequests.find((pr) => pr.number === number) : result.pullRequests[0];
    if (!pr) throw new Error("PR is no longer associated with this workspace.");
    return { result, pr };
  }
  private async prReview(id: string, number?: number): Promise<Review> {
    const { workspace, root } = await this.workspace(id);
    const { result, pr } = await this.knownPr(id, number);
    const changes = await this.githubReview.changes(root, result.repository, pr.number, pr.headSha);
    if (changes.headSha !== pr.headSha) this.pullCache.clear();
    const revision = createHash("sha256").update(JSON.stringify([changes.baseSha, changes.headSha, changes.files])).digest("hex");
    return { snapshot: { workspace, comparison: "pr", prNumber: pr.number, ref: changes.baseSha, headSha: changes.headSha, repository: result.repository, revision, files: changes.files, totalFiles: changes.totalFiles, capturedAt: new Date().toISOString() }, files: changes.files };
  }
  private async contentAt(root: string, ref: string, path: string, repository?: string): Promise<string | null> {
    if (!isRelativeFile(path)) throw new Error("Invalid file path.");
    let exists = true;
    try { await git(root, ["rev-parse", "--verify", `${ref}^{commit}`]); } catch { exists = false; }
    if (!exists) {
      if (repository) return this.githubReview.content(root, repository, ref, path);
      throw new Error("The comparison commit is unavailable on the project host.");
    }
    let text: string;
    try { text = await git(root, ["show", "--no-ext-diff", "--no-textconv", `${ref}:${path}`], MAX_CONTENT); }
    catch (error) { if ((error as { code?: string }).code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") throw new Error("File is too large or binary for contextual review."); return null; }
    if (text.includes("\0")) throw new Error("File is too large or binary for contextual review.");
    return text.replace(/\r\n/g, "\n");
  }
  private async workingContent(root: string, path: string): Promise<string | null> {
    if (!isRelativeFile(path)) throw new Error("Invalid file path.");
    const absolute = join(root, path);
    try {
      if (!isWithin(root, await realpath(dirname(absolute)))) throw new Error("File is outside the workspace.");
      const stat = await lstat(absolute);
      if (stat.size > MAX_CONTENT) throw new Error("File is too large or binary for contextual review.");
      const bytes = stat.isSymbolicLink() ? Buffer.from(await readlink(absolute)) : await readFile(absolute);
      if (bytes.includes(0)) throw new Error("File is too large or binary for contextual review.");
      return bytes.toString("utf8").replace(/\r\n/g, "\n");
    } catch (error) { if ((error as { code?: string }).code === "ENOENT") return null; throw error; }
  }
  private async targetContent(id: string, snapshot: Snapshot, path: string, options: ReviewOptions, old = false) {
    const { root } = await this.workspace(id);
    if (old) return this.contentAt(root, snapshot.ref, snapshot.files.find((file) => file.path === path)?.oldPath ?? path, snapshot.repository);
    if (snapshot.comparison !== "pr") return this.workingContent(root, path);
    const { result, pr } = await this.knownPr(id, options.prNumber);
    const detail = await this.githubReview.changes(root, result.repository, pr.number, pr.headSha);
    return this.contentAt(root, snapshot.headSha!, path, detail.headRepository);
  }
  private async sinceReview(id: string, comparison: Comparison, options: ReviewOptions): Promise<Review> {
    const { root } = await this.workspace(id);
    const baseOptions = { prNumber: options.prNumber };
    const current = await this.snapshot(id, comparison, baseOptions);
    const key = `${id}:${comparison}:${options.prNumber ?? ""}:since:${options.since}`;
    const previous = this.reviews.get(key);
    if (previous?.revision === current.revision) return previous.promise;
    const build = async () => {
      const baseline = await this.checkpoints.load(options.since!, id, root, comparison, options.prNumber);
      return this.checkpoints.compare(options.since!, baseline, current, (path, previous) => previous ? this.contentAt(root, baseline.ref, path, baseline.repository) : this.targetContent(id, current, path, baseOptions));
    };
    const promise = build().catch((error) => { this.reviews.delete(key); throw error; });
    this.reviews.set(key, { revision: current.revision, promise });
    if (this.reviews.size > 8) this.reviews.delete(this.reviews.keys().next().value!);
    return promise;
  }
  async checkpoint(id: string, comparison: Comparison, agentId: string, prNumber?: number) {
    const { root } = await this.workspace(id);
    const review = await this.review(id, comparison, { prNumber });
    const point = await this.checkpoints.save(review, root, agentId, prNumber, (path) => this.targetContent(id, review.snapshot, path, { prNumber }));
    if ((await this.snapshot(id, comparison, { prNumber })).revision !== review.snapshot.revision) throw new Error("Changes moved while saving the review point. Try again.");
    return point;
  }
  async context(input: Extract<BridgeRequest, { op: "context" }>) {
    const snapshot = await this.snapshot(input.workspaceId, input.comparison, input);
    if (snapshot.revision !== input.revision) throw new Error("Changes refreshed. Reload the context and try again.");
    if (!snapshot.files.some((file) => file.path === input.path)) throw new Error("This file is no longer in the changed-file list. Refresh the panel.");
    let text: string | null;
    if (input.since && input.side === "old") {
      const { root } = await this.workspace(input.workspaceId);
      const baseline = await this.checkpoints.load(input.since, input.workspaceId, root, input.comparison, input.prNumber);
      if (baseline.omitted.includes(input.path)) throw new Error("This file could not be compared with the review point.");
      text = Object.hasOwn(baseline.contents, input.path) ? baseline.contents[input.path] : await this.contentAt(root, baseline.ref, input.path, baseline.repository);
    } else text = await this.targetContent(input.workspaceId, snapshot, input.path, input, input.side === "old");
    const lines = text ? text.replace(/\n$/, "").split("\n") : [];
    return { start: input.start, total: lines.length, lines: lines.slice(input.start - 1, input.start - 1 + input.count) };
  }
  async discussions(id: string, number: number) {
    const { root } = await this.workspace(id); const { result, pr } = await this.knownPr(id, number);
    return this.githubReview.discussions(root, result.repository, pr.number, pr.headSha);
  }
  async checkDetail(id: string, number: number, name: string, url: string | null) {
    const { root } = await this.workspace(id); const { result, pr } = await this.knownPr(id, number);
    const entry = pr.checks.entries.find((entry) => entry.name === name && entry.url === url);
    if (!entry) throw new Error("Check is no longer associated with this PR.");
    return { ...await this.githubReview.check(root, result.repository, pr.headSha, name, url, entry.summary), headSha: pr.headSha };
  }
  dispatch(input: BridgeRequest): Promise<unknown> {
    if (input.op === "catalog") return this.catalog();
    if (input.op === "snapshot") return this.snapshot(input.workspaceId, input.comparison, input);
    if (input.op === "review") return this.review(input.workspaceId, input.comparison, input);
    if (input.op === "pull-requests") return this.pullRequests(input.workspaceId);
    if (input.op === "context") return this.context(input);
    if (input.op === "checkpoint") return this.checkpoint(input.workspaceId, input.comparison, input.agentId, input.prNumber);
    if (input.op === "threads") return this.discussions(input.workspaceId, input.prNumber);
    if (input.op === "check-detail") return this.checkDetail(input.workspaceId, input.prNumber, input.name, input.url);
    return this.file(input.workspaceId, input.comparison, input.path, input);
  }
}
