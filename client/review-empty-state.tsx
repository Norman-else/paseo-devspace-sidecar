import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Icon, ScrollView } from "@getpaseo/plugin/client/ui";
import type { ReviewEmptyKind } from "../shared/review-empty";
import type { Colors } from "./review-ui";
import { useMessages } from "./messages";
const messages = {
  synced: ["filesInSync", "filesInSyncHelp", "CircleCheck"],
  clean: ["workingTreeClean", "workingTreeCleanHelp", "CircleCheck"],
  task: ["noTaskChanges", "noTaskChangesHelp", "FileDiff"],
  pr: ["noPrChanges", "noPrChangesHelp", "FileDiff"],
  baseline: ["noBaselineChanges", "noBaselineChangesHelp", "History"],
  reviewed: ["reviewComplete", "reviewCompleteHelp", "CircleCheck"],
  search: ["noMatches", "noMatchesHelp", "Search"],
  filtered: ["noFilteredFiles", "noFilteredFilesHelp", "ListFilter"],
} as const;
export function ReviewEmptyState({ kind, colors, compact, action }: { kind: ReviewEmptyKind; colors: Colors; compact: boolean; action: { label: string; onPress(): void } }) {
  const { t } = useMessages(), [hover, setHover] = useState(false);
  const [title, description, icon] = messages[kind];
  const positive = kind === "synced" || kind === "clean" || kind === "reviewed";
  return <ScrollView testID="devspace-review-empty" style={{ flex: 1, minWidth: 0, backgroundColor: colors.surface0 }} contentContainerStyle={{ flexGrow: 1, justifyContent: "center", alignItems: "center", padding: 24 }}>
    <View style={{ alignItems: "center", maxWidth: 340, gap: 8 }}>
      <View style={{ marginBottom: 4 }}><Icon name={icon} size={28} color={positive ? colors.statusSuccess : colors.foregroundMuted} /></View>
      <Text accessibilityRole="header" style={{ color: colors.foreground, fontSize: 16, lineHeight: 23, fontWeight: "600", textAlign: "center" }}>{t(title)}</Text>
      <Text style={{ color: colors.foregroundMuted, fontSize: 13, lineHeight: 20, textAlign: "center" }}>{t(description)}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={action.label} onPress={action.onPress} onHoverIn={() => setHover(true)} onHoverOut={() => setHover(false)} style={{ minHeight: compact ? 44 : 32, alignItems: "center", justifyContent: "center", marginTop: 8 }}>
        {({ pressed }) => <View style={{ minHeight: 32, paddingHorizontal: 12, paddingVertical: 6, justifyContent: "center", backgroundColor: colors.surface2, borderWidth: 1, borderColor: hover ? colors.foregroundMuted : colors.border, borderRadius: 4, opacity: pressed ? 0.7 : 1 }}><Text style={{ color: colors.foreground, fontSize: 13, lineHeight: 18, fontWeight: "500" }}>{action.label}</Text></View>}
      </Pressable>
    </View>
  </ScrollView>;
}
