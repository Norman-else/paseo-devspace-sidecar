import { posix, win32 } from "node:path";

export function windowsOptions(args) {
  const [host, ...rest] = args;
  if (!host || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(host)) throw new Error("Provide an existing SSH config host alias.");
  const options = { host, diffPort: 17678, mcpPort: 17676, localMcpPort: 7676, forwardMcp: false, startup: true, databasePath: undefined };
  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i];
    if (flag === "--forward-mcp") options.forwardMcp = true;
    else if (flag === "--no-startup") options.startup = false;
    else if (flag === "--database-path") {
      options.databasePath = rest[++i];
      if (!options.databasePath || !win32.isAbsolute(options.databasePath)) throw new Error("--database-path needs an absolute Windows path.");
    } else {
      const field = { "--diff-port": "diffPort", "--mcp-port": "mcpPort", "--local-mcp-port": "localMcpPort" }[flag];
      if (!field) throw new Error(`Unknown option: ${flag}`);
      const value = Number(rest[++i]);
      if (!Number.isInteger(value) || value < 1024 || value > 65535) throw new Error(`Invalid port for ${flag}.`);
      options[field] = value;
    }
  }
  if (options.forwardMcp && options.diffPort === options.mcpPort) throw new Error("The diff and MCP forwards need different remote ports.");
  return options;
}
export function sshArguments(config) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(config.host)) throw new Error("Invalid SSH host alias.");
  for (const field of ["diffPort", "localDiffPort", ...(config.forwardMcp ? ["mcpPort", "localMcpPort"] : [])]) {
    if (!Number.isInteger(config[field]) || config[field] < 1024 || config[field] > 65535) throw new Error(`Invalid ${field}.`);
  }
  const args = ["-N", "-T", "-o", "BatchMode=yes", "-o", "ExitOnForwardFailure=yes", "-o", "ServerAliveInterval=30", "-o", "ServerAliveCountMax=3", "-o", "ConnectTimeout=10",
    "-R", `127.0.0.1:${config.diffPort}:127.0.0.1:${config.localDiffPort}`];
  if (config.forwardMcp) args.push("-R", `127.0.0.1:${config.mcpPort}:127.0.0.1:${config.localMcpPort}`);
  return [...args, config.host];
}
export function remoteProjectPath(home) {
  if (!posix.isAbsolute(home) || /[\r\n\0]/.test(home)) throw new Error("The VPS must report an absolute Linux home directory.");
  return posix.join(home, "PersonalRepos", "paseo-devspace-sidecar");
}
export const shellQuote = (value) => "'" + String(value).replaceAll("'", "'\\''") + "'";
export function quoteWindowsArgument(value) {
  if (/[\r\n\0"]/.test(value)) throw new Error("Invalid Windows argument.");
  return '"' + value.replace(/(\\+)$/, "$1$1") + '"';
}
export function taskArguments(runner, configPath) { return `${quoteWindowsArgument(runner)} --config ${quoteWindowsArgument(configPath)}`; }

export const installTaskScript = `
$ErrorActionPreference = 'Stop'
$name = $env:SIDECAR_TASK_NAME
$existing = Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
if ($existing) { Stop-ScheduledTask -TaskName $name -ErrorAction Stop }
$action = New-ScheduledTaskAction -Execute $env:SIDECAR_NODE -Argument $env:SIDECAR_TASK_ARGS
$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $identity
$principal = New-ScheduledTaskPrincipal -UserId $identity -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
Start-ScheduledTask -TaskName $name
`;

// The owner token enters only over encrypted SSH stdin. Existing Mac sources remain intact.
export const configureRemoteScript = `import json, os, pathlib, socket, sys, tempfile
incoming=json.load(sys.stdin)
home=pathlib.Path.home()
daemon=home/'.paseo'/'config.json'
if not daemon.is_file() or not json.load(open(daemon)).get('pluginsEnabled',False):
 raise RuntimeError('Enable plugins in Paseo on this VPS before connecting the sidecar.')
directory=home/'.config'/'paseo-devspace-sidecar'
path=directory/'config.json'
data=json.load(open(path)) if path.is_file() else None
source=incoming['source']
if data is not None and data.get('mode')!='remote':
 raise RuntimeError('VPS sidecar is in local mode. Configure a remote project host explicitly before continuing.')
sources=([data]+data.get('additionalSources',[])) if data else []
for existing in sources:
 if existing['endpoint']==source['endpoint'] and (existing['token']!=source['token'] or existing.get('name')!=source['name']):
  raise RuntimeError('Remote diff port belongs to another project host. Choose a different --diff-port.')
same=next((existing for existing in sources if existing.get('name')==source['name']),None)
if same and same['token']!=source['token']:
 raise RuntimeError('Project source name is already in use with a different credential.')
if same:
 same.update(source)
elif data:
 additions=data.setdefault('additionalSources',[])
 if len(additions)>=8: raise RuntimeError('At most eight additional project hosts are supported.')
 additions.append(source)
else:
 data=dict(source,mode='remote',additionalSources=[])
directory.mkdir(parents=True,exist_ok=True,mode=0o700)
os.chmod(directory,0o700)
fd,temp=tempfile.mkstemp(prefix='.config-',dir=directory)
try:
 os.fchmod(fd,0o600)
 with os.fdopen(fd,'w') as f: json.dump(data,f,indent=2)
 os.replace(temp,path)
finally:
 if os.path.exists(temp): os.unlink(temp)
root=home/'PersonalRepos'/'paseo-devspace-sidecar'
root.mkdir(parents=True,exist_ok=True)
print(str(root))
`;

export const verifyRemoteScript = `import json, sys, urllib.request
source=json.load(sys.stdin)
request=urllib.request.Request(source['endpoint']+'/rpc',data=b'{"op":"catalog"}',headers={'Authorization':'Bearer '+source['token'],'Content-Type':'application/json'})
with urllib.request.urlopen(request,timeout=10) as response: workspaces=json.load(response)
print(json.dumps({'ok':True,'workspaces':len(workspaces)}))
`;
