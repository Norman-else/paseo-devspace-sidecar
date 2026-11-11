import { useRef, useState } from "react";
import { Platform, View, type GestureResponderEvent, type ViewStyle } from "react-native";
import type { Colors } from "./review-ui";
import { useMessages } from "./messages";

export const DIVIDER_WIDTH = 8;
export function ResizeDivider({ width, min, max, colors, onResize, onCommit }: {
  width: number; min: number; max: number; colors: Colors; onResize(width: number): void; onCommit(width: number): void;
}) {
  const { t } = useMessages();
  const [hover, setHover] = useState(false);
  const [dragging, setDragging] = useState(false);
  const gesture = useRef<{ x: number; startWidth: number; width: number } | null>(null);
  const props = useRef({ min, max, onResize, onCommit });
  props.current = { min, max, onResize, onCommit };
  const move = (event: GestureResponderEvent) => {
    if (!gesture.current) return;
    const { x, startWidth } = gesture.current;
    const next = Math.round(Math.max(props.current.min, Math.min(props.current.max, startWidth - (event.nativeEvent.pageX - x))));
    gesture.current.width = next;
    props.current.onResize(next);
  };
  const finish = () => {
    const current = gesture.current;
    gesture.current = null;
    setDragging(false);
    if (current) props.current.onCommit(current.width);
  };
  return <View
    testID="devspace-file-index-divider"
    accessible accessibilityRole="adjustable" accessibilityLabel={t("resizeIndex")} accessibilityHint={t("resizeHint")}
    accessibilityValue={{ min, max, now: Math.round(width), text: t("pixels", { width: Math.round(width) }) }}
    accessibilityActions={[{ name: "increment", label: t("widenIndex") }, { name: "decrement", label: t("narrowIndex") }]}
    onAccessibilityAction={(event) => {
      const next = Math.max(min, Math.min(max, width + (event.nativeEvent.actionName === "increment" ? 20 : -20)));
      onResize(next); onCommit(next);
    }}
    onPointerEnter={() => setHover(true)} onPointerLeave={() => setHover(false)}
    onStartShouldSetResponder={() => true}
    onMoveShouldSetResponder={() => true}
    onResponderGrant={(event) => {
      event.preventDefault();
      gesture.current = { x: event.nativeEvent.pageX, startWidth: width, width };
      setDragging(true);
    }}
    onResponderMove={move} onResponderRelease={finish} onResponderTerminate={finish}
    onResponderTerminationRequest={() => false}
    style={[
      { width: DIVIDER_WIDTH, flexShrink: 0, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface0 },
      Platform.OS === "web" ? ({ cursor: "col-resize", userSelect: "none", touchAction: "none" } as unknown as ViewStyle) : null,
    ]}
  >
    <View pointerEvents="none" style={{ width: dragging || hover ? 2 : 1, height: "100%", backgroundColor: dragging || hover ? colors.accent : colors.border }} />
  </View>;
}
