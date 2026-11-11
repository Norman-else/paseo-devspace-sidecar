import type { PluginButtonRegistration, PluginClientContext } from "@getpaseo/plugin/client";
import { DiffPanel } from "./client/diff-panel";
import { catalogRpc } from "./shared/diff";
import { messages } from "./client/messages";

export default function contribute(client: PluginClientContext) {
  client.addAgentPanel({ id: "devspace-diff", title: "DevSpace Diff", icon: "FileDiff", locations: ["explorer", "workspace"], Component: DiffPanel });
  // Existing file tabs restore into the same review surface after upgrading.
  client.addAgentPanel({ id: "devspace-file-diff", title: messages.message("codeReview"), icon: "FileDiff", locations: ["explorer", "workspace"], Component: DiffPanel });
  client.addCommandCenterItem({ id: "open-diff", title: messages.message("openReview"), icon: "FileDiff", context: "agent",
    onSelect: ({ openPanel }) => openPanel("devspace-diff", { location: "explorer" }),
  });
  client.addSlashCommand({ name: "devspace-diff", description: messages.message("commandDescription"), argumentHint: "", context: "agent",
    onSubmit: ({ openPanel }) => openPanel("devspace-diff", { location: "explorer" }),
  });
  const pills = new Map<string, PluginButtonRegistration>();
  const lifetime = new AbortController();
  type Agent = { id: string; workspaceId?: string | null };
  const agents = new Map<string, Agent>();
  const checking = new Set<string>();
  const checkedAt = new Map<string, number>();
  const register = async (agent: Agent) => {
    if (lifetime.signal.aborted || !agent.workspaceId || checking.has(agent.id) || Date.now() - (checkedAt.get(agent.id) ?? 0) < 15000) return;
    const { id: agentId, workspaceId } = agent;
    checking.add(agentId);
    checkedAt.set(agentId, Date.now());
    try {
      const context = await client.rpc(catalogRpc, { agentId });
      if (lifetime.signal.aborted || agents.get(agentId)?.workspaceId !== workspaceId) return;
      if (!context.workspace) { pills.get(agentId)?.remove(); pills.delete(agentId); return; }
      if (!pills.has(agentId)) pills.set(agentId, client.addComposerPill({ id: "devspace-diff", agentId, workspaceId,
        button: { title: messages.message("openReview"), label: "DevSpace Diff", icon: "FileDiff", behavior: { kind: "action",
          onPress: () => client.openPanel("devspace-diff", { workspaceId, agentId, location: "explorer" }),
        } },
      }));
    } catch { /* A missing association or disconnected source must not add an unusable button. */ }
    finally { checking.delete(agentId); }
  };
  const clear = () => { for (const pill of pills.values()) pill.remove(); pills.clear(); };
  const observe = (agent: Agent) => { agents.set(agent.id, agent); void register(agent); };
  const poll = setInterval(() => { for (const agent of agents.values()) void register(agent); }, 15000);
  void client.paseo.agents.list({ subscribe: {}, signal: lifetime.signal }).then(({ subscription }) => {
    subscription.subscribe({
      snapshot: ({ entries }) => { clear(); agents.clear(); checkedAt.clear(); for (const { agent } of entries) observe(agent); },
      update: (message) => {
        if (message.type !== "agent_update") return;
        if (message.payload.kind === "upsert") observe(message.payload.agent);
        else { agents.delete(message.payload.agentId); checkedAt.delete(message.payload.agentId); pills.get(message.payload.agentId)?.remove(); pills.delete(message.payload.agentId); }
      },
    });
  }).catch((error) => { if (!lifetime.signal.aborted) console.error("DevSpace Diff agent observation failed", error); });
  return () => { lifetime.abort(); clearInterval(poll); clear(); agents.clear(); };
}
