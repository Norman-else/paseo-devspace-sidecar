#!/usr/bin/env node
// Installs only the DevSpace lifecycle preload. Paseo and the tunnels are untouched.
import { execFileSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
const run = (name,args) => execFileSync(name,args,{encoding:'utf8',timeout:60000});
if (process.platform !== 'darwin') throw new Error('For this host, add --import <plugin>/server/devspace-lifecycle-preload.mjs to the existing DevSpace Node service manually.');
const plist=join(homedir(),'Library/LaunchAgents/com.normanzuo.devspace.plist');
const read="import json,plistlib,sys; p=plistlib.load(open(sys.argv[1],'rb')); print(json.dumps({'args':p['ProgramArguments'],'label':p['Label']}))";
const {args,label}=JSON.parse(run('python3',['-c',read,plist]));
const index=args.findIndex(a=>a.endsWith('/bin/devspace.js'));
if(index<1 || !args.includes('serve'))throw new Error('The existing LaunchAgent is not the expected DevSpace serve command.');
const bin=realpathSync(args[index]),root=dirname(dirname(bin));
const pkg=JSON.parse(readFileSync(join(root,'package.json'),'utf8'));
if(pkg.name!=='@waishnav/devspace'||pkg.version!=='1.1.1')throw new Error('This adapter supports DevSpace 1.1.1.');
const preload=fileURLToPath(new URL('../server/devspace-lifecycle-preload.mjs',import.meta.url));
const configured=args.includes(preload);
if(configured&&!process.argv.includes('--reload')){console.log('DevSpace lifecycle adapter is configured. Use --install --reload after changing the adapter.');process.exit(0);}
const service=`gui/${process.getuid()}/${label}`;
const loaded=run('launchctl',['print',service]);
const pid=Number(/\bpid = (\d+)/.exec(loaded)?.[1]);
if(!pid)throw new Error('The DevSpace service is not running.');
const processes=run('ps',['-axo','pid=,ppid=']).trim().split('\n').map(line=>line.trim().split(/\s+/).map(Number));
const children=new Set([pid]);for(let i=0;i<processes.length;i++)for(const [child,parent]of processes)if(children.has(parent))children.add(child);
if(children.size>1)throw new Error('DevSpace has child processes. Wait for its commands and background tasks to finish before installing the adapter.');
const configPath=join(process.env.PASEO_DEVSPACE_SIDECAR_HOME??join(homedir(),'.config/paseo-devspace-sidecar'),'config.json');
const config=JSON.parse(readFileSync(configPath,'utf8'));
const db=new DatabaseSync(config.databasePath,{readOnly:true});
try{if(db.prepare("SELECT name FROM sqlite_master WHERE name='local_agent_sessions'").get()&&db.prepare("SELECT 1 FROM local_agent_sessions WHERE status IN ('starting','running') LIMIT 1").get())throw new Error('A DevSpace local agent is still active. Wait for it to finish.');}finally{db.close();}
if(!process.argv.includes('--install')){console.log('Compatible DevSpace service is idle. Use --install to enable the lifecycle adapter.');process.exit(0);}
const updated=configured?args:[...args.slice(0,index),'--import',preload,...args.slice(index)];
run('python3',['-c',"import plistlib,sys,os,json,shutil; p=sys.argv[1]; b=p+'.paseo-cleanup-backup'; shutil.copy2(p,b) if not os.path.exists(b) else None; v=plistlib.load(open(p,'rb')); v['ProgramArguments']=json.loads(sys.argv[2]); t=p+'.paseo-cleanup-tmp'; plistlib.dump(v,open(t,'wb')); os.replace(t,p)",plist,JSON.stringify(updated)]);
// bootout uses the service's SIGTERM handler, which waits for tracked calls to settle.
run('launchctl',['bootout',service]);
let started=false;
for(let attempt=0;attempt<12;attempt++){
  await new Promise(resolve=>setTimeout(resolve,500));
  try{run('launchctl',['bootstrap',`gui/${process.getuid()}`,plist]);started=true;break;}catch{ /* bootout may still be releasing the service label */ }
}
if(!started)throw new Error('DevSpace stopped but could not restart. Restore the backed-up LaunchAgent or bootstrap it manually.');
console.log('DevSpace lifecycle preload installed; original LaunchAgent retained in .paseo-cleanup-backup.');
