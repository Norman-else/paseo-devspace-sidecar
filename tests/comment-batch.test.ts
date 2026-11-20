import test from "node:test";
import assert from "node:assert/strict";
import { commentBatchPrompt } from "../shared/comment-batch.ts";
import type { ReviewThread } from "../shared/review-details.ts";

const thread = (id: string, patch: Partial<ReviewThread> = {}, body = "Body"): ReviewThread => ({
  id, path: "agent/graph/chat.py", line: 321, startLine: null, side: "RIGHT", resolved: false, outdated: false, truncated: false,
  comments: [{ author: "mercoder-dev", body, url: `https://github.com/o/r/pull/74#discussion_${id}`, createdAt: "2026-11-20T00:00:00Z" }], ...patch,
});
const context = { prNumber: 74, headBranch: "PSOS-6411", baseBranch: "master", headSha: "95872bd0123456789", workspace: { id: "ws_abc", root: "/u/.devspace/worktrees/Navi-1", worktree: true } };

test("a batch prompt numbers every comment and asks for fix, commit, push and a per-comment report", () => {
  const prompt = commentBatchPrompt([thread("1"), thread("2", { path: "agent/run.py", line: 480, startLine: 470, outdated: true, comments: [
    { author: "alice", body: "Please rename", url: "https://github.com/o/r/pull/74#discussion_2", createdAt: "x" },
    { author: "bob", body: "Agreed", url: "https://github.com/o/r/pull/74#discussion_3", createdAt: "y" },
  ] })], context);
  assert.match(prompt, /^\[DevSpace Desk\] Address 2 review comments on PR #74 \(PSOS-6411 → master\)\./);
  assert.match(prompt, /workspace_id: ws_abc \(worktree at \/u\/\.devspace\/worktrees\/Navi-1\)/);
  assert.match(prompt, /### Comment 1: agent\/graph\/chat\.py:321 \(unresolved\)/);
  assert.match(prompt, /### Comment 2: agent\/run\.py:470-480 \(unresolved, outdated/);
  assert.match(prompt, /By alice:\nPlease rename\n\nReply by bob:\nAgreed/);
  assert.match(prompt, /push to PSOS-6411/);
  assert.match(prompt, /Do not merge, force-push, or reply to or resolve the threads/);
  assert.match(prompt, /Finish with a table/);
});

test("bot markup is stripped and long bodies are truncated to fit the budget", () => {
  const prompt = commentBatchPrompt([thread("1", {}, `<!-- metadata -->Real text${"x".repeat(100000)}`)], context);
  assert.doesNotMatch(prompt, /metadata/);
  assert.match(prompt, /Real text/);
  assert.match(prompt, /comment truncated/);
  assert.ok(prompt.length < 65000);
});
