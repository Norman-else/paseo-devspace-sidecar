import test from "node:test";
import assert from "node:assert/strict";
import { codeTokens, syntaxPalette, type CodeToken } from "../shared/syntax.ts";

const kinds = (source: string, path = "a.ts") => {
  const tokens = codeTokens(source, path, { block: false });
  assert.equal(tokens.map((token) => token.text).join(""), source, "highlighting is lossless");
  const map = new Map<string, CodeToken["kind"]>();
  for (const token of tokens) for (const word of token.text.match(/[A-Za-z_$][\w$]*|\d+/g) ?? []) if (!map.has(word)) map.set(word, token.kind);
  return map;
};

test("identifiers get Antigravity-like classes: declarations, calls, builtins, constants, literals", () => {
  const fn = kinds("export function clampInt(value: unknown, min: number, fallback: number): number {");
  assert.equal(fn.get("export"), "keyword"); assert.equal(fn.get("function"), "keyword");
  assert.equal(fn.get("clampInt"), "function"); assert.equal(fn.get("unknown"), "builtin"); assert.equal(fn.get("number"), "builtin");
  assert.equal(fn.get("value"), "plain");
  const iface = kinds("export interface DerivedPalette {");
  assert.equal(iface.get("DerivedPalette"), "function", "declared names are highlighted");
  const constant = kinds('export const SIDECHAT_CONTEXT_OPEN = "<sidechat_context>";');
  assert.equal(constant.get("SIDECHAT_CONTEXT_OPEN"), "constant"); assert.equal(constant.get("sidechat_context"), "string");
  const calls = kinds("return Math.max(min, Math.min(max, Math.floor(num))) ?? NaN;");
  assert.equal(calls.get("Math"), "type", "type names in use stay plain-coloured"); assert.equal(calls.get("max"), "function"); assert.equal(calls.get("NaN"), "number");
  const record = kinds("const record = raw as Record<string, unknown>;");
  assert.equal(record.get("record"), "plain", "const is not a declaration keyword for naming"); assert.equal(record.get("Record"), "type");
  const py = kinds("def run(self, items: list[str]) -> None:", "a.py");
  assert.equal(py.get("run"), "function"); assert.equal(py.get("list"), "builtin"); assert.equal(py.get("str"), "builtin"); assert.equal(py.get("None"), "keyword");
  assert.equal(kinds("SELECT id FROM users", "q.sql").get("SELECT"), "keyword", "SQL keywords are not constants");
});

test("dark palette is Monokai and type names in use share the plain colour", () => {
  const dark = syntaxPalette(true, "#ffffff");
  assert.equal(dark.keyword, "#66d9ef"); assert.equal(dark.string, "#a6e22e"); assert.equal(dark.function, "#e6db74"); assert.equal(dark.constant, "#f92672"); assert.equal(dark.number, "#ae81ff");
  assert.equal(dark.type, dark.plain);
  const light = syntaxPalette(false, "#111111");
  assert.equal(light.plain, "#111111"); assert.notEqual(light.keyword, light.string);
});
