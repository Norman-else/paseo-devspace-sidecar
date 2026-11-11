import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { ExternalLink, Markdown, ScrollView } from "@getpaseo/plugin/client/ui";
import type { ReviewThread } from "../shared/review-details";
import { ToolButton, type Colors } from "./review-ui";
import { useMessages } from "./messages";
export function ThreadContent({ thread, colors, onFeedback, onJump, onHeight, preview = false }: { thread: ReviewThread; colors: Colors; onFeedback(thread: ReviewThread): void; onJump?(thread: ReviewThread): void; onHeight?(height: number): void; preview?: boolean }) {
  const { t } = useMessages();
  const [expanded, setExpanded] = useState(false);
  const comments = preview && !expanded ? thread.comments.slice(0, 1) : thread.comments;
  return <View onLayout={(event) => onHeight?.(event.nativeEvent.layout.height)} style={{ padding: 12, gap: 8, backgroundColor: colors.surface1, borderBottomWidth: 1, borderColor: colors.border }}>
    <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8 }}><Text numberOfLines={1} style={{ flex: 1, minWidth: 0, color: colors.foregroundMuted, fontSize: 11 }}>{thread.path}{thread.line ? `:${thread.line}` : ""}</Text><Text style={{ color: thread.resolved ? colors.foregroundMuted : colors.statusWarning, fontSize: 11 }}>{t(thread.outdated ? "outdated" : thread.resolved ? "resolved" : "unresolved")}</Text></View>
    {comments.map((comment) => <View key={comment.url} style={{ gap: 4 }}><ExternalLink href={comment.url}><Text style={{ color: colors.foregroundMuted, fontSize: 11 }}>{comment.author}</Text></ExternalLink>{preview && !expanded ? <Text selectable numberOfLines={3} style={{ color: colors.foreground, fontSize: 13, lineHeight: 19 }}>{comment.body}</Text> : <Markdown>{comment.body}</Markdown>}</View>)}
    {preview && (thread.comments.length > 1 || (thread.comments[0]?.body.length ?? 0) > 140) ? <Pressable accessibilityRole="button" onPress={() => setExpanded(!expanded)} style={{ minHeight: 36, justifyContent: "center" }}><Text style={{ color: colors.accent, fontSize: 12 }}>{t(expanded ? "collapseDiscussion" : "expandDiscussion", { count: thread.comments.length })}</Text></Pressable> : null}
    {thread.truncated ? <Text style={{ fontSize: 11, color: colors.foregroundMuted }}>{t("discussionsTruncated")}</Text> : null}
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>{onJump && !thread.outdated ? <Pressable accessibilityRole="button" onPress={() => onJump(thread)} style={{ minHeight: 36, justifyContent: "center" }}><Text style={{ color: colors.accent, fontSize: 12 }}>{t("jumpToCode")}</Text></Pressable> : null}<Pressable accessibilityRole="button" onPress={() => onFeedback(thread)} style={{ minHeight: 36, justifyContent: "center" }}><Text style={{ color: colors.foreground, fontSize: 12 }}>{t("requestChange")}</Text></Pressable></View>
  </View>;
}
export function Discussions({ threads, resolved, selected, onResolved, onSelected, onJump, onFeedback, colors, inlineAvailable, truncated }: { threads: ReviewThread[]; resolved: boolean; selected: number; onResolved(value: boolean): void; onSelected(index: number): void; onJump(thread: ReviewThread): void; onFeedback(thread: ReviewThread): void; colors: Colors; inlineAvailable: boolean; truncated: boolean }) {
  const { t } = useMessages();
  const filtered = threads.filter((thread) => resolved || !thread.resolved), index = Math.min(selected, Math.max(0, filtered.length - 1)), thread = filtered[index];
  return <View style={{ borderBottomWidth: 1, borderColor: colors.border }}>
    <View style={{ paddingHorizontal: 12, flexDirection: "row", alignItems: "center", gap: 8 }}><Pressable accessibilityRole="checkbox" accessibilityState={{ checked: resolved }} onPress={() => onResolved(!resolved)} style={{ flex: 1, minHeight: 44, justifyContent: "center" }}><Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>{resolved ? "✓ " : ""}{t("showResolved")}</Text></Pressable><Text style={{ color: colors.foregroundMuted, fontSize: 11 }}>{filtered.length ? `${index + 1} / ${filtered.length}` : "0"}</Text><ToolButton touch icon="ChevronUp" label={t("previousDiscussion")} colors={colors} onPress={() => onSelected((index - 1 + filtered.length) % Math.max(1, filtered.length))} /><ToolButton touch icon="ChevronDown" label={t("nextDiscussion")} colors={colors} onPress={() => onSelected((index + 1) % Math.max(1, filtered.length))} /></View>
    <ScrollView style={{ maxHeight: 240 }}>{!inlineAvailable ? <Text style={{ paddingHorizontal: 12, paddingBottom: 8, fontSize: 12, color: colors.foregroundMuted }}>{t("inlineMismatch")}</Text> : null}{thread ? <ThreadContent thread={thread} colors={colors} onFeedback={onFeedback} onJump={onJump} /> : <Text style={{ padding: 12, color: colors.foregroundMuted, fontSize: 12 }}>{t("noDiscussions")}</Text>}{truncated ? <Text style={{ padding: 12, color: colors.foregroundMuted, fontSize: 11 }}>{t("discussionsTruncated")}</Text> : null}</ScrollView>
  </View>;
}
