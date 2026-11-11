import { useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { ExternalLink, Icon, ScrollView } from "@getpaseo/plugin/client/ui";
import type { PullRequestResult } from "../shared/pull-request";
import type { Colors } from "./review-ui";
import { useMessages } from "./messages";

export function PullRequestStatus({ result, loading, error, colors }: { result?: PullRequestResult; loading: boolean; error: Error | null; colors: Colors }) {
  const { t } = useMessages();
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set());
  const muted = { color: colors.foregroundMuted, fontSize: 11 };
  const container = { paddingHorizontal: 12, paddingVertical: 8, gap: 8, borderBottomWidth: 1, borderColor: colors.border };
  if (error) return <View style={container}><Text style={muted}>{t("prUnavailable")}</Text></View>;
  if (!result) return loading ? <View style={[container, { flexDirection: "row", alignItems: "center" }]}><ActivityIndicator size="small" color={colors.foregroundMuted} /><Text style={muted}>{t("prLoading")}</Text></View> : null;
  if (result.status === "unavailable") {
    const labels = { gh_missing: "prGhMissing", auth_required: "prAuthRequired", unsupported_remote: "prUnsupported", no_remote: "prNoRemote", detached_head: "prDetached", request_failed: "prUnavailable" } as const;
    return <View style={container}><Text style={muted}>{t(labels[result.reason])}</Text></View>;
  }
  if (result.status === "none") return <View style={[container, { flexDirection: "row", alignItems: "center" }]}><Icon name="GitPullRequest" size={13} color={colors.foregroundMuted} /><Text style={muted}>{t("prNone")}</Text></View>;
  return <View style={container} testID="devspace-pull-request-status">
    {result.pullRequests.map((pr) => {
      const stateKey = { OPEN: "prOpen", DRAFT: "prDraft", MERGED: "prMerged", CLOSED: "prClosed" } as const;
      const tone = pr.state === "OPEN" ? colors.statusSuccess : pr.state === "CLOSED" ? colors.statusDanger : pr.state === "MERGED" ? colors.accent : colors.foregroundMuted;
      const checks = pr.checks;
      const checksTone = checks.status === "failed" ? colors.statusDanger : checks.status === "passed" ? colors.statusSuccess : checks.status === "pending" ? colors.statusWarning : colors.foregroundMuted;
      const checksLabel = checks.status === "passed" ? t("prChecksPassed", { count: checks.passed }) : checks.status === "failed" ? t("prChecksFailed", { count: checks.failed }) : checks.status === "pending" ? t("prChecksPending", { count: checks.pending }) : t(checks.status === "none" ? "prNoChecks" : checks.status === "skipped" ? "prChecksSkipped" : "prChecksUnknown");
      return <View key={pr.number} style={{ gap: 6 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 7 }}>
          <Icon name={pr.state === "MERGED" ? "GitMerge" : "GitPullRequest"} size={14} color={tone} />
          <View style={{ flex: 1, minWidth: 0 }}><ExternalLink href={pr.url} accessibilityLabel={t("prOpenLink", { number: pr.number })}>
            <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: 12, fontWeight: "500" }}>#{pr.number} {pr.title}</Text>
          </ExternalLink></View>
          <Text style={{ color: tone, fontSize: 11 }}>{t(stateKey[pr.state])}</Text>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 10, paddingLeft: 21 }}>
          <Pressable accessibilityRole="button" accessibilityLabel={t("prToggleChecks")} disabled={!checks.total} accessibilityState={{ expanded: !!checks.total && expanded.has(pr.number), disabled: !checks.total }} onPress={() => setExpanded((previous) => { const next = new Set(previous); if (!next.delete(pr.number)) next.add(pr.number); return next; })}
            style={{ flexDirection: "row", alignItems: "center", gap: 4, paddingVertical: 2 }}>
            <Icon name={checks.status === "passed" ? "CircleCheck" : checks.status === "failed" ? "CircleX" : "CircleDot"} size={12} color={checksTone} />
            <Text style={{ color: checksTone, fontSize: 11 }}>{checksLabel}</Text>
            {checks.total ? <Icon name={expanded.has(pr.number) ? "ChevronUp" : "ChevronDown"} size={10} color={colors.foregroundMuted} /> : null}
          </Pressable>
          {pr.review !== "NONE" ? <Text style={{ fontSize: 11, color: pr.review === "APPROVED" ? colors.statusSuccess : pr.review === "CHANGES_REQUESTED" ? colors.statusDanger : colors.foregroundMuted }}>
            {t(({ APPROVED: "prApproved", CHANGES_REQUESTED: "prChangesRequested", REVIEW_REQUIRED: "prReviewRequired" } as const)[pr.review])}
          </Text> : null}
          {pr.conflicts && pr.state === "OPEN" ? <Text style={{ color: colors.statusDanger, fontSize: 11 }}>{t("prConflicts")}</Text> : null}
          <Text style={{ color: colors.foregroundMuted, fontSize: 10 }}>→ {pr.baseBranch}</Text>
        </View>
        {expanded.has(pr.number) && checks.entries.length ? <ScrollView style={{ maxHeight: 180 }} contentContainerStyle={{ gap: 6, paddingLeft: 21, paddingVertical: 4 }}>
          <Text style={{ ...muted, fontSize: 10 }}>{t("prLastPush")}{result.localHeadSha !== pr.headSha ? ` · ${t("prHeadDiffers")}` : ""}</Text>
          {checks.entries.map((entry, index) => <View key={index} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Icon name={entry.state === "passed" ? "Check" : entry.state === "failed" ? "X" : "Minus"} size={12} color={entry.state === "passed" ? colors.statusSuccess : entry.state === "failed" ? colors.statusDanger : colors.foregroundMuted} />
            <View style={{ flex: 1, minWidth: 0 }}>{entry.url ? <ExternalLink href={entry.url}><Text numberOfLines={1} style={muted}>{entry.name}</Text></ExternalLink> : <Text numberOfLines={1} style={muted}>{entry.name}</Text>}</View>
          </View>)}
        </ScrollView> : null}
      </View>;
    })}
  </View>;
}
