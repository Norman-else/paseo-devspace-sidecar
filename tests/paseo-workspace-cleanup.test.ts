import { test } from 'node:test';
import assert from 'node:assert/strict';
import { archiveEmptyPaseoWorkspaces } from '../server/paseo-workspace-cleanup';
const target = { id: 'wks_task', directory: '/vps/project-context' };
function fixture(options: { agents?: any[]; terminals?: any[]; scripts?: any[]; kind?: string; owned?: boolean; directory?: string; archiveError?: boolean; lateAgent?: boolean } = {}) {
  let active = true, archives = 0, lists = 0;
  const api = {
    agents: { list: async () => { lists++; return { entries: [...(options.agents ?? []), ...(options.lateAgent && lists > 1 ? [{ id:'late',workspaceId:target.id,archivedAt:null }] : [])].map(agent => ({agent})), pageInfo: { hasMore:false } }; } },
    workspaces: { ref: (id:string) => { assert.equal(id,target.id); return {
      refresh: async () => active ? { id,name:'Task workspace',workspaceDirectory:options.directory ?? target.directory,workspaceKind:options.kind ?? 'directory',gitRuntime:{isPaseoOwnedWorktree:options.owned ?? false},scripts:options.scripts ?? [] } : null,
      terminals: { list: async () => ({entries:options.terminals ?? []}) },
      archive: async () => { archives++; if(options.archiveError)return {error:'temporary failure',archivedAt:null};active=false;return {error:null,archivedAt:'now'}; },
    }; } },
  };
  return {api,archives:()=>archives,active:()=>active};
}
test('archives an empty exact workspace while another task shares its directory',async()=>{
 const f=fixture({agents:[{id:'other',workspaceId:'wks_other',cwd:target.directory,archivedAt:null}]});
 const rows=await archiveEmptyPaseoWorkspaces(f.api as any,[target]);assert.equal(f.archives(),1);assert.equal(f.active(),false);assert.equal(rows[0].state,'archived');
 await archiveEmptyPaseoWorkspaces(f.api as any,[target],rows);assert.equal(f.archives(),1);
});
test('retains a workspace with another active agent, including background/internal agents',async()=>{
 const f=fixture({agents:[{id:'other',workspaceId:target.id,cwd:target.directory,archivedAt:null,internal:true}]});
 const rows=await archiveEmptyPaseoWorkspaces(f.api as any,[target]);assert.equal(f.archives(),0);assert.equal(rows[0].reason,'agents');assert.equal(rows[0].state,'retained');
});
test('retains terminals, running scripts, native owned worktrees and changed directories',async()=>{
 for(const [options,reason]of [[{terminals:[{id:'terminal'}]},'terminals'],[{scripts:[{lifecycle:'running'}]},'scripts'],[{kind:'worktree'},'owned_worktree'],[{owned:true},'owned_worktree'],[{directory:'/different'},'changed']] as const){const f=fixture(options as any);const rows=await archiveEmptyPaseoWorkspaces(f.api as any,[target]);assert.equal(f.archives(),0);assert.equal(rows[0].reason,reason);}
});
test('rechecks before archive and preserves an agent created after the first audit',async()=>{
 const f=fixture({lateAgent:true});const rows=await archiveEmptyPaseoWorkspaces(f.api as any,[target]);assert.equal(f.archives(),0);assert.equal(rows[0].reason,'agents');
});
test('persists archive intent and checks result without treating a payload error as success',async()=>{
 const f=fixture({archiveError:true});const states:string[]=[];await assert.rejects(archiveEmptyPaseoWorkspaces(f.api as any,[target],[],rows=>states.push(rows[0].state)),/temporary failure/);assert.deepEqual(states,['pending']);assert.equal(f.active(),true);
});
