# paseo-devspace-sidecar

Show the real DevSpace worktree's file changes in Paseo's right sidebar while the coding agent runs on another host.

## Development

Requires Paseo >=0.15.4, Node >=22.19, Git, and DevSpace's SQLite workspace registry on the project machine.

```sh
npm ci
npm run typecheck
npm test
paseo plugin install /absolute/path/to/paseo-devspace-sidecar
```

The Mac plugin starts an authenticated read service on `127.0.0.1:7677` and creates a random token in the owner-only file `~/.config/paseo-devspace-sidecar/config.json`. Both hosts must already have Paseo plugins enabled. Do not restart the daemon to apply plugin changes.

## Connect the VPS

The VPS reaches the Mac through DevSpace's existing connection (VPS `127.0.0.1:7676` → Mac DevSpace). The DevSpace lifecycle adapter adds an authenticated `/__paseo-devspace/rpc` route that forwards review requests to the Mac sidecar bridge on `127.0.0.1:7677`, so no separate tunnel is needed. Install the adapter first (`node scripts/install-devspace-lifecycle.mjs --install`; after adapter changes add `--reload`).

From the Mac, using an existing noninteractive SSH config alias for the VPS:

```sh
node scripts/connect-vps.mjs claude-sidecar
```

This copies source to `~/PersonalRepos/paseo-devspace-sidecar` on the VPS, configures remote mode with endpoint `http://127.0.0.1:7676/__paseo-devspace/rpc` without printing the token, and removes the legacy sidecar tunnel launch agent if present. An optional second argument changes the VPS DevSpace port. `--tunnel` restores the legacy dedicated reverse tunnel (VPS `127.0.0.1:17677` → Mac `7677`). Install the plugin at its VPS path with the remote Paseo CLI or Settings → Plugins. After source changes, rerun the script and reload the remote plugin.

## Using the panel

Select the task's agent and click **Desk** (**工作台** in Chinese) beside the composer, run `/devspace-diff`, or use Command Center → **DevSpace Desk: code changes, PR status and merge**. The composer button appears only after this session is associated with a DevSpace workspace. The panel opens in the right Explorer sidebar under **DevSpace Desk**.

The panel follows the most recently used worktree in the session, so later reads or writes in the main checkout do not move it away from the PR. Worktrees include DevSpace worktrees (`~/.devspace/worktrees/*`), Claude Code worktrees (`<project>/.claude/worktrees/*`) and any other linked Git worktree. Without a worktree, the latest checkout is used. When the session used more than one workspace, a workspace bar at the top of the panel shows the current branch, whether it is a worktree or the main checkout, and its path; open it to switch; picking one pins it for this panel, and **Auto** returns to the default. Existing commands and saved tabs remain compatible.

The panel automatically binds to the latest explicit DevSpace workspace target in this agent's last 200 timeline entries. No workspace picker is shown. A conversation that has not used DevSpace gets an empty state explaining where changes appear. Ordinary assistant prose, project names, failed calls, and workspace IDs mentioned in command output do not select a worktree.

- With an associated PR, **PR changes** shows GitHub's submitted patch against its merge base, while **Not pushed** compares the submitted head with the worktree, including later commits and uncommitted files. A local-change notice appears only when its PR head matches the displayed PR snapshot. Without a PR, the panel offers Task changes and Uncommitted.
- **Task changes** compares against the `base_sha` stored by DevSpace, including committed work, staged and unstaged edits, and untracked files.
- **Uncommitted** compares against HEAD, including staged and unstaged edits and untracked files.
- All file diffs appear in one continuous document, with syntax highlighting, old/new line numbers, colored changes, and omitted-context separators.
- Code wraps automatically to the available width, including when resizing the file index. Original source and line numbers are preserved; no horizontal scrolling is needed.
- On desktop and browser clients, code follows Paseo's saved monospace font and code size, with a 14px minimum for readability. Font changes update the review without reinstalling. The code area uses a neutral Claude Code-inspired dark palette, with distinct green/red change fills and left markers. Light themes use readable pastel change fills. Paseo chrome keeps the host theme.
- Labels, commands, counts, accessibility text, and notices follow Paseo's current app language, with English and Simplified Chinese translations. Language changes take effect without reinstalling the plugin.
- The flat file index on the right jumps to the file in that document. On a narrow panel, the list button opens the same index. There is no directory tree or per-file page navigation.
- The toolbar's right-panel icon shows or hides the file list. Hiding it removes the divider and gives the code the full panel width; showing it restores the saved list width. Visibility is saved with the tab. On a narrow panel, the same control opens the temporary file-list overlay.
- Drag the divider between the diff and the file index to resize the index. The width is saved with the tab and constrained so the code area stays usable.
- The current file header stays pinned at the top of the diff viewport while scrolling through that file. The next file header pushes it out and takes over; scrolling back restores the previous title. Pinning follows wrapped and measured row heights and survives virtualized row recycling. The pinned header keeps its fold and reviewed actions.
- File headers fold/unfold code and let you mark files as reviewed. Markers persist with the tab and reset for a file when its patch changes. Updates run every three seconds while mounted.
- A compact PR header automatically finds GitHub pull requests for the actual worktree's branch. The linked PR number and repository form a text-first identity row, with source-to-target branches aligned on the right and the title underneath. Identity text uses a consistent 13px size; only the PR link has an external-link indicator. CI results, skipped checks, review decisions, and merge conflicts use compact icon-and-text statuses; checks expand to show individual links. Multiple open PRs have a compact selector. PR data refreshes every 30 seconds and with the shared review refresh action. The repository default branch does not automatically bind a PR. Checkout-mode closed/merged history must match the current HEAD; same-named historical PRs from other tasks are ignored. Branch changes invalidate the PR response, diff document and review scope together.
- Narrow panels use an explicit compact header: branches are left-aligned below the PR identity, scope tabs share a row with search and file navigation, and counts share a second row with collapse and refresh. Toolbar controls have 44px touch targets.
- Review has one flat context header: PR details when a PR exists, otherwise the worktree branch. A separate compact toolbar sits directly above the diffs in both cases, with underlined scope tabs, grouped file/change counts, and review actions. No card framing or repeated branch title is shown. Loading and failed PR lookups retain the branch header with a compact status notice. One refresh action updates both workspace changes and PR status.

Review contains separate **Changes** and **Comments** tabs. Review required/approved/changes requested are informational states. Comments fills its own page, with unresolved filtering and code-location actions. Changes offers previous/next comment controls, a comment-count button on each affected file header, and compact inline discussion markers. Each of those paths opens code directly without visiting the Comments tab; missing context loads automatically. Current markers match the PR head and line side, including resolved and file-level discussions. Outdated comments stay labeled in Comments and link to GitHub instead of guessing a current code position. Switching tabs preserves the diff scroll position.

Comments show the author's avatar and public name, with their GitHub login below when different. Missing public names fall back to the login; missing or failed avatars use an initial. Replies keep their own author identity. Expanded discussions use Paseo's Markdown renderer. Click the PR's check status for bounded CI details.

Hover a code line to reveal its green + selection handle with a plus-shaped cursor; drag it up or down to select a range, with automatic scrolling near the viewport edges. Touch clients keep the handle visible. Line-number taps and desktop/browser text selection also select ranges. Gutters and diff markers are excluded from copied code. A floating toolbar near the selected code provides Explain, Request change, Copy, and Clear without changing the diff viewport height. It hides when the selection scrolls out of view. **Explain** and **Request change** open an editable feedback draft containing the path, line range, source version, and up to 200 loaded lines. The same draft is available from PR comments and failed checks. Inside the draft, **Copy** exports the full feedback, while the floating toolbar's Copy copies only source code. **Send to agent** explicitly sends the draft to this panel's current agent. Paseo 0.15.4 does not expose a public main-composer draft setter, so the plugin uses its own feedback composer and never edits private host UI state.

Search switches between file paths and loaded code, with previous/next match controls. Folded regions show their actual unmodified-line count. Click the count to expand the region in place, then click Collapse to fold it again; cached context reopens without another request. Large regions load up to 1,000 lines per click through bounded 200-line reads, with an explicit remaining-lines action. Use the file index for navigation; the redundant bottom file/change navigation bar is removed. **File filters** offers All changed files, Unreviewed files, and Changes since baseline, with an explanation for each choice. The dialog shows the current comparison, why baseline filtering is unavailable before saving, and when a baseline was saved. Save current version as baseline captures the version you reviewed; Update baseline to current version replaces the reference for the next round. Baselines are separate for each comparison; PR changes uses the version pushed to GitHub. Subsequent edits, additions, deletions, and restored files can be compared against that saved text. A baseline captures at most 200 text files, 512 KiB per file, and 8 MiB total; omitted files are counted and later display a comparison notice. Review baselines live privately under the project host's sidecar configuration directory in `reviews/`; project files and Git's staged content remain untouched. The selected baseline is saved with the panel tab.

Check details show provider summaries and GitHub check annotations. Failed GitHub Actions jobs can include a bounded error excerpt and a source-log link. External providers such as CircleCI retain their provider links and any summary GitHub supplies; full private provider logs require that provider's own access and are not fetched with GitHub credentials.

PR status requires `gh` (GitHub CLI) installed and authenticated on the project host that runs the local sidecar bridge. No GitHub credentials are sent to the VPS or stored in this repository. Lookups use the branch's push/tracking remote and support GitHub forks by matching the head repository owner as well as the branch name. Multiple open PRs for that branch are shown; otherwise the most recently updated matching merged/closed PR is shown. Missing PRs, unavailable authentication, and failed requests are separate states. Check results refer to the PR's last pushed commit, not uncommitted local edits. GitHub reads remain read-only. The explicit merge action is the exception: for Open PRs, the split-button menu selects an allowed merge method and an independent Bypass requirements toggle, while only clicking the main button sends a merge request. Bypass is available only when GitHub reports the authenticated actor can use it. The project host revalidates workspace/PR association, repository, base branch, method, permission, and expected head SHA immediately before an asynchronous GitHub merge request. It never silently retries a write after an uncertain network result; subsequent polling is read-only. Method selection and refresh never merge. Merge queues and stacked PRs direct users to GitHub; authorized Bypass can directly merge a non-stacked PR. The plugin does not create or approve PRs, resolve threads, post GitHub comments, or deploy changes. Agent feedback is sent only through the feedback composer's explicit Send action.

## Clean up finished worktrees

A merged PR shows **Clean up worktree** beside its status. You can also open **More review actions → Clean up worktree**, use Command Center, or run `/devspace-cleanup`, including when the branch has no PR.

The confirmation shows the exact local path, branch, HEAD, PR state and associated Paseo conversations, including children. Nothing is deleted by opening the preview. Confirming removes the managed local worktree first, closes its DevSpace registration, then archives the selected conversations and their empty Paseo workspaces. Workspace ownership is checked by exact workspace ID, so another task sharing the same VPS directory is unaffected. A workspace with another active agent, any terminal, a running script, a changed directory, or a separate Paseo-owned Git worktree is retained and its reason is shown. Archiving an ordinary Paseo workspace leaves its VPS directory in place. A failed local cleanup never archives conversations or workspaces. If archiving fails after cleanup, **Retry archiving** repeats only the unfinished archive step. Command Center → **Worktree cleanup status** is workspace-scoped and remains available after the last agent closes; it can show the receipt and retry without repeating local deletion or agent archiving. The receipt and source routing survive plugin restarts. History stays readable; resuming a closed worktree requires a new workspace/session.

Only active DevSpace-managed linked worktrees inside its configured worktree directory are eligible. Main checkouts and the VPS conversation directory are not targets. Running DevSpace commands, local agents, associated conversations or children block cleanup. Shared worktrees used by unrelated conversations also block it. Other distinct active worktrees associated with these conversations disable archiving while allowing cleanup alone; the preview lists their branches and paths. Historical access to a main checkout, or another ID for the same worktree path, does not disable archiving.

Tracked changes, untracked files, locks and ignored files outside known disposable build/dependency directories block deletion. There is no force-delete or automatic stash option. Local branches remain, and a `refs/paseo-devspace-sidecar/recovery/<workspace-id>` reference preserves the selected HEAD, including detached HEADs. Unmerged or unknown PR states require an extra acknowledgement; extra commits beyond a merged PR block cleanup. The source rechecks HEAD, registration and activity after confirmation. Uncertain outcomes are queried without automatically repeating deletion.

Cleanup requires the lifecycle adapter inside **DevSpace 1.1.1** on the project host. It adds a token-authenticated loopback endpoint to the existing DevSpace service, using the sidecar's private token. It does not patch the installed npm package. The same adapter also carries review requests from a VPS (`/__paseo-devspace/rpc`), so a VPS needs it for normal review too; review on the Mac itself does not. For the existing Mac LaunchAgent:

```sh
node scripts/install-devspace-lifecycle.mjs              # check compatibility and idle state
node scripts/install-devspace-lifecycle.mjs --install    # enable, with a LaunchAgent backup
```

After changing adapter code, use `--install --reload` while DevSpace is idle. The installer gracefully reloads DevSpace only; Paseo and SSH tunnels are unchanged. The installer refuses to run while DevSpace has child processes, including a command started through DevSpace itself; launch it detached (for example `nohup sh -c 'sleep 5; node scripts/install-devspace-lifecycle.mjs --install --reload' &`) when working over DevSpace. Other service managers can start Node with `--import /absolute/plugin/path/server/devspace-lifecycle-preload.mjs` before the DevSpace entry script. Unsupported DevSpace versions disable the adapter. Windows setup remains deferred; the automatic installer is specific to the configured Mac LaunchAgent.

Source plans and cleanup receipts live under the sidecar configuration directory in `cleanup-source/`; daemon association/archive receipts are in `cleanup-jobs.json`, and remote source pins in `cleanup-routes.json`. Keep them private and retain them for recovery. The source extension updates its own DevSpace registration to inactive after acquiring the cleanup lease. It deliberately avoids the pruned state, which DevSpace can automatically restore. Restart recovery verifies an inactive registration, missing directory/registration and matching recovery reference before reporting success.

Review opens SQLite read-only. Git disables optional index refreshes, external diff drivers, and text conversion. The review view never stages, commits, resets, or edits project files. Confirmed cleanup is the explicit exception that removes the selected managed worktree and updates its registration. Untracked symlinks display their target path, not file contents outside the worktree.

Binary and oversized files show a notice. New-file previews are limited to 512 KiB; Git patches to 768 KiB; file lists to 2,000 entries. Initial continuous review batches up to 80 patches and 4 MiB; other files load when selected in the index or through their load action. Git metadata is read once per batch, and unchanged review documents are cached by revision. This is a live Git view, not a recorder of intermediate edits. DevSpace's web page still provides its historical turn checkpoints.

## Configuration and troubleshooting

Configuration on each daemon machine is `~/.config/paseo-devspace-sidecar/config.json`. Local mode has `mode`, `databasePath`, `port`, and a generated `token`. Remote mode has `mode`, a loopback `endpoint`, and the same token. Keep these files private. `PASEO_DEVSPACE_SIDECAR_HOME` overrides the directory. Set local `databasePath` for a custom DevSpace state directory, then reload the plugin.

```sh
paseo plugin ls
paseo plugin logs paseo-devspace-sidecar
paseo plugin reload paseo-devspace-sidecar
```

If the **Desk** button never appears on the VPS, the sidecar cannot reach the Mac; the button is hidden rather than showing an error. Check in order:

1. The VPS `config.json` is `"mode": "remote"` with endpoint `http://127.0.0.1:7676/__paseo-devspace/rpc`. A `"mode": "local"` file on the VPS is the auto-generated default from installing the plugin; run `connect-vps.mjs` from the Mac.
2. DevSpace is reachable from the VPS and runs the adapter. On the VPS, `curl -s -X POST http://127.0.0.1:7676/__paseo-devspace/rpc -H 'Authorization: Bearer x' -d '{}'` should return `{"error":"Unauthorized."}`; a different response means the adapter is not loaded (install it with `--install --reload`).
3. The Paseo app and this plugin are running on the Mac: it serves `127.0.0.1:7677`, which the adapter forwards to. Otherwise review reports that the project host's sidecar plugin is not running.

With the legacy `--tunnel` setup, the Mac tunnel uses `~/Library/LaunchAgents/com.normanzuo.paseo-devspace-sidecar.plist` and SSH errors are in `~/.config/paseo-devspace-sidecar/tunnel.log`; its SSH alias must still resolve. Rerunning `connect-vps.mjs` without `--tunnel` removes that launch agent.

To remove the integration, uninstall the plugin on both hosts and unload any legacy tunnel launch agent. Source and configuration remain for you to keep or delete.

Paseo 0.15.x's public plugin theme exposes colors but no typography. The isolated `client/web.ts` adapter reads only `monoFontFamily` and `codeFontSize` from the client's saved appearance settings and never writes them. Unsupported storage formats fall back to the platform monospace stack and 14px. Code rows opt out of Paseo's interface-font CSS override; native mobile clients currently use their platform monospace fallback. File names in section headers and the file index share the same 12px interface typography, 18px line height, medium weight, and 10px change counts.
