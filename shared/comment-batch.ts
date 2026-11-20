import type { ReviewThread } from "./review-details";

const TOTAL_BUDGET = 60000;

/** GitHub App reviewers (for example mercoder-dev) link to /apps/; classic bot accounts end in [bot]. */
export function isBotAuthor(comment: { author: string; authorUrl?: string | null }) {
  return /\[bot\]$/i.test(comment.author) || /github\.com\/apps\//i.test(comment.authorUrl ?? "");
}

/** Bot reviews carry HTML comments and checkbox UIs that mean nothing to the agent. */
function cleanBody(body: string, limit: number) {
  const text = body.replace(/<!--[\s\S]*?-->/g, "").replace(/\n{3,}/g, "\n\n").trim();
  return text.length > limit ? `${text.slice(0, limit)}\n[... comment truncated, read the full text at the link]` : text;
}

/**
 * Instructions for handing several review threads to the session's agent at once. The agent judges each comment,
 * fixes the valid ones, commits and pushes to the PR branch, and reports per comment.
 */
export function commentBatchPrompt(threads: ReviewThread[], context: { prNumber: number; headBranch: string; baseBranch: string; headSha: string; workspace: { id: string; root: string; worktree: boolean } }): string {
  const perComment = Math.max(600, Math.floor(TOTAL_BUDGET / Math.max(1, threads.reduce((sum, thread) => sum + thread.comments.length, 0))));
  const blocks = threads.map((thread, index) => {
    const location = `${thread.path}${thread.line ? `:${thread.startLine && thread.startLine !== thread.line ? `${thread.startLine}-` : ""}${thread.line}` : ""}`;
    const flags = [thread.resolved ? "resolved" : "unresolved", thread.outdated ? "outdated: the code moved since this was written" : ""].filter(Boolean).join(", ");
    const comments = thread.comments.map((comment, position) => `${position ? "Reply by" : "By"} ${comment.author}${isBotAuthor(comment) ? " (bot reviewer)" : ""}:\n${cleanBody(comment.body, perComment)}`).join("\n\n");
    return `### Comment ${index + 1}: ${location} (${flags})\nThread ID: ${thread.id}\n${comments}\nLink: ${thread.comments[0]?.url ?? ""}`;
  });
  const { prNumber, headBranch, baseBranch, headSha, workspace } = context;
  return [
    `[DevSpace Desk] Address ${threads.length} review comment${threads.length === 1 ? "" : "s"} on PR #${prNumber} (${headBranch} → ${baseBranch}).`,
    "",
    `DevSpace workspace_id: ${workspace.id} (${workspace.worktree ? "worktree" : "checkout"} at ${workspace.root}). The PR head on GitHub is ${headSha.slice(0, 12)}.`,
    `Run every git and gh command through the DevSpace MCP tools with workspace_id ${workspace.id}. Do not touch other checkouts or branches.`,
    "",
    "For each comment below:",
    "1. Check whether it still applies to the current code. Some may be outdated, already fixed, or wrong.",
    "2. If it applies, fix it with the smallest change that fits the surrounding code, and add or update tests when it concerns behaviour. Comments about the same code may overlap: fix them together.",
    "3. If you disagree or it does not apply, leave the code alone and explain why.",
    "",
    `When all are handled: run the relevant tests, commit the fixes with a message you write from what changed (mention that it addresses review feedback), and push to ${headBranch}. If nothing needed changing, do not commit. Do not merge or force-push.`,
    "",
    "Then close the loop on GitHub, thread by thread, using each Thread ID. Only do this after the push succeeded (or when nothing needed a commit):",
    "- Fixed: reply with one line naming the short commit hash and what changed, then resolve the thread.",
    "- Not changed, bot reviewer: reply with the reason in one or two sentences, then resolve the thread.",
    "- Not changed, human reviewer: reply with the reason and leave the thread unresolved so they can decide.",
    "- Unsure, or it needs my decision: do not reply or resolve; ask me in your summary.",
    "Reply: `gh api graphql -f query='mutation($id:ID!,$body:String!){addPullRequestReviewThreadReply(input:{pullRequestReviewThreadId:$id,body:$body}){comment{url}}}' -f id=<Thread ID> -f body=<reply>`",
    "Resolve: `gh api graphql -f query='mutation($id:ID!){resolveReviewThread(input:{threadId:$id}){thread{isResolved}}}' -f id=<Thread ID>`",
    "",
    "Finish with a table: comment number, file:line, fixed / not changed / needs you, and whether the thread was replied to and resolved.",
    "",
    ...blocks.flatMap((block) => [block, ""]),
  ].join("\n").trimEnd();
}
