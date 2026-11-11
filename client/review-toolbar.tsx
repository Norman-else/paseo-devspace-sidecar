import type { ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { TextInput } from "@getpaseo/plugin/client/ui";
import type { Snapshot } from "../shared/diff";
import type { Colors } from "./review-ui";
import { useMessages } from "./messages";
import { ToolButton } from "./review-ui";

export function ReviewToolbar({ mode, fileCount, reviewedCount, totals, searchOpen, search, colors, onModeChange, onSearchChange, children, compact = false, secondaryActions, modes = ["task", "uncommitted"], searchType = "files", onSearchType, matchCount = 0, matchIndex = 0, onMatch }: {
  mode: Snapshot["comparison"]; fileCount?: number; reviewedCount: number; totals?: { plus: number; minus: number };
  searchOpen: boolean; search: string; colors: Colors; onModeChange(mode: Snapshot["comparison"]): void; onSearchChange(value: string): void; children: ReactNode;
  compact?: boolean; secondaryActions?: ReactNode; modes?: Snapshot["comparison"][]; searchType?: "files" | "code"; onSearchType?(type: "files" | "code"): void; matchCount?: number; matchIndex?: number; onMatch?(direction: number): void;
}) {
  const { t } = useMessages();
  const counts = <View style={{ flex: compact ? 1 : undefined, minWidth: 0, flexDirection: "row", alignItems: "center", flexWrap: "wrap", columnGap: 8, rowGap: 2 }}>
    <Text style={{ color: colors.foregroundMuted, fontSize: compact ? 12 : 11 }}>{fileCount === undefined ? "" : t("files", { count: fileCount })}{reviewedCount ? t("reviewedCount", { count: reviewedCount }) : ""}</Text>
    {totals ? <><Text style={{ color: colors.statusSuccess, fontSize: compact ? 12 : 11 }}>+{totals.plus}</Text><Text style={{ color: colors.statusDanger, fontSize: compact ? 12 : 11 }}>−{totals.minus}</Text></> : null}
  </View>;
  return <View style={{ paddingHorizontal: 12, paddingVertical: 4, gap: 6, borderBottomWidth: 1, borderColor: colors.border, backgroundColor: colors.surface0 }} testID="devspace-review-toolbar">
    <View style={{ minHeight: compact ? 44 : 32, flexDirection: "row", alignItems: "center", gap: compact ? 4 : 10, flexWrap: compact ? "nowrap" : "wrap" }}>
      <View style={{ flexDirection: "row" }}>
        {modes.map((option) => <Pressable key={option} accessibilityRole="button" accessibilityState={{ selected: mode === option }}
          onPress={() => onModeChange(option)} style={{ minHeight: compact ? 44 : 32, justifyContent: "center", paddingHorizontal: 8, paddingVertical: 7, borderBottomWidth: 2, borderBottomColor: mode === option ? colors.accent : "transparent" }}>
          <Text style={{ fontSize: compact ? 12 : 11, lineHeight: 16, fontWeight: mode === option ? "500" : "400", color: mode === option ? colors.foreground : colors.foregroundMuted }}>{t(({ task: "taskChanges", uncommitted: "uncommitted", pr: "prChanges", local: "localChanges" } as const)[option])}</Text>
        </Pressable>)}
      </View>
      {!compact ? counts : null}
      <View style={{ flex: 1 }} />
      {children}
    </View>
    {compact ? <View style={{ minHeight: 44, flexDirection: "row", alignItems: "center", gap: 8 }}>{counts}{secondaryActions}</View> : null}
    {searchOpen ? <View style={{ gap: 6 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>{(["files", "code"] as const).map((type) => <Pressable key={type} accessibilityRole="button" accessibilityState={{ selected: searchType === type }} onPress={() => onSearchType?.(type)} style={{ minHeight: 36, justifyContent: "center" }}><Text style={{ color: searchType === type ? colors.foreground : colors.foregroundMuted, fontSize: 12 }}>{t(type === "files" ? "searchFiles" : "searchCode")}</Text></Pressable>)}<View style={{ flex: 1 }} />{searchType === "code" ? <><Text style={{ color: colors.foregroundMuted, fontSize: 11 }}>{t("searchMatches", { current: matchCount ? matchIndex + 1 : 0, count: matchCount })}</Text><ToolButton touch={compact} icon="ChevronUp" label={t("previousMatch")} colors={colors} onPress={() => onMatch?.(-1)} /><ToolButton touch={compact} icon="ChevronDown" label={t("nextMatch")} colors={colors} onPress={() => onMatch?.(1)} /></> : null}</View>
      <TextInput value={search} onChangeText={onSearchChange} autoFocus placeholder={t(searchType === "files" ? "filterPlaceholder" : "searchCodePlaceholder")} accessibilityLabel={t(searchType === "files" ? "filterFiles" : "searchCode")}
        style={{ color: colors.foreground, borderWidth: 1, borderColor: colors.border, borderRadius: 4, padding: 9, fontSize: 13 }} />
      {searchType === "code" ? <Text style={{ color: colors.foregroundMuted, fontSize: 11 }}>{t("contentSearchHint")}</Text> : null}
    </View> : null}
  </View>;
}
