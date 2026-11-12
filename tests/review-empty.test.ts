import { test } from "node:test";
import assert from "node:assert/strict";
import { reviewEmptyKind } from "../shared/review-empty.ts";
const base = { comparison: "local" as const, totalFiles: 0, visibleFiles: 0, search: false, unreviewed: false, since: false };
test("zero local differences indicate PR file sync, while baseline and filtered results do not", () => {
  assert.equal(reviewEmptyKind(base), "synced");
  assert.equal(reviewEmptyKind({ ...base, since: true }), "baseline");
  assert.equal(reviewEmptyKind({ ...base, totalFiles: 3, search: true }), "search");
  assert.equal(reviewEmptyKind({ ...base, totalFiles: 3, unreviewed: true }), "reviewed");
  assert.equal(reviewEmptyKind({ ...base, totalFiles: 3 }), "filtered");
  assert.equal(reviewEmptyKind({ ...base, totalFiles: 3, visibleFiles: 1 }), null);
});
test("empty comparison copy describes the actual scope rather than claiming all files reviewed", () => {
  assert.equal(reviewEmptyKind({ ...base, comparison: "uncommitted", unreviewed: true }), "clean");
  assert.equal(reviewEmptyKind({ ...base, comparison: "task" }), "task");
  assert.equal(reviewEmptyKind({ ...base, comparison: "pr" }), "pr");
});
