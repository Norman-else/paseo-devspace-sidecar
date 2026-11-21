import { useState } from "react";
import { Platform, Pressable, Text, View, type TextStyle, type ViewStyle } from "react-native";
import { FlatList, Icon } from "@getpaseo/plugin/client/ui";
import type { PluginAgentPanelProps } from "@getpaseo/plugin/client";
import type { ReviewFile } from "../shared/diff";
import type { ReviewRow } from "../shared/review";
import { useMessages } from "./messages";
import { syntaxPalette } from "../shared/syntax";
import { codeReviewPalette, diffBackground, SELECTION_HANDLE_WIDTH, type CodeAppearance } from "../shared/appearance";
import { codeSelectionProps, selectionHandleProps } from "./web";
import type { LineSelection } from "../shared/selection";

export type Colors = PluginAgentPanelProps["theme"]["colors"];
const nonSelectingStyle = Platform.OS === "web" ? ({ userSelect: "none", touchAction: "none", cursor: "crosshair" } as unknown as ViewStyle) : {};
const fileNameTypography = { fontSize: 12, lineHeight: 18, fontWeight: "500" as const };
export function ToolButton({ icon, label, colors, onPress, active = false, touch = false, expanded }: { icon: string; label: string; colors: Colors; onPress(): void; active?: boolean; touch?: boolean; expanded?: boolean }) {
  const [hover, setHover] = useState(false);
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={expanded === undefined ? undefined : { expanded }} aria-expanded={expanded} onPress={onPress} onHoverIn={() => setHover(true)} onHoverOut={() => setHover(false)}
    style={{ width: touch ? 44 : 28, height: touch ? 44 : 28, alignItems: "center", justifyContent: "center" }}>
    {({ pressed }) => <View style={{ width: touch ? 32 : 28, height: touch ? 32 : 28, alignItems: "center", justifyContent: "center", borderRadius: 4, backgroundColor: hover || pressed || active ? colors.surface2 : "transparent" }}><Icon name={icon} size={touch ? 16 : 14} color={active ? colors.foreground : colors.foregroundMuted} /></View>}
  </Pressable>;
}
export function Stats({ file, colors }: { file: ReviewFile; colors: Colors }) {
  const { t } = useMessages();
  const fontSize = 10;
  return <View style={{ flexDirection: "row", gap: 5 }}>
    {!!file.additions && <Text style={{ color: colors.statusSuccess, fontSize }}>+{file.additions}</Text>}
    {!!file.deletions && <Text style={{ color: colors.statusDanger, fontSize }}>−{file.deletions}</Text>}
    {file.status === "?" ? <Text style={{ color: colors.statusSuccess, fontSize }}>{t("newFile")}</Text> : null}
  </View>;
}
export function FileHeader({ file, width, colors, collapsed, reviewed, onToggle, onReview, commentCount = 0, onComments }: {
  file: ReviewFile; width: number; colors: Colors; collapsed: boolean; reviewed: boolean; onToggle(): void; onReview(): void;
  commentCount?: number; onComments?(): void;
}) {
  const { t } = useMessages();
  const parts = file.path.split("/"); const name = parts.pop();
  return <View style={{ width, height: 36, backgroundColor: colors.surface1, borderTopWidth: 1, borderBottomWidth: 1, borderColor: colors.border, flexDirection: "row", alignItems: "center", paddingRight: 6 }}>
    <Pressable accessibilityRole="button" accessibilityLabel={t(collapsed ? "expandFile" : "collapseFile", { path: file.path })} accessibilityState={{ expanded: !collapsed }} onPress={onToggle}
      style={{ flex: 1, minWidth: 0, height: 34, flexDirection: "row", gap: 6, alignItems: "center", paddingLeft: 8, paddingRight: 8 }}>
      <Icon name={collapsed ? "ChevronRight" : "ChevronDown"} size={12} color={colors.foregroundMuted} />
      <Icon name="FileCode" size={13} color={colors.foregroundMuted} />
      <Text numberOfLines={1} ellipsizeMode="middle" style={[fileNameTypography, { color: reviewed ? colors.foregroundMuted : colors.foreground, flexShrink: 1 }]}>{name}</Text>
      <Text numberOfLines={1} ellipsizeMode="middle" style={{ color: colors.foregroundMuted, fontSize: 10, flex: 1, minWidth: 0 }}>{parts.join("/")}</Text>
    </Pressable>
    <Stats file={file} colors={colors} />
    {commentCount > 0 && onComments ? <Pressable accessibilityRole="button" accessibilityLabel={t("fileComments", { path: file.path })} onPress={onComments} style={{ minHeight: 34, paddingHorizontal: 7, flexDirection: "row", alignItems: "center", gap: 4 }}><Icon name="MessageSquare" size={12} color={colors.foregroundMuted} /><Text style={{ color: colors.foregroundMuted, fontSize: 11 }}>{commentCount}</Text></Pressable> : null}
    <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: reviewed }} accessibilityLabel={t(reviewed ? "clearReviewed" : "markReviewed", { path: file.path })} onPress={onReview}
      style={{ width: 28, height: 28, alignItems: "center", justifyContent: "center", marginLeft: 4 }}>
      <Icon name={reviewed ? "CircleCheck" : "Circle"} size={14} color={reviewed ? colors.statusSuccess : colors.foregroundMuted} />
    </Pressable>
  </View>;
}
export function FileIndex({ files, activePath, reviewed, colors, onJump }: { files: ReviewFile[]; activePath: string; reviewed: Record<string, string>; colors: Colors; onJump(path: string): void }) {
  const { t } = useMessages();
  const [hover, setHover] = useState<string | null>(null);
  return <FlatList<ReviewFile> data={files} keyExtractor={(f) => f.path} style={{ flex: 1 }} initialNumToRender={50}
    renderItem={({ item: file }) => <Pressable accessibilityRole="button" accessibilityLabel={t("jumpFile", { path: file.path })} accessibilityState={{ selected: activePath === file.path }}
      onPress={() => onJump(file.path)} onHoverIn={() => setHover(file.path)} onHoverOut={() => setHover(null)}
      style={({ pressed }) => ({ minHeight: 32, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 8, backgroundColor: pressed || hover === file.path || activePath === file.path ? colors.surface2 : colors.surface0 })}>
      <Icon name={file.hash && reviewed[file.path] === file.hash ? "CircleCheck" : "FileCode"} size={13} color={file.hash && reviewed[file.path] === file.hash ? colors.statusSuccess : colors.foregroundMuted} />
      <Text numberOfLines={1} ellipsizeMode="middle" style={[fileNameTypography, { flex: 1, minWidth: 0, color: file.status === "A" || file.status === "?" ? colors.statusSuccess : colors.foreground }]}>{file.path.split("/").at(-1)}</Text>
      <Stats file={file} colors={colors} />
    </Pressable>}
  />;
}
export function CodeLine({ row, colors, typography, onHeight, selection, onSelect, match = false, selectionScope = "", compact = false, onDragStart, onDragMove, onDragEnd }: { row: Extract<ReviewRow, { kind: "code" }>; colors: Colors; typography: CodeAppearance; onHeight(height: number): void; selection?: LineSelection | null; onSelect?(side: "old" | "new", line: number): void; match?: boolean; selectionScope?: string; compact?: boolean; onDragStart?(path: string, side: "old" | "new", line: number, pageY: number): void; onDragMove?(pageY: number): void; onDragEnd?(): void }) {
  const { t } = useMessages();
  const [hovered, setHovered] = useState(false);
  const { fontFamily, fontSize, lineHeight, gutterFontSize, gutterCellWidth, markerWidth } = typography;
  const { line, tokens } = row;
  const reviewPalette = codeReviewPalette(colors.surface0);
  const add = line.kind === "add", remove = line.kind === "remove";
  const number = selection?.side === "old" ? line.old : line.next;
  const selected = selection?.path === row.path && number !== undefined && number >= Math.min(selection.start, selection.end) && number <= Math.max(selection.start, selection.end);
  const handleActive = hovered || selected && (number === selection?.start || number === selection?.end);
  const tone = add ? reviewPalette.addedMarker : remove ? reviewPalette.removedMarker : colors.foregroundMuted;
  const palette = syntaxPalette(reviewPalette.dark, colors.foreground);
  const handleSide = line.next === undefined ? "old" : "new", handleLine = (line.next ?? line.old)!;
  return <View {...codeSelectionProps(selectionScope, row.path, line.old, line.next)} onPointerEnter={() => setHovered(true)} onPointerLeave={() => setHovered(false)} onLayout={(event) => onHeight(event.nativeEvent.layout.height)} style={{ minHeight: lineHeight, flexDirection: "row", alignItems: "flex-start", paddingRight: 8,
    backgroundColor: selected ? diffBackground(colors.accent, reviewPalette.background) : add ? reviewPalette.added : remove ? reviewPalette.removed : reviewPalette.background, borderLeftWidth: 3, borderLeftColor: selected ? colors.accent : match ? colors.statusWarning : add || remove ? tone : "transparent" }}>
    <View {...selectionHandleProps} accessible accessibilityRole="button" accessibilityLabel={t("dragCodeSelection", { path: row.path, line: handleLine, side: t(handleSide === "old" ? "versionOld" : "versionNew") })} accessibilityActions={[{ name: "activate" }]} onAccessibilityTap={() => onSelect?.(handleSide, handleLine)} onAccessibilityAction={() => onSelect?.(handleSide, handleLine)}
      onStartShouldSetResponder={() => !!onDragStart} onMoveShouldSetResponder={() => !!onDragStart} onResponderTerminationRequest={() => false}
      onResponderGrant={(event) => { event.preventDefault(); const pageY = event.nativeEvent.pageY; onDragStart?.(row.path, handleSide, handleLine, pageY); }}
      onResponderMove={(event) => { event.preventDefault(); const pageY = event.nativeEvent.pageY; onDragMove?.(pageY); }} onResponderRelease={() => onDragEnd?.()} onResponderTerminate={() => onDragEnd?.()}
      style={{ ...nonSelectingStyle, width: SELECTION_HANDLE_WIDTH, height: lineHeight, flexShrink: 0, alignItems: "center", justifyContent: "center", opacity: handleActive || compact || Platform.OS !== "web" ? 1 : 0 }}>
      <View pointerEvents="none" style={{ width: 18, height: 18, borderRadius: 3, backgroundColor: handleActive ? colors.statusSuccess : "transparent", alignItems: "center", justifyContent: "center" }}><Icon name="Plus" size={12} color={handleActive ? colors.surface0 : colors.statusSuccess} /></View>
    </View>
    {(["old", "new"] as const).map((side) => <Pressable key={side} accessibilityRole="button" accessibilityLabel={t("selectCodeLine", { path: row.path, line: side === "old" ? line.old ?? "" : line.next ?? "", side: t(side === "old" ? "versionOld" : "versionNew") })} disabled={!onSelect || (side === "old" ? line.old : line.next) === undefined} onPress={() => onSelect?.(side, (side === "old" ? line.old : line.next)!)} style={{ ...nonSelectingStyle, width: gutterCellWidth, minHeight: lineHeight, flexShrink: 0 }}><Text selectable={false} style={{ textAlign: "right", paddingRight: 6, lineHeight, color: selected ? colors.foreground : colors.foregroundMuted, fontFamily, fontSize: gutterFontSize, userSelect: "none" }}>{(side === "old" ? line.old : line.next) ?? ""}</Text></Pressable>)}
    <Text selectable={false} style={{ width: markerWidth, flexShrink: 0, lineHeight, color: tone, fontFamily, fontSize, userSelect: "none" }}>{add ? "+" : remove ? "−" : " "}</Text>
    <Text selectable style={[
      { flex: 1, minWidth: 0, fontSize, lineHeight, fontFamily, color: colors.foreground },
      Platform.OS === "web" ? ({ whiteSpace: "pre-wrap", overflowWrap: "anywhere", wordBreak: "break-all" } as unknown as TextStyle) : null,
    ]}>{tokens.map((token, index) => <Text key={index} style={{ color: palette[token.kind], fontFamily, fontSize, lineHeight }}>{token.text}</Text>)}</Text>
  </View>;
}
