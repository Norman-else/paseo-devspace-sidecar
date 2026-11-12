import { Platform } from "react-native";
import { codeAppearance, type CodeAppearance } from "../shared/appearance";

// Paseo 0.15.x exposes only colors through PluginTheme. Keep its read-only web
// appearance-storage adapter isolated here until the public SDK exposes typography.
declare const window: {
  localStorage: { getItem(key: string): string | null };
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
  getSelection(): { isCollapsed: boolean; toString(): string; anchorNode: SelectionNode | null; focusNode: SelectionNode | null; removeAllRanges(): void } | null;
};
type SelectionNode = { nodeType: number; parentElement: SelectionElement | null };
type SelectionElement = SelectionNode & { closest(selector: string): SelectionElement | null; dataset: Record<string, string | undefined> };
declare const document: { documentElement: object };
declare const MutationObserver: new (callback: () => void) => { observe(target: object, options: { attributes: boolean; attributeFilter: string[] }): void; disconnect(): void };

export const codeScopeProps = Platform.OS === "web" ? { dataSet: { pmono: "true" } } : {};
export function readCodeAppearance(fallback: string): CodeAppearance {
  if (Platform.OS !== "web" || typeof window === "undefined") return codeAppearance(null, fallback);
  try {
    const raw = window.localStorage.getItem("@paseo:app-settings") ?? window.localStorage.getItem("@paseo:settings");
    return codeAppearance(raw ? JSON.parse(raw) : null, fallback);
  } catch { return codeAppearance(null, fallback); }
}
export function watchCodeAppearance(fallback: string, changed: (value: CodeAppearance) => void): () => void {
  if (Platform.OS !== "web" || typeof window === "undefined") return () => {};
  let previous = readCodeAppearance(fallback);
  const refresh = () => {
    const next = readCodeAppearance(fallback);
    if (next.fontFamily === previous.fontFamily && next.fontSize === previous.fontSize) return;
    previous = next; changed(next);
  };
  window.addEventListener("storage", refresh);
  window.addEventListener("focus", refresh);
  // Same-window AsyncStorage writes do not fire a storage event. Appearance updates
  // normally change the root style; a small read-only poll covers write timing too.
  const observer = typeof MutationObserver === "undefined" ? null : new MutationObserver(refresh);
  if (typeof document !== "undefined") observer?.observe(document.documentElement, { attributes: true, attributeFilter: ["style", "class"] });
  const poll = setInterval(refresh, 750);
  return () => { clearInterval(poll); observer?.disconnect(); window.removeEventListener("storage", refresh); window.removeEventListener("focus", refresh); };
}

/** Desktop/browser text selection maps to the same line range used by native gutter taps. */
export function codeSelectionProps(scope: string, path: string, old?: number, next?: number) {
  return Platform.OS === "web" ? { dataSet: { pmono: "", reviewScope: scope, reviewPath: path, reviewOld: old === undefined ? "" : String(old), reviewNew: next === undefined ? "" : String(next) } } : codeScopeProps;
}
export function watchCodeSelection(scope: string, selected: (selection: import("../shared/selection").LineSelection) => void) {
  if (Platform.OS !== "web" || typeof window === "undefined") return () => {};
  const read = () => {
    const range = window.getSelection();
    if (!range || range.isCollapsed || !range.toString().trim()) return;
    const row = (node: SelectionNode | null) => (node?.nodeType === 1 ? node as SelectionElement : node?.parentElement)?.closest("[data-review-scope]");
    const start = row(range.anchorNode), end = row(range.focusNode);
    if (!start || !end || start.dataset.reviewScope !== scope || end.dataset.reviewScope !== scope || start.dataset.reviewPath !== end.dataset.reviewPath) return;
    const side = start.dataset.reviewNew && end.dataset.reviewNew ? "new" : start.dataset.reviewOld && end.dataset.reviewOld ? "old" : null;
    if (!side) return;
    selected({ path: start.dataset.reviewPath!, side, start: Number(side === "new" ? start.dataset.reviewNew : start.dataset.reviewOld), end: Number(side === "new" ? end.dataset.reviewNew : end.dataset.reviewOld) });
  };
  window.addEventListener("mouseup", read);
  return () => window.removeEventListener("mouseup", read);
}

export function clearNativeCodeSelection() {
  if (Platform.OS === "web" && typeof window !== "undefined") window.getSelection()?.removeAllRanges();
}

export function watchSelectionCancellation(cancel: () => void) {
  if (Platform.OS !== "web" || typeof window === "undefined") return () => {};
  window.addEventListener("blur", cancel);
  return () => window.removeEventListener("blur", cancel);
}
