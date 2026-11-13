import { useCallback, useEffect, useId, useState, type ReactNode } from "react";
import { Platform, Pressable, Text, View, useWindowDimensions } from "react-native";
import { Icon, Modal, ScrollView } from "@getpaseo/plugin/client/ui";
import type { Colors } from "./review-ui";
import { popoverScopeProps, watchPopoverDismiss } from "./web";
export type ReviewMenuOption = { id: string; label: string; description?: string; icon?: string; selected?: boolean; checkbox?: boolean; disabled?: boolean; danger?: boolean; separatorBefore?: boolean; onSelect(): void };
export function ReviewMenu({ title, label, icon, options, colors, touch, width = 280, align = "left", trigger, footer }: { title: string; label?: string; icon?: string; options: ReviewMenuOption[]; colors: Colors; touch: boolean; width?: number; align?: "left" | "right"; trigger?(state: { open: boolean; toggle(): void }): ReactNode; footer?: ReactNode }) {
  const [open, setOpen] = useState(false), [hover, setHover] = useState(false), scope = useId();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const sheet = Platform.OS !== "web" || windowWidth < 560;
  const close = useCallback(() => setOpen(false), []);
  useEffect(() => { close(); }, [sheet, close]);
  useEffect(() => open && !sheet ? watchPopoverDismiss(scope, close) : undefined, [open, sheet, scope, close]);
  const choices = <View role={options.every((option) => option.selected !== undefined && !option.checkbox) ? "radiogroup" : "menu"} accessibilityLabel={title}>
    {options.map((option) => <MenuOption key={option.id} option={option} colors={colors} touch={sheet} onPress={() => { close(); option.onSelect(); }} />)}
  </View>;
  return <View {...popoverScopeProps(scope)} style={{ position: "relative", zIndex: 10, maxWidth: label ? 124 : undefined, flexShrink: label ? 1 : 0 }}>
    {trigger ? trigger({ open, toggle: () => setOpen(!open) }) : <Pressable accessibilityRole="button" accessibilityLabel={label ? `${title}: ${label}` : title} accessibilityState={{ expanded: open }} aria-expanded={open} onPress={() => setOpen(!open)} onHoverIn={() => setHover(true)} onHoverOut={() => setHover(false)}
      style={{ minHeight: touch ? 44 : 28, width: label ? undefined : touch ? 44 : 28, alignItems: "center", justifyContent: "center" }}>
      {({ pressed }) => <View style={{ minHeight: touch ? 32 : 28, width: label ? undefined : touch ? 32 : 28, maxWidth: "100%", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingHorizontal: label ? 8 : 0, borderRadius: 4, backgroundColor: hover || pressed || open ? colors.surface2 : label ? colors.surface1 : "transparent" }}>
        {label ? <><Text numberOfLines={1} style={{ flexShrink: 1, color: colors.foreground, fontSize: 12, lineHeight: 18, fontWeight: "500" }}>{label}</Text><Icon name="ChevronDown" size={13} color={colors.foregroundMuted} /></> : <Icon name={icon ?? "Ellipsis"} size={16} color={open ? colors.foreground : colors.foregroundMuted} />}
      </View>}
    </Pressable>}
    {open && !sheet ? <View role="dialog" accessibilityLabel={title} testID="devspace-review-menu" style={{ position: "absolute", top: "100%", ...(align === "right" ? { right: 0 } : { left: 0 }), width: Math.max(120, Math.min(width, windowWidth - 24)), paddingTop: 6, zIndex: 10 }}>
      <View style={{ padding: 4, backgroundColor: colors.surface0, borderWidth: 1, borderColor: colors.border, borderRadius: 6, boxShadow: "0 6px 20px rgba(0,0,0,0.22)", overflow: "hidden" }}><ScrollView style={{ maxHeight: Math.max(120, Math.min(360, windowHeight - 120)) }}>{choices}{footer}</ScrollView></View>
    </View> : null}
    <Modal title={title} open={open && sheet} onOpenChange={(value) => { if (!value) close(); }}><Modal.Content contentContainerStyle={{ padding: 8, gap: 0 }}>{choices}{footer}</Modal.Content></Modal>
  </View>;
}
function MenuOption({ option, colors, touch, onPress }: { option: ReviewMenuOption; colors: Colors; touch: boolean; onPress(): void }) {
  const [hover, setHover] = useState(false);
  return <View style={option.separatorBefore ? { borderTopWidth: 1, borderColor: colors.border, marginTop: 4, paddingTop: 4 } : undefined}><Pressable disabled={option.disabled} role={option.checkbox ? "checkbox" : option.selected === undefined ? "menuitem" : "radio"} accessibilityLabel={option.label} accessibilityHint={option.description} accessibilityState={{ ...(option.selected === undefined ? {} : { checked: option.selected }), disabled: !!option.disabled }} onPress={onPress} onHoverIn={() => setHover(true)} onHoverOut={() => setHover(false)}
    style={({ pressed }) => ({ minHeight: touch ? 44 : 32, padding: 8, borderRadius: 4, flexDirection: "row", alignItems: option.description ? "flex-start" : "center", gap: 8, opacity: option.disabled ? 0.5 : 1, backgroundColor: !option.disabled && (hover || pressed) ? colors.surface2 : "transparent" })}>
    <View style={{ width: 16, paddingTop: option.description ? 2 : 0 }}>{option.selected ? <Icon name="Check" size={16} color={option.danger ? colors.statusDanger : colors.accent} /> : option.icon ? <Icon name={option.icon} size={16} color={colors.foregroundMuted} /> : null}</View>
    <View style={{ flex: 1, minWidth: 0, gap: 3 }}><Text style={{ color: option.danger ? colors.statusDanger : colors.foreground, fontSize: 13, lineHeight: 18, fontWeight: option.selected ? "500" : "400" }}>{option.label}</Text>{option.description ? <Text style={{ color: colors.foregroundMuted, fontSize: 12, lineHeight: 18 }}>{option.description}</Text> : null}</View>
  </Pressable></View>;
}
