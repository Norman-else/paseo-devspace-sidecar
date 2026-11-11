import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, Text, View, type FlatList as NativeFlatList, type ViewToken } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useRpc, useTabState, type PluginAgentPanelProps } from "@getpaseo/plugin/client";
import { FlatList, Icon, TextInput } from "@getpaseo/plugin/client/ui";
import { z } from "zod";
import { catalogRpc, comparison, fileRpc, pullRequestRpc, reviewRpc, snapshotRpc, type ReviewFile } from "../shared/diff";
import { reviewRows, type ReviewRow } from "../shared/review";
import { CodeLine, FileHeader, FileIndex, ToolButton } from "./review-ui";
import { DIVIDER_WIDTH, ResizeDivider } from "./resize-divider";
import { useRowMeasurements } from "./use-row-measurements";
import { useMessages } from "./messages";
import { useCodeAppearance } from "./use-code-appearance";
import { PullRequestStatus } from "./pull-request-status";
import { reviewHeader } from "../shared/review-header";

const stateSchema = z.object({ comparison, scope: z.string().default(""), collapsed: z.array(z.string()).default([]), reviewed: z.record(z.string(), z.string()).default({}), indexWidth: z.number().min(140).max(520).nullable().default(null) });
export function DiffPanel({ theme, host, params, tab }: PluginAgentPanelProps) {
  const { t, translateBackend } = useMessages();
  const typography = useCodeAppearance();
  const [state, save] = useTabState(tab, stateSchema, { comparison: "task" as const, scope: "", collapsed: [] as string[], reviewed: {} as Record<string, string>, indexWidth: null as number | null });
  const latestState = useRef(state);
  latestState.current = state;
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [indexOpen, setIndexOpen] = useState(false);
  const [activePath, setActivePath] = useState("");
  const [jump, setJump] = useState<string | null>(null);
  const [size, setSize] = useState({ width: 700, height: 700 });
  const [overrides, setOverrides] = useState<Record<string, { revision: string; file: ReviewFile }>>({});
  const colors = theme.colors;
  const catalogCall = useRpc(catalogRpc), snapshotCall = useRpc(snapshotRpc), reviewCall = useRpc(reviewRpc), fileCall = useRpc(fileRpc);
  const catalog = useQuery({ queryKey: ["devspace-context-v2", host.id, params.agentId], queryFn: () => catalogCall({ agentId: params.agentId }), refetchInterval: 15000, retry: false });
  const bound = catalog.data?.workspace;
  const prCall = useRpc(pullRequestRpc);
  const pullRequests = useQuery({
    queryKey: ["devspace-pull-requests", host.id, bound?.id, bound?.branch],
    queryFn: () => prCall({ workspaceId: bound!.id }), enabled: !!bound,
    refetchInterval: 30000, staleTime: 10000, retry: false,
  });
  const snapshot = useQuery({
    queryKey: ["devspace-snapshot", host.id, params.agentId, bound?.id, state.comparison],
    queryFn: () => snapshotCall({ workspaceId: bound!.id, comparison: state.comparison }), enabled: !!bound, refetchInterval: 3000, retry: false,
  });
  const document = useQuery({
    queryKey: ["devspace-review", host.id, bound?.id, state.comparison, snapshot.data?.revision],
    queryFn: () => reviewCall({ workspaceId: bound!.id, comparison: state.comparison }), enabled: !!bound && !!snapshot.data,
    placeholderData: (previous) => previous?.snapshot.workspace.id === bound?.id && previous?.snapshot.comparison === state.comparison ? previous : undefined,
    retry: 1, gcTime: 60000,
  });
  const scope = `${params.agentId}:${bound?.id}:${state.comparison}`;
  const collapsed = useMemo(() => new Set(state.scope === scope ? state.collapsed : []), [state.collapsed, state.scope, scope]);
  const reviewed = useMemo(() => state.scope === scope ? state.reviewed : {}, [state.scope, state.reviewed, scope]);
  const files = useMemo(() => (document.data?.files ?? []).map((file) => overrides[`${scope}:${file.path}`]?.revision === document.data?.snapshot.revision ? overrides[`${scope}:${file.path}`].file : file)
    .filter((file) => file.path.toLowerCase().includes(search.toLowerCase())), [document.data, overrides, search, scope]);
  const wide = size.width >= 560;
  const maxIndexWidth = Math.min(520, Math.max(140, size.width - 280 - DIVIDER_WIDTH));
  const indexWidth = wide ? Math.max(140, Math.min(maxIndexWidth, dragWidth ?? state.indexWidth ?? Math.min(210, Math.max(150, size.width * 0.26)))) : 0;
  const viewportWidth = Math.max(100, size.width - indexWidth - (wide ? DIVIDER_WIDTH : 0));
  const textWidth = Math.max(1, viewportWidth - typography.gutterWidth - 8);
  const layoutKey = `${viewportWidth}:${typography.fontFamily}:${typography.fontSize}`;
  const { heights, report } = useRowMeasurements(layoutKey);
  const model = useMemo(() => reviewRows(files, collapsed, textWidth, heights, typography), [files, collapsed, textWidth, heights, typography]);
  const list = useRef<NativeFlatList<ReviewRow>>(null);
  const viewability = useRef({ itemVisiblePercentThreshold: 10 });
  const onViewable = useRef(({ viewableItems }: { viewableItems: ViewToken<ReviewRow>[] }) => { if (viewableItems[0]?.item) setActivePath(viewableItems[0].item.path); });
  useEffect(() => {
    if (!jump) return;
    const index = model.fileIndices.get(jump);
    if (index === undefined) return;
    list.current?.scrollToIndex({ index, animated: false, viewPosition: 0 });
    setActivePath(jump);
    // Refine the jump as wrapped rows settle, instead of drifting after their first measurement.
    const settled = setTimeout(() => setJump(null), 150);
    return () => clearTimeout(settled);
  }, [jump, model]);
  const mutate = (changes: { collapsed?: string[]; reviewed?: Record<string, string> }) => save({ ...state, comparison: state.comparison, scope, collapsed: [...collapsed], reviewed, ...changes });
  const toggle = (path: string) => { const next = new Set(collapsed); if (!next.delete(path)) next.add(path); mutate({ collapsed: [...next] }); };
  const mark = (file: ReviewFile) => { if (!file.hash) return; const next = { ...reviewed }; if (next[file.path] === file.hash) delete next[file.path]; else next[file.path] = file.hash; mutate({ reviewed: next }); };
  const load = async (path: string) => {
    const file = files.find((f) => f.path === path);
    if (!file?.deferred || !bound || !document.data) return;
    const revision = document.data.snapshot.revision;
    try {
      const result = await fileCall({ workspaceId: bound.id, comparison: state.comparison, path });
      setOverrides((previous) => ({ ...previous, [`${scope}:${path}`]: { revision, file: { ...file, ...result, hash: `${revision}:${path}`, deferred: false } } }));
    } catch { setOverrides((previous) => ({ ...previous, [`${scope}:${path}`]: { revision, file: { ...file, notice: "Unable to read this file. Click to retry.", deferred: true } } })); }
  };
  const navigate = (path: string) => {
    if (collapsed.has(path)) mutate({ collapsed: [...collapsed].filter((p) => p !== path) });
    setJump(path); setIndexOpen(false); void load(path);
  };
  const refresh = () => { void catalog.refetch(); if (bound) { void snapshot.refetch(); void pullRequests.refetch(); if (snapshot.data) void document.refetch(); } };
  const totals = snapshot.data?.files.reduce((sum, file) => ({ plus: sum.plus + (file.additions ?? 0), minus: sum.minus + (file.deletions ?? 0) }), { plus: 0, minus: 0 });
  const error = catalog.error ?? snapshot.error ?? document.error;
  const reviewedCount = files.filter((file) => file.hash && reviewed[file.path] === file.hash).length;
  const selected = files.some((file) => file.path === activePath) ? activePath : files[0]?.path ?? "";
  const header = reviewHeader({ hasWorkspace: !!bound, result: pullRequests.data, pending: pullRequests.isPending, error: !!pullRequests.error });
  const hasPr = header.mode === "pull-request";
  const actions = <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
    {bound ? <>
      <ToolButton icon="Search" label={t("filterFiles")} colors={colors} onPress={() => { setSearchOpen(!searchOpen); setSearch(""); }} active={searchOpen} />
      <ToolButton icon="ListCollapse" label={t(collapsed.size ? "expandAll" : "collapseAll")} colors={colors} onPress={() => mutate({ collapsed: collapsed.size ? [] : files.map((f) => f.path) })} />
      {!wide ? <ToolButton icon="List" label={t("openIndex")} colors={colors} active={indexOpen} onPress={() => setIndexOpen(!indexOpen)} /> : null}
    </> : null}
    <ToolButton icon="RefreshCw" label={t("refresh")} colors={colors} onPress={refresh} />
  </View>;
  const controls = <View style={{ gap: 8 }}>
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      <View style={{ flexDirection: "row", backgroundColor: colors.surface1, borderRadius: 5, padding: 2 }}>
        {(["task", "uncommitted"] as const).map((mode) => <Pressable key={mode} accessibilityRole="button" accessibilityState={{ selected: mode === state.comparison }}
          onPress={() => save({ ...state, comparison: mode, scope: "", collapsed: [], reviewed: {} })} style={{ paddingHorizontal: 8, paddingVertical: 4, borderRadius: 3, backgroundColor: mode === state.comparison ? colors.surface2 : colors.surface1 }}>
          <Text style={{ color: mode === state.comparison ? colors.foreground : colors.foregroundMuted, fontSize: 10 }}>{t(mode === "task" ? "taskChanges" : "uncommitted")}</Text>
        </Pressable>)}
      </View>
      <Text style={{ color: colors.foregroundMuted, fontSize: 10, flex: 1 }}>{snapshot.data ? t("files", { count: snapshot.data.totalFiles }) : ""}{reviewedCount ? t("reviewedCount", { count: reviewedCount }) : ""}</Text>
      {totals ? <><Text style={{ color: colors.statusSuccess, fontSize: 10 }}>+{totals.plus}</Text><Text style={{ color: colors.statusDanger, fontSize: 10 }}>−{totals.minus}</Text></> : null}
      {hasPr ? actions : null}
    </View>
    {searchOpen ? <TextInput value={search} onChangeText={setSearch} autoFocus placeholder={t("filterPlaceholder")} accessibilityLabel={t("filterFiles")} style={{ color: colors.foreground, borderWidth: 1, borderColor: colors.border, borderRadius: 4, padding: 7, fontSize: 12 }} /> : null}
  </View>;
  return <View style={{ flex: 1, minHeight: 0, backgroundColor: colors.surface0 }} testID="devspace-diff-panel">
    {hasPr ? <PullRequestStatus key={`${bound!.id}:${bound!.branch}`} result={pullRequests.data} loading={false} error={null} colors={colors}>{controls}</PullRequestStatus>
      : <View style={{ paddingHorizontal: 12, paddingVertical: 8, gap: 8, borderBottomWidth: 1, borderColor: colors.border }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Icon name={bound ? "GitBranch" : "FileDiff"} size={14} color={colors.foregroundMuted} />
          <Text style={{ color: colors.foreground, fontSize: 12, fontWeight: "600", flex: 1 }} numberOfLines={1}>{bound?.branch ?? t("codeReview")}</Text>
          {actions}
        </View>
        {bound ? controls : null}
      </View>}
    {header.showPrNotice ? <PullRequestStatus result={pullRequests.data} loading={pullRequests.isPending} error={pullRequests.error} colors={colors} /> : null}
    {error ? <Text selectable style={{ color: colors.statusDanger, padding: 12, fontSize: 12 }}>{translateBackend(error.message)}</Text> : null}
    {catalog.isPending || (bound && !document.data && (snapshot.isPending || document.isPending)) ? <ActivityIndicator color={colors.foregroundMuted} style={{ margin: 24 }} /> : null}
    {!catalog.isPending && !bound ? <View style={{ padding: 20, gap: 8 }}><Text style={{ color: colors.foreground, fontSize: 13 }}>{t("noAssociation")}</Text><Text style={{ color: colors.foregroundMuted, fontSize: 12, lineHeight: 20 }}>{catalog.data?.inferenceError ? translateBackend(catalog.data.inferenceError) : t("noAssociationHelp")}</Text></View> : null}
    <View style={{ flex: 1, minHeight: 0, flexDirection: "row" }} onLayout={(event) => setSize({ width: event.nativeEvent.layout.width, height: event.nativeEvent.layout.height })}>
      {document.data && bound ? <>
        <View style={{ flex: 1, minWidth: 0, minHeight: 0 }}>
            <FlatList<ReviewRow> ref={list} data={model.rows} style={{ flex: 1, width: viewportWidth, height: size.height }} keyExtractor={(row) => row.key}
              initialNumToRender={55} maxToRenderPerBatch={55} windowSize={9} stickyHeaderIndices={model.headers}
              getItemLayout={(_, index) => ({ length: model.rows[index]?.height ?? 20, offset: model.offsets[index] ?? 0, index })}
              onViewableItemsChanged={onViewable.current} viewabilityConfig={viewability.current}
              ListEmptyComponent={<Text style={{ color: colors.foregroundMuted, padding: 20, fontSize: 12 }}>{t(search ? "noMatches" : "noChanges")}</Text>}
              renderItem={({ item: row }) => row.kind === "header" ? <FileHeader file={row.file} width={viewportWidth} colors={colors} collapsed={collapsed.has(row.path)} reviewed={!!row.file.hash && reviewed[row.path] === row.file.hash} onToggle={() => toggle(row.path)} onReview={() => mark(row.file)} />
                : row.kind === "code" ? <CodeLine row={row} colors={colors} typography={typography} onHeight={(height) => report(row.key, height, layoutKey)} />
                : row.kind === "gap" ? <View style={{ width: viewportWidth, height: row.height, flexDirection: "row", alignItems: "center", paddingHorizontal: 12, gap: 8, backgroundColor: colors.surface0 }}>
                  <Icon name="ChevronsUpDown" size={11} color={colors.foregroundMuted} />
                  <Text style={{ fontSize: 10, color: colors.foregroundMuted }}>{row.omitted ? t("unchangedLines", { count: row.omitted }) : t("context")}</Text>
                  <Text style={{ flex: 1, minWidth: 0, color: colors.foregroundMuted, fontSize: 10 }} numberOfLines={1}>{row.label}</Text>
                </View>
                : <Pressable accessibilityRole={row.deferred ? "button" : undefined} accessibilityLabel={row.deferred ? t("loadFileLabel", { path: row.path }) : undefined} onPress={() => { if (row.deferred) void load(row.path); }} style={{ width: viewportWidth, height: row.height, paddingHorizontal: 12, justifyContent: "center" }}>
                  <Text style={{ color: row.deferred ? colors.accent : colors.foregroundMuted, fontSize: 11 }} numberOfLines={2}>{translateBackend(row.text)}</Text>
                </Pressable>}
            />
        </View>
        {wide ? <>
          <ResizeDivider width={indexWidth} min={140} max={maxIndexWidth} colors={colors} onResize={setDragWidth}
            onCommit={(width) => { save({ ...latestState.current, indexWidth: width }); setDragWidth(null); }} />
          <View style={{ width: indexWidth, flexShrink: 0 }}><FileIndex files={files} activePath={selected} reviewed={reviewed} colors={colors} onJump={navigate} /></View>
        </>
          : indexOpen ? <View style={{ position: "absolute", top: 0, bottom: 0, left: 0, right: 0, backgroundColor: colors.surface0 }}>
            <View style={{ paddingHorizontal: 12, flexDirection: "row", alignItems: "center", justifyContent: "space-between", height: 36, borderBottomWidth: 1, borderColor: colors.border }}><Text style={{ color: colors.foreground, fontSize: 12 }}>{t("changedFiles")}</Text><ToolButton icon="X" label={t("closeIndex")} colors={colors} onPress={() => setIndexOpen(false)} /></View>
            <FileIndex files={files} activePath={selected} reviewed={reviewed} colors={colors} onJump={navigate} />
          </View> : null}
      </> : null}
    </View>
  </View>;
}
