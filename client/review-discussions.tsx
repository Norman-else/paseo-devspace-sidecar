import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { ExternalLink, FlatList, Icon, Markdown } from "@getpaseo/plugin/client/ui";
import type { ReviewThread } from "../shared/review-details";
import { type Colors } from "./review-ui";
import { useMessages } from "./messages";
import { CommentAuthor, CommentAvatar } from "./comment-author";
export function ThreadContent({ thread, colors, onFeedback, onJump, onHeight, preview = false }: { thread: ReviewThread; colors: Colors; onFeedback(thread: ReviewThread): void; onJump?(thread: ReviewThread): void; onHeight?(height: number): void; preview?: boolean }) {
  const { t } = useMessages();
  const [expanded, setExpanded] = useState(false);
  const comments = preview && !expanded ? thread.comments.slice(0, 1) : thread.comments;
  return <View onLayout={(event) => onHeight?.(event.nativeEvent.layout.height)} style={{ padding: 12, gap: 8, backgroundColor: colors.surface1, borderBottomWidth: 1, borderColor: colors.border }}>
    <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8 }}><Text numberOfLines={1} style={{ flex: 1, minWidth: 0, color: colors.foregroundMuted, fontSize: 11 }}>{thread.path}{thread.line ? `:${thread.line}` : ""}</Text><Text style={{ color: thread.resolved ? colors.foregroundMuted : colors.statusWarning, fontSize: 11 }}>{t(thread.outdated ? "outdated" : thread.resolved ? "resolved" : "unresolved")}</Text></View>
    <View>
      {comments.map((comment, index) => <View key={comment.url} testID="devspace-comment" style={{ gap: 12, paddingTop: index ? 16 : 4, paddingBottom: 16, borderTopWidth: index ? 1 : 0, borderColor: colors.border }}><CommentAuthor comment={comment} colors={colors} />{preview && !expanded ? <Text selectable numberOfLines={3} style={{ color: colors.foreground, fontSize: 13, lineHeight: 19 }}>{comment.body}</Text> : <Markdown>{comment.body}</Markdown>}</View>)}
    </View>
    {preview && (thread.comments.length > 1 || (thread.comments[0]?.body.length ?? 0) > 140) ? <Pressable accessibilityRole="button" onPress={() => setExpanded(!expanded)} style={{ minHeight: 36, justifyContent: "center" }}><Text style={{ color: colors.accent, fontSize: 12 }}>{t(expanded ? "collapseDiscussion" : "expandDiscussion", { count: thread.comments.length })}</Text></Pressable> : null}
    {thread.truncated ? <Text style={{ fontSize: 11, color: colors.foregroundMuted }}>{t("discussionsTruncated")}</Text> : null}
    <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8, paddingTop: 12, borderTopWidth: 1, borderColor: colors.border }}>
      {onJump && !thread.outdated ? <CommentAction label={t("jumpToCode")} colors={colors} onPress={() => onJump(thread)} /> : null}
      <CommentAction primary label={t("requestChange")} colors={colors} onPress={() => onFeedback(thread)} />
      {thread.comments[0] ? <ExternalLink href={thread.comments[0].url}><View style={{ minHeight: 44, paddingHorizontal: 8, justifyContent: "center" }}><Text style={{ color: colors.foregroundMuted, fontSize: 12, textDecorationLine: "underline" }}>{t("viewOnGitHub")}</Text></View></ExternalLink> : null}
    </View>
  </View>;
}
function CommentAction({ label, colors, onPress, primary = false }: { label: string; colors: Colors; onPress(): void; primary?: boolean }) {
  const [hover, setHover] = useState(false);
  return <Pressable accessibilityRole="button" onPress={onPress} onHoverIn={() => setHover(true)} onHoverOut={() => setHover(false)}
    style={({ pressed }) => ({ minHeight: 44, paddingHorizontal: 12, justifyContent: "center", borderWidth: 1, borderColor: hover || pressed ? colors.foregroundMuted : colors.border, borderRadius: 6, backgroundColor: primary || hover || pressed ? colors.surface2 : colors.surface0, opacity: pressed ? 0.75 : 1 })}>
    <Text style={{ color: colors.foreground, fontSize: 12, fontWeight: "500" }}>{label}</Text>
  </Pressable>;
}
export function InlineDiscussion({ thread, expanded, onToggle, colors, onFeedback, onHeight }: { thread: ReviewThread; expanded: boolean; onToggle(): void; colors: Colors; onFeedback(thread: ReviewThread): void; onHeight(height: number): void }) {
  const { t } = useMessages();
  return <View onLayout={(event) => onHeight(event.nativeEvent.layout.height)} testID={`inline-discussion-${thread.id}`}>
    <Pressable accessibilityRole="button" accessibilityLabel={t("threadComments", { count: thread.comments.length })} accessibilityState={{ expanded }} onPress={onToggle} style={{ minHeight: 36, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: colors.surface1, borderBottomWidth: 1, borderColor: colors.border }}>
      <CommentAvatar comment={thread.comments[0]} colors={colors} size={20} />
      <Text style={{ color: colors.foreground, fontSize: 12 }}>{t("threadComments", { count: thread.comments.length })}</Text>
      <Text numberOfLines={1} style={{ flex: 1, minWidth: 0, color: colors.foregroundMuted, fontSize: 12 }}>{thread.comments[0]?.name?.trim() || thread.comments[0]?.author}{thread.resolved ? ` · ${t("resolved")}` : ""}</Text>
      <Icon name={expanded ? "ChevronUp" : "ChevronDown"} size={12} color={colors.foregroundMuted} />
    </Pressable>
    {expanded ? <ThreadContent thread={thread} colors={colors} onFeedback={onFeedback} /> : null}
  </View>;
}
export function Discussions({ threads, resolved, onResolved, onJump, onFeedback, colors, inlineAvailable, truncated }: { threads: ReviewThread[]; resolved: boolean; onResolved(value: boolean): void; onJump(thread: ReviewThread): void; onFeedback(thread: ReviewThread): void; colors: Colors; inlineAvailable: boolean; truncated: boolean }) {
  const { t } = useMessages();
  const filtered = threads.filter((thread) => resolved || !thread.resolved);
  return <View style={{ flex: 1, minHeight: 0 }} testID="devspace-comments-page">
    <View style={{ paddingHorizontal: 12, flexDirection: "row", alignItems: "center", gap: 8, borderBottomWidth: 1, borderColor: colors.border }}><Text style={{ flex: 1, color: colors.foregroundMuted, fontSize: 12 }}>{t("threadComments", { count: filtered.length })}</Text><Pressable accessibilityRole="checkbox" accessibilityState={{ checked: resolved }} onPress={() => onResolved(!resolved)} style={{ minHeight: 44, justifyContent: "center" }}><Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>{resolved ? "✓ " : ""}{t("showResolved")}</Text></Pressable></View>
    {!inlineAvailable ? <Text style={{ paddingHorizontal: 12, paddingVertical: 8, fontSize: 12, color: colors.foregroundMuted }}>{t("inlineMismatch")}</Text> : null}
    <FlatList<ReviewThread> data={filtered} style={{ flex: 1 }} keyExtractor={(thread) => thread.id} initialNumToRender={6} windowSize={7}
      ListEmptyComponent={<Text style={{ padding: 16, color: colors.foregroundMuted, fontSize: 13 }}>{t("noDiscussions")}</Text>}
      ListFooterComponent={truncated ? <Text style={{ padding: 12, color: colors.foregroundMuted, fontSize: 11 }}>{t("discussionsTruncated")}</Text> : null}
      renderItem={({ item: thread }) => <ThreadContent thread={thread} colors={colors} onFeedback={onFeedback} onJump={onJump} />}
    />
  </View>;
}
