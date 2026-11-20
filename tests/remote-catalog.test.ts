import test from "node:test";
import assert from "node:assert/strict";
import { RemoteSources } from "../server/remote-sources.ts";

test("a failed catalog round trip falls back to the last good catalog instead of erroring", async () => {
  const original = globalThis.fetch;
  const workspace = { id: "ws_a", root: "/r/a", sourceRoot: null, mode: "worktree", baseSha: null, branch: "b", lastUsedAt: "2026-01-01" };
  let fail = false;
  globalThis.fetch = (async () => {
    if (fail) throw new TypeError("fetch failed");
    return new Response(JSON.stringify([workspace]), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  try {
    const sources = new RemoteSources([{ endpoint: "http://127.0.0.1:7676/__paseo-devspace/rpc", token: "x".repeat(32) }]);
    assert.equal((await sources.request({ op: "catalog" }) as unknown[]).length, 1);
    fail = true;
    assert.deepEqual((await sources.request({ op: "catalog" }) as { id: string }[]).map((w) => w.id), ["ws_a"]);
    const cold = new RemoteSources([{ endpoint: "http://127.0.0.1:7676/__paseo-devspace/rpc", token: "x".repeat(32) }]);
    await assert.rejects(() => cold.request({ op: "catalog" }), /Cannot reach/);
  } finally { globalThis.fetch = original; }
});
