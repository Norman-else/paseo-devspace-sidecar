import { Platform } from "react-native";
import { codeAppearance, type CodeAppearance } from "../shared/appearance";

// Paseo 0.15.x exposes only colors through PluginTheme. Keep its read-only web
// appearance-storage adapter isolated here until the public SDK exposes typography.
declare const window: {
  localStorage: { getItem(key: string): string | null };
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
};
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
