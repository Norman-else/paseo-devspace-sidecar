import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

/** Larger files can still be listed, but are not opened in the editor. */
export const FILE_EDIT_LIMIT = 1024 * 1024;
/**
 * Saves are split into chunks below this many UTF-8 bytes (JSON-encoded) so each request fits the DevSpace adapter's
 * body limit, including adapters still running the original 16KB limit. Chunks upload in parallel.
 */
export const FILE_CHUNK_BYTES = 12 * 1024;

const workspaceId = z.string().regex(/^ws_[a-zA-Z0-9_-]+$/);
const relativePath = z.string().max(4096);

export const fileEntrySchema = z.object({ name: z.string(), path: z.string(), type: z.enum(["dir", "file", "symlink"]), ignored: z.boolean() });
export type FileEntry = z.infer<typeof fileEntrySchema>;
export const fileListSchema = z.object({ path: z.string(), entries: z.array(fileEntrySchema), truncated: z.boolean() });

export const fileReadSchema = z.object({
  path: z.string(), size: z.number(), mtimeMs: z.number(),
  kind: z.enum(["text", "binary", "too_large"]), hash: z.string().nullable(), content: z.string().nullable(), eol: z.enum(["lf", "crlf"]),
});
export type FileRead = z.infer<typeof fileReadSchema>;

export const fileWriteRequestSchema = z.object({
  path: relativePath, expectedHash: z.string().nullable(), force: z.boolean().default(false),
  uploadId: z.string().regex(/^[\w-]{8,64}$/), index: z.number().int().min(0), total: z.number().int().min(1).max(64), chunk: z.string(),
});
export type FileWriteRequest = z.infer<typeof fileWriteRequestSchema>;
export const fileWriteResultSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("partial"), received: z.number().int() }),
  z.object({ status: z.literal("saved"), hash: z.string(), size: z.number(), mtimeMs: z.number() }),
  z.object({ status: z.literal("conflict"), hash: z.string().nullable() }),
]);
export type FileWriteResult = z.infer<typeof fileWriteResultSchema>;

export const filesListRpc = defineRpc({ name: "files.list", input: z.object({ workspaceId, path: relativePath }), output: fileListSchema });
export const fileReadRpc = defineRpc({ name: "files.read", input: z.object({ workspaceId, path: relativePath }), output: fileReadSchema });
export const fileWriteRpc = defineRpc({ name: "files.write", input: fileWriteRequestSchema.extend({ workspaceId }), output: fileWriteResultSchema });

/** Split text into pieces whose JSON-encoded UTF-8 size stays under the request limit. */
export function chunkForUpload(text: string, maxBytes = FILE_CHUNK_BYTES): string[] {
  const encoder = new TextEncoder(), chunks: string[] = [];
  let start = 0;
  while (start < text.length || !chunks.length) {
    let size = Math.min(text.length - start, maxBytes);
    let piece = text.slice(start, start + size);
    while (size > 1 && encoder.encode(JSON.stringify(piece)).length > maxBytes) { size = Math.floor(size / 2); piece = text.slice(start, start + size); }
    // Never split a surrogate pair across two requests.
    if (size > 1 && /[\uD800-\uDBFF]$/.test(piece)) { size -= 1; piece = text.slice(start, start + size); }
    chunks.push(piece); start += size;
    if (start >= text.length) break;
  }
  return chunks;
}
