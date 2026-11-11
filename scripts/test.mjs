import { readdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const tests = await readdir(new URL("../tests/", import.meta.url));
const files = tests.filter((name) => name.endsWith(".test.ts")).sort().map((name) => fileURLToPath(new URL(`../tests/${name}`, import.meta.url)));
const child = spawn(process.execPath, ["--import", "tsx", "--test", ...files], { stdio: "inherit" });
child.once("error", (error) => { console.error(error.message); process.exitCode = 1; });
child.once("exit", (code) => { process.exitCode = code ?? 1; });
