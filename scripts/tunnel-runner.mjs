#!/usr/bin/env node
import { spawn } from "node:child_process";
import { appendFile, readFile, stat, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { sshArguments } from "./windows-support.mjs";

const index = process.argv.indexOf("--config");
if (index < 0 || !process.argv[index + 1]) throw new Error("Usage: node scripts/tunnel-runner.mjs --config <windows-tunnel.json>");
const configPath = process.argv[index + 1];
const config = JSON.parse(await readFile(configPath, "utf8"));
const args = sshArguments(config);
const logPath = join(dirname(configPath), "windows-tunnel.log");
let stopping = false, child = null;
const stop = () => { stopping = true; child?.kill(); };
process.on("SIGINT", stop); process.on("SIGTERM", stop);
async function log(text) {
  try { if ((await stat(logPath)).size > 512 * 1024) { await rm(logPath + ".old", { force: true }); await rename(logPath, logPath + ".old"); } } catch { /* first run */ }
  await appendFile(logPath, `${new Date().toISOString()} ${text}\n`, { mode: 0o600 });
}
while (!stopping) {
  await new Promise((resolve) => {
    child = spawn(config.sshPath ?? "ssh.exe", args, { stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
    child.stderr.on("data", (bytes) => { void log(bytes.toString("utf8").trim()).catch(() => {}); });
    child.once("error", (error) => { void log(error.message).finally(resolve); });
    child.once("exit", (code) => { void log(`SSH disconnected (${code}); reconnecting.`).finally(resolve); });
  });
  child = null;
  if (!stopping) await delay(5000);
}
