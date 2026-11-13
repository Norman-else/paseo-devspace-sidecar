import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
import { mergeOptionsSchema, mergeOutcomeSchema, mergeRequestFields } from "./pr-merge";
import { pullRequestResultSchema } from "./pull-request";
import { reviewOptions, discussionSchema, checkDetailSchema, contextSchema, checkpointSchema } from "./review-details";

export const workspaceId = z.string().regex(/^ws_[a-zA-Z0-9_-]+$/);
export const comparison = z.enum(["task", "uncommitted", "pr", "local"]);
export const workspaceSchema = z.object({
  id: workspaceId, root: z.string(), sourceRoot: z.string().nullable(), mode: z.string(),
  baseSha: z.string().nullable(), branch: z.string().nullable(), lastUsedAt: z.string(),
});
export type Workspace = z.infer<typeof workspaceSchema>;
export const workspaceEmptyReason = z.enum(["not_git", "missing", "no_commits", "not_root"]);
export type WorkspaceEmptyReason = z.infer<typeof workspaceEmptyReason>;
export const workspaceInspectionSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("ready"), workspace: workspaceSchema }),
  z.object({ status: z.literal("empty"), reason: workspaceEmptyReason }),
]);
export const workspaceEmptyMessages: Record<WorkspaceEmptyReason, string> = {
  not_git: "This DevSpace folder is not a Git repository.",
  missing: "This DevSpace folder is no longer available.",
  no_commits: "This Git repository has no commits yet.",
  not_root: "This DevSpace folder is not the root of a Git repository.",
};
export function workspaceEmptyError(error: unknown): WorkspaceEmptyReason | undefined {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  return (Object.keys(workspaceEmptyMessages) as WorkspaceEmptyReason[]).find((reason) => message.includes(workspaceEmptyMessages[reason]));
}
export const fileSchema = z.object({
  path: z.string(), oldPath: z.string().optional(), status: z.string(),
  additions: z.number().nullable(), deletions: z.number().nullable(), binary: z.boolean(),
});
export type ChangedFile = z.infer<typeof fileSchema>;
export const snapshotSchema = z.object({
  workspace: workspaceSchema, comparison, ref: z.string(), revision: z.string(),
  files: z.array(fileSchema), totalFiles: z.number(), capturedAt: z.string(),
  headSha: z.string().optional(), repository: z.string().optional(), checkpoint: checkpointSchema.optional(),
  prNumber: z.number().int().optional(),
});
export type Snapshot = z.infer<typeof snapshotSchema>;
export const fileResultSchema = z.object({ patch: z.string(), notice: z.string().optional() });
export const reviewFileSchema = fileSchema.extend({ patch: z.string(), hash: z.string(), notice: z.string().optional(), deferred: z.boolean().optional() });
export type ReviewFile = z.infer<typeof reviewFileSchema>;
export const reviewSchema = z.object({ snapshot: snapshotSchema, files: z.array(reviewFileSchema) });
export type Review = z.infer<typeof reviewSchema>;
export const catalogRpc = defineRpc({
  name: "diff.catalog", input: z.object({ agentId: z.string().min(1) }),
  output: z.object({ workspace: workspaceSchema.nullable(), emptyReason: workspaceEmptyReason.optional(), inferenceError: z.string().optional() }),
});
export const snapshotRpc = defineRpc({
  name: "diff.snapshot", input: z.object({ workspaceId, comparison, ...reviewOptions }), output: snapshotSchema,
});
export const fileRpc = defineRpc({
  name: "diff.file", input: z.object({ workspaceId, comparison, path: z.string().min(1), ...reviewOptions }), output: fileResultSchema,
});
export const reviewRpc = defineRpc({ name: "diff.review", input: z.object({ workspaceId, comparison, ...reviewOptions }), output: reviewSchema });
export const pullRequestRpc = defineRpc({ name: "github.pull-requests", input: z.object({ workspaceId }), output: pullRequestResultSchema });
export const mergeOptionsRpc = defineRpc({ name: "github.merge-options", input: z.object({ workspaceId, prNumber: z.number().int().positive() }), output: mergeOptionsSchema });
export const mergePrRpc = defineRpc({ name: "github.merge-pr", input: z.object({ workspaceId, prNumber: z.number().int().positive(), ...mergeRequestFields }), output: mergeOutcomeSchema });
export const mergeStatusRpc = defineRpc({ name: "github.merge-status", input: z.object({ workspaceId, prNumber: z.number().int().positive(), requestId: mergeRequestFields.requestId }), output: mergeOutcomeSchema });
export const threadsRpc = defineRpc({ name: "github.discussions", input: z.object({ workspaceId, prNumber: z.number().int().positive() }), output: discussionSchema });
export const checkDetailRpc = defineRpc({ name: "github.check-detail", input: z.object({ workspaceId, prNumber: z.number().int().positive(), name: z.string().max(500), url: z.string().url().nullable() }), output: checkDetailSchema });
export const contextRpc = defineRpc({ name: "diff.context", input: z.object({ workspaceId, comparison, ...reviewOptions, path: z.string().min(1), side: z.enum(["old", "new"]), start: z.number().int().min(1), count: z.number().int().min(1).max(200), revision: z.string() }), output: contextSchema });
export const checkpointRpc = defineRpc({ name: "diff.checkpoint", input: z.object({ workspaceId, comparison, prNumber: z.number().int().positive().optional(), agentId: z.string().min(1).max(200) }), output: checkpointSchema });
// Git reads stay local and read-only; GitHub merge writes require an explicit merge-pr request.
export const bridgeRequest = z.discriminatedUnion("op", [
  z.object({ op: z.literal("catalog") }),
  z.object({ op: z.literal("inspect"), workspaceId }),
  z.object({ op: z.literal("snapshot"), workspaceId, comparison, ...reviewOptions }),
  z.object({ op: z.literal("review"), workspaceId, comparison, ...reviewOptions }),
  z.object({ op: z.literal("pull-requests"), workspaceId }),
  z.object({ op: z.literal("file"), workspaceId, comparison, path: z.string().min(1), ...reviewOptions }),
  mergeOptionsRpc.input.extend({ op: z.literal("merge-options") }),
  mergePrRpc.input.extend({ op: z.literal("merge-pr") }),
  mergeStatusRpc.input.extend({ op: z.literal("merge-status") }),
  contextRpc.input.extend({ op: z.literal("context") }),
  threadsRpc.input.extend({ op: z.literal("threads") }),
  checkDetailRpc.input.extend({ op: z.literal("check-detail") }),
  checkpointRpc.input.extend({ op: z.literal("checkpoint") }),
]);
export type BridgeRequest = z.infer<typeof bridgeRequest>;

export type DiffLine = { kind: "meta" | "hunk" | "add" | "remove" | "context"; text: string; old?: number; next?: number };
export function diffLines(patch: string): DiffLine[] {
  let old = 0, next = 0, inHunk = false;
  return patch.replace(/\n$/, "").split("\n").map((text) => {
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(text);
    if (hunk) { old = Number(hunk[1]); next = Number(hunk[2]); inHunk = true; return { kind: "hunk", text }; }
    if (!inHunk || text.startsWith("\\")) return { kind: "meta", text };
    if (text.startsWith("+")) return { kind: "add", text, next: next++ };
    if (text.startsWith("-")) return { kind: "remove", text, old: old++ };
    if (text.startsWith(" ")) return { kind: "context", text, old: old++, next: next++ };
    inHunk = false;
    return { kind: "meta", text };
  });
}

/** Only successful DevSpace tool calls may suggest a binding; ordinary prose is not authoritative. */
export function devspaceWorkspaceIds(timeline: unknown): string[] {
  const candidates: string[] = [];
  function visit(value: unknown) {
    if (!value || typeof value !== "object") return;
    const item = value as Record<string, unknown>;
    const name = String(item.name ?? item.toolName ?? item.tool_name ?? "");
    if (item.type === "tool_call") {
      if (!/devspace/i.test(name) || item.status && item.status !== "completed" && item.status !== "succeeded" || item.isError) return;
      const detail = item.detail as Record<string, unknown> | undefined;
      const input = detail?.input ?? item.input ?? item.arguments;
      const ids = workspaceFields(input);
      // Commands can mention other workspaces. Their explicit target wins over any output or prose.
      if (ids.length) candidates.push(...ids);
      else if (/open_workspace$/.test(name)) candidates.push(...workspaceFields(detail?.output ?? item.result));
      return;
    }
    for (const nested of Object.values(item)) {
      if (Array.isArray(nested)) nested.forEach(visit);
      else if (nested && typeof nested === "object") visit(nested);
    }
  }
  visit(timeline);
  return candidates;
}
function workspaceFields(value: unknown): string[] {
  if (typeof value === "string") {
    try { return workspaceFields(JSON.parse(value)); }
    catch { return [...value.matchAll(/\bworkspace_id["']?\s*[:=]\s*["']?(ws_[a-zA-Z0-9_-]+)/g)].map((m) => m[1]); }
  }
  if (!value || typeof value !== "object") return [];
  const object = value as Record<string, unknown>;
  const target = object.workspace_id ?? object.workspaceId;
  if (typeof target === "string" && /^ws_[a-zA-Z0-9_-]+$/.test(target)) return [target];
  return Object.values(object).flatMap(workspaceFields);
}
export function suggestedWorkspace(timeline: unknown, workspaces: Workspace[]): string | null {
  const allowed = new Set(workspaces.map((w) => w.id));
  const latest = devspaceWorkspaceIds(timeline).at(-1);
  return latest && allowed.has(latest) ? latest : null;
}
