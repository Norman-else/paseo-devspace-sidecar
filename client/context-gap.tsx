import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Icon } from "@getpaseo/plugin/client/ui";
import type { ReviewRow } from "../shared/review";
import type { Colors } from "./review-ui";
import { useMessages } from "./messages";
import type { CodeAppearance } from "../shared/appearance";
import { codeScopeProps } from "./web";
export function ContextGap({ row, colors, typography, loading, disabled, onToggle, onMore }: { row: Extract<ReviewRow, { kind: "gap" }>; colors: Colors; typography: CodeAppearance; loading: boolean; disabled: boolean; onToggle(): void; onMore(): void }) {
  const { t } = useMessages();
  const [hover, setHover] = useState(false), [moreHover, setMoreHover] = useState(false);
  const fontSize = Math.max(14, typography.fontSize), iconSize = Math.max(16, typography.fontSize);
  const interactive = row.expanded || row.count !== 0;
  const label = loading ? t("contextLoading") : row.expanded ? t("collapseContext", { count: row.loaded }) : row.count < 0 ? t("followingContext") : row.count > 0 ? t("unchangedLines", { count: row.count }) : t("context");
  return <View style={{ height: row.height, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 12, backgroundColor: colors.surface0 }}>
    <Pressable accessibilityRole={interactive ? "button" : undefined} accessibilityLabel={interactive ? label : undefined} accessibilityState={{ expanded: row.expanded }} disabled={!interactive || disabled} onPress={onToggle} onHoverIn={() => setHover(true)} onHoverOut={() => setHover(false)} style={{ flexDirection: "row", alignItems: "center", flexShrink: 1, minWidth: 0, minHeight: row.height, gap: 6 }}>
      <Icon name={row.expanded ? "ChevronUp" : "ChevronsUpDown"} size={iconSize} color={colors.foregroundMuted} />
      <Text numberOfLines={1} style={{ flexShrink: 1, minWidth: 0, fontSize, lineHeight: typography.lineHeight, color: colors.foregroundMuted, textDecorationLine: interactive && !disabled && hover ? "underline" : "none" }}>{label}</Text>
    </Pressable>
    {row.expanded && row.omitted > 0 ? <Pressable accessibilityRole="button" disabled={disabled} onPress={onMore} onHoverIn={() => setMoreHover(true)} onHoverOut={() => setMoreHover(false)} style={{ flexShrink: 1, minWidth: 0, minHeight: row.height, justifyContent: "center" }}><Text numberOfLines={1} style={{ color: colors.foregroundMuted, fontSize, lineHeight: typography.lineHeight, textDecorationLine: !disabled && moreHover ? "underline" : "none" }}>{t("showContext", { count: Math.min(1000, row.omitted) })}</Text></Pressable> : null}
    <Text {...codeScopeProps} numberOfLines={1} style={{ flex: 1, minWidth: 0, fontFamily: typography.fontFamily, fontSize: Math.max(13, typography.fontSize - 1), lineHeight: typography.lineHeight, color: colors.foregroundMuted }}>{row.label === "__discussion__" ? t("discussionContext") : row.label}</Text>
  </View>;
}
