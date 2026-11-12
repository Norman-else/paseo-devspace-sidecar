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

From the Mac, using an existing noninteractive SSH config alias:

```sh
node scripts/connect-vps.mjs tokyo-claude
```

This copies source to `~/PersonalRepos/paseo-devspace-sidecar` on the VPS, configures remote mode without printing the token, and installs a Mac launch agent to maintain a private reverse SSH tunnel. VPS loopback port defaults to `17677`; an optional second argument changes it. Existing Paseo and DevSpace tunnels stay unchanged. Install the plugin at its VPS path with the remote Paseo CLI or Settings → Plugins. After source changes, rerun the script and reload the remote plugin.

## Using the panel

Select the task's agent and click **Review** (**审阅** in Chinese) beside the composer, run `/devspace-diff`, or use Command Center → **View code changes and PR status**. The composer button appears only after this session is associated with a DevSpace workspace. The continuous review opens in the right Explorer sidebar under **Review**. Existing commands and saved tabs remain compatible.

The panel automatically binds to the latest explicit DevSpace workspace target in this agent's last 200 timeline entries. No workspace picker is shown. A conversation that has not used DevSpace gets an empty state explaining where changes appear. Ordinary assistant prose, project names, failed calls, and workspace IDs mentioned in command output do not select a worktree.

- With an associated PR, **PR changes** shows GitHub's submitted patch against its merge base, while **Not pushed** compares the submitted head with the worktree, including later commits and uncommitted files. A local-change notice appears only when its PR head matches the displayed PR snapshot. Without a PR, the panel offers Task changes and Uncommitted.
- **Task changes** compares against the `base_sha` stored by DevSpace, including committed work, staged and unstaged edits, and untracked files.
- **Uncommitted** compares against HEAD, including staged and unstaged edits and untracked files.
- All file diffs appear in one continuous document, with syntax highlighting, old/new line numbers, colored changes, and omitted-context separators.
- Code wraps automatically to the available width, including when resizing the file index. Original source and line numbers are preserved; no horizontal scrolling is needed.
- On desktop and browser clients, code follows Paseo's saved monospace font and code size, with a 14px minimum for readability. Font changes update the review without reinstalling. The code area uses a neutral Claude Code-inspired dark palette, with distinct green/red change fills and left markers. Light themes use readable pastel change fills. Paseo chrome keeps the host theme.
- Labels, commands, counts, accessibility text, and notices follow Paseo's current app language, with English and Simplified Chinese translations. Language changes take effect without reinstalling the plugin.
- The flat file index on the right jumps to the file in that document. On a narrow panel, the list button opens the same index. There is no directory tree or per-file page navigation.
- Drag the divider between the diff and the file index to resize the index. The width is saved with the tab and constrained so the code area stays usable.
- The current file header stays pinned at the top of the diff viewport while scrolling through that file. The next file header pushes it out and takes over; scrolling back restores the previous title. Pinning follows wrapped and measured row heights and survives virtualized row recycling. The pinned header keeps its fold and reviewed actions.
- File headers fold/unfold code and let you mark files as reviewed. Markers persist with the tab and reset for a file when its patch changes. Updates run every three seconds while mounted.
- A compact PR header automatically finds GitHub pull requests for the actual worktree's branch. The linked PR number and repository form a text-first identity row, with source-to-target branches aligned on the right and the title underneath. Identity text uses a consistent 13px size; only the PR link has an external-link indicator. CI results, skipped checks, review decisions, and merge conflicts use compact icon-and-text statuses; checks expand to show individual links. Multiple open PRs have a compact selector. PR data refreshes every 30 seconds and with the shared review refresh action.
- Narrow panels use an explicit compact header: branches are left-aligned below the PR identity, scope tabs share a row with search and file navigation, and counts share a second row with collapse and refresh. Toolbar controls have 44px touch targets.
- Review has one flat context header: PR details when a PR exists, otherwise the worktree branch. A separate compact toolbar sits directly above the diffs in both cases, with underlined scope tabs, grouped file/change counts, and review actions. No card framing or repeated branch title is shown. Loading and failed PR lookups retain the branch header with a compact status notice. One refresh action updates both workspace changes and PR status.

Review contains separate **Changes** and **Comments** tabs. Review required/approved/changes requested are informational states. Comments fills its own page, with unresolved filtering and code-location actions. Changes offers previous/next comment controls, a comment-count button on each affected file header, and compact inline discussion markers. Each of those paths opens code directly without visiting the Comments tab; missing context loads automatically. Current markers match the PR head and line side, including resolved and file-level discussions. Outdated comments stay labeled in Comments and link to GitHub instead of guessing a current code position. Switching tabs preserves the diff scroll position.

Comments show the author's avatar and public name, with their GitHub login below when different. Missing public names fall back to the login; missing or failed avatars use an initial. Replies keep their own author identity. Expanded discussions use Paseo's Markdown renderer. Click the PR's check status for bounded CI details.

Hover a code line to reveal its green + selection handle with a plus-shaped cursor; drag it up or down to select a range, with automatic scrolling near the viewport edges. Touch clients keep the handle visible. Line-number taps and desktop/browser text selection also select ranges. Gutters and diff markers are excluded from copied code. A floating toolbar near the selected code provides Explain, Request change, Copy, and Clear without changing the diff viewport height. It hides when the selection scrolls out of view. **Explain** and **Request change** open an editable feedback draft containing the path, line range, source version, and up to 200 loaded lines. The same draft is available from PR comments and failed checks. Inside the draft, **Copy** exports the full feedback, while the floating toolbar's Copy copies only source code. **Send to agent** explicitly sends the draft to this panel's current agent. Paseo 0.15.4 does not expose a public main-composer draft setter, so the plugin uses its own feedback composer and never edits private host UI state.

Search switches between file paths and loaded code, with previous/next match controls. Folded regions show their actual unmodified-line count. Click the count to expand the region in place, then click Collapse to fold it again; cached context reopens without another request. Large regions load up to 1,000 lines per click through bounded 200-line reads, with an explicit remaining-lines action. Use the file index for navigation; the redundant bottom file/change navigation bar is removed. **File filters** offers All changed files, Unreviewed files, and Changes since baseline, with an explanation for each choice. The dialog shows the current comparison, why baseline filtering is unavailable before saving, and when a baseline was saved. Save current version as baseline captures the version you reviewed; Update baseline to current version replaces the reference for the next round. Baselines are separate for each comparison; PR changes uses the version pushed to GitHub. Subsequent edits, additions, deletions, and restored files can be compared against that saved text. A baseline captures at most 200 text files, 512 KiB per file, and 8 MiB total; omitted files are counted and later display a comparison notice. Review baselines live privately under the project host's sidecar configuration directory in `reviews/`; project files and Git's staged content remain untouched. The selected baseline is saved with the panel tab.

Check details show provider summaries and GitHub check annotations. Failed GitHub Actions jobs can include a bounded error excerpt and a source-log link. External providers such as CircleCI retain their provider links and any summary GitHub supplies; full private provider logs require that provider's own access and are not fetched with GitHub credentials.

PR status requires `gh` (GitHub CLI) installed and authenticated on the project host that runs the local sidecar bridge. No GitHub credentials are sent to the VPS or stored in this repository. Lookups use the branch's push/tracking remote and support GitHub forks by matching the head repository owner as well as the branch name. Multiple open PRs for that branch are shown; otherwise the most recently updated matching merged/closed PR is shown. Missing PRs, unavailable authentication, and failed requests are separate states. Check results refer to the PR's last pushed commit, not uncommitted local edits. GitHub operations are read-only; they do not post comments, resolve threads, create, approve, merge, or deploy a PR. Agent feedback is sent only through the feedback composer's explicit Send action.

SQLite is opened read-only. Git disables optional index refreshes, external diff drivers, and text conversion. The plugin never stages, commits, resets, or edits project files. Untracked symlinks display their target path, not file contents outside the worktree.

Binary and oversized files show a notice. New-file previews are limited to 512 KiB; Git patches to 768 KiB; file lists to 2,000 entries. Initial continuous review batches up to 80 patches and 4 MiB; other files load when selected in the index or through their load action. Git metadata is read once per batch, and unchanged review documents are cached by revision. This is a live Git view, not a recorder of intermediate edits. DevSpace's web page still provides its historical turn checkpoints.

## Configuration and troubleshooting

Configuration on each daemon machine is `~/.config/paseo-devspace-sidecar/config.json`. Local mode has `mode`, `databasePath`, `port`, and a generated `token`. Remote mode has `mode`, a loopback `endpoint`, and the same token. Keep these files private. `PASEO_DEVSPACE_SIDECAR_HOME` overrides the directory. Set local `databasePath` for a custom DevSpace state directory, then reload the plugin.

```sh
paseo plugin ls
paseo plugin logs paseo-devspace-sidecar
paseo plugin reload paseo-devspace-sidecar
```

The Mac tunnel uses `~/Library/LaunchAgents/com.normanzuo.paseo-devspace-sidecar.plist`; SSH errors are in `~/.config/paseo-devspace-sidecar/tunnel.log`. To remove the integration, uninstall the plugin on both hosts and unload that launch agent. Source and configuration remain for you to keep or delete.

Paseo 0.15.x's public plugin theme exposes colors but no typography. The isolated `client/web.ts` adapter reads only `monoFontFamily` and `codeFontSize` from the client's saved appearance settings and never writes them. Unsupported storage formats fall back to the platform monospace stack and 14px. Code rows opt out of Paseo's interface-font CSS override; native mobile clients currently use their platform monospace fallback. File names in section headers and the file index share the same 12px interface typography, 18px line height, medium weight, and 10px change counts.
