import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

// Exercise the production listener against browser capture/bubble behavior.
const source = readFileSync(new URL("../client/web.ts", import.meta.url), "utf8");
const tree = ts.createSourceFile("web.ts", source, ts.ScriptTarget.Latest, true);
const watcher = tree.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "watchChecksDismiss")!;
const compiled = ts.transpileModule(`module.exports = ${watcher.getText(tree).replace(/^export /, "")}`, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
type Event = { key?: string; target?: { closest(): { dataset: { devspaceChecksScope: string } } | null }; preventDefault?(): void; stopPropagation?(): void };
test("check popovers ignore internal focus changes and dismiss on outside actions or Escape", () => {
  const listeners: { name: string; listener(event: Event): void; capture: boolean }[] = [];
  const window = {
    addEventListener(name: string, listener: (event: Event) => void, capture: boolean) { listeners.push({ name, listener, capture }); },
    removeEventListener(name: string, listener: (event: Event) => void, capture: boolean) { const index = listeners.findIndex((entry) => entry.name === name && entry.listener === listener && entry.capture === capture); assert.notEqual(index, -1); listeners.splice(index, 1); },
  };
  const module = { exports: null as unknown as (scope: string, close: () => void) => () => void };
  new Function("Platform", "window", "module", compiled)({ OS: "web" }, window, module);
  let closed = 0;
  const cleanup = module.exports("current", () => closed++);
  const dispatch = (name: string, event: Event, descendant = true) => { for (const entry of listeners) if (entry.name === name && (!descendant || name !== "blur" || entry.capture)) entry.listener(event); };
  const inside = { target: { closest: () => ({ dataset: { devspaceChecksScope: "current" } }) } };
  dispatch("pointerdown", inside); dispatch("focusin", inside); dispatch("blur", inside);
  assert.equal(closed, 0, "selecting a check can remove its focused row without closing the popover");
  dispatch("pointerdown", { target: { closest: () => null } });
  dispatch("focusin", { target: { closest: () => ({ dataset: { devspaceChecksScope: "another-panel" } }) } });
  let prevented = false, stopped = false;
  dispatch("keydown", { key: "Escape", preventDefault: () => { prevented = true; }, stopPropagation: () => { stopped = true; } });
  assert.equal(closed, 3); assert.ok(prevented && stopped);
  dispatch("blur", {}, false);
  assert.equal(closed, 4, "leaving the app still dismisses the popover");
  cleanup(); assert.equal(listeners.length, 0);
});
