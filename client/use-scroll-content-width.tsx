import { useCallback, useState } from "react";
import { Platform, View, type LayoutChangeEvent } from "react-native";

// Native scroll indicators overlay content, so keep them off header actions. Web reserves a real gutter instead.
export const SCROLLBAR_CLEARANCE = Platform.OS === "web" ? 0 : 8;
export function useScrollContentWidth(viewportWidth: number) {
  const [measured, setMeasured] = useState<{ viewportWidth: number; width: number } | null>(null);
  const onLayout = useCallback((event: LayoutChangeEvent) => {
    const width = event.nativeEvent.layout.width;
    if (Number.isFinite(width) && width > 0) setMeasured((previous) => previous?.viewportWidth === viewportWidth && Math.abs(previous.width - width) < 0.5 ? previous : { viewportWidth, width });
  }, [viewportWidth]);
  const available = Math.max(1, viewportWidth - SCROLLBAR_CLEARANCE);
  return {
    width: measured?.viewportWidth === viewportWidth ? Math.min(available, measured.width) : available,
    // This stretches inside the scroll content, after its real scrollbar gutter and padding.
    // Zero height preserves all virtual row offsets and sticky-header transitions.
    sizer: <View testID="devspace-scroll-content-sizer" onLayout={onLayout} pointerEvents="none" accessible={false} style={{ alignSelf: "stretch", height: 0 }} />,
  };
}
