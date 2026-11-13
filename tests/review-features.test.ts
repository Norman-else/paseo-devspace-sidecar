import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { DatabaseSync } from "node:sqlite";
import { LocalDiff } from "../server/git.ts";
import { PullRequests } from "../server/pull-requests.ts";
import { GitHubReview, failureExcerpt } from "../server/github-review.ts";
import { textPatch } from "../server/checkpoints.ts";
import { reviewRows } from "../shared/review.ts";
import { selectedCode, selectLine } from "../shared/selection.ts";
const exec = promisify(execFile);
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "sidecar-review-")), root = join(directory, "repo"); await mkdir(root);
  const git = async (...args: string[]) => (await exec("git", ["-C", root, ...args], { encoding: "utf8" })).stdout.trim();
  await git("init", "-b", "task"); await git("config", "user.email", "test@example.invalid"); await git("config", "user.name", "Test");
  const baseText = Array.from({ length: 40 }, (_, n) => `line ${n + 1}`).join("\n") + "\n";
  await writeFile(join(root, "code.txt"), baseText); await writeFile(join(root, "untouched.txt"), "original\n"); await git("add", "."); await git("commit", "-m", "base"); const base = await git("rev-parse", "HEAD");
  const pushed = baseText.replace("line 20\n", "pushed change\n"); await writeFile(join(root, "code.txt"), pushed); await git("commit", "-am", "pushed"); const head = await git("rev-parse", "HEAD");
  const patch = await git("diff", base, head, "--", "code.txt"); await writeFile(join(root, "code.txt"), pushed.replace("line 21\n", "local change\n"));
  await git("remote", "add", "origin", "https://github.com/Example/repo.git");
  const rawPr = { number: 7, title: "Test PR", url: "https://github.com/Example/repo/pull/7", state: "OPEN", isDraft: false, baseRefName: "main", headRefName: "task", headRefOid: head, headRepositoryOwner: { login: "Example" }, headRepository: { name: "repo" }, reviewDecision: "REVIEW_REQUIRED", mergeable: "MERGEABLE", updatedAt: "2026-01-01", statusCheckRollup: [{ __typename: "CheckRun", status: "COMPLETED", conclusion: "FAILURE", name: "build", detailsUrl: "https://github.com/Example/repo/actions/runs/10/job/20" }] };
  const calls: string[][] = [];
  const gh = async (_: string, args: string[]) => {
    calls.push(args);
    if (args[0] === "repo") return JSON.stringify({ nameWithOwner: "Example/repo", defaultBranchRef: { name: "main" }, parent: null });
    if (args[0] === "pr") return JSON.stringify([rawPr]);
    if (args[0] === "run") return "\u001b[31mERROR: test failed\u001b[0m\nexpected 2, got 3\n";
    const endpoint = args[1];
    if (endpoint === "graphql") return JSON.stringify({ data: { repository: { pullRequest: { headRefOid: head, reviewThreads: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [{ id: "thread1", path: "code.txt", line: 20, startLine: null, diffSide: "RIGHT", isResolved: false, isOutdated: false, comments: { pageInfo: { hasNextPage: false }, nodes: [{ author: { login: "reviewer", name: "Reviewer Name", avatarUrl: "https://avatars.githubusercontent.com/u/1?v=4", url: "https://github.com/reviewer" }, body: "Please check this", url: "https://github.com/Example/repo/pull/7#discussion_r1", createdAt: "2026-01-01" }] } }] } } } } });
    if (endpoint.includes("/files?")) return JSON.stringify([{ filename: "code.txt", status: "modified", additions: 1, deletions: 1, patch }]);
    if (endpoint.includes("/compare/")) return JSON.stringify({ merge_base_commit: { sha: base } });
    if (endpoint.endsWith("/pulls/7")) return JSON.stringify({ base: { sha: base }, head: { sha: head, repo: { full_name: "Example/repo" } }, changed_files: 1 });
    if (endpoint.includes("/check-runs?")) return JSON.stringify({ check_runs: [{ id: 99, name: "build", details_url: rawPr.statusCheckRollup[0].detailsUrl, output: { title: "Tests failed", summary: "One assertion failed" } }] });
    if (endpoint.includes("/annotations?")) return JSON.stringify([{ path: "code.txt", start_line: 20, message: "Assertion failed" }]);
    throw new Error("Unexpected gh call: " + args.join(" "));
  };
  const dbPath = join(directory, "registry.sqlite"), db = new DatabaseSync(dbPath);
  db.exec("CREATE TABLE workspace_sessions(id TEXT, root TEXT, source_root TEXT, mode TEXT, base_sha TEXT, last_used_at TEXT, status TEXT)");
  db.prepare("INSERT INTO workspace_sessions VALUES(?,?,?,?,?,?,?)").run("ws_test", root, root, "worktree", base, "2026-01-01", "active"); db.close();
  const service = new LocalDiff(dbPath, join(directory, "points"), { github: new PullRequests(gh), review: new GitHubReview(gh) });
  return { directory, root, git, service, baseText, pushed, base, head, calls, cleanup: () => rm(directory, { recursive: true, force: true }) };
}
test("PR diff is the pushed version while local comparison and context read the actual worktree", async () => {
  const f = await fixture(); try {
    const index = await readFile(join(f.root, ".git", "index"));
    const pr = await f.service.review("ws_test", "pr", { prNumber: 7 });
    assert.equal(pr.snapshot.ref, f.base); assert.equal(pr.snapshot.headSha, f.head);
    assert.ok(pr.files[0].patch.includes("+pushed change")); assert.ok(!pr.files[0].patch.includes("+local change"));
    const local = await f.service.review("ws_test", "local", { prNumber: 7 });
    assert.equal(local.snapshot.ref, f.head); assert.ok(local.files[0].patch.includes("+local change")); assert.ok(!local.files[0].patch.includes("+pushed change"));
    const input = { op: "context" as const, workspaceId: "ws_test", comparison: "pr" as const, prNumber: 7, path: "code.txt", side: "new" as const, start: 20, count: 3, revision: pr.snapshot.revision };
    assert.deepEqual((await f.service.context(input)).lines, ["pushed change", "line 21", "line 22"]);
    const localContext = await f.service.context({ ...input, comparison: "local", revision: local.snapshot.revision }); assert.equal(localContext.lines[1], "local change");
    await assert.rejects(f.service.context({ ...input, revision: "stale" }), /refreshed/);
    await assert.rejects(f.service.review("ws_test", "pr", { prNumber: 99 }), /associated/);
    assert.deepEqual(await readFile(join(f.root, ".git", "index")), index);
  } finally { await f.cleanup(); }
});
test("review points compare later edits, new files and restored files without editing the Git index", async () => {
  const f = await fixture(); try {
    const index = await readFile(join(f.root, ".git", "index"));
    const point = await f.service.checkpoint("ws_test", "task", "agent"); assert.equal(point.omitted, 0);
    assert.equal((await f.service.review("ws_test", "task", { since: point.id })).files.length, 0);
    await writeFile(join(f.root, "code.txt"), f.baseText); await writeFile(join(f.root, "untouched.txt"), "later\n"); await writeFile(join(f.root, "new.txt"), "brand new\n");
    const changes = await f.service.review("ws_test", "task", { since: point.id });
    assert.deepEqual(changes.files.map((file) => file.path), ["code.txt", "new.txt", "untouched.txt"]);
    assert.ok(changes.files[0].patch.includes("-local change")); assert.ok(changes.files[0].patch.includes("-pushed change"));
    const again = await f.service.review("ws_test", "task", { since: point.id });
    assert.equal(again.snapshot.revision, changes.snapshot.revision, JSON.stringify([changes.files, again.files]));
    const old = await f.service.context({ op: "context", workspaceId: "ws_test", comparison: "task", since: point.id, path: "code.txt", side: "old", start: 20, count: 2, revision: changes.snapshot.revision });
    assert.deepEqual(old.lines, ["pushed change", "local change"]);
    await assert.rejects(f.service.review("ws_test", "uncommitted", { since: point.id }), /different workspace or comparison/);
    assert.deepEqual(await readFile(join(f.root, ".git", "index")), index);
  } finally { await f.cleanup(); }
});
test("discussions keep line sides and check details include failure context with safe, read-only gh calls", async () => {
  const f = await fixture(); try {
    const discussions = await f.service.discussions("ws_test", 7); assert.equal(discussions.headSha, f.head); assert.equal(discussions.threads[0].side, "RIGHT"); assert.equal(discussions.threads[0].line, 20); assert.equal(discussions.threads[0].comments[0].name, "Reviewer Name"); assert.ok(discussions.threads[0].comments[0].avatarUrl?.startsWith("https://avatars.githubusercontent.com/")); assert.equal(discussions.threads[0].comments[0].authorUrl, "https://github.com/reviewer");
    const url = "https://github.com/Example/repo/actions/runs/10/job/20";
    const detail = await f.service.checkDetail("ws_test", 7, "build", url); assert.match(detail.summary, /Tests failed/); assert.match(detail.excerpt, /expected 2/); assert.ok(!detail.excerpt.includes("\u001b"));
    await assert.rejects(f.service.checkDetail("ws_test", 7, "unknown", url), /associated/);
    assert.ok(f.calls.every((args) => !["POST", "PATCH", "DELETE"].some((method) => args.includes(method))));
  } finally { await f.cleanup(); }
});
test("context expansion preserves line numbers and inline threads never attach to the wrong side", () => {
  const file = { path: "a.txt", status: "M", additions: 1, deletions: 1, binary: false, hash: "a", patch: "@@ -10,2 +10,2 @@\n-old\n+new\n same\n" };
  const thread = { id: "t", path: "a.txt", line: 10, startLine: null, side: "LEFT" as const, resolved: false, outdated: false, comments: [], truncated: false };
  const model = reviewRows([file], new Set(), 300, undefined, undefined, { contexts: { "a.txt:gap:1:1": { lines: ["before", "second"], total: 40 } }, threads: [thread] });
  const code = model.rows.filter((row) => row.kind === "code"); assert.equal(code[0].line.old, 1); assert.equal(code[1].line.next, 2);
  const i = model.rows.findIndex((row) => row.kind === "thread"); assert.equal(model.rows[i - 1].kind, "code"); assert.equal((model.rows[i - 1] as any).line.kind, "remove");
  const expanded = model.rows.find((row) => row.kind === "gap")!; assert.equal((expanded as any).omitted, 7);
  assert.equal(reviewRows([file], new Set(), 300, undefined, undefined, { threads: [{ ...thread, outdated: true }] }).rows.some((row) => row.kind === "thread"), false);
  const selection = selectLine(selectLine(null, "a.txt", "new", 10), "a.txt", "new", 11); assert.equal(selectedCode(model.rows, selection), "new\nsame");
  assert.equal(selectedCode(model.rows, { ...selection, side: "old" }), "old\nsame");
});
test("checkpoint patches cover empty file transitions and error excerpts are bounded", async () => {
  assert.equal((await textPatch("empty.txt", null, ""))?.status, "A"); assert.equal((await textPatch("empty.txt", "", null))?.status, "D");
  const excerpt = failureExcerpt("noise\nERROR: failure\ncontext\n" + "trailing\n".repeat(10000)); assert.ok(excerpt.includes("ERROR")); assert.ok(excerpt.length <= 12000);
});

test("review points remember a renamed file's removed source path", async () => {
  const f = await fixture(); try {
    await f.git("mv", "code.txt", "renamed.txt");
    const point = await f.service.checkpoint("ws_test", "task", "agent");
    await writeFile(join(f.root, "code.txt"), f.baseText);
    const changes = await f.service.review("ws_test", "task", { since: point.id });
    const restored = changes.files.find((file) => file.path === "code.txt");
    assert.equal(restored?.status, "A"); assert.ok(restored?.patch.includes("+line 1"));
  } finally { await f.cleanup(); }
});
