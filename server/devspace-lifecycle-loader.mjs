let target;
export function initialize(data) { target = data.target; }
export async function load(url, context, nextLoad) {
  const result = await nextLoad(url, context);
  if (url !== target) return result;
  const source = result.source.toString(), marker = '    const localAgentProviders = buildLocalAgentProviderStatuses(';
  if (source.split(marker).length !== 2) { console.error('DevSpace lifecycle adapter disabled: incompatible server build.'); return result; }
  const runtime = new URL('./devspace-lifecycle-runtime.mjs', import.meta.url).href;
  return { ...result, source: `import { installDevspaceLifecycle } from ${JSON.stringify(runtime)};\n` + source.replace(marker, '    installDevspaceLifecycle({ app, config, workspaceStore, workspaces, processSessions, toolActivities, codeModeExecutions });\n' + marker) };
}
