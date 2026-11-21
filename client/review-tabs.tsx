import { Pressable, Text, View } from "react-native";
import { ToolButton, type Colors } from "./review-ui";
import { useMessages } from "./messages";
export type ReviewView = "changes" | "comments" | "files";
const tabLabels = { changes: "changesTab", comments: "commentsTab", files: "filesTab" } as const;
export function ReviewTabs({ view, tabs, count, compact, colors, onChange, canNavigate, onNavigate }: { view: ReviewView; tabs: readonly ReviewView[]; count?: number; compact: boolean; colors: Colors; onChange(view: ReviewView): void; canNavigate: boolean; onNavigate(direction: number): void }) {
  const { t } = useMessages();
  return <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 12, gap: 4, borderBottomWidth: 1, borderColor: colors.border }} testID="devspace-review-tabs">
    {tabs.map((value) => <Pressable key={value} accessibilityRole="tab" accessibilityLabel={t(tabLabels[value])} accessibilityState={{ selected: value === view }} onPress={() => onChange(value)} style={{ minHeight: compact ? 44 : 36, paddingHorizontal: 8, justifyContent: "center", borderBottomWidth: 2, borderBottomColor: value === view ? colors.accent : "transparent" }}>
      <Text style={{ color: value === view ? colors.foreground : colors.foregroundMuted, fontSize: 13, lineHeight: 18, fontWeight: value === view ? "500" : "400" }}>{t(tabLabels[value])}{value === "comments" && count !== undefined ? ` · ${count}` : ""}</Text>
    </Pressable>)}
    <View style={{ flex: 1 }} />
    {view === "changes" && canNavigate ? <><ToolButton touch={compact} icon="ChevronUp" label={t("previousDiscussion")} colors={colors} onPress={() => onNavigate(-1)} /><ToolButton touch={compact} icon="ChevronDown" label={t("nextDiscussion")} colors={colors} onPress={() => onNavigate(1)} /></> : null}
  </View>;
}
