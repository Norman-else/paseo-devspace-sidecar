import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { useRpc } from '@getpaseo/plugin/client';
import { Icon, Modal } from '@getpaseo/plugin/client/ui';
import { useQuery } from '@tanstack/react-query';
import { cleanupPreviewRpc, cleanupExecuteRpc, cleanupStatusRpc, type CleanupResult } from '../shared/cleanup';
import type { Colors } from './review-ui';
import { codeReviewPalette } from '../shared/appearance';
import { useMessages } from './messages';

export function CleanupDialog({ open, onClose, agentId, workspaceId, prNumber, receipt, colors, onUpdated }: { open: boolean; onClose(): void; agentId: string; workspaceId?: string; prNumber?: number; receipt?: CleanupResult; colors: Colors; onUpdated(): void }) {
  const { t } = useMessages(), previewCall = useRpc(cleanupPreviewRpc), execute = useRpc(cleanupExecuteRpc), status = useRpc(cleanupStatusRpc);
  const [archive, setArchive] = useState(true), [acknowledge, setAcknowledge] = useState(false), [busy, setBusy] = useState(false), [result, setResult] = useState<CleanupResult | undefined>(receipt), [error, setError] = useState(''), [uncertain, setUncertain] = useState(false);
  useEffect(() => { if (receipt) setResult(receipt); }, [receipt]);
  const preview = useQuery({ queryKey: ['devspace-cleanup-preview', agentId, workspaceId, prNumber], queryFn: () => previewCall({ agentId, workspaceId: workspaceId!, prNumber }), enabled: open && !!workspaceId && !result, retry: false, staleTime: 0 });
  const plan = preview.data;
  useEffect(() => { setArchive(plan?.archiveAllowed ?? false); setAcknowledge(false); setError(''); }, [plan?.planId]);
  useEffect(() => {
    if (!result || !['cleaning','unknown'].includes(result.phase)) return;
    let stopped = false;
    const poll = async () => { try { const value = await status({ requestId: result.requestId, retryArchive: false }); if (!stopped) { setResult(value); if (value.phase !== result.phase) onUpdated(); } } catch (error) { if (!stopped) setError(error instanceof Error ? error.message : t('cleanupStatusFailed')); } };
    const timer = setInterval(() => void poll(), 1500); return () => { stopped = true; clearInterval(timer); };
  }, [result?.requestId, result?.phase, status]);
  const confirm = async () => {
    if (!plan || busy) return;
    setBusy(true); setError('');
    try { setResult(await execute({ planId: plan.planId, archive: archive && plan.archiveAllowed, acknowledgeUnmerged: acknowledge })); setUncertain(false); onUpdated(); }
    catch (error) { setUncertain(true); setError(error instanceof Error ? error.message : t('cleanupStatusFailed')); onUpdated(); }
    finally { setBusy(false); }
  };
  const retryArchive = async () => { if (!result || busy) return; setBusy(true); setError(''); try { setResult(await status({ requestId: result.requestId, retryArchive: true })); onUpdated(); } catch (error) { setError(error instanceof Error ? error.message : t('cleanupStatusFailed')); } finally { setBusy(false); } };
  const text = { color: colors.foreground, fontSize: 13, lineHeight: 20 }, muted = { ...text, color: colors.foregroundMuted };
  const blocked = !!plan?.blockers.length, ready = !!plan && !blocked && (plan.prState === 'MERGED' || acknowledge);
  const phaseKey = { cleaning: 'cleanupCleaning', archive_pending: 'cleanupArchivePending', done: 'cleanupDone', failed: 'cleanupFailed', unknown: 'cleanupUnknown' } as const;
  const blockers = { changes: 'cleanupChanges', ignored: 'cleanupIgnored', locked: 'cleanupLocked', busy: 'cleanupBusy', agents_busy: 'cleanupAgentsBusy', shared: 'cleanupShared', head_changed: 'cleanupHeadChanged' } as const;
  return <Modal open={open} onOpenChange={value => { if (!value && !busy) onClose(); }} title={t('cleanupTitle')}>
    <Modal.Content contentContainerStyle={{ padding: 0, gap: 0 }}>
      <View style={{ padding: 20, gap: 18 }}>
        {result ? <>
          <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>{result.phase === 'cleaning' ? <ActivityIndicator color={colors.accent} /> : <Icon name={result.phase === 'done' ? 'CircleCheck' : 'CircleAlert'} size={20} color={result.phase === 'done' ? colors.statusSuccess : colors.statusWarning} />}<Text style={{ ...text, fontSize: 15, fontWeight: '600', flex: 1 }}>{t(phaseKey[result.phase])}</Text></View>
          <Text selectable style={muted}>{result.root}</Text>
          <Text style={muted}>{t(result.phase === 'archive_pending' ? 'cleanupArchivePendingHelp' : result.phase === 'done' ? result.archive ? 'cleanupDoneArchiveHelp' : 'cleanupDoneHelp' : result.phase === 'unknown' ? 'cleanupUnknownHelp' : 'cleanupProgressHelp')}</Text>
          {result.recoveryRef ? <Text selectable style={{ ...muted, fontSize: 12 }}>{t('cleanupRecovery')} {result.recoveryRef}</Text> : null}
          {result.error ? <Text style={{ ...text, color: colors.statusWarning }}>{result.error}</Text> : null}
        </> : preview.isPending && workspaceId ? <View style={{ padding: 16, alignItems: 'center', gap: 12 }}><ActivityIndicator color={colors.accent} /><Text style={muted}>{t('cleanupChecking')}</Text></View> : preview.error ? <Text style={{ ...text, color: colors.statusWarning }}>{preview.error.message}</Text> : plan ? <>
          <View style={{ gap: 6 }}><Text style={{ ...text, fontSize: 15, fontWeight: '600' }}>{plan.branch ?? t('cleanupDetached')}</Text><Text selectable style={muted}>{plan.root}</Text><View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}><Text style={{ ...muted, fontSize: 12 }}>{plan.head.slice(0, 10)}</Text><Text style={{ ...text, fontSize: 12, color: plan.prState === 'MERGED' ? (codeReviewPalette(colors.surface0).dark ? '#a371f7' : '#8250df') : colors.foregroundMuted }}>{plan.prNumber ? `PR #${plan.prNumber} · ` : ''}{plan.prState === 'MERGED' ? t('prMerged') : plan.prState}</Text></View></View>
          <View style={{ borderRadius: 6, padding: 12, backgroundColor: colors.surface1, gap: 6 }}><Text style={text}>{t('cleanupEffect')}</Text><Text style={muted}>{t('cleanupPreserve')}</Text></View>
          {blocked ? <View style={{ gap: 6 }}>{plan.blockers.map(code => <View key={code} style={{ flexDirection: 'row', gap: 8 }}><Icon name="CircleAlert" size={16} color={colors.statusWarning} /><Text style={{ ...text, flex: 1, color: colors.statusWarning }}>{t(blockers[code as keyof typeof blockers] ?? 'cleanupBlocked')}</Text></View>)}{plan.precious.length ? <Text selectable style={{ ...muted, fontSize: 12 }}>{plan.precious.join('\n')}</Text> : null}</View> : null}
          <View style={{ gap: 8 }}><Text style={{ ...text, fontWeight: '500' }}>{t('cleanupSessions')}</Text>{plan.agents.map(a => <View key={a.id} style={{ flexDirection: 'row', gap: 8 }}><Icon name="MessageSquare" size={15} color={colors.foregroundMuted} /><Text numberOfLines={1} style={{ ...text, flex: 1 }}>{a.title}</Text><Text style={muted}>{a.status}</Text></View>)}</View>
          <Toggle checked={archive && plan.archiveAllowed} disabled={!plan.archiveAllowed || uncertain} onPress={() => setArchive(!archive)} label={t('cleanupArchive')} colors={colors} />
          {!plan.archiveAllowed ? <View style={{ gap: 6 }}><Text style={muted}>{t('cleanupOtherWorktrees')}</Text>{plan.otherWorktrees.map(w => <View key={w.id} style={{ padding: 10, borderRadius: 4, backgroundColor: colors.surface1, gap: 4 }}><Text style={text}>{w.branch ?? t('cleanupDetached')}</Text><Text selectable style={{ ...muted, fontSize: 12 }}>{w.root}</Text></View>)}</View> : null}
          {plan.prState !== 'MERGED' ? <Toggle checked={acknowledge} disabled={uncertain} onPress={() => setAcknowledge(!acknowledge)} label={t('cleanupUnmergedAck')} colors={colors} /> : null}
        </> : <Text style={muted}>{t('cleanupNoWorkspace')}</Text>}
        {error ? <Text style={{ ...text, color: colors.statusWarning }}>{error}</Text> : null}
      </View>
      <View style={{ borderTopWidth: 1, borderColor: colors.border, paddingHorizontal: 20, paddingVertical: 12, flexDirection: 'row', justifyContent: 'flex-end', gap: 8 }}>
        {result?.phase === 'failed' ? <Action label={t('cleanupRecheck')} onPress={() => { setResult(undefined); setUncertain(false); setError(''); void preview.refetch(); }} colors={colors} /> : null}
        {!result && !uncertain ? <Action label={t('cleanupRecheck')} onPress={() => void preview.refetch()} disabled={busy || !workspaceId || preview.isFetching} colors={colors} /> : null}
        {result?.phase === 'archive_pending' ? <Action label={t('cleanupRetryArchive')} onPress={() => void retryArchive()} disabled={busy} colors={colors} primary /> : !result && plan ? <Action label={t(uncertain ? 'cleanupCheckResult' : busy ? 'cleanupStarting' : 'cleanupConfirm')} onPress={() => void confirm()} disabled={busy || !ready} colors={colors} primary /> : <Action label={t('cleanupClose')} onPress={onClose} disabled={busy} colors={colors} />}
      </View>
    </Modal.Content>
  </Modal>;
}
function Toggle({ checked, disabled, label, onPress, colors }: { checked: boolean; disabled?: boolean; label: string; onPress(): void; colors: Colors }) {
  return <Pressable accessibilityRole="checkbox" accessibilityState={{ checked, disabled }} disabled={disabled} onPress={onPress} style={{ minHeight: 44, flexDirection: 'row', gap: 10, alignItems: 'center', opacity: disabled ? 0.5 : 1 }}><View style={{ width: 18, height: 18, borderRadius: 4, borderWidth: 1, borderColor: checked ? colors.accent : colors.border, backgroundColor: checked ? colors.accent : 'transparent', alignItems: 'center', justifyContent: 'center' }}>{checked ? <Icon name="Check" size={13} color={colors.accentForeground} /> : null}</View><Text style={{ color: colors.foreground, fontSize: 13, lineHeight: 20, flex: 1 }}>{label}</Text></Pressable>;
}
function Action({ label, onPress, disabled, primary, colors }: { label: string; onPress(): void; disabled?: boolean; primary?: boolean; colors: Colors }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={{ minHeight: 44, justifyContent: 'center', opacity: disabled ? 0.5 : 1 }}><View style={{ minHeight: 32, paddingHorizontal: 12, justifyContent: 'center', borderRadius: 5, backgroundColor: primary ? colors.accent : colors.surface1 }}><Text style={{ color: primary ? colors.accentForeground : colors.foreground, fontSize: 13, fontWeight: '500' }}>{label}</Text></View></Pressable>;
}
