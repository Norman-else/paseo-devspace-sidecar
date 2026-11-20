import { useState } from "react";
import { Platform, Pressable, Text, View, useWindowDimensions } from "react-native";
import { ExternalLink, FlatList, Icon, Markdown } from "@getpaseo/plugin/client/ui";
import type { ReviewThread } from "../shared/review-details";
import { type Colors } from "./review-ui";
import { useMessages } from "./messages";
import { CommentAuthor, CommentAvatar } from "./comment-author";
import { ReviewMenu } from "./review-menu";
export function ThreadContent({ thread, colors, onFeedback, onJump, onHeight, preview = false, selection }: { thread: ReviewThread; colors: Colors; onFeedback(thread: ReviewThread): void; onJump?(thread: ReviewThread): void; onHeight?(height: number): void; preview?: boolean; selection?: { checked: boolean; onToggle(): void } }) {
  const { t } = useMessages();
  const { width } = useWindowDimensions();
  const actionHeight = Platform.OS === "web" && width >= 560 ? 32 : 44;
  const [expanded, setExpanded] = useState(false);
  const comments = preview && !expanded ? thread.comments.slice(0, 1) : thread.comments;
  return <View onLayout={(event) => onHeight?.(event.nativeEvent.layout.height)} style={{ padding: 12, gap: 8, backgroundColor: colors.surface1, borderBottomWidth: 1, borderColor: colors.border }}>
    <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8 }}>{selection ? <Pressable accessibilityRole="checkbox" accessibilityLabel={t("batchSelectComment")} accessibilityState={{ checked: selection.checked }} onPress={selection.onToggle} hitSlop={8} style={{ minHeight: 24, justifyContent: "center" }}><Icon name={selection.checked ? "SquareCheck" : "Square"} size={16} color={selection.checked ? colors.accent : colors.foregroundMuted} /></Pressable> : null}<Text numberOfLines={1} style={{ flex: 1, minWidth: 0, color: colors.foregroundMuted, fontSize: 11 }}>{thread.path}{thread.line ? `:${thread.line}` : ""}</Text><Text style={{ color: thread.resolved ? colors.foregroundMuted : colors.statusWarning, fontSize: 11 }}>{t(thread.outdated ? "outdated" : thread.resolved ? "resolved" : "unresolved")}</Text></View>
    <View>
      {comments.map((comment, index) => <View key={comment.url} testID="devspace-comment" style={{ gap: 12, paddingTop: index ? 16 : 4, paddingBottom: 16, borderTopWidth: index ? 1 : 0, borderColor: colors.border }}><CommentAuthor comment={comment} colors={colors} />{preview && !expanded ? <Text selectable numberOfLines={3} style={{ color: colors.foreground, fontSize: 13, lineHeight: 19 }}>{comment.body}</Text> : <Markdown>{comment.body}</Markdown>}</View>)}
    </View>
    {preview && (thread.comments.length > 1 || (thread.comments[0]?.body.length ?? 0) > 140) ? <Pressable accessibilityRole="button" onPress={() => setExpanded(!expanded)} style={{ minHeight: 36, justifyContent: "center" }}><Text style={{ color: colors.accent, fontSize: 12 }}>{t(expanded ? "collapseDiscussion" : "expandDiscussion", { count: thread.comments.length })}</Text></Pressable> : null}
    {thread.truncated ? <Text style={{ fontSize: 11, color: colors.foregroundMuted }}>{t("discussionsTruncated")}</Text> : null}
    <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8, paddingTop: 12, borderTopWidth: 1, borderColor: colors.border }}>
      {onJump && !thread.outdated ? <CommentAction height={actionHeight} label={t("jumpToCode")} colors={colors} onPress={() => onJump(thread)} /> : null}
      <CommentAction height={actionHeight} primary label={t("requestChange")} colors={colors} onPress={() => onFeedback(thread)} />
      {thread.comments[0] ? <ExternalLink href={thread.comments[0].url}><View style={{ minHeight: actionHeight, paddingHorizontal: 8, justifyContent: "center" }}><Text style={{ color: colors.foregroundMuted, fontSize: 12, textDecorationLine: "underline" }}>{t("viewOnGitHub")}</Text></View></ExternalLink> : null}
    </View>
  </View>;
}
function CommentAction({ label, colors, onPress, height, primary = false }: { height: number; label: string; colors: Colors; onPress(): void; primary?: boolean }) {
  const [hover, setHover] = useState(false);
  return <Pressable accessibilityRole="button" onPress={onPress} onHoverIn={() => setHover(true)} onHoverOut={() => setHover(false)}
    style={({ pressed }) => ({ minHeight: height, paddingHorizontal: 12, justifyContent: "center", borderWidth: 1, borderColor: hover || pressed ? colors.foregroundMuted : colors.border, borderRadius: 6, backgroundColor: primary || hover || pressed ? colors.surface2 : colors.surface0, opacity: pressed ? 0.75 : 1 })}>
    <Text style={{ color: colors.foreground, fontSize: 12, lineHeight: 18, fontWeight: "500" }}>{label}</Text>
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
export function Discussions({ threads, resolved, onResolved, onJump, onFeedback, colors, inlineAvailable, truncated, onBatch, busy = false }: { threads: ReviewThread[]; resolved: boolean; onResolved(value: boolean): void; onJump(thread: ReviewThread): void; onFeedback(thread: ReviewThread): void; colors: Colors; inlineAvailable: boolean; truncated: boolean; onBatch?(threads: ReviewThread[]): void; busy?: boolean }) {
  const { t } = useMessages();
  const { width } = useWindowDimensions();
  const filtered = threads.filter((thread) => resolved || !thread.resolved);
  const unresolved = threads.filter((thread) => !thread.resolved);
  const [selecting, setSelecting] = useState(false), [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const chosen = filtered.filter((thread) => selected.has(thread.id));
  const toggle = (id: string) => setSelected((previous) => { const next = new Set(previous); if (!next.delete(id)) next.add(id); return next; });
  const send = (list: ReviewThread[]) => { if (!list.length || busy) return; onBatch?.(list); setSelecting(false); };
  return <View style={{ flex: 1, minHeight: 0 }} testID="devspace-comments-page">
    <View style={{ paddingHorizontal: 12, minHeight: 44, flexDirection: "row", alignItems: "center", flexWrap: "wrap", columnGap: 8, rowGap: 4, borderBottomWidth: 1, borderColor: colors.border }}><View style={{ flex: 1, minWidth: 80, flexDirection: "row", alignItems: "center" }}>{selecting ? <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>{t("batchSelected", { count: chosen.length })}</Text>
        : <ReviewMenu title={t("commentFilter")} label={resolved ? t("commentFilterAllLabel", { count: threads.length }) : t("commentFilterUnresolvedLabel", { count: unresolved.length })} colors={colors} touch={width < 560} width={260} options={[
          { id: "unresolved", label: t("commentFilterUnresolved"), description: t("commentFilterUnresolvedHelp"), selected: !resolved, onSelect: () => onResolved(false) },
          { id: "all", label: t("commentFilterAll"), description: t("commentFilterAllHelp"), selected: resolved, onSelect: () => onResolved(true) },
        ]} />}</View>
      {onBatch && selecting ? <>
        <HeaderButton label={t("batchCancel")} colors={colors} onPress={() => setSelecting(false)} />
        <HeaderButton primary icon="Sparkles" label={t("batchSend", { count: chosen.length })} hint={busy ? t("gitAgentBusy") : undefined} disabled={!chosen.length || busy} colors={colors} onPress={() => send(chosen)} />
      </> : onBatch && unresolved.length ? <>
        <HeaderButton icon="ListChecks" label={t("batchSelect")} colors={colors} onPress={() => { setSelected(new Set(unresolved.map((thread) => thread.id))); setSelecting(true); }} />
        <HeaderButton primary icon="Sparkles" label={t("batchAll", { count: unresolved.length })} hint={busy ? t("gitAgentBusy") : undefined} disabled={busy} colors={colors} onPress={() => send(unresolved)} />
      </> : null}</View>
    {!inlineAvailable ? <Text style={{ paddingHorizontal: 12, paddingVertical: 8, fontSize: 12, color: colors.foregroundMuted }}>{t("inlineMismatch")}</Text> : null}
    <FlatList<ReviewThread> data={filtered} style={{ flex: 1 }} keyExtractor={(thread) => thread.id} initialNumToRender={6} windowSize={7}
      ListEmptyComponent={<Text style={{ padding: 16, color: colors.foregroundMuted, fontSize: 13 }}>{t("noDiscussions")}</Text>}
      ListFooterComponent={truncated ? <Text style={{ padding: 12, color: colors.foregroundMuted, fontSize: 11 }}>{t("discussionsTruncated")}</Text> : null}
      extraData={selecting ? selected : null}
      renderItem={({ item: thread }) => <ThreadContent thread={thread} colors={colors} onFeedback={onFeedback} onJump={onJump} selection={selecting ? { checked: selected.has(thread.id), onToggle: () => toggle(thread.id) } : undefined} />}
    />
  </View>;
}
function HeaderButton({ label, icon, primary = false, disabled = false, hint, colors, onPress }: { label: string; icon?: string; primary?: boolean; disabled?: boolean; hint?: string; colors: Colors; onPress(): void }) {
  const [hover, setHover] = useState(false);
  const foreground = disabled ? colors.foregroundMuted : primary ? colors.accentForeground : colors.foreground;
  const background = disabled ? (primary ? colors.surface2 : "transparent") : primary ? colors.accent : hover ? colors.surface2 : "transparent";
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityHint={hint} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} onHoverIn={() => setHover(true)} onHoverOut={() => setHover(false)} style={{ minHeight: 36, justifyContent: "center" }}>
    {({ pressed }) => <View style={{ height: 26, flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 9, borderRadius: 4, borderWidth: 1, borderColor: primary && !disabled ? colors.accent : colors.border, backgroundColor: background, opacity: pressed ? 0.75 : 1 }}>
      {icon ? <Icon name={icon} size={12} color={foreground} /> : null}
      <Text numberOfLines={1} style={{ color: foreground, fontSize: 11, lineHeight: 16, fontWeight: "600" }}>{label}</Text>
    </View>}
  </Pressable>;
}
