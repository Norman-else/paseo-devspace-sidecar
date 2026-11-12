import type { ReviewRow } from "./review";
export type LineSelection = { path: string; side: "old" | "new"; start: number; end: number };
export function selectLine(previous: LineSelection | null, path: string, side: "old" | "new", line: number): LineSelection {
  return previous?.path === path && previous.side === side ? { ...previous, end: line } : { path, side, start: line, end: line };
}
export function selectedLines(rows: ReviewRow[], selection: LineSelection, limit = 200): { number: number; text: string }[] {
  const from = Math.min(selection.start, selection.end), to = Math.max(selection.start, selection.end);
  const seen = new Set<number>();
  return rows.filter((row): row is Extract<ReviewRow, { kind: "code" }> => row.kind === "code" && row.path === selection.path && (selection.side === "old" ? row.line.old : row.line.next) !== undefined)
    .map((row) => ({ number: (selection.side === "old" ? row.line.old : row.line.next)!, text: row.line.text.slice(1) }))
    .filter((line) => line.number >= from && line.number <= to)
    .filter((line) => { if (seen.has(line.number)) return false; seen.add(line.number); return true; })
    .sort((a, b) => a.number - b.number)
    .slice(0, limit);
}
export function selectedCode(rows: ReviewRow[], selection: LineSelection, limit = 200) {
  return selectedLines(rows, selection, limit).map((line) => line.text).join("\n");
}
