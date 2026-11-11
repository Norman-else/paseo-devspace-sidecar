import { useCallback, useEffect, useRef, useState } from "react";

/** Keep virtual scroll offsets aligned with the actual heights of wrapped code. */
export function useRowMeasurements(width: number) {
  const [measured, setMeasured] = useState({ width, rows: new Map<string, number>() });
  const current = useRef(measured);
  current.current = measured;
  const currentWidth = useRef(width);
  currentWidth.current = width;
  const pending = useRef(new Map<string, number>());
  const pendingWidth = useRef(width);
  const frame = useRef<number | null>(null);
  const report = useCallback((key: string, height: number, measuredWidth: number) => {
    if (measuredWidth !== currentWidth.current || !Number.isFinite(height) || height <= 0) return;
    const previous = current.current.width === measuredWidth ? current.current.rows.get(key) : undefined;
    if (previous !== undefined && Math.abs(previous - height) < 0.5) return;
    if (pendingWidth.current !== measuredWidth) pending.current.clear();
    pendingWidth.current = measuredWidth;
    pending.current.set(key, height);
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      const width = pendingWidth.current;
      const batch = new Map(pending.current);
      pending.current.clear();
      if (currentWidth.current !== width) return;
      setMeasured((previous) => {
        const rows = new Map(previous.width === width ? previous.rows : []);
        for (const [key, height] of batch) rows.set(key, height);
        return { width, rows };
      });
    });
  }, []);
  useEffect(() => () => { if (frame.current !== null) cancelAnimationFrame(frame.current); }, []);
  return { heights: measured.width === width ? measured.rows : undefined, report };
}
