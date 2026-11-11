import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import { checkSummary, type PullRequest, type PullRequestResult } from "../shared/pull-request";

const exec = promisify(execFile);
type Gh = (root: string, args: string[]) => Promise<string>;
const runGh: Gh = async (root, args) => (await exec("gh", args, { cwd: root, timeout: 10000, maxBuffer: 2 * 1024 * 1024, encoding: "utf8", env: { ...process.env, GH_PROMPT_DISABLED: "1", GIT_TERMINAL_PROMPT: "0" }, windowsHide: true })).stdout;
const repoSchema = z.object({ nameWithOwner: z.string(), parent: z.object({ nameWithOwner: z.string() }).nullable().optional() });
const rawPrSchema = z.object({
  number: z.number().int().positive(), title: z.string(), url: z.string().url(), state: z.enum(["OPEN", "MERGED", "CLOSED"]), isDraft: z.boolean(),
  baseRefName: z.string(), headRefName: z.string(), headRefOid: z.string(),
  headRepositoryOwner: z.object({ login: z.string() }).nullable(), headRepository: z.object({ name: z.string() }).nullable(),
  reviewDecision: z.string().nullable(), mergeable: z.string(), updatedAt: z.string(), statusCheckRollup: z.unknown(),
});
const fields = "number,title,url,state,isDraft,baseRefName,headRefName,headRefOid,headRepositoryOwner,headRepository,reviewDecision,mergeable,updatedAt,statusCheckRollup";

/** Return an identity only, stripping any credentials embedded in an HTTPS remote. */
export function githubRepository(remote: string): string | null {
  let path: string;
  const scp = /^(?:[^@/]+@)?github\.com:(.+)$/i.exec(remote);
  if (scp) path = scp[1];
  else {
    try {
      const url = new URL(remote);
      if (url.hostname.toLowerCase() !== "github.com" || !["https:", "ssh:"].includes(url.protocol)) return null;
      path = url.pathname.replace(/^\//, "");
    } catch { return null; }
  }
  const name = path.replace(/\/$/, "").replace(/\.git$/i, "");
  return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(name) ? name : null;
}
export class PullRequests {
  private repositories = new Map<string, { name: string; expires: number }>();
  private pending = new Map<string, Promise<PullRequestResult>>();
  constructor(private gh: Gh = runGh) {}
  unavailable(reason: Extract<PullRequestResult, { status: "unavailable" }>["reason"]): PullRequestResult { return { status: "unavailable", reason, checkedAt: new Date().toISOString() }; }
  read(input: { root: string; remote: string; branch: string | null; localHeadSha: string }): Promise<PullRequestResult> {
    if (!input.branch) return Promise.resolve(this.unavailable("detached_head"));
    const repository = githubRepository(input.remote);
    if (!repository) return Promise.resolve(this.unavailable("unsupported_remote"));
    const key = `${input.root}:${repository}:${input.branch}`;
    const existing = this.pending.get(key);
    if (existing) return existing;
    const read = async (): Promise<PullRequestResult> => {
      try {
        let base = this.repositories.get(repository);
        if (!base || base.expires < Date.now()) {
          const resolved = repoSchema.parse(JSON.parse(await this.gh(input.root, ["repo", "view", `github.com/${repository}`, "--json", "nameWithOwner,parent"])));
          base = { name: resolved.parent?.nameWithOwner ?? resolved.nameWithOwner, expires: Date.now() + 300000 };
          if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(base.name)) throw new Error("Invalid repository identity");
          this.repositories.set(repository, base);
          if (this.repositories.size > 32) this.repositories.delete(this.repositories.keys().next().value!);
        }
        const raw = z.array(rawPrSchema).parse(JSON.parse(await this.gh(input.root, ["pr", "list", "--repo", `github.com/${base.name}`, "--head", input.branch!, "--state", "all", "--limit", "30", "--json", fields])));
        const [owner, name] = repository.toLowerCase().split("/");
        const matching = raw.filter((pr) => pr.headRefName === input.branch && pr.headRepositoryOwner?.login.toLowerCase() === owner && pr.headRepository?.name.toLowerCase() === name)
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
        const open = matching.filter((pr) => pr.state === "OPEN");
        const selected = open.length ? open : matching.slice(0, 1);
        const checkedAt = new Date().toISOString();
        if (!selected.length) return { status: "none", repository: base.name, branch: input.branch!, checkedAt };
        const pullRequests: PullRequest[] = selected.map((pr) => ({
          number: pr.number, title: pr.title, url: pr.url, state: pr.state === "OPEN" && pr.isDraft ? "DRAFT" : pr.state,
          baseBranch: pr.baseRefName, headSha: pr.headRefOid, review: ["APPROVED", "CHANGES_REQUESTED", "REVIEW_REQUIRED"].includes(pr.reviewDecision ?? "") ? pr.reviewDecision as PullRequest["review"] : "NONE",
          conflicts: pr.mergeable === "CONFLICTING", checks: checkSummary(pr.statusCheckRollup),
        }));
        return { status: "available", repository: base.name, branch: input.branch!, localHeadSha: input.localHeadSha, pullRequests, checkedAt };
      } catch (error) {
        const detail = error as { code?: string | number; stderr?: string; message?: string };
        if (detail.code === "ENOENT") return this.unavailable("gh_missing");
        const message = `${detail.stderr ?? ""} ${detail.message ?? ""}`;
        if (detail.code === 4 || /gh auth login|not logged|authentication|bad credentials|HTTP 401|HTTP 403|resource not accessible/i.test(message)) return this.unavailable("auth_required");
        return this.unavailable("request_failed");
      }
    };
    const promise = read().finally(() => this.pending.delete(key));
    this.pending.set(key, promise);
    return promise;
  }
}
