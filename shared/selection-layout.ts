import type { LineSelection } from "./selection";
import type { reviewRows } from "./review";
import { HEADER_HEIGHT } from "./review";
type Model = ReturnType<typeof reviewRows>;
const targets = new WeakMap<Model, Map<string, { top: number; bottom: number; line: number }[]>>();
export function selectedSpan(model: Model, selection: LineSelection | null) {
  if (!selection) return null;
  const from = Math.min(selection.start, selection.end), to = Math.max(selection.start, selection.end);
  let top = Infinity, bottom = -Infinity;
  model.rows.forEach((row, index) => {
    if (row.kind !== "code" || row.path !== selection.path) return;
    const line = selection.side === "old" ? row.line.old : row.line.next;
    if (line !== undefined && line >= from && line <= to) { top = Math.min(top, model.offsets[index]); bottom = Math.max(bottom, model.offsets[index] + row.height); }
  });
  return Number.isFinite(top) ? { top, bottom } : null;
}
export function floatingSelectionPosition(span: { top: number; bottom: number } | null, scrollY: number, width: number, height: number, gutterWidth: number, toolbarHeight = 44) {
  if (!span || span.bottom - scrollY <= HEADER_HEIGHT || span.top - scrollY >= height || height < HEADER_HEIGHT + toolbarHeight + 16) return null;
  const popupWidth = Math.min(320, width - 16), minTop = HEADER_HEIGHT + 8, maxTop = height - toolbarHeight - 8;
  const above = span.top - scrollY - toolbarHeight - 8, below = span.bottom - scrollY + 8;
  const top = above >= minTop ? above : below <= maxTop ? below : minTop;
  return { top: Math.max(minTop, Math.min(maxTop, top)), left: Math.max(8, Math.min(width - popupWidth - 8, gutterWidth)), width: popupWidth };
}
export function selectionLineAt(model: Model, y: number, path: string, side: "old" | "new") {
  let cache = targets.get(model);
  if (!cache) { cache = new Map(); targets.set(model, cache); }
  const key = `${path}\0${side}`;
  let lines = cache.get(key);
  if (!lines) {
    lines = model.rows.flatMap((row, index) => {
      if (row.kind !== "code" || row.path !== path) return [];
      const line = side === "old" ? row.line.old : row.line.next;
      return line === undefined ? [] : [{ line, top: model.offsets[index], bottom: model.offsets[index] + row.height }];
    });
    cache.set(key, lines);
  }
  if (!lines.length) return null;
  let low = 0, high = lines.length;
  while (low < high) { const mid = (low + high) >>> 1; if (lines[mid].bottom <= y) low = mid + 1; else high = mid; }
  if (low === lines.length) return lines.at(-1)!.line;
  if (low > 0 && y < lines[low].top && y - lines[low - 1].bottom < lines[low].top - y) return lines[low - 1].line;
  return lines[low].line;
}
