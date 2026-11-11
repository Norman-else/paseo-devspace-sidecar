import type { ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { TextInput } from "@getpaseo/plugin/client/ui";
import type { Snapshot } from "../shared/diff";
import type { Colors } from "./review-ui";
import { useMessages } from "./messages";

export function ReviewToolbar({ mode, fileCount, reviewedCount, totals, searchOpen, search, colors, onModeChange, onSearchChange, children }: {
  mode: Snapshot["comparison"]; fileCount?: number; reviewedCount: number; totals?: { plus: number; minus: number };
  searchOpen: boolean; search: string; colors: Colors; onModeChange(mode: Snapshot["comparison"]): void; onSearchChange(value: string): void; children: ReactNode;
}) {
  const { t } = useMessages();
  return <View style={{ paddingHorizontal: 12, paddingVertical: 4, gap: 6, borderBottomWidth: 1, borderColor: colors.border, backgroundColor: colors.surface0 }} testID="devspace-review-toolbar">
    <View style={{ minHeight: 32, flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
      <View style={{ flexDirection: "row" }}>
        {(["task", "uncommitted"] as const).map((option) => <Pressable key={option} accessibilityRole="button" accessibilityState={{ selected: mode === option }}
          onPress={() => onModeChange(option)} style={{ paddingHorizontal: 8, paddingVertical: 7, borderBottomWidth: 2, borderBottomColor: mode === option ? colors.accent : "transparent" }}>
          <Text style={{ fontSize: 11, lineHeight: 16, fontWeight: mode === option ? "500" : "400", color: mode === option ? colors.foreground : colors.foregroundMuted }}>{t(option === "task" ? "taskChanges" : "uncommitted")}</Text>
        </Pressable>)}
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Text style={{ color: colors.foregroundMuted, fontSize: 11 }}>{fileCount === undefined ? "" : t("files", { count: fileCount })}{reviewedCount ? t("reviewedCount", { count: reviewedCount }) : ""}</Text>
        {totals ? <><Text style={{ color: colors.statusSuccess, fontSize: 11 }}>+{totals.plus}</Text><Text style={{ color: colors.statusDanger, fontSize: 11 }}>−{totals.minus}</Text></> : null}
      </View>
      <View style={{ flex: 1 }} />
      {children}
    </View>
    {searchOpen ? <TextInput value={search} onChangeText={onSearchChange} autoFocus placeholder={t("filterPlaceholder")} accessibilityLabel={t("filterFiles")}
      style={{ color: colors.foreground, borderWidth: 1, borderColor: colors.border, borderRadius: 4, padding: 7, fontSize: 12 }} /> : null}
  </View>;
}
