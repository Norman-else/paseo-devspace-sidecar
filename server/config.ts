import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

export const configDirectory = process.env.PASEO_DEVSPACE_SIDECAR_HOME ?? join(homedir(), ".config", "paseo-devspace-sidecar");
export const remoteSourceSchema = z.object({ name: z.string().min(1).max(120).optional(), endpoint: z.string().url(), token: z.string().min(32) });
export type RemoteSource = z.infer<typeof remoteSourceSchema>;
export const configSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("local"), databasePath: z.string(), port: z.number().int().min(1024).max(65535), token: z.string().min(32), devspaceEndpoint: z.string().url().optional(), sourceName: z.string().optional() }),
  remoteSourceSchema.extend({ mode: z.literal("remote"), additionalSources: z.array(remoteSourceSchema).max(8).default([]) }),
]);
export type Config = z.infer<typeof configSchema>;
export async function loadConfig(): Promise<Config> {
  await mkdir(configDirectory, { recursive: true, mode: 0o700 });
  const path = join(configDirectory, "config.json");
  try { return configSchema.parse(JSON.parse(await readFile(path, "utf8"))); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new Error("Invalid sidecar configuration. Check ~/.config/paseo-devspace-sidecar/config.json.");
  }
  const config: Config = {
    mode: "local", databasePath: join(homedir(), ".local", "share", "devspace", "devspace.sqlite"),
    port: 7677, token: randomBytes(32).toString("base64url"),
  };
  await writeFile(path, JSON.stringify(config, null, 2) + "\n", { mode: 0o600, flag: "wx" });
  return config;
}
