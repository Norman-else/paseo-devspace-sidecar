import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rename, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { promisify } from "node:util";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { LocalDiff } from "../server/git.ts";
import { remoteRequest, startBridge } from "../server/bridge.ts";
import { commandDirectory, diffLines, isWorktree, sessionWorkspaces, suggestedWorkspace, workspaceEmptyError, type Workspace } from "../shared/diff.ts";
import { reviewRows } from "../shared/review.ts";
import { codeTokens } from "../shared/syntax.ts";
import { en, zh } from "../shared/messages.ts";
import { codeAppearance, DEFAULT_MONO_FONT, diffBackground } from "../shared/appearance.ts";
import { RemoteSources } from "../server/remote-sources.ts";

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

test("workspace inspection separates unsupported folders from a clean reviewable checkout", async () => {
  const f = await fixture();
  const db = new DatabaseSync(join(f.root, "registry.sqlite"));
  const register = (id: string, root: string, base: string | null = null) => db.prepare("INSERT INTO workspace_sessions VALUES(?,?,?,?,?,?,?)").run(id, root, root, "checkout", base, new Date().toISOString(), "active");
  try {
    const plain = join(f.root, "plain"), nested = join(f.root, "nested"), unborn = join(f.root, "unborn");
    await mkdir(nested); await mkdir(unborn);
    // An independent folder is outside the fixture's Git checkout.
    const outside = await mkdtemp(join(tmpdir(), "paseo-sidecar-plain-"));
    try {
      register("ws_plain", outside); register("ws_missing", plain); register("ws_nested", nested); register("ws_unborn", unborn); register("ws_clean", f.root);
      await exec("git", ["-C", unborn, "init", "-b", "new"]);
      for (const [id, reason] of [["ws_plain", "not_git"], ["ws_missing", "missing"], ["ws_nested", "not_root"], ["ws_unborn", "no_commits"], ["ws_unknown", "missing"]] as const) {
        assert.deepEqual(await f.service.dispatch({ op: "inspect", workspaceId: id }), { status: "empty", reason });
        await assert.rejects(() => f.service.snapshot(id, "uncommitted"), (error) => workspaceEmptyError(error) === reason && !String(error).includes("Command failed"));
      }
      assert.equal((await f.service.inspect("ws_clean")).status, "ready");
      // Ignore the fixture's deliberately created child repository.
      await writeFile(join(f.root, ".git", "info", "exclude"), "registry.sqlite*\nunborn/\n");
      const review = await f.service.review("ws_clean", "uncommitted");
      assert.equal(review.snapshot.workspace.baseSha, null);
      assert.equal(review.snapshot.totalFiles, 0);
      assert.deepEqual(review.files, []);
      await rm(join(f.root, ".git"), { recursive: true, force: true });
      assert.deepEqual(await f.service.inspect("ws_clean"), { status: "empty", reason: "not_git" });
      await assert.rejects(() => f.service.pullRequests("ws_clean"), (error) => workspaceEmptyError(error) === "not_git");
    } finally { await rm(outside, { recursive: true, force: true }); }
  } finally { db.close(); await f.cleanup(); }
});

test("reads staged, unstaged, deleted, renamed, untracked and binary files without changing Git's index", async () => {
  const f = await fixture();
  try {
    await writeFile(join(f.root, "change.txt"), "one\nstaged\nthree\n");
    await f.git("add", "change.txt");
    await writeFile(join(f.root, "change.txt"), "one\nstaged\nunstaged\n");
    await unlink(join(f.root, "delete.txt"));
    await rename(join(f.root, "rename.txt"), join(f.root, "renamed.txt"));
    await f.git("add", "rename.txt", "renamed.txt");
    const odd = process.platform === "win32" ? "new 中文 file with space.txt" : "new\tfile\nwith space.txt";
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

test("limits file access to registered workspaces and current changed paths; previews symlinks as links", async (t) => {
  const f = await fixture();
  try {
    await assert.rejects(() => f.service.snapshot("ws_unknown", "task"), (error) => workspaceEmptyError(error) === "missing");
    await assert.rejects(() => f.service.file("ws_test", "task", "../private"), /Invalid/);
    await assert.rejects(() => f.service.file("ws_test", "task", "/etc/passwd"), /Invalid/);
    await assert.rejects(() => f.service.file("ws_test", "task", "unchanged.txt"), /changed-file list/);
    const external = join(tmpdir(), "sidecar-outside-link-target");
    try {
      await symlink(external, join(f.root, "link"));
      const link = await f.service.file("ws_test", "task", "link");
      assert.ok(link.patch.includes("+" + external));
    } catch (error) {
      if (process.platform !== "win32" || (error as NodeJS.ErrnoException).code !== "EPERM") throw error;
      t.diagnostic("Windows denied symlink creation; all other path checks still ran.");
    }
    await writeFile(join(f.root, "large.txt"), "x".repeat(600000));
    assert.match((await f.service.file("ws_test", "task", "large.txt")).notice!, /limit/);
  } finally { await f.cleanup(); }
});

test("remote sources route Windows and Mac workspaces independently and tolerate an offline host", async () => {
  const mac = await fixture(), windows = await fixture();
  const db = new DatabaseSync(join(windows.root, "registry.sqlite"));
  db.exec("UPDATE workspace_sessions SET id='ws_windows'"); db.close();
  await writeFile(join(mac.root, "change.txt"), "Mac project\n");
  await writeFile(join(windows.root, "change.txt"), "Windows project\r\n");
  const tokenMac = "m".repeat(40), tokenWindows = "w".repeat(40);
  const bridges = await Promise.all([
    startBridge({ mode: "local", port: 0, databasePath: "unused", token: tokenMac }, mac.service),
    startBridge({ mode: "local", port: 0, databasePath: "unused", token: tokenWindows }, windows.service),
  ]);
  const endpoint = (server: typeof bridges[number]) => { const address = server.address(); assert.ok(address && typeof address !== "string"); return `http://127.0.0.1:${address.port}`; };
  try {
    const sources = [{ endpoint: endpoint(bridges[0]), token: tokenMac }, { endpoint: endpoint(bridges[1]), token: tokenWindows }];
    const router = new RemoteSources([...sources, { endpoint: "http://127.0.0.1:9", token: "o".repeat(40) }]);
    const catalog = await router.request({ op: "catalog" }) as Workspace[];
    assert.deepEqual(catalog.map((workspace) => workspace.id).sort(), ["ws_test", "ws_windows"]);
    const inspected = await router.request({ op: "inspect", workspaceId: "ws_test" }) as { status: string; workspace: Workspace };
    assert.equal(inspected.status, "ready");
    assert.equal(inspected.workspace.root, mac.root, "a VPS router inspects the project host's Git root rather than its own cwd");
    const patch = await router.request({ op: "file", workspaceId: "ws_windows", comparison: "task", path: "change.txt" }) as { patch: string };
    assert.match(patch.patch, /Windows project/); assert.doesNotMatch(patch.patch, /Mac project/);
    const db = new DatabaseSync(join(windows.root, "registry.sqlite"));
    db.exec("UPDATE workspace_sessions SET id='ws_test'"); db.close();
    const conflicting = new RemoteSources(sources);
    assert.equal((await conflicting.request({ op: "catalog" }) as Workspace[]).length, 0);
    await assert.rejects(() => conflicting.request({ op: "snapshot", workspaceId: "ws_test", comparison: "task" }), /multiple project hosts/);
  } finally {
    for (const bridge of bridges) { bridge.closeAllConnections(); await new Promise<void>((resolve) => bridge.close(() => resolve())); }
    await mac.cleanup(); await windows.cleanup();
  }
});

test("new Windows CRLF files render without carriage returns and remain unchanged on disk", async () => {
  const f = await fixture();
  try {
    const text = "first\r\nsecond\r\n";
    await writeFile(join(f.root, "new.txt"), text);
    const patch = await f.service.file("ws_test", "task", "new.txt");
    assert.doesNotMatch(patch.patch, /\r/);
    assert.match(patch.patch, /\+first\n\+second\n/);
    assert.equal(await readFile(join(f.root, "new.txt"), "utf8"), text);
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
    // An endpoint with a path (the DevSpace adapter route) is requested as-is, not rewritten to /rpc.
    const routed = await remoteRequest({ mode: "remote", endpoint: endpoint + "/rpc", token }, { op: "catalog" }) as Workspace[];
    assert.equal(routed[0].id, "ws_test");
    await assert.rejects(() => remoteRequest({ mode: "remote", endpoint: endpoint + "/__paseo-devspace/rpc", token }, { op: "catalog" }), /Not found/);
    const pr = await remoteRequest({ mode: "remote", endpoint, token }, { op: "pull-requests", workspaceId: "ws_test" }) as { status: string; reason: string };
    assert.equal(pr.status, "unavailable"); assert.equal(pr.reason, "no_remote");
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
  assert.equal(suggestedWorkspace([
    { type: "tool_call", name: "mcp__devspace__bash", input: { workspace_id: "ws_task" } },
    { type: "tool_call", name: "mcp__devspace__open_workspace", result: { workspace_id: "ws_removed" } },
  ], workspaces), "ws_task", "a removed workspace is skipped");
  assert.equal(suggestedWorkspace([{ type: "tool_call", name: "unrelated_tool", result: { nested: { type: "tool_call", name: "mcp__devspace__bash", input: { workspace_id: "ws_task" } } } }], workspaces), null);
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
    assert.equal(runtime.resolve(persistentLabel), "DevSpace Desk: code changes, PR status and merge");
    locale = "zh-CN";
    for (const notify of listeners) notify();
    assert.equal(runtime.t(bundle, "taskChanges"), "任务改动");
    assert.equal(runtime.t(bundle, "files", { count: 22 }), "22 个文件");
    assert.equal(runtime.resolve(persistentLabel), "DevSpace 工作台：代码改动、PR 状态与合并");
    locale = "en";
    for (const notify of listeners) notify();
    assert.equal(runtime.resolve(persistentLabel), "DevSpace Desk: code changes, PR status and merge");
  } finally { runtime.dispose(); }
});

test("code typography follows the saved font and larger size, and layout changes with it", () => {
  const saved = codeAppearance({ monoFontFamily: "'JetBrains Mono', monospace", codeFontSize: 18 });
  assert.equal(saved.fontFamily, "'JetBrains Mono', monospace");
  assert.equal(saved.fontSize, 18); assert.equal(saved.lineHeight, 27);
  assert.equal(codeAppearance({ codeFontSize: 12 }).fontSize, 14);
  assert.equal(codeAppearance({ codeFontSize: 50 }).fontSize, 22);
  assert.equal(codeAppearance({ monoFontFamily: "bad; family", codeFontSize: "invalid" }).fontFamily, DEFAULT_MONO_FONT);
  assert.equal(codeAppearance({ monoFontFamily: "bad\nfamily" }).fontFamily, DEFAULT_MONO_FONT);
  const file = { path: "Long.java", status: "A", additions: 1, deletions: 0, binary: false, hash: "font", patch: "@@ -0,0 +1 @@\n+" + "identifier".repeat(20) + "\n" };
  const normal = reviewRows([file], new Set(), 300, undefined, codeAppearance(null));
  const larger = reviewRows([file], new Set(), 300, undefined, saved);
  assert.ok(larger.height > normal.height);
});

test("diff backgrounds are opaque and distinct across added/deleted lines and host themes", () => {
  const added = diffBackground("#6cb17b", "#1f1e1e"), removed = diffBackground("#d8847b", "#1f1e1e");
  assert.match(added, /^#[0-9a-f]{6}$/); assert.notEqual(added, removed); assert.notEqual(added, "#1f1e1e");
  assert.equal(diffBackground("rgb(108,177,123)", "rgb(31,30,30)"), added);
  const addedLight = diffBackground("#3e704a", "#ffffff");
  assert.notEqual(addedLight, "#ffffff"); assert.notEqual(addedLight, added);
  assert.equal(diffBackground("unknown", "#222222"), "#222222");
});

test("binding prefers the session's latest worktree over later checkout use, and honours a pin", () => {
  const ws = (id: string, root: string, mode = "checkout", worktree?: boolean) => ({ id, root, mode, worktree }) as Workspace;
  const main = ws("ws_main", "/r/Navi"), devspace = ws("ws_ds", "/u/.devspace/worktrees/Navi-1", "worktree");
  const claude = ws("ws_cl", "/r/Navi/.claude/worktrees/pr-29"), other = ws("ws_other", "/r/Other");
  const call = (id: string) => ({ type: "tool_call", name: "mcp__devspace__bash", input: { workspace_id: id } });
  const all = [main, devspace, claude, other];
  assert.equal(suggestedWorkspace([call("ws_ds"), call("ws_main")], all), "ws_ds", "checkout after commit does not steal the review");
  assert.equal(suggestedWorkspace([call("ws_ds"), call("ws_cl"), call("ws_main")], all), "ws_cl", "latest of several worktrees, including .claude/worktrees");
  assert.equal(suggestedWorkspace([call("ws_main"), call("ws_other")], all), "ws_other", "no worktree: latest checkout");
  assert.equal(suggestedWorkspace([call("ws_ds"), call("ws_cl")], all, "ws_ds"), "ws_ds", "pin wins");
  assert.equal(suggestedWorkspace([call("ws_cl")], all, "ws_ds"), "ws_cl", "pin outside this session is ignored");
  assert.deepEqual(sessionWorkspaces([call("ws_ds"), call("ws_main"), call("ws_ds")], all).map((w) => w.id), ["ws_ds", "ws_main"]);
  assert.equal(isWorktree(ws("x", "/r/a", "checkout", true)), true, "git-detected linked worktree");
  assert.equal(isWorktree(ws("x", "/u/.devspace/worktrees/a", "checkout", false)), false, "explicit server flag wins");
});

test("a cd into another registered repo counts for that repo, and deleted worktrees are skipped", () => {
  const ws = (id: string, root: string, mode = "checkout", extra: Partial<Workspace> = {}) => ({ id, root, mode, lastUsedAt: "2026-11-21T10:00:00Z", ...extra }) as Workspace;
  const vault = ws("ws_vault", "/Users/u/PersonalRepos/TheWorld");
  const naviOld = ws("ws_navi_old", "/Users/u/Infras/Navi", "checkout", { lastUsedAt: "2026-11-20T10:00:00Z" });
  const navi = ws("ws_navi", "/Users/u/Infras/Navi", "checkout", { lastUsedAt: "2026-11-21T12:00:00Z" });
  const gone = ws("ws_gone", "/Users/u/.devspace/worktrees/Navi-ead9fc9f", "worktree", { worktree: true, missing: true });
  const all = [vault, naviOld, navi, gone];
  const bash = (id: string, command: string) => ({ type: "tool_call", name: "mcp__devspace__bash", status: "completed", detail: { input: { workspace_id: id, command } } });
  // The real session: work in a worktree that is later deleted, then keep passing the vault's id while cd-ing into Navi.
  const timeline = [bash("ws_gone", "git status"), bash("ws_vault", "cd /Users/u/Infras/Navi && git log -1"), bash("ws_vault", "cd '/Users/u/Infras/Navi/agent' && ls")];
  assert.deepEqual(sessionWorkspaces(timeline, all).map((w) => w.id), ["ws_navi"], "cd targets map to the most recent Navi registration; the deleted worktree is skipped");
  assert.equal(suggestedWorkspace(timeline, all), "ws_navi");
  assert.equal(suggestedWorkspace([bash("ws_vault", "ls -la")], all), "ws_vault", "without cd the explicit id still counts");
  assert.equal(suggestedWorkspace([bash("ws_vault", "cd /tmp && ls")], all), "ws_vault", "a cd outside any registered workspace falls back to the id");
  assert.equal(commandDirectory('cd "/Users/u/My Repo" && ls'), "/Users/u/My Repo");
  assert.equal(commandDirectory("cd relative/path && ls"), undefined);
  assert.equal(commandDirectory("git -C /x status"), undefined);
});
