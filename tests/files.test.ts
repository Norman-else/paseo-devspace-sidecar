import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listDirectory, readWorkspaceFile, writeWorkspaceFile } from "../server/files.ts";
import { chunkForUpload, FILE_EDIT_LIMIT } from "../shared/files.ts";

async function repo() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "sidecar-files-")));
  execFileSync("git", ["init", "-q", root]);
  await writeFile(join(root, ".gitignore"), "node_modules/\n*.log\n");
  await mkdir(join(root, "src")); await mkdir(join(root, "node_modules"));
  await writeFile(join(root, "src", "a.ts"), "export const a = 1;\n");
  await writeFile(join(root, "README.md"), "line one\r\nline two\r\n");
  await writeFile(join(root, "debug.log"), "x");
  await writeFile(join(root, "image.bin"), Buffer.from([1, 2, 0, 3]));
  return root;
}
const save = (root: string, path: string, text: string, expectedHash: string | null, force = false) => {
  const chunks = chunkForUpload(text, 64), uploadId = `up-${Math.random().toString(36).slice(2, 12)}`;
  return chunks.reduce<Promise<Awaited<ReturnType<typeof writeWorkspaceFile>>>>(async (previous, chunk, index) => { await previous; return writeWorkspaceFile(root, "ws_t", { path, expectedHash, force, uploadId, index, total: chunks.length, chunk }); }, Promise.resolve({ status: "partial", received: 0 }));
};

test("listing hides .git, sorts folders first and marks ignored entries", async () => {
  const root = await repo(); try {
    const list = await listDirectory(root, "");
    assert.deepEqual(list.entries.map((entry) => `${entry.type}:${entry.name}${entry.ignored ? "*" : ""}`), ["dir:node_modules*", "dir:src", "file:.gitignore", "file:debug.log*", "file:image.bin", "file:README.md"]);
    assert.deepEqual((await listDirectory(root, "src")).entries.map((entry) => entry.path), ["src/a.ts"]);
    await assert.rejects(listDirectory(root, "../"), /outside the workspace/);
    await assert.rejects(listDirectory(root, ".git"), /outside the workspace/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("reading reports text with its line endings, binary files and oversized files", async () => {
  const root = await repo(); try {
    const readme = await readWorkspaceFile(root, "README.md");
    assert.equal(readme.kind, "text"); assert.equal(readme.eol, "crlf"); assert.equal(readme.content, "line one\r\nline two\r\n"); assert.match(readme.hash!, /^[0-9a-f]{64}$/);
    assert.equal((await readWorkspaceFile(root, "image.bin")).kind, "binary");
    await writeFile(join(root, "big.txt"), "x".repeat(FILE_EDIT_LIMIT + 1));
    const big = await readWorkspaceFile(root, "big.txt"); assert.equal(big.kind, "too_large"); assert.equal(big.content, null);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("chunked saves write only when the file is unchanged, unless forced", async () => {
  const root = await repo(); try {
    const before = await readWorkspaceFile(root, "src/a.ts");
    const text = "export const a = 2; // 中文注释 " + "y".repeat(300) + "\n";
    const saved = await save(root, "src/a.ts", text, before.hash);
    assert.equal(saved.status, "saved"); assert.equal(await readFile(join(root, "src/a.ts"), "utf8"), text);
    // Someone else (the agent) changes the file; a save based on the old content is refused.
    await writeFile(join(root, "src/a.ts"), "agent edit\n");
    const conflict = await save(root, "src/a.ts", "mine\n", saved.status === "saved" ? saved.hash : null);
    assert.equal(conflict.status, "conflict"); assert.equal(await readFile(join(root, "src/a.ts"), "utf8"), "agent edit\n");
    assert.equal((await save(root, "src/a.ts", "mine\n", null, true)).status, "saved");
    assert.equal(await readFile(join(root, "src/a.ts"), "utf8"), "mine\n");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("chunks sent in parallel and out of order are assembled in index order", async () => {
  const root = await repo(); try {
    const before = await readWorkspaceFile(root, "src/a.ts");
    const text = Array.from({ length: 40 }, (_, line) => `line ${line} ${"z".repeat(20)}`).join("\n");
    const chunks = chunkForUpload(text, 64), uploadId = "parallel-upload";
    const results = await Promise.all([...chunks.keys()].reverse().map((index) => writeWorkspaceFile(root, "ws_t", { path: "src/a.ts", expectedHash: before.hash, force: false, uploadId, index, total: chunks.length, chunk: chunks[index] })));
    assert.equal(results.filter((result) => result.status === "saved").length, 1);
    assert.equal(await readFile(join(root, "src/a.ts"), "utf8"), text);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("saves refuse paths outside the workspace, inside .git, and through symlinks", async () => {
  const root = await repo(), outside = await mkdtemp(join(tmpdir(), "sidecar-outside-")); try {
    await symlink(outside, join(root, "escape"));
    await symlink(join(root, "src", "a.ts"), join(root, "link.ts"));
    await assert.rejects(save(root, "../x.txt", "no", null), /outside the workspace/);
    await assert.rejects(save(root, ".git/config", "no", null), /outside the workspace/);
    await assert.rejects(save(root, "escape/x.txt", "no", null), /outside the workspace/);
    await assert.rejects(save(root, "link.ts", "no", null, true), /Symbolic links/);
    await assert.rejects(readWorkspaceFile(root, "escape"), /outside the workspace|not a file/);
  } finally { await rm(root, { recursive: true, force: true }); await rm(outside, { recursive: true, force: true }); }
});

test("upload chunks stay under the byte limit and never split surrogate pairs", () => {
  const text = "a".repeat(100) + "😀".repeat(50) + "中".repeat(100);
  const chunks = chunkForUpload(text, 64);
  assert.equal(chunks.join(""), text);
  for (const chunk of chunks) { assert.ok(new TextEncoder().encode(JSON.stringify(chunk)).length <= 64); assert.doesNotMatch(chunk, /^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/); }
  assert.deepEqual(chunkForUpload(""), [""], "an empty file is one empty chunk");
});
