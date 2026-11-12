import { useCallback, useEffect, useRef, useState } from "react";
import { Animated, type NativeScrollEvent, type NativeSyntheticEvent } from "react-native";
import type { reviewRows } from "../shared/review";
import type { ReviewFile } from "../shared/diff";
import { stickyFileHeader } from "../shared/sticky-header";

/** Keep the pinned title mounted even when its original virtualized row is recycled. */
export function useStickyFileHeader(model: ReturnType<typeof reviewRows>, onActivePath: (path: string) => void) {
  const [file, setFile] = useState<ReviewFile | null>(null);
  const translateY = useRef(new Animated.Value(0)).current;
  const current = useRef({ model, onActivePath });
  current.current = { model, onActivePath };
  const offset = useRef(0);
  const pinned = useRef<ReviewFile | null>(null);
  const activePath = useRef("");
  const update = useCallback((y: number) => {
    offset.current = y;
    const next = stickyFileHeader(current.current.model, y);
    const path = next?.file.path ?? "";
    if (path !== activePath.current) {
      activePath.current = path;
      current.current.onActivePath(path);
    }
    const nextFile = next?.visible ? next.file : null;
    if (pinned.current !== nextFile) {
      pinned.current = nextFile;
      setFile(nextFile);
    }
    // Only the overlay moves each frame; the diff document rerenders on file changes.
    translateY.setValue(next?.translateY ?? 0);
  }, [translateY]);
  useEffect(() => update(offset.current), [model, update]);
  const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => update(event.nativeEvent.contentOffset.y), [update]);
  return { file, translateY, onScroll, scrollOffset: () => offset.current, reset: () => update(0) };
}
