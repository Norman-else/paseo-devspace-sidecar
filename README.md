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

- **Task changes** compares against the `base_sha` stored by DevSpace, including committed work, staged and unstaged edits, and untracked files.
- **Uncommitted** compares against HEAD, including staged and unstaged edits and untracked files.
- All file diffs appear in one continuous document, with syntax highlighting, old/new line numbers, colored changes, and omitted-context separators.
- Code wraps automatically to the available width, including when resizing the file index. Original source and line numbers are preserved; no horizontal scrolling is needed.
- On desktop and browser clients, code follows Paseo's saved monospace font and code size, with a 14px minimum for readability. Font changes update the review without reinstalling. Added and deleted lines use deeper, theme-derived background fills.
- Labels, commands, counts, accessibility text, and notices follow Paseo's current app language, with English and Simplified Chinese translations. Language changes take effect without reinstalling the plugin.
- The flat file index on the right jumps to the file in that document. On a narrow panel, the list button opens the same index. There is no directory tree or per-file page navigation.
- Drag the divider between the diff and the file index to resize the index. The width is saved with the tab and constrained so the code area stays usable.
- File headers fold/unfold code and let you mark files as reviewed. Markers persist with the tab and reset for a file when its patch changes. Updates run every three seconds while mounted.
- A compact PR header automatically finds GitHub pull requests for the actual worktree's branch. The repository, linked PR number, source-to-target branches, and state share a flat identity row, with the title underneath. CI results, skipped checks, review decisions, and merge conflicts use compact icon-and-text statuses; checks expand to show individual links. Multiple open PRs have a compact selector. PR data refreshes every 30 seconds and with the shared review refresh action.
- Review has one flat context header: PR details when a PR exists, otherwise the worktree branch. A separate compact toolbar sits directly above the diffs in both cases, with underlined scope tabs, grouped file/change counts, and review actions. No card framing or repeated branch title is shown. Loading and failed PR lookups retain the branch header with a compact status notice. One refresh action updates both workspace changes and PR status.

PR status requires `gh` (GitHub CLI) installed and authenticated on the project host that runs the local sidecar bridge. No GitHub credentials are sent to the VPS or stored in this repository. Lookups use the branch's push/tracking remote and support GitHub forks by matching the head repository owner as well as the branch name. Multiple open PRs for that branch are shown; otherwise the most recently updated matching merged/closed PR is shown. Missing PRs, unavailable authentication, and failed requests are separate states. Check results refer to the PR's last pushed commit, not uncommitted local edits. These operations only read status; they do not create, approve, merge, or deploy a PR.

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
