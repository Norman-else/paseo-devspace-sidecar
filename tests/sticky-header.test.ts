import { test } from "node:test";
import assert from "node:assert/strict";
import { HEADER_HEIGHT, reviewRows } from "../shared/review.ts";
import { stickyFileHeader } from "../shared/sticky-header.ts";

const files = ["First.java", "Next.java", "Last.java"].map((path) => ({
  path, status: "A", additions: 80, deletions: 0, binary: false, hash: path,
  patch: `@@ -0,0 +1,80 @@\n${Array.from({ length: 80 }, (_, n) => `+String line${n} = "${"long_value_".repeat(8)}";`).join("\n")}\n`,
}));

test("a file stays pinned throughout its diff and the next title pushes it away at the boundary", () => {
  const model = reviewRows(files, new Set(), 320);
  const nextTop = model.offsets[model.fileIndices.get("Next.java")!];
  assert.equal(stickyFileHeader(model, 0)?.visible, false);
  assert.equal(stickyFileHeader(model, 20)?.file.path, "First.java");
  assert.equal(stickyFileHeader(model, nextTop / 2)?.file.path, "First.java");
  assert.equal(stickyFileHeader(model, nextTop - HEADER_HEIGHT)?.translateY, 0);
  assert.equal(stickyFileHeader(model, nextTop - 10)?.translateY, 10 - HEADER_HEIGHT);
  assert.equal(stickyFileHeader(model, nextTop)?.file.path, "Next.java");
  assert.equal(stickyFileHeader(model, nextTop)?.visible, false);
  assert.equal(stickyFileHeader(model, nextTop + 10)?.visible, true);
  // Scrolling back restores the previous file, even after a jump over multiple files.
  assert.equal(stickyFileHeader(model, model.height - 1)?.file.path, "Last.java");
  assert.equal(stickyFileHeader(model, nextTop - 100)?.file.path, "First.java");
  assert.equal(stickyFileHeader(model, -20)?.visible, false);
});

test("pinning follows wrapped and remeasured code heights rather than fixed line estimates", () => {
  const wide = reviewRows(files, new Set(), 1200);
  const narrow = reviewRows(files, new Set(), 120);
  const wideBoundary = wide.offsets[wide.fileIndices.get("Next.java")!];
  assert.equal(stickyFileHeader(wide, wideBoundary + 1)?.file.path, "Next.java");
  assert.equal(stickyFileHeader(narrow, wideBoundary + 1)?.file.path, "First.java");
  const row = narrow.rows.find((row) => row.kind === "code")!;
  const measured = reviewRows(files, new Set(), 120, new Map([[row.key, row.height + 100]]));
  const boundary = narrow.offsets[narrow.fileIndices.get("Next.java")!];
  assert.equal(stickyFileHeader(narrow, boundary + 50)?.file.path, "Next.java");
  assert.equal(stickyFileHeader(measured, boundary + 50)?.file.path, "First.java");
});

test("collapsed, filtered and empty reviews never pin a stale file", () => {
  const folded = reviewRows(files, new Set(files.map((file) => file.path)));
  assert.equal(stickyFileHeader(folded, HEADER_HEIGHT + 1)?.file.path, "Next.java");
  const filtered = reviewRows([files[2]], new Set(), 320);
  assert.equal(stickyFileHeader(filtered, 100)?.file.path, "Last.java");
  assert.equal(stickyFileHeader(filtered, filtered.height + 100)?.translateY, 0);
  assert.equal(stickyFileHeader(reviewRows([], new Set()), 500), null);
});
