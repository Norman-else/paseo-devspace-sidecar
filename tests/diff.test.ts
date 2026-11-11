import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rename, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { promisify } from "node:util";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { LocalDiff } from "../server/git.ts";
import { remoteRequest, startBridge } from "../server/bridge.ts";
import { diffLines, suggestedWorkspace, type Workspace } from "../shared/diff.ts";
import { reviewRows } from "../shared/review.ts";
import { codeTokens } from "../shared/syntax.ts";
import { en, zh } from "../shared/messages.ts";

const exec = promisify(execFile);
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "paseo-sidecar-test-"));
  const git = (...args: string[]) => exec("git", ["-C", root, ...args], { encoding: "utf8" });
  await git("init", "-b", "task");
  await git("config", "user.email", "test@example.invalid");
  await git("config", "user.name", "Test");
  await writeFile(join(root, "change.txt"), "one\ntwo\nthree\n");
  await writeFile(join(root, "delete.txt"), "deleted\n");
  await writeFile(join(root, "rename.txt"), "preserve\nthis\nrename\n");
  await writeFile(join(root, "binary.bin"), Buffer.from([0, 1, 2]));
  await git("add", "."); await git("commit", "-m", "base");
  const base = (await git("rev-parse", "HEAD")).stdout.trim();
  const dbPath = join(root, "registry.sqlite");
  const db = new DatabaseSync(dbPath);
  db.exec("CREATE TABLE workspace_sessions(id TEXT, root TEXT, source_root TEXT, mode TEXT, base_sha TEXT, last_used_at TEXT, status TEXT)");
  db.prepare("INSERT INTO workspace_sessions VALUES(?,?,?,?,?,?,?)").run("ws_test", root, root, "worktree", base, new Date().toISOString(), "active");
  db.close();
  // The test registry itself is not part of the checkout under test.
  await writeFile(join(root, ".git", "info", "exclude"), "registry.sqlite*\n");
  return { root, git, base, service: new LocalDiff(dbPath), cleanup: () => rm(root, { recursive: true, force: true }) };
}

test("reads staged, unstaged, deleted, renamed, untracked and binary files without changing Git's index", async () => {
  const f = await fixture();
  try {
    await writeFile(join(f.root, "change.txt"), "one\nstaged\nthree\n");
    await f.git("add", "change.txt");
    await writeFile(join(f.root, "change.txt"), "one\nstaged\nunstaged\n");
    await unlink(join(f.root, "delete.txt"));
    await rename(join(f.root, "rename.txt"), join(f.root, "renamed.txt"));
    await f.git("add", "rename.txt", "renamed.txt");
    const odd = "new\tfile\nwith space.txt";
    await writeFile(join(f.root, odd), "new line\n");
    await writeFile(join(f.root, "binary.bin"), Buffer.from([0, 3, 4]));
    const indexBefore = createHash("sha256").update(await readFile(join(f.root, ".git", "index"))).digest("hex");
    const snapshot = await f.service.snapshot("ws_test", "uncommitted");
    assert.equal(snapshot.files.find((x) => x.path === "renamed.txt")?.oldPath, "rename.txt");
    assert.equal(snapshot.files.find((x) => x.path === "delete.txt")?.status, "D");
    assert.equal(snapshot.files.find((x) => x.path === odd)?.status, "?");
    assert.equal(snapshot.files.find((x) => x.path === "binary.bin")?.binary, true);
    const patch = await f.service.file("ws_test", "uncommitted", "change.txt");
    assert.match(patch.patch, /\+staged/); assert.match(patch.patch, /\+unstaged/); assert.match(patch.patch, /-two/);
    assert.match((await f.service.file("ws_test", "uncommitted", odd)).patch, /\+new line/);
    assert.match((await f.service.file("ws_test", "uncommitted", "binary.bin")).notice!, /Binary/);
    const indexAfter = createHash("sha256").update(await readFile(join(f.root, ".git", "index"))).digest("hex");
    assert.equal(indexBefore, indexAfter);
    assert.equal(await f.git("rev-parse", "HEAD").then((r) => r.stdout.trim()), f.base);
  } finally { await f.cleanup(); }
});

test("task comparison survives commits and refresh detects same-count edits", async () => {
  const f = await fixture();
  try {
    await writeFile(join(f.root, "change.txt"), "one\ncommitted\nthree\n");
    await f.git("add", "change.txt"); await f.git("commit", "-m", "task work");
    assert.equal((await f.service.snapshot("ws_test", "uncommitted")).totalFiles, 0);
    assert.equal((await f.service.snapshot("ws_test", "task")).totalFiles, 1);
    await writeFile(join(f.root, "change.txt"), "one\nfirst\nthree\n");
    const first = await f.service.snapshot("ws_test", "task");
    await writeFile(join(f.root, "change.txt"), "one\nother\nthree\n");
    const second = await f.service.snapshot("ws_test", "task");
    assert.notEqual(first.revision, second.revision);
  } finally { await f.cleanup(); }
});

test("limits file access to registered workspaces and current changed paths; previews symlinks as links", async () => {
  const f = await fixture();
  try {
    await assert.rejects(() => f.service.snapshot("ws_unknown", "task"), /unavailable/);
    await assert.rejects(() => f.service.file("ws_test", "task", "../private"), /Invalid/);
    await assert.rejects(() => f.service.file("ws_test", "task", "/etc/passwd"), /Invalid/);
    await assert.rejects(() => f.service.file("ws_test", "task", "unchanged.txt"), /changed-file list/);
    await symlink("/etc/passwd", join(f.root, "link"));
    const link = await f.service.file("ws_test", "task", "link");
    assert.match(link.patch, /\+\/etc\/passwd/); assert.doesNotMatch(link.patch, /root:/);
    await writeFile(join(f.root, "large.txt"), "x".repeat(600000));
    assert.match((await f.service.file("ws_test", "task", "large.txt")).notice!, /limit/);
  } finally { await f.cleanup(); }
});

test("bridge authenticates, rejects browser origins, proxies Git results and reports offline connections", async () => {
  const f = await fixture();
  const token = "a".repeat(40);
  const bridge = await startBridge({ mode: "local", port: 0, databasePath: "unused", token }, f.service);
  try {
    const address = bridge.address(); assert.ok(address && typeof address !== "string");
    const endpoint = `http://127.0.0.1:${address.port}`;
    assert.equal((await fetch(endpoint + "/rpc", { method: "POST", body: "{}" })).status, 401);
    assert.equal((await fetch(endpoint + "/rpc", { method: "POST", headers: { Authorization: `Bearer ${token}`, Origin: "http://evil.invalid" }, body: "{}" })).status, 401);
    const catalog = await remoteRequest({ mode: "remote", endpoint, token }, { op: "catalog" }) as Workspace[];
    assert.equal(catalog[0].id, "ws_test");
    await assert.rejects(() => remoteRequest({ mode: "remote", endpoint: "https://example.com", token }, { op: "catalog" }), /loopback/);
    await assert.rejects(() => remoteRequest({ mode: "remote", endpoint, token: "wrong" }, { op: "catalog" }), /Unauthorized/);
    bridge.closeAllConnections();
    await new Promise<void>((resolve) => bridge.close(() => resolve()));
    await assert.rejects(() => remoteRequest({ mode: "remote", endpoint, token }, { op: "catalog" }), /Cannot reach/);
  } finally { bridge.closeAllConnections(); bridge.close(); await f.cleanup(); }
});

test("agent binding ignores prose and other agents' guessed names; unified lines preserve hunk numbers", () => {
  const workspaces = ["ws_checkout", "ws_task"].map((id) => ({ id, mode: id === "ws_task" ? "worktree" : "checkout" })) as Workspace[];
  assert.equal(suggestedWorkspace([{ type: "assistant_message", text: "ws_task" }], workspaces), null);
  assert.equal(suggestedWorkspace([{ type: "tool_call", name: "mcp__devspace__bash", status: "failed", input: { workspace_id: "ws_task" } }], workspaces), null);
  assert.equal(suggestedWorkspace([{ name: "paseo-devspace-sidecar", text: "ws_task" }], workspaces), null);
  assert.equal(suggestedWorkspace([{ type: "tool_call", name: "mcp__devspace__bash", detail: { input: { workspace_id: "ws_task", command: "echo ws_checkout" }, output: "ws_checkout" } }], workspaces), "ws_task");
  assert.equal(suggestedWorkspace([
    { type: "tool_call", name: "mcp__devspace__open_workspace", result: { workspace_id: "ws_checkout" } },
    { type: "tool_call", name: "mcp__devspace__bash", input: { workspace_id: "ws_task" } },
  ], workspaces), "ws_task");
  const rows = diffLines("--- a/a\n+++ b/a\n@@ -5,2 +8,2 @@\n-old\n+new\n same\n");
  assert.deepEqual(rows[3], { kind: "remove", text: "-old", old: 5 });
  assert.deepEqual(rows[4], { kind: "add", text: "+new", next: 8 });
  assert.deepEqual(rows[5], { kind: "context", text: " same", old: 6, next: 9 });
});

test("continuous review reads all file patches, preserves collapse anchors and invalidates same-count edits", async () => {
  const f = await fixture();
  try {
    await writeFile(join(f.root, "change.txt"), "one\nnew\nthree\n");
    await writeFile(join(f.root, "Added.java"), 'public class Added { String url = "https://example.invalid"; }\n');
    const review = await f.service.review("ws_test", "task");
    assert.equal(review.files.length, 2);
    assert.ok(review.files.every((file) => file.hash && file.patch));
    const doc = reviewRows(review.files, new Set());
    assert.equal(doc.headers.length, 2);
    for (const file of review.files) assert.equal(doc.rows[doc.fileIndices.get(file.path)!].path, file.path);
    assert.equal(doc.offsets[doc.rows.length - 1] + doc.rows.at(-1)!.height, doc.height);
    const folded = reviewRows(review.files, new Set(["Added.java"]));
    assert.equal(folded.headers.length, 2);
    assert.ok(folded.rows.every((row) => row.path !== "Added.java" || row.kind === "header"));
    const hash = review.files.find((file) => file.path === "change.txt")!.hash;
    await writeFile(join(f.root, "change.txt"), "one\nxyz\nthree\n");
    const changed = await f.service.review("ws_test", "task");
    assert.notEqual(changed.files.find((file) => file.path === "change.txt")!.hash, hash);
    assert.equal(changed.files.find((file) => file.path === "Added.java")!.hash, review.files.find((file) => file.path === "Added.java")!.hash);
  } finally { await f.cleanup(); }
});

test("source highlighting preserves code and treats URLs and escaped quotes as strings", () => {
  const source = 'public String value = "https://host/\\\"quoted\\\""; // note';
  const tokens = codeTokens(source, "Example.java", { block: false });
  assert.equal(tokens.map((token) => token.text).join(""), source);
  assert.ok(tokens.some((token) => token.kind === "keyword" && token.text === "public"));
  assert.ok(tokens.some((token) => token.kind === "string" && token.text.includes("https://host/")));
  assert.equal(tokens.at(-1)?.kind, "comment");
  const state = { block: false };
  codeTokens("/* start", "Example.java", state);
  const end = codeTokens("end */ int count = 1;", "Example.java", state);
  assert.equal(end[0].kind, "comment"); assert.equal(state.block, false);
  assert.equal(end.map((token) => token.text).join(""), "end */ int count = 1;");
});

test("wrapped rows retain complete source and line numbers while updating file jump offsets", () => {
  const source = 'String value = "' + "long_identifier_".repeat(15) + '中文";';
  const files = ["Long.java", "Next.java"].map((path) => ({ path, status: "A", additions: 1, deletions: 0, binary: false, hash: path, patch: `@@ -0,0 +1 @@\n+${source}\n` }));
  const wide = reviewRows(files, new Set(), 1200);
  const narrow = reviewRows(files, new Set(), 140);
  assert.equal(narrow.rows.length, wide.rows.length);
  assert.ok(narrow.height > wide.height);
  const code = narrow.rows.find((row) => row.kind === "code")!;
  assert.equal(code.kind, "code");
  if (code.kind !== "code") throw new Error("Code row missing");
  assert.equal(code.tokens.map((token) => token.text).join(""), source);
  assert.equal(code.line.next, 1);
  assert.ok(narrow.offsets[narrow.fileIndices.get("Next.java")!] > wide.offsets[wide.fileIndices.get("Next.java")!]);
  const measured = reviewRows(files, new Set(), 140, new Map([[code.key, code.height + 40]]));
  assert.equal(measured.offsets[measured.fileIndices.get("Next.java")!], narrow.offsets[narrow.fileIndices.get("Next.java")!] + 40);
});

test("Paseo's locale runtime updates labels, plural counts and persistent messages without reinstalling", async () => {
  // Test the installed SDK runtime; plugin production code only uses its public hooks.
  const sdk = createRequire(import.meta.url).resolve("@getpaseo/plugin");
  const { PluginTranslationRuntime, defineTranslations } = await import(pathToFileURL(join(dirname(sdk), "client", "translations.js")).href);
  let locale = "en-US";
  const listeners = new Set<() => void>();
  const runtime = new PluginTranslationRuntime({ getLocale: () => locale, subscribe: (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener); } });
  const bundle = defineTranslations({ resources: { en, zh, "zh-CN": zh } });
  const persistentLabel = bundle.message("openReview");
  try {
    assert.equal(runtime.t(bundle, "taskChanges"), "Task changes");
    assert.equal(runtime.t(bundle, "files", { count: 1 }), "1 file");
    assert.equal(runtime.t(bundle, "files", { count: 22 }), "22 files");
    assert.equal(runtime.resolve(persistentLabel), "Open DevSpace Diff");
    locale = "zh-CN";
    for (const notify of listeners) notify();
    assert.equal(runtime.t(bundle, "taskChanges"), "任务改动");
    assert.equal(runtime.t(bundle, "files", { count: 22 }), "22 个文件");
    assert.equal(runtime.resolve(persistentLabel), "打开 DevSpace Diff");
    locale = "en";
    for (const notify of listeners) notify();
    assert.equal(runtime.resolve(persistentLabel), "Open DevSpace Diff");
  } finally { runtime.dispose(); }
});
