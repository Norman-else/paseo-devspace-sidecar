import type { BridgeRequest } from '../shared/diff';
/** Talks to the version-pinned lifecycle extension inside the actual DevSpace process. */
export async function cleanupRequest(config: { token: string; devspaceEndpoint?: string }, input: BridgeRequest): Promise<unknown> {
  const url = new URL(config.devspaceEndpoint ?? 'http://127.0.0.1:7676');
  if (url.protocol !== 'http:' || !['127.0.0.1','localhost','[::1]'].includes(url.hostname) || url.username || url.password || url.hash || url.search) throw new Error('DevSpace lifecycle endpoint must use loopback HTTP.');
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(new URL('/__paseo-devspace/cleanup', url), { method: 'POST', redirect: 'error', signal: controller.signal, headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
    if (response.status === 404) throw new Error('Install the DevSpace lifecycle adapter on the project host before cleaning worktrees.');
    const value = await response.json() as { error?: string; rejected?: boolean };
    if (value.rejected && input.op === 'cleanup-execute') return { workspaceId: input.workspaceId, requestId: input.requestId, phase: 'failed', error: value.error ?? 'Cleanup was rejected.', recoveryRef: '' };
    if (!response.ok) throw new Error(value.error ?? 'DevSpace cleanup request failed.');
    return value;
  } catch (error) { if (error instanceof TypeError) throw new Error('Cannot reach the DevSpace lifecycle adapter on the project host.'); throw error; } finally { clearTimeout(timer); }
}
