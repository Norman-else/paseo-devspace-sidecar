import { useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { ExternalLink, Icon, ScrollView } from "@getpaseo/plugin/client/ui";
import type { PullRequest, PullRequestResult } from "../shared/pull-request";
import { diffBackground } from "../shared/appearance";
import type { Colors } from "./review-ui";
import { useMessages } from "./messages";

type Available = Extract<PullRequestResult, { status: "available" }>;
export function PullRequestStatus({ result, loading, error, colors }: {
  result?: PullRequestResult; loading: boolean; error: Error | null; colors: Colors;
}) {
  const { t } = useMessages();
  const [selectedNumber, setSelectedNumber] = useState<number | null>(null);
  const note = { paddingHorizontal: 12, paddingVertical: 10, gap: 8, flexDirection: "row" as const, alignItems: "center" as const, borderBottomWidth: 1, borderColor: colors.border };
  const muted = { color: colors.foregroundMuted, fontSize: 11, lineHeight: 16, flex: 1 };
  if (!result && loading) return <View style={note}><ActivityIndicator size="small" color={colors.foregroundMuted} /><Text style={muted}>{t("prLoading")}</Text></View>;
  if (error || result?.status === "unavailable") {
    const labels = { gh_missing: "prGhMissing", auth_required: "prAuthRequired", unsupported_remote: "prUnsupported", no_remote: "prNoRemote", detached_head: "prDetached", request_failed: "prUnavailable" } as const;
    return <View style={note}><Icon name="CircleAlert" size={15} color={colors.statusWarning} /><Text style={muted}>{t(result?.status === "unavailable" ? labels[result.reason] : "prUnavailable")}</Text></View>;
  }
  if (!result) return null;
  if (result.status === "none") return null;
  const active = result.pullRequests.find((pr) => pr.number === selectedNumber) ?? result.pullRequests[0];
  if (!active) return null;
  return <View style={{ paddingHorizontal: 12, paddingVertical: 10, gap: 6, borderBottomWidth: 1, borderColor: colors.border, backgroundColor: colors.surface0 }} testID="devspace-pull-request-status">
    {result.pullRequests.length > 1 ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingBottom: 2 }}>
      {result.pullRequests.map((pr) => <Pressable key={pr.number} accessibilityRole="button" accessibilityLabel={t("prSelect", { number: pr.number })} accessibilityState={{ selected: active.number === pr.number }}
        onPress={() => setSelectedNumber(pr.number)} style={{ paddingHorizontal: 8, paddingVertical: 5, borderRadius: 4, backgroundColor: active.number === pr.number ? colors.surface2 : colors.surface1 }}>
        <Text style={{ fontSize: 11, color: active.number === pr.number ? colors.foreground : colors.foregroundMuted }}>#{pr.number} → {pr.baseBranch}</Text>
      </Pressable>)}
    </ScrollView> : null}
    <PullRequestSummary key={active.number} pr={active} result={result} colors={colors} />
  </View>;
}

function PullRequestSummary({ pr, result, colors }: { pr: PullRequest; result: Available; colors: Colors }) {
  const { t } = useMessages();
  const [expanded, setExpanded] = useState(false);
  const stateKey = { OPEN: "prOpen", DRAFT: "prDraft", MERGED: "prMerged", CLOSED: "prClosed" } as const;
  const tone = pr.state === "OPEN" ? colors.statusSuccess : pr.state === "CLOSED" ? colors.statusDanger : pr.state === "MERGED" ? colors.accent : colors.foregroundMuted;
  const checks = pr.checks;
  const checkTone = checks.status === "failed" ? colors.statusDanger : checks.status === "passed" ? colors.statusSuccess : checks.status === "pending" ? colors.statusWarning : colors.foregroundMuted;
  const checksLabel = checks.status === "passed" ? t("prChecksPassed", { count: checks.passed }) : checks.status === "failed" ? t("prChecksFailed", { count: checks.failed }) : checks.status === "pending" ? t("prChecksPending", { count: checks.pending }) : t(checks.status === "none" ? "prNoChecks" : checks.status === "skipped" ? "prChecksSkipped" : "prChecksUnknown");
  return <>
    <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 8 }}>
      <View style={{ flex: 1, minWidth: 0, minHeight: 24, flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
      <Icon name={pr.state === "MERGED" ? "GitMerge" : "GitPullRequest"} size={16} color={tone} />
      <Text numberOfLines={1} ellipsizeMode="middle" style={{ flexShrink: 1, minWidth: 0, maxWidth: "30%", color: colors.foregroundMuted, fontSize: 11, lineHeight: 16 }}>{result.repository}</Text>
      <Text style={{ color: colors.foregroundMuted, fontSize: 11 }}>/</Text>
      <View style={{ flexShrink: 0 }}><ExternalLink href={pr.url} accessibilityLabel={t("prOpenLink", { number: pr.number })}>
        <Text style={{ color: colors.foreground, fontSize: 14, fontWeight: "600" }}>PR #{pr.number}</Text>
      </ExternalLink></View>
      <View style={{ flexGrow: 1, flexShrink: 1, flexBasis: 140, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 5 }}>
        <Icon name="GitBranch" size={12} color={colors.foregroundMuted} />
        <Text selectable numberOfLines={1} ellipsizeMode="middle" accessibilityLabel={t("prBranchDirection", { source: result.branch, target: pr.baseBranch })}
          style={{ flex: 1, minWidth: 0, color: colors.foregroundMuted, fontSize: 11, lineHeight: 16 }}>{result.branch} → {pr.baseBranch}</Text>
      </View>
      </View>
      <StatusBadge label={t(stateKey[pr.state])} tone={tone} colors={colors} filled />
    </View>
    <Text numberOfLines={2} style={{ color: colors.foreground, fontSize: 13, fontWeight: "500", lineHeight: 19 }}>{pr.title}</Text>
    <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
      <StatusBadge label={checksLabel} icon={checks.status === "passed" ? "CircleCheck" : checks.status === "failed" ? "CircleX" : "CircleDot"}
        tone={checkTone} colors={colors} expanded={expanded} onPress={checks.total ? () => setExpanded(!expanded) : undefined} accessibilityLabel={t("prToggleChecks")} />
      {checks.skipped > 0 && checks.status !== "skipped" ? <StatusBadge label={t("prSkippedCount", { count: checks.skipped })} tone={colors.foregroundMuted} colors={colors} /> : null}
      {pr.review !== "NONE" ? <StatusBadge
        label={t(({ APPROVED: "prApproved", CHANGES_REQUESTED: "prChangesRequested", REVIEW_REQUIRED: "prReviewRequired" } as const)[pr.review])}
        icon={pr.review === "APPROVED" ? "CheckCheck" : "MessageSquare"}
        tone={pr.review === "APPROVED" ? colors.statusSuccess : pr.review === "CHANGES_REQUESTED" ? colors.statusDanger : colors.statusWarning} colors={colors} /> : null}
      {pr.conflicts && pr.state === "OPEN" ? <StatusBadge label={t("prConflicts")} icon="CircleAlert" tone={colors.statusDanger} colors={colors} /> : null}
    </View>
    {expanded && checks.entries.length ? <View style={{ gap: 8, paddingTop: 10, borderTopWidth: 1, borderColor: colors.border }}>
      <Text style={{ color: colors.foregroundMuted, fontSize: 10, lineHeight: 15 }}>{t("prLastPush")}{result.localHeadSha !== pr.headSha ? ` · ${t("prHeadDiffers")}` : ""}</Text>
      <ScrollView style={{ maxHeight: 180 }} contentContainerStyle={{ gap: 8 }}>
        {checks.entries.map((entry, index) => {
          const color = entry.state === "passed" ? colors.statusSuccess : entry.state === "failed" ? colors.statusDanger : entry.state === "pending" ? colors.statusWarning : colors.foregroundMuted;
          const label = t(({ passed: "prCheckPassed", failed: "prCheckFailed", pending: "prCheckPending", skipped: "prCheckSkipped", unknown: "prCheckUnknown" } as const)[entry.state]);
          return <View key={index} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Icon name={entry.state === "passed" ? "Check" : entry.state === "failed" ? "X" : "Minus"} size={12} color={color} />
            <View style={{ flex: 1, minWidth: 0 }}>{entry.url ? <ExternalLink href={entry.url}><Text numberOfLines={1} style={{ fontSize: 11, color: colors.foreground }}>{entry.name}</Text></ExternalLink> : <Text numberOfLines={1} style={{ fontSize: 11, color: colors.foreground }}>{entry.name}</Text>}</View>
            <Text style={{ color, fontSize: 10 }}>{label}</Text>
          </View>;
        })}
      </ScrollView>
    </View> : null}
  </>;
}

function StatusBadge({ label, icon, tone, colors, onPress, expanded, accessibilityLabel, filled = false }: { label: string; icon?: string; tone: string; colors: Colors; onPress?(): void; expanded?: boolean; accessibilityLabel?: string; filled?: boolean }) {
  const content = <>
    {icon ? <Icon name={icon} size={12} color={tone} /> : null}
    <Text style={{ fontSize: 11, lineHeight: 16, fontWeight: "500", color: tone }}>{label}</Text>
    {onPress ? <Icon name={expanded ? "ChevronUp" : "ChevronDown"} size={10} color={tone} /> : null}
  </>;
  const style = { minHeight: filled ? 24 : 20, flexDirection: "row" as const, alignItems: "center" as const, gap: 4,
    paddingHorizontal: filled ? 8 : 0, paddingVertical: filled ? 4 : 2, borderRadius: filled ? 4 : 0,
    backgroundColor: filled ? diffBackground(tone, colors.surface0) : "transparent" };
  return onPress ? <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel} accessibilityState={{ expanded }} onPress={onPress} style={style}>{content}</Pressable> : <View style={style}>{content}</View>;
}
