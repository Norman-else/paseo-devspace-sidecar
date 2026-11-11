import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

export const configDirectory = process.env.PASEO_DEVSPACE_SIDECAR_HOME ?? join(homedir(), ".config", "paseo-devspace-sidecar");
const schema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("local"), databasePath: z.string(), port: z.number().int().min(1024).max(65535), token: z.string().min(32) }),
  z.object({ mode: z.literal("remote"), endpoint: z.string().url(), token: z.string().min(32) }),
]);
export type Config = z.infer<typeof schema>;
export async function loadConfig(): Promise<Config> {
  await mkdir(configDirectory, { recursive: true, mode: 0o700 });
  const path = join(configDirectory, "config.json");
  try { return schema.parse(JSON.parse(await readFile(path, "utf8"))); }
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
