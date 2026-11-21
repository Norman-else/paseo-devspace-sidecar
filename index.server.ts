import { CleanupCoordinator } from "./server/cleanup-coordinator";
import { cleanupRequest } from "./server/cleanup-client";
import { cleanupPreviewRpc, cleanupExecuteRpc, cleanupStatusRpc, cleanupReceiptRpc } from "./shared/cleanup";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { z } from "zod";
import { gitStatusSchema } from "./shared/git-actions";
import { fileListSchema, fileReadRpc, fileReadSchema, fileWriteResultSchema, fileWriteRpc, filesListRpc } from "./shared/files";
import { catalogRpc, gitStatusRpc, devspaceWorkspaceIds, fileRpc, fileResultSchema, pullRequestRpc, reviewRpc, reviewSchema, snapshotRpc, snapshotSchema, rankedWorkspaces, sessionWorkspaces, workspaceSchema, workspaceInspectionSchema, type BridgeRequest } from "./shared/diff";
import { pullRequestResultSchema } from "./shared/pull-request";
import { loadConfig, configDirectory } from "./server/config";
import { join } from "node:path";
import { startBridge } from "./server/bridge";
import { LocalDiff } from "./server/git";
import { RemoteSources } from "./server/remote-sources";
import { mergeOptionsRpc, mergePrRpc, mergeStatusRpc, threadsRpc, checkDetailRpc, contextRpc, checkpointRpc } from "./shared/diff";

export default function contribute(server: PluginServerContext) {
  const ready = loadConfig().then(async (config) => {
    if (config.mode === "remote") {
      const sources = new RemoteSources([config, ...config.additionalSources], join(configDirectory, "cleanup-routes.json"));
      return { request: (input: BridgeRequest) => sources.request(input), close: () => {} };
    }
    const local = new LocalDiff(config.databasePath, join(configDirectory, "reviews"), { cleanup: input => cleanupRequest(config, input) });
    const bridge = await startBridge(config, local);
    return {
      request: (input: BridgeRequest) => local.dispatch(input),
      close: () => new Promise<void>((resolve) => { bridge.closeAllConnections(); bridge.close(() => resolve()); }),
    };
  });
  void ready.catch((error) => console.error("DevSpace Diff startup failed:", error instanceof Error ? error.message : "Unknown error"));
  const cleanup = new CleanupCoordinator(join(configDirectory, "cleanup-jobs.json"), async input => (await ready).request(input));
  server.handle(cleanupReceiptRpc, async (input, { paseo }) => ({ cleanup: await cleanup.workspaceReceipt(input.paseoWorkspaceId, paseo) }));
  server.handle(cleanupPreviewRpc, (input, { paseo }) => cleanup.preview(input, paseo));
  server.handle(cleanupExecuteRpc, (input, { paseo }) => cleanup.execute(input, paseo));
  server.handle(cleanupStatusRpc, (input, { paseo }) => cleanup.status(input.requestId, paseo, input.retryArchive));
  server.addHook("agent.open.before", async ({ request }) => { cleanup.assertCanOpen(request.agentId, request.purpose); return request; });
  server.addHook("agent.turn.after", async ({ agent }, { paseo }) => { try { await cleanup.observe(paseo, agent.id, agent.parentAgentId); } catch (error) { console.error("Cleanup association could not be updated:", error instanceof Error ? error.message : "unknown"); } });
  server.handle(catalogRpc, async ({ agentId, pinnedWorkspaceId }, { paseo }) => {
    const receipt = cleanup.receipt(agentId);
    if (receipt && ["cleaning", "archive_pending", "done", "unknown"].includes(receipt.phase)) return { workspace: null, cleanup: receipt };
    let timeline;
    try { timeline = await paseo.agents.ref(agentId).timeline.refetch({ limit: 200 }); }
    catch { return { workspace: null, inferenceError: "Unable to read this session. Refresh and try again." }; }
    if (timeline.error) return { workspace: null, inferenceError: "Unable to read this session. Refresh and try again." };
    if (!devspaceWorkspaceIds(timeline).length) return { workspace: null };
    const workspaces = z.array(workspaceSchema).parse(await (await ready).request({ op: "catalog" }));
    const candidates = sessionWorkspaces(timeline, workspaces);
    const ranked = rankedWorkspaces(timeline, workspaces, pinnedWorkspaceId);
    if (!ranked.length) return { workspace: null, candidates, emptyReason: "missing" as const };
    // A stale registration (folder deleted, not a Git root) must not hide the next usable workspace.
    let firstReason: z.infer<typeof workspaceInspectionSchema> | null = null;
    for (const candidate of ranked.slice(0, 4)) {
      const inspection = workspaceInspectionSchema.parse(await (await ready).request({ op: "inspect", workspaceId: candidate.id }));
      if (inspection.status === "ready") return { workspace: inspection.workspace, candidates, pinned: candidate.id === pinnedWorkspaceId };
      firstReason ??= inspection;
    }
    return { workspace: null, candidates, pinned: false, emptyReason: firstReason?.status === "empty" ? firstReason.reason : "missing" as const };
  });
  server.handle(snapshotRpc, async (input) => snapshotSchema.parse(await (await ready).request({ op: "snapshot", ...input })));
  server.handle(fileRpc, async (input) => fileResultSchema.parse(await (await ready).request({ op: "file", ...input })));
  server.handle(reviewRpc, async (input) => reviewSchema.parse(await (await ready).request({ op: "review", ...input })));
  server.handle(filesListRpc, async (input) => fileListSchema.parse(await (await ready).request({ op: "files-list", ...input })));
  server.handle(fileReadRpc, async (input) => fileReadSchema.parse(await (await ready).request({ op: "files-read", ...input })));
  server.handle(fileWriteRpc, async (input) => fileWriteResultSchema.parse(await (await ready).request({ op: "files-write", ...input })));
  server.handle(gitStatusRpc, async (input) => gitStatusSchema.parse(await (await ready).request({ op: "git-status", ...input })));
  server.handle(pullRequestRpc, async (input) => pullRequestResultSchema.parse(await (await ready).request({ op: "pull-requests", ...input })));
  server.handle(mergeOptionsRpc, async (input) => mergeOptionsRpc.output.parse(await (await ready).request({ op: "merge-options", ...input })));
  server.handle(mergePrRpc, async (input) => mergePrRpc.output.parse(await (await ready).request({ op: "merge-pr", ...input })));
  server.handle(mergeStatusRpc, async (input) => mergeStatusRpc.output.parse(await (await ready).request({ op: "merge-status", ...input })));
  server.handle(threadsRpc, async (input) => threadsRpc.output.parse(await (await ready).request({ op: "threads", ...input })));
  server.handle(checkDetailRpc, async (input) => checkDetailRpc.output.parse(await (await ready).request({ op: "check-detail", ...input })));
  server.handle(contextRpc, async (input) => contextRpc.output.parse(await (await ready).request({ op: "context", ...input })));
  server.handle(checkpointRpc, async (input) => checkpointRpc.output.parse(await (await ready).request({ op: "checkpoint", ...input })));
  return async () => { cleanup.close(); try { await (await ready).close(); } catch { /* startup failure already reported */ } };
}
