Status: done

# 会话记录页列出 Codex 会话记录

## Parent

.scratch/session-record-removal/PRD.md

## What to build

Add a page named 会话记录, alongside project cleanup and VS Code storage, and not part of development health. The first slice shows only the Codex section.

Resolve one Codex home: `CODEX_HOME` when set, otherwise the user's `.codex` directory. List session records only from that home's `sessions` directory. A session record is a regular `.jsonl` file inside that directory. Directories, other filenames, and symlinks are not session records and do not appear. Do not follow symlinks. There is no directory picker.

Each record shows its title, last activity time, working directory, and size. The title comes from the record content; when the content has no title, use the file name. The working directory comes from the content; when it is absent, the record still appears and that cell is empty. Size is the file's logical length. Last activity is the latest moment recorded inside the file, not the file's modification time. A record whose file is open by another process is in use: it stays in its month group and is visibly marked as not removable yet.

Group records by the local calendar year and month of last activity, newest month first. Months collapse. Each group shows its count and total size. Records with no readable last activity form their own group.

When the sessions directory does not exist, the Codex section is empty rather than a failed page. Entering the page reads again. A manual refresh reads again while the page stays open. The section shows the record count and total size, and states that this size leaves the original directory but physical space is released only after the trash is emptied.

The frontend does not walk the disk itself. Tests use a temporary directory and do not touch the user's real home.

## Acceptance criteria

- [x] The app has a 会话记录 page separate from project cleanup and development health.
- [x] Development health does not read or total session records.
- [x] Codex records come only from the resolved home's `sessions` directory.
- [x] Only regular `.jsonl` files are listed. Symlinks, directories, and other files are absent.
- [x] Each row shows title, last activity, working directory, and logical file size.
- [x] A missing title falls back to the file name. A missing working directory leaves that cell empty and still lists the record.
- [x] Records group by local year and month of last activity, newest first. A month can collapse and shows its count and size.
- [x] Records with no last activity sit in their own group.
- [x] In-use records stay in their month and are marked as not removable.
- [x] A missing sessions directory shows an empty Codex section.
- [x] Entering the page reads again, and the page can be refreshed manually.
- [x] The section shows count and total size, and says space is released only when the trash is emptied.
- [x] Rust tests on a temporary directory cover which files appear, the displayed fields, in-use marking, and a missing directory.
- [x] Frontend policy tests cover local month grouping, newest-first order, and the no-last-activity group.

## Blocked by

None - can start immediately
