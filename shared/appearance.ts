export const DEFAULT_MONO_FONT = "SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace";
export const SELECTION_HANDLE_WIDTH = 24;
export type CodeAppearance = { fontFamily: string; fontSize: number; lineHeight: number; characterWidth: number; gutterFontSize: number; gutterCellWidth: number; markerWidth: number; gutterWidth: number };

/** Follow saved Paseo code preferences, keeping this review at a readable 14px minimum. */
export function codeAppearance(value: unknown, fallback = DEFAULT_MONO_FONT): CodeAppearance {
  const settings = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const family = typeof settings.monoFontFamily === "string" ? settings.monoFontFamily.trim() : "";
  const safeFamily = family.length <= 200 && !/[\x00-\x1f\x7f]/.test(family) && /^[\p{L}\p{N}\s,_.'"-]+$/u.test(family) && (family.match(/'/g)?.length ?? 0) % 2 === 0 && (family.match(/"/g)?.length ?? 0) % 2 === 0;
  const requested = typeof settings.codeFontSize === "number" || typeof settings.codeFontSize === "string" ? Number(settings.codeFontSize) : NaN;
  const fontSize = Number.isFinite(requested) ? Math.max(14, Math.min(22, Math.floor(requested))) : 14;
  const gutterFontSize = Math.max(11, fontSize - 2);
  const gutterCellWidth = Math.max(32, Math.ceil(gutterFontSize * 0.62 * 4) + 6);
  const markerWidth = Math.ceil(fontSize * 0.62) + 6;
  return { fontFamily: safeFamily && family ? family : fallback, fontSize, lineHeight: Math.round(fontSize * 1.5), characterWidth: fontSize * 0.62,
    gutterFontSize, gutterCellWidth, markerWidth, gutterWidth: 3 + SELECTION_HANDLE_WIDTH + gutterCellWidth * 2 + markerWidth };
}

function rgb(color: string): number[] | null {
  const hex = /^#([0-9a-f]{6})(?:[0-9a-f]{2})?$/i.exec(color);
  if (hex) return [0, 2, 4].map((index) => parseInt(hex[1].slice(index, index + 2), 16));
  const short = /^#([0-9a-f]{3})$/i.exec(color);
  if (short) return [...short[1]].map((char) => parseInt(char + char, 16));
  const match = /^rgba?\(\s*(\d+)[, ]+\s*(\d+)[, ]+\s*(\d+)/.exec(color);
  return match ? match.slice(1, 4).map(Number) : null;
}
/** Stronger theme-derived fills, opaque so nested surfaces cannot wash them out. */
export function diffBackground(tone: string, surface: string): string {
  const foreground = rgb(tone), background = rgb(surface);
  if (!foreground || !background) return surface;
  const dark = background[0] * 0.2126 + background[1] * 0.7152 + background[2] * 0.0722 < 128;
  const alpha = dark ? 0.35 : 0.2;
  const shade = dark ? 0.6 : 1;
  return "#" + foreground.map((channel, index) => Math.round(channel * shade * alpha + background[index] * (1 - alpha)).toString(16).padStart(2, "0")).join("");
}
