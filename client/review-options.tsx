import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { Modal } from "@getpaseo/plugin/client/ui";
import type { Colors } from "./review-ui";
import { useMessages } from "./messages";
import type { Checkpoint } from "../shared/review-details";
export function ReviewOptions({ open, onClose, filter, onFilter, point, busy, onSave, colors }: { open: boolean; onClose(): void; filter: "all" | "unreviewed" | "since"; onFilter(value: "all" | "unreviewed" | "since"): void; point?: Checkpoint; busy: boolean; onSave(): void; colors: Colors }) {
  const { t } = useMessages();
  return <Modal open={open} onOpenChange={(open) => { if (!open) onClose(); }} title={t("reviewOptions")}><Modal.Content contentContainerStyle={{ padding: 16, gap: 8 }}>
    {(["all", "unreviewed", "since"] as const).map((value) => <Pressable key={value} accessibilityRole="radio" accessibilityState={{ checked: filter === value, disabled: value === "since" && !point }} disabled={value === "since" && !point} onPress={() => { onFilter(value); onClose(); }} style={{ minHeight: 44, justifyContent: "center", opacity: value === "since" && !point ? 0.45 : 1 }}><Text style={{ color: filter === value ? colors.foreground : colors.foregroundMuted, fontSize: 14 }}>{filter === value ? "✓ " : ""}{t(({ all: "allFiles", unreviewed: "unreviewedFiles", since: "sinceReview" } as const)[value])}</Text></Pressable>)}
    <View style={{ marginTop: 8, paddingTop: 12, borderTopWidth: 1, borderColor: colors.border, gap: 8 }}><Text style={{ color: colors.foregroundMuted, fontSize: 12, lineHeight: 18 }}>{point ? t("reviewPointAt", { time: new Date(point.createdAt).toLocaleString() }) : t("noReviewPoint")}</Text><Pressable accessibilityRole="button" disabled={busy} onPress={onSave} style={{ minHeight: 44, flexDirection: "row", alignItems: "center", gap: 8 }}>{busy ? <ActivityIndicator color={colors.foregroundMuted} /> : null}<Text style={{ color: colors.accent, fontSize: 14 }}>{t("saveReviewPoint")}</Text></Pressable></View>
  </Modal.Content></Modal>;
}
