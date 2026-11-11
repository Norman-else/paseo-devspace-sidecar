import { posix, win32 } from "node:path";

function windowsPath(value: string) {
  const plain = value.replace(/^\\\\\?\\UNC\\/i, "\\\\").replace(/^\\\\\?\\/, "");
  return win32.resolve(plain).replace(/\\+$/, "").toLowerCase();
}
export function samePath(left: string, right: string, platform: NodeJS.Platform = process.platform) {
  return platform === "win32" ? windowsPath(left) === windowsPath(right) : posix.resolve(left) === posix.resolve(right);
}
export function isWithin(root: string, path: string, platform: NodeJS.Platform = process.platform) {
  const api = platform === "win32" ? win32 : posix;
  const relative = api.relative(root, path);
  return relative !== ".." && !relative.startsWith(".." + api.sep) && !api.isAbsolute(relative);
}
export function isRelativeFile(path: string) {
  return !!path && !path.includes("\0") && !posix.isAbsolute(path) && !win32.isAbsolute(path)
    && !/^[a-zA-Z]:/.test(path) && !path.split(/[\\/]/).includes("..");
}
