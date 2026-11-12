import type { Snapshot } from "./diff";
export type ReviewEmptyKind = "synced" | "clean" | "task" | "pr" | "baseline" | "reviewed" | "search" | "filtered";
export function reviewEmptyKind(input: { comparison: Snapshot["comparison"]; totalFiles: number; visibleFiles: number; search: boolean; unreviewed: boolean; since: boolean }): ReviewEmptyKind | null {
  if (input.visibleFiles > 0) return null;
  if (input.totalFiles > 0) return input.search ? "search" : input.unreviewed ? "reviewed" : "filtered";
  // An empty baseline comparison does not mean the worktree matches the PR head.
  if (input.since) return "baseline";
  return ({ local: "synced", uncommitted: "clean", task: "task", pr: "pr" } as const)[input.comparison];
}
