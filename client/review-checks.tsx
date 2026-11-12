import { useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useRpc } from "@getpaseo/plugin/client";
import { ExternalLink, Icon, ScrollView } from "@getpaseo/plugin/client/ui";
import { checkDetailRpc } from "../shared/diff";
import type { Checks } from "../shared/pull-request";
import type { CheckDetail } from "../shared/review-details";
import type { Colors } from "./review-ui";
import { useMessages } from "./messages";
import { useCodeAppearance } from "./use-code-appearance";
export function ReviewChecks({ workspaceId, number, headSha, checks, colors, onFeedback, maxHeight, compact = false }: { workspaceId: string; number: number; headSha: string; checks: Checks; colors: Colors; onFeedback(detail: CheckDetail): void; maxHeight?: number; compact?: boolean }) {
  const { t } = useMessages(), call = useRpc(checkDetailRpc), typography = useCodeAppearance();
  const [selected, select] = useState("");
  const rank = { failed: 0, pending: 1, unknown: 2, passed: 3, skipped: 4 };
  const entries = [...checks.entries].sort((a, b) => rank[a.state] - rank[b.state]);
  const entry = entries.find((item) => `${item.name}:${item.url}` === selected);
  const detail = useQuery({ queryKey: ["devspace-check-detail", workspaceId, number, headSha, entry?.name, entry?.url], enabled: !!entry, queryFn: () => call({ workspaceId, prNumber: number, name: entry!.name, url: entry!.url }), retry: false, staleTime: 30000 });
  const tone = (state: Checks["entries"][number]["state"]) => state === "failed" ? colors.statusDanger : state === "passed" ? colors.statusSuccess : state === "pending" ? colors.statusWarning : colors.foregroundMuted;
  const statusLabel = { passed: "checkPassed", failed: "checkFailed", pending: "checkPending", skipped: "checkSkipped", unknown: "checkUnknown" } as const;
  const height = compact ? 44 : 36;
  return <View style={{ flex: compact ? 1 : undefined, flexShrink: 1, minHeight: 0 }}>
    {entry ? <View style={{ paddingHorizontal: 12, paddingVertical: 4, borderBottomWidth: 1, borderColor: colors.border }}><Pressable accessibilityRole="button" accessibilityLabel={t("allChecks")} onPress={() => select("")} style={{ minHeight: height, flexDirection: "row", alignItems: "center", gap: 6 }}><Icon name="ChevronLeft" size={15} color={colors.foregroundMuted} /><Text style={{ color: colors.foreground, fontSize: 13 }}>{t("allChecks")}</Text></Pressable></View> : null}
    <ScrollView style={{ maxHeight: maxHeight === undefined ? undefined : Math.max(64, maxHeight - (entry ? height + 9 : 0)), flex: compact ? 1 : undefined, flexShrink: 1, minHeight: 0 }} contentContainerStyle={{ padding: entry ? 12 : 4, gap: entry ? 12 : 0 }}>
      {!entry ? entries.map((item) => <CheckRow key={`${item.name}:${item.url}`} label={item.name} status={t(statusLabel[item.state])} tone={tone(item.state)} icon={item.state === "passed" ? "CircleCheck" : item.state === "failed" ? "CircleX" : item.state === "skipped" ? "CircleMinus" : "CircleDot"} colors={colors} height={height} onPress={() => select(`${item.name}:${item.url}`)} />) : <>
        <View style={{ gap: 6 }}><Text selectable style={{ color: colors.foreground, fontSize: 14, fontWeight: "600", lineHeight: 20 }}>{entry.name}</Text><Text style={{ color: tone(entry.state), fontSize: 12 }}>{t(statusLabel[entry.state])}</Text></View>
        {detail.isFetching && !detail.data ? <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 12 }}><ActivityIndicator size="small" color={colors.foregroundMuted} /><Text style={{ fontSize: 13, color: colors.foregroundMuted }}>{t("checkLoading")}</Text></View> : null}
        {detail.error ? <View style={{ gap: 8 }}><Text style={{ color: colors.statusDanger, fontSize: 13 }}>{t("prUnavailable")}</Text><Pressable accessibilityRole="button" onPress={() => void detail.refetch()} style={{ minHeight: height, justifyContent: "center" }}><Text style={{ color: colors.accent, fontSize: 13 }}>{t("retry")}</Text></Pressable></View> : null}
        {detail.data ? <>
          <Text selectable style={{ color: colors.foreground, fontSize: 13, lineHeight: 20 }}>{detail.data.summary || t(detail.data.external ? "externalCheck" : "noCheckSummary")}</Text>
          {detail.data.excerpt ? <Text selectable style={{ padding: 12, borderRadius: 4, backgroundColor: colors.surface1, color: colors.foreground, fontFamily: typography.fontFamily, fontSize: typography.fontSize, lineHeight: typography.lineHeight }}>{detail.data.excerpt}</Text> : null}
          {detail.data.logUnavailable ? <Text style={{ color: colors.foregroundMuted, fontSize: 12, lineHeight: 18 }}>{t("logUnavailable")}</Text> : null}
          <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 12 }}>{detail.data.url ? <ExternalLink href={detail.data.url}><View style={{ minHeight: height, justifyContent: "center" }}><Text style={{ color: colors.accent, fontSize: 13 }}>{t("openCheck")}</Text></View></ExternalLink> : null}{entry.state === "failed" ? <Pressable accessibilityRole="button" onPress={() => onFeedback(detail.data!)} style={{ minHeight: height, paddingHorizontal: 10, justifyContent: "center", borderWidth: 1, borderRadius: 4, borderColor: colors.border, backgroundColor: colors.surface2 }}><Text style={{ color: colors.foreground, fontSize: 13 }}>{t("fixCheck")}</Text></Pressable> : null}</View>
        </> : null}
      </>}
    </ScrollView>
  </View>;
}
function CheckRow({ label, status, tone, icon, colors, height, onPress }: { label: string; status: string; tone: string; icon: string; colors: Colors; height: number; onPress(): void }) {
  const { t } = useMessages(), [hover, setHover] = useState(false);
  return <Pressable accessibilityRole="button" accessibilityLabel={`${t("showCheckDetails")}: ${label}`} onPress={onPress} onHoverIn={() => setHover(true)} onHoverOut={() => setHover(false)} style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", minHeight: height, paddingVertical: 8, paddingHorizontal: 8, gap: 8, borderRadius: 4, backgroundColor: hover || pressed ? colors.surface2 : "transparent" })}>
    <Icon name={icon} size={15} color={tone} /><Text numberOfLines={2} style={{ flex: 1, minWidth: 0, color: colors.foreground, fontSize: 13, lineHeight: 18 }}>{label}</Text><Text style={{ fontSize: 11, color: tone }}>{status}</Text><Icon name="ChevronRight" size={13} color={colors.foregroundMuted} />
  </Pressable>;
}
