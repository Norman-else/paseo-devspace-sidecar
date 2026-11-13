import type { PluginHandlerContext } from '@getpaseo/plugin/server';
import type { PaseoWorkspaceCleanup } from '../shared/cleanup';
import { samePath } from './paths';
type PaseoApi = PluginHandlerContext['paseo'];
export type WorkspaceTarget = { id: string; directory: string };

/** Only retires exact, empty Paseo workspace records; it never removes a directory. */
export async function archiveEmptyPaseoWorkspaces(paseo: PaseoApi, targets: WorkspaceTarget[], previous: PaseoWorkspaceCleanup[] = [], persist: (rows: PaseoWorkspaceCleanup[]) => void = () => {}) {
  const rows = previous.map(row => ({ ...row }));
  const record = (row: PaseoWorkspaceCleanup) => {
    const index = rows.findIndex(item => item.id === row.id);
    if (index < 0) rows.push(row); else rows[index] = row;
    persist(rows.map(item => ({ ...item })));
  };
  for (const target of targets) {
    if (rows.some(row => row.id === target.id && row.state === 'archived')) continue;
    const handle = paseo.workspaces.ref(target.id);
    const audit = async () => {
      const workspace = await handle.refresh();
      if (!workspace) return { workspace, reason: null };
      if (!workspace.workspaceDirectory || !samePath(workspace.workspaceDirectory, target.directory)) return { workspace, reason: 'changed' as const };
      if (workspace.workspaceKind === 'worktree' || workspace.gitRuntime?.isPaseoOwnedWorktree || workspace.project?.checkout.isPaseoOwnedWorktree) return { workspace, reason: 'owned_worktree' as const };
      let cursor: string | undefined;
      for (let pageNumber = 0; ; pageNumber++) {
        const page = await paseo.agents.list({ includeBackground: true, filter: { includeBackground: true, includeInternal: true }, page: { limit: 100, cursor } });
        // Never identify ownership by directory: distinct tasks can share the same VPS context.
        if (page.entries.some(({ agent }) => !agent.archivedAt && (agent.workspaceId === target.id || !agent.workspaceId && samePath(agent.cwd, target.directory)))) return { workspace, reason: 'agents' as const };
        if (!page.pageInfo.hasMore) break;
        if (!page.pageInfo.nextCursor || pageNumber >= 99) throw new Error('Cannot verify all workspace agents.');
        cursor = page.pageInfo.nextCursor;
      }
      if ((await handle.terminals.list()).entries.length) return { workspace, reason: 'terminals' as const };
      if (workspace.scripts.some(script => script.lifecycle === 'running')) return { workspace, reason: 'scripts' as const };
      return { workspace, reason: null };
    };
    let check = await audit();
    const row: PaseoWorkspaceCleanup = { ...target, name: check.workspace?.name ?? target.id, state: 'pending', reason: null };
    if (!check.workspace) { record({ ...row, state: 'archived' }); continue; }
    if (check.reason) { record({ ...row, state: 'retained', reason: check.reason }); continue; }
    record(row);
    // Persist intent first, then recheck for a terminal, script or agent created during the preview.
    check = await audit();
    if (check.reason) { record({ ...row, state: 'retained', reason: check.reason }); continue; }
    if (check.workspace) {
      const result = await handle.archive();
      if (result.error || !result.archivedAt) throw new Error(result.error ?? 'Paseo workspace archiving is not confirmed.');
      if (await handle.refresh()) throw new Error('Paseo workspace is still active. Retry archiving to check its status.');
    }
    record({ ...row, state: 'archived' });
  }
  return rows;
}
