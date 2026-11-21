import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Platform, Pressable, Text, TextInput as NativeTextInput, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useRpc } from "@getpaseo/plugin/client";
import { FlatList, Icon, TextInput, copyText, useToast } from "@getpaseo/plugin/client/ui";
import type { Workspace } from "../shared/diff";
import { chunkForUpload, fileReadRpc, fileWriteRpc, filesListRpc, type FileEntry, type FileWriteResult } from "../shared/files";
import { codeTokens, syntaxPalette } from "../shared/syntax";
import { codeReviewPalette } from "../shared/appearance";
import { FileTypeIcon } from "./file-icon";
import { ToolButton, type Colors } from "./review-ui";
import { Spinner } from "./spinner";
import { useCodeAppearance } from "./use-code-appearance";
import { useMessages } from "./messages";
import { watchSaveShortcut } from "./web";

type Editing = { text: string; original: string; baseHash: string; eol: "lf" | "crlf" };

/**
 * Browse and edit the bound workspace's files on the project host. Saves go through the sidecar, which refuses to
 * overwrite a file that changed after editing began (for example because the agent edited it).
 */
export function FileBrowser({ workspace, hostId, colors, wide, dir, file, agentBusy, onNavigate, onSaved }: {
  workspace: Workspace; hostId: string; colors: Colors; wide: boolean; dir: string; file?: string; agentBusy: boolean;
  onNavigate(next: { dir: string; file?: string }): void; onSaved(): void;
}) {
  const { t, translateBackend } = useMessages(), toast = useToast();
  const listCall = useRpc(filesListRpc), readCall = useRpc(fileReadRpc), writeCall = useRpc(fileWriteRpc);
  const [editing, setEditing] = useState<Editing | null>(null), [saving, setSaving] = useState(false), [conflict, setConflict] = useState(false);
  const list = useQuery({ queryKey: ["devspace-files-list", hostId, workspace.id, dir], queryFn: () => listCall({ workspaceId: workspace.id, path: dir }), staleTime: 5000, retry: false });
  const opened = useQuery({ queryKey: ["devspace-file", hostId, workspace.id, file], queryFn: () => readCall({ workspaceId: workspace.id, path: file! }), enabled: !!file, refetchInterval: editing ? false : 10000, retry: false });
  const dirty = !!editing && editing.text !== editing.original;
  useEffect(() => { setEditing(null); setConflict(false); }, [file, workspace.id]);
  const guard = () => { if (dirty) { toast.error(t("filesUnsaved")); return false; } setEditing(null); setConflict(false); return true; };
  const go = (next: { dir: string; file?: string }) => { if (guard()) onNavigate(next); };

  const save = async (force = false) => {
    if (!editing || !file || saving) return;
    setSaving(true);
    try {
      const text = editing.eol === "crlf" ? editing.text.replace(/\r?\n/g, "\r\n") : editing.text;
      const chunks = chunkForUpload(text), uploadId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
      // The sidecar assembles chunks in any order; the request that completes the set returns the outcome.
      const results: FileWriteResult[] = [];
      for (let start = 0; start < chunks.length; start += 4) results.push(...await Promise.all(chunks.slice(start, start + 4).map((chunk, offset) => writeCall({ workspaceId: workspace.id, path: file, expectedHash: editing.baseHash, force, uploadId, index: start + offset, total: chunks.length, chunk }))));
      const result = results.find((item) => item.status !== "partial");
      if (result?.status === "saved") { setEditing(null); setConflict(false); toast.show(t("filesSaved")); await opened.refetch(); onSaved(); }
      else if (result?.status === "conflict") setConflict(true);
    } catch (error) { toast.error(error instanceof Error ? translateBackend(error.message) : t("filesSaveFailed")); }
    finally { setSaving(false); }
  };
  const saveRef = useRef(save); saveRef.current = save;
  useEffect(() => editing ? watchSaveShortcut(() => { void saveRef.current(); }) : undefined, [!!editing]);

  const rootName = workspace.root.split(/[\\/]/).filter(Boolean).at(-1) ?? workspace.root;
  const listPane = <View style={{ flex: wide ? undefined : 1, width: wide ? 260 : undefined, minHeight: 0, borderRightWidth: wide ? 1 : 0, borderColor: colors.border }}>
    <Breadcrumb root={rootName} dir={dir} colors={colors} onPress={(path) => go({ dir: path, file })} />
    {list.isPending ? <View style={{ padding: 16, alignItems: "center" }}><Spinner size={18} color={colors.foregroundMuted} /></View>
      : list.error ? <Text style={{ padding: 12, color: colors.statusDanger, fontSize: 12 }}>{translateBackend(list.error.message)}</Text>
      : <FlatList<FileEntry> data={list.data?.entries ?? []} keyExtractor={(entry) => entry.path} style={{ flex: 1 }} initialNumToRender={60}
        ListHeaderComponent={dir ? <EntryRow label=".." icon={<Icon name="CornerLeftUp" size={14} color={colors.foregroundMuted} />} colors={colors} wide={wide} onPress={() => go({ dir: dir.split("/").slice(0, -1).join("/"), file })} /> : null}
        ListEmptyComponent={<Text style={{ padding: 12, color: colors.foregroundMuted, fontSize: 12 }}>{t("filesEmptyDir")}</Text>}
        ListFooterComponent={list.data?.truncated ? <Text style={{ padding: 12, color: colors.foregroundMuted, fontSize: 11 }}>{t("filesTruncated")}</Text> : null}
        renderItem={({ item: entry }) => <EntryRow label={entry.name} muted={entry.ignored} selected={entry.path === file} colors={colors} wide={wide}
          icon={entry.type === "dir" ? <Icon name="Folder" size={14} color={colors.foregroundMuted} /> : <FileTypeIcon path={entry.path} size={14} colors={colors} />}
          onPress={() => entry.type === "dir" ? go({ dir: entry.path, file }) : go({ dir, file: entry.path })} />} />}
  </View>;

  const data = opened.data;
  const viewer = !file ? <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24 }}><Text style={{ color: colors.foregroundMuted, fontSize: 13 }}>{t("filesSelect")}</Text></View>
    : <View style={{ flex: 1, minWidth: 0, minHeight: 0 }}>
      <View style={{ minHeight: 40, paddingHorizontal: 10, flexDirection: "row", alignItems: "center", gap: 8, borderBottomWidth: 1, borderColor: colors.border, backgroundColor: colors.surface1 }}>
        {!wide ? <ToolButton icon="ArrowLeft" label={t("filesBack")} colors={colors} touch onPress={() => go({ dir })} /> : null}
        <FileTypeIcon path={file} size={14} colors={colors} />
        <Text numberOfLines={1} ellipsizeMode="middle" selectable style={{ flex: 1, minWidth: 0, color: colors.foreground, fontSize: 12, fontWeight: "500" }}>{file}{dirty ? `  ·  ${t("filesUnsavedMark")}` : ""}</Text>
        <ToolButton icon="Copy" label={t("filesCopyPath")} colors={colors} touch={!wide} onPress={() => { void copyText(file).then(() => toast.show(t("filesCopied"))); }} />
        {editing ? <>
          <SmallButton label={t("filesCancel")} colors={colors} disabled={saving} onPress={() => { setEditing(null); setConflict(false); }} />
          <SmallButton primary label={saving ? t("filesSaving") : t("filesSave")} busy={saving} disabled={!dirty || saving} colors={colors} onPress={() => void save()} />
        </> : data?.kind === "text" ? <SmallButton icon="Pencil" label={t("filesEdit")} colors={colors} onPress={() => setEditing({ text: data.content!.replace(/\r\n/g, "\n"), original: data.content!.replace(/\r\n/g, "\n"), baseHash: data.hash!, eol: data.eol })} /> : null}
      </View>
      {editing && agentBusy ? <Text style={{ paddingHorizontal: 12, paddingVertical: 6, color: colors.statusWarning, fontSize: 11 }}>{t("filesAgentBusy")}</Text> : null}
      {conflict && editing ? <View style={{ paddingHorizontal: 12, paddingVertical: 8, gap: 8, borderBottomWidth: 1, borderColor: colors.border }}>
        <Text style={{ color: colors.statusWarning, fontSize: 12 }}>{t("filesConflict")}</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          <SmallButton label={t("filesReload")} colors={colors} onPress={() => { setEditing(null); setConflict(false); void opened.refetch(); }} />
          <SmallButton label={t("filesCopyMine")} colors={colors} onPress={() => { void copyText(editing.text).then(() => toast.show(t("filesCopied"))); }} />
          <SmallButton label={t("filesOverwrite")} colors={colors} danger onPress={() => void save(true)} />
        </View>
      </View> : null}
      {opened.isPending ? <View style={{ padding: 20, alignItems: "center" }}><Spinner size={18} color={colors.foregroundMuted} /></View>
        : opened.error ? <Text style={{ padding: 12, color: colors.statusDanger, fontSize: 12 }}>{translateBackend(opened.error.message)}</Text>
        : data?.kind === "binary" ? <Text style={{ padding: 16, color: colors.foregroundMuted, fontSize: 13 }}>{t("filesBinary")}</Text>
        : data?.kind === "too_large" ? <Text style={{ padding: 16, color: colors.foregroundMuted, fontSize: 13 }}>{t("filesTooLarge")}</Text>
        : editing ? <Editor value={editing.text} label={t("filesContents")} colors={colors} onChange={(text) => setEditing({ ...editing, text })} />
        : data?.content != null ? <CodeView path={file} content={data.content} colors={colors} /> : null}
    </View>;

  return <View testID="devspace-files" style={{ flex: 1, minHeight: 0, flexDirection: "row", backgroundColor: colors.surface0 }}>
    {wide ? <>{listPane}{viewer}</> : file ? viewer : listPane}
  </View>;
}

function Breadcrumb({ root, dir, colors, onPress }: { root: string; dir: string; colors: Colors; onPress(path: string): void }) {
  const parts = dir ? dir.split("/") : [];
  return <View style={{ minHeight: 34, paddingHorizontal: 10, flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 2, borderBottomWidth: 1, borderColor: colors.border }}>
    {[root, ...parts].map((part, index) => <View key={index} style={{ flexDirection: "row", alignItems: "center", gap: 2 }}>
      {index ? <Icon name="ChevronRight" size={11} color={colors.foregroundMuted} /> : null}
      <Pressable accessibilityRole="link" onPress={() => onPress(parts.slice(0, index).join("/"))}><Text numberOfLines={1} style={{ color: index === parts.length ? colors.foreground : colors.foregroundMuted, fontSize: 12, fontWeight: index === parts.length ? "500" : "400" }}>{part}</Text></Pressable>
    </View>)}
  </View>;
}

function EntryRow({ label, icon, muted = false, selected = false, colors, wide, onPress }: { label: string; icon: ReactNode; muted?: boolean; selected?: boolean; colors: Colors; wide: boolean; onPress(): void }) {
  const [hover, setHover] = useState(false);
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected }} onPress={onPress} onHoverIn={() => setHover(true)} onHoverOut={() => setHover(false)}
    style={{ minHeight: wide ? 28 : 40, paddingHorizontal: 10, flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: selected || hover ? colors.surface2 : "transparent", opacity: muted ? 0.55 : 1 }}>
    {icon}<Text numberOfLines={1} ellipsizeMode="middle" style={{ flex: 1, minWidth: 0, color: colors.foreground, fontSize: 13 }}>{label}</Text>
  </Pressable>;
}

function SmallButton({ label, icon, primary = false, danger = false, busy = false, disabled = false, colors, onPress }: { label: string; icon?: string; primary?: boolean; danger?: boolean; busy?: boolean; disabled?: boolean; colors: Colors; onPress(): void }) {
  const [hover, setHover] = useState(false);
  const foreground = disabled && !busy ? colors.foregroundMuted : primary ? colors.accentForeground : danger ? colors.statusDanger : colors.foreground;
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled, busy }} disabled={disabled} onPress={onPress} onHoverIn={() => setHover(true)} onHoverOut={() => setHover(false)}
    style={({ pressed }) => ({ height: 26, paddingHorizontal: 9, borderRadius: 4, flexDirection: "row", alignItems: "center", gap: 5, borderWidth: 1, borderColor: primary && !disabled ? colors.accent : colors.border,
      backgroundColor: primary && !disabled ? colors.accent : hover ? colors.surface2 : "transparent", opacity: pressed ? 0.75 : disabled && !busy ? 0.6 : 1 })}>
    {busy ? <Spinner size={12} color={foreground} /> : icon ? <Icon name={icon} size={12} color={foreground} /> : null}
    <Text numberOfLines={1} style={{ color: foreground, fontSize: 11, lineHeight: 16, fontWeight: "600" }}>{label}</Text>
  </Pressable>;
}

function CodeView({ path, content, colors }: { path: string; content: string; colors: Colors }) {
  const typography = useCodeAppearance(), palette = codeReviewPalette(colors.surface0), syntax = syntaxPalette(palette.dark, colors.foreground);
  const lines = useMemo(() => {
    const state = { block: false };
    return content.replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n").map((text, index) => ({ number: index + 1, tokens: codeTokens(text, path, state) }));
  }, [content, path]);
  const gutter = Math.max(32, String(lines.length).length * typography.characterWidth + 16);
  return <FlatList<typeof lines[number]> data={lines} keyExtractor={(line) => String(line.number)} style={{ flex: 1, backgroundColor: palette.background }} initialNumToRender={80} windowSize={11}
    renderItem={({ item: line }) => <View style={{ flexDirection: "row", alignItems: "flex-start", minHeight: typography.lineHeight }}>
      <Text style={{ width: gutter, paddingRight: 10, textAlign: "right", color: colors.foregroundMuted, fontFamily: typography.fontFamily, fontSize: typography.gutterFontSize, lineHeight: typography.lineHeight }}>{line.number}</Text>
      <Text selectable style={{ flex: 1, minWidth: 0, paddingRight: 12, fontFamily: typography.fontFamily, fontSize: typography.fontSize, lineHeight: typography.lineHeight }}>
        {line.tokens.length ? line.tokens.map((token, index) => <Text key={index} style={{ color: syntax[token.kind] }}>{token.text}</Text>) : " "}
      </Text>
    </View>} />;
}

function Editor({ value, label, colors, onChange }: { value: string; label: string; colors: Colors; onChange(text: string): void }) {
  const typography = useCodeAppearance(), palette = codeReviewPalette(colors.surface0);
  const input = useRef<NativeTextInput>(null);
  useEffect(() => { input.current?.focus(); }, []);
  return <TextInput ref={input} multiline value={value} onChangeText={onChange} autoCorrect={false} autoCapitalize="none" spellCheck={false} textAlignVertical="top" scrollEnabled
    accessibilityLabel={label} style={{ flex: 1, minHeight: 0, padding: 12, margin: 0, borderWidth: 0, backgroundColor: palette.background, color: syntaxPalette(palette.dark, colors.foreground).plain,
      fontFamily: typography.fontFamily, fontSize: typography.fontSize, lineHeight: typography.lineHeight, ...(Platform.OS === "web" ? { outlineStyle: "none" } as object : {}) }} />;
}
