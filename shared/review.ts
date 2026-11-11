import { diffLines, type DiffLine, type ReviewFile } from "./diff";
import { codeTokens, type CodeToken } from "./syntax";

export const LINE_HEIGHT = 20;
export const HEADER_HEIGHT = 36;
export const CODE_GUTTER_WIDTH = 83;
export type ReviewRow =
  | { kind: "header"; file: ReviewFile; path: string; key: string; height: number }
  | { kind: "code"; line: DiffLine; tokens: CodeToken[]; path: string; key: string; height: number }
  | { kind: "gap"; omitted: number; label: string; path: string; key: string; height: number }
  | { kind: "notice"; text: string; deferred: boolean; path: string; key: string; height: number };

export function reviewRows(files: ReviewFile[], collapsed: ReadonlySet<string>, wrapWidth?: number, measured?: ReadonlyMap<string, number>) {
  const rows: ReviewRow[] = [], offsets: number[] = [], headers: number[] = [];
  const fileIndices = new Map<string, number>();
  let offset = 0;
  function add(row: ReviewRow) {
    row.height = measured?.get(row.key) ?? row.height;
    offsets.push(offset); offset += row.height; rows.push(row);
  }
  for (const file of files) {
    fileIndices.set(file.path, rows.length); headers.push(rows.length);
    add({ kind: "header", file, path: file.path, key: file.path + ":header", height: HEADER_HEIGHT });
    if (collapsed.has(file.path)) continue;
    if (file.notice || file.deferred) add({ kind: "notice", path: file.path, text: file.notice ?? "Load this file's diff.", deferred: !!file.deferred, key: file.path + ":notice", height: 44 });
    const oldState = { block: false }, newState = { block: false };
    let oldEnd = 0, newEnd = 0, serial = 0;
    for (const line of diffLines(file.patch)) {
      const key = `${file.path}:${serial++}`;
      if (line.kind === "hunk") {
        const match = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@\s*(.*)$/.exec(line.text);
        const oldStart = Number(match?.[1] ?? 0), newStart = Number(match?.[2] ?? 0);
        const gap = Math.min(oldStart > 0 ? oldStart - oldEnd - 1 : Infinity, newStart > 0 ? newStart - newEnd - 1 : Infinity);
        add({ kind: "gap", omitted: Number.isFinite(gap) ? Math.max(0, gap) : 0, label: match?.[3] ?? "", path: file.path, key, height: 28 });
        oldState.block = false; newState.block = false;
      } else if (line.kind !== "meta") {
        const source = line.text.slice(1).replace(/\t/g, "    ");
        const tokens = codeTokens(source, file.path, line.kind === "remove" ? oldState : newState);
        if (line.kind === "context") codeTokens(source, file.path, oldState);
        if (line.old !== undefined) oldEnd = line.old;
        if (line.next !== undefined) newEnd = line.next;
        // Unseen rows use a conservative estimate; onLayout replaces it with the real height.
        const columns = wrapWidth === undefined ? Infinity : Math.max(1, Math.floor(wrapWidth / 7.3));
        const cells = [...source].reduce((count, char) => count + (/[^\u0000-\u00ff]/.test(char) ? 2 : 1), 0);
        const wrappedLines = Math.max(1, Math.ceil(cells / columns));
        add({ kind: "code", line, tokens, path: file.path, key, height: LINE_HEIGHT * wrappedLines });
      } else if (line.text.startsWith("\\")) add({ kind: "notice", path: file.path, text: "No newline at end of file.", deferred: false, key, height: 24 });
    }
  }
  return { rows, offsets, headers, fileIndices, height: offset };
}
