import test from "node:test";
import assert from "node:assert/strict";
import { findSvgIconProblem } from "@getpaseo/plugin";
import { fileIcon } from "../shared/file-icons.ts";

const label = (path: string) => { const icon = fileIcon(path); return icon.kind === "text" ? `${icon.text}:${icon.color}` : icon.kind === "lucide" ? `lucide:${icon.name}` : "svg"; };

test("file icons follow Antigravity's marks for common types", () => {
  assert.equal(label("src/app/main.ts"), "TS:#3b82f6");
  assert.equal(label("src/app/main.test.ts"), "TS:#f97316", "tests get the orange TS mark");
  assert.equal(label("web/App.tsx"), "lucide:Atom");
  assert.equal(label("lib/a.js").split(":")[0], "JS");
  assert.equal(label("config/settings.json").split(":")[0], "{ }");
  assert.equal(label("tsconfig.build.json").split(":")[0], "TS");
  assert.equal(label("package.json"), "lucide:Hexagon");
  assert.equal(label("docs/README.md").split(":")[0], "M↓");
  assert.equal(label(".github/workflows/ci.yml").split(":")[0], "Y");
  assert.equal(label("chat/devkit/client/__init__.py"), "svg");
  assert.equal(label(".gitignore"), "svg");
  assert.equal(label("Dockerfile"), "lucide:Container");
  assert.equal(label(".env.local"), "lucide:KeyRound");
  assert.equal(label("poetry.lock"), "lucide:Lock");
  assert.equal(label("bin/LICENSE"), "lucide:File", "unknown types fall back to a plain file");
});

test("the inline SVG marks pass Paseo's SVG validation", () => {
  for (const path of ["a.py", ".gitignore"]) {
    const icon = fileIcon(path);
    assert.equal(icon.kind, "svg");
    if (icon.kind === "svg") assert.equal(findSvgIconProblem(icon.svg), null, path);
  }
});
