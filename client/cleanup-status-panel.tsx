import { useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { useRpc, type PluginWorkspacePanelProps } from '@getpaseo/plugin/client';
import { useQuery } from '@tanstack/react-query';
import { cleanupReceiptRpc } from '../shared/cleanup';
import { CleanupDialog } from './cleanup-dialog';
import { useMessages } from './messages';

/** Workspace-scoped so archive retries remain reachable after the last agent closes. */
export function CleanupStatusPanel({ host, workspaceId, theme }: PluginWorkspacePanelProps) {
  const { t } = useMessages(), call = useRpc(cleanupReceiptRpc), [open, setOpen] = useState(true);
  const query = useQuery({ queryKey: ['devspace-workspace-cleanup', host.id, workspaceId], queryFn: () => call({ paseoWorkspaceId: workspaceId }), retry: false, refetchInterval: 3000 });
  const receipt = query.data?.cleanup, colors = theme.colors;
  return <View style={{ flex: 1, backgroundColor: colors.surface0, padding: 20, gap: 12 }}>
    <Text style={{ fontSize: 15, fontWeight: '600', color: colors.foreground }}>{t('cleanupStatusTitle')}</Text>
    {query.isPending ? <ActivityIndicator color={colors.accent} /> : query.error ? <Text style={{ color: colors.statusWarning, fontSize: 13 }}>{query.error.message}</Text> : receipt ? <>
      <Text selectable style={{ color: colors.foregroundMuted, fontSize: 13, lineHeight: 20 }}>{receipt.root}</Text>
      <Pressable accessibilityRole="button" onPress={() => setOpen(true)} style={{ minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' }}><Text style={{ color: colors.accent, fontSize: 13 }}>{t('cleanupCheckResult')} →</Text></Pressable>
      <CleanupDialog open={open} onClose={() => setOpen(false)} agentId="" receipt={receipt} colors={colors} onUpdated={() => void query.refetch()} />
    </> : <Text style={{ color: colors.foregroundMuted, fontSize: 13, lineHeight: 20 }}>{t('cleanupNoReceipt')}</Text>}
  </View>;
}
