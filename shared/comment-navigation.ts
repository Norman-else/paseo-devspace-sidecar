import type { ReviewFile } from "./diff";
import type { ReviewThread } from "./review-details";
export function fileDiscussions(file: ReviewFile, threads: ReviewThread[]) {
  return threads.filter((thread) => !thread.outdated && (thread.path === file.path || thread.side === "LEFT" && thread.path === file.oldPath));
}
export function nextDiscussion(threads: ReviewThread[], currentId: string | null, direction: number) {
  const current = threads.filter((thread) => !thread.outdated);
  if (!current.length) return null;
  const index = current.findIndex((thread) => thread.id === currentId);
  return current[index < 0 ? direction > 0 ? 0 : current.length - 1 : (index + direction + current.length) % current.length];
}
