import { samePath } from "./paths";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname, delimiter } from "node:path";
import type { PluginHandlerContext } from '@getpaseo/plugin/server';
type PaseoApi = PluginHandlerContext['paseo'];
type PaseoAgent = Awaited<ReturnType<PaseoApi['agents']['list']>>['entries'][number]['agent'];
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { BridgeRequest } from '../shared/diff';
import { devspaceWorkspaceIds, workspaceSchema } from '../shared/diff';
import { cleanupPreviewSchema, sourcePreviewSchema, sourceJobSchema, type CleanupPreview, type CleanupResult } from '../shared/cleanup';
import { pullRequestResultSchema } from '../shared/pull-request';
import { readPrivate, writePrivate } from './cleanup-store';
import { z } from 'zod';
const exec = promisify(execFile);
const paseoCommand = [join(homedir(), '.local/bin/paseo'), join(homedir(), '.bun/bin/paseo')].find(path => existsSync(path)) ?? 'paseo';
type Binding = { ids: string[]; parent: string | null; complete: boolean };
type Plan = { preview: CleanupPreview; agentId: string; affected: string[]; expires: number };
type Job = { result: CleanupResult; plan: Plan; attempted: boolean };
type State = { bindings: Record<string, Binding>; plans: Record<string, Plan>; jobs: Record<string, Job> };
const busy = (a: PaseoAgent) => a.status === 'running' || a.status === 'initializing' || !!a.activeTurn || a.pendingPermissions.length > 0;
export class CleanupCoordinator {
  private state: State;
  private executing = new Map<string, Promise<CleanupResult>>();
  private working = new Set<string>();
  private closed = false;
  constructor(private path: string, private request: (input: BridgeRequest) => Promise<unknown>, private parentOf = async (id: string): Promise<string | null> => {
    // The public SDK does not expose parent links in 0.15.4; use the public, local-host CLI.
    const value = JSON.parse((await exec(paseoCommand, ['agent','inspect',id,'--json'], { timeout: 15000, maxBuffer: 1024 * 1024, env: { ...process.env, PATH: [dirname(process.execPath), ...(paseoCommand === 'paseo' ? [] : [dirname(paseoCommand)]), process.env.PATH ?? ''].join(delimiter) } })).stdout);
    if (!Object.hasOwn(value, 'ParentAgentId')) throw new Error('Cannot verify the session hierarchy.');
    return value.ParentAgentId;
  }) { this.state = readPrivate(path, { bindings: {}, plans: {}, jobs: {} }); }
  private save() { writePrivate(this.path, this.state); }
  close() { this.closed = true; }
  async observe(paseo: PaseoApi, agentId: string, parent?: string | null) {
    const ids = new Set(this.state.bindings[agentId]?.ids ?? []);
    let page = await paseo.agents.ref(agentId).timeline.refetch({ direction: 'tail', limit: 200 });
    for (let count = 0; ; count++) {
      if (page.error) throw new Error('Cannot verify this session history.');
      devspaceWorkspaceIds(page).forEach(id => ids.add(id));
      if (!page.hasOlder) break;
      if (!page.startCursor || count >= 99) throw new Error('Session history is too large to verify safely.');
      page = await paseo.agents.ref(agentId).timeline.refetch({ direction: 'before', cursor: page.startCursor, limit: 200 });
    }
    this.state.bindings[agentId] = { ids: [...ids], parent: parent === undefined ? await this.parentOf(agentId) : parent, complete: true }; this.save();
  }
  receipt(agentId: string) { return Object.values(this.state.jobs).filter(j => j.plan.agentId === agentId).at(-1)?.result; }
  private async actors(paseo: PaseoApi, agentId: string, workspaceId: string, root: string) {
    const agents: PaseoAgent[] = []; let cursor: string | undefined;
    for (let count = 0; ; count++) {
      const page = await paseo.agents.list({ includeBackground: true, filter: { includeInternal: true, includeBackground: true }, page: { limit: 100, cursor } });
      agents.push(...page.entries.map(e => e.agent));
      if (!page.pageInfo.hasMore) break;
      if (!page.pageInfo.nextCursor || count >= 99) throw new Error('Cannot verify the complete active session list.');
      cursor = page.pageInfo.nextCursor;
    }
    if (!agents.some(a => a.id === agentId)) { const value = await paseo.agents.ref(agentId).refresh(); if (!value) throw new Error('The associated session is unavailable.'); agents.push(value.agent); }
    // Read every active session: an unobserved shared worktree must not be silently missed.
    for (let start = 0; start < agents.length; start += 4) await Promise.all(agents.slice(start, start + 4).map(a => this.observe(paseo, a.id)));
    const affected = new Set([agentId]);
    for (let pass = 0; pass < agents.length; pass++) for (const a of agents) if (this.state.bindings[a.id]?.parent && affected.has(this.state.bindings[a.id].parent!)) affected.add(a.id);
    const related = agents.filter(a => affected.has(a.id));
    const shared = agents.some(a => !affected.has(a.id) && !a.archivedAt && (this.state.bindings[a.id]?.ids.includes(workspaceId) || a.cwd === root));
    const blocked = shared ? ['shared'] : related.some(busy) ? ['agents_busy'] : [];
    const active = z.array(workspaceSchema).parse(await this.request({ op: 'catalog' }));
    const relatedIds = new Set(related.flatMap(a => this.state.bindings[a.id]?.ids ?? []));
    // An old call against the main checkout is not another task worktree.
    const otherWorktrees = active.filter(w => w.mode === 'worktree' && w.id !== workspaceId && !samePath(w.root, root) && relatedIds.has(w.id));
    return { related, blocked, other: otherWorktrees.length > 0, otherWorktrees, affected: [...affected].sort() };
  }
  async preview(input: { agentId: string; workspaceId: string; prNumber?: number }, paseo: PaseoApi) {
    const local = sourcePreviewSchema.parse(await this.request({ op: 'cleanup-preview', workspaceId: input.workspaceId }));
    const actors = await this.actors(paseo, input.agentId, input.workspaceId, local.root);
    if (!this.state.bindings[input.agentId]?.ids.includes(input.workspaceId)) throw new Error('This worktree is not associated with the current session.');
    const prs = pullRequestResultSchema.parse(await this.request({ op: 'pull-requests', workspaceId: input.workspaceId }));
    const pr = prs.status === 'available' ? input.prNumber ? prs.pullRequests.find(p => p.number === input.prNumber) : prs.pullRequests[0] : undefined;
    const blockers = [...local.blockers, ...actors.blocked];
    if (pr?.state === 'MERGED' && pr.headSha !== local.head) blockers.push('head_changed');
    const preview = cleanupPreviewSchema.parse({ ...local, blockers, planId: randomUUID(), prState: pr?.state ?? (prs.status === 'none' ? 'NONE' : 'UNKNOWN'), prNumber: pr?.number ?? null, archiveAllowed: !actors.other, archiveReason: actors.other ? 'other_worktrees' : null, otherWorktrees: actors.otherWorktrees.map(w => ({ id: w.id, root: w.root, branch: w.branch })), agents: actors.related.map(a => ({ id: a.id, title: a.title ?? a.id, status: a.status })) });
    this.state.plans[preview.planId] = { preview, agentId: input.agentId, affected: actors.affected, expires: Date.now() + 300000 };
    for (const [id,p] of Object.entries(this.state.plans)) if (p.expires < Date.now()) delete this.state.plans[id];
    this.save(); return preview;
  }
  execute(input: { planId: string; archive: boolean; acknowledgeUnmerged: boolean }, paseo: PaseoApi): Promise<CleanupResult> {
    const previous = this.executing.get(input.planId); if (previous) return previous;
    const task = this.executeOnce(input, paseo).catch(error => {
      const existing = Object.values(this.state.jobs).find(j => j.plan.preview.planId === input.planId);
      if (existing) return existing.result;
      const plan = this.state.plans[input.planId]; if (!plan) throw error;
      const result: CleanupResult = { requestId: randomUUID(), workspaceId: plan.preview.workspaceId, root: plan.preview.root, branch: plan.preview.branch, phase: 'failed', archive: false, error: error instanceof Error ? error.message : 'Cleanup was rejected.' };
      this.state.jobs[result.requestId] = { result, plan, attempted: false }; this.save(); return result;
    }).finally(() => this.executing.delete(input.planId)); this.executing.set(input.planId, task); return task;
  }
  private async executeOnce(input: { planId: string; archive: boolean; acknowledgeUnmerged: boolean }, paseo: PaseoApi) {
    const prior = Object.values(this.state.jobs).find(j => j.plan.preview.planId === input.planId);
    if (prior) return this.status(prior.result.requestId, paseo, false);
    const plan = this.state.plans[input.planId];
    if (!plan || plan.expires < Date.now()) throw new Error('Cleanup preview expired. Refresh before confirming.');
    if (plan.preview.blockers.length || input.archive && !plan.preview.archiveAllowed || plan.preview.prState !== 'MERGED' && !input.acknowledgeUnmerged) throw new Error('Review the cleanup requirements before confirming.');
    const actors = await this.actors(paseo, plan.agentId, plan.preview.workspaceId, plan.preview.root);
    if (actors.blocked.length || actors.affected.join() !== plan.affected.join() || input.archive && actors.other) throw new Error('The associated sessions changed or are busy. Refresh the preview.');
    // Refresh PR identity, independent of the client display.
    const prs = pullRequestResultSchema.parse(await this.request({ op: 'pull-requests', workspaceId: plan.preview.workspaceId }));
    if (plan.preview.prState === 'MERGED' && (prs.status !== 'available' || !prs.pullRequests.some(p => p.number === plan.preview.prNumber && p.state === 'MERGED' && p.headSha === plan.preview.head))) throw new Error('The merged PR identity could not be verified. Refresh the preview.');
    const result: CleanupResult = { requestId: randomUUID(), workspaceId: plan.preview.workspaceId, root: plan.preview.root, branch: plan.preview.branch, phase: 'cleaning', archive: input.archive, error: null };
    const job = { result, plan, attempted: true }; this.state.jobs[result.requestId] = job; this.save();
    try { const local = sourceJobSchema.parse(await this.request({ op: 'cleanup-execute', workspaceId: result.workspaceId, token: plan.preview.token, requestId: result.requestId })); if (local.phase === 'failed') { result.phase = 'failed'; result.error = local.error; this.save(); } }
    catch { result.phase = 'unknown'; result.error = 'Cleanup outcome is not yet confirmed. Check its status; do not start another deletion.'; this.save(); }
    void this.poll(result.requestId, paseo); return result;
  }
  private async poll(id: string, paseo: PaseoApi) {
    for (let i = 0; i < 30 && !this.closed; i++) { await new Promise(resolve => setTimeout(resolve, 1000)); try { const r = await this.status(id, paseo, false); if (r.phase !== 'cleaning' && r.phase !== 'unknown') return; } catch { return; } }
  }
  async status(id: string, paseo: PaseoApi, retryArchive: boolean) {
    const job = this.state.jobs[id]; if (!job) throw new Error('Cleanup receipt is unavailable.');
    if (this.working.has(id)) return job.result;
    this.working.add(id);
    try {
      const result = job.result;
      if (['cleaning','unknown'].includes(result.phase)) {
        const local = sourceJobSchema.parse(await this.request({ op: 'cleanup-status', workspaceId: result.workspaceId, requestId: id }));
        result.recoveryRef = local.recoveryRef; result.error = local.error;
        result.phase = local.phase === 'done' ? result.archive ? 'archive_pending' : 'done' : local.phase === 'closing' ? 'cleaning' : local.phase;
        this.save();
        if (result.phase === 'archive_pending') retryArchive = true;
      }
      if (result.phase === 'archive_pending' && retryArchive) {
        try {
          const existing = await Promise.all(job.plan.affected.map(id => paseo.agents.ref(id).refresh()));
          if (existing.every(value => value?.agent.archivedAt)) { result.phase = 'done'; result.error = null; this.save(); return result; }
          const actors = await this.actors(paseo, job.plan.agentId, result.workspaceId, result.root);
          if (actors.blocked.length || actors.other || actors.affected.join() !== job.plan.affected.join()) throw new Error('Sessions changed, are busy, or use another worktree. Retry archiving after reviewing them.');
          // Recheck immediately before the public, non-force archive operation.
          for (const a of actors.related) { const fresh = await paseo.agents.ref(a.id).refresh(); if (!fresh || busy(fresh.agent)) throw new Error('An associated session is running. Retry archiving when it is idle.'); }
          await paseo.agents.ref(job.plan.agentId).archive(); result.phase = 'done'; result.error = null;
        } catch (error) { result.error = error instanceof Error ? error.message : 'Session archiving is pending.'; }
        this.save();
      }
      return result;
    } finally { this.working.delete(id); }
  }
  assertCanOpen(agentId: string, purpose: string) {
    if (purpose === 'history') return;
    const job = Object.values(this.state.jobs).find(j => j.plan.affected.includes(agentId) && ['cleaning','unknown','archive_pending','done'].includes(j.result.phase));
    if (job) throw new Error('This session references a closed or closing worktree. Read its history, or open a new session with a new DevSpace workspace.');
  }
}
