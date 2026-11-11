# DevSpace Diff

View actual DevSpace worktree changes inside Paseo, including when the agent runs on a VPS and the project lives on your Mac.

Open **DevSpace Diff** from the composer pill, Command Center, or `/devspace-diff`. The composer pill appears only for sessions associated with DevSpace. It automatically identifies the worktree from this agent's recent DevSpace tool calls. No workspace selection is needed.

**Task changes** includes all changes since the task's starting commit, even after committing. **Uncommitted** combines staged, unstaged, and new files against HEAD. All file diffs appear in one continuous review, with a flat file index on the right for navigation. Files have collapsible headers, syntax highlighting, line numbers, Git colors, and reviewed markers. Updates run every three seconds; reviewed markers reset when the file's patch changes.

Long code wraps to fit the code area, and the file index can be resized by dragging its divider. Labels follow Paseo's English or Simplified Chinese language setting automatically.

The project machine runs an authenticated read service over a private SSH tunnel. Requires Paseo >=0.15.4 and DevSpace's SQLite workspace registry. Configuration is in `~/.config/paseo-devspace-sidecar/config.json` on each host.

Git operations are read-only. Binary and oversized files show a notice. New-file previews are limited to 512 KiB, Git patches to 768 KiB, and file lists to 2,000 entries. The initial review loads up to 80 patches and 4 MiB; other patches load when selected. Disconnected hosts show an error and retain any prior snapshot. This view shows current Git changes; it does not record every intermediate edit.
