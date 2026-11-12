import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from "react";
import { Animated, type FlatList, type View } from "react-native";
import type { ReviewRow, reviewRows } from "../shared/review";
import type { LineSelection } from "../shared/selection";
import { floatingSelectionPosition, selectedSpan, selectionLineAt } from "../shared/selection-layout";
import { clearNativeCodeSelection, watchSelectionCancellation } from "./web";

type Props = { model: ReturnType<typeof reviewRows>; width: number; height: number; gutterWidth: number; scope: string; list: RefObject<FlatList<ReviewRow> | null> };
export function useCodeSelection(props: Props) {
  const [selection, setValue] = useState<LineSelection | null>(null), [dragging, setDragging] = useState(false), [visible, setVisible] = useState(false), [toolbarHeight, setToolbarHeight] = useState(44);
  const viewport = useRef<View>(null), bounds = useRef({ x: 0, y: 0 });
  const offset = useRef(0), frame = useRef<number | null>(null), live = useRef(true), measuring = useRef(0);
  const drag = useRef<{ path: string; side: "old" | "new"; start: number; end: number; pageY: number } | null>(null);
  const span = useMemo(() => selectedSpan(props.model, selection), [props.model, selection]);
  const latest = useRef({ props, span, toolbarHeight }); latest.current = { props, span, toolbarHeight };
  const shown = useRef(false), x = useRef(new Animated.Value(8)).current, y = useRef(new Animated.Value(0)).current;
  const position = useCallback(() => {
    const { props, span, toolbarHeight } = latest.current;
    const point = !drag.current && floatingSelectionPosition(span, offset.current, props.width, props.height, props.gutterWidth, toolbarHeight);
    const next = !!point;
    if (shown.current !== next) { shown.current = next; setVisible(next); }
    if (point) { x.setValue(point.left); y.setValue(point.top); }
  }, [x, y]);
  const measureViewport = useCallback(() => {
    const sequence = ++measuring.current;
    viewport.current?.measureInWindow((left, top, width, height) => {
      if (!live.current || sequence !== measuring.current || width <= 0 || height <= 0) return;
      bounds.current = { x: left, y: top };
    });
  }, []);
  const extend = useCallback((pageY: number) => {
    const current = drag.current;
    if (!current || !Number.isFinite(pageY)) return;
    current.pageY = pageY;
    const line = selectionLineAt(latest.current.props.model, offset.current + pageY - bounds.current.y, current.path, current.side);
    if (line === null || line === current.end) return;
    current.end = line;
    setValue({ path: current.path, side: current.side, start: current.start, end: line });
  }, []);
  const autoScroll = useCallback(function tick() {
    frame.current = null;
    const current = drag.current;
    if (!current) return;
    const { props } = latest.current, localY = current.pageY - bounds.current.y;
    const velocity = localY < 68 ? -Math.min(20, Math.max(0, (68 - localY) / 3)) : localY > props.height - 36 ? Math.min(20, (localY - props.height + 36) / 3) : 0;
    if (velocity) {
      const next = Math.max(0, Math.min(Math.max(0, props.model.height - props.height), offset.current + velocity));
      if (next !== offset.current) { offset.current = next; props.list.current?.scrollToOffset({ offset: next, animated: false }); extend(current.pageY); }
    }
    frame.current = requestAnimationFrame(tick);
  }, [extend]);
  const end = useCallback(() => {
    drag.current = null;
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null; setDragging(false); position();
  }, [position]);
  const start = useCallback((path: string, side: "old" | "new", line: number, pageY: number) => {
    clearNativeCodeSelection(); measureViewport();
    drag.current = { path, side, start: line, end: line, pageY: Number.isFinite(pageY) ? pageY : bounds.current.y + latest.current.props.height / 2 };
    setValue({ path, side, start: line, end: line }); setDragging(true);
    shown.current = false; setVisible(false);
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(autoScroll);
  }, [autoScroll, measureViewport]);
  const setSelection: Dispatch<SetStateAction<LineSelection | null>> = useCallback((value) => { if (drag.current) end(); setValue(value); }, [end]);
  const onScroll = useCallback((scrollY: number) => { if (!Number.isFinite(scrollY)) return; offset.current = Math.max(0, scrollY); if (drag.current) extend(drag.current.pageY); position(); }, [extend, position]);
  useEffect(position, [span, props.width, props.height, toolbarHeight, position]);
  useEffect(measureViewport, [props.width, props.height, props.scope, measureViewport]);
  useEffect(() => watchSelectionCancellation(end), [end]);
  useEffect(() => { end(); setValue(null); }, [props.scope, end]);
  useEffect(() => { live.current = true; return () => { live.current = false; if (frame.current !== null) cancelAnimationFrame(frame.current); }; }, []);
  return { selection, setSelection, dragging, visible, viewport, measureViewport, onScroll, start, move: extend, end, x, y, width: Math.min(320, props.width - 16), measureToolbar: (height: number) => setToolbarHeight((previous) => Math.abs(previous - height) < 0.5 ? previous : height) };
}
