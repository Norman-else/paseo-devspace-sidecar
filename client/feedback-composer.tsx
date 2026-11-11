import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { usePaseo } from "@getpaseo/plugin/client";
import { Modal, TextInput, copyText, useToast } from "@getpaseo/plugin/client/ui";
import type { Colors } from "./review-ui";
import { useMessages } from "./messages";
export type FeedbackDraft = { title: string; context: string; instruction: string };
export function FeedbackComposer({ draft, agentId, colors, onClose }: { draft: FeedbackDraft | null; agentId: string; colors: Colors; onClose(): void }) {
  const { t } = useMessages(), paseo = usePaseo(), toast = useToast();
  const [instruction, setInstruction] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState(false);
  useEffect(() => { setInstruction(draft?.instruction ?? ""); setError(false); }, [draft]);
  const message = `${instruction.trim()}\n\n${draft?.context ?? ""}`;
  const send = async () => {
    if (!instruction.trim() || busy) return;
    setBusy(true); setError(false);
    try { await paseo.agents.ref(agentId).send(message); toast.show(t("sentToAgent")); onClose(); }
    catch { setError(true); } finally { setBusy(false); }
  };
  return <Modal open={!!draft} onOpenChange={(open) => { if (!open && !busy) onClose(); }} title={t("feedbackDraft")}>
    <Modal.Content contentContainerStyle={{ padding: 16, gap: 12 }}>
      <Text style={{ fontSize: 13, fontWeight: "500", color: colors.foreground }}>{draft?.title}</Text>
      <TextInput multiline value={instruction} onChangeText={setInstruction} placeholder={t("feedbackInstructions")} accessibilityLabel={t("feedbackInstructions")} style={{ minHeight: 100, padding: 12, borderWidth: 1, borderColor: colors.border, borderRadius: 6, color: colors.foreground, fontSize: 14, textAlignVertical: "top" }} />
      <Text style={{ fontSize: 12, color: colors.foregroundMuted }}>{t("feedbackReady")}</Text>
      <Text selectable style={{ padding: 12, backgroundColor: colors.surface1, color: colors.foregroundMuted, fontSize: 12, lineHeight: 18 }}>{draft?.context}</Text>
      {error ? <Text style={{ color: colors.statusDanger, fontSize: 12 }}>{t("feedbackError")}</Text> : null}
      <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8 }}>
        <Pressable accessibilityRole="button" onPress={() => { void copyText(message).then(() => toast.show(t("copiedFeedback"))).catch(() => toast.error(t("feedbackError"))); }} style={{ minHeight: 44, paddingHorizontal: 16, justifyContent: "center" }}><Text style={{ color: colors.foreground, fontSize: 13 }}>{t("copyFeedback")}</Text></Pressable>
        <Pressable accessibilityRole="button" disabled={busy || !instruction.trim()} onPress={() => void send()} style={{ minHeight: 44, paddingHorizontal: 16, flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: colors.surface2, borderRadius: 6, opacity: busy || !instruction.trim() ? 0.5 : 1 }}>{busy ? <ActivityIndicator size="small" color={colors.foregroundMuted} /> : null}<Text style={{ color: colors.foreground, fontSize: 13, fontWeight: "500" }}>{t("sendToAgent")}</Text></Pressable>
      </View>
    </Modal.Content>
  </Modal>;
}
