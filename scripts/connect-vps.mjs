#!/usr/bin/env node
// Secrets travel on SSH stdin, never argv or stdout. Run after installing the Mac plugin.
import { execFile, spawn } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const exec = promisify(execFile);
// Default: reuse the VPS's existing DevSpace forward (VPS 127.0.0.1:7676 → this Mac's DevSpace).
// --tunnel keeps the legacy dedicated reverse tunnel to the sidecar bridge.
const legacy = process.argv.includes("--tunnel");
const positional = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const sshHost = positional[0];
if (!sshHost || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(sshHost)) throw new Error("Usage: node scripts/connect-vps.mjs <ssh-config-host> [port] [--tunnel]");
const port = Number(positional[1] ?? (legacy ? 17677 : 7676));
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Invalid port.");
const configDir = process.env.PASEO_DEVSPACE_SIDECAR_HOME ?? join(homedir(), ".config", "paseo-devspace-sidecar");
const config = JSON.parse(await readFile(join(configDir, "config.json"), "utf8"));
if (config.mode !== "local" || !config.token) throw new Error("Install the local Mac plugin before connecting a VPS.");
const quote = (s) => "'" + s.replaceAll("'", "'\\''") + "'";
const ssh = (command, input) => new Promise((resolve, reject) => {
  const child = spawn("/usr/bin/ssh", ["-o", "BatchMode=yes", "-o", "ConnectTimeout=10", sshHost, command], { stdio: ["pipe", "pipe", "pipe"] });
  const out = [], errors = [];
  child.stdout.on("data", (b) => out.push(b)); child.stderr.on("data", (b) => errors.push(b));
  child.on("error", reject);
  child.on("close", (code) => code === 0 ? resolve(Buffer.concat(out).toString("utf8").trim()) : reject(new Error(`SSH setup failed (${code}): ${Buffer.concat(errors).toString("utf8")}`)));
  child.stdin.end(input ?? "");
});
const remoteHome = await ssh("python3 -c 'import os; print(os.path.expanduser(\"~\"))'");
const remoteRoot = join(remoteHome, "PersonalRepos", "paseo-devspace-sidecar");
const remoteConfigScript = `import os, pathlib, sys, json
config=json.load(sys.stdin)
directory=pathlib.Path.home()/'.config'/'paseo-devspace-sidecar'
directory.mkdir(parents=True,exist_ok=True,mode=0o700)
os.chmod(directory,0o700)
path=directory/'config.json'
fd=os.open(str(path),os.O_CREAT|os.O_TRUNC|os.O_WRONLY,0o600)
os.fchmod(fd,0o600)
with os.fdopen(fd,'w') as f: json.dump(config,f,indent=2)
(pathlib.Path.home()/'PersonalRepos'/'paseo-devspace-sidecar').mkdir(parents=True,exist_ok=True)
`;
await ssh(`python3 -c ${quote(remoteConfigScript)}`, JSON.stringify({ mode: "remote", endpoint: legacy ? `http://127.0.0.1:${port}` : `http://127.0.0.1:${port}/__paseo-devspace/rpc`, token: config.token }));
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
await exec("/usr/bin/rsync", ["-az", "--exclude", "node_modules", "--exclude", ".git", "--exclude", ".DS_Store", root + "/", `${sshHost}:${remoteRoot}/`]);
const label = "com.normanzuo.paseo-devspace-sidecar";
const agentPath = join(homedir(), "Library", "LaunchAgents", label + ".plist");
const domain = `gui/${process.getuid()}`;
if (!legacy) {
  try { await exec("/bin/launchctl", ["bootout", `${domain}/${label}`]); } catch { /* no legacy tunnel */ }
  await rm(agentPath, { force: true });
  console.log(`Copied plugin source to ${remoteRoot}`);
  console.log(`VPS reaches this Mac through DevSpace: 127.0.0.1:${port}/__paseo-devspace/rpc (no separate tunnel).`);
  console.log("Requires the DevSpace lifecycle adapter (scripts/install-devspace-lifecycle.mjs). Reload paseo-devspace-sidecar on the VPS to apply.");
  process.exit(0);
}
await mkdir(dirname(agentPath), { recursive: true });
const escape = (s) => String(s).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const args = ["/usr/bin/ssh", "-N", "-T", "-o", "BatchMode=yes", "-o", "ExitOnForwardFailure=yes", "-o", "ServerAliveInterval=30", "-o", "ServerAliveCountMax=3", "-o", "ConnectTimeout=15", "-R", `127.0.0.1:${port}:127.0.0.1:${config.port}`, sshHost];
await writeFile(agentPath, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>Label</key><string>${label}</string>
<key>ProgramArguments</key><array>${args.map((s) => `<string>${escape(s)}</string>`).join("")}</array>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>10</integer>
<key>StandardErrorPath</key><string>${escape(join(configDir, "tunnel.log"))}</string>
</dict></plist>\n`);
try { await exec("/bin/launchctl", ["bootout", `${domain}/${label}`]); } catch { /* first setup */ }
await exec("/bin/launchctl", ["bootstrap", domain, agentPath]);
console.log(`Copied plugin source to ${remoteRoot}`);
console.log(`Started private SSH forward: VPS 127.0.0.1:${port} → Mac 127.0.0.1:${config.port}`);
console.log("Install or reload paseo-devspace-sidecar on the remote Paseo host to apply it.");
