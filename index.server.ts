import type { PluginServerContext } from "@getpaseo/plugin/server";
import { z } from "zod";
import { catalogRpc, devspaceWorkspaceIds, fileRpc, fileResultSchema, reviewRpc, reviewSchema, snapshotRpc, snapshotSchema, suggestedWorkspace, workspaceSchema, type BridgeRequest } from "./shared/diff";
import { loadConfig } from "./server/config";
import { remoteRequest, startBridge } from "./server/bridge";
import { LocalDiff } from "./server/git";

export default function contribute(server: PluginServerContext) {
  const ready = loadConfig().then(async (config) => {
    if (config.mode === "remote") return { request: (input: BridgeRequest) => remoteRequest(config, input), close: () => {} };
    const local = new LocalDiff(config.databasePath);
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
    return { workspace: workspaces.find((w) => w.id === id) ?? null,
      ...(!id ? { inferenceError: "This session's DevSpace workspace is no longer available." } : {}),
    };
  });
  server.handle(snapshotRpc, async (input) => snapshotSchema.parse(await (await ready).request({ op: "snapshot", ...input })));
  server.handle(fileRpc, async (input) => fileResultSchema.parse(await (await ready).request({ op: "file", ...input })));
  server.handle(reviewRpc, async (input) => reviewSchema.parse(await (await ready).request({ op: "review", ...input })));
  return async () => { try { await (await ready).close(); } catch { /* startup failure already reported */ } };
}
