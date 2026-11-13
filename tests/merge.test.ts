import { test } from "node:test";
import assert from "node:assert/strict";
import { GitHubMerge, type MergeContext } from "../server/github-merge.ts";
import { bridgeRequest } from "../shared/diff.ts";
import type { MergeRequest } from "../shared/pr-merge.ts";
const sha = "a".repeat(40), resultSha = "b".repeat(40), uuid = "12345678-1234-4123-8123-123456789abc";
const context: MergeContext = { root: "/project", repository: "Owner/Repo", number: 123, sourceBranch: "feature/task" };
const request: MergeRequest = { workspaceId: "ws_test", prNumber: 123, requestId: "merge-request-123456789", expectedRepository: "Owner/Repo", expectedHeadSha: sha, expectedBaseBranch: "main", method: "squash", bypass: false };
const repo = () => ({ nameWithOwner: "Owner/Repo", viewerPermission: "WRITE", mergeCommitAllowed: true, squashMergeAllowed: true, rebaseMergeAllowed: true, pullRequest: { number: 123, state: "OPEN", isDraft: false, headRefName: "feature/task", baseRefName: "main", headRefOid: sha, mergeable: "MERGEABLE", canBeRebased: true, mergeStateStatus: "CLEAN", viewerCanMergeAsAdmin: true, isMergeQueueEnabled: false, stack: null as { __typename: string } | null, mergeCommit: null as { oid: string } | null, commits: { totalCount: 6 } } });
function setup() {
  const raw = repo(), calls: string[][] = [];
  let result: unknown = { status: "pending", details: { uuid } }, writeError: unknown;
  const service = new GitHubMerge(async (_root, args) => {
    calls.push(args);
    if (args.includes("graphql")) return JSON.stringify({ data: { repository: raw } });
    if (args.includes("--method")) { if (writeError) throw writeError; return JSON.stringify({ status: "pending", details: { uuid } }); }
    return JSON.stringify(result);
  });
  return { raw, service, calls, writes: () => calls.filter((args) => args.includes("PUT")), result: (value: unknown) => { result = value; }, failWrite: (error: unknown) => { writeError = error; } };
}
test("merge options are read-only and follow repository methods, normal requirements and actual bypass rights", async () => {
  const f = setup(); f.raw.mergeCommitAllowed = false; f.raw.pullRequest.mergeStateStatus = "BLOCKED";
  const options = await f.service.options(context);
  assert.deepEqual(options.methods, ["squash", "rebase"]); assert.equal(options.defaultMethod, "squash");
  assert.equal(options.reason, "requirements"); assert.equal(options.bypassReason, "none"); assert.equal(f.writes().length, 0);
  f.raw.pullRequest.canBeRebased = false;
  assert.ok(!(await f.service.options(context)).methods.includes("rebase"));
  f.raw.pullRequest.viewerCanMergeAsAdmin = false;
  assert.equal((await f.service.options(context)).bypassReason, "bypass_denied");
  f.raw.pullRequest.isMergeQueueEnabled = true;
  assert.equal((await f.service.options(context)).reason, "queue");
});
test("normal and bypass merges pin the expected head and never write after stale target or blocked validation", async () => {
  for (const change of [ { expectedHeadSha: "c".repeat(40) }, { expectedBaseBranch: "release" }, { expectedRepository: "Owner/Other" } ]) {
    const f = setup(); const result = await f.service.merge({ ...request, ...change }, async () => context);
    assert.equal(result.reason, "stale"); assert.equal(f.writes().length, 0);
  }
  for (const [state, reason] of [["DIRTY", "requirements"], ["BLOCKED", "requirements"]]) {
    const f = setup(); f.raw.pullRequest.mergeStateStatus = state;
    assert.equal((await f.service.merge(request, async () => context)).reason, reason); assert.equal(f.writes().length, 0);
  }
  const blocked = setup(); blocked.raw.pullRequest.mergeStateStatus = "BLOCKED"; blocked.raw.pullRequest.viewerCanMergeAsAdmin = false;
  assert.equal((await blocked.service.merge({ ...request, bypass: true }, async () => context)).reason, "bypass_denied"); assert.equal(blocked.writes().length, 0);
  for (const method of ["merge", "squash", "rebase"] as const) {
    const f = setup(); f.raw.pullRequest.mergeStateStatus = "BLOCKED";
    const result = await f.service.merge({ ...request, method, bypass: true }, async () => context);
    assert.equal(result.status, "pending"); const args = f.writes()[0];
    assert.ok(args.includes(`sha=${sha}`)); assert.ok(args.includes(`merge_method=${method}`)); assert.ok(args.includes("bypass_rules=true")); assert.ok(args.includes("merge_action=direct_merge"));
  }
  const stack = setup(); stack.raw.pullRequest.stack = { __typename: "PullRequestStack" };
  assert.equal((await stack.service.merge({ ...request, bypass: true }, async () => context)).reason, "stacked"); assert.equal(stack.writes().length, 0);
  const normal = setup(); await normal.service.merge(request, async () => context); assert.ok(normal.writes()[0].includes("bypass_rules=false"));
});
test("pending requests deduplicate clicks, poll without additional writes, and require actual GitHub completion", async () => {
  const f = setup(); await f.service.merge(request, async () => context);
  assert.equal((await f.service.merge(request, async () => { throw Error("must not resolve twice"); })).status, "pending");
  assert.equal((await f.service.merge({ ...request, requestId: "different-request-123456" }, async () => context)).reason, "busy");
  assert.equal((await f.service.status("ws_test", 123, request.requestId)).status, "pending");
  f.result({ status: "merged", details: { sha: resultSha } });
  const merged = await f.service.status("ws_test", 123, request.requestId); assert.equal(merged.status, "merged"); assert.equal(merged.sha, resultSha);
  assert.equal(f.writes().length, 1);
  assert.equal((await f.service.status("ws_other", 123, request.requestId)).status, "unknown");
});
test("ambiguous transport errors never retry a merge and can recover by verifying the PR state", async () => {
  const f = setup(); f.failWrite(new Error("connection lost after request"));
  assert.equal((await f.service.merge(request, async () => context)).status, "unknown");
  assert.equal((await f.service.merge({ ...request, requestId: "new-request-12345678" }, async () => context)).reason, "busy");
  f.raw.pullRequest.state = "MERGED"; f.raw.pullRequest.mergeCommit = { oid: resultSha };
  assert.equal((await f.service.status("ws_test", 123, request.requestId)).status, "merged"); assert.equal(f.writes().length, 1);
});
test("drafts, unavailable methods, conflicts, and insufficient permissions cannot invoke a merge", async () => {
  for (const mode of ["draft", "method", "conflicts", "permission"] as const) {
    const f = setup();
    if (mode === "draft") f.raw.pullRequest.isDraft = true;
    if (mode === "method") f.raw.squashMergeAllowed = false;
    if (mode === "conflicts") f.raw.pullRequest.mergeable = "CONFLICTING";
    if (mode === "permission") f.raw.viewerPermission = "READ";
    assert.equal((await f.service.merge(request, async () => context)).reason, mode); assert.equal(f.writes().length, 0);
  }
  assert.ok(!bridgeRequest.safeParse({ op: "merge-pr", ...request, bypass: undefined }).success);
  assert.ok(bridgeRequest.safeParse({ op: "merge-pr", ...request }).success);
});

test("a request is observable and deduplicated even while workspace association is still loading", async () => {
  const f = setup(); let release!: (value: MergeContext) => void;
  const first = f.service.merge(request, () => new Promise((resolve) => { release = resolve; }));
  assert.equal((await f.service.status("ws_test", 123, request.requestId)).status, "pending");
  assert.equal((await f.service.merge(request, async () => { throw Error("duplicate resolver"); })).status, "pending");
  assert.equal(f.writes().length, 0);
  release(context); await first; assert.equal(f.writes().length, 1);
});

test("an abandoned failed merge is rechecked before a later explicit merge, including a changed PR head", async () => {
  const f = setup(); await f.service.merge(request, async () => context);
  f.result({ status: "failed", details: { message: "Head changed" } }); f.raw.pullRequest.headRefOid = resultSha;
  const next = { ...request, requestId: "later-explicit-request-123", expectedHeadSha: resultSha };
  assert.equal((await f.service.merge(next, async () => context)).status, "pending");
  assert.equal(f.writes().length, 2);
  const unknown = setup(); unknown.failWrite(new Error("network interrupted"));
  await unknown.service.merge(request, async () => context);
  unknown.raw.pullRequest.headRefOid = resultSha; unknown.failWrite(undefined);
  assert.equal((await unknown.service.merge(next, async () => context)).status, "pending");
  assert.equal(unknown.writes().length, 2, "the second write belongs to a new explicit action against the new head");
});

test("late pending status responses cannot overwrite a verified terminal merge outcome", async () => {
  const f = setup(); await f.service.merge(request, async () => context);
  f.result({ status: "merged", details: { sha: resultSha } }); const first = f.service.status("ws_test", 123, request.requestId);
  f.result({ status: "pending", details: { uuid } }); const second = f.service.status("ws_test", 123, request.requestId);
  assert.deepEqual((await Promise.all([first, second])).map((outcome) => outcome.status), ["merged", "merged"]);
  assert.equal((await f.service.status("ws_test", 123, request.requestId)).status, "merged");
});
