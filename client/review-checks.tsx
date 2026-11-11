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
export function ReviewChecks({ workspaceId, number, headSha, checks, colors, onFeedback }: { workspaceId: string; number: number; headSha: string; checks: Checks; colors: Colors; onFeedback(detail: CheckDetail): void }) {
  const { t } = useMessages(), call = useRpc(checkDetailRpc);
  const [selected, select] = useState("");
  const entries = [...checks.entries].sort((a, b) => Number(b.state === "failed") - Number(a.state === "failed"));
  const entry = entries.find((entry) => `${entry.name}:${entry.url}` === selected) ?? entries[0];
  const detail = useQuery({ queryKey: ["devspace-check-detail", workspaceId, number, headSha, entry?.name, entry?.url], enabled: !!entry, queryFn: () => call({ workspaceId, prNumber: number, name: entry!.name, url: entry!.url }), retry: false, staleTime: 30000 });
  return <ScrollView style={{ maxHeight: 280, borderBottomWidth: 1, borderColor: colors.border }} contentContainerStyle={{ padding: 12, gap: 10 }}>
    {entries.map((item) => <Pressable key={`${item.name}:${item.url}`} accessibilityRole="button" accessibilityState={{ selected: item === entry }} accessibilityLabel={`${t("showCheckDetails")}: ${item.name}`} onPress={() => select(`${item.name}:${item.url}`)} style={{ flexDirection: "row", alignItems: "center", minHeight: 36, gap: 8 }}><Icon name={item.state === "passed" ? "CircleCheck" : item.state === "failed" ? "CircleX" : "CircleDot"} size={14} color={item.state === "failed" ? colors.statusDanger : item.state === "passed" ? colors.statusSuccess : colors.foregroundMuted} /><Text style={{ flex: 1, color: item === entry ? colors.foreground : colors.foregroundMuted, fontSize: 12, fontWeight: item === entry ? "500" : "400" }}>{item.name}</Text><Icon name="ChevronRight" size={12} color={colors.foregroundMuted} /></Pressable>)}
    {detail.isPending && entry ? <ActivityIndicator accessibilityLabel={t("checkLoading")} color={colors.foregroundMuted} /> : null}
    {detail.error ? <View style={{ gap: 8 }}><Text style={{ color: colors.statusDanger, fontSize: 12 }}>{t("prUnavailable")}</Text><Pressable accessibilityRole="button" onPress={() => void detail.refetch()}><Text style={{ color: colors.accent }}>{t("retry")}</Text></Pressable></View> : null}
    {detail.data ? <View style={{ gap: 10, borderTopWidth: 1, borderColor: colors.border, paddingTop: 12 }}>
      <Text style={{ color: colors.foreground, fontSize: 13, fontWeight: "500" }}>{detail.data.name}</Text>
      <Text selectable style={{ color: colors.foregroundMuted, fontSize: 12, lineHeight: 18 }}>{detail.data.summary || t(detail.data.external ? "externalCheck" : "noCheckSummary")}</Text>
      {detail.data.excerpt ? <Text selectable style={{ padding: 10, backgroundColor: colors.surface1, color: colors.foreground, fontSize: 12, lineHeight: 18 }}>{detail.data.excerpt}</Text> : null}
      {detail.data.logUnavailable ? <Text style={{ color: colors.foregroundMuted, fontSize: 11 }}>{t("logUnavailable")}</Text> : null}
      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 12 }}>{detail.data.url ? <ExternalLink href={detail.data.url}><Text style={{ color: colors.accent, fontSize: 12 }}>{t("openCheck")}</Text></ExternalLink> : null}{entry?.state === "failed" ? <Pressable accessibilityRole="button" onPress={() => onFeedback(detail.data!)} style={{ minHeight: 44, justifyContent: "center" }}><Text style={{ color: colors.foreground, fontSize: 12 }}>{t("fixCheck")}</Text></Pressable> : null}</View>
    </View> : null}
  </ScrollView>;
}
