import { test } from "node:test";
import assert from "node:assert/strict";
import { fileDiscussions, nextDiscussion } from "../shared/comment-navigation.ts";
import { reviewRows } from "../shared/review.ts";
import type { ReviewThread } from "../shared/review-details.ts";
const file = { path: "new.txt", oldPath: "old.txt", status: "R", additions: 1, deletions: 1, binary: false, hash: "a", patch: "@@ -1 +1 @@\n-old\n+new\n" };
const thread = (id: string, path = "new.txt", side: "LEFT" | "RIGHT" = "RIGHT", outdated = false): ReviewThread => ({ id, path, line: 1, startLine: null, side, resolved: false, outdated, truncated: false, comments: [{ author: "reviewer", name: "Reviewer Name", avatarUrl: "https://avatars.githubusercontent.com/u/1?v=4", body: "Comment", url: "https://example.com/" + id, createdAt: "2026-01-01" }] });
test("direct comment navigation wraps in both directions and skips outdated positions", () => {
  const threads = [thread("a"), thread("old", "new.txt", "RIGHT", true), thread("b")];
  assert.equal(nextDiscussion(threads, null, 1)?.id, "a");
  assert.equal(nextDiscussion(threads, null, -1)?.id, "b");
  assert.equal(nextDiscussion(threads, "a", 1)?.id, "b");
  assert.equal(nextDiscussion(threads, "a", -1)?.id, "b");
  assert.equal(nextDiscussion([], null, 1), null);
});
test("file comment badges include file-level and resolved discussions and match renamed left-side paths", () => {
  const threads = [thread("new"), thread("left", "old.txt", "LEFT"), thread("wrong", "old.txt"), thread("outdated", "new.txt", "RIGHT", true), { ...thread("resolved"), resolved: true }, { ...thread("file"), line: null }];
  assert.deepEqual(fileDiscussions(file, threads).map((thread) => thread.id), ["new", "left", "resolved", "file"]);
});
test("inline discussion markers stay compact until explicitly opened and retain their line side", () => {
  const threads = [thread("right"), thread("left", "old.txt", "LEFT")];
  const compact = reviewRows([file], new Set(), 300, undefined, undefined, { threads });
  const opened = reviewRows([file], new Set(), 300, undefined, undefined, { threads, expandedThreads: new Set(["right"]) });
  assert.equal(compact.rows.find((row) => row.key === "thread:right")?.height, 36);
  const fileLevel = reviewRows([file], new Set(), 300, undefined, undefined, { threads: [{ ...thread("file-level"), line: null }] });
  assert.equal(fileLevel.rows[1].key, "thread:file-level");
  assert.ok(opened.rows.find((row) => row.key === "thread:right")!.height > 36);
  assert.equal(opened.rows.find((row) => row.key === "thread:left")?.height, 36);
  const index = compact.rows.findIndex((row) => row.key === "thread:left");
  assert.equal((compact.rows[index - 1] as any).line.kind, "remove");
});
