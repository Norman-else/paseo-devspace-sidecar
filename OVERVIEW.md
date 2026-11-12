# DevSpace Diff

View actual DevSpace worktree changes inside Paseo, including when the agent runs on a VPS and the project lives on your Mac.

Open **Review** (**审阅** in Chinese) from the composer pill, Command Center, or `/devspace-diff`. The composer pill appears only for sessions associated with DevSpace. It automatically identifies the worktree from this agent's recent DevSpace tool calls. No workspace selection is needed.

**Task changes** includes all changes since the task's starting commit, even after committing. **Uncommitted** combines staged, unstaged, and new files against HEAD. All file diffs appear in one continuous review, with a flat file index on the right for navigation. Files have collapsible headers, syntax highlighting, line numbers, Git colors, and reviewed markers. Updates run every three seconds; reviewed markers reset when the file's patch changes.

Long code wraps to fit the code area, and the file index can be resized by dragging its divider. Labels follow Paseo's English or Simplified Chinese language setting automatically.

A flat header shows the branch's GitHub PR, including draft/open/merged/closed state, CI checks, review decisions, and merge conflicts. It refreshes every 30 seconds and links to GitHub. The project machine needs an authenticated GitHub CLI; repository and branch metadata are queried through it, while credentials stay on that machine. PR status is read-only and does not create, approve, merge, or deploy changes.

When a PR exists, switch between its submitted changes and local changes not present in that PR. Use the separate Comments tab to read discussions with author names and avatars, or open their code directly from file comment counts and previous/next comment controls. Inline markers expand in place. Filter unresolved threads, inspect check details, and prepare feedback for the current agent. Feedback opens an editable draft and is sent only when you select Send to agent. GitHub Actions failures can include error excerpts; external CI checks link to their own providers.

Expand omitted code context, search loaded diff text, and navigate files from the flat index. Save a review point to compare later edits with reviewed text. Review points are private sidecar state, limited to 200 text files and 8 MiB, with a 512 KiB per-file limit. Omitted files are reported. Code selection uses draggable green + handles and a nearby floating action toolbar. Mobile layouts keep feedback available without a directory tree or a bottom operation bar.

The project machine runs an authenticated read service over a private SSH tunnel. Requires Paseo >=0.15.4 and DevSpace's SQLite workspace registry. Configuration is in `~/.config/paseo-devspace-sidecar/config.json` on each host.

Git operations are read-only. Binary and oversized files show a notice. Local new-file previews are limited to 512 KiB, Git patches to 768 KiB, and file lists to 2,000 entries. The initial local review loads up to 80 patches and 4 MiB; other patches load when selected. Disconnected hosts report an error. Refreshing the same review source retains its displayed document while new data loads. This view shows current Git changes; it does not record every intermediate edit.
