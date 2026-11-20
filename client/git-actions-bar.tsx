import { useEffect, useRef } from "react";
import { Pressable, Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useAgent, useRpc } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/ui";
import { gitStatusRpc, isWorktree, type Workspace } from "../shared/diff";
import { gitActionPrompt, planGitActions, type GitAction, type PrPresence } from "../shared/git-actions";
import type { FeedbackDraft } from "./feedback-composer";
import { ReviewMenu } from "./review-menu";
import type { Colors } from "./review-ui";
import { useMessages } from "./messages";

const labels = { "commit": "gitActionCommit", "commit-push": "gitActionCommitPush", "commit-pr": "gitActionCommitPr", "push": "gitActionPush", "push-pr": "gitActionPushPr", "pr": "gitActionPr", "branch-commit": "gitActionBranchCommit", "branch-pr": "gitActionBranchPr" } as const;
const helps = { "commit": "gitHelpCommit", "commit-push": "gitHelpCommitPush", "commit-pr": "gitHelpCommitPr", "push": "gitHelpPush", "push-pr": "gitHelpPushPr", "pr": "gitHelpPr", "branch-commit": "gitHelpBranchCommit", "branch-pr": "gitHelpBranchPr" } as const;
const shortPath = (root: string) => root.replace(/^\/(Users|home)\/[^/]+/, "~");

/**
 * Offers Commit / Push / Create PR when the bound workspace has work that is not on GitHub yet.
 * The action is handed to the session's agent, which writes the commit message and PR description itself.
 */
export function GitActionsBar({ workspace, agentId, pr, openPr, revision, colors, compact, hostId, onDraft, onAgentFinished }: {
  workspace: Workspace; agentId: string; pr: PrPresence; openPr?: number; revision?: string; colors: Colors; compact: boolean; hostId: string;
  onDraft(draft: FeedbackDraft): void; onAgentFinished(): void;
}) {
  const { t } = useMessages();
  const statusCall = useRpc(gitStatusRpc);
  const status = useQuery({ queryKey: ["devspace-git-status", hostId, workspace.id, workspace.branch, revision], queryFn: () => statusCall({ workspaceId: workspace.id }), refetchInterval: 10000, retry: false, placeholderData: (previous) => previous });
  const agentStatus = useAgent(agentId, (agent) => agent.status);
  const busy = agentStatus === "running" || agentStatus === "initializing";
  // When the agent finishes a turn it may have committed, pushed or opened a PR: re-read Git and GitHub.
  const previous = useRef(agentStatus), finished = useRef(onAgentFinished); finished.current = onAgentFinished;
  useEffect(() => {
    if (previous.current === "running" && agentStatus !== "running") { void status.refetch(); finished.current(); }
    previous.current = agentStatus;
  }, [agentStatus]);
  const s = status.data;
  if (!s) return null;
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
  const disabled = busy || "blocked" in plan;
  const foreground = disabled ? colors.foregroundMuted : colors.accentForeground, background = disabled ? colors.surface2 : colors.accent, border = disabled ? colors.border : colors.accent;
  const height = compact ? 32 : 26, split = !("blocked" in plan) && plan.alternatives.length > 0;
  return <View testID="devspace-git-actions" style={{ position: "relative", zIndex: 25, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12, paddingVertical: 6, borderTopWidth: 1, borderBottomWidth: 1, borderColor: colors.border, backgroundColor: colors.surface1 }}>
    <Icon name={"blocked" in plan ? "TriangleAlert" : "GitCommitHorizontal"} size={14} color={"blocked" in plan ? colors.statusWarning : colors.foregroundMuted} />
    <Text numberOfLines={compact ? 2 : 1} style={{ flex: 1, minWidth: 0, color: "blocked" in plan ? colors.statusWarning : colors.foregroundMuted, fontSize: 12, lineHeight: 18 }}>{summary}</Text>
    {"blocked" in plan ? null : <View style={{ flexDirection: "row", alignItems: "center", flexShrink: 0 }}>
      <Pressable accessibilityRole="button" accessibilityLabel={t(labels[plan.primary])} accessibilityHint={t(helps[plan.primary])} accessibilityState={{ disabled }} disabled={disabled} onPress={() => start(plan.primary)} style={{ minHeight: compact ? 44 : 28, justifyContent: "center" }}>
        {({ pressed }) => <View style={{ height, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, borderWidth: 1, borderColor: border, backgroundColor: background, opacity: pressed ? 0.75 : 1,
          borderTopLeftRadius: 4, borderBottomLeftRadius: 4, borderTopRightRadius: split ? 0 : 4, borderBottomRightRadius: split ? 0 : 4, borderRightWidth: split ? 0 : 1 }}>
          <Icon name="Sparkles" size={12} color={foreground} />
          <Text numberOfLines={1} style={{ color: foreground, fontSize: 11, lineHeight: 16, fontWeight: "600" }}>{t(labels[plan.primary])}</Text>
        </View>}
      </Pressable>
      {split ? <ReviewMenu title={t("gitActionsTitle")} colors={colors} touch={compact} align="right" width={320} trigger={({ open, toggle }) => <Pressable accessibilityRole="button" accessibilityLabel={t("gitActionsTitle")} accessibilityState={{ expanded: open, disabled }} aria-expanded={open} disabled={disabled} onPress={toggle} style={{ minHeight: compact ? 44 : 28, justifyContent: "center" }}>
        <View style={{ width: compact ? 36 : 26, height, alignItems: "center", justifyContent: "center", backgroundColor: background, borderWidth: 1, borderLeftWidth: 0, borderColor: border, borderTopRightRadius: 4, borderBottomRightRadius: 4 }}>
          <View pointerEvents="none" style={{ position: "absolute", left: 0, top: 5, bottom: 5, width: 1, backgroundColor: foreground, opacity: 0.25 }} />
          <Icon name="ChevronDown" size={13} color={foreground} />
        </View>
      </Pressable>} options={[plan.primary, ...plan.alternatives].map((action) => ({ id: action, label: t(labels[action]), description: t(helps[action]), onSelect: () => start(action) }))} /> : null}
    </View>}
  </View>;
}
