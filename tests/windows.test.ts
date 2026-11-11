import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isRelativeFile, isWithin, samePath } from "../server/paths.ts";
import { configSchema } from "../server/config.ts";
import { configureRemoteScript, installTaskScript, remoteProjectPath, shellQuote, sshArguments, taskArguments, windowsOptions } from "../scripts/windows-support.mjs";

test("Windows path checks handle drive letters, slash styles and UNC while rejecting traversal", () => {
  assert.ok(samePath("C:\\Users\\Owner\\Repo", "c:/users/owner/repo/", "win32"));
  assert.ok(samePath("\\\\?\\C:\\Users\\Owner\\Repo", "C:/Users/Owner/Repo", "win32"));
  assert.ok(samePath("\\\\?\\UNC\\server\\share\\Repo", "\\\\server\\share\\repo", "win32"));
  assert.ok(!samePath("C:/Repo", "D:/Repo", "win32"));
  assert.ok(isWithin("C:/Repo", "c:/repo/src", "win32"));
  assert.ok(isWithin("C:/Repo", "C:/Repo/..cache", "win32"));
  assert.ok(!isWithin("C:/Repo", "C:/Repo-other", "win32"));
  assert.ok(!isWithin("C:/Repo", "D:/Repo/src", "win32"));
  assert.ok(!isWithin("\\\\server\\share", "\\\\server\\other", "win32"));
  for (const path of ["C:secret", "C:\\secret", "C:/secret", "\\\\server\\share\\file", "../file", "src\\..\\file", "/etc/passwd"]) assert.ok(!isRelativeFile(path), path);
  assert.ok(isRelativeFile("src/main/My File.java"));
});

test("Windows connection plan keeps Linux remote paths and separate loopback-only forwards", () => {
  const options = windowsOptions(["my-vps", "--forward-mcp", "--database-path", "D:\\开发 项目\\devspace.sqlite"]);
  assert.equal(options.diffPort, 17678); assert.equal(options.mcpPort, 17676);
  assert.equal(remoteProjectPath("/home/ubuntu"), "/home/ubuntu/PersonalRepos/paseo-devspace-sidecar");
  const args = sshArguments({ ...options, localDiffPort: 7677 });
  assert.ok(args.includes("127.0.0.1:17678:127.0.0.1:7677"));
  assert.ok(args.includes("127.0.0.1:17676:127.0.0.1:7676"));
  assert.ok(!args.some((arg) => arg.includes("0.0.0.0")));
  assert.equal(args.at(-1), "my-vps");
  assert.throws(() => windowsOptions(["my-vps", "--diff-port", "22"]), /Invalid port/);
  assert.throws(() => windowsOptions(["my-vps", "--forward-mcp", "--diff-port", "17676"]), /different remote ports/);
  assert.throws(() => windowsOptions(["--malicious-option"]), /SSH config host/);
  assert.equal(shellQuote("/home/user's repo"), "'/home/user'\\''s repo'");
  assert.equal(taskArguments("C:\\User Files\\runner.mjs", "C:\\User Files\\config.json"), '"C:\\User Files\\runner.mjs" --config "C:\\User Files\\config.json"');
});

test("legacy Mac configuration remains valid when additional Windows sources are configured", () => {
  const legacy = { mode: "remote", endpoint: "http://127.0.0.1:17677", token: "m".repeat(40) };
  const parsed = configSchema.parse(legacy);
  assert.equal(parsed.mode, "remote");
  if (parsed.mode !== "remote") throw new Error("Wrong mode");
  assert.deepEqual(parsed.additionalSources, []);
  const mixed = configSchema.parse({ ...legacy, additionalSources: [{ name: "windows-pc", endpoint: "http://127.0.0.1:17678", token: "w".repeat(40) }] });
  assert.equal(mixed.endpoint, legacy.endpoint); assert.equal(mixed.token, legacy.token);
});

test("Windows PowerShell accepts the scheduled-task installer syntax", { skip: process.platform !== "win32" }, async () => {
  const encoded = Buffer.from("$ErrorActionPreference='Stop';[void][scriptblock]::Create([Console]::In.ReadToEnd())", "utf16le").toString("base64");
  await new Promise<void>((resolve, reject) => {
    const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", encoded], { stdio: ["pipe", "ignore", "pipe"] });
    const errors: Buffer[] = [];
    child.stderr.on("data", (value) => errors.push(value)); child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(Buffer.concat(errors).toString("utf8"))));
    child.stdin.end(installTaskScript);
  });
});

test("Windows provisioning merges the VPS source without overwriting Mac credentials and rejects port conflicts", { skip: process.platform === "win32" }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "sidecar-remote-config-"));
  const old = { mode: "remote", endpoint: "http://127.0.0.1:17677", token: "m".repeat(40), custom: "keep" };
  const source = { name: "windows-fixture", endpoint: "http://127.0.0.1:17678", token: "w".repeat(40) };
  const configPath = join(directory, ".config", "paseo-devspace-sidecar", "config.json");
  const run = (input: object) => new Promise<void>((resolve, reject) => {
    // Inject only the isolated test directory; production always uses the authenticated VPS user's home.
    const code = configureRemoteScript.replace("home=pathlib.Path.home()", "home=pathlib.Path(sys.argv[1])");
    const child = spawn("python3", ["-c", code, directory], { stdio: ["pipe", "ignore", "pipe"] });
    const errors: Buffer[] = [];
    child.stderr.on("data", (value) => errors.push(value)); child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(Buffer.concat(errors).toString("utf8"))));
    child.stdin.end(JSON.stringify(input));
  });
  try {
    await mkdir(join(directory, ".paseo"), { recursive: true });
    await writeFile(join(directory, ".paseo", "config.json"), JSON.stringify({ pluginsEnabled: true }));
    await mkdir(join(directory, ".config", "paseo-devspace-sidecar"), { recursive: true });
    await writeFile(configPath, JSON.stringify(old));
    await run({ source }); await run({ source });
    const merged = JSON.parse(await readFile(configPath, "utf8"));
    assert.equal(merged.endpoint, old.endpoint); assert.equal(merged.token, old.token); assert.equal(merged.custom, "keep");
    assert.deepEqual(merged.additionalSources, [source]);
    const before = await readFile(configPath, "utf8");
    await assert.rejects(() => run({ source: { ...source, endpoint: old.endpoint } }), /another project host/);
    assert.equal(await readFile(configPath, "utf8"), before);
    await writeFile(join(directory, ".paseo", "config.json"), JSON.stringify({ pluginsEnabled: false }));
    await assert.rejects(() => run({ source }), /Enable plugins/);
    assert.equal(await readFile(configPath, "utf8"), before);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
