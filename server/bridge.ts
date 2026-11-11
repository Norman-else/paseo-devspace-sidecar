import { createHash, timingSafeEqual } from "node:crypto";
import { createServer, type Server } from "node:http";
import { URL } from "node:url";
import { bridgeRequest, type BridgeRequest } from "../shared/diff";
import type { Config } from "./config";
import { LocalDiff } from "./git";

export async function startBridge(config: Extract<Config, { mode: "local" }>, local: LocalDiff): Promise<Server> {
  const expected = createHash("sha256").update(`Bearer ${config.token}`).digest();
  const server = createServer(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Type", "application/json");
    const respond = (status: number, value: unknown) => { res.statusCode = status; res.end(JSON.stringify(value)); };
    const actual = createHash("sha256").update(req.headers.authorization ?? "").digest();
    if (req.headers.origin || !timingSafeEqual(actual, expected)) return respond(401, { error: "Unauthorized sidecar request." });
    if (req.method !== "POST" || req.url !== "/rpc") return respond(404, { error: "Not found." });
    try {
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 16384) { respond(413, { error: "Request too large." }); req.destroy(); return; }
        chunks.push(Buffer.from(chunk));
      }
      const input = bridgeRequest.safeParse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      if (!input.success) return respond(400, { error: "Invalid sidecar request." });
      respond(200, await local.dispatch(input.data));
    } catch (error) {
      respond(500, { error: error instanceof Error ? error.message : "Unable to read changes." });
    }
  });
  server.requestTimeout = 30000;
  server.headersTimeout = 10000;
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(config.port, "127.0.0.1", resolve); });
  console.log(`DevSpace Diff bridge listening on 127.0.0.1:${config.port}`);
  return server;
}

export async function remoteRequest(config: Extract<Config, { mode: "remote" }>, input: BridgeRequest): Promise<unknown> {
  const url = new URL(config.endpoint);
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || url.username || url.password || url.search || url.hash) {
    throw new Error("The sidecar endpoint must be a loopback HTTP address reached through the private tunnel.");
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(new URL("/rpc", url).toString(), {
      method: "POST", redirect: "error", signal: controller.signal,
      headers: { Authorization: `Bearer ${config.token}`, "Content-Type": "application/json" }, body: JSON.stringify(input),
    });
    const value = await response.json() as { error?: string };
    if (!response.ok) throw new Error(value.error ?? `Sidecar request failed (${response.status}).`);
    return value;
  } catch (error) {
    if (error instanceof TypeError || (error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name))) {
      throw new Error("Cannot reach the Mac diff bridge. Check that the Mac Paseo plugin and the private tunnel are running.");
    }
    throw error;
  } finally { clearTimeout(timeout); }
}
