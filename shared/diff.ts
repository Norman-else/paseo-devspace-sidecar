import { cleanupResultSchema, sourcePreviewRequest, sourceExecuteRequest, sourceStatusRequest } from "./cleanup";
import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
import { mergeOptionsSchema, mergeOutcomeSchema, mergeRequestFields } from "./pr-merge";
import { pullRequestResultSchema } from "./pull-request";
import { gitStatusSchema } from "./git-actions";
import { fileWriteRequestSchema } from "./files";
import { reviewOptions, discussionSchema, checkDetailSchema, contextSchema, checkpointSchema } from "./review-details";

export const workspaceId = z.string().regex(/^ws_[a-zA-Z0-9_-]+$/);
export const comparison = z.enum(["task", "uncommitted", "pr", "local"]);
export const workspaceSchema = z.object({
  id: workspaceId, root: z.string(), sourceRoot: z.string().nullable(), mode: z.string(),
  baseSha: z.string().nullable(), branch: z.string().nullable(), lastUsedAt: z.string(),
  // True for linked git worktrees (DevSpace `mode: worktree`, `.claude/worktrees/*`, or any checkout whose `.git` is a file).
  // Optional so older remote sidecars without the field still parse.
  worktree: z.boolean().optional(),
  // The registration is still active in DevSpace but its folder was removed (for example `git worktree remove`).
  missing: z.boolean().optional(),
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
  name: "diff.catalog", input: z.object({ agentId: z.string().min(1), pinnedWorkspaceId: workspaceId.optional() }),
  output: z.object({ workspace: workspaceSchema.nullable(), candidates: z.array(workspaceSchema).default([]), pinned: z.boolean().default(false), emptyReason: workspaceEmptyReason.optional(), inferenceError: z.string().optional(), cleanup: cleanupResultSchema.optional() }),
});
export const snapshotRpc = defineRpc({
  name: "diff.snapshot", input: z.object({ workspaceId, comparison, ...reviewOptions }), output: snapshotSchema,
});
export const fileRpc = defineRpc({
  name: "diff.file", input: z.object({ workspaceId, comparison, path: z.string().min(1), ...reviewOptions }), output: fileResultSchema,
});
export const reviewRpc = defineRpc({ name: "diff.review", input: z.object({ workspaceId, comparison, ...reviewOptions }), output: reviewSchema });
export const gitStatusRpc = defineRpc({ name: "git.status", input: z.object({ workspaceId }), output: gitStatusSchema });
export const pullRequestRpc = defineRpc({ name: "github.pull-requests", input: z.object({ workspaceId }), output: pullRequestResultSchema });
export const mergeOptionsRpc = defineRpc({ name: "github.merge-options", input: z.object({ workspaceId, prNumber: z.number().int().positive() }), output: mergeOptionsSchema });
export const mergePrRpc = defineRpc({ name: "github.merge-pr", input: z.object({ workspaceId, prNumber: z.number().int().positive(), ...mergeRequestFields }), output: mergeOutcomeSchema });
export const mergeStatusRpc = defineRpc({ name: "github.merge-status", input: z.object({ workspaceId, prNumber: z.number().int().positive(), requestId: mergeRequestFields.requestId }), output: mergeOutcomeSchema });
export const threadsRpc = defineRpc({ name: "github.discussions", input: z.object({ workspaceId, prNumber: z.number().int().positive() }), output: discussionSchema });
export const checkDetailRpc = defineRpc({ name: "github.check-detail", input: z.object({ workspaceId, prNumber: z.number().int().positive(), name: z.string().max(500), url: z.string().url().nullable() }), output: checkDetailSchema });
export const contextRpc = defineRpc({ name: "diff.context", input: z.object({ workspaceId, comparison, ...reviewOptions, path: z.string().min(1), side: z.enum(["old", "new"]), start: z.number().int().min(1), count: z.number().int().min(1).max(200), revision: z.string() }), output: contextSchema });
export const checkpointRpc = defineRpc({ name: "diff.checkpoint", input: z.object({ workspaceId, comparison, prNumber: z.number().int().positive().optional(), agentId: z.string().min(1).max(200) }), output: checkpointSchema });
// Review reads stay local. Merge and worktree removal each require their explicit write operation.
export const bridgeRequest = z.discriminatedUnion("op", [
  sourcePreviewRequest, sourceExecuteRequest, sourceStatusRequest,
  z.object({ op: z.literal("catalog") }),
  z.object({ op: z.literal("inspect"), workspaceId }),
  z.object({ op: z.literal("snapshot"), workspaceId, comparison, ...reviewOptions }),
  z.object({ op: z.literal("review"), workspaceId, comparison, ...reviewOptions }),
  z.object({ op: z.literal("pull-requests"), workspaceId }),
  z.object({ op: z.literal("git-status"), workspaceId }),
  z.object({ op: z.literal("files-list"), workspaceId, path: z.string().max(4096) }),
  z.object({ op: z.literal("files-read"), workspaceId, path: z.string().max(4096) }),
  fileWriteRequestSchema.extend({ op: z.literal("files-write"), workspaceId }),
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

export type DevspaceTarget = { id: string; path?: string };
/** Leading `cd /abs/path &&` in a DevSpace command: agents often pass one workspace_id and work in another repo. */
export function commandDirectory(command: unknown): string | undefined {
  if (typeof command !== "string") return undefined;
  const match = /^\s*cd\s+(?:"([^"]+)"|'([^']+)'|([^\s;&|]+))\s*(?:&&|;|\n|$)/.exec(command);
  const path = match?.[1] ?? match?.[2] ?? match?.[3];
  return path && /^(\/|[A-Za-z]:[\\/])/.test(path) ? path.replace(/[\\/]+$/, "") : undefined;
}
/** Only successful DevSpace tool calls may suggest a binding; ordinary prose is not authoritative. */
export function devspaceTargets(timeline: unknown): DevspaceTarget[] {
  const candidates: DevspaceTarget[] = [];
  function visit(value: unknown) {
    if (!value || typeof value !== "object") return;
    const item = value as Record<string, unknown>;
    const name = String(item.name ?? item.toolName ?? item.tool_name ?? "");
    if (item.type === "tool_call") {
      if (!/devspace/i.test(name) || item.status && item.status !== "completed" && item.status !== "succeeded" || item.isError) return;
      const detail = item.detail as Record<string, unknown> | undefined;
      const input = detail?.input ?? item.input ?? item.arguments;
      const ids = workspaceFields(input);
      const path = commandDirectory(input && typeof input === "object" ? (input as Record<string, unknown>).command : undefined);
      // Commands can mention other workspaces. Their explicit target wins over any output or prose.
      if (ids.length) candidates.push(...ids.map((id) => path ? { id, path } : { id }));
      else if (/open_workspace$/.test(name)) candidates.push(...workspaceFields(detail?.output ?? item.result).map((id) => ({ id })));
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
export function devspaceWorkspaceIds(timeline: unknown): string[] { return devspaceTargets(timeline).map((target) => target.id); }
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
const worktreePath = /[\\/]\.(devspace|claude)[\\/]worktrees[\\/]/;
export function isWorktree(workspace: Pick<Workspace, "root" | "mode" | "worktree">): boolean {
  return workspace.worktree ?? (workspace.mode === "worktree" || worktreePath.test(workspace.root ?? ""));
}
const within = (root: string, path: string) => { const base = root.replace(/[\\/]+$/, ""); return path === base || path.startsWith(base + "/") || path.startsWith(base + "\\"); };
/** The registered workspace a `cd` target belongs to: the deepest root containing it, most recently used on ties. */
function workspaceForPath(path: string, workspaces: Workspace[]) {
  let best: Workspace | undefined;
  for (const workspace of workspaces) {
    if (workspace.missing || !within(workspace.root, path)) continue;
    if (!best || workspace.root.length > best.root.length || workspace.root.length === best.root.length && workspace.lastUsedAt > best.lastUsedAt) best = workspace;
  }
  return best;
}
/**
 * Workspaces this session used through DevSpace, most recently used first. A command that starts with `cd` into
 * another registered workspace counts for that workspace. Registrations whose folder is gone are skipped.
 */
export function sessionWorkspaces(timeline: unknown, workspaces: Workspace[]): Workspace[] {
  const byId = new Map(workspaces.map((w) => [w.id, w]));
  const seen = new Set<string>(), result: Workspace[] = [];
  for (const target of devspaceTargets(timeline).reverse()) {
    const workspace = (target.path ? workspaceForPath(target.path, workspaces) : undefined) ?? byId.get(target.id);
    if (workspace && !workspace.missing && !seen.has(workspace.id)) { seen.add(workspace.id); result.push(workspace); }
  }
  return result;
}
/** Binding preference: the pin, then worktrees, then checkouts, each most recent first. */
export function rankedWorkspaces(timeline: unknown, workspaces: Workspace[], pinned?: string): Workspace[] {
  const used = sessionWorkspaces(timeline, workspaces);
  const pin = used.filter((w) => w.id === pinned);
  return [...pin, ...used.filter((w) => w.id !== pinned && isWorktree(w)), ...used.filter((w) => w.id !== pinned && !isWorktree(w))];
}
/**
 * The session's latest worktree wins over checkouts, so reading or writing the main checkout after
 * committing in a worktree does not move the review away from the PR. Without any worktree, the
 * latest checkout is used. A pinned workspace wins while the session still uses it.
 */
export function suggestedWorkspace(timeline: unknown, workspaces: Workspace[], pinned?: string): string | null {
  return rankedWorkspaces(timeline, workspaces, pinned)[0]?.id ?? null;
}
