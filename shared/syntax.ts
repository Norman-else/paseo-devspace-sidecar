export type CodeToken = { text: string; kind: "plain" | "comment" | "string" | "keyword" | "number" | "type" | "function" | "constant" | "builtin" };
export type SyntaxPalette = Record<CodeToken["kind"], string>;
// Primitive and standard type names, coloured like Monokai's support types.
const builtins = new Set("string number boolean bigint symbol unknown any never object void int long short byte char double float bool str bytes dict list tuple frozenset complex rune error uint uintptr".split(" "));
const sizedBuiltin = /^(?:u?int(?:8|16|32|64)|float(?:32|64)|i(?:8|16|32|64|128)|u(?:8|16|32|64|128)|f(?:32|64))$/;
// The identifier after these is the name being declared (function, class, interface, type alias...).
const declarations = new Set("function class interface type enum def struct trait record fn func".split(" "));

/**
 * Monokai on dark surfaces (the palette Antigravity uses), GitHub Light on light ones. Only declarations and calls
 * are highlighted as names; type names used elsewhere stay plain so the line does not turn into confetti.
 */
export function syntaxPalette(dark: boolean, plain: string): SyntaxPalette {
  return dark
    ? { plain: "#f8f8f2", comment: "#8292a2", string: "#a6e22e", keyword: "#66d9ef", number: "#ae81ff", type: "#f8f8f2", function: "#e6db74", constant: "#f92672", builtin: "#a6e22e" }
    : { plain, comment: "#6e7781", string: "#0a3069", keyword: "#cf222e", number: "#0550ae", type: plain, function: "#8250df", constant: "#0550ae", builtin: "#953800" };
}
export type LexerState = { block: boolean };
const keywords = new Set("abstract as assert async await boolean break byte case catch char class const continue def default do double else enum export extends final finally float for from function if implements import in instanceof int interface let long native new null package private protected public return short static strictfp super switch synchronized this throw throws transient true false try typeof var void volatile while with yield null None True False self lambda raise pass elif except and or not is select from where join on insert update delete create table values set union group order by having limit distinct into left right inner outer begin end".split(" "));

/** Lightweight, lossless source highlighting. Unknown languages retain readable plain tokens. */
export function codeTokens(source: string, path: string, state: LexerState): CodeToken[] {
  const ext = path.split(".").at(-1)?.toLowerCase() ?? "";
  const supported = /^(java|gradle|groovy|kt|kts|js|jsx|ts|tsx|json|yml|yaml|py|sh|bash|sql|xml|html|css|scss|go|rs|c|cpp|h|toml|properties)$/.test(ext);
  if (!supported) return [{ text: source, kind: "plain" }];
  const hashComments = /^(py|sh|bash|yml|yaml|toml|properties)$/.test(ext);
  const sql = ext === "sql";
  const result: CodeToken[] = [];
  const push = (text: string, kind: CodeToken["kind"]) => {
    const last = result.at(-1);
    if (last?.kind === kind) last.text += text; else result.push({ text, kind });
  };
  let i = 0, declaring = false;
  if (!state.block && /^\s*\*(?:\s|\/|$)/.test(source)) { state.block = !source.includes("*/"); return [{ text: source, kind: "comment" }]; }
  while (i < source.length) {
    if (state.block) {
      const end = source.indexOf("*/", i);
      if (end < 0) { push(source.slice(i), "comment"); break; }
      push(source.slice(i, end + 2), "comment"); i = end + 2; state.block = false; continue;
    }
    if (source.startsWith("/*", i)) { state.block = true; continue; }
    if ((!hashComments && source.startsWith("//", i)) || (hashComments && source[i] === "#") || (sql && source.startsWith("--", i))) { push(source.slice(i), "comment"); break; }
    const char = source[i];
    if (char === '"' || char === "'" || char === "`") {
      let end = i + 1;
      while (end < source.length) { if (source[end] === "\\") { end += 2; continue; } if (source[end++] === char) break; }
      push(source.slice(i, end), "string"); i = end; continue;
    }
    const word = /^[a-zA-Z_$][\w$]*/.exec(source.slice(i));
    if (word) {
      const text = word[0], call = /^\s*\(/.test(source.slice(i + text.length));
      const kind: CodeToken["kind"] = declaring ? "function"
        : !sql && (builtins.has(text) || sizedBuiltin.test(text)) ? "builtin"
        : keywords.has(sql ? text.toLowerCase() : text) ? "keyword"
        : text === "NaN" || text === "Infinity" ? "number"
        : /^[A-Z][A-Z0-9_]+$/.test(text) ? "constant"
        : call ? "function"
        : /^[A-Z][A-Za-z0-9_$]*$/.test(text) ? "type" : "plain";
      declaring = !declaring && declarations.has(text);
      push(text, kind); i += text.length; continue;
    }
    const number = /^\b(?:0x[\da-f]+|\d+(?:\.\d+)?(?:[eE][+-]?\d+)?[fFdDlL]?)\b/i.exec(source.slice(i));
    if (number) { push(number[0], "number"); i += number[0].length; continue; }
    if (!/\s/.test(char)) declaring = false;
    push(char, "plain"); i++;
  }
  return result;
}
