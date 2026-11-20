import { z } from "zod";

/** Read-only Git state of the bound workspace, used to decide which Desk actions to offer. */
export const gitStatusSchema = z.object({
  branch: z.string().nullable(), // null on a detached HEAD
  defaultBranch: z.string().nullable(), // the push remote's default branch, e.g. "master"
  remote: z.string().nullable(), // remote the branch pushes to
  upstream: z.string().nullable(), // tracking branch that still exists, e.g. "origin/PSOS-6404"
  ahead: z.number().int().min(0), behind: z.number().int().min(0), // relative to upstream
  aheadOfBase: z.number().int().min(0), // commits on HEAD that the remote default branch lacks
  changed: z.number().int().min(0), // staged, unstaged and untracked files
  conflicted: z.number().int().min(0),
});
export type GitStatus = z.infer<typeof gitStatusSchema>;

export const gitActions = ["commit", "commit-push", "commit-pr", "push", "push-pr", "pr", "branch-commit", "branch-pr"] as const;
export type GitAction = typeof gitActions[number];
/** "open" when an open or draft PR exists for the branch; "unknown" while loading or when GitHub is unavailable. */
export type PrPresence = "open" | "none" | "unknown";
export type GitPlan = { primary: GitAction; alternatives: GitAction[]; unpushed: number } | { blocked: "conflicts"; unpushed: number };

/** Commits that are not on the remote yet. Without an upstream, everything ahead of the base branch is unpushed. */
export function unpushedCommits(s: GitStatus) { return s.upstream ? s.ahead : s.aheadOfBase; }

/**
 * Pick the actions that make sense now. Nothing is offered when the branch is committed, pushed and has a PR.
 * A detached HEAD or the default branch always gets a new branch first, so nothing is pushed to the base branch.
 */
export function planGitActions(s: GitStatus, pr: PrPresence): GitPlan | null {
  const unpushed = unpushedCommits(s);
  if (s.conflicted) return { blocked: "conflicts", unpushed };
  const canPush = !!s.remote;
  if (!s.branch || s.branch === s.defaultBranch) {
    if (s.changed) return canPush && s.defaultBranch ? { primary: "branch-pr", alternatives: ["branch-commit"], unpushed } : { primary: "branch-commit", alternatives: [], unpushed };
    return s.aheadOfBase && canPush && s.defaultBranch ? { primary: "branch-pr", alternatives: [], unpushed } : null;
  }
  const canPr = canPush && !!s.defaultBranch && pr === "none";
  if (s.changed) {
    if (pr === "open") return { primary: "commit-push", alternatives: ["commit"], unpushed };
    if (canPr) return { primary: "commit-pr", alternatives: ["commit", "commit-push"], unpushed };
    return { primary: "commit", alternatives: canPush ? ["commit-push"] : [], unpushed };
  }
  if (unpushed && canPush) return canPr ? { primary: "push-pr", alternatives: ["push"], unpushed } : { primary: "push", alternatives: [], unpushed };
  if (canPr && s.aheadOfBase) return { primary: "pr", alternatives: [], unpushed };
  return null;
}

const titles: Record<GitAction, string> = {
  "commit": "Commit this task's changes. Do not push.",
  "commit-push": "Commit this task's changes and push the branch.",
  "commit-pr": "Commit this task's changes, push the branch and open a pull request.",
  "push": "Push this branch's unpushed commits.",
  "push-pr": "Push this branch and open a pull request.",
  "pr": "Open a pull request for this branch.",
  "branch-commit": "Move this work onto a new branch and commit it. Do not push.",
  "branch-pr": "Move this work onto a new branch, commit it, push it and open a pull request.",
};

/** The instructions sent to the session's agent. The agent writes the commit message and PR description itself. */
export function gitActionPrompt(action: GitAction, s: GitStatus, workspace: { id: string; root: string; worktree: boolean }, openPr?: number): string {
  const remote = s.remote ?? "origin", base = s.defaultBranch ?? "the default branch", unpushed = unpushedCommits(s);
  const branch = action.startsWith("branch-"), commit = branch ? s.changed > 0 : action.startsWith("commit"), push = action !== "commit" && action !== "branch-commit", pr = action.endsWith("-pr") || action === "pr";
  const state = [`${s.changed} changed file${s.changed === 1 ? "" : "s"}`, `${unpushed} unpushed commit${unpushed === 1 ? "" : "s"}`];
  if (s.behind) state.push(`${s.behind} new commit${s.behind === 1 ? "" : "s"} on ${s.upstream}`);
  state.push(openPr ? `open pull request #${openPr}` : "no open pull request");
  const steps: string[] = [];
  if (branch) steps.push("Create a new branch from the current HEAD with `git switch -c <name>`. Name it after the ticket if this conversation or the work names one (for example PSOS-1234), otherwise use a short kebab-case summary. Uncommitted changes move with it.");
  if (commit) steps.push("Review `git status` and `git diff`. Stage only the changes that belong to this task. Leave out unrelated, generated or secret files (.env, credentials) and tell me which ones you left out. Write the commit message yourself from the diff and from what we did in this conversation, following the repository's convention: check `git log --oneline -15` and any CONTRIBUTING, AGENTS.md or CLAUDE.md rules. Split into several commits only when the changes are clearly unrelated.");
  if (push) steps.push(`Push the branch to ${remote} and set its upstream with \`git push -u ${remote} HEAD\`. If the push is rejected because the remote branch moved, rebase onto it and push again once. If that hits conflicts, stop and ask me.`);
  if (pr) steps.push(`Open a pull request into ${base} with \`gh pr create\`. Write the title and description yourself from the commits, the diff and this conversation: what changed and why, how it was tested, and what reviewers should look at. Use the repository's pull request template if it has one, and reference the ticket if there is one.`);
  return [
    `[DevSpace Desk] ${titles[action]}`,
    "",
    `DevSpace workspace_id: ${workspace.id} (${workspace.worktree ? "worktree" : "checkout"} at ${workspace.root})`,
    `Branch: ${s.branch ?? "detached HEAD"}; base branch: ${base}; push remote: ${s.remote ?? "none"}`,
    `Current state: ${state.join(", ")}.`,
    "",
    `Run every git and gh command through the DevSpace MCP tools with workspace_id ${workspace.id}. Do not touch other checkouts or branches.`,
    ...steps.map((step, index) => `${index + 1}. ${step}`),
    "",
    `Do not merge, force-push, rewrite pushed history, or push to ${base}.${push ? "" : " Do not push."} When you are done, reply with the commit hash(es)${pr ? " and the pull request link" : ""}.`,
  ].join("\n");
}
