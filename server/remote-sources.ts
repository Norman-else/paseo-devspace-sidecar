import { readPrivate, writePrivate } from "./cleanup-store";
import { z } from "zod";
import { workspaceSchema, type BridgeRequest, type Workspace } from "../shared/diff";
import type { RemoteSource } from "./config";
import { remoteRequest } from "./bridge";

/** Route each workspace to the project host that actually owns it. */
export class RemoteSources {
  private routes = new Map<string, RemoteSource>();
  private conflicts = new Set<string>();
  private listing: Promise<Workspace[]> | null = null;
  private cleanupRoutes: Record<string, string>;
  constructor(private sources: RemoteSource[], private cleanupFile?: string) { this.cleanupRoutes = cleanupFile ? readPrivate(cleanupFile, {}) : {}; }
  private catalog() {
    if (this.listing) return this.listing;
    const load = async () => {
      const results = await Promise.allSettled(this.sources.map(async (source) => ({ source, workspaces: z.array(workspaceSchema).parse(await remoteRequest(source, { op: "catalog" }, 4000)) })));
      const available = results.filter((result) => result.status === "fulfilled");
      if (!available.length) throw new Error("Cannot reach the project host's diff bridge. Check its Paseo plugin and private tunnel.");
      const workspaces = new Map<string, Workspace>(), routes = new Map<string, RemoteSource>(), conflicts = new Set<string>();
      for (const result of available) {
        for (const workspace of result.value.workspaces) {
          if (routes.has(workspace.id)) conflicts.add(workspace.id);
          workspaces.set(workspace.id, workspace); routes.set(workspace.id, result.value.source);
        }
      }
      for (const id of conflicts) workspaces.delete(id);
      this.routes = routes; this.conflicts = conflicts;
      return [...workspaces.values()];
    };
    this.listing = load().finally(() => { this.listing = null; });
    return this.listing;
  }
  async request(input: BridgeRequest): Promise<unknown> {
    if (input.op === "catalog") return this.catalog();
    const pinned = input.op.startsWith("cleanup-") ? this.cleanupRoutes[input.workspaceId] : undefined;
    if (pinned) { const source = this.sources.find(s => s.endpoint === pinned); if (!source) throw new Error("The original cleanup source is no longer configured."); return remoteRequest(source, input); }
    if (!this.routes.has(input.workspaceId)) await this.catalog();
    if (this.conflicts.has(input.workspaceId)) throw new Error("The workspace ID exists on multiple project hosts. Resolve the duplicate before reviewing changes.");
    const source = this.routes.get(input.workspaceId);
    if (!source) throw new Error("This session's DevSpace workspace is no longer available.");
    const value = await remoteRequest(source, input);
    if (input.op === "cleanup-preview") { this.cleanupRoutes[input.workspaceId] = source.endpoint; if (this.cleanupFile) writePrivate(this.cleanupFile, this.cleanupRoutes); }
    return value;
  }
}
