#!/usr/bin/env node
import { execFile, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { homedir, hostname } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import { configureRemoteScript, installTaskScript, remoteProjectPath, shellQuote, taskArguments, verifyRemoteScript, windowsOptions } from "./windows-support.mjs";

if (process.argv.includes("--help")) {
  console.log("Usage: node scripts/connect-windows.mjs <ssh-host-alias> [--diff-port 17678] [--database-path C:\\path\\devspace.sqlite] [--forward-mcp] [--mcp-port 17676] [--local-mcp-port 7676] [--no-startup]");
  process.exit(0);
}
if (process.platform !== "win32") throw new Error("Run this connector on the Windows computer hosting DevSpace and the project.");
const options = windowsOptions(process.argv.slice(2));
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const exec = promisify(execFile);
const sshPath = join(process.env.WINDIR ?? "C:\\Windows", "System32", "OpenSSH", "ssh.exe");
await exec(sshPath, ["-V"], { windowsHide: true });
await exec("git.exe", ["--version"], { windowsHide: true });
const directory = process.env.PASEO_DEVSPACE_SIDECAR_HOME ?? join(homedir(), ".config", "paseo-devspace-sidecar");
await mkdir(directory, { recursive: true, mode: 0o700 });
const configPath = join(directory, "config.json");
let config;
try { config = JSON.parse(await readFile(configPath, "utf8")); }
catch (error) { if (error.code !== "ENOENT") throw error; }
config ??= { mode: "local", databasePath: join(homedir(), ".local", "share", "devspace", "devspace.sqlite"), port: 7677, token: randomBytes(32).toString("base64url") };
if (config.mode !== "local") throw new Error("The Windows sidecar must be in local mode.");
const databaseChanged = !!options.databasePath && options.databasePath !== config.databasePath;
if (options.databasePath) config.databasePath = options.databasePath;
if (!config.databasePath || typeof config.token !== "string" || config.token.length < 32 || !Number.isInteger(config.port)) throw new Error("Invalid local sidecar configuration.");
await stat(config.databasePath);
config.sourceName ??= `windows-${hostname()}-${randomBytes(4).toString("hex")}`;
await writeFile(configPath, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
if (databaseChanged) throw new Error(`Database path saved in ${configPath}. Reload the local Paseo plugin, then rerun this command.`);
// Read-only check before changing anything on the VPS. The local Paseo plugin must be running.
const local = await fetch(`http://127.0.0.1:${config.port}/rpc`, { method: "POST", signal: AbortSignal.timeout(10000), headers: { Authorization: `Bearer ${config.token}`, "Content-Type": "application/json" }, body: '{"op":"catalog"}' });
if (!local.ok) throw new Error(`The Windows diff bridge is not ready (${local.status}). Install or reload the local Paseo plugin first.`);
await local.json();
const ssh = (command, input) => new Promise((resolve, reject) => {
  const child = spawn(sshPath, ["-o", "BatchMode=yes", "-o", "ConnectTimeout=10", options.host, command], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
  const out = [], errors = [];
  child.stdout.on("data", (bytes) => out.push(bytes)); child.stderr.on("data", (bytes) => errors.push(bytes));
  child.once("error", reject);
  child.once("close", (code) => code === 0 ? resolve(Buffer.concat(out).toString("utf8").trim()) : reject(new Error(`SSH failed (${code}): ${Buffer.concat(errors).toString("utf8").trim()}`)));
  child.stdin.on("error", () => {});
  child.stdin.end(input ?? "");
});
const remoteHome = await ssh("python3 -c 'import pathlib; print(pathlib.Path.home())'");
const remoteRoot = remoteProjectPath(remoteHome);
const source = { name: config.sourceName, endpoint: `http://127.0.0.1:${options.diffPort}`, token: config.token };
await ssh(`python3 -c ${shellQuote(configureRemoteScript)}`, JSON.stringify({ source }));
// Git archives only committed plugin source. It never copies the Windows project or credentials.
const archive = await exec("git.exe", ["-C", root, "archive", "--format=tar", "HEAD"], { encoding: "buffer", maxBuffer: 8 * 1024 * 1024, windowsHide: true });
await ssh(`tar -xf - -C ${shellQuote(remoteRoot)}`, archive.stdout);
const tunnelPath = join(directory, `windows-tunnel-${options.host}.json`);
await writeFile(tunnelPath, JSON.stringify({ ...options, sshPath, localDiffPort: config.port }, null, 2) + "\n", { mode: 0o600 });
const runner = join(root, "scripts", "tunnel-runner.mjs");
const taskName = `Paseo-DevSpace-Sidecar-${options.host}`;
if (options.startup) {
  const powershell = join(process.env.WINDIR ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  await new Promise((resolve, reject) => {
    const child = spawn(powershell, ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(installTaskScript, "utf16le").toString("base64")], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, SIDECAR_TASK_NAME: taskName, SIDECAR_NODE: process.execPath, SIDECAR_TASK_ARGS: taskArguments(runner, tunnelPath) } });
    const errors = [];
    child.stdout.resume(); child.stderr.on("data", (bytes) => errors.push(bytes)); child.once("error", reject);
    child.once("close", (code) => code === 0 ? resolve() : reject(new Error(`Scheduled task registration failed (${code}): ${Buffer.concat(errors).toString("utf8")}`)));
  });
  let connected = false;
  for (let attempt = 0; attempt < 8; attempt++) {
    try { await ssh(`python3 -c ${shellQuote(verifyRemoteScript)}`, JSON.stringify(source)); connected = true; break; }
    catch { await delay(1000); }
  }
  if (!connected) throw new Error("The scheduled task started but the Windows bridge is not reachable from the VPS yet. Check windows-tunnel.log.");
  console.log(`Verified VPS loopback ${options.diffPort} reaches the Windows diff bridge.`);
  console.log(`Automatic reconnection task: ${taskName}`);
} else {
  console.log(`Start the tunnel manually: node ${JSON.stringify(runner)} --config ${JSON.stringify(tunnelPath)}`);
}
console.log(`Plugin source copied to ${remoteRoot}`);
console.log(`On the VPS, install or reload paseo-devspace-sidecar from ${remoteRoot}. Existing Mac project sources were preserved.`);
if (options.forwardMcp) console.log(`DevSpace MCP forward: http://127.0.0.1:${options.mcpPort}/mcp. Claude MCP configuration and OAuth still need to be verified separately.`);
