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

test("scroll content measurement captures native width before its event is recycled", () => {
  const source = readFileSync(new URL("../client/use-scroll-content-width.tsx", import.meta.url), "utf8");
  const tree = ts.createSourceFile("use-scroll-content-width.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let callback = "";
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(tree) === "onLayout" && node.initializer && ts.isCallExpression(node.initializer)) callback = node.initializer.arguments[0].getText(tree);
    ts.forEachChild(node, visit);
  };
  visit(tree); assert.ok(callback);
  type Measurement = { viewportWidth: number; width: number } | null;
  const queued: ((previous: Measurement) => Measurement)[] = [];
  const module = { exports: null as unknown as (event: unknown) => void };
  const code = ts.transpileModule(`module.exports = ${callback}`, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
  new Function("viewportWidth", "setMeasured", "module", code)(882, (update: typeof queued[number]) => queued.push(update), module);
  const event: { nativeEvent: null | { layout: { width: number } } } = { nativeEvent: { layout: { width: 850 } } };
  module.exports(event); event.nativeEvent = null;
  assert.deepEqual(queued[0](null), { viewportWidth: 882, width: 850 });
  module.exports({ nativeEvent: { layout: { width: 0 } } });
  assert.equal(queued.length, 1, "a temporarily hidden list must not erase its last usable width");
});
