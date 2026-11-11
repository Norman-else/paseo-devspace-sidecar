export type CodeToken = { text: string; kind: "plain" | "comment" | "string" | "keyword" | "number" | "type" | "function" };
export type LexerState = { block: boolean };
const keywords = new Set("abstract as assert async await boolean break byte case catch char class const continue def default do double else enum export extends final finally float for from function if implements import in instanceof int interface let long native new null package private protected public record return short static strictfp super switch synchronized this throw throws transient true false try typeof var void volatile while with yield null None True False self lambda raise pass elif except and or not is select from where join on insert update delete create table values set union group order by having limit distinct into left right inner outer begin end".split(" "));

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
  let i = 0;
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
      const text = word[0];
      const kind = keywords.has(sql ? text.toLowerCase() : text) ? "keyword" : /^[A-Z][A-Za-z0-9_$]*$/.test(text) ? "type" : /^\s*\(/.test(source.slice(i + text.length)) ? "function" : "plain";
      push(text, kind); i += text.length; continue;
    }
    const number = /^\b(?:0x[\da-f]+|\d+(?:\.\d+)?(?:[eE][+-]?\d+)?[fFdDlL]?)\b/i.exec(source.slice(i));
    if (number) { push(number[0], "number"); i += number[0].length; continue; }
    push(char, "plain"); i++;
  }
  return result;
}
