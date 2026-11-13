import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, access } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
// @ts-expect-error Node-only lifecycle adapter deliberately has no client/runtime dependency.
import { DevspaceLifecycle } from '../server/devspace-lifecycle-runtime.mjs';
import { CleanupCoordinator } from '../server/cleanup-coordinator';
const git = (root: string, ...args: string[]) => execFileSync('git', ['-C',root,...args], { encoding: 'utf8', stdio: ['ignore','pipe','pipe'] }).trim();
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'sidecar-cleanup-')), repo = join(dir,'repo'), tree = join(dir,'trees','task');
  await mkdir(repo); await mkdir(join(dir,'trees')); git(repo,'init'); git(repo,'config','user.name','Cleanup test'); git(repo,'config','user.email','test@example.invalid');
  await writeFile(join(repo,'file.txt'),'first\n'); await writeFile(join(repo,'.gitignore'),'node_modules/\n.env\n'); git(repo,'add','.'); git(repo,'commit','-m','initial'); git(repo,'worktree','add','-b','task',tree);
  const db = new DatabaseSync(join(dir,'devspace.sqlite')); db.exec('CREATE TABLE workspace_sessions(id TEXT PRIMARY KEY, root TEXT, source_root TEXT, status TEXT, last_used_at TEXT)');
  db.prepare('INSERT INTO workspace_sessions VALUES(?,?,?,?,?)').run('ws_test',tree,repo,'active','2026-11-13');
  const session = () => { const row = db.prepare('SELECT * FROM workspace_sessions').get()!; return { id: row.id, root: row.root, sourceRoot: row.source_root, status: row.status, lastUsedAt: row.last_used_at, mode: 'worktree', managed: true }; };
  const runtime = { config: { worktreeRoot: join(dir,'trees') }, workspaceStore: { database: { sqlite: db }, getSessionResult: () => ({ isErr: () => false, value: session() }) }, workspaces: { getWorkspace: async () => session() }, toolActivities: { track: (fn: () => unknown) => fn() }, processSessions: { sessions: new Map(), start: (x: unknown) => x }, codeModeExecutions: { executions: new Map(), start: () => {} } };
  const engine = new DevspaceLifecycle(runtime,join(dir,'state'));
  const wait = async (requestId: string) => { for (let i=0;i<100;i++) { const result = await engine.status('ws_test',requestId); if (result.phase !== 'closing') return result; await new Promise(r => setTimeout(r,20)); } throw new Error('cleanup timed out'); };
  return { dir,repo,tree,db,runtime,engine,wait, finish: async () => { db.close(); await rm(dir,{ recursive:true,force:true }); } };
}
test('confirmed cleanup removes only the linked worktree, closes registration and preserves branch + recovery ref', async () => {
  const f = await fixture(); try {
    const p = await f.engine.preview('ws_test'); assert.deepEqual(p.blockers,[]); const requestId = randomUUID();
    await f.engine.execute('ws_test',p.token,requestId); assert.equal((await f.wait(requestId)).phase,'done');
    await assert.rejects(access(f.tree)); assert.equal(f.db.prepare('SELECT status FROM workspace_sessions').get()!.status,'inactive');
    assert.equal(git(f.repo,'rev-parse','task'),p.head); assert.equal(git(f.repo,'rev-parse','refs/paseo-devspace-sidecar/recovery/ws_test'),p.head);
    assert.ok(!git(f.repo,'worktree','list','--porcelain').includes(f.tree.replace(/\\/g,'/'))); await access(join(f.repo,'file.txt'));
    assert.equal((await f.engine.execute('ws_test',p.token,requestId)).phase,'done'); await assert.rejects(f.runtime.workspaces.getWorkspace('ws_test'),/closed/);
  } finally { await f.finish(); }
});
test('dirty, untracked and precious ignored files block cleanup; disposable dependencies are distinguished', async () => {
  const f=await fixture(); try {
    await writeFile(join(f.tree,'file.txt'),'changed'); await writeFile(join(f.tree,'new.txt'),'untracked'); await writeFile(join(f.tree,'.env'),'local-only-value'); await mkdir(join(f.tree,'node_modules')); await writeFile(join(f.tree,'node_modules','cache'),'disposable');
    const p=await f.engine.preview('ws_test'); assert.ok(p.blockers.includes('changes')); assert.ok(p.blockers.includes('ignored')); assert.deepEqual(p.precious,['.env']);
    await assert.rejects(f.engine.execute('ws_test',p.token,randomUUID()),/contains files/); await access(f.tree); assert.equal(f.db.prepare('SELECT status FROM workspace_sessions').get()!.status,'active');
  } finally { await f.finish(); }
});
test('active background processes, tool calls, changed HEAD and main checkout are rejected', async () => {
  const f=await fixture(); try {
    const p=await f.engine.preview('ws_test'); f.runtime.processSessions.sessions.set(1,{workspaceId:'ws_test',running:true});
    assert.ok((await f.engine.preview('ws_test')).blockers.includes('busy')); await assert.rejects(f.engine.execute('ws_test',p.token,randomUUID()),/busy/); f.runtime.processSessions.sessions.clear();
    let finish!: () => void; const pending=f.runtime.toolActivities.track(() => new Promise<void>(r=>{finish=r;})); assert.ok((await f.engine.preview('ws_test')).blockers.includes('busy')); finish(); await pending;
    await writeFile(join(f.tree,'file.txt'),'new commit'); git(f.tree,'add','.'); git(f.tree,'commit','-m','moved'); await assert.rejects(f.engine.execute('ws_test',p.token,randomUUID()),/changed after preview/);
    f.db.prepare('UPDATE workspace_sessions SET root=?').run(f.repo); await assert.rejects(f.engine.preview('ws_test'),/outside/); await access(f.repo);
  } finally { await f.finish(); }
});
test('restart reconciles receipts without repeating a deletion; locked worktrees cannot be removed', async()=>{
 const f=await fixture();try { git(f.repo,'worktree','lock',f.tree);const p=await f.engine.preview('ws_test');assert.ok(p.blockers.includes('locked'));await assert.rejects(f.engine.execute('ws_test',p.token,randomUUID()));git(f.repo,'worktree','unlock',f.tree);
 const fresh=await f.engine.preview('ws_test'),id=randomUUID();await f.engine.execute('ws_test',fresh.token,id);await f.wait(id);const restarted=new DevspaceLifecycle(f.runtime,join(f.dir,'state'));assert.equal((await restarted.status('ws_test',id)).phase,'done');
 }finally{await f.finish();}
});
function mockPaseo(workspaceIds: string[] = ['ws_test']) {
  const actor = { id:'agent1',title:'Task',status:'idle',pendingPermissions:[],activeTurn:null,archivedAt:null,cwd:'/vps/context' };
  let archives=0, archiveFails=false;
  const api = { agents: { list: async()=>({entries:[{agent:actor}],pageInfo:{hasMore:false}}), ref:()=>({ timeline:{refetch:async()=>({hasOlder:false,entries:workspaceIds.map(id=>({item:{type:'tool_call',name:'mcp__devspace__bash',status:'completed',input:{workspace_id:id}}}))})},refresh:async()=>({agent:actor}), archive:async()=>{archives++;if(archiveFails)throw new Error('offline');actor.archivedAt='now';} }) } };
  return { actor,api, archives:()=>archives,setArchiveFails:(value:boolean)=>{archiveFails=value;} };
}
test('archive happens only after verified local success; archive retry never repeats cleanup and survives restart', async()=>{
 const dir=await mkdtemp(join(tmpdir(),'cleanup-coordinator-')),mock=mockPaseo();let removes=0,phase='closing';
 const sourceId=randomUUID(),token=randomUUID();
 const request=async(input:any)=>{
  if(input.op==='cleanup-preview')return {sourceId,token,workspaceId:'ws_test',root:'/local/trees/task',sourceRoot:'/local/repo',head:'abc',branch:'task',lastUsedAt:'now',blockers:[],changeCount:0,precious:[]};
  if(input.op==='catalog')return [{id:'ws_test',root:'/local/trees/task',sourceRoot:'/local/repo',mode:'worktree',baseSha:'abc',branch:'task',lastUsedAt:'now'}];
  if(input.op==='pull-requests')return {status:'none',repository:'test/repo',branch:'task',checkedAt:'now'};
  if(input.op==='cleanup-execute'){removes++;return {workspaceId:'ws_test',requestId:input.requestId,phase,error:null,recoveryRef:'refs/recovery'};}
  return {workspaceId:'ws_test',requestId:input.requestId,phase,error:null,recoveryRef:'refs/recovery'};
 };
 const path=join(dir,'state.json');let c=new CleanupCoordinator(path,request,async()=>null);
 try {let plan=await c.preview({agentId:'agent1',workspaceId:'ws_test'},mock.api as any);
 assert.equal((await c.execute({planId:plan.planId,archive:true,acknowledgeUnmerged:false},mock.api as any)).phase,'failed');
 plan=await c.preview({agentId:'agent1',workspaceId:'ws_test'},mock.api as any);
 const input={planId:plan.planId,archive:true,acknowledgeUnmerged:true};const [job,duplicate]=await Promise.all([c.execute(input,mock.api as any),c.execute(input,mock.api as any)]);assert.equal(job.requestId,duplicate.requestId);assert.equal(removes,1);assert.equal(mock.archives(),0);
 await c.status(job.requestId,mock.api as any,false);assert.equal(mock.archives(),0);phase='done';mock.setArchiveFails(true);assert.equal((await c.status(job.requestId,mock.api as any,false)).phase,'archive_pending');assert.equal(removes,1);
 c.close();c=new CleanupCoordinator(path,request,async()=>null);mock.setArchiveFails(false);assert.equal((await c.status(job.requestId,mock.api as any,true)).phase,'done');assert.equal(removes,1);assert.equal(mock.archives(),2);
 assert.throws(()=>c.assertCanOpen('agent1','interactive'),/closed/);c.assertCanOpen('agent1','history');
 }finally{c.close();await rm(dir,{recursive:true,force:true});}
});
test('a new untracked file racing deletion makes Git refuse removal and restores active registration', async()=>{
 const f=await fixture();try {
 const prepare=f.db.prepare.bind(f.db);let raced=false;
 f.db.prepare=((sql:string)=>{const statement=prepare(sql);if(sql.startsWith("UPDATE workspace_sessions SET status='inactive'")){const run=statement.run.bind(statement);statement.run=((...args:any[])=>{const out=run(...args);execFileSync(process.execPath,['-e',"require('fs').writeFileSync(process.argv[1], 'keep')",join(f.tree,'raced.txt')]);raced=true;return out;}) as any;}return statement;}) as any;
 const p=await f.engine.preview('ws_test'),id=randomUUID();await f.engine.execute('ws_test',p.token,id);assert.equal((await f.wait(id)).phase,'failed');assert.ok(raced);await access(join(f.tree,'raced.txt'));assert.equal(prepare('SELECT status FROM workspace_sessions').get()!.status,'active');
 }finally{await f.finish();}
});
test('cleanup routes remain pinned to their source after removal and plugin restart', async()=>{
 const {createServer}=await import('node:http');const {RemoteSources}=await import('../server/remote-sources');const dir=await mkdtemp(join(tmpdir(),'cleanup-routes-'));let active=true;const calls:string[]=[];
 const server=createServer(async(req,res)=>{const chunks=[];for await(const chunk of req)chunks.push(chunk);const input=JSON.parse(Buffer.concat(chunks).toString());calls.push(input.op);res.setHeader('Content-Type','application/json');res.end(JSON.stringify(input.op==='catalog'?active?[{id:'ws_test',root:'/local/tree',sourceRoot:'/local/repo',mode:'worktree',baseSha:null,branch:'task',lastUsedAt:'now'}]:[]:{workspaceId:'ws_test',phase:input.op==='cleanup-status'?'done':undefined}));});
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const port=(server.address() as any).port,sources=[{endpoint:`http://127.0.0.1:${port}`,token:'x'.repeat(40)}],path=join(dir,'routes.json');
 try{let router=new RemoteSources(sources,path);await router.request({op:'cleanup-preview',workspaceId:'ws_test'});active=false;await router.request({op:'catalog'});router=new RemoteSources(sources,path);await router.request({op:'cleanup-status',workspaceId:'ws_test',requestId:randomUUID()});assert.equal(calls.at(-1),'cleanup-status');}
 finally{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));await rm(dir,{recursive:true,force:true});}
});
test('historical main checkout and same-root aliases do not disable archiving; actual other worktrees are named',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'cleanup-archive-scope-'));const ids=['ws_test','ws_main','ws_alias'],mock=mockPaseo(ids);
 const workspace=(id:string,root:string,mode:string)=>({id,root,sourceRoot:mode==='worktree'?'/local/repo':null,mode,baseSha:null,branch:id,lastUsedAt:'now'});
 const catalog=[workspace('ws_test','/local/trees/task','worktree'),workspace('ws_main','/local/repo','checkout'),workspace('ws_alias','/local/trees/./task','worktree')];
 const sourceId=randomUUID();const request=async(input:any)=>input.op==='catalog'?catalog:input.op==='pull-requests'?{status:'none',repository:'test/repo',branch:'task',checkedAt:'now'}:{sourceId,token:randomUUID(),workspaceId:'ws_test',root:'/local/trees/task',sourceRoot:'/local/repo',head:'abc',branch:'task',lastUsedAt:'now',blockers:[],changeCount:0,precious:[]};
 const c=new CleanupCoordinator(join(dir,'state.json'),request,async()=>null);
 try{const first=await c.preview({agentId:'agent1',workspaceId:'ws_test'},mock.api as any);assert.equal(first.archiveAllowed,true);assert.deepEqual(first.otherWorktrees,[]);
 ids.push('ws_other');catalog.push(workspace('ws_other','/local/trees/another-task','worktree'));const second=await c.preview({agentId:'agent1',workspaceId:'ws_test'},mock.api as any);assert.equal(second.archiveAllowed,false);assert.deepEqual(second.otherWorktrees,[{id:'ws_other',root:'/local/trees/another-task',branch:'ws_other'}]);assert.equal(mock.archives(),0);
 }finally{c.close();await rm(dir,{recursive:true,force:true});}
});
