import { diffLines, type DiffLine, type ReviewFile } from "./diff";
import { codeTokens, type CodeToken } from "./syntax";
import { codeAppearance, type CodeAppearance } from "./appearance";
import type { ReviewThread } from "./review-details";
import { fileDiscussions } from "./comment-navigation";

export const HEADER_HEIGHT = 36;
export type ReviewRow =
  | { kind: "header"; file: ReviewFile; path: string; key: string; height: number }
  | { kind: "code"; line: DiffLine; tokens: CodeToken[]; path: string; key: string; height: number }
  | { kind: "gap"; omitted: number; count: number; loaded: number; expanded: boolean; label: string; path: string; key: string; height: number; oldStart: number; newStart: number; side: "old" | "new" }
  | { kind: "thread"; thread: ReviewThread; path: string; key: string; height: number }
  | { kind: "notice"; text: string; deferred: boolean; path: string; key: string; height: number };
export type ReviewExtras = { contexts?: Record<string, { lines: string[]; total: number; expanded?: boolean }>; threads?: ReviewThread[]; expandedThreads?: ReadonlySet<string>; anchors?: Record<string, { path: string; side: "old" | "new"; start: number; lines: string[] }> };
export function reviewRows(files: ReviewFile[], collapsed: ReadonlySet<string>, wrapWidth?: number, measured?: ReadonlyMap<string, number>, typography: CodeAppearance = codeAppearance(null), extras: ReviewExtras = {}) {
  const rows: ReviewRow[] = [], offsets: number[] = [], headers: number[] = [];
  const fileIndices = new Map<string, number>();
  let offset = 0;
  const gapHeight = Math.max(32, typography.lineHeight + 10);
  function add(row: ReviewRow) {
    row.height = measured?.get(row.key) ?? row.height;
    offsets.push(offset); offset += row.height; rows.push(row);
  }
  for (const file of files) {
    fileIndices.set(file.path, rows.length); headers.push(rows.length);
    add({ kind: "header", file, path: file.path, key: file.path + ":header", height: HEADER_HEIGHT });
    if (collapsed.has(file.path)) continue;
    const matchingThreads = fileDiscussions(file, extras.threads ?? []);
    function threadRow(thread: ReviewThread) {
      add({ kind: "thread", path: file.path, thread, key: `thread:${thread.id}`, height: extras.expandedThreads?.has(thread.id) ? 156 + Math.ceil((thread.comments[0]?.body.length ?? 0) / Math.max(20, (wrapWidth ?? 700) / 7)) * 18 : 36 });
    }
    matchingThreads.filter((thread) => thread.line === null).forEach(threadRow);
    if (file.notice || file.deferred) add({ kind: "notice", path: file.path, text: file.notice ?? "Load this file's diff.", deferred: !!file.deferred, key: file.path + ":notice", height: 44 });
    const oldState = { block: false }, newState = { block: false }, shownThreads = new Set<string>();
    const threads = matchingThreads.filter((thread) => thread.line !== null);
    let oldEnd = 0, newEnd = 0, serial = 0;
    function code(line: DiffLine, prefix = "") {
      const source = line.text.slice(1).replace(/\t/g, "    ");
      const tokens = codeTokens(source, file.path, line.kind === "remove" ? oldState : newState);
      if (line.kind === "context") codeTokens(source, file.path, oldState);
      const columns = wrapWidth === undefined ? Infinity : Math.max(1, Math.floor(wrapWidth / typography.characterWidth));
      const cells = [...source].reduce((count, char) => count + (/[^\u0000-\u00ff]/.test(char) ? 2 : 1), 0);
      const key = `${prefix}${file.path}:${line.kind}:${line.old ?? ""}:${line.next ?? ""}`;
      add({ kind: "code", line, tokens, path: file.path, key, height: typography.lineHeight * Math.max(1, Math.ceil(cells / columns)) });
      for (const thread of threads) {
        if (shownThreads.has(thread.id) || (thread.side === "LEFT" ? line.old : line.next) !== thread.line) continue;
        shownThreads.add(thread.id);
        threadRow(thread);
      }
    }
    function gap(oldStart: number, newStart: number, omitted: number, label: string, tail = false) {
      const key = `${file.path}:gap:${oldStart}:${newStart}`, context = extras.contexts?.[key];
      const loaded = context?.lines.length ?? 0, side = file.status === "D" ? "old" : "new", expanded = loaded > 0 && context?.expanded !== false;
      const count = tail ? context ? Math.max(0, context.total - (side === "old" ? oldStart : newStart) + 1) : -1 : omitted;
      if (tail && count === 0) return;
      add({ kind: "gap", path: file.path, key, count, loaded, expanded, omitted: count < 0 ? -1 : Math.max(0, count - (expanded ? loaded : 0)), label, oldStart, newStart, side, height: gapHeight });
      if (expanded) context!.lines.forEach((text, index) => code({ kind: "context", text: " " + text, old: file.status === "A" ? undefined : oldStart + index, next: file.status === "D" ? undefined : newStart + index }));
    }
    for (const line of diffLines(file.patch)) {
      if (line.kind === "hunk") {
        const match = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@\s*(.*)$/.exec(line.text);
        const oldStart = Number(match?.[1] ?? 0), newStart = Number(match?.[2] ?? 0);
        const omitted = Math.min(oldStart > 0 ? oldStart - oldEnd - 1 : Infinity, newStart > 0 ? newStart - newEnd - 1 : Infinity);
        gap(oldEnd + 1, newEnd + 1, Number.isFinite(omitted) ? Math.max(0, omitted) : 0, match?.[3] ?? "");
        oldState.block = false; newState.block = false;
      } else if (line.kind !== "meta") {
        code(line);
        if (line.old !== undefined) oldEnd = line.old;
        if (line.next !== undefined) newEnd = line.next;
      } else if (line.text.startsWith("\\")) add({ kind: "notice", path: file.path, text: "No newline at end of file.", deferred: false, key: file.path + ":notice:" + serial++, height: 24 });
    }
    if (file.patch && (oldEnd || newEnd)) gap(oldEnd + 1, newEnd + 1, -1, "", true);
    for (const [id, anchor] of Object.entries(extras.anchors ?? {})) {
      if (anchor.path !== file.path || shownThreads.has(id)) continue;
      add({ kind: "gap", path: file.path, key: `anchor:${id}`, count: 0, loaded: 0, expanded: false, omitted: 0, label: "__discussion__", oldStart: 0, newStart: 0, side: anchor.side, height: gapHeight });
      anchor.lines.forEach((text, index) => code({ kind: "context", text: " " + text, ...(anchor.side === "old" ? { old: anchor.start + index } : { next: anchor.start + index }) }, `anchor:${id}:`));
    }
  }
  return { rows, offsets, headers, fileIndices, height: offset };
}
