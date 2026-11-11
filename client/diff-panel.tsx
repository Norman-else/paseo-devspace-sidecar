import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Animated, Pressable, Text, View, type FlatList as NativeFlatList } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useRpc, useTabState, type PluginAgentPanelProps } from "@getpaseo/plugin/client";
import { FlatList, Icon, useToast } from "@getpaseo/plugin/client/ui";
import { z } from "zod";
import { catalogRpc, comparison as comparisonSchema, contextRpc, checkpointRpc, threadsRpc, fileRpc, pullRequestRpc, reviewRpc, snapshotRpc, type ReviewFile, type Snapshot } from "../shared/diff";
import { checkpointSchema, type ReviewThread } from "../shared/review-details";
import { HEADER_HEIGHT, reviewRows, type ReviewRow, type ReviewExtras } from "../shared/review";
import { selectedCode, selectLine, type LineSelection } from "../shared/selection";
import { CodeLine, FileHeader, FileIndex, ToolButton } from "./review-ui";
import { DIVIDER_WIDTH, ResizeDivider } from "./resize-divider";
import { useRowMeasurements } from "./use-row-measurements";
import { useMessages } from "./messages";
import { useCodeAppearance } from "./use-code-appearance";
import { PullRequestStatus } from "./pull-request-status";
import { reviewHeader } from "../shared/review-header";
import { ReviewToolbar } from "./review-toolbar";
import { useStickyFileHeader } from "./use-sticky-file-header";
import { Discussions, InlineDiscussion } from "./review-discussions";
import { ReviewChecks } from "./review-checks";
import { FeedbackComposer, type FeedbackDraft } from "./feedback-composer";
import { ReviewOptions } from "./review-options";
import { watchCodeSelection } from "./web";
import { ReviewTabs } from "./review-tabs";
import { fileDiscussions, nextDiscussion } from "../shared/comment-navigation";

const stateSchema = z.object({ comparison: comparisonSchema, scope: z.string().default(""), collapsed: z.array(z.string()).default([]), reviewed: z.record(z.string(), z.string()).default({}), indexWidth: z.number().min(140).max(520).nullable().default(null), prNumber: z.number().int().optional(), filter: z.enum(["all", "unreviewed", "since"]).default("all"), points: z.record(z.string(), checkpointSchema).default({}), view: z.enum(["changes", "comments"]).default("changes") });
type Jump = { path: string; key?: string };
export function DiffPanel({ theme, host, params, tab }: PluginAgentPanelProps) {
  const { t, translateBackend } = useMessages(), toast = useToast();
  const typography = useCodeAppearance();
  const [state, save] = useTabState(tab, stateSchema, { comparison: "task" as const, scope: "", collapsed: [] as string[], reviewed: {} as Record<string, string>, indexWidth: null as number | null, filter: "all" as const, points: {}, view: "changes" as const });
  const latestState = useRef(state); latestState.current = state;
  const [dragWidth, setDragWidth] = useState<number | null>(null), [size, setSize] = useState({ width: 700, height: 700 });
  const [search, setSearch] = useState(""), [searchOpen, setSearchOpen] = useState(false), [searchType, setSearchType] = useState<"files" | "code">("files");
  const [indexOpen, setIndexOpen] = useState(false), [optionsOpen, setOptionsOpen] = useState(false), [activePath, setActivePath] = useState("");
  const [jump, setJump] = useState<Jump | null>(null), [selection, setSelection] = useState<LineSelection | null>(null), [draft, setDraft] = useState<FeedbackDraft | null>(null);
  const [detail, setDetail] = useState<"checks" | null>(null), [showResolved, setShowResolved] = useState(false);
  const [saving, setSaving] = useState(false), [loadingContext, setLoadingContext] = useState("");
  const [overrides, setOverrides] = useState<Record<string, ReviewFile>>({});
  const [extra, setExtra] = useState<{ version: string; contexts: NonNullable<ReviewExtras["contexts"]> }>({ version: "", contexts: {} });
  const [anchors, setAnchors] = useState<{ version: string; values: NonNullable<ReviewExtras["anchors"]> }>({ version: "", values: {} });
  const [openedThreads, setOpenedThreads] = useState<{ version: string; ids: string[] }>({ version: "", ids: [] });
  const [currentThreadId, setCurrentThreadId] = useState<string | null>(null);
  const savedScroll = useRef(0);
  const restoreScroll = useRef(false);
  const colors = theme.colors;
  const catalogCall = useRpc(catalogRpc), snapshotCall = useRpc(snapshotRpc), reviewCall = useRpc(reviewRpc), fileCall = useRpc(fileRpc), prCall = useRpc(pullRequestRpc), threadsCall = useRpc(threadsRpc), contextCall = useRpc(contextRpc), checkpointCall = useRpc(checkpointRpc);
  const catalog = useQuery({ queryKey: ["devspace-context-v2", host.id, params.agentId], queryFn: () => catalogCall({ agentId: params.agentId }), refetchInterval: 15000, retry: false });
  const bound = catalog.data?.workspace;
  const pullRequests = useQuery({ queryKey: ["devspace-pull-requests", host.id, bound?.id, bound?.branch], queryFn: () => prCall({ workspaceId: bound!.id }), enabled: !!bound, refetchInterval: 30000, staleTime: 10000, retry: false });
  const result = pullRequests.data?.status === "available" ? pullRequests.data : null;
  const pr = result?.pullRequests.find((pr) => pr.number === state.prNumber) ?? result?.pullRequests[0];
  const view = pr ? state.view : "changes";
  const comparison: Snapshot["comparison"] = pr ? state.comparison === "local" ? "local" : "pr" : state.comparison === "uncommitted" ? "uncommitted" : "task";
  const scope = `${params.agentId}:${bound?.id}:${comparison}:${pr?.number ?? ""}`;
  const point = state.points[scope], since = state.filter === "since" ? point?.id : undefined;
  const request = { comparison, prNumber: pr?.number, since };
  const snapshot = useQuery({ queryKey: ["devspace-snapshot-v3", host.id, bound?.id, comparison, pr?.number, since], queryFn: () => snapshotCall({ workspaceId: bound!.id, ...request }), enabled: !!bound, refetchInterval: 3000, retry: false });
  const document = useQuery({ queryKey: ["devspace-review-v3", host.id, bound?.id, comparison, pr?.number, since, snapshot.data?.revision], queryFn: () => reviewCall({ workspaceId: bound!.id, ...request }), enabled: !!bound && !!snapshot.data, placeholderData: (previous) => previous && previous.snapshot.workspace.id === bound?.id && previous.snapshot.comparison === comparison && previous.snapshot.checkpoint?.id === since && previous.snapshot.prNumber === pr?.number ? previous : undefined, retry: 1, gcTime: 60000 });
  const local = useQuery({ queryKey: ["devspace-local-v3", host.id, bound?.id, pr?.number, pr?.headSha], queryFn: () => snapshotCall({ workspaceId: bound!.id, comparison: "local", prNumber: pr!.number }), enabled: !!bound && !!pr, refetchInterval: 10000, retry: false });
  const discussions = useQuery({ queryKey: ["devspace-discussions", host.id, bound?.id, pr?.number, pr?.headSha], queryFn: () => threadsCall({ workspaceId: bound!.id, prNumber: pr!.number }), enabled: !!bound && !!pr, refetchInterval: 30000, retry: false });
  useEffect(() => { if (pr && document.data?.snapshot.headSha && document.data.snapshot.headSha !== pr.headSha) void pullRequests.refetch(); }, [document.data?.snapshot.headSha, pr?.headSha]);
  const version = `${scope}:${since ?? ""}:${document.data?.snapshot.revision ?? ""}`;
  const collapsed = useMemo(() => new Set(state.scope === scope ? state.collapsed : []), [state.collapsed, state.scope, scope]);
  const reviewed = useMemo(() => state.scope === scope ? state.reviewed : {}, [state.scope, state.reviewed, scope]);
  const allFiles = useMemo(() => (document.data?.files ?? []).map((file) => overrides[`${version}:${file.path}`] ?? file), [document.data, overrides, version]);
  const files = useMemo(() => allFiles.filter((file) => (!search || searchType !== "files" || file.path.toLowerCase().includes(search.toLowerCase())) && (state.filter !== "unreviewed" || !file.hash || reviewed[file.path] !== file.hash)), [allFiles, search, searchType, state.filter, reviewed]);
  const wide = size.width >= 560;
  const maxIndexWidth = Math.min(520, Math.max(140, size.width - 280 - DIVIDER_WIDTH));
  const indexWidth = wide ? Math.max(140, Math.min(maxIndexWidth, dragWidth ?? state.indexWidth ?? Math.min(210, Math.max(150, size.width * 0.26)))) : 0;
  const viewportWidth = Math.max(100, size.width - indexWidth - (wide ? DIVIDER_WIDTH : 0));
  const layoutKey = `${viewportWidth}:${typography.fontFamily}:${typography.fontSize}:${version}`;
  const { heights, report } = useRowMeasurements(layoutKey);
  const inlineAvailable = comparison === "pr" && !since && !!discussions.data && !!document.data?.snapshot.headSha && discussions.data.headSha === document.data.snapshot.headSha;
  const currentThreads = useMemo(() => discussions.data?.threads.filter((thread) => !thread.outdated) ?? [], [discussions.data]);
  const inlineThreads = useMemo(() => inlineAvailable ? currentThreads : [], [inlineAvailable, currentThreads]);
  const expandedThreads = useMemo(() => new Set(openedThreads.version === version ? openedThreads.ids : []), [openedThreads, version]);
  const model = useMemo(() => reviewRows(files, searchType === "code" && search ? new Set() : collapsed, Math.max(1, viewportWidth - typography.gutterWidth - 8), heights, typography, { contexts: extra.version === version ? extra.contexts : {}, threads: inlineThreads, expandedThreads, anchors: anchors.version === version ? anchors.values : {} }), [expandedThreads, anchors, files, collapsed, viewportWidth, heights, typography, extra, version, inlineThreads, searchType, search]);
  const list = useRef<NativeFlatList<ReviewRow>>(null), sticky = useStickyFileHeader(model, setActivePath);
  useEffect(() => { setSelection(null); }, [version, search, state.filter]);
  useEffect(() => watchCodeSelection(version, (value) => { setSelection(value); setDetail(null); }), [version]);
  useEffect(() => {
    if (!jump || view !== "changes") return;
    const index = jump.key ? model.rows.findIndex((row) => row.key === jump.key) : model.fileIndices.get(jump.path) ?? -1;
    if (index < 0) return;
    list.current?.scrollToIndex({ index, animated: false, viewPosition: 0, viewOffset: jump.key ? HEADER_HEIGHT : 0 });
    setActivePath(jump.path);
    const settled = setTimeout(() => setJump(null), 150);
    return () => clearTimeout(settled);
  }, [jump, model, view, size.height]);
  const mutate = (changes: { collapsed?: string[]; reviewed?: Record<string, string> }) => save({ ...state, comparison, scope, collapsed: [...collapsed], reviewed, ...changes });
  const toggle = (path: string) => { if (selection?.path === path) setSelection(null); const next = new Set(collapsed); if (!next.delete(path)) next.add(path); mutate({ collapsed: [...next] }); };
  const mark = (file: ReviewFile) => { if (selection?.path === file.path) setSelection(null); if (!file.hash) return; const next = { ...reviewed }; if (next[file.path] === file.hash) delete next[file.path]; else next[file.path] = file.hash; mutate({ reviewed: next }); };
  const load = async (path: string) => {
    const file = files.find((f) => f.path === path);
    if (!file?.deferred || !bound || !document.data) return;
    try { const data = await fileCall({ workspaceId: bound.id, ...request, path }); setOverrides((previous) => ({ ...previous, [`${version}:${path}`]: { ...file, ...data, hash: `${document.data.snapshot.revision}:${path}`, deferred: false } })); }
    catch (error) { toast.error(translateBackend(error instanceof Error ? error.message : t("fileReadFailed"))); }
  };
  const navigate = (path: string, key?: string) => { if (collapsed.has(path)) mutate({ collapsed: [...collapsed].filter((p) => p !== path) }); setJump({ path, key }); setIndexOpen(false); void load(path); };
  const refresh = () => { void catalog.refetch(); if (bound) { void snapshot.refetch(); void pullRequests.refetch(); if (snapshot.data) void document.refetch(); if (pr) { void discussions.refetch(); void local.refetch(); } } };
  const totals = snapshot.data?.files.reduce((sum, file) => ({ plus: sum.plus + (file.additions ?? 0), minus: sum.minus + (file.deletions ?? 0) }), { plus: 0, minus: 0 });
  const error = catalog.error ?? snapshot.error ?? document.error;
  const reviewedCount = allFiles.filter((file) => file.hash && reviewed[file.path] === file.hash).length;
  const selected = files.some((file) => file.path === activePath) ? activePath : files[0]?.path ?? "";
  const selectedIndex = Math.max(0, files.findIndex((file) => file.path === selected));
  const matches = useMemo(() => searchType === "code" && search.trim() ? model.rows.flatMap((row, index) => row.kind === "code" && row.line.text.toLowerCase().includes(search.toLowerCase()) ? [index] : []) : [], [model, search, searchType]);
  const [matchIndex, setMatchIndex] = useState(-1);
  const matchIndexRef = useRef(-1);
  useEffect(() => { setMatchIndex(-1); matchIndexRef.current = -1; }, [search, version]);
  const match = (direction: number) => { if (!matches.length) return; const next = matchIndexRef.current < 0 ? direction > 0 ? 0 : matches.length - 1 : (matchIndexRef.current + direction + matches.length) % matches.length; setMatchIndex(next); matchIndexRef.current = next; const row = model.rows[matches[next]]; navigate(row.path, row.key); };
  const change = (direction: number) => {
    const indices = model.rows.flatMap((row, index, rows) => row.kind === "code" && (row.line.kind === "add" || row.line.kind === "remove") && !(rows[index - 1]?.kind === "code" && ["add", "remove"].includes((rows[index - 1] as Extract<ReviewRow, { kind: "code" }>).line.kind)) ? [index] : []);
    const start = sticky.scrollOffset() + HEADER_HEIGHT + 0.5;
    const next = direction > 0 ? indices.find((index) => model.offsets[index] > start) ?? indices[0] : [...indices].reverse().find((index) => model.offsets[index] < start - 1) ?? indices.at(-1);
    if (next !== undefined) navigate(model.rows[next].path, model.rows[next].key);
  };
  const expandContext = async (row: Extract<ReviewRow, { kind: "gap" }>) => {
    if (!bound || !document.data || loadingContext || row.omitted === 0) return;
    const existing = extra.version === version ? extra.contexts[row.key]?.lines ?? [] : [];
    setLoadingContext(row.key);
    try {
      const chunk = await contextCall({ workspaceId: bound.id, ...request, path: row.path, side: row.side, start: (row.side === "old" ? row.oldStart : row.newStart) + existing.length, count: row.omitted > 0 ? Math.min(20, row.omitted) : 20, revision: document.data.snapshot.revision });
      setExtra((previous) => ({ version, contexts: { ...(previous.version === version ? previous.contexts : {}), [row.key]: { lines: [...existing, ...chunk.lines], total: chunk.total } } }));
    } catch (error) { toast.error(translateBackend(error instanceof Error ? error.message : t("contextFailed"))); }
    finally { setLoadingContext(""); }
  };
  const savePoint = async () => {
    if (!bound || saving) return; setSaving(true);
    try { const value = await checkpointCall({ workspaceId: bound.id, comparison, prNumber: pr?.number, agentId: params.agentId }); save({ ...latestState.current, points: { ...latestState.current.points, [scope]: value }, filter: "all" }); toast.show(t("pointSaved") + (value.omitted ? ` · ${t("pointOmitted", { count: value.omitted })}` : "")); setOptionsOpen(false); }
    catch (error) { toast.error(translateBackend(error instanceof Error ? error.message : t("contextFailed"))); } finally { setSaving(false); }
  };
  const source = `${t(({ task: "taskChanges", uncommitted: "uncommitted", pr: "prChanges", local: "localChanges" } as const)[comparison])}${pr ? ` · PR #${pr.number}` : ""}`;
  const codeFeedback = (kind: "explain" | "change") => {
    if (!selection) return;
    const from = Math.min(selection.start, selection.end), to = Math.max(selection.start, selection.end);
    const snapshot = document.data?.snapshot;
    const selectedVersion = selection.side === "old" && snapshot?.checkpoint ? t("reviewPointAt", { time: new Date(snapshot.checkpoint.createdAt).toLocaleString() }) : selection.side === "new" && comparison !== "pr" ? t("workingVersion") : selection.side === "old" ? snapshot?.ref : snapshot?.headSha;
    const title = t("selectionRange", { path: selection.path, side: t(selection.side === "old" ? "versionOld" : "versionNew"), from, to });
    setDraft({ title, instruction: t(kind === "explain" ? "explainInstruction" : "changeInstruction"), context: `${title}\n${source}\n${selectedVersion ?? ""}\n${snapshot?.capturedAt ?? ""}\n\n\`\`\`\n${selectedCode(model.rows, selection)}\n\`\`\`\n${t("selectionLimit")}` });
  };
  const threadFeedback = (thread: ReviewThread) => setDraft({ title: `${thread.path}${thread.line ? ":" + thread.line : ""}`, instruction: t("changeInstruction"), context: `PR #${pr?.number} · ${discussions.data?.headSha ?? ""}\n${thread.path}:${thread.startLine ?? thread.line ?? ""}–${thread.line ?? ""} (${thread.side})${thread.outdated ? " · " + t("outdated") : ""}\n\n${thread.comments.map((comment) => `${comment.author}: ${comment.body}\n${comment.url}`).join("\n\n")}` });
  const [pendingThread, setPendingThread] = useState<ReviewThread | null>(null);
  const threadLoading = useRef("");
  const currentVersion = useRef(version); currentVersion.current = version;
  useEffect(() => {
    if (!pendingThread || view !== "changes" || comparison !== "pr" || since || !document.data) return;
    if (discussions.data?.headSha !== document.data.snapshot.headSha) { void discussions.refetch(); setPendingThread(null); toast.show(t("prMoved")); return; }
    const targetFile = files.find((file) => file.path === pendingThread.path || pendingThread.side === "LEFT" && file.oldPath === pendingThread.path);
    if (!targetFile) { setPendingThread(null); toast.error(t("contextFailed")); return; }
    const row = model.rows.find((row) => row.kind === "thread" && row.thread.id === pendingThread.id) ?? model.rows.find((row) => row.kind === "code" && row.path === targetFile.path && (pendingThread.side === "LEFT" ? row.line.old : row.line.next) === pendingThread.line);
    if (row) { setOpenedThreads((previous) => ({ version, ids: [...new Set([...(previous.version === version ? previous.ids : []), pendingThread.id])] })); setJump({ path: row.path, key: row.key }); setPendingThread(null); return; }
    if (pendingThread.line === null) { setJump({ path: targetFile.path }); setPendingThread(null); return; }
    const key = `${version}:${pendingThread.id}`;
    if (!bound || pendingThread.line === null || threadLoading.current === key) return;
    threadLoading.current = key;
    void contextCall({ workspaceId: bound.id, ...request, path: targetFile.path, side: pendingThread.side === "LEFT" ? "old" : "new", start: Math.max(1, pendingThread.line - 10), count: 21, revision: document.data.snapshot.revision }).then((chunk) => {
      if (currentVersion.current !== version) return;
      setAnchors((previous) => ({ version, values: { ...(previous.version === version ? previous.values : {}), [pendingThread.id]: { path: targetFile.path, side: pendingThread.side === "LEFT" ? "old" : "new", start: chunk.start, lines: chunk.lines } } }));
      if (!chunk.lines.length) { setPendingThread(null); toast.error(t("contextFailed")); }
    }).catch((error) => { if (currentVersion.current === version) { setPendingThread(null); toast.error(translateBackend(error instanceof Error ? error.message : t("contextFailed"))); } });
  }, [pendingThread, view, comparison, since, document.data, model, version, bound, contextCall]);
  const jumpThread = (thread: ReviewThread) => { if (thread.outdated) return; restoreScroll.current = false; const targetPath = allFiles.find((file) => fileDiscussions(file, [thread]).length)?.path ?? thread.path; save({ ...state, view: "changes", comparison: "pr", filter: "all", ...(comparison === "pr" && !since ? { collapsed: [...collapsed].filter((path) => path !== targetPath) } : { scope: "", collapsed: [], reviewed: {} }) }); setSearch(""); setDetail(null); setCurrentThreadId(thread.id); setPendingThread(thread); };
  const changeView = (next: "changes" | "comments") => { if (next === view) return; if (next === "comments") { savedScroll.current = sticky.scrollOffset(); setJump(null); setPendingThread(null); } else restoreScroll.current = true; save({ ...state, view: next }); setSelection(null); setDetail(null); };
  useEffect(() => { if (view !== "changes" || pendingThread || jump || !restoreScroll.current) return; const frame = requestAnimationFrame(() => { restoreScroll.current = false; list.current?.scrollToOffset({ offset: savedScroll.current, animated: false }); }); return () => cancelAnimationFrame(frame); }, [view]);
  const toggleThread = (id: string) => { setCurrentThreadId(id); setOpenedThreads((previous) => { const ids = new Set(previous.version === version ? previous.ids : []); if (!ids.delete(id)) ids.add(id); return { version, ids: [...ids] }; }); };
  const commentProps = (file: ReviewFile) => { const threads = fileDiscussions(file, inlineThreads); return { commentCount: threads.length, onComments: () => { const first = threads.find((thread) => !thread.resolved) ?? threads[0]; if (first) jumpThread(first); } }; };
  const header = reviewHeader({ hasWorkspace: !!bound, result: pullRequests.data, pending: pullRequests.isPending, error: !!pullRequests.error });
  const collapseAction = <ToolButton icon="ListCollapse" label={t(collapsed.size ? "expandAll" : "collapseAll")} colors={colors} touch={!wide} onPress={() => mutate({ collapsed: collapsed.size ? [] : files.map((f) => f.path) })} />;
  const refreshAction = <ToolButton icon="RefreshCw" label={t("refresh")} colors={colors} touch={!wide} onPress={refresh} />;
  const actions = <View style={{ flexDirection: "row", alignItems: "center", gap: 2 }}>{bound ? <><ToolButton icon="Search" label={t("filterFiles")} colors={colors} touch={!wide} onPress={() => { setSearchOpen(!searchOpen); if (searchOpen) setSearch(""); setDetail(null); }} active={searchOpen} />{wide ? collapseAction : <ToolButton icon="List" label={t("openIndex")} colors={colors} touch active={indexOpen} onPress={() => setIndexOpen(!indexOpen)} />}</> : null}{wide || !bound ? refreshAction : null}</View>;
  const optionAction = <ToolButton touch={!wide} icon="SlidersHorizontal" label={t("reviewOptions")} active={state.filter !== "all"} colors={colors} onPress={() => setOptionsOpen(true)} />;
  return <View style={{ flex: 1, minHeight: 0, backgroundColor: colors.surface0 }} testID="devspace-diff-panel" onLayout={(event) => { const width = event.nativeEvent.layout.width; if (width > 0) setSize((previous) => previous.width === width ? previous : { ...previous, width }); }}>
    {pr && header.mode === "pull-request" ? <PullRequestStatus result={pullRequests.data} loading={false} error={null} colors={colors} compact={!wide} selectedNumber={pr.number} onSelect={(prNumber) => { save({ ...state, prNumber, filter: "all", scope: "", reviewed: {}, collapsed: [] }); setDetail(null); }} onChecks={() => { changeView("changes"); setDetail(detail === "checks" ? null : "checks"); setSearchOpen(false); setSearch(""); }} expandedDetail={detail} />
      : <View style={{ paddingHorizontal: 12, paddingVertical: 8, flexDirection: "row", alignItems: "center", gap: 8 }}><Icon name={bound ? "GitBranch" : "FileDiff"} size={14} color={colors.foregroundMuted} /><Text style={{ color: colors.foreground, fontSize: 12, fontWeight: "600", flex: 1 }} numberOfLines={1}>{bound?.branch ?? t("codeReview")}</Text>{!bound ? actions : null}</View>}
    {header.showPrNotice ? <PullRequestStatus result={pullRequests.data} loading={pullRequests.isPending} error={pullRequests.error} colors={colors} compact={!wide} /> : null}
    {pr ? <ReviewTabs view={view} count={discussions.data?.threads.length} compact={!wide} colors={colors} onChange={changeView} canNavigate={currentThreads.length > 0} onNavigate={(direction) => { const thread = nextDiscussion(currentThreads, currentThreadId, direction); if (thread) jumpThread(thread); }} /> : null}
    {pr && bound && view === "comments" ? <View style={{ flex: 1, minHeight: 0 }}>
      {discussions.isPending ? <ActivityIndicator color={colors.foregroundMuted} style={{ margin: 20 }} /> : discussions.error ? <Pressable accessibilityRole="button" onPress={() => void discussions.refetch()} style={{ padding: 16 }}><Text style={{ color: colors.statusDanger, fontSize: 13 }}>{t("prUnavailable")} · {t("retry")}</Text></Pressable> : <Discussions threads={discussions.data?.threads ?? []} resolved={showResolved} onResolved={setShowResolved} onJump={jumpThread} onFeedback={threadFeedback} colors={colors} inlineAvailable={!!inlineAvailable} truncated={!!discussions.data?.truncated} />}
    </View> : null}
    {pr && bound && view === "changes" && detail === "checks" ? <View><View style={{ flexDirection: "row", alignItems: "center", paddingLeft: 12 }}><Text style={{ flex: 1, color: colors.foreground, fontSize: 12, fontWeight: "500" }}>{t("checks")}</Text><ToolButton touch={!wide} icon="X" label={t("closeDetails")} colors={colors} onPress={() => setDetail(null)} /></View><ReviewChecks workspaceId={bound.id} number={pr.number} headSha={pr.headSha} checks={pr.checks} colors={colors} onFeedback={(check) => setDraft({ title: check.name, instruction: t("changeInstruction"), context: `PR #${pr.number} · ${check.headSha ?? pr.headSha}\n${check.name}\n${check.url ?? ""}\n\n${check.summary}\n\n${check.excerpt}` })} /></View> : null}
    {bound && view === "changes" ? <ReviewToolbar mode={comparison} modes={pr ? ["pr", "local"] : ["task", "uncommitted"]} fileCount={snapshot.data?.totalFiles} reviewedCount={reviewedCount} totals={totals} compact={!wide}
      secondaryActions={!wide ? <View style={{ flexDirection: "row", gap: 2 }}>{optionAction}{refreshAction}</View> : undefined} searchOpen={searchOpen} search={search} colors={colors} onSearchChange={setSearch} searchType={searchType} onSearchType={(type) => { setSearchType(type); setSearch(""); }} matchCount={matches.length} matchIndex={matchIndex} onMatch={match}
      onModeChange={(comparison) => { save({ ...state, comparison, filter: "all", scope: "", collapsed: [], reviewed: {} }); setSearch(""); }}>{actions}{wide ? optionAction : null}</ReviewToolbar> : null}
    {view === "changes" && pr && local.data && local.data.totalFiles > 0 && local.data.ref === document.data?.snapshot.headSha && comparison === "pr" && !since ? <Pressable accessibilityRole="button" onPress={() => save({ ...state, comparison: "local", filter: "all", scope: "", collapsed: [], reviewed: {} })} style={{ paddingHorizontal: 12, paddingVertical: 7, borderBottomWidth: 1, borderColor: colors.border }}><Text style={{ color: colors.statusWarning, fontSize: 11 }}>{t("localPending", { count: local.data.totalFiles })}</Text></Pressable> : null}
    {view === "changes" && pr && local.error && comparison === "pr" && !since ? <Text style={{ color: colors.foregroundMuted, paddingHorizontal: 12, paddingVertical: 6, fontSize: 11 }}>{t("localUnavailable")}</Text> : null}
    {view === "changes" && state.filter !== "all" && bound ? <Pressable accessibilityRole="button" onPress={() => setOptionsOpen(true)} style={{ paddingHorizontal: 12, paddingVertical: 6 }}><Text style={{ color: colors.foregroundMuted, fontSize: 11 }}>{since && point ? t("reviewPointAt", { time: new Date(point.createdAt).toLocaleString() }) : t("unreviewedFiles")}</Text></Pressable> : null}
    {view === "changes" && error ? <Text selectable style={{ color: colors.statusDanger, padding: 12, fontSize: 12 }}>{translateBackend(error.message)}</Text> : null}
    {view === "changes" && (catalog.isPending || (bound && !document.data && (snapshot.isPending || document.isPending))) ? <ActivityIndicator color={colors.foregroundMuted} style={{ margin: 20 }} /> : null}
    {!catalog.isPending && !bound ? <View style={{ padding: 20, gap: 8 }}><Text style={{ color: colors.foreground, fontSize: 13 }}>{t("noAssociation")}</Text><Text style={{ color: colors.foregroundMuted, fontSize: 12, lineHeight: 20 }}>{catalog.data?.inferenceError ? translateBackend(catalog.data.inferenceError) : t("noAssociationHelp")}</Text></View> : null}
    <View style={{ flex: 1, minHeight: 0, flexDirection: "row", display: view === "changes" ? "flex" : "none" }} onLayout={(event) => {
      // Native synthetic events can be recycled before React runs this updater.
      const height = event.nativeEvent.layout.height;
      if (view === "changes" && height > 0) setSize((previous) => previous.height === height ? previous : { ...previous, height });
    }}>
      {document.data && bound ? <>
        <View style={{ flex: 1, minWidth: 0, minHeight: 0, overflow: "hidden" }}>
          <FlatList<ReviewRow> ref={list} data={model.rows} style={{ flex: 1, width: viewportWidth, height: size.height }} keyExtractor={(row) => row.key} initialNumToRender={55} maxToRenderPerBatch={55} windowSize={9}
            getItemLayout={(_, index) => ({ length: model.rows[index]?.height ?? 20, offset: model.offsets[index] ?? 0, index })} onScroll={(event) => { if (view === "changes") sticky.onScroll(event); }} scrollEventThrottle={16}
            ListEmptyComponent={<Text style={{ color: colors.foregroundMuted, padding: 20, fontSize: 12 }}>{t(search ? "noMatches" : since ? "emptyCheckpoint" : "noChanges")}</Text>}
            renderItem={({ item: row }) => row.kind === "header" ? <FileHeader {...commentProps(row.file)} file={row.file} width={viewportWidth} colors={colors} collapsed={collapsed.has(row.path)} reviewed={!!row.file.hash && reviewed[row.path] === row.file.hash} onToggle={() => toggle(row.path)} onReview={() => mark(row.file)} />
              : row.kind === "code" ? <CodeLine row={row} colors={colors} typography={typography} selectionScope={version} selection={selection} match={searchType === "code" && !!search && row.line.text.toLowerCase().includes(search.toLowerCase())} onSelect={(side, line) => { setDetail(null); if (!selection) toast.show(t("selectionHint")); setSelection((previous) => selectLine(previous, row.path, side, line)); }} onHeight={(height) => report(row.key, height, layoutKey)} />
              : row.kind === "thread" ? <InlineDiscussion thread={row.thread} expanded={expandedThreads.has(row.thread.id)} onToggle={() => toggleThread(row.thread.id)} colors={colors} onFeedback={threadFeedback} onHeight={(height) => report(row.key, height, layoutKey)} />
              : row.kind === "gap" ? <Pressable accessibilityRole={row.omitted !== 0 ? "button" : undefined} disabled={row.omitted === 0 || !!loadingContext} onPress={() => void expandContext(row)} style={{ width: viewportWidth, minHeight: row.height, flexDirection: "row", alignItems: "center", paddingHorizontal: 12, gap: 8, backgroundColor: colors.surface0 }}><Icon name="ChevronsUpDown" size={11} color={colors.foregroundMuted} /><Text style={{ fontSize: 11, color: row.omitted !== 0 ? colors.accent : colors.foregroundMuted }}>{loadingContext === row.key ? t("contextLoading") : row.omitted < 0 ? t("followingContext") : row.omitted ? t("showContext", { count: Math.min(20, row.omitted) }) : t("context")}</Text><Text style={{ flex: 1, minWidth: 0, color: colors.foregroundMuted, fontSize: 10 }} numberOfLines={1}>{row.label === "__discussion__" ? t("discussionContext") : row.label}</Text></Pressable>
              : <Pressable accessibilityRole={row.deferred ? "button" : undefined} onPress={() => { if (row.deferred) void load(row.path); }} style={{ width: viewportWidth, minHeight: row.height, paddingHorizontal: 12, justifyContent: "center" }}><Text style={{ color: row.deferred ? colors.accent : colors.foregroundMuted, fontSize: 11 }}>{translateBackend(row.text)}</Text></Pressable>}
          />
          {sticky.file ? <Animated.View style={{ position: "absolute", top: 0, left: 0, right: 0, zIndex: 1, transform: [{ translateY: sticky.translateY }] }} testID="devspace-sticky-file-header"><FileHeader {...commentProps(sticky.file)} file={sticky.file} width={viewportWidth} colors={colors} collapsed={collapsed.has(sticky.file.path)} reviewed={!!sticky.file.hash && reviewed[sticky.file.path] === sticky.file.hash} onToggle={() => toggle(sticky.file!.path)} onReview={() => mark(sticky.file!)} /></Animated.View> : null}
        </View>
        {wide ? <><ResizeDivider width={indexWidth} min={140} max={maxIndexWidth} colors={colors} onResize={setDragWidth} onCommit={(width) => { save({ ...latestState.current, indexWidth: width }); setDragWidth(null); }} /><View style={{ width: indexWidth, flexShrink: 0 }}><FileIndex files={files} activePath={selected} reviewed={reviewed} colors={colors} onJump={navigate} /></View></>
          : indexOpen ? <View style={{ position: "absolute", top: 0, bottom: 0, left: 0, right: 0, backgroundColor: colors.surface0 }}><View style={{ paddingLeft: 12, flexDirection: "row", alignItems: "center", borderBottomWidth: 1, borderColor: colors.border }}><Text style={{ flex: 1, color: colors.foreground, fontSize: 12 }}>{t("changedFiles")}</Text><ToolButton touch icon="X" label={t("closeIndex")} colors={colors} onPress={() => setIndexOpen(false)} /></View><FileIndex files={files} activePath={selected} reviewed={reviewed} colors={colors} onJump={navigate} /></View> : null}
      </> : null}
    </View>
    {view === "changes" && bound && files.length ? <View style={{ paddingHorizontal: 8, minHeight: wide ? 36 : 44, borderTopWidth: 1, borderColor: colors.border, flexDirection: "row", alignItems: "center", gap: 2 }}><Text numberOfLines={1} style={{ flex: 1, minWidth: 0, color: colors.foregroundMuted, fontSize: 11 }}>{selected.split("/").at(-1)} · {selectedIndex + 1}/{files.length}</Text><ToolButton touch={!wide} icon="ChevronLeft" label={t("previousFile")} colors={colors} onPress={() => navigate(files[(selectedIndex - 1 + files.length) % files.length].path)} /><ToolButton touch={!wide} icon="ChevronRight" label={t("nextFile")} colors={colors} onPress={() => navigate(files[(selectedIndex + 1) % files.length].path)} /><View style={{ width: 1, height: 16, backgroundColor: colors.border, marginHorizontal: 4 }} /><ToolButton touch={!wide} icon="ChevronUp" label={t("previousChange")} colors={colors} onPress={() => change(-1)} /><ToolButton touch={!wide} icon="ChevronDown" label={t("nextChange")} colors={colors} onPress={() => change(1)} /></View> : null}
    {view === "changes" && selection ? <View style={{ paddingHorizontal: 12, paddingVertical: 6, gap: 4, borderTopWidth: 1, borderColor: colors.border, backgroundColor: colors.surface1 }}><Text numberOfLines={1} style={{ color: colors.foregroundMuted, fontSize: 11 }}>{selection.path} · L{Math.min(selection.start, selection.end)}–{Math.max(selection.start, selection.end)}</Text><View style={{ flexDirection: "row", alignItems: "center", gap: 16 }}><Pressable accessibilityRole="button" onPress={() => codeFeedback("explain")} style={{ minHeight: 36, justifyContent: "center" }}><Text style={{ color: colors.foreground, fontSize: 13 }}>{t("explainCode")}</Text></Pressable><Pressable accessibilityRole="button" onPress={() => codeFeedback("change")} style={{ minHeight: 36, justifyContent: "center" }}><Text style={{ color: colors.accent, fontSize: 13 }}>{t("requestChange")}</Text></Pressable><View style={{ flex: 1 }} /><ToolButton touch={!wide} icon="X" label={t("clearSelection")} colors={colors} onPress={() => setSelection(null)} /></View></View> : null}
    <ReviewOptions open={optionsOpen} onClose={() => setOptionsOpen(false)} filter={state.filter} point={point} busy={saving} onSave={() => void savePoint()} onFilter={(filter) => save({ ...state, filter })} colors={colors} />
    <FeedbackComposer draft={draft} agentId={params.agentId} colors={colors} onClose={() => setDraft(null)} />
  </View>;
}
