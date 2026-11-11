import type { PullRequestResult } from "./pull-request";

/** One context header at a time; an unknown PR state is never treated as "no PR". */
export function reviewHeader(input: { hasWorkspace: boolean; result?: PullRequestResult; pending: boolean; error: boolean }) {
  if (!input.hasWorkspace) return { mode: "none" as const, showPrNotice: false };
  if (!input.error && input.result?.status === "available" && input.result.pullRequests.length > 0) return { mode: "pull-request" as const, showPrNotice: false };
  return { mode: "workspace" as const, showPrNotice: input.pending || input.error || input.result?.status === "unavailable" };
}
