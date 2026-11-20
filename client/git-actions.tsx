import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useAgent, useRpc } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/ui";
import { gitStatusRpc, isWorktree, type Workspace } from "../shared/diff";
import { gitActionPrompt, planGitActions, type GitAction, type GitPlan, type PrPresence } from "../shared/git-actions";
import type { FeedbackDraft } from "./feedback-composer";
import { ReviewMenu } from "./review-menu";
import type { Colors } from "./review-ui";
import { useMessages } from "./messages";

const labels = { "commit": "gitActionCommit", "commit-push": "gitActionCommitPush", "commit-pr": "gitActionCommitPr", "push": "gitActionPush", "push-pr": "gitActionPushPr", "pr": "gitActionPr", "branch-commit": "gitActionBranchCommit", "branch-pr": "gitActionBranchPr" } as const;
const helps = { "commit": "gitHelpCommit", "commit-push": "gitHelpCommitPush", "commit-pr": "gitHelpCommitPr", "push": "gitHelpPush", "push-pr": "gitHelpPushPr", "pr": "gitHelpPr", "branch-commit": "gitHelpBranchCommit", "branch-pr": "gitHelpBranchPr" } as const;
const shortPath = (root: string) => root.replace(/^\/(Users|home)\/[^/]+/, "~");

export type GitActionsState = { plan: GitPlan; summary: string; busy: boolean; start(action: GitAction): void };

/**
 * Decides which Commit / Push / Create PR actions fit the bound workspace right now.
 * An action is handed to the session's agent, which writes the commit message and PR description itself.
 */
export function useGitActions({ workspace, agentId, pr, openPr, revision, hostId, onDraft, onAgentFinished }: {
  workspace: Workspace | null | undefined; agentId: string; pr: PrPresence; openPr?: number; revision?: string; hostId: string;
  onDraft(draft: FeedbackDraft): void; onAgentFinished(): void;
}): GitActionsState | null {
  const { t } = useMessages();
  const statusCall = useRpc(gitStatusRpc);
  const status = useQuery({ queryKey: ["devspace-git-status", hostId, workspace?.id, workspace?.branch, revision], queryFn: () => statusCall({ workspaceId: workspace!.id }), enabled: !!workspace, refetchInterval: 10000, retry: false, placeholderData: (previous) => previous });
  const agentStatus = useAgent(agentId, (agent) => agent.status);
  const busy = agentStatus === "running" || agentStatus === "initializing";
  // When the agent finishes a turn it may have committed, pushed or opened a PR: re-read Git and GitHub.
  const previous = useRef(agentStatus), finished = useRef(onAgentFinished); finished.current = onAgentFinished;
  useEffect(() => {
    if (previous.current === "running" && agentStatus !== "running") { void status.refetch(); finished.current(); }
    previous.current = agentStatus;
  }, [agentStatus]);
  const s = status.data;
  if (!workspace || !s) return null;
  const plan = planGitActions(s, pr);
  if (!plan) return null;
  const parts: string[] = [];
  if (!s.branch) parts.push(t("gitDetached"));
  else if (s.branch === s.defaultBranch) parts.push(t("gitOnDefault", { branch: s.branch }));
  if (s.changed) parts.push(t("gitChanged", { count: s.changed }));
  if (plan.unpushed) parts.push(t("gitUnpushed", { count: plan.unpushed }));
  if (s.behind) parts.push(t("gitBehind", { count: s.behind }));
  if (pr === "none" && s.branch && s.branch !== s.defaultBranch) parts.push(t("gitNoPr"));
  const summary = "blocked" in plan ? t("gitConflicts") : busy ? t("gitAgentBusy") : parts.join(" · ");
  const start = (action: GitAction) => {
    const prompt = gitActionPrompt(action, s, { id: workspace.id, root: workspace.root, worktree: isWorktree(workspace) }, openPr);
    onDraft({ title: t(labels[action]), intent: "git", instruction: t(helps[action]), context: prompt,
      attachment: { source: `${s.branch ?? t("gitDetached")} · ${shortPath(workspace.root)}`, preview: { kind: "text", text: prompt } } });
  };
  return { plan, summary, busy, start };
}

/**
 * Split button for the current Git step. "primary" is the filled main call to action (no PR yet);
 * "secondary" is outlined so it sits beside the PR's merge button without competing with it.
 */
export function GitActionButton({ state, colors, compact, variant }: { state: GitActionsState; colors: Colors; compact: boolean; variant: "primary" | "secondary" }) {
  const { t } = useMessages();
  const [hover, setHover] = useState(false);
  const { plan, busy } = state;
  if ("blocked" in plan) return <View style={{ flexDirection: "row", alignItems: "center", gap: 4, flexShrink: 1 }}><Icon name="TriangleAlert" size={13} color={colors.statusWarning} /><Text numberOfLines={1} style={{ color: colors.statusWarning, fontSize: 12, lineHeight: 18 }}>{t("gitConflicts")}</Text></View>;
  const primary = variant === "primary" && !busy;
  const foreground = busy ? colors.foregroundMuted : primary ? colors.accentForeground : colors.foreground;
  const background = primary ? colors.accent : hover ? colors.surface2 : "transparent", border = primary ? colors.accent : colors.border;
  const height = compact ? 32 : 28, split = plan.alternatives.length > 0, hint = busy ? t("gitAgentBusy") : t(helps[plan.primary]);
  return <View testID="devspace-git-action" style={{ flexDirection: "row", alignItems: "center", flexShrink: 0, zIndex: 20 }}>
    <Pressable accessibilityRole="button" accessibilityLabel={t(labels[plan.primary])} accessibilityHint={hint} accessibilityState={{ disabled: busy }} disabled={busy} onPress={() => state.start(plan.primary)}
      onHoverIn={() => setHover(true)} onHoverOut={() => setHover(false)} style={{ minHeight: compact ? 44 : 28, justifyContent: "center" }}>
      {({ pressed }) => <View style={{ height, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, borderWidth: 1, borderColor: border, backgroundColor: background, opacity: pressed ? 0.75 : busy ? 0.7 : 1,
        borderTopLeftRadius: 4, borderBottomLeftRadius: 4, borderTopRightRadius: split ? 0 : 4, borderBottomRightRadius: split ? 0 : 4, borderRightWidth: split ? 0 : 1 }}>
        {busy ? <ActivityIndicator size="small" color={foreground} /> : <Icon name="Sparkles" size={12} color={foreground} />}
        <Text numberOfLines={1} style={{ color: foreground, fontSize: 11, lineHeight: 16, fontWeight: "600" }}>{t(labels[plan.primary])}</Text>
      </View>}
    </Pressable>
    {split ? <ReviewMenu title={t("gitActionsTitle")} colors={colors} touch={compact} align="right" width={320} trigger={({ open, toggle }) => <Pressable accessibilityRole="button" accessibilityLabel={t("gitActionsTitle")} accessibilityState={{ expanded: open, disabled: busy }} aria-expanded={open} disabled={busy} onPress={toggle} style={{ minHeight: compact ? 44 : 28, justifyContent: "center" }}>
      <View style={{ width: compact ? 36 : 26, height, alignItems: "center", justifyContent: "center", backgroundColor: primary ? colors.accent : open ? colors.surface2 : "transparent", borderWidth: 1, borderLeftWidth: 0, borderColor: border, borderTopRightRadius: 4, borderBottomRightRadius: 4, opacity: busy ? 0.7 : 1 }}>
        <View pointerEvents="none" style={{ position: "absolute", left: 0, top: 5, bottom: 5, width: 1, backgroundColor: primary ? foreground : colors.border, opacity: primary ? 0.25 : 1 }} />
        <Icon name="ChevronDown" size={13} color={foreground} />
      </View>
    </Pressable>} options={[plan.primary, ...plan.alternatives].map((action) => ({ id: action, label: t(labels[action]), description: t(helps[action]), onSelect: () => state.start(action) }))} /> : null}
  </View>;
}
