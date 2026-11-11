import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

// Execute the production JSX handlers with deferred state updates, as React Native
// may do after recycling the layout event. Web synthetic events don't expose this.
const source = readFileSync(new URL("../client/diff-panel.tsx", import.meta.url), "utf8");
const tree = ts.createSourceFile("diff-panel.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const callbacks: string[] = [];
function visit(node: ts.Node) {
  if (ts.isJsxAttribute(node) && node.name.getText(tree) === "onLayout" && node.initializer && ts.isJsxExpression(node.initializer) && node.initializer.expression && ts.isArrowFunction(node.initializer.expression)) callbacks.push(node.initializer.expression.getText(tree));
  ts.forEachChild(node, visit);
}
visit(tree);
test("panel layout handlers retain dimensions after native events are recycled", () => {
  assert.equal(callbacks.length, 2);
  for (const callback of callbacks) {
    const queued: ((previous: { width: number; height: number }) => { width: number; height: number })[] = [];
    const setSize = (updater: typeof queued[number]) => queued.push(updater);
    const code = ts.transpileModule(`module.exports = ${callback}`, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
    const module = { exports: null as unknown as (event: unknown) => void };
    new Function("setSize", "view", "module", code)(setSize, "changes", module);
    const event: { nativeEvent: null | { layout: { width: number; height: number } } } = { nativeEvent: { layout: { width: 393, height: 492 } } };
    module.exports(event);
    event.nativeEvent = null;
    let state = { width: 700, height: 700 };
    assert.doesNotThrow(() => { for (const update of queued) state = update(state); });
    assert.ok(state.width === 393 || state.height === 492);
  }
});
