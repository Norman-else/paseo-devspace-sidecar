import type { PluginServerContext } from "@getpaseo/plugin/server";
import { z } from "zod";
import { catalogRpc, devspaceWorkspaceIds, fileRpc, fileResultSchema, pullRequestRpc, reviewRpc, reviewSchema, snapshotRpc, snapshotSchema, suggestedWorkspace, workspaceSchema, workspaceInspectionSchema, type BridgeRequest } from "./shared/diff";
import { pullRequestResultSchema } from "./shared/pull-request";
import { loadConfig, configDirectory } from "./server/config";
import { join } from "node:path";
import { startBridge } from "./server/bridge";
import { LocalDiff } from "./server/git";
import { RemoteSources } from "./server/remote-sources";
import { threadsRpc, checkDetailRpc, contextRpc, checkpointRpc } from "./shared/diff";

export default function contribute(server: PluginServerContext) {
  const ready = loadConfig().then(async (config) => {
    if (config.mode === "remote") {
      const sources = new RemoteSources([config, ...config.additionalSources]);
      return { request: (input: BridgeRequest) => sources.request(input), close: () => {} };
    }
    const local = new LocalDiff(config.databasePath, join(configDirectory, "reviews"));
    const bridge = await startBridge(config, local);
    return {
      request: (input: BridgeRequest) => local.dispatch(input),
      close: () => new Promise<void>((resolve) => { bridge.closeAllConnections(); bridge.close(() => resolve()); }),
    };
  });
  void ready.catch((error) => console.error("DevSpace Diff startup failed:", error instanceof Error ? error.message : "Unknown error"));
  server.handle(catalogRpc, async ({ agentId }, { paseo }) => {
    let timeline;
    try { timeline = await paseo.agents.ref(agentId).timeline.refetch({ limit: 200 }); }
    catch { return { workspace: null, inferenceError: "Unable to read this session. Refresh and try again." }; }
    if (timeline.error) return { workspace: null, inferenceError: "Unable to read this session. Refresh and try again." };
    if (!devspaceWorkspaceIds(timeline).length) return { workspace: null };
    const workspaces = z.array(workspaceSchema).parse(await (await ready).request({ op: "catalog" }));
    const id = suggestedWorkspace(timeline, workspaces);
    if (!id) return { workspace: null, emptyReason: "missing" as const };
    const inspection = workspaceInspectionSchema.parse(await (await ready).request({ op: "inspect", workspaceId: id }));
    return inspection.status === "ready" ? { workspace: inspection.workspace } : { workspace: null, emptyReason: inspection.reason };
  });
  server.handle(snapshotRpc, async (input) => snapshotSchema.parse(await (await ready).request({ op: "snapshot", ...input })));
  server.handle(fileRpc, async (input) => fileResultSchema.parse(await (await ready).request({ op: "file", ...input })));
  server.handle(reviewRpc, async (input) => reviewSchema.parse(await (await ready).request({ op: "review", ...input })));
  server.handle(pullRequestRpc, async (input) => pullRequestResultSchema.parse(await (await ready).request({ op: "pull-requests", ...input })));
  server.handle(threadsRpc, async (input) => threadsRpc.output.parse(await (await ready).request({ op: "threads", ...input })));
  server.handle(checkDetailRpc, async (input) => checkDetailRpc.output.parse(await (await ready).request({ op: "check-detail", ...input })));
  server.handle(contextRpc, async (input) => contextRpc.output.parse(await (await ready).request({ op: "context", ...input })));
  server.handle(checkpointRpc, async (input) => checkpointRpc.output.parse(await (await ready).request({ op: "checkpoint", ...input })));
  return async () => { try { await (await ready).close(); } catch { /* startup failure already reported */ } };
}
