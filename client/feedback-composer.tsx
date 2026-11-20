import { useEffect, useMemo, useState } from "react";
import { Platform, Pressable, Text, View, useWindowDimensions } from "react-native";
import { Spinner } from "./spinner";
import { usePaseo } from "@getpaseo/plugin/client";
import { Icon, Markdown, Modal, TextInput, copyText, useToast } from "@getpaseo/plugin/client/ui";
import type { Colors } from "./review-ui";
import { useMessages } from "./messages";
import { useCodeAppearance } from "./use-code-appearance";
import { codeReviewPalette } from "../shared/appearance";
import { codeTokens } from "../shared/syntax";

type Attachment = {
  path?: string; location?: string; source: string; revision?: string; capturedAt?: string;
  preview: { kind: "code"; lines: { number: number; text: string }[] } | { kind: "markdown" | "text"; text: string };
};
export type FeedbackDraft = { title: string; context: string; instruction: string; intent?: "explain" | "change" | "git"; hint?: string; attachment?: Attachment };
export function FeedbackComposer({ draft, agentId, colors, onClose }: { draft: FeedbackDraft | null; agentId: string; colors: Colors; onClose(): void }) {
  const { t, locale } = useMessages(), paseo = usePaseo(), toast = useToast();
  const [instruction, setInstruction] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState(false), [expanded, setExpanded] = useState(false);
  useEffect(() => { setInstruction(draft?.intent === "change" ? "" : draft?.instruction ?? ""); setError(false); setExpanded(false); }, [draft]);
  const message = `${instruction.trim()}\n\n${draft?.context ?? ""}`;
  const attachment = draft?.attachment;
  const path = attachment?.path, slash = path?.lastIndexOf("/") ?? -1;
  const filename = path?.slice(slash + 1) ?? draft?.title;
  const previewLabel = draft?.intent === "git" ? t("gitPromptDetails") : attachment?.preview.kind === "code" ? t("attachedCode", { count: attachment.preview.lines.length }) : t("attachedContext");
  const send = async () => {
    if (!instruction.trim() || busy) return;
    setBusy(true); setError(false);
    try { await paseo.agents.ref(agentId).send(message); toast.show(t("sentToAgent")); onClose(); }
    catch { setError(true); } finally { setBusy(false); }
  };
  return <Modal open={!!draft} onOpenChange={(open) => { if (!open && !busy) onClose(); }} title={draft?.intent === "git" ? t("panelTitle") : t(draft?.intent === "change" ? "requestChange" : draft?.intent === "explain" ? "explainCode" : "feedbackDraft")}>
    <Modal.Content contentContainerStyle={{ padding: 0, gap: 0 }}>
      <View style={{ padding: 20, paddingBottom: 16, gap: 16 }}>
        <View style={{ gap: 6 }}>
          <Text selectable style={{ fontSize: 15, lineHeight: 22, fontWeight: "600", color: colors.foreground }}>{filename}</Text>
          {path && slash >= 0 ? <Text numberOfLines={1} ellipsizeMode="middle" style={{ color: colors.foregroundMuted, fontSize: 12, lineHeight: 18 }}>{path.slice(0, slash)}</Text> : null}
          {attachment ? <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
            {attachment.location ? <Text style={{ fontSize: 12, lineHeight: 20, color: colors.foreground, backgroundColor: colors.surface2, paddingHorizontal: 8, borderRadius: 4 }}>{attachment.location}</Text> : null}
            <Text style={{ color: colors.foregroundMuted, fontSize: 13, lineHeight: 20 }}>{attachment.source}</Text>
          </View> : null}
        </View>
        <View style={{ gap: 8 }}>
          <Text style={{ color: colors.foreground, fontSize: 13, fontWeight: "500" }}>{t(draft?.intent === "change" ? "changeFeedbackLabel" : draft?.intent === "git" ? "gitNoteLabel" : "feedbackMessageLabel")}</Text>
          <TextInput multiline editable={!busy} value={instruction} onChangeText={(value) => { setInstruction(value); if (error) setError(false); }} placeholderTextColor={colors.foregroundMuted} placeholder={t("feedbackInstructions")} accessibilityLabel={t(draft?.intent === "change" ? "changeFeedbackLabel" : "feedbackMessageLabel")} style={{ minHeight: 132, padding: 12, borderWidth: 1, borderColor: colors.border, borderRadius: 8, backgroundColor: colors.surface0, color: colors.foreground, fontSize: 15, lineHeight: 23, textAlignVertical: "top" }} />
        </View>
        <View style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 8, overflow: "hidden" }}>
          <Disclosure label={previewLabel} expanded={expanded} onPress={() => setExpanded(!expanded)} colors={colors} />
          {expanded ? <View style={{ borderTopWidth: 1, borderColor: colors.border }}>
            {attachment?.preview.kind === "code" ? <CodePreview lines={attachment.preview.lines} path={path ?? ""} colors={colors} />
              : <View style={{ padding: 12 }}>{attachment?.preview.kind === "markdown" ? <Markdown>{attachment.preview.text}</Markdown> : <Text selectable style={{ color: colors.foreground, fontSize: 14, lineHeight: 21 }}>{attachment?.preview.text ?? draft?.context}</Text>}</View>}
            {attachment?.revision || attachment?.capturedAt ? <Text selectable style={{ paddingHorizontal: 12, paddingVertical: 10, color: colors.foregroundMuted, fontSize: 12, lineHeight: 18 }}>{[attachment.revision && (/^[\da-f]{40,64}$/i.test(attachment.revision) ? attachment.revision.slice(0, 8) : attachment.revision), attachment.capturedAt && new Date(attachment.capturedAt).toLocaleString(locale)].filter(Boolean).join(" · ")}</Text> : null}
          </View> : null}
        </View>
        {error ? <Text accessibilityRole="alert" style={{ color: colors.statusDanger, fontSize: 13, lineHeight: 20 }}>{t("feedbackError")}</Text> : null}
      </View>
      <View style={{ padding: 16, paddingHorizontal: 20, borderTopWidth: 1, borderColor: colors.border, gap: 12 }}>
        <Text style={{ color: colors.foregroundMuted, fontSize: 12, lineHeight: 18 }}>{draft?.hint ?? t(draft?.intent === "git" ? "gitSendHint" : "feedbackAttachmentHint")}</Text>
        <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8 }}>
          <FeedbackButton label={t("copyFeedback")} icon="Copy" disabled={busy || !instruction.trim()} colors={colors} onPress={() => { void copyText(message).then(() => toast.show(t("copiedFeedback"))).catch(() => toast.error(t("feedbackError"))); }} />
          <FeedbackButton label={t(busy ? "sendingFeedback" : "sendToAgent")} primary busy={busy} disabled={busy || !instruction.trim()} colors={colors} onPress={() => void send()} />
        </View>
      </View>
    </Modal.Content>
  </Modal>;
}
function Disclosure({ label, expanded, onPress, colors }: { label: string; expanded: boolean; onPress(): void; colors: Colors }) {
  const [hover, setHover] = useState(false);
  const desktop = useDesktop();
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ expanded }} aria-expanded={expanded} onPress={onPress} onHoverIn={() => setHover(true)} onHoverOut={() => setHover(false)} style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 10, minHeight: desktop ? 40 : 48, paddingHorizontal: 12, backgroundColor: hover || pressed ? colors.surface2 : colors.surface1 })}>
    <Icon name="Paperclip" size={16} color={colors.foregroundMuted} /><Text style={{ flex: 1, color: colors.foreground, fontSize: 13 }}>{label}</Text><Icon name={expanded ? "ChevronUp" : "ChevronDown"} size={16} color={colors.foregroundMuted} />
  </Pressable>;
}
function CodePreview({ lines, path, colors }: { lines: { number: number; text: string }[]; path: string; colors: Colors }) {
  const typography = useCodeAppearance(), palette = codeReviewPalette(colors.surface0);
  const tokens = useMemo(() => {
    const nonempty = lines.filter((line) => line.text.trim());
    const indent = nonempty.length ? Math.min(...nonempty.map((line) => /^\s*/.exec(line.text)![0].length)) : 0;
    const state = { block: false };
    return lines.map((line) => ({ ...line, tokens: codeTokens(line.text.slice(indent), path, state) }));
  }, [lines, path]);
  const numberWidth = Math.max(36, String(Math.max(0, ...lines.map((line) => line.number))).length * typography.characterWidth);
  const syntax = { plain: colors.foreground, comment: colors.foregroundMuted, string: colors.statusSuccess, keyword: colors.accent, number: colors.statusWarning, type: colors.statusWarning, function: colors.accent };
  return <View style={{ paddingVertical: 12, backgroundColor: palette.background }}>
    {tokens.map((line) => <View key={line.number} style={{ flexDirection: "row", paddingHorizontal: 12, gap: 12 }}>
      <Text style={{ width: numberWidth, textAlign: "right", color: colors.foregroundMuted, fontFamily: typography.fontFamily, fontSize: typography.fontSize - 2, lineHeight: typography.lineHeight }}>{line.number}</Text>
      <Text selectable style={{ flex: 1, minWidth: 0, color: colors.foreground, fontFamily: typography.fontFamily, fontSize: typography.fontSize, lineHeight: typography.lineHeight }}>{line.tokens.map((token, index) => <Text key={index} style={{ color: syntax[token.kind] }}>{token.text}</Text>)}</Text>
    </View>)}
  </View>;
}
function FeedbackButton({ label, icon, primary, busy, disabled, colors, onPress }: { label: string; icon?: string; primary?: boolean; busy?: boolean; disabled: boolean; colors: Colors; onPress(): void }) {
  const [hover, setHover] = useState(false);
  // 44px is a touch target; a pointer on a desktop window gets the compact size used elsewhere in the panel.
  const desktop = useDesktop();
  const foreground = primary ? colors.accentForeground : colors.foreground;
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled, busy }} disabled={disabled} onPress={onPress} onHoverIn={() => setHover(true)} onHoverOut={() => setHover(false)} style={({ pressed }) => ({ minHeight: desktop ? 32 : 44, flexShrink: 1, paddingHorizontal: desktop ? 12 : 16, paddingVertical: desktop ? 0 : 10, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderWidth: 1, borderColor: primary ? colors.accent : hover ? colors.foregroundMuted : colors.border, backgroundColor: primary ? colors.accent : hover || pressed ? colors.surface2 : "transparent", borderRadius: 6, opacity: disabled ? 0.45 : pressed ? 0.75 : 1 })}>
    {busy ? <Spinner size={desktop ? 14 : 15} color={foreground} /> : icon ? <Icon name={icon} size={desktop ? 14 : 15} color={foreground} /> : null}<Text style={{ color: foreground, fontSize: desktop ? 13 : 14, lineHeight: desktop ? 18 : 20, fontWeight: primary ? "600" : "400", flexShrink: 1, textAlign: "center" }}>{label}</Text>
  </Pressable>;
}
function useDesktop() { const { width } = useWindowDimensions(); return Platform.OS === "web" && width >= 560; }
