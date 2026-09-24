Status: done

# 按 7 天和 30 天批量移入废纸篓

## Parent

.scratch/session-record-removal/PRD.md

## What to build

On each source, offer two bulk removals: last activity older than 7 periods of 24 hours, and older than 30 periods of 24 hours. One confirmation covers one source only. It names the source, the number of days, and how many records would move, and it says that in-use records and records with no last activity are not included. When that count is zero, no confirmation opens. Month groups stay a way to look at records; there is no per-month removal and no custom age.

At the moment each file moves, it must still have a last activity older than the threshold, still be a session record, and still not be in use. A file that no longer qualifies stays. One file failing to move does not stop the rest of that source. The result reports how many moved and how many failed. Records already handed to the trash stay there. Afterward, that source is read again.

The trash action remains the replaceable one from single removal. Tests use a temporary directory and a stand-in action.

## Acceptance criteria

- [x] Each source has a 7-day action and a 30-day action. One confirmation never includes both sources.
- [x] Confirmation names the source, the day count, and the number of records that currently qualify.
- [x] Confirmation states that in-use records and records with no last activity are excluded.
- [x] A zero qualifying count does not open confirmation.
- [x] The threshold is last activity earlier than now minus 7 or 30 periods of 24 hours.
- [x] At move time, a record whose last activity is no longer past the threshold stays.
- [x] At move time, a record that is in use, or is no longer a session record, stays.
- [x] One failed file does not stop the remaining qualifying files. The result reports moved and failed counts.
- [x] Records already handed to the trash stay handed over when a later file fails.
- [x] Tests use a temporary directory and a stand-in trash action. They do not touch the system trash or the user's home.
- [x] After the action, that source is read again.

## Blocked by

- .scratch/session-record-removal/issues/03-remove-one-session-record.md
