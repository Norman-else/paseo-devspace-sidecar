import { z } from "zod";
import type { ReviewFile } from "../shared/diff";
import type { CheckDetail } from "../shared/review-details";
import { runGh, type Gh } from "./pull-requests";
import { createHash } from "node:crypto";

const identity = z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/);
const commit = z.string().regex(/^[a-f0-9]{40,64}$/i);
const rawFile = z.object({ filename: z.string(), previous_filename: z.string().optional(), status: z.string(), additions: z.number(), deletions: z.number(), patch: z.string().optional() });
const rawDetail = z.object({ base: z.object({ sha: commit }), head: z.object({ sha: commit, repo: z.object({ full_name: identity }).nullable() }), changed_files: z.number().int() });
export function failureExcerpt(log: string, limit = 12000) {
  const lines = log.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "").replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "").split(/\r?\n/);
  const selected = new Set<number>();
  lines.forEach((line, index) => { if (/error|exception|fail(?:ed|ure)|fatal|assertion/i.test(line)) for (let n = Math.max(0, index - 1); n <= Math.min(lines.length - 1, index + 2); n++) selected.add(n); });
  const text = selected.size ? [...selected].sort((a, b) => a - b).map((n) => lines[n]).join("\n") : lines.slice(-60).join("\n");
  return text.slice(-limit);
}
export class GitHubReview {
  private cache = new Map<string, { expires: number; value: Promise<{ baseSha: string; headSha: string; headRepository: string; totalFiles: number; files: ReviewFile[] }> }>();
  constructor(private gh: Gh = runGh) {}
  private async api(root: string, endpoint: string) { return JSON.parse(await this.gh(root, ["api", endpoint])); }
  changes(root: string, repository: string, number: number, headSha: string) {
    const key = `${root}:${repository}:${number}:${headSha}`;
    const cached = this.cache.get(key);
    if (cached && cached.expires > Date.now()) return cached.value;
    const load = async () => {
      const detail = rawDetail.parse(await this.api(root, `repos/${repository}/pulls/${number}`));
      const comparison = z.object({ merge_base_commit: z.object({ sha: commit }) }).parse(await this.api(root, `repos/${repository}/compare/${detail.base.sha}...${detail.head.sha}`));
      const files: ReviewFile[] = [];
      for (let page = 1; page <= 20; page++) {
        const items = z.array(rawFile).parse(await this.api(root, `repos/${repository}/pulls/${number}/files?per_page=100&page=${page}`));
        for (const item of items) {
          const patch = item.patch ?? "";
          files.push({ path: item.filename, ...(item.previous_filename ? { oldPath: item.previous_filename } : {}), status: ({ added: "A", removed: "D", renamed: "R", copied: "C" } as Record<string, string>)[item.status] ?? "M", additions: item.additions, deletions: item.deletions,
            binary: !item.patch && item.additions === 0 && item.deletions === 0, patch, hash: createHash("sha256").update(patch).update(item.status).digest("hex"),
            ...(!item.patch ? { notice: "GitHub did not provide a text patch for this file." } : {}) });
        }
        if (items.length < 100) break;
      }
      // Never associate file patches with a head that changed halfway through pagination.
      const after = rawDetail.parse(await this.api(root, `repos/${repository}/pulls/${number}`));
      if (after.head.sha !== detail.head.sha || after.base.sha !== detail.base.sha) throw new Error("PR changed while loading. Refresh and try again.");
      return { baseSha: comparison.merge_base_commit.sha, headSha: detail.head.sha, headRepository: detail.head.repo?.full_name ?? repository, totalFiles: detail.changed_files, files };
    };
    const value = load().catch((error) => { this.cache.delete(key); throw error; });
    this.cache.set(key, { expires: Date.now() + 15000, value });
    if (this.cache.size > 8) this.cache.delete(this.cache.keys().next().value!);
    return value;
  }
  async content(root: string, repository: string, sha: string, path: string): Promise<string | null> {
    const endpoint = `repos/${repository}/contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(sha)}`;
    try {
      const data = z.object({ type: z.string(), size: z.number(), encoding: z.string().optional(), content: z.string().optional() }).parse(await this.api(root, endpoint));
      if (data.size > 512 * 1024 || data.type !== "file" || data.encoding !== "base64") throw new Error("File is too large or binary for contextual review.");
      const bytes = Buffer.from(data.content ?? "", "base64");
      if (bytes.includes(0)) throw new Error("File is too large or binary for contextual review.");
      return bytes.toString("utf8").replace(/\r\n/g, "\n");
    } catch (error) {
      if (/HTTP 404/.test(String((error as { stderr?: string }).stderr))) {
        // Distinguish a missing path from an inaccessible/deleted source commit.
        try { await this.api(root, `repos/${repository}/git/commits/${sha}`); }
        catch { throw new Error("The comparison commit is unavailable on the project host."); }
        return null;
      }
      throw error;
    }
  }
  async discussions(root: string, repository: string, number: number, headSha: string) {
    const [owner, name] = repository.split("/");
    const threads: import("../shared/review-details").ReviewThread[] = [];
    let cursor: string | null = null, truncated = false;
    for (let page = 0; page < 10; page++) {
      const query = `query($owner:String!,$name:String!,$number:Int!,$cursor:String){repository(owner:$owner,name:$name){pullRequest(number:$number){headRefOid reviewThreads(first:100,after:$cursor){pageInfo{hasNextPage endCursor} nodes{id path line startLine diffSide isResolved isOutdated comments(first:100){pageInfo{hasNextPage} nodes{author{login avatarUrl url ... on User{name}} body url createdAt}}}}}}}`;
      const args = ["api", "graphql", "-f", `query=${query}`, "-f", `owner=${owner}`, "-f", `name=${name}`, "-F", `number=${number}`, ...(cursor ? ["-f", `cursor=${cursor}`] : [])];
      const data = JSON.parse(await this.gh(root, args));
      if (data.errors?.length) throw new Error("Unable to read PR discussions.");
      const pr = data.data?.repository?.pullRequest;
      if (!pr || pr.headRefOid !== headSha) throw new Error("PR changed while loading. Refresh and try again.");
      const collection = pr.reviewThreads;
      for (const thread of collection.nodes) threads.push({ id: thread.id, path: thread.path, line: thread.line, startLine: thread.startLine, side: thread.diffSide, resolved: thread.isResolved, outdated: thread.isOutdated, truncated: !!thread.comments.pageInfo.hasNextPage,
        comments: thread.comments.nodes.map((comment: { author?: { login: string; name?: string | null; avatarUrl?: string; url?: string }; body: string; url: string; createdAt: string }) => ({ author: comment.author?.login ?? "GitHub", name: comment.author?.name ?? null, avatarUrl: comment.author?.avatarUrl ?? null, authorUrl: comment.author?.url ?? null, body: comment.body.slice(0, 24000), url: comment.url, createdAt: comment.createdAt })) });
      truncated = collection.pageInfo.hasNextPage;
      if (!truncated) break;
      cursor = collection.pageInfo.endCursor;
    }
    return { headSha, threads, truncated };
  }
  async check(root: string, repository: string, headSha: string, name: string, url: string | null, summary = ""): Promise<CheckDetail> {
    const result: CheckDetail = { name, url, summary, excerpt: "", logUnavailable: false, external: true };
    const value = await this.api(root, `repos/${repository}/commits/${headSha}/check-runs?check_name=${encodeURIComponent(name)}&per_page=100`);
    const run = value.check_runs?.find((run: { name: string; details_url: string }) => run.name === name && (!url || run.details_url === url));
    if (!run) return result;
    result.external = false;
    result.summary = [run.output?.title, run.output?.summary, run.output?.text].filter(Boolean).join("\n\n").slice(0, 16000);
    const annotations = await this.api(root, `repos/${repository}/check-runs/${Number(run.id)}/annotations?per_page=50`);
    result.excerpt = failureExcerpt((Array.isArray(annotations) ? annotations : []).map((a: { path: string; start_line: number; message: string }) => `${a.path}:${a.start_line}\n${a.message}`).join("\n"));
    const job = url && /^https:\/\/github\.com\/([^/]+\/[^/]+)\/actions\/runs\/\d+\/job\/(\d+)(?:[?#].*)?$/.exec(url);
    if (job && job[1].toLowerCase() === repository.toLowerCase()) {
      try { result.excerpt = failureExcerpt(await this.gh(root, ["run", "view", "--repo", repository, "--job", job[2], "--log-failed"])) || result.excerpt; }
      catch { result.logUnavailable = true; }
    }
    return result;
  }
}
