Status: done

# 单条会话记录移入废纸篓

## Parent

.scratch/session-record-removal/PRD.md

## What to build

Let either source move one session record to the trash. The page asks for confirmation and shows that record's title. Cancelling moves nothing.

Removal is decided by the backend, one source at a time. The frontend does not choose a raw path. At the moment of moving, the record must still be a session record and must not be in use. A newer last activity time does not cancel a single removal. An in-use record has no working removal action.

Moving to the trash is a replaceable action. The removal decides which path qualifies, then hands that path to the action. Tests record the path and do not call the system trash. The shipping action moves the file into the system trash.

When the move finishes, the page reads that source again and reports how many records moved and how many failed. A record already handed to the trash stays there.

## Acceptance criteria

- [x] Codex and Claude each offer single removal of one listed record.
- [x] Confirmation names the record's title. Cancel moves nothing.
- [x] An in-use record cannot be single-removed.
- [x] At move time, a record that is no longer a session record, or is now in use, stays in place.
- [x] A last-activity update does not cancel a single removal.
- [x] The path handed to the trash action is still a regular `.jsonl` file inside that source directory, and is not a symlink.
- [x] Tests use a stand-in trash action and assert the handed path. They do not touch the system trash or the user's home.
- [x] The result reports the moved count and the failed count.
- [x] After the action, that source is read again and a moved record no longer appears.

## Blocked by

- .scratch/session-record-removal/issues/02-list-claude-session-records.md
