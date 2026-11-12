import type { ReviewRow } from "./review";
export type LineSelection = { path: string; side: "old" | "new"; start: number; end: number };
export function selectLine(previous: LineSelection | null, path: string, side: "old" | "new", line: number): LineSelection {
  return previous?.path === path && previous.side === side ? { ...previous, end: line } : { path, side, start: line, end: line };
}
export function selectedCode(rows: ReviewRow[], selection: LineSelection, limit = 200) {
  const from = Math.min(selection.start, selection.end), to = Math.max(selection.start, selection.end);
  const seen = new Set<number>();
  return rows.filter((row) => row.kind === "code" && row.path === selection.path && (selection.side === "old" ? row.line.old : row.line.next) !== undefined)
    .filter((row) => { if (row.kind !== "code") return false; const n = (selection.side === "old" ? row.line.old : row.line.next)!; return n >= from && n <= to; })
    .filter((row) => { if (row.kind !== "code") return false; const n = (selection.side === "old" ? row.line.old : row.line.next)!; if (seen.has(n)) return false; seen.add(n); return true; })
    .sort((a, b) => (a.kind === "code" ? (selection.side === "old" ? a.line.old : a.line.next)! : 0) - (b.kind === "code" ? (selection.side === "old" ? b.line.old : b.line.next)! : 0))
    .slice(0, limit).map((row) => row.kind === "code" ? row.line.text.slice(1) : "").join("\n");
}
