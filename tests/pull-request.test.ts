import { test } from "node:test";
import assert from "node:assert/strict";
import { checkSummary, pullRequestResultSchema } from "../shared/pull-request.ts";
import { githubRepository, PullRequests } from "../server/pull-requests.ts";

const input = { root: "/registered/worktree", remote: "git@github.com:Owner/Repo.git", branch: "feature/task", localHeadSha: "local-head" };
const pr = (overrides: object = {}) => ({ number: 123, title: "Task changes", url: "https://github.com/Owner/Repo/pull/123", state: "OPEN", isDraft: false,
  baseRefName: "main", headRefName: input.branch, headRefOid: "last-push", headRepositoryOwner: { login: "Owner" }, headRepository: { name: "Repo" },
  reviewDecision: "REVIEW_REQUIRED", mergeable: "MERGEABLE", updatedAt: "2026-11-11T00:00:00Z", statusCheckRollup: [], ...overrides });
const reader = (pullRequests: unknown[]) => new PullRequests(async (_root, args) => args[0] === "repo" ? JSON.stringify({ nameWithOwner: "Owner/Repo", parent: null }) : JSON.stringify(pullRequests));

test("GitHub identities support SSH and credentialed HTTPS without retaining credentials", () => {
  assert.equal(githubRepository("git@github.com:Owner/Repo.git"), "Owner/Repo");
  assert.equal(githubRepository("ssh://git@github.com/Owner/Repo.git"), "Owner/Repo");
  assert.equal(githubRepository("https://user:private-value@github.com/Owner/Repo.git"), "Owner/Repo");
  assert.equal(githubRepository("https://github.com/Owner/Repo/"), "Owner/Repo");
  assert.equal(githubRepository("https://gitlab.com/Owner/Repo"), null);
  assert.equal(githubRepository("https://github.com.attacker.invalid/Owner/Repo"), null);
  assert.equal(githubRepository("not-a-remote"), null);
});

test("checks combine GitHub Actions and external status contexts without turning missing checks green", () => {
  assert.equal(checkSummary(null).status, "none");
  assert.equal(checkSummary([{ __typename: "CheckRun", name: "unit", status: "COMPLETED", conclusion: "SKIPPED" }]).status, "skipped");
  const checks = checkSummary([
    { __typename: "CheckRun", name: "unit", status: "COMPLETED", conclusion: "SUCCESS", detailsUrl: "https://github.com/Owner/Repo/actions/runs/1" },
    { __typename: "StatusContext", context: "CircleCI", state: "PENDING", targetUrl: "https://app.circleci.com/pipelines/1" },
    { __typename: "CheckRun", name: "lint", status: "COMPLETED", conclusion: "FAILURE" },
  ]);
  assert.equal(checks.status, "failed"); assert.equal(checks.total, 3);
  assert.equal(checks.passed, 1); assert.equal(checks.pending, 1); assert.equal(checks.failed, 1);
  assert.equal(checkSummary([{ __typename: "CheckRun", status: "COMPLETED", conclusion: null }]).status, "unknown");
  assert.equal(checkSummary([{ __typename: "StatusContext", state: "SUCCESS", targetUrl: "javascript:alert(1)" }]).entries[0].url, null);
});

test("PR lookup keeps branch identity and shows draft, review, conflicts, merge and closed states", async () => {
  const draft = await reader([pr({ isDraft: true, reviewDecision: "CHANGES_REQUESTED", mergeable: "CONFLICTING" })]).read(input);
  pullRequestResultSchema.parse(draft);
  assert.equal(draft.status, "available");
  if (draft.status !== "available") throw new Error("Missing PR");
  assert.equal(draft.pullRequests[0].state, "DRAFT"); assert.equal(draft.pullRequests[0].review, "CHANGES_REQUESTED"); assert.equal(draft.pullRequests[0].conflicts, true);
  assert.equal(draft.localHeadSha, "local-head"); assert.equal(draft.pullRequests[0].headSha, "last-push");
  const merged = await reader([pr({ state: "MERGED", reviewDecision: "APPROVED" })]).read(input);
  assert.equal(merged.status === "available" && merged.pullRequests[0].state, "MERGED");
  const closed = await reader([pr({ state: "CLOSED" })]).read(input);
  assert.equal(closed.status === "available" && closed.pullRequests[0].state, "CLOSED");
});

test("fork lookup resolves its parent and filters out another owner's same-named branch", async () => {
  const calls: string[][] = [];
  const github = new PullRequests(async (_root, args) => {
    calls.push(args);
    if (args[0] === "repo") return JSON.stringify({ nameWithOwner: "Owner/Repo", parent: { nameWithOwner: "Upstream/Repo" } });
    return JSON.stringify([pr({ number: 999, headRepositoryOwner: { login: "SomeoneElse" } }), pr()]);
  });
  const result = await github.read(input);
  assert.equal(result.status, "available");
  if (result.status !== "available") throw new Error("Missing PR");
  assert.deepEqual(result.pullRequests.map((pr) => pr.number), [123]);
  assert.ok(calls[1].includes("github.com/Upstream/Repo"));
  assert.equal(calls[1][calls[1].indexOf("--head") + 1], input.branch);
  const none = await reader([pr({ headRepositoryOwner: { login: "SomeoneElse" } })]).read(input);
  assert.equal(none.status, "none");
});

test("multiple open PRs are retained and closed history does not replace them", async () => {
  const result = await reader([pr({ number: 1, state: "MERGED", updatedAt: "2026-11-12T00:00:00Z" }), pr({ number: 2 }), pr({ number: 3, baseRefName: "release" })]).read(input);
  assert.equal(result.status, "available");
  if (result.status !== "available") throw new Error("Missing PRs");
  assert.deepEqual(result.pullRequests.map((pr) => pr.number).sort(), [2, 3]);
});

test("missing PRs, absent CLI and failed authentication remain distinct results", async () => {
  assert.equal((await reader([]).read(input)).status, "none");
  const missing = await new PullRequests(async () => { throw Object.assign(new Error("not found"), { code: "ENOENT" }); }).read(input);
  assert.deepEqual(missing.status === "unavailable" && missing.reason, "gh_missing");
  const auth = await new PullRequests(async () => { throw Object.assign(new Error("gh auth login"), { code: 4 }); }).read(input);
  assert.deepEqual(auth.status === "unavailable" && auth.reason, "auth_required");
  const network = await new PullRequests(async () => { throw new Error("network unreachable"); }).read(input);
  assert.deepEqual(network.status === "unavailable" && network.reason, "request_failed");
  assert.equal((await reader([]).read({ ...input, branch: null })).status, "unavailable");
});
