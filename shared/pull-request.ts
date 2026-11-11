import { z } from "zod";

export const checkState = z.enum(["passed", "failed", "pending", "skipped", "unknown"]);
export const checkSchema = z.object({ name: z.string(), state: checkState, url: z.string().url().nullable() });
export const checksSchema = z.object({ status: z.enum(["none", "passed", "failed", "pending", "skipped", "unknown"]), total: z.number().int(), passed: z.number().int(), failed: z.number().int(), pending: z.number().int(), skipped: z.number().int(), unknown: z.number().int(), entries: z.array(checkSchema) });
export type Checks = z.infer<typeof checksSchema>;
export const pullRequestSchema = z.object({
  number: z.number().int().positive(), title: z.string(), url: z.string().url(),
  state: z.enum(["OPEN", "DRAFT", "MERGED", "CLOSED"]), baseBranch: z.string(), headSha: z.string(),
  review: z.enum(["APPROVED", "CHANGES_REQUESTED", "REVIEW_REQUIRED", "NONE"]),
  conflicts: z.boolean(), checks: checksSchema,
});
export type PullRequest = z.infer<typeof pullRequestSchema>;
export const pullRequestResultSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("available"), repository: z.string(), branch: z.string(), localHeadSha: z.string(), pullRequests: z.array(pullRequestSchema), checkedAt: z.string() }),
  z.object({ status: z.literal("none"), repository: z.string(), branch: z.string(), checkedAt: z.string() }),
  z.object({ status: z.literal("unavailable"), reason: z.enum(["gh_missing", "auth_required", "unsupported_remote", "no_remote", "detached_head", "request_failed"]), checkedAt: z.string() }),
]);
export type PullRequestResult = z.infer<typeof pullRequestResultSchema>;

export function checkSummary(value: unknown): Checks {
  const summary: Checks = { status: "none", total: 0, passed: 0, failed: 0, pending: 0, skipped: 0, unknown: 0, entries: [] };
  for (const item of Array.isArray(value) ? value : []) {
    if (!item || typeof item !== "object") continue;
    let state: z.infer<typeof checkState> = "unknown";
    if (item.__typename === "StatusContext") {
      state = item.state === "SUCCESS" ? "passed" : ["FAILURE", "ERROR"].includes(item.state) ? "failed" : ["PENDING", "EXPECTED"].includes(item.state) ? "pending" : "unknown";
    } else if (item.__typename === "CheckRun") {
      if (item.status !== "COMPLETED") state = "pending";
      else state = item.conclusion === "SUCCESS" ? "passed" : ["NEUTRAL", "SKIPPED"].includes(item.conclusion) ? "skipped" : ["FAILURE", "TIMED_OUT", "CANCELLED", "ACTION_REQUIRED", "STARTUP_FAILURE", "STALE"].includes(item.conclusion) ? "failed" : "unknown";
    }
    summary[state]++; summary.total++;
    const target = item.detailsUrl ?? item.targetUrl;
    summary.entries.push({ name: String(item.name ?? item.context ?? "Check"), state, url: typeof target === "string" && /^https:\/\//i.test(target) ? target : null });
  }
  summary.status = !summary.total ? "none" : summary.failed ? "failed" : summary.pending ? "pending" : summary.unknown ? "unknown" : summary.passed ? "passed" : "skipped";
  return summary;
}
