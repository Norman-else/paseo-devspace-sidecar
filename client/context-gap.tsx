import { Pressable, Text, View } from "react-native";
import { Icon } from "@getpaseo/plugin/client/ui";
import type { ReviewRow } from "../shared/review";
import type { Colors } from "./review-ui";
import { useMessages } from "./messages";
export function ContextGap({ row, colors, loading, disabled, onToggle, onMore }: { row: Extract<ReviewRow, { kind: "gap" }>; colors: Colors; loading: boolean; disabled: boolean; onToggle(): void; onMore(): void }) {
  const { t } = useMessages();
  const interactive = row.expanded || row.count !== 0;
  const label = loading ? t("contextLoading") : row.expanded ? t("collapseContext", { count: row.loaded }) : row.count < 0 ? t("followingContext") : row.count > 0 ? t("unchangedLines", { count: row.count }) : t("context");
  return <View style={{ height: row.height, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 12, backgroundColor: colors.surface0 }}>
    <Pressable accessibilityRole={interactive ? "button" : undefined} accessibilityLabel={interactive ? label : undefined} accessibilityState={{ expanded: row.expanded }} disabled={!interactive || disabled} onPress={onToggle} style={{ flexDirection: "row", alignItems: "center", flexShrink: 1, minWidth: 0, minHeight: 32, gap: 6 }}>
      <Icon name={row.expanded ? "ChevronUp" : "ChevronsUpDown"} size={11} color={colors.foregroundMuted} />
      <Text numberOfLines={1} style={{ flexShrink: 1, minWidth: 0, fontSize: 11, lineHeight: 16, color: colors.foregroundMuted, textDecorationLine: interactive ? "underline" : "none" }}>{label}</Text>
    </Pressable>
    {row.expanded && row.omitted > 0 ? <Pressable accessibilityRole="button" disabled={disabled} onPress={onMore} style={{ flexShrink: 1, minWidth: 0, minHeight: 32, justifyContent: "center" }}><Text numberOfLines={1} style={{ color: colors.foregroundMuted, fontSize: 11, textDecorationLine: "underline" }}>{t("showContext", { count: Math.min(1000, row.omitted) })}</Text></Pressable> : null}
    <Text numberOfLines={1} style={{ flex: 1, minWidth: 0, fontSize: 10, color: colors.foregroundMuted }}>{row.label === "__discussion__" ? t("discussionContext") : row.label}</Text>
  </View>;
}
