Status: done

# Confirm and Execute npm Cache Clean

## Parent

.scratch/npm-package-cache-actions/PRD.md

## What to build

Add a complete npm cache clean flow from the npm cache area. The npm cache path or cache card should expose a clear clean button or icon. Clicking it should ask for explicit confirmation, execute the allowlisted npm cache clean operation, show pending/success/failure feedback, and refresh npm cache size or npm manager data after success so the cache display is not stale.

This slice should keep npx cache visible as part of npm cache context and preserve the existing no-double-counting size semantics.

## Acceptance criteria

- [x] npm cache information exposes a clear clean button or icon near the npm cache path or cache card.
- [x] The cache clean affordance is shown only for npm cache information.
- [x] Clicking cache clean opens an explicit confirmation step before npm is executed.
- [x] Confirming calls the allowlisted npm cache clean backend operation.
- [x] Cancelling the confirmation does not execute any backend maintenance operation.
- [x] While cache clean is running, the relevant action shows a pending state and duplicate submissions are prevented.
- [x] Successful cache clean shows success feedback through the existing app message/banner style.
- [x] Successful cache clean refreshes npm cache size or npm manager data so displayed cache usage updates.
- [x] Failed cache clean shows a useful error message without hiding existing npm scan data.
- [x] npx cache remains visible under npm cache context.
- [x] npx cache remains excluded from separate counted-size totals to avoid double-counting.
- [x] Frontend tests cover confirmation gating, successful execution, failure feedback, pending state, duplicate-click prevention, and cache size refresh behavior.
- [x] README safety and feature documentation no longer describes npm cache clean as only an out-of-scope copied command.

## Blocked by

- .scratch/npm-package-cache-actions/issues/01-add-npm-maintenance-execution-allowlist.md
## Comments

- Completed implementation. Verified with `pnpm test`, `pnpm build`, and `cd src-tauri && cargo test`.
