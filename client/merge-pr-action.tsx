import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useRpc } from "@getpaseo/plugin/client";
import { Icon, useToast } from "@getpaseo/plugin/client/ui";
import { mergeOptionsRpc, mergePrRpc, mergeStatusRpc } from "../shared/diff";
import type { MergeMethod, MergeOutcome } from "../shared/pr-merge";
import { ReviewMenu } from "./review-menu";
import type { Colors } from "./review-ui";
import { useMessages } from "./messages";
const methodLabel = { merge: "mergeCreateCommit", squash: "mergeSquash", rebase: "mergeRebase" } as const;
const shortLabel = { merge: "mergeShortMerge", squash: "mergeShortSquash", rebase: "mergeShortRebase" } as const;
const reasons = { none: "mergePushedOnly", not_open: "mergeNotOpen", draft: "mergeDraft", permission: "mergeNoPermission", bypass_denied: "mergeBypassDenied", conflicts: "mergeConflicts", checking: "mergeChecking", requirements: "mergeRequirements", queue: "mergeQueueRequired", stacked: "mergeStacked", method: "mergeMethodUnavailable", stale: "mergeStale", busy: "mergeBusy", unavailable: "mergeUnavailable", github_failed: "mergeRejected", unknown: "mergeUnknown", review_loading: "mergeReviewLoading" } as const;
export function MergePrAction({ workspaceId, repository, number, headSha, baseBranch, colors, compact, hostId, ready, onUpdated }: { workspaceId: string; repository: string; number: number; headSha: string; baseBranch: string; colors: Colors; compact: boolean; hostId: string; ready: boolean; onUpdated?(): void }) {
  const { t } = useMessages(), toast = useToast();
  const optionsCall = useRpc(mergeOptionsRpc), mergeCall = useRpc(mergePrRpc), statusCall = useRpc(mergeStatusRpc);
  const [selected, setSelected] = useState<MergeMethod>("squash"), [bypass, setBypass] = useState(false), [busy, setBusy] = useState(false), [operation, setOperation] = useState<MergeOutcome | null>(null);
  const sending = useRef(false), live = useRef(true), handled = useRef(new Set<string>()), updated = useRef(onUpdated); updated.current = onUpdated;
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  const options = useQuery({ queryKey: ["devspace-merge-options", hostId, workspaceId, number, headSha], queryFn: () => optionsCall({ workspaceId, prNumber: number }), retry: false, staleTime: 15000, refetchInterval: (query) => query.state.data?.reason === "checking" ? 3000 : 30000 });
  const status = useQuery({ queryKey: ["devspace-merge-status", hostId, workspaceId, number, operation?.requestId], queryFn: () => statusCall({ workspaceId, prNumber: number, requestId: operation!.requestId }), enabled: !!operation && !busy && ["pending", "unknown"].includes(operation.status), retry: false, refetchInterval: (query) => query.state.data?.status === "pending" ? 2000 : false });
  const outcome = operation && status.data?.requestId === operation.requestId ? status.data : operation;
  const data = options.data, method = data?.methods.includes(selected) ? selected : data?.defaultMethod ?? "squash";
  const mismatch = !!data && (data.headSha !== headSha || data.baseBranch !== baseBranch || data.repository.toLowerCase() !== repository.toLowerCase());
  const reason = !ready ? "review_loading" : mismatch ? "stale" : options.error ? "unavailable" : !data ? "checking" : bypass ? data.bypassReason : data.reason;
  const pending = outcome?.status === "pending", uncertain = outcome?.status === "unknown", done = outcome?.status === "merged", locked = busy || pending || uncertain || done;
  useEffect(() => { if (data && !data.canBypass) setBypass(false); }, [data?.canBypass]);
  useEffect(() => { if (mismatch || data && data.state !== "OPEN") updated.current?.(); }, [mismatch, data?.state, options.dataUpdatedAt]);
  useEffect(() => {
    if (!outcome || !["merged", "failed"].includes(outcome.status) || handled.current.has(outcome.requestId)) return;
    handled.current.add(outcome.requestId);
    if (outcome.status === "merged") toast.show(t("mergeSucceeded"));
    else toast.error([t(reasons[outcome.reason]), outcome.detail].filter(Boolean).join(" "));
    void options.refetch(); updated.current?.();
  }, [outcome, options.refetch, t, toast]);
  const label = busy || pending ? t("mergeInProgress") : uncertain ? t("mergeCheckStatus") : done ? t("mergeSucceeded") : bypass ? t(compact ? "mergeBypassCompact" : "mergeBypassAction", { method: t(shortLabel[method]) }) : t(method === "merge" ? "mergeMergeAction" : methodLabel[method]);
  const disabled = busy || pending || done || !uncertain && (reason !== "none" || !data?.methods.includes(method));
  const tone = bypass ? colors.statusDanger : colors.statusSuccess;
  const foreground = disabled || busy || pending || uncertain ? colors.foregroundMuted : colors.surface0;
  const background = disabled || uncertain ? colors.surface2 : tone;
  const submit = async () => {
    if (uncertain) { void status.refetch(); return; }
    if (disabled || sending.current || !data) return;
    const requestId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2).padEnd(12, "0")}-${Math.random().toString(36).slice(2).padEnd(12, "0")}`;
    sending.current = true; setBusy(true); setOperation({ requestId, status: "pending", reason: "none" });
    try {
      const result = await mergeCall({ workspaceId, prNumber: number, requestId, expectedRepository: repository, expectedHeadSha: headSha, expectedBaseBranch: baseBranch, method, bypass });
      if (live.current) setOperation(result);
    } catch { if (live.current) { setOperation({ requestId, status: "unknown", reason: "unknown" }); toast.error(t("mergeUnknown")); } }
    finally { sending.current = false; if (live.current) setBusy(false); }
  };
  return <View testID="devspace-merge-action" style={{ flexDirection: "row", alignItems: "center", minWidth: 0, maxWidth: compact ? 190 : 300, zIndex: 20 }}>
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityHint={t(reasons[reason])} accessibilityState={{ disabled, busy: busy || pending }} disabled={disabled} onPress={() => void submit()} style={{ minHeight: compact ? 44 : 28, flexShrink: 1, justifyContent: "center" }}>
      {({ pressed }) => <View style={{ height: compact ? 32 : 28, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingHorizontal: 10, borderWidth: 1, borderRightWidth: 0, borderColor: disabled || uncertain ? colors.border : tone, borderTopLeftRadius: 4, borderBottomLeftRadius: 4, backgroundColor: background, opacity: pressed ? 0.75 : 1 }}>
        {busy || pending ? <ActivityIndicator size="small" color={foreground} /> : null}<Text numberOfLines={1} style={{ flexShrink: 1, color: foreground, fontSize: 11, lineHeight: 16, fontWeight: "600" }}>{label}</Text>
      </View>}
    </Pressable>
    <ReviewMenu title={t("mergeOptions")} colors={colors} touch={compact} align="right" width={340} trigger={({ open, toggle }) => <Pressable accessibilityRole="button" accessibilityLabel={t("mergeOptions")} accessibilityState={{ expanded: open, disabled: locked }} aria-expanded={open} disabled={locked} onPress={toggle} style={{ minHeight: compact ? 44 : 28, justifyContent: "center" }}>
      <View style={{ width: compact ? 44 : 28, height: compact ? 32 : 28, alignItems: "center", justifyContent: "center", backgroundColor: background, borderWidth: 1, borderColor: disabled || uncertain ? colors.border : tone, borderTopRightRadius: 4, borderBottomRightRadius: 4, opacity: locked ? 0.6 : 1 }}><Icon name="ChevronDown" size={13} color={foreground} /></View>
    </Pressable>} options={[
      ...(["merge", "squash", "rebase"] as const).map((value) => ({ id: value, label: t(methodLabel[value]), description: !data?.methods.includes(value) ? t("mergeMethodUnavailable") : value === "merge" ? t("mergeCommitHelp") : value === "squash" ? t("mergeSquashHelp", { count: data.commits }) : t("mergeRebaseHelp", { count: data.commits }), selected: value === method, disabled: locked || !data?.methods.includes(value), onSelect: () => setSelected(value) })),
      { id: "bypass", label: t("mergeBypass"), description: data?.canBypass ? t("mergeBypassHelp") : t("mergeBypassDenied"), selected: bypass, checkbox: true, danger: true, separatorBefore: true, disabled: locked || !data?.canBypass, onSelect: () => setBypass(!bypass) },
      { id: "refresh", label: t("mergeRefresh"), icon: "RefreshCw", separatorBefore: true, disabled: locked, onSelect: () => { void options.refetch(); updated.current?.(); } },
    ]} footer={<View style={{ padding: 10, gap: 6 }}><Text style={{ color: reason !== "none" ? colors.statusWarning : colors.foregroundMuted, fontSize: 12, lineHeight: 18 }}>{t(reasons[reason])}</Text>{reason !== "none" ? <Text style={{ color: colors.foregroundMuted, fontSize: 12, lineHeight: 18 }}>{t("mergePushedOnly")}</Text> : null}</View>} />
  </View>;
}
