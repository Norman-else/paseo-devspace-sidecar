import { test } from "node:test";
import assert from "node:assert/strict";
import { reviewRows } from "../shared/review.ts";
import { floatingSelectionPosition, selectedSpan, selectionLineAt } from "../shared/selection-layout.ts";
import { selectedCode } from "../shared/selection.ts";
const files = ["a.txt", "b.txt"].map((path) => ({ path, status: "M", additions: 2, deletions: 1, binary: false, hash: path, patch: "@@ -1,3 +1,4 @@\n first\n-old\n+new\n+extra\n last\n" }));
test("drag hit testing follows wrapped rows and clamps selection to its original file and side", () => {
  const model = reviewRows(files, new Set(), 60);
  const newRow = model.rows.findIndex((row) => row.kind === "code" && row.path === "a.txt" && row.line.next === 3);
  assert.equal(selectionLineAt(model, model.offsets[newRow] + 2, "a.txt", "new"), 3);
  assert.equal(selectionLineAt(model, -10, "a.txt", "new"), 1);
  assert.equal(selectionLineAt(model, model.height + 100, "a.txt", "new"), 4);
  const oldRow = model.rows.findIndex((row) => row.kind === "code" && row.line.kind === "remove");
  assert.equal(selectionLineAt(model, model.offsets[oldRow] + 1, "a.txt", "old"), 2);
  assert.equal(selectionLineAt(model, 100, "missing.txt", "new"), null);
});
test("floating controls stay in the diff viewport and hide when their selection leaves it", () => {
  assert.equal(floatingSelectionPosition({ top: 20, bottom: 40 }, 100, 320, 500, 110), null);
  assert.equal(floatingSelectionPosition({ top: 800, bottom: 900 }, 0, 320, 500, 110), null);
  const middle = floatingSelectionPosition({ top: 200, bottom: 300 }, 0, 320, 500, 110)!;
  assert.ok(middle.top + 44 <= 200); assert.ok(middle.left >= 8); assert.ok(middle.left + middle.width <= 312);
  const top = floatingSelectionPosition({ top: 40, bottom: 70 }, 0, 320, 500, 110)!;
  assert.ok(top.top >= 78);
  const spanning = floatingSelectionPosition({ top: 0, bottom: 700 }, 0, 280, 500, 110, 90)!;
  assert.ok(spanning.top >= 36); assert.ok(spanning.top + 90 <= 500);
});
test("selected code excludes row gutters, diff markers and removed lines when selecting the new side", () => {
  const model = reviewRows(files, new Set(), 300);
  const selection = { path: "a.txt", side: "new" as const, start: 4, end: 2 };
  assert.equal(selectedCode(model.rows, selection), "new\nextra\nlast");
  const span = selectedSpan(model, selection)!;
  assert.ok(span.bottom > span.top);
  assert.equal(selectedSpan(model, { ...selection, path: "missing" }), null);
});

test("feedback selection stays bounded while explicit code copy can include the complete range", () => {
  const file = { ...files[0], status: "A", patch: "@@ -0,0 +1,250 @@\n" + Array.from({ length: 250 }, (_, n) => "+line " + (n + 1)).join("\n") + "\n" };
  const model = reviewRows([file], new Set(), 500);
  const selection = { path: file.path, side: "new" as const, start: 1, end: 250 };
  assert.equal(selectedCode(model.rows, selection).split("\n").length, 200);
  assert.equal(selectedCode(model.rows, selection, Infinity).split("\n").length, 250);
});
