import { Animated, Pressable, Text, View } from "react-native";
import type { Animated as NativeAnimated } from "react-native";
import type { Colors } from "./review-ui";
import { ToolButton } from "./review-ui";
import { useMessages } from "./messages";
export function FloatingSelectionActions({ colors, x, y, width, compact, onHeight, onExplain, onChange, onCopy, onClose }: { colors: Colors; x: NativeAnimated.Value; y: NativeAnimated.Value; width: number; compact: boolean; onHeight(height: number): void; onExplain(): void; onChange(): void; onCopy(): void; onClose(): void }) {
  const { t } = useMessages();
  return <Animated.View testID="devspace-selection-actions" onLayout={(event) => { const height = event.nativeEvent.layout.height; if (height > 0) onHeight(height); }} style={{ position: "absolute", top: 0, left: 0, width, zIndex: 2, transform: [{ translateX: x }, { translateY: y }], padding: 4, backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.border, borderRadius: 8, shadowColor: colors.surface0, shadowOpacity: 0.35, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 6 }}>
    <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 2 }}>
      <SelectionAction compact={compact} colors={colors} label={t("explainCode")} onPress={onExplain} />
      <SelectionAction compact={compact} colors={colors} label={t("requestChange")} onPress={onChange} />
      <ToolButton touch={compact} icon="Copy" label={t("copyCode")} colors={colors} onPress={onCopy} />
      <ToolButton touch={compact} icon="X" label={t("clearSelection")} colors={colors} onPress={onClose} />
    </View>
  </Animated.View>;
}
import { useState } from "react";
function SelectionAction({ compact, colors, label, onPress }: { compact: boolean; colors: Colors; label: string; onPress(): void }) {
  const [hover, setHover] = useState(false);
  return <Pressable accessibilityRole="button" onPress={onPress} onHoverIn={() => setHover(true)} onHoverOut={() => setHover(false)} style={({ pressed }) => ({ minHeight: compact ? 44 : 32, paddingHorizontal: 8, justifyContent: "center", borderRadius: 4, backgroundColor: hover || pressed ? colors.surface2 : "transparent" })}><Text style={{ fontSize: 12, fontWeight: "500", color: colors.foreground }}>{label}</Text></Pressable>;
}
