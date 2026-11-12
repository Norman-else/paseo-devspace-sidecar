import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Platform, Pressable, Text, View, useWindowDimensions } from "react-native";
import { Icon, Modal } from "@getpaseo/plugin/client/ui";
import type { Checks } from "../shared/pull-request";
import type { CheckDetail } from "../shared/review-details";
import type { Colors } from "./review-ui";
import { ReviewChecks } from "./review-checks";
import { useMessages } from "./messages";
import { popoverScopeProps, watchPopoverDismiss } from "./web";

export function ChecksPopover({ label, icon, tone, workspaceId, number, headSha, checks, colors, maxWidth = 420, maxHeight = 460, onFeedback }: {
  label: string; icon: string; tone: string; workspaceId: string; number: number; headSha: string; checks: Checks; colors: Colors; maxWidth?: number; maxHeight?: number; onFeedback?(check: CheckDetail): void;
}) {
  const { t } = useMessages(), scope = useId();
  const { width: windowWidth } = useWindowDimensions();
  const compact = Platform.OS !== "web" || windowWidth < 560;
  const width = Math.max(120, Math.min(420, maxWidth, windowWidth - 24));
  const [open, setOpen] = useState(false);
  const pinned = useRef(false), opening = useRef<ReturnType<typeof setTimeout> | null>(null), closing = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearTimers = useCallback(() => { if (opening.current) clearTimeout(opening.current); if (closing.current) clearTimeout(closing.current); opening.current = closing.current = null; }, []);
  const close = useCallback(() => { clearTimers(); pinned.current = false; setOpen(false); }, [clearTimers]);
  const enter = () => { clearTimers(); if (compact || Platform.OS !== "web") return; opening.current = setTimeout(() => setOpen(true), 160); };
  const leave = () => { clearTimers(); if (!pinned.current) closing.current = setTimeout(() => setOpen(false), 240); };
  const pin = () => { clearTimers(); if (open && pinned.current) close(); else { pinned.current = true; setOpen(true); } };
  useEffect(() => clearTimers, [clearTimers]);
  useEffect(() => { close(); }, [compact, close]);
  useEffect(() => open && !compact ? watchPopoverDismiss(scope, close) : undefined, [open, compact, scope, close]);
  const feedback = (check: CheckDetail) => { close(); onFeedback?.(check); };
  const bodyHeight = Math.max(96, Math.min(460, maxHeight) - 44);
  return <View {...popoverScopeProps(scope)} style={{ position: "relative", zIndex: 20 }}>
    <Pressable testID="devspace-checks-trigger" accessibilityRole="button" accessibilityLabel={t("prToggleChecks")} accessibilityState={{ expanded: open }} aria-expanded={open} onPress={pin} onPointerEnter={enter} onPointerLeave={leave} onFocus={() => { if (!compact) { clearTimers(); setOpen(true); } }} hitSlop={compact ? { top: 6, bottom: 6, left: 0, right: 0 } : undefined}
      style={({ pressed }) => ({ minHeight: compact ? 32 : 20, flexDirection: "row", alignItems: "center", gap: 4, paddingVertical: 2, opacity: pressed ? 0.75 : 1 })}>
      <Icon name={icon} size={12} color={tone} /><Text style={{ fontSize: 11, lineHeight: 16, fontWeight: "500", color: tone }}>{label}</Text><Icon name={open ? "ChevronUp" : "ChevronDown"} size={10} color={tone} />
    </Pressable>
    {open && !compact ? <View {...popoverScopeProps(scope)} onPointerEnter={clearTimers} onPointerLeave={leave} onPointerDown={() => { pinned.current = true; clearTimers(); }} style={{ position: "absolute", top: "100%", left: 0, width, paddingTop: 8, zIndex: 20 }}>
      <View testID="devspace-checks-popover" role="dialog" accessibilityLabel={t("checks")} style={{ backgroundColor: colors.surface0, borderWidth: 1, borderColor: colors.border, borderRadius: 8, overflow: "hidden", boxShadow: "0 8px 24px rgba(0,0,0,0.24)" }}>
        <View style={{ paddingLeft: 12, paddingRight: 6, minHeight: 40, flexDirection: "row", alignItems: "center", borderBottomWidth: 1, borderColor: colors.border }}><Text style={{ flex: 1, color: colors.foreground, fontSize: 13, fontWeight: "600" }}>{t("checks")}</Text><Pressable accessibilityRole="button" accessibilityLabel={t("closeDetails")} onPress={close} style={{ width: 28, height: 28, alignItems: "center", justifyContent: "center" }}><Icon name="X" size={15} color={colors.foregroundMuted} /></Pressable></View>
        <ReviewChecks workspaceId={workspaceId} number={number} headSha={headSha} checks={checks} colors={colors} onFeedback={feedback} maxHeight={bodyHeight} />
      </View>
    </View> : null}
    <Modal open={open && compact} onOpenChange={(value) => { if (!value) close(); }} title={t("checks")}><Modal.Content scrollable={false} contentContainerStyle={{ padding: 0, gap: 0 }}><ReviewChecks workspaceId={workspaceId} number={number} headSha={headSha} checks={checks} colors={colors} onFeedback={feedback} compact /></Modal.Content></Modal>
  </View>;
}
