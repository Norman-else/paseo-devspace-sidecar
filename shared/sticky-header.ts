import { HEADER_HEIGHT, type reviewRows } from "./review";

export function stickyFileHeader(model: ReturnType<typeof reviewRows>, scrollY: number) {
  if (!model.headers.length) return null;
  const y = Number.isFinite(scrollY) ? Math.max(0, scrollY) : 0;
  let low = 0, high = model.headers.length;
  while (low + 1 < high) {
    const middle = Math.floor((low + high) / 2);
    if (model.offsets[model.headers[middle]] <= y) low = middle;
    else high = middle;
  }
  const index = model.headers[low];
  const row = model.rows[index];
  if (row.kind !== "header") return null;
  const next = model.headers[low + 1];
  return {
    file: row.file,
    visible: y > model.offsets[index],
    // Let the incoming file title push the pinned one out of the viewport.
    translateY: next === undefined ? 0 : Math.min(0, model.offsets[next] - y - HEADER_HEIGHT),
  };
}
