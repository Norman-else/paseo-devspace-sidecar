import { useState } from "react";
import { Platform, Pressable, Text, View, type TextStyle } from "react-native";
import { FlatList, Icon } from "@getpaseo/plugin/client/ui";
import type { PluginAgentPanelProps } from "@getpaseo/plugin/client";
import type { ReviewFile } from "../shared/diff";
import type { ReviewRow } from "../shared/review";
import { useMessages } from "./messages";

export type Colors = PluginAgentPanelProps["theme"]["colors"];
const mono = Platform.OS === "ios" ? "Menlo" : Platform.OS === "android" ? "monospace" : "ui-monospace, SFMono-Regular, Menlo, monospace";
export function ToolButton({ icon, label, colors, onPress, active = false }: { icon: string; label: string; colors: Colors; onPress(): void; active?: boolean }) {
  const [hover, setHover] = useState(false);
  return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} onHoverIn={() => setHover(true)} onHoverOut={() => setHover(false)}
    style={({ pressed }) => ({ width: 28, height: 28, alignItems: "center", justifyContent: "center", borderRadius: 4, backgroundColor: hover || pressed || active ? colors.surface2 : "transparent" })}>
    <Icon name={icon} size={14} color={active ? colors.foreground : colors.foregroundMuted} />
  </Pressable>;
}
export function Stats({ file, colors }: { file: ReviewFile; colors: Colors }) {
  const { t } = useMessages();
  return <View style={{ flexDirection: "row", gap: 5 }}>
    {!!file.additions && <Text style={{ color: colors.statusSuccess, fontSize: 10 }}>+{file.additions}</Text>}
    {!!file.deletions && <Text style={{ color: colors.statusDanger, fontSize: 10 }}>−{file.deletions}</Text>}
    {file.status === "?" ? <Text style={{ color: colors.statusSuccess, fontSize: 10 }}>{t("newFile")}</Text> : null}
  </View>;
}
export function FileHeader({ file, width, colors, collapsed, reviewed, onToggle, onReview }: {
  file: ReviewFile; width: number; colors: Colors; collapsed: boolean; reviewed: boolean; onToggle(): void; onReview(): void;
}) {
  const { t } = useMessages();
  const parts = file.path.split("/"); const name = parts.pop();
  return <View style={{ width, height: 36, backgroundColor: colors.surface1, borderTopWidth: 1, borderBottomWidth: 1, borderColor: colors.border, flexDirection: "row", alignItems: "center", paddingRight: 6 }}>
    <Pressable accessibilityRole="button" accessibilityLabel={t(collapsed ? "expandFile" : "collapseFile", { path: file.path })} accessibilityState={{ expanded: !collapsed }} onPress={onToggle}
      style={{ flex: 1, minWidth: 0, height: 34, flexDirection: "row", gap: 6, alignItems: "center", paddingLeft: 8, paddingRight: 8 }}>
      <Icon name={collapsed ? "ChevronRight" : "ChevronDown"} size={12} color={colors.foregroundMuted} />
      <Icon name="FileCode" size={13} color={colors.foregroundMuted} />
      <Text numberOfLines={1} ellipsizeMode="middle" style={{ color: reviewed ? colors.foregroundMuted : colors.foreground, fontSize: 12, fontWeight: "500", flexShrink: 1 }}>{name}</Text>
      <Text numberOfLines={1} ellipsizeMode="middle" style={{ color: colors.foregroundMuted, fontSize: 10, flex: 1, minWidth: 0 }}>{parts.join("/")}</Text>
    </Pressable>
    <Stats file={file} colors={colors} />
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
      style={({ pressed }) => ({ minHeight: 30, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 8, backgroundColor: pressed || hover === file.path || activePath === file.path ? colors.surface2 : colors.surface0 })}>
      <Icon name={file.hash && reviewed[file.path] === file.hash ? "CircleCheck" : "FileCode"} size={12} color={file.hash && reviewed[file.path] === file.hash ? colors.statusSuccess : colors.foregroundMuted} />
      <Text numberOfLines={1} ellipsizeMode="middle" style={{ flex: 1, minWidth: 0, color: file.status === "A" || file.status === "?" ? colors.statusSuccess : colors.foreground, fontSize: 11 }}>{file.path.split("/").at(-1)}</Text>
      <Stats file={file} colors={colors} />
    </Pressable>}
  />;
}
function tint(color: string, fallback: string): string {
  if (/^#[0-9a-f]{6}$/i.test(color)) return color + "1c";
  const rgb = /^rgba?\(\s*(\d+)[, ]+\s*(\d+)[, ]+\s*(\d+)/.exec(color);
  return rgb ? `rgba(${rgb[1]},${rgb[2]},${rgb[3]},0.11)` : fallback;
}
export function CodeLine({ row, colors, onHeight }: { row: Extract<ReviewRow, { kind: "code" }>; colors: Colors; onHeight(height: number): void }) {
  const { line, tokens } = row;
  const add = line.kind === "add", remove = line.kind === "remove";
  const tone = add ? colors.statusSuccess : remove ? colors.statusDanger : colors.foregroundMuted;
  const palette = { plain: colors.foreground, comment: colors.foregroundMuted, string: colors.statusSuccess, keyword: colors.accent, number: colors.statusWarning, type: colors.statusWarning, function: colors.accent };
  return <View onLayout={(event) => onHeight(event.nativeEvent.layout.height)} style={{ minHeight: 20, flexDirection: "row", alignItems: "flex-start", paddingRight: 8,
    backgroundColor: add || remove ? tint(tone, colors.surface1) : colors.surface0, borderLeftWidth: 3, borderLeftColor: add || remove ? tone : "transparent" }}>
    <Text style={{ width: 32, flexShrink: 0, textAlign: "right", paddingRight: 5, lineHeight: 20, color: colors.foregroundMuted, fontFamily: mono, fontSize: 10 }}>{line.old ?? ""}</Text>
    <Text style={{ width: 32, flexShrink: 0, textAlign: "right", paddingRight: 6, lineHeight: 20, color: colors.foregroundMuted, fontFamily: mono, fontSize: 10 }}>{line.next ?? ""}</Text>
    <Text style={{ width: 16, flexShrink: 0, lineHeight: 20, color: tone, fontFamily: mono, fontSize: 12 }}>{add ? "+" : remove ? "−" : " "}</Text>
    <Text selectable style={[
      { flex: 1, minWidth: 0, fontSize: 12, lineHeight: 20, fontFamily: mono, color: colors.foreground },
      Platform.OS === "web" ? ({ whiteSpace: "pre-wrap", overflowWrap: "anywhere", wordBreak: "break-all" } as unknown as TextStyle) : null,
    ]}>{tokens.map((token, index) => <Text key={index} style={{ color: palette[token.kind], fontFamily: mono, fontSize: 12, lineHeight: 20 }}>{token.text}</Text>)}</Text>
  </View>;
}
