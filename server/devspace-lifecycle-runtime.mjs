import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, relative, isAbsolute, resolve } from 'node:path';
const exec = promisify(execFile);
const git = async (cwd, args) => (await exec('git', ['--no-optional-locks', '-C', cwd, ...args], { encoding: 'utf8', timeout: 30000, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } })).stdout;
const inside = (base, path) => { const r = relative(base, path); return !!r && r !== '..' && !r.startsWith('../') && !r.startsWith('..\\') && !isAbsolute(r); };
const pathKey = path => { const key = resolve(path).replace(/\\/g, '/'); return process.platform === 'win32' ? key.toLowerCase() : key; };
const registeredRoot = (entry, root) => entry.some(line => line.startsWith('worktree ') && pathKey(line.slice(9)) === pathKey(root));
// Ignored content that tools regenerate: dependencies, build output and caches. Anything else ignored (.env,
// local config, data) blocks cleanup, because `git worktree remove` deletes ignored files with the worktree.
const disposableDirs = new Set([
  'node_modules', 'dist', 'build', 'target', 'coverage', '.next', '.turbo', '.cache', '.gradle', '.parcel-cache', '.svelte-kit', '.nuxt', '.vite', '.angular', '.expo', 'storybook-static',
  '__pycache__', '.pytest_cache', '.ruff_cache', '.mypy_cache', '.pytype', '.pyre', '.hypothesis', '.tox', '.nox', '.venv', 'venv', 'htmlcov', '.ipynb_checkpoints', '.eggs',
  '.terraform', '.dart_tool',
]);
const disposableFile = /(^|\/)(\.DS_Store|Thumbs\.db|\.eslintcache|\.coverage(\.[\w.-]+)?|[^/]+\.py[cod]|[^/]+\.tsbuildinfo)$/;
export const disposableExcludes = [...disposableDirs, '*.egg-info'].map(dir => `:(exclude,glob)**/${dir}/**`);
export const disposable = (path) => path.replace(/\/$/, '').split('/').some(segment => disposableDirs.has(segment) || segment.endsWith('.egg-info')) || disposableFile.test(path);
function save(path, value) { mkdirSync(join(path, '..'), { recursive: true, mode: 0o700 }); const tmp = `${path}.${randomUUID()}.tmp`; writeFileSync(tmp, JSON.stringify(value), { mode: 0o600 }); renameSync(tmp, path); }

/** Runs inside DevSpace 1.1.1, with its actual registry, store and operation tracker. */
export class DevspaceLifecycle {
  constructor(runtime, directory) {
    Object.assign(this, runtime); this.directory = directory; this.file = join(directory, 'lifecycle.json');
    this.state = existsSync(this.file) ? JSON.parse(readFileSync(this.file, 'utf8')) : { sourceId: randomUUID(), plans: {}, jobs: {} };
    this.closing = new Set(Object.values(this.state.jobs).filter(j => ['closing', 'unknown', 'done'].includes(j.phase)).map(j => j.workspaceId));
    this.runningSinceStart = new Set(); this.active = new Set(); this.context = new AsyncLocalStorage(); this.persist(); this.installGuards();
  }
  persist() { save(this.file, this.state); }
  session(id) { const result = this.workspaceStore.getSessionResult(id); if (result.isErr()) throw result.error; if (!result.value) throw new Error('Workspace registration is missing.'); return result.value; }
  installGuards() {
    const get = this.workspaces.getWorkspace.bind(this.workspaces);
    this.workspaces.getWorkspace = async (id) => {
      this.context.getStore()?.add(id);
      if (this.closing.has(id)) throw new Error('This worktree has been closed. Open a new DevSpace workspace to continue.');
      const result = await get(id);
      if (this.closing.has(id)) throw new Error('This worktree is closing.');
      return result;
    };
    const track = this.toolActivities.track;
    this.toolActivities.track = (operation) => {
      const ids = new Set(); this.active.add(ids);
      return track(() => this.context.run(ids, async () => { try { return await operation(); } finally { this.active.delete(ids); } }));
    };
    const start = this.processSessions.start.bind(this.processSessions);
    this.processSessions.start = (input) => { if (this.closing.has(input.workspaceId)) throw new Error('This worktree is closing.'); return start(input); };
    if (this.codeModeExecutions) {
      const execute = this.codeModeExecutions.start.bind(this.codeModeExecutions);
      this.codeModeExecutions.start = (id, ...args) => { if (this.closing.has(id)) throw new Error('This worktree is closing.'); return execute(id, ...args); };
    }
  }
  busy(id) {
    if ([...this.active].some(ids => !ids.size || ids.has(id))) return true;
    if ([...this.processSessions.sessions.values()].some(s => s.running && s.workspaceId === id)) return true;
    if ([...(this.codeModeExecutions?.executions.values() ?? [])].some(s => s.status === 'running' && s.workspaceId === id)) return true;
    const sqlite = this.workspaceStore.database.sqlite;
    // Local agent daemons are separate processes and are not in ToolActivityTracker.
    const table = sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='local_agent_sessions'").get();
    if (table && sqlite.prepare("SELECT 1 FROM local_agent_sessions WHERE workspace_id = ? AND status IN ('starting','running') LIMIT 1").get(id)) return true;
    return false;
  }
  async inspect(id) {
    const session = this.session(id), blockers = [];
    if (session.status !== 'active' || session.mode !== 'worktree' || !session.managed || !session.sourceRoot) throw new Error('Only active, DevSpace-managed linked worktrees can be cleaned.');
    const root = await realpath(session.root), sourceRoot = await realpath(session.sourceRoot), worktreeRoot = await realpath(this.config.worktreeRoot);
    if (!inside(worktreeRoot, root) || root === sourceRoot) throw new Error('The target is outside the managed worktree directory.');
    if (await realpath((await git(root, ['rev-parse', '--show-toplevel'])).trim()) !== root) throw new Error('The target is not a Git worktree root.');
    const common = await realpath((await git(root, ['rev-parse', '--path-format=absolute', '--git-common-dir'])).trim());
    const sourceCommon = await realpath((await git(sourceRoot, ['rev-parse', '--path-format=absolute', '--git-common-dir'])).trim());
    if (common !== sourceCommon || await realpath((await git(root, ['rev-parse', '--absolute-git-dir'])).trim()) === common) throw new Error('The target is not a linked worktree of this repository.');
    const entries = (await git(sourceRoot, ['worktree', 'list', '--porcelain', '-z'])).split('\0\0').map(s => s.split('\0'));
    const entry = entries.find(e => registeredRoot(e, root));
    if (!entry) throw new Error('Git worktree registration does not match.');
    if (entry.some(s => s.startsWith('locked'))) blockers.push('locked');
    const head = (await git(root, ['rev-parse', 'HEAD'])).trim();
    const branch = entry.find(s => s.startsWith('branch '))?.slice(7).replace(/^refs\/heads\//, '') ?? null;
    const changes = (await git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all'])).split('\0').filter(Boolean);
    if (changes.length) blockers.push('changes');
    // Cache folders are excluded by pathspec so large ones (.venv, node_modules) are never listed file by file.
    const precious = (await git(root, ['ls-files', '--others', '--ignored', '--exclude-standard', '-z', '--', '.', ...disposableExcludes])).split('\0').filter(p => p && !disposable(p));
    if (precious.length) blockers.push('ignored');
    if (this.busy(id)) blockers.push('busy');
    return { sourceId: this.state.sourceId, workspaceId: id, root, sourceRoot, head, branch, lastUsedAt: session.lastUsedAt, blockers, changeCount: changes.length, precious: precious.slice(0, 20) };
  }
  async preview(id) {
    const value = await this.inspect(id), token = randomUUID();
    this.state.plans[token] = { ...value, expires: Date.now() + 5 * 60 * 1000 };
    for (const [key, plan] of Object.entries(this.state.plans)) if (plan.expires < Date.now()) delete this.state.plans[key];
    this.persist(); return { ...value, token };
  }
  async execute(id, token, requestId) {
    const previous = this.state.jobs[requestId];
    if (previous) { if (previous.workspaceId !== id || previous.token !== token) throw new Error('Cleanup request identity changed.'); return this.status(id, requestId); }
    const plan = this.state.plans[token];
    if (!plan || plan.workspaceId !== id || plan.expires < Date.now()) throw new Error('Cleanup preview expired. Refresh it before confirming.');
    if (this.closing.has(id)) throw new Error('A cleanup is already in progress for this worktree.');
    const current = await this.inspect(id);
    if (current.blockers.length) throw new Error('Worktree is busy or contains files that need attention.');
    for (const key of ['sourceId','root','sourceRoot','head','branch','lastUsedAt']) if (plan[key] !== current[key]) throw new Error('The worktree changed after preview. Refresh before confirming.');
    // No await between the final busy check, lease and durable intent.
    if (this.busy(id) || this.closing.has(id)) throw new Error('Worktree is busy.');
    this.closing.add(id); this.runningSinceStart.add(requestId);
    const job = { ...current, token, requestId, phase: 'closing', recoveryRef: `refs/paseo-devspace-sidecar/recovery/${id}`, error: null };
    this.state.jobs[requestId] = job; this.persist();
    void this.remove(job).catch(error => console.error('Cleanup journal needs inspection:', error instanceof Error ? error.message : 'unknown')); return this.publicJob(job);
  }
  publicJob(job) { return { workspaceId: job.workspaceId, requestId: job.requestId, phase: job.phase, error: job.error, recoveryRef: job.recoveryRef }; }
  async remove(job) {
    let locked = false, inactive = false;
    try {
      await git(job.sourceRoot, ['worktree', 'lock', '--reason', 'Paseo confirmed cleanup', job.root]); locked = true;
      const check = await this.inspect(job.workspaceId);
      if (check.blockers.some(b => b !== 'locked') || check.head !== job.head || check.lastUsedAt !== job.lastUsedAt) throw new Error('The worktree changed or became busy. Refresh the preview.');
      await git(job.sourceRoot, ['update-ref', job.recoveryRef, job.head]);
      const changed = this.workspaceStore.database.sqlite.prepare("UPDATE workspace_sessions SET status='inactive' WHERE id=? AND root=? AND status='active' AND last_used_at=?").run(job.workspaceId, this.session(job.workspaceId).root, job.lastUsedAt);
      if (changed.changes !== 1) throw new Error('The workspace registration changed.');
      inactive = true;
      await git(job.sourceRoot, ['worktree', 'unlock', job.root]); locked = false;
      // Ordinary remove refuses tracked changes, untracked files and locks. Never force or stash.
      await git(job.sourceRoot, ['worktree', 'remove', job.root]);
      if (existsSync(job.root) || registeredRoot((await git(job.sourceRoot, ['worktree', 'list', '--porcelain', '-z'])).split('\0'), job.root)) throw new Error('Git cleanup could not be verified.');
      job.phase = 'done';
    } catch (error) {
      if (locked) { try { await git(job.sourceRoot, ['worktree', 'unlock', job.root]); } catch { /* report below */ } }
      const intact = existsSync(job.root);
      if (inactive && intact) this.workspaceStore.database.sqlite.prepare("UPDATE workspace_sessions SET status='active' WHERE id=? AND status='inactive'").run(job.workspaceId);
      job.phase = intact ? 'failed' : 'unknown';
      job.error = intact ? 'Cleanup did not complete. The worktree was retained; refresh its preview.' : 'Cleanup outcome needs inspection on the project host. No session was archived.';
      if (intact) this.closing.delete(job.workspaceId);
      console.error('DevSpace cleanup:', error instanceof Error ? error.message : 'unknown error');
    }
    this.persist();
  }
  async status(id, requestId) {
    const job = this.state.jobs[requestId];
    if (!job || job.workspaceId !== id) throw new Error('Cleanup receipt is unavailable.');
    // A restart during deletion is uncertain: never restart the mutation automatically.
    if (['closing','unknown'].includes(job.phase) && !this.runningSinceStart.has(requestId)) {
      const session = this.session(id);
      const registered = registeredRoot((await git(job.sourceRoot, ['worktree', 'list', '--porcelain', '-z'])).split('\0'), job.root);
      const recovery = await git(job.sourceRoot, ['rev-parse', '--verify', job.recoveryRef]).catch(() => '');
      if (session.status === 'inactive' && !existsSync(job.root) && !registered && recovery.trim() === job.head) { job.phase = 'done'; job.error = null; }
      else { job.phase = 'unknown'; job.error = 'DevSpace restarted during cleanup. Inspect the project host before continuing.'; }
      this.persist();
    }
    return this.publicJob(job);
  }
}

export function installDevspaceLifecycle(runtime) {
  try {
    const directory = process.env.PASEO_DEVSPACE_SIDECAR_HOME ?? join(homedir(), '.config', 'paseo-devspace-sidecar');
    const config = JSON.parse(readFileSync(join(directory, 'config.json'), 'utf8'));
    if (config.mode !== 'local' || typeof config.token !== 'string' || config.token.length < 32) return;
    const engine = new DevspaceLifecycle(runtime, join(directory, 'cleanup-source'));
    const expected = createHash('sha256').update(`Bearer ${config.token}`).digest();
    const authorized = (req) => {
      const actual = createHash('sha256').update(req.headers.authorization ?? '').digest();
      return !req.headers.origin && ['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress) && timingSafeEqual(expected, actual);
    };
    const body = async (req) => {
      let input = req.body;
      if (!input) { const chunks = []; let size = 0; for await (const chunk of req) { size += chunk.length; if (size > 16384) throw new Error('Request too large.'); chunks.push(chunk); } input = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
      if (JSON.stringify(input).length > 16384) throw new Error('Request too large.');
      return input;
    };
    // Review RPCs ride DevSpace's existing connection to this host, so a VPS needs no separate tunnel.
    runtime.app.post('/__paseo-devspace/rpc', async (req, res) => {
      res.setHeader('Cache-Control', 'no-store');
      if (!authorized(req)) return res.status(401).json({ error: 'Unauthorized.' });
      let input;
      try { input = await body(req); } catch (error) { return res.status(400).json({ error: error instanceof Error ? error.message : 'Invalid request.' }); }
      try {
        const upstream = await fetch(`http://127.0.0.1:${config.port}/rpc`, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(35000), headers: { Authorization: req.headers.authorization, 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
        res.status(upstream.status).set('Content-Type', 'application/json').send(Buffer.from(await upstream.arrayBuffer()));
      } catch { res.status(502).json({ error: "The project host's Paseo sidecar plugin is not running." }); }
    });
    runtime.app.post('/__paseo-devspace/cleanup', async (req, res) => {
      res.setHeader('Cache-Control', 'no-store');
      if (!authorized(req)) return res.status(401).json({ error: 'Unauthorized.' });
      let input;
      try {
        input = await body(req);
        if (!/^ws_[\w-]+$/.test(input.workspaceId ?? '')) throw new Error('Invalid workspace.');
        let value;
        if (input.op === 'cleanup-preview') value = await engine.preview(input.workspaceId);
        else if (input.op === 'cleanup-execute' && /^[\w-]{36}$/.test(input.token ?? '') && /^[\w-]{36}$/.test(input.requestId ?? '')) value = await engine.execute(input.workspaceId, input.token, input.requestId);
        else if (input.op === 'cleanup-status') value = await engine.status(input.workspaceId, input.requestId);
        else throw new Error('Invalid operation.');
        res.json(value);
      } catch (error) {
        const recorded = engine.state.jobs[input?.requestId];
        if (input?.op === 'cleanup-execute' && recorded?.workspaceId === input.workspaceId) return res.json(engine.publicJob(recorded));
        res.status(409).json({ error: error instanceof Error ? error.message : 'Cleanup failed.', rejected: input?.op === 'cleanup-execute' });
      }
    });
    console.log('Paseo DevSpace lifecycle adapter ready (1.1.1).');
  } catch (error) { console.error('Paseo cleanup adapter unavailable:', error instanceof Error ? error.message : 'unknown'); }
}
