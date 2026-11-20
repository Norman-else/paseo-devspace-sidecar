import test from "node:test";
import assert from "node:assert/strict";
import { gitActionPrompt, planGitActions, type GitStatus } from "../shared/git-actions.ts";
import { parsePorcelainStatus } from "../server/git.ts";

const status = (patch: Partial<GitStatus> = {}): GitStatus => ({ branch: "PSOS-1", defaultBranch: "master", remote: "origin", upstream: "origin/PSOS-1", ahead: 0, behind: 0, aheadOfBase: 0, changed: 0, conflicted: 0, ...patch });
const pick = (s: GitStatus, pr: "open" | "none" | "done" | "unknown") => { const plan = planGitActions(s, pr); return plan && "primary" in plan ? [plan.primary, ...plan.alternatives] : plan; };

test("Desk offers the next Git step for each branch state", () => {
  // Uncommitted work on a feature branch.
  assert.deepEqual(pick(status({ changed: 3, upstream: null }), "none"), ["commit-pr", "commit", "commit-push"]);
  assert.deepEqual(pick(status({ changed: 3 }), "open"), ["commit-push", "commit"], "an open PR picks up pushed commits");
  assert.deepEqual(pick(status({ changed: 3 }), "unknown"), ["commit", "commit-push"], "no PR creation while GitHub state is unknown");
  assert.deepEqual(pick(status({ changed: 3, remote: null, defaultBranch: null }), "unknown"), ["commit"], "no remote: commit only");
  // Committed but not pushed.
  assert.deepEqual(pick(status({ upstream: null, aheadOfBase: 2 }), "none"), ["push-pr", "push"]);
  assert.deepEqual(pick(status({ ahead: 1, aheadOfBase: 3 }), "open"), ["push"]);
  // Pushed, no PR yet.
  assert.deepEqual(pick(status({ aheadOfBase: 2 }), "none"), ["pr"]);
  assert.equal(pick(status({ aheadOfBase: 2 }), "unknown"), null);
  // Everything is on GitHub already.
  assert.equal(pick(status({ aheadOfBase: 2 }), "open"), null);
  assert.equal(pick(status(), "none"), null, "nothing ahead of the base branch: no PR to create");
  // A merged or closed PR already contains HEAD: a squash merge leaves the branch ahead of master, but nothing is new.
  assert.equal(pick(status({ aheadOfBase: 1 }), "done"), null);
  assert.deepEqual(pick(status({ aheadOfBase: 1, changed: 2 }), "done"), ["commit", "commit-push"], "new work after the merge can still be committed");
  // Never commit onto the base branch or a detached HEAD without branching first.
  assert.deepEqual(pick(status({ branch: "master", upstream: "origin/master", changed: 2 }), "none"), ["branch-pr", "branch-commit"]);
  assert.deepEqual(pick(status({ branch: null, upstream: null, changed: 1 }), "unknown"), ["branch-pr", "branch-commit"]);
  assert.deepEqual(pick(status({ branch: null, upstream: null, aheadOfBase: 2 }), "unknown"), ["branch-pr"]);
  assert.equal(pick(status({ branch: "master", upstream: "origin/master", behind: 1 }), "none"), null);
  assert.deepEqual(planGitActions(status({ changed: 2, conflicted: 1 }), "none"), { blocked: "conflicts", unpushed: 0 });
});

test("the agent prompt names the workspace and only the requested steps", () => {
  const workspace = { id: "ws_abc", root: "/u/.devspace/worktrees/Navi-1", worktree: true };
  const commitOnly = gitActionPrompt("commit", status({ changed: 2 }), workspace);
  assert.match(commitOnly, /workspace_id: ws_abc \(worktree at \/u\/\.devspace\/worktrees\/Navi-1\)/);
  assert.match(commitOnly, /Write the commit message yourself/);
  assert.doesNotMatch(commitOnly, /git push/);
  assert.doesNotMatch(commitOnly, /gh pr create/);
  assert.match(commitOnly, /Do not push\./);
  const full = gitActionPrompt("commit-pr", status({ changed: 2, upstream: null }), workspace);
  assert.match(full, /git push -u origin HEAD/);
  assert.match(full, /gh pr create/);
  assert.match(full, /pull request link/);
  const branch = gitActionPrompt("branch-pr", status({ branch: null, upstream: null, aheadOfBase: 1 }), workspace);
  assert.match(branch, /git switch -c/);
  assert.doesNotMatch(branch, /Stage only/, "nothing to commit when the work is already committed");
  assert.match(gitActionPrompt("push", status({ ahead: 1 }), workspace, 42), /open pull request #42/);
});

test("porcelain v2 parsing counts files, renames, conflicts and a deleted upstream", () => {
  const raw = ["# branch.oid abc", "# branch.head PSOS-1", "# branch.upstream origin/PSOS-1", "# branch.ab +2 -1", "1 .M N... 100644 100644 100644 a b src/a.ts", "2 R. N... 100644 100644 100644 a b R100 src/new.ts", "src/old.ts", "u UU N... 1 2 3 4 a b c src/c.ts", "? notes.md", ""].join("\0");
  assert.deepEqual(parsePorcelainStatus(raw), { branch: "PSOS-1", upstream: "origin/PSOS-1", ahead: 2, behind: 1, changed: 4, conflicted: 1 });
  const gone = ["# branch.head PSOS-2", "# branch.upstream origin/PSOS-2", ""].join("\0");
  assert.deepEqual(parsePorcelainStatus(gone), { branch: "PSOS-2", upstream: null, ahead: 0, behind: 0, changed: 0, conflicted: 0 });
  assert.equal(parsePorcelainStatus("# branch.head (detached)\0").branch, null);
});
