import { CleanupDialog } from "./cleanup-dialog";
import { useEffect, useMemo, useRef, useState } from "react";
import { Animated, Pressable, Text, View, type FlatList as NativeFlatList } from "react-native";
import { Spinner } from "./spinner";
import { useQuery } from "@tanstack/react-query";
import { useAgent, useRpc, useTabState, type PluginAgentPanelProps } from "@getpaseo/plugin/client";
import { commentBatchPrompt } from "../shared/comment-batch";
import { FlatList, Icon, copyText, useToast } from "@getpaseo/plugin/client/ui";
import { z } from "zod";
import { isWorktree, catalogRpc, comparison as comparisonSchema, contextRpc, checkpointRpc, threadsRpc, fileRpc, pullRequestRpc, reviewRpc, snapshotRpc, workspaceEmptyError, workspaceEmptyMessages, type WorkspaceEmptyReason, type ReviewFile, type Snapshot } from "../shared/diff";
import { checkpointSchema, type ReviewThread, type CheckDetail } from "../shared/review-details";
import { HEADER_HEIGHT, reviewRows, type ReviewRow, type ReviewExtras } from "../shared/review";
import { selectedCode, selectedLines, selectLine } from "../shared/selection";
import { CodeLine, FileHeader, FileIndex, ToolButton } from "./review-ui";
import { DIVIDER_WIDTH, ResizeDivider } from "./resize-divider";
import { SCROLLBAR_CLEARANCE, useScrollContentWidth } from "./use-scroll-content-width";
import { useRowMeasurements } from "./use-row-measurements";
import { useMessages } from "./messages";
import { useCodeAppearance } from "./use-code-appearance";
import { PullRequestStatus } from "./pull-request-status";
import { branchPullRequests, reviewHeader } from "../shared/review-header";
import { ReviewMenu } from "./review-menu";
import { ReviewEmptyState } from "./review-empty-state";
import { reviewEmptyKind } from "../shared/review-empty";
import { ReviewToolbar } from "./review-toolbar";
import { useStickyFileHeader } from "./use-sticky-file-header";
import { Discussions, InlineDiscussion } from "./review-discussions";
import { FeedbackComposer, type FeedbackDraft } from "./feedback-composer";
import { GitActionButton, useGitActions } from "./git-actions";
import type { PrPresence } from "../shared/git-actions";
import { ReviewOptions } from "./review-options";
import { clearNativeCodeSelection, installSelectionCursor, watchCodeSelection, stableScrollbarStyle } from "./web";
import { ReviewTabs } from "./review-tabs";
import { FloatingSelectionActions } from "./floating-selection-actions";
import { useCodeSelection } from "./use-code-selection";
import { ContextGap } from "./context-gap";
import { codeReviewPalette } from "../shared/appearance";
import { fileDiscussions, nextDiscussion } from "../shared/comment-navigation";

const stateSchema = z.object({ comparison: comparisonSchema, scope: z.string().default(""), collapsed: z.array(z.string()).default([]), reviewed: z.record(z.string(), z.string()).default({}), indexVisible: z.boolean().default(true), indexWidth: z.number().min(140).max(520).nullable().default(null), prNumber: z.number().int().optional(), filter: z.enum(["all", "unreviewed", "since"]).default("all"), points: z.record(z.string(), checkpointSchema).default({}), view: z.enum(["changes", "comments"]).default("changes"), workspaceId: z.string().optional() });
type Jump = { path: string; key?: string };
export function DiffPanel({ theme, host, params, tab, cleanupInitiallyOpen = false }: PluginAgentPanelProps & { cleanupInitiallyOpen?: boolean }) {
  const { t, translateBackend, locale } = useMessages(), toast = useToast();
  const typography = useCodeAppearance();
  const [state, save] = useTabState(tab, stateSchema, { comparison: "task" as const, scope: "", collapsed: [] as string[], reviewed: {} as Record<string, string>, indexVisible: true, indexWidth: null as number | null, filter: "all" as const, points: {}, view: "changes" as const });
  const latestState = useRef(state); latestState.current = state;
  const [dragWidth, setDragWidth] = useState<number | null>(null), [size, setSize] = useState({ width: 700, height: 700 });
  const [search, setSearch] = useState(""), [searchOpen, setSearchOpen] = useState(false), [searchType, setSearchType] = useState<"files" | "code">("files");
  const [indexOpen, setIndexOpen] = useState(false), [optionsOpen, setOptionsOpen] = useState(false), [activePath, setActivePath] = useState("");
  const [jump, setJump] = useState<Jump | null>(null), [draft, setDraft] = useState<FeedbackDraft | null>(null);
  const [cleanupOpen, setCleanupOpen] = useState(cleanupInitiallyOpen);
  const [showResolved, setShowResolved] = useState(false);
  const [saving, setSaving] = useState(false), [loadingContext, setLoadingContext] = useState("");
  const [overrides, setOverrides] = useState<Record<string, ReviewFile>>({});
  const [extra, setExtra] = useState<{ version: string; contexts: NonNullable<ReviewExtras["contexts"]> }>({ version: "", contexts: {} });
  const [anchors, setAnchors] = useState<{ version: string; values: NonNullable<ReviewExtras["anchors"]> }>({ version: "", values: {} });
  const [openedThreads, setOpenedThreads] = useState<{ version: string; ids: string[] }>({ version: "", ids: [] });
  const [currentThreadId, setCurrentThreadId] = useState<string | null>(null);
  const savedScroll = useRef(0);
  const restoreScroll = useRef(false);
  const colors = theme.colors;
  const codePalette = useMemo(() => codeReviewPalette(colors.surface0), [colors.surface0]);
  const reviewColors = useMemo(() => codePalette.dark ? { ...colors, surface0: codePalette.background, surface1: codePalette.header, surface2: codePalette.hover, border: codePalette.border, foregroundMuted: "#a0a0a0" } : colors, [colors, codePalette]);
  useEffect(() => installSelectionCursor(colors.foreground, codePalette.background), [colors.foreground, codePalette.background]);
  const catalogCall = useRpc(catalogRpc), snapshotCall = useRpc(snapshotRpc), reviewCall = useRpc(reviewRpc), fileCall = useRpc(fileRpc), prCall = useRpc(pullRequestRpc), threadsCall = useRpc(threadsRpc), contextCall = useRpc(contextRpc), checkpointCall = useRpc(checkpointRpc);
  const catalog = useQuery({ queryKey: ["devspace-context-v3", host.id, params.agentId, state.workspaceId], queryFn: () => catalogCall({ agentId: params.agentId, pinnedWorkspaceId: state.workspaceId }), refetchInterval: 15000, retry: false });
  const [rejected, setRejected] = useState<{ id: string; reason: WorkspaceEmptyReason; at: number } | null>(null);
  const rejectedReason = rejected?.id === catalog.data?.workspace?.id && rejected && catalog.dataUpdatedAt <= rejected.at ? rejected.reason : undefined;
  const bound = rejectedReason ? null : catalog.data?.workspace;
  const emptyReason = rejectedReason ?? catalog.data?.emptyReason;
  const pullRequests = useQuery({ queryKey: ["devspace-pull-requests-v2", host.id, bound?.id, bound?.branch], queryFn: () => prCall({ workspaceId: bound!.id }), enabled: !!bound, refetchInterval: 30000, staleTime: 10000, retry: false });
  const currentPrResult = branchPullRequests(pullRequests.data, bound?.branch);
  const openPrs = currentPrResult?.status === "available" ? currentPrResult.pullRequests.filter((item) => item.state === "OPEN" || item.state === "DRAFT") : [];
  const prPresence: PrPresence = pullRequests.isPending || pullRequests.error || !currentPrResult || currentPrResult.status === "unavailable" ? "unknown"
    : currentPrResult.status === "none" ? "none" : openPrs.length ? "open"
    : currentPrResult.pullRequests.some((item) => (item.state === "MERGED" || item.state === "CLOSED") && item.headSha === currentPrResult.localHeadSha) ? "done" : "none";
  const result = currentPrResult?.status === "available" ? currentPrResult : null;
  const pr = result?.pullRequests.find((pr) => pr.number === state.prNumber) ?? result?.pullRequests[0];
  const view = pr ? state.view : "changes";
  const comparison: Snapshot["comparison"] = pr ? state.comparison === "local" ? "local" : "pr" : state.comparison === "uncommitted" || !bound?.baseSha ? "uncommitted" : "task";
  const scope = `${params.agentId}:${bound?.id}:${bound?.branch ?? ""}:${comparison}:${pr?.number ?? ""}`;
  const point = state.points[scope];
  const effectiveFilter = state.filter === "since" && !point ? "all" : state.filter;
  const since = effectiveFilter === "since" ? point?.id : undefined;
  const request = { comparison, prNumber: pr?.number, since };
  const snapshot = useQuery({ queryKey: ["devspace-snapshot-v4", host.id, bound?.id, bound?.branch, comparison, pr?.number, since], queryFn: () => snapshotCall({ workspaceId: bound!.id, ...request }), enabled: !!bound, refetchInterval: 3000, retry: false });
  const document = useQuery({ queryKey: ["devspace-review-v4", host.id, bound?.id, bound?.branch, comparison, pr?.number, since, snapshot.data?.revision], queryFn: () => reviewCall({ workspaceId: bound!.id, ...request }), enabled: !!bound && !!snapshot.data, placeholderData: (previous) => previous && previous.snapshot.workspace.id === bound?.id && previous.snapshot.workspace.branch === bound?.branch && previous.snapshot.comparison === comparison && previous.snapshot.checkpoint?.id === since && previous.snapshot.prNumber === pr?.number ? previous : undefined, retry: 1, gcTime: 60000 });
  const local = useQuery({ queryKey: ["devspace-local-v4", host.id, bound?.id, bound?.branch, pr?.number, pr?.headSha], queryFn: () => snapshotCall({ workspaceId: bound!.id, comparison: "local", prNumber: pr!.number }), enabled: !!bound && !!pr, refetchInterval: 10000, retry: false });
  const discussions = useQuery({ queryKey: ["devspace-discussions", host.id, bound?.id, bound?.branch, pr?.number, pr?.headSha], queryFn: () => threadsCall({ workspaceId: bound!.id, prNumber: pr!.number }), enabled: !!bound && !!pr, refetchInterval: 30000, retry: false });
  useEffect(() => {
    if (!bound) return;
    const changed = snapshot.data?.workspace.id === bound.id && snapshot.data.workspace.branch !== bound.branch;
    const associationLost = [snapshot.error, document.error].some(error => error?.message.includes("PR is no longer associated with this workspace."));
    if (changed || associationLost) { void catalog.refetch(); void pullRequests.refetch(); }
  }, [bound?.id, bound?.branch, snapshot.data?.workspace.branch, snapshot.error, document.error]);
  useEffect(() => {
    // A freshly verified workspace may recover from an older cached terminal error.
    const failed = [snapshot, document, pullRequests, local, discussions].find((query) => query.errorUpdatedAt >= catalog.dataUpdatedAt && workspaceEmptyError(query.error));
    const reason = workspaceEmptyError(failed?.error);
    if (bound && reason) setRejected({ id: bound.id, reason, at: Date.now() });
  }, [bound, catalog.dataUpdatedAt, snapshot.error, snapshot.errorUpdatedAt, document.error, document.errorUpdatedAt, pullRequests.error, pullRequests.errorUpdatedAt, local.error, local.errorUpdatedAt, discussions.error, discussions.errorUpdatedAt]);
  useEffect(() => { if (pr && document.data?.snapshot.headSha && document.data.snapshot.headSha !== pr.headSha) void pullRequests.refetch(); }, [document.data?.snapshot.headSha, pr?.headSha]);
  const version = `${scope}:${since ?? ""}:${document.data?.snapshot.revision ?? ""}`;
  const collapsed = useMemo(() => new Set(state.scope === scope ? state.collapsed : []), [state.collapsed, state.scope, scope]);
  const reviewed = useMemo(() => state.scope === scope ? state.reviewed : {}, [state.scope, state.reviewed, scope]);
  const allFiles = useMemo(() => (document.data?.files ?? []).map((file) => overrides[`${version}:${file.path}`] ?? file), [document.data, overrides, version]);
  const files = useMemo(() => allFiles.filter((file) => (!search || searchType !== "files" || file.path.toLowerCase().includes(search.toLowerCase())) && (state.filter !== "unreviewed" || !file.hash || reviewed[file.path] !== file.hash)), [allFiles, search, searchType, state.filter, reviewed]);
  const git = useGitActions({ workspace: bound, agentId: params.agentId, pr: prPresence, openPr: openPrs[0]?.number, revision: snapshot.data?.revision, hostId: host.id, onDraft: setDraft, onAgentFinished: () => refresh() });
  const wide = size.width >= 560;
  const maxIndexWidth = Math.min(520, Math.max(140, size.width - 280 - DIVIDER_WIDTH));
  const indexShown = wide && state.indexVisible && files.length > 0;
  const indexWidth = indexShown ? Math.max(140, Math.min(maxIndexWidth, dragWidth ?? state.indexWidth ?? Math.min(210, Math.max(150, size.width * 0.26)))) : 0;
  const viewportWidth = Math.max(100, size.width - indexWidth - (indexShown ? DIVIDER_WIDTH : 0));
  const scrollContent = useScrollContentWidth(viewportWidth), contentWidth = scrollContent.width;
  useEffect(() => { if (wide || !files.length) setIndexOpen(false); }, [wide, files.length]);
  const layoutKey = `${contentWidth}:${typography.fontFamily}:${typography.fontSize}:${version}`;
  const { heights, report } = useRowMeasurements(layoutKey);
  const inlineAvailable = comparison === "pr" && !since && !!discussions.data && !!document.data?.snapshot.headSha && discussions.data.headSha === document.data.snapshot.headSha;
  const currentThreads = useMemo(() => discussions.data?.threads.filter((thread) => !thread.outdated) ?? [], [discussions.data]);
  const inlineThreads = useMemo(() => inlineAvailable ? currentThreads : [], [inlineAvailable, currentThreads]);
  const expandedThreads = useMemo(() => new Set(openedThreads.version === version ? openedThreads.ids : []), [openedThreads, version]);
  const model = useMemo(() => reviewRows(files, searchType === "code" && search ? new Set() : collapsed, Math.max(1, contentWidth - typography.gutterWidth - 8), heights, typography, { contexts: extra.version === version ? extra.contexts : {}, threads: inlineThreads, expandedThreads, anchors: anchors.version === version ? anchors.values : {} }), [expandedThreads, anchors, files, collapsed, contentWidth, heights, typography, extra, version, inlineThreads, searchType, search]);
  const list = useRef<NativeFlatList<ReviewRow>>(null), sticky = useStickyFileHeader(model, setActivePath);
  const codeSelection = useCodeSelection({ model, width: contentWidth, height: size.height, gutterWidth: typography.gutterWidth, scope: version, list });
  const { selection, setSelection } = codeSelection;
  useEffect(() => { sticky.reset(); codeSelection.onScroll(0); list.current?.scrollToOffset({ offset: 0, animated: false }); }, [scope, since]);
  useEffect(() => { setSelection(null); }, [version, search, state.filter]);
  useEffect(() => watchCodeSelection(version, (value) => { setSelection(value); }), [version]);
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
  const visibleError = error && !workspaceEmptyError(error) ? error : null;
  const empty = document.data && !visibleError ? reviewEmptyKind({ comparison, totalFiles: document.data.snapshot.totalFiles, visibleFiles: files.length, search: searchType === "files" && !!search, unreviewed: effectiveFilter === "unreviewed", since: !!since }) : null;
  const setComparison = (next: Snapshot["comparison"]) => { save({ ...state, comparison: next, filter: "all", scope: "", collapsed: [], reviewed: {} }); setSearch(""); };
  const emptyAction = empty === "synced" ? { label: t("viewPrChanges"), onPress: () => setComparison("pr") }
    : empty === "search" ? { label: t("clearFileSearch"), onPress: () => setSearch("") }
    : empty === "reviewed" || empty === "baseline" || empty === "filtered" ? { label: t("showAllChanges"), onPress: () => { setSearch(""); save({ ...state, filter: "all" }); } }
    : empty === "clean" && bound?.baseSha ? { label: t("viewTaskChanges"), onPress: () => setComparison("task") }
    : { label: t("refresh"), onPress: refresh };
  const reviewedCount = allFiles.filter((file) => file.hash && reviewed[file.path] === file.hash).length;
  const selected = files.some((file) => file.path === activePath) ? activePath : files[0]?.path ?? "";
  const matches = useMemo(() => searchType === "code" && search.trim() ? model.rows.flatMap((row, index) => row.kind === "code" && row.line.text.toLowerCase().includes(search.toLowerCase()) ? [index] : []) : [], [model, search, searchType]);
  const [matchIndex, setMatchIndex] = useState(-1);
  const matchIndexRef = useRef(-1);
  useEffect(() => { setMatchIndex(-1); matchIndexRef.current = -1; }, [search, version]);
  const match = (direction: number) => { if (!matches.length) return; const next = matchIndexRef.current < 0 ? direction > 0 ? 0 : matches.length - 1 : (matchIndexRef.current + direction + matches.length) % matches.length; setMatchIndex(next); matchIndexRef.current = next; const row = model.rows[matches[next]]; navigate(row.path, row.key); };
  const expandContext = async (row: Extract<ReviewRow, { kind: "gap" }>, more = false) => {
    if (!bound || !document.data || loadingContext || row.count === 0) return;
    const cached = extra.version === version ? extra.contexts[row.key] : undefined;
    if (!more && cached?.lines.length) {
      if (selection?.path === row.path) setSelection(null);
      setExtra((previous) => ({ version, contexts: { ...(previous.version === version ? previous.contexts : {}), [row.key]: { ...cached, expanded: !row.expanded } } }));
      return;
    }
    setLoadingContext(row.key);
    const lines = [...(cached?.lines ?? [])], initial = lines.length;
    const amount = Math.min(1000, row.omitted > 0 ? row.omitted : 1000);
    let total = cached?.total ?? 0;
    try {
      while (lines.length - initial < amount) {
        const count = Math.min(200, amount - (lines.length - initial));
        const chunk = await contextCall({ workspaceId: bound.id, ...request, path: row.path, side: row.side, start: (row.side === "old" ? row.oldStart : row.newStart) + lines.length, count, revision: document.data.snapshot.revision });
        total = chunk.total; lines.push(...chunk.lines);
        if (chunk.lines.length < count) break;
      }
      if (currentVersion.current !== version) return;
      setExtra((previous) => ({ version, contexts: { ...(previous.version === version ? previous.contexts : {}), [row.key]: { lines, total, expanded: true } } }));
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
    const selectedVersion = selection.side === "old" && snapshot?.checkpoint ? t("baselineSavedAt", { time: new Date(snapshot.checkpoint.createdAt).toLocaleString(locale) }) : selection.side === "new" && comparison !== "pr" ? t("workingVersion") : selection.side === "old" ? snapshot?.ref : snapshot?.headSha;
    const title = t("selectionRange", { path: selection.path, side: t(selection.side === "old" ? "versionOld" : "versionNew"), from, to });
    setDraft({ title, intent: kind, attachment: { path: selection.path, location: `L${from}–${to} · ${t(selection.side === "old" ? "versionOld" : "versionNew")}`, source, revision: selectedVersion, capturedAt: snapshot?.capturedAt, preview: { kind: "code", lines: selectedLines(model.rows, selection) } }, instruction: t(kind === "explain" ? "explainInstruction" : "changeInstruction"), context: `${title}\n${source}\n${selectedVersion ?? ""}\n${snapshot?.capturedAt ?? ""}\n\n\`\`\`\n${selectedCode(model.rows, selection)}\n\`\`\`\n${t("selectionLimit")}` });
  };
  const checkFeedback = (check: CheckDetail) => { if (!pr) return; setDraft({ title: check.name, attachment: { source: `PR #${pr.number}`, revision: check.headSha ?? pr.headSha, preview: { kind: "text", text: `${check.summary}\n\n${check.excerpt}` } }, instruction: t("changeInstruction"), context: `PR #${pr.number} · ${check.headSha ?? pr.headSha}\n${check.name}\n${check.url ?? ""}\n\n${check.summary}\n\n${check.excerpt}` }); };
  const agentBusy = !!useAgent(params.agentId, (agent) => agent.status === "running" || agent.status === "initializing");
  const batchFeedback = (list: ReviewThread[]) => {
    if (!pr || !bound || !list.length) return;
    const prompt = commentBatchPrompt(list, { prNumber: pr.number, headBranch: result?.branch ?? bound.branch ?? "", baseBranch: pr.baseBranch, headSha: discussions.data?.headSha ?? pr.headSha, workspace: { id: bound.id, root: bound.root, worktree: isWorktree(bound) } });
    setDraft({ title: t("batchTitle", { count: list.length }), intent: "git", hint: t("batchHint"), instruction: t("batchInstruction"), context: prompt, attachment: { source: `PR #${pr.number} · ${t("batchTitle", { count: list.length })}`, preview: { kind: "text", text: prompt } } });
  };
  const threadFeedback = (thread: ReviewThread) => setDraft({ title: `${thread.path}${thread.line ? ":" + thread.line : ""}`, intent: "change", attachment: { path: thread.path, location: thread.line ? `L${thread.startLine ?? thread.line}–${thread.line}` : undefined, source: `PR #${pr?.number}${thread.outdated ? " · " + t("outdated") : ""}`, revision: discussions.data?.headSha, preview: { kind: "markdown", text: thread.comments.map((comment) => `**${comment.name ?? comment.author}**\n\n${comment.body}`).join("\n\n---\n\n") } }, instruction: t("changeInstruction"), context: `PR #${pr?.number} · ${discussions.data?.headSha ?? ""}\n${thread.path}:${thread.startLine ?? thread.line ?? ""}–${thread.line ?? ""} (${thread.side})${thread.outdated ? " · " + t("outdated") : ""}\n\n${thread.comments.map((comment) => `${comment.author}: ${comment.body}\n${comment.url}`).join("\n\n")}` });
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
  const jumpThread = (thread: ReviewThread) => { if (thread.outdated) return; restoreScroll.current = false; const targetPath = allFiles.find((file) => fileDiscussions(file, [thread]).length)?.path ?? thread.path; save({ ...state, view: "changes", comparison: "pr", filter: "all", ...(comparison === "pr" && !since ? { collapsed: [...collapsed].filter((path) => path !== targetPath) } : { scope: "", collapsed: [], reviewed: {} }) }); setSearch(""); setCurrentThreadId(thread.id); setPendingThread(thread); };
  const changeView = (next: "changes" | "comments") => { if (next === view) return; if (next === "comments") { savedScroll.current = sticky.scrollOffset(); setJump(null); setPendingThread(null); } else restoreScroll.current = true; save({ ...state, view: next }); setSelection(null); };
  useEffect(() => { if (view !== "changes" || pendingThread || jump || !restoreScroll.current) return; const frame = requestAnimationFrame(() => { restoreScroll.current = false; list.current?.scrollToOffset({ offset: savedScroll.current, animated: false }); }); return () => cancelAnimationFrame(frame); }, [view]);
  const toggleThread = (id: string) => { setCurrentThreadId(id); setOpenedThreads((previous) => { const ids = new Set(previous.version === version ? previous.ids : []); if (!ids.delete(id)) ids.add(id); return { version, ids: [...ids] }; }); };
  const commentProps = (file: ReviewFile) => { const threads = fileDiscussions(file, inlineThreads); return { commentCount: threads.length, onComments: () => { const first = threads.find((thread) => !thread.resolved) ?? threads[0]; if (first) jumpThread(first); } }; };
  const header = reviewHeader({ hasWorkspace: !!bound, result: currentPrResult, pending: pullRequests.isPending, error: !!pullRequests.error });
  const collapseAction = <ToolButton icon="ListCollapse" label={t(collapsed.size ? "expandAll" : "collapseAll")} colors={colors} touch={!wide} onPress={() => mutate({ collapsed: collapsed.size ? [] : files.map((f) => f.path) })} />;
  const refreshAction = <ToolButton icon="RefreshCw" label={t("refresh")} colors={colors} touch={!wide} onPress={refresh} />;
  const indexAction = <ToolButton icon={wide ? "PanelRight" : "List"} label={t((wide ? indexShown : indexOpen) ? "hideFileList" : "showFileList")} colors={colors} touch={!wide} active={wide ? indexShown : indexOpen} expanded={wide ? indexShown : indexOpen} onPress={() => {
    if (wide) {
      const offset = sticky.scrollOffset(), top = offset + (offset > 0 ? HEADER_HEIGHT : 0);
      const anchor = model.rows.find((row, index) => model.offsets[index] + row.height > top);
      if (anchor) setJump({ path: anchor.path, ...(offset > 0 ? { key: anchor.key } : {}) });
      save({ ...state, indexVisible: !state.indexVisible, indexWidth: indexShown ? indexWidth : state.indexWidth }); setDragWidth(null);
    }
    else { clearNativeCodeSelection(); setSelection(null); setIndexOpen(!indexOpen); }
  }} />;
  const toggleSearch = () => { setSearchOpen(!searchOpen); if (searchOpen) setSearch(""); };
  const searchAction = <ToolButton icon="Search" label={t("filterFiles")} colors={colors} touch={!wide} onPress={toggleSearch} active={searchOpen} />;
  const canSearch = allFiles.length > 0 || searchOpen, canFilter = allFiles.length > 0 || effectiveFilter !== "all";
  const moreAction = <ReviewMenu title={t("moreReviewActions")} icon="Ellipsis" colors={colors} touch align="right" width={Math.min(280, size.width - 88)} options={[
    ...(size.width < 380 && canSearch ? [{ id: "search", label: t("filterFiles"), icon: "Search", onSelect: toggleSearch }] : []),
    ...(files.length ? [{ id: "collapse", label: t(collapsed.size ? "expandAll" : "collapseAll"), icon: "ListCollapse", onSelect: () => mutate({ collapsed: collapsed.size ? [] : files.map((file) => file.path) }) }] : []),
    ...(canFilter ? [{ id: "filters", label: t("reviewOptions"), icon: "SlidersHorizontal", onSelect: () => setOptionsOpen(true) }] : []),
    ...(bound?.mode === "worktree" ? [{ id: "cleanup", label: t("cleanupTitle"), icon: "FolderMinus", separatorBefore: true, onSelect: () => setCleanupOpen(true) }] : []),
    { id: "refresh", label: t("refresh"), icon: "RefreshCw", onSelect: refresh },
  ]} />;
  const actions = <View style={{ flexDirection: "row", alignItems: "center", gap: 2 }}>{bound ? wide ? <>{canSearch ? searchAction : null}{files.length ? collapseAction : null}{refreshAction}{moreAction}{files.length ? indexAction : null}</>
    : !canSearch && !canFilter && !files.length ? moreAction : <>{canSearch && size.width >= 380 ? searchAction : null}{moreAction}{files.length ? indexAction : null}</> : refreshAction}</View>;
  const candidates = catalog.data?.candidates ?? [], pinned = !!catalog.data?.pinned;
  const pickWorkspace = (workspaceId: string | undefined) => save({ ...latestState.current, workspaceId, prNumber: undefined, comparison: "task", filter: "all", scope: "", reviewed: {}, collapsed: [], view: "changes" });
  const workspaceLabel = (w: { root: string; branch: string | null }) => w.branch ?? w.root.split(/[\\/]/).filter(Boolean).at(-1) ?? w.root;
  const shortPath = (root: string) => root.replace(/^\/(Users|home)\/[^/]+/, "~");
  const kindLabel = (w: { root: string; mode: string; worktree?: boolean }) => t(isWorktree(w) ? "workspaceWorktree" : "workspaceCheckout");
  // Raised above later siblings so the popover is not covered by the PR header and tabs.
  const switcher = candidates.length > 1 ? <View testID="devspace-workspace-switcher" style={{ position: "relative", zIndex: 30, paddingHorizontal: 8, paddingTop: 4 }}>
    <ReviewMenu title={t("workspaceSwitch")} colors={colors} touch={!wide} width={Math.min(340, size.width - 16)} options={[
      { id: "auto", label: t("workspaceAuto"), description: t("workspaceAutoHint"), selected: !pinned, onSelect: () => pickWorkspace(undefined) },
      ...candidates.map((w, index) => ({ id: w.id, label: workspaceLabel(w), description: `${kindLabel(w)} · ${shortPath(w.root)}`, selected: pinned && bound?.id === w.id, separatorBefore: index === 0, onSelect: () => pickWorkspace(w.id) })),
    ]} trigger={({ open, toggle }) => <Pressable accessibilityRole="button" accessibilityLabel={`${t("workspaceSwitch")}: ${bound ? workspaceLabel(bound) : ""}`} aria-expanded={open} onPress={toggle}
      style={({ pressed }) => ({ alignSelf: "flex-start", maxWidth: "100%", minHeight: wide ? 26 : 36, paddingHorizontal: 6, borderRadius: 4, flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: open || pressed ? colors.surface2 : "transparent" })}>
      <Icon name={bound && isWorktree(bound) ? "FolderGit2" : "Folder"} size={13} color={colors.foregroundMuted} />
      <Text numberOfLines={1} style={{ flexShrink: 1, color: colors.foregroundMuted, fontSize: 12 }}>{bound ? `${kindLabel(bound)} · ${shortPath(bound.root)}` : t("codeReview")}</Text>
      {pinned ? <Icon name="Pin" size={12} color={colors.foregroundMuted} /> : null}
      <Icon name="ChevronsUpDown" size={12} color={colors.foregroundMuted} />
    </Pressable>} />
  </View> : null;
  return <View style={{ flex: 1, minHeight: 0, backgroundColor: colors.surface0 }} testID="devspace-diff-panel" onLayout={(event) => { const width = event.nativeEvent.layout.width; if (width > 0) setSize((previous) => previous.width === width ? previous : { ...previous, width }); }}>
    {switcher}
    {pr && header.mode === "pull-request" ? <PullRequestStatus result={currentPrResult} loading={false} error={null} colors={colors} compact={!wide} selectedNumber={pr.number} onSelect={(prNumber) => save({ ...state, prNumber, filter: "all", scope: "", reviewed: {}, collapsed: [] })} workspaceId={bound?.id} maxChecksHeight={size.height} maxChecksWidth={size.width - 24} onCheckFeedback={checkFeedback} hostId={host.id} onPrUpdated={refresh} onCleanup={bound?.mode === "worktree" ? () => setCleanupOpen(true) : undefined} gitAction={git ? <GitActionButton state={git} colors={colors} compact={!wide} variant="secondary" /> : undefined} mergeReady={comparison !== "pr" || document.data?.snapshot.headSha === pr.headSha} />
      : <View style={{ paddingHorizontal: 12, paddingVertical: 8, flexDirection: "row", alignItems: "center", gap: 8 }}><Icon name={bound ? "GitBranch" : "FileDiff"} size={14} color={colors.foregroundMuted} /><Text style={{ color: colors.foreground, fontSize: 12, fontWeight: "600", flexShrink: 1, flexGrow: git ? 0 : 1 }} numberOfLines={1}>{bound ? bound.branch ?? t("noBranchYet") : t("codeReview")}</Text>{git ? <><Text numberOfLines={1} style={{ flex: 1, minWidth: 0, color: "blocked" in git.plan ? colors.statusWarning : colors.foregroundMuted, fontSize: 12, lineHeight: 18 }}>{"blocked" in git.plan ? "" : git.summary}</Text><GitActionButton state={git} colors={colors} compact={!wide} variant="primary" /></> : null}{!bound ? actions : null}</View>}
    {header.showPrNotice ? <PullRequestStatus result={currentPrResult} loading={pullRequests.isPending} error={pullRequests.error} colors={colors} compact={!wide} /> : null}
    {pr ? <ReviewTabs view={view} count={discussions.data?.threads.length} compact={!wide} colors={colors} onChange={changeView} canNavigate={currentThreads.length > 0} onNavigate={(direction) => { const thread = nextDiscussion(currentThreads, currentThreadId, direction); if (thread) jumpThread(thread); }} /> : null}
    {pr && bound && view === "comments" ? <View style={{ flex: 1, minHeight: 0 }}>
      {discussions.isPending ? <View style={{ margin: 20, alignItems: "center" }}><Spinner size={18} color={colors.foregroundMuted} /></View> : discussions.error ? <Pressable accessibilityRole="button" onPress={() => void discussions.refetch()} style={{ padding: 16 }}><Text style={{ color: colors.statusDanger, fontSize: 13 }}>{t("prUnavailable")} · {t("retry")}</Text></Pressable> : <Discussions onBatch={batchFeedback} busy={agentBusy} threads={discussions.data?.threads ?? []} resolved={showResolved} onResolved={setShowResolved} onJump={jumpThread} onFeedback={threadFeedback} colors={colors} inlineAvailable={!!inlineAvailable} truncated={!!discussions.data?.truncated} />}
    </View> : null}
    {bound && view === "changes" ? <ReviewToolbar mode={comparison} modes={pr ? ["pr", "local"] : bound.baseSha ? ["task", "uncommitted"] : ["uncommitted"]} fileCount={snapshot.data?.totalFiles} reviewedCount={reviewedCount} totals={totals} compact={!wide} availableWidth={size.width}
      searchOpen={searchOpen} search={search} colors={colors} onSearchChange={setSearch} searchType={searchType} onSearchType={(type) => { setSearchType(type); setSearch(""); }} matchCount={matches.length} matchIndex={matchIndex} onMatch={match}
      onModeChange={setComparison}>{actions}</ReviewToolbar> : null}
    {view === "changes" && pr && local.data && local.data.totalFiles > 0 && local.data.ref === document.data?.snapshot.headSha && comparison === "pr" && !since ? <Pressable accessibilityRole="button" onPress={() => save({ ...state, comparison: "local", filter: "all", scope: "", collapsed: [], reviewed: {} })} style={{ paddingHorizontal: 12, paddingVertical: 7, borderBottomWidth: 1, borderColor: colors.border }}><Text style={{ color: colors.statusWarning, fontSize: 11 }}>{t("localPending", { count: local.data.totalFiles })}</Text></Pressable> : null}
    {view === "changes" && pr && local.error && comparison === "pr" && !since ? <Text style={{ color: colors.foregroundMuted, paddingHorizontal: 12, paddingVertical: 6, fontSize: 11 }}>{t("localUnavailable")}</Text> : null}
    {view === "changes" && effectiveFilter !== "all" && bound ? <Pressable accessibilityRole="button" onPress={() => setOptionsOpen(true)} style={{ paddingHorizontal: 12, paddingVertical: 6 }}><Text style={{ color: colors.foregroundMuted, fontSize: 11 }}>{since && point ? t("reviewPointAt", { time: new Date(point.createdAt).toLocaleString(locale) }) : t("unreviewedFiles")}</Text></Pressable> : null}
    {view === "changes" && visibleError ? <View style={{ padding: 16, gap: 12 }}><Text selectable style={{ color: colors.statusDanger, fontSize: 13 }}>{translateBackend(visibleError.message)}</Text><Pressable accessibilityRole="button" onPress={refresh} style={{ alignSelf: "flex-start", paddingHorizontal: 14, paddingVertical: 10, borderWidth: 1, borderColor: colors.border, borderRadius: 6 }}><Text style={{ color: colors.foreground, fontSize: 13 }}>{t("retry")}</Text></Pressable></View> : null}
    {view === "changes" && !visibleError && (catalog.isLoading || (bound && !document.data && (snapshot.isFetching || document.isFetching))) ? <View style={{ margin: 20, alignItems: "center" }}><Spinner size={18} color={colors.foregroundMuted} /></View> : null}
    {catalog.data?.cleanup ? <Pressable accessibilityRole="button" onPress={() => setCleanupOpen(true)} style={{ margin: 20, padding: 16, gap: 8, backgroundColor: colors.surface1, borderRadius: 6 }}><Text style={{ color: colors.foreground, fontSize: 15, fontWeight: "600" }}>{t(catalog.data.cleanup.phase === "done" ? "cleanupDone" : catalog.data.cleanup.phase === "archive_pending" ? "cleanupArchivePending" : "cleanupUnknown")}</Text><Text style={{ color: colors.foregroundMuted, fontSize: 13, lineHeight: 20 }}>{catalog.data.cleanup.root}</Text><Text style={{ color: colors.accent, fontSize: 13 }}>{t("cleanupCheckResult")} →</Text></Pressable> : null}
    {!catalog.isPending && !bound && !catalog.data?.cleanup && !visibleError ? <View style={{ padding: 20, gap: 8 }}><Text style={{ color: colors.foreground, fontSize: 13 }}>{t(emptyReason ? "noReviewableWorkspace" : "noAssociation")}</Text><Text style={{ color: colors.foregroundMuted, fontSize: 13, lineHeight: 20 }}>{emptyReason ? translateBackend(workspaceEmptyMessages[emptyReason]) : catalog.data?.inferenceError ? translateBackend(catalog.data.inferenceError) : t("noAssociationHelp")}</Text></View> : null}
    <View style={{ flex: 1, minHeight: 0, flexDirection: "row", display: view === "changes" ? "flex" : "none" }} onLayout={(event) => {
      // Native synthetic events can be recycled before React runs this updater.
      const height = event.nativeEvent.layout.height;
      if (view === "changes" && height > 0) setSize((previous) => previous.height === height ? previous : { ...previous, height });
    }}>
      {empty && bound ? <ReviewEmptyState kind={empty} colors={colors} compact={!wide} action={emptyAction} /> : document.data && bound ? <>
        <View testID="devspace-code-viewport" ref={codeSelection.viewport} onLayout={codeSelection.measureViewport} style={{ flex: 1, minWidth: 0, minHeight: 0, overflow: "hidden", backgroundColor: reviewColors.surface0 }}>
          <FlatList<ReviewRow> testID="devspace-code-list" ref={list} data={model.rows} ListHeaderComponent={scrollContent.sizer} contentContainerStyle={{ paddingRight: SCROLLBAR_CLEARANCE }} style={[stableScrollbarStyle, { flex: 1, width: viewportWidth, height: size.height }]} keyExtractor={(row) => row.key} initialNumToRender={55} maxToRenderPerBatch={55} windowSize={9}
            getItemLayout={(_, index) => ({ length: model.rows[index]?.height ?? 20, offset: model.offsets[index] ?? 0, index })} scrollEnabled={!codeSelection.dragging} onScroll={(event) => { if (view === "changes") { const offset = event.nativeEvent.contentOffset.y; sticky.onScroll(event); codeSelection.onScroll(offset); } }} scrollEventThrottle={16}
            renderItem={({ item: row }) => row.kind === "header" ? <FileHeader {...commentProps(row.file)} file={row.file} width={contentWidth} colors={reviewColors} collapsed={collapsed.has(row.path)} reviewed={!!row.file.hash && reviewed[row.path] === row.file.hash} onToggle={() => toggle(row.path)} onReview={() => mark(row.file)} />
              : row.kind === "code" ? <CodeLine compact={!wide} onDragStart={codeSelection.start} onDragMove={codeSelection.move} onDragEnd={codeSelection.end} row={row} colors={reviewColors} typography={typography} selectionScope={version} selection={selection} match={searchType === "code" && !!search && row.line.text.toLowerCase().includes(search.toLowerCase())} onSelect={(side, line) => { if (!selection) toast.show(t("selectionHint")); setSelection((previous) => selectLine(previous, row.path, side, line)); }} onHeight={(height) => report(row.key, height, layoutKey)} />
              : row.kind === "thread" ? <InlineDiscussion thread={row.thread} expanded={expandedThreads.has(row.thread.id)} onToggle={() => toggleThread(row.thread.id)} colors={reviewColors} onFeedback={threadFeedback} onHeight={(height) => report(row.key, height, layoutKey)} />
              : row.kind === "gap" ? <ContextGap row={row} colors={reviewColors} typography={typography} loading={loadingContext === row.key} disabled={!!loadingContext} onToggle={() => void expandContext(row)} onMore={() => void expandContext(row, true)} />
              : <Pressable accessibilityRole={row.deferred ? "button" : undefined} onPress={() => { if (row.deferred) void load(row.path); }} style={{ width: contentWidth, minHeight: row.height, paddingHorizontal: 12, justifyContent: "center" }}><Text style={{ color: row.deferred ? colors.accent : colors.foregroundMuted, fontSize: 11 }}>{translateBackend(row.text)}</Text></Pressable>}
          />
          {sticky.file ? <Animated.View style={{ position: "absolute", top: 0, left: 0, width: contentWidth, zIndex: 1, transform: [{ translateY: sticky.translateY }] }} testID="devspace-sticky-file-header"><FileHeader {...commentProps(sticky.file)} file={sticky.file} width={contentWidth} colors={reviewColors} collapsed={collapsed.has(sticky.file.path)} reviewed={!!sticky.file.hash && reviewed[sticky.file.path] === sticky.file.hash} onToggle={() => toggle(sticky.file!.path)} onReview={() => mark(sticky.file!)} /></Animated.View> : null}
          {view === "changes" && !draft && selection && codeSelection.visible ? <FloatingSelectionActions colors={reviewColors} compact={!wide} x={codeSelection.x} y={codeSelection.y} width={codeSelection.width} onHeight={codeSelection.measureToolbar} onExplain={() => codeFeedback("explain")} onChange={() => codeFeedback("change")} onCopy={() => { void copyText(selectedCode(model.rows, selection, Infinity)).then(() => toast.show(t("copiedCode"))).catch(() => toast.error(t("feedbackError"))); }} onClose={() => { clearNativeCodeSelection(); setSelection(null); }} /> : null}
        </View>
        {indexShown ? <><ResizeDivider width={indexWidth} min={140} max={maxIndexWidth} colors={reviewColors} onResize={setDragWidth} onCommit={(width) => { save({ ...latestState.current, indexWidth: width }); setDragWidth(null); }} /><View testID="devspace-file-index" style={{ width: indexWidth, flexShrink: 0, backgroundColor: reviewColors.surface0 }}><FileIndex files={files} activePath={selected} reviewed={reviewed} colors={reviewColors} onJump={navigate} /></View></>
          : !wide && indexOpen ? <View style={{ position: "absolute", top: 0, bottom: 0, left: 0, right: 0, backgroundColor: reviewColors.surface0 }}><View style={{ paddingLeft: 12, flexDirection: "row", alignItems: "center", borderBottomWidth: 1, borderColor: colors.border }}><Text style={{ flex: 1, color: colors.foreground, fontSize: 12 }}>{t("changedFiles")}</Text><ToolButton touch icon="X" label={t("closeIndex")} colors={colors} onPress={() => setIndexOpen(false)} /></View><FileIndex files={files} activePath={selected} reviewed={reviewed} colors={reviewColors} onJump={navigate} /></View> : null}
      </> : null}
    </View>

    <CleanupDialog open={cleanupOpen} onClose={() => setCleanupOpen(false)} agentId={params.agentId} workspaceId={bound?.id} prNumber={pr?.number} receipt={catalog.data?.cleanup} colors={colors} onUpdated={refresh} />
    <ReviewOptions open={optionsOpen} onClose={() => setOptionsOpen(false)} filter={effectiveFilter} scopeLabel={`${pr ? `PR #${pr.number}` : bound?.branch ?? t("codeReview")} · ${t(({ task: "taskChanges", uncommitted: "uncommitted", pr: "prChanges", local: "localChanges" } as const)[comparison])}`} prComparison={comparison === "pr"} point={point} busy={saving} onSave={() => void savePoint()} onFilter={(filter) => save({ ...state, filter })} colors={colors} />
    <FeedbackComposer draft={draft} agentId={params.agentId} colors={colors} onClose={() => setDraft(null)} />
  </View>;
}

export function CleanupPanel(props: PluginAgentPanelProps) { return <DiffPanel {...props} cleanupInitiallyOpen />; }
