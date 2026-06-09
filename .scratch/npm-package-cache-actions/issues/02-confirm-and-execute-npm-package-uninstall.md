Status: done

# Confirm and Execute npm Package Uninstall

## Parent

.scratch/npm-package-cache-actions/PRD.md

## What to build

Add a complete npm package uninstall flow from the package table. Each npm global package row should expose a clear uninstall button or icon. Clicking it should ask for explicit confirmation, execute the allowlisted npm global uninstall operation for that selected package, show pending/success/failure feedback, and refresh npm manager data after success so the package table reflects the current global package state.

This slice should preserve existing package inspection behavior such as copying package names and opening package paths.

## Acceptance criteria

- [x] npm package rows expose a clear uninstall button or icon for each global package.
- [x] The uninstall affordance is shown only for npm package rows.
- [x] Clicking uninstall opens an explicit confirmation step before npm is executed.
- [x] Confirming calls the allowlisted npm package uninstall backend operation for the selected package.
- [x] Cancelling the confirmation does not execute any backend maintenance operation.
- [x] While uninstall is running, the relevant action shows a pending state and duplicate submissions are prevented.
- [x] Successful uninstall shows success feedback through the existing app message/banner style.
- [x] Successful uninstall refreshes npm manager data so removed packages disappear after rescan.
- [x] Failed uninstall shows a useful error message without hiding existing npm scan data.
- [x] Existing copy package, package action menu, selection, and open path behavior continue to work.
- [x] Frontend tests cover confirmation gating, successful execution, failure feedback, pending state, and duplicate-click prevention.
- [x] README safety and feature documentation no longer describes npm uninstall as only an out-of-scope copied command.

## Blocked by

- .scratch/npm-package-cache-actions/issues/01-add-npm-maintenance-execution-allowlist.md
## Comments

- Completed implementation. Verified with `pnpm test`, `pnpm build`, and `cd src-tauri && cargo test`.
