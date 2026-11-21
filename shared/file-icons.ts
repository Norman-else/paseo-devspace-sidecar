/**
 * File-type icons for the diff headers and file index, modelled on Antigravity's file icons: short coloured
 * glyphs (TS, JS, { }, M↓, Y), brand marks for Python and Git, and tinted Lucide icons for everything else.
 */
export type FileIcon =
  | { kind: "text"; text: string; color: string; scale?: number }
  | { kind: "svg"; svg: string }
  | { kind: "lucide"; name: string; color: string | null }; // null: the theme's muted colour

const PYTHON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path fill="#3b82f6" d="M7.9 1C5 1 5.2 2.3 5.2 2.3v1.3H8V4H3.9S2 3.8 2 6.8s1.6 2.9 1.6 2.9h1V8.3s-.1-1.6 1.6-1.6h2.8s1.5 0 1.5-1.5V2.6S10.7 1 7.9 1zM6.3 1.9a.5.5 0 1 1 0 1 .5.5 0 0 1 0-1z"/><path fill="#facc15" d="M8.1 15c2.9 0 2.7-1.3 2.7-1.3v-1.3H8v-.4h4.1s1.9.2 1.9-2.8-1.6-2.9-1.6-2.9h-1v1.4s.1 1.6-1.6 1.6H7s-1.5 0-1.5 1.5v2.6S5.3 15 8.1 15zm1.6-.9a.5.5 0 1 1 0-1 .5.5 0 0 1 0 1z"/></svg>';
const GIT = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path fill="#f05133" d="M15.7 7.3 8.7.3a1 1 0 0 0-1.4 0L5.8 1.8l1.8 1.8a1.2 1.2 0 0 1 1.5 1.5l1.8 1.8a1.2 1.2 0 1 1-.7.7L8.5 5.9v4.4a1.2 1.2 0 1 1-1-.1V5.8a1.2 1.2 0 0 1-.6-1.6L5.1 2.4.3 7.3a1 1 0 0 0 0 1.4l7 7a1 1 0 0 0 1.4 0l7-7a1 1 0 0 0 0-1.4z"/></svg>';

const text = (value: string, color: string, scale?: number): FileIcon => ({ kind: "text", text: value, color, ...(scale ? { scale } : {}) });
const lucide = (name: string, color: string | null = null): FileIcon => ({ kind: "lucide", name, color });

const BLUE = "#3b82f6", AMBER = "#f59e0b", ORANGE = "#f97316", PURPLE = "#a78bfa", SKY = "#60a5fa", TEAL = "#2dd4bf", GREEN = "#4ade80", CYAN = "#22d3ee", GREY = "#9ca3af";

const byExtension: Record<string, FileIcon> = {
  ts: text("TS", BLUE), mts: text("TS", BLUE), cts: text("TS", BLUE),
  tsx: lucide("Atom", BLUE), jsx: lucide("Atom", CYAN),
  js: text("JS", AMBER), mjs: text("JS", AMBER), cjs: text("JS", AMBER),
  json: text("{ }", AMBER, 0.92), jsonc: text("{ }", AMBER, 0.92), json5: text("{ }", AMBER, 0.92),
  md: text("M↓", SKY, 0.9), mdx: text("M↓", SKY, 0.9),
  yml: text("Y", PURPLE), yaml: text("Y", PURPLE),
  py: { kind: "svg", svg: PYTHON }, pyi: { kind: "svg", svg: PYTHON }, ipynb: { kind: "svg", svg: PYTHON },
  go: text("GO", CYAN, 0.86), rs: text("RS", ORANGE, 0.86), kt: text("K", PURPLE), kts: text("K", PURPLE), java: lucide("Coffee", ORANGE), gradle: lucide("Coffee", GREEN),
  c: text("C", BLUE), h: text("H", PURPLE), cpp: text("C+", BLUE, 0.86), hpp: text("H+", PURPLE, 0.86), cs: text("C#", PURPLE, 0.86), rb: lucide("Gem", "#ef4444"), php: text("php", PURPLE, 0.72), swift: lucide("Bird", ORANGE),
  html: lucide("Code", ORANGE), htm: lucide("Code", ORANGE), xml: lucide("Code", ORANGE), vue: text("V", GREEN), svelte: text("S", ORANGE),
  css: text("#", SKY), scss: text("#", "#f472b6"), sass: text("#", "#f472b6"), less: text("#", BLUE),
  sh: lucide("Terminal", GREEN), bash: lucide("Terminal", GREEN), zsh: lucide("Terminal", GREEN), fish: lucide("Terminal", GREEN), ps1: lucide("Terminal", SKY),
  sql: lucide("Database", AMBER), prisma: lucide("Database", TEAL), graphql: lucide("Share2", "#e535ab"), gql: lucide("Share2", "#e535ab"), proto: lucide("Braces", TEAL),
  toml: lucide("Settings", GREY), ini: lucide("Settings", GREY), cfg: lucide("Settings", GREY), conf: lucide("Settings", GREY), properties: lucide("Settings", GREY),
  lock: lucide("Lock", GREY), env: lucide("KeyRound", "#eab308"),
  png: lucide("Image", PURPLE), jpg: lucide("Image", PURPLE), jpeg: lucide("Image", PURPLE), gif: lucide("Image", PURPLE), webp: lucide("Image", PURPLE), ico: lucide("Image", PURPLE), svg: lucide("Image", AMBER),
  csv: lucide("Sheet", GREEN), tsv: lucide("Sheet", GREEN), txt: lucide("FileText"), log: lucide("FileText"), pdf: lucide("FileText", "#ef4444"),
  tf: lucide("Boxes", PURPLE), hcl: lucide("Boxes", PURPLE),
};

export function fileIcon(path: string): FileIcon {
  const name = (path.split("/").at(-1) ?? path).toLowerCase();
  if (name === ".gitignore" || name === ".gitattributes" || name === ".gitmodules" || name === ".gitkeep") return { kind: "svg", svg: GIT };
  if (name === "package.json" || name === "package-lock.json") return lucide("Hexagon", TEAL);
  if (/^tsconfig.*\.json$/.test(name)) return text("TS", BLUE);
  if (name === "dockerfile" || name.startsWith("dockerfile.") || name.endsWith(".dockerfile") || /^docker-compose.*\.ya?ml$/.test(name)) return lucide("Container", BLUE);
  if (name === "makefile" || name === "justfile") return lucide("Hammer", GREY);
  if (name === ".env" || name.startsWith(".env.")) return lucide("KeyRound", "#eab308");
  if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(name)) return text(/\.[cm]?jsx?$/.test(name) ? "JS" : "TS", ORANGE);
  if (/^(yarn\.lock|pnpm-lock\.yaml|poetry\.lock|cargo\.lock|uv\.lock|gemfile\.lock|go\.sum)$/.test(name)) return lucide("Lock", GREY);
  const extension = name.includes(".") ? name.split(".").at(-1)! : "";
  return byExtension[extension] ?? lucide("File");
}
