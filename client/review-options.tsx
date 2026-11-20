import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Spinner } from "./spinner";
import { Modal } from "@getpaseo/plugin/client/ui";
import type { Colors } from "./review-ui";
import { useMessages } from "./messages";
import type { Checkpoint } from "../shared/review-details";
type Filter = "all" | "unreviewed" | "since";
export function ReviewOptions({ open, onClose, filter, onFilter, point, busy, onSave, colors, scopeLabel, prComparison }: { open: boolean; onClose(): void; filter: Filter; onFilter(value: Filter): void; point?: Checkpoint; busy: boolean; onSave(): void; colors: Colors; scopeLabel: string; prComparison: boolean }) {
  const { t, locale } = useMessages();
  const selected = filter === "since" && !point ? "all" : filter;
  return <Modal open={open} onOpenChange={(open) => { if (!open) onClose(); }} title={t("reviewOptions")}><Modal.Content contentContainerStyle={{ padding: 16, gap: 16 }}>
    <View style={{ gap: 4 }}><Text style={{ color: colors.foregroundMuted, fontSize: 11 }}>{t("filterScope")}</Text><Text style={{ color: colors.foreground, fontSize: 13, lineHeight: 19 }}>{scopeLabel}</Text></View>
    <View accessibilityRole="radiogroup" accessibilityLabel={t("reviewOptions")} style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 8, overflow: "hidden" }}>
      {(["all", "unreviewed", "since"] as const).map((value, index) => <FilterChoice key={value} title={t(({ all: "allFiles", unreviewed: "unreviewedFiles", since: "sinceReview" } as const)[value])}
        description={value === "all" ? t("allFilesDescription") : value === "unreviewed" ? t("unreviewedDescription") : t(point ? "sinceBaselineDescription" : "noReviewPoint")}
        selected={selected === value} disabled={busy || value === "since" && !point} separated={index > 0} colors={colors} onPress={() => { onFilter(value); onClose(); }} />)}
    </View>
    <View style={{ borderTopWidth: 1, borderColor: colors.border, paddingTop: 16, gap: 10 }}>
      <Text style={{ color: colors.foreground, fontSize: 13, fontWeight: "500" }}>{t("baselineTitle")}</Text>
      <Text style={{ color: colors.foregroundMuted, fontSize: 12, lineHeight: 18 }}>{t("baselineUsage")}</Text>
      <View style={{ gap: 4 }}>
        <Text style={{ color: colors.foreground, fontSize: 12, lineHeight: 18 }}>{point ? t("baselineSavedAt", { time: new Date(point.createdAt).toLocaleString(locale) }) : t("baselineNotSaved")}</Text>
        <Text style={{ color: colors.foregroundMuted, fontSize: 11, lineHeight: 16 }}>{t(prComparison ? "baselinePrHint" : "baselineScopeHint")}</Text>
        {point?.omitted ? <Text style={{ color: colors.statusWarning, fontSize: 12, lineHeight: 18 }}>{t("pointOmitted", { count: point.omitted })}</Text> : null}
      </View>
      <SaveBaselineButton busy={busy} colors={colors} label={t(busy ? "savingReviewBaseline" : point ? "updateReviewBaseline" : "saveReviewPoint")} onPress={onSave} />
      {point ? <Text style={{ color: colors.foregroundMuted, fontSize: 11, lineHeight: 16 }}>{t("updatingBaselineHint")}</Text> : null}
    </View>
  </Modal.Content></Modal>;
}
function FilterChoice({ title, description, selected, disabled, separated, colors, onPress }: { title: string; description: string; selected: boolean; disabled: boolean; separated: boolean; colors: Colors; onPress(): void }) {
  const [hover, setHover] = useState(false);
  return <Pressable accessibilityRole="radio" accessibilityLabel={title} accessibilityHint={description} accessibilityState={{ checked: selected, disabled }} disabled={disabled} onPress={onPress} onHoverIn={() => setHover(true)} onHoverOut={() => setHover(false)}
    style={({ pressed }) => ({ minHeight: 64, padding: 12, flexDirection: "row", alignItems: "flex-start", gap: 12, borderTopWidth: separated ? 1 : 0, borderColor: colors.border, backgroundColor: selected || !disabled && (hover || pressed) ? colors.surface2 : colors.surface0 })}>
    <View style={{ width: 18, height: 18, marginTop: 1, borderRadius: 9, borderWidth: 1, borderColor: selected ? colors.accent : disabled ? colors.border : colors.foregroundMuted, alignItems: "center", justifyContent: "center" }}>{selected ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.accent }} /> : null}</View>
    <View style={{ flex: 1, minWidth: 0, gap: 4 }}><Text style={{ color: disabled ? colors.foregroundMuted : colors.foreground, fontSize: 14, lineHeight: 20, fontWeight: selected ? "500" : "400" }}>{title}</Text><Text style={{ color: colors.foregroundMuted, fontSize: 12, lineHeight: 18 }}>{description}</Text></View>
  </Pressable>;
}
function SaveBaselineButton({ busy, colors, label, onPress }: { busy: boolean; colors: Colors; label: string; onPress(): void }) {
  const [hover, setHover] = useState(false);
  return <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={busy} onPress={onPress} onHoverIn={() => setHover(true)} onHoverOut={() => setHover(false)}
    style={({ pressed }) => ({ minHeight: 44, paddingHorizontal: 12, paddingVertical: 10, flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 8, borderWidth: 1, borderColor: hover || pressed ? colors.foregroundMuted : colors.border, borderRadius: 6, backgroundColor: colors.surface2, opacity: busy || pressed ? 0.65 : 1 })}>
    {busy ? <Spinner size={14} color={colors.foregroundMuted} /> : null}<Text style={{ color: colors.foreground, fontSize: 13, lineHeight: 18, fontWeight: "500", flexShrink: 1, textAlign: "center" }}>{label}</Text>
  </Pressable>;
}
