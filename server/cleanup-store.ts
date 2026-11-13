import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
export function readPrivate<T>(path: string, fallback: T): T { return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) as T : fallback; }
export function writePrivate(path: string, value: unknown) { mkdirSync(dirname(path), { recursive: true, mode: 0o700 }); const tmp = `${path}.${randomUUID()}.tmp`; writeFileSync(tmp, JSON.stringify(value), { mode: 0o600 }); renameSync(tmp, path); }
