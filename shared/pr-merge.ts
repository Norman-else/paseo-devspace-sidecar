import { z } from "zod";
export const mergeMethod = z.enum(["merge", "squash", "rebase"]);
export type MergeMethod = z.infer<typeof mergeMethod>;
export const mergeReason = z.enum(["none", "not_open", "draft", "permission", "bypass_denied", "conflicts", "checking", "requirements", "queue", "stacked", "method", "stale", "busy", "unavailable", "github_failed", "unknown"]);
export const mergeOptionsSchema = z.object({
  repository: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/), number: z.number().int().positive(), sourceBranch: z.string(), baseBranch: z.string(), headSha: z.string().regex(/^[a-f0-9]{40,64}$/i),
  state: z.enum(["OPEN", "CLOSED", "MERGED"]), methods: z.array(mergeMethod), defaultMethod: mergeMethod.nullable(), canBypass: z.boolean(), reason: mergeReason, bypassReason: mergeReason, commits: z.number().int().nonnegative(),
});
export type MergeOptions = z.infer<typeof mergeOptionsSchema>;
export const mergeRequestFields = {
  requestId: z.string().regex(/^[a-z0-9-]{16,80}$/), expectedRepository: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/), expectedHeadSha: z.string().regex(/^[a-f0-9]{40,64}$/i), expectedBaseBranch: z.string().min(1).max(255), method: mergeMethod, bypass: z.boolean(),
};
export const mergeOutcomeSchema = z.object({ requestId: mergeRequestFields.requestId, status: z.enum(["pending", "merged", "failed", "unknown"]), reason: mergeReason, detail: z.string().max(1200).optional(), sha: z.string().optional() });
export type MergeOutcome = z.infer<typeof mergeOutcomeSchema>;
export type MergeRequest = z.infer<z.ZodObject<typeof mergeRequestFields>> & { workspaceId: string; prNumber: number };
