import { z } from "zod";
import { mergeOptionsSchema, type MergeOptions, type MergeOutcome, type MergeRequest } from "../shared/pr-merge";
import { runGh, type Gh } from "./pull-requests";
export type MergeContext = { root: string; repository: string; number: number; sourceBranch: string };
const commit = z.string().regex(/^[a-f0-9]{40,64}$/i);
const uuid = z.string().uuid();
const rawSchema = z.object({ nameWithOwner: mergeOptionsSchema.shape.repository, viewerPermission: z.string().nullable(), mergeCommitAllowed: z.boolean(), squashMergeAllowed: z.boolean(), rebaseMergeAllowed: z.boolean(), pullRequest: z.object({ number: z.number(), state: z.enum(["OPEN", "CLOSED", "MERGED"]), isDraft: z.boolean(), headRefName: z.string().nullable(), baseRefName: z.string(), headRefOid: commit, mergeable: z.string(), canBeRebased: z.boolean(), mergeStateStatus: z.string(), viewerCanMergeAsAdmin: z.boolean(), isMergeQueueEnabled: z.boolean(), stack: z.object({ __typename: z.string() }).nullable(), mergeCommit: z.object({ oid: commit }).nullable(), commits: z.object({ totalCount: z.number().int() }) }) });
type Entry = { workspaceId: string; number: number; signature: string; created: number; outcome: MergeOutcome; context?: MergeContext; uuid?: string; expectedHead: string };
const apiHeaders = ["--hostname", "github.com", "-H", "Accept: application/vnd.github+json", "-H", "X-GitHub-Api-Version: 2026-03-10"];
const message = (value: unknown) => typeof value === "string" ? value.replace(/[\x00-\x1f\x7f]/g, " ").slice(0, 1200) : undefined;

/** Writes are confined to one explicit, SHA-pinned asynchronous merge request. */
export class GitHubMerge {
  private entries = new Map<string, Entry>();
  private active = new Map<string, string>();
  constructor(private gh: Gh = runGh) {}
  private async read(context: MergeContext) {
    const [owner, name] = context.repository.split("/");
    const query = `query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){nameWithOwner viewerPermission mergeCommitAllowed squashMergeAllowed rebaseMergeAllowed pullRequest(number:$number){number state isDraft headRefName baseRefName headRefOid mergeable canBeRebased mergeStateStatus viewerCanMergeAsAdmin isMergeQueueEnabled stack{__typename} mergeCommit{oid} commits{totalCount}}}}`;
    const data = JSON.parse(await this.gh(context.root, ["api", "graphql", "--hostname", "github.com", "-f", `query=${query}`, "-f", `owner=${owner}`, "-f", `name=${name}`, "-F", `number=${context.number}`]));
    if (data.errors?.length) throw new Error("Unable to read merge options.");
    const repository = rawSchema.parse(data.data?.repository);
    if (repository.nameWithOwner.toLowerCase() !== context.repository.toLowerCase() || repository.pullRequest.number !== context.number || (repository.pullRequest.state !== "MERGED" && repository.pullRequest.headRefName !== context.sourceBranch)) throw new Error("PR is no longer associated with this workspace.");
    return repository;
  }
  async options(context: MergeContext): Promise<MergeOptions> {
    const repo = await this.read(context), pr = repo.pullRequest;
    const methods = (["squash", "merge", "rebase"] as const).filter((method) => ({ squash: repo.squashMergeAllowed, merge: repo.mergeCommitAllowed, rebase: repo.rebaseMergeAllowed && pr.canBeRebased })[method]);
    const common: MergeOptions["reason"] = pr.state !== "OPEN" ? "not_open" : pr.isDraft ? "draft" : pr.stack ? "stacked" : !["ADMIN", "MAINTAIN", "WRITE"].includes(repo.viewerPermission ?? "") ? "permission" : pr.mergeable === "CONFLICTING" ? "conflicts" : pr.mergeable !== "MERGEABLE" ? "checking" : !methods.length ? "method" : "none";
    const reason = common !== "none" ? common : pr.isMergeQueueEnabled ? "queue" : ["CLEAN", "UNSTABLE", "HAS_HOOKS"].includes(pr.mergeStateStatus) ? "none" : ["UNKNOWN", "DRAFT"].includes(pr.mergeStateStatus) ? "checking" : "requirements";
    return { repository: repo.nameWithOwner, number: pr.number, sourceBranch: pr.headRefName ?? context.sourceBranch, baseBranch: pr.baseRefName, headSha: pr.headRefOid, state: pr.state, methods, defaultMethod: methods[0] ?? null, canBypass: pr.viewerCanMergeAsAdmin, reason, bypassReason: common !== "none" ? common : pr.viewerCanMergeAsAdmin ? "none" : "bypass_denied", commits: pr.commits.totalCount };
  }
  private key(workspaceId: string, number: number) { return `${workspaceId}:${number}`; }
  private update(entry: Entry, status: MergeOutcome["status"], reason: MergeOutcome["reason"] = "none", detail?: string, sha?: string) {
    if (entry.outcome.status === "merged" || entry.outcome.status === "failed" && (status === "pending" || status === "unknown")) return entry.outcome;
    entry.outcome = { requestId: entry.outcome.requestId, status, reason, ...(detail ? { detail } : {}), ...(sha ? { sha } : {}) };
    if ((status === "merged" || status === "failed") && this.active.get(this.key(entry.workspaceId, entry.number)) === entry.outcome.requestId) this.active.delete(this.key(entry.workspaceId, entry.number));
    return entry.outcome;
  }
  async merge(input: MergeRequest, resolve: () => Promise<MergeContext>): Promise<MergeOutcome> {
    const signature = JSON.stringify([input.workspaceId, input.prNumber, input.expectedRepository.toLowerCase(), input.expectedHeadSha, input.expectedBaseBranch, input.method, input.bypass]), previous = this.entries.get(input.requestId);
    if (previous) return previous.signature === signature ? previous.outcome : { requestId: input.requestId, status: "failed", reason: "stale" };
    const key = this.key(input.workspaceId, input.prNumber);
    const activeId = this.active.get(key);
    if (activeId) await this.status(input.workspaceId, input.prNumber, activeId);
    if (this.active.has(key)) return { requestId: input.requestId, status: "failed", reason: "busy" };
    // Register before any slow workspace/GitHub reads so a timed-out client can query its outcome.
    const entry: Entry = { workspaceId: input.workspaceId, number: input.prNumber, signature, created: Date.now(), expectedHead: input.expectedHeadSha, outcome: { requestId: input.requestId, status: "pending", reason: "none" } };
    this.entries.set(input.requestId, entry); this.active.set(key, input.requestId);
    for (const [id, value] of this.entries) if (["failed", "merged"].includes(value.outcome.status) && Date.now() - value.created > 1800000) this.entries.delete(id);
    if (this.entries.size > 128) for (const [id, value] of this.entries) { if (this.entries.size <= 128) break; if (["failed", "merged"].includes(value.outcome.status)) this.entries.delete(id); }
    let options: MergeOptions;
    try { entry.context = await resolve(); options = await this.options(entry.context); }
    catch { return this.update(entry, "failed", "unavailable"); }
    if (options.repository.toLowerCase() !== input.expectedRepository.toLowerCase() || options.headSha !== input.expectedHeadSha || options.baseBranch !== input.expectedBaseBranch) return this.update(entry, "failed", "stale");
    if (options.state === "MERGED") return this.update(entry, "merged");
    const blocked = input.bypass ? options.bypassReason : options.reason;
    if (blocked !== "none") return this.update(entry, "failed", blocked);
    if (!options.methods.includes(input.method)) return this.update(entry, "failed", "method");
    try {
      const raw = JSON.parse(await this.gh(entry.context.root, ["api", ...apiHeaders, "--method", "PUT", `repos/${options.repository}/pulls/${options.number}/merge-async`, "-f", `sha=${input.expectedHeadSha}`, "-f", `merge_method=${input.method}`, "-f", "merge_action=direct_merge", "-F", `bypass_rules=${input.bypass}`]));
      return this.accept(entry, raw);
    } catch (error) {
      const failure = error as { stderr?: string; stdout?: string };
      try { const raw = JSON.parse(failure.stdout ?? ""); if (raw.status === "pending" && uuid.safeParse(raw.details?.uuid).success) { if (raw.details.expected_head_sha !== input.expectedHeadSha || raw.details.merge_method !== input.method || raw.details.bypass_rules !== input.bypass) return this.update(entry, "failed", "busy"); return this.accept(entry, raw); } } catch { /* no structured outcome */ }
      if (/HTTP (?:400|401|403|404|405|409|422)\b/.test(failure.stderr ?? "")) {
        let detail: string | undefined; try { detail = message(JSON.parse(failure.stdout ?? "").message); } catch { /* no safe message */ }
        return this.update(entry, "failed", "github_failed", detail);
      }
      // A transport failure after PUT is ambiguous, never automatically repeat the write.
      return this.update(entry, "unknown", "unknown");
    }
  }
  private accept(entry: Entry, raw: unknown): MergeOutcome {
    const parsed = z.object({ status: z.enum(["pending", "merged", "failed", "enqueued"]), details: z.object({ uuid: uuid.optional(), sha: commit.optional(), message: z.string().optional() }) }).parse(raw);
    if (parsed.status === "merged") return this.update(entry, "merged", "none", undefined, parsed.details.sha);
    if (parsed.status === "failed") return this.update(entry, "failed", "github_failed", message(parsed.details.message));
    if (parsed.status === "pending" && parsed.details.uuid) { entry.uuid = parsed.details.uuid; return this.update(entry, Date.now() - entry.created > 120000 ? "unknown" : "pending", Date.now() - entry.created > 120000 ? "unknown" : "none"); }
    return this.update(entry, "unknown", "unknown");
  }
  async status(workspaceId: string, number: number, requestId: string): Promise<MergeOutcome> {
    const entry = this.entries.get(requestId);
    if (!entry || entry.workspaceId !== workspaceId || entry.number !== number) return { requestId, status: "unknown", reason: "unknown" };
    if (["merged", "failed"].includes(entry.outcome.status)) return entry.outcome;
    if (!entry.context) return entry.outcome;
    if (entry.uuid) {
      try { return this.accept(entry, JSON.parse(await this.gh(entry.context.root, ["api", ...apiHeaders, `repos/${entry.context.repository}/pulls/${number}/merge-async/${entry.uuid}`]))); }
      catch { /* fall back to the authoritative PR state below */ }
    }
    try {
      const repo = await this.read(entry.context);
      if (repo.pullRequest.headRefOid !== entry.expectedHead) return this.update(entry, "failed", "stale");
      if (repo.pullRequest.state === "MERGED") return this.update(entry, "merged", "none", undefined, repo.pullRequest.mergeCommit?.oid);
    } catch { /* keep an uncertain outcome; status reads never cause another merge */ }
    if (Date.now() - entry.created > 120000) return this.update(entry, "unknown", "unknown");
    return entry.outcome;
  }
}
