Status: done

# PRD: pnpm Global Package Uninstall and Store Prune Execution

## Problem Statement

Users can already inspect pnpm global packages, pnpm store path, global modules path, package-level details, and hardlink-aware disk usage in Package Manager Control Center. When they find a pnpm global package they no longer need, or when pnpm store usage is high, the app currently stops at observation: the user must leave the app and run the relevant pnpm command manually.

This creates friction for common pnpm maintenance work. It is easy to mistype scoped package names, run a local remove instead of a global remove, or forget that store cleanup should prune unreferenced store packages rather than deleting the whole store directory.

The requested behavior is direct pnpm maintenance from the app: clicking a button or icon should execute the package uninstall or store cleanup flow, rather than only copying a command.

Assumption: because uninstalling packages and pruning store contents are destructive operations, clicking the button or icon should start an in-app execution flow with an explicit confirmation step before pnpm runs.

## Solution

Add pnpm-specific maintenance actions that execute through the app:

- For each pnpm global package row, expose an uninstall button or icon that starts an uninstall flow for that exact package.
- For pnpm store maintenance, expose a store prune button or icon near pnpm store information.
- Confirm the selected destructive action before executing it.
- Execute only allowlisted pnpm maintenance commands through a Tauri backend command:
  - `pnpm remove --global <package-name>`
  - `pnpm store prune`
- Show pending, success, and failure feedback in the existing message/banner style.
- Refresh the affected pnpm data after a successful operation so the package table and store size do not remain stale.
- Preserve the current pnpm scan behavior for package list, store path, global modules path, and hardlink-aware disk usage.

Success criteria:

- pnpm package rows expose a clickable uninstall affordance for the exact package name, including scoped names.
- pnpm store information exposes a clickable store prune affordance.
- Clicking either affordance cannot run an arbitrary command; it can only execute the intended allowlisted pnpm operation.
- The user sees confirmation before the destructive command executes.
- The UI shows that the operation is running and prevents duplicate submissions for the same action.
- Successful package uninstall refreshes pnpm package state so the removed package no longer appears after rescan.
- Successful store prune refreshes pnpm store size state so displayed usage updates.
- Failures surface stderr/stdout-tail or a useful error message without hiding the existing scan data.
- Existing npm maintenance behavior, pnpm scanning, disk usage, frontend tests, and Rust tests continue to pass.

## User Stories

1. As a developer, I want to click a pnpm global package uninstall icon, so that I can remove an unwanted global package without leaving the app.
2. As a developer, I want the uninstall action to target the selected pnpm package name, so that I do not accidentally uninstall a different package.
3. As a developer, I want scoped pnpm package names to be passed correctly, so that packages such as `@scope/tool` can be uninstalled safely.
4. As a developer, I want the uninstall command to use global remove mode, so that it targets pnpm global packages rather than a local project dependency.
5. As a developer, I want to confirm before uninstalling a pnpm package, so that a misclick does not immediately remove a package.
6. As a developer, I want to see when pnpm uninstall is running, so that I do not click repeatedly or assume the app is stuck.
7. As a developer, I want uninstall success to refresh the pnpm package table, so that I can verify the package was removed.
8. As a developer, I want uninstall failure to show a clear error, so that I know whether permissions, package state, missing global bin setup, or another pnpm problem blocked the action.
9. As a developer, I want package action labels and icons to be clear, so that I can distinguish opening a package path from uninstalling it.
10. As a developer, I want to click a pnpm store prune button or icon near the pnpm store path, so that store maintenance is available where store size is displayed.
11. As a developer, I want to confirm before pruning the pnpm store, so that I do not accidentally remove reusable store contents.
12. As a developer, I want the store cleanup action to use pnpm's store prune command, so that it removes unreferenced store packages instead of deleting the store directory.
13. As a developer, I want store prune success to refresh pnpm store size, so that I can see the effect of the cleanup.
14. As a developer, I want store prune failure to show a clear error, so that I know whether permissions or pnpm itself blocked the action.
15. As a developer, I want pnpm store hardlink-aware disk usage to remain accurate, so that cleanup decisions are based on the same size semantics as today.
16. As a developer, I want uninstall and store prune execution to appear only for pnpm, so that other package managers are not given incorrect pnpm operations.
17. As a developer, I want missing pnpm installations to remain reported as missing, so that action buttons are not shown as executable when pnpm is unavailable.
18. As a developer, I want pnpm scan failures to remain visible, so that action feedback does not hide package list, store path, or global modules lookup errors.
19. As a developer, I want existing package paths and open-path actions to continue working, so that adding maintenance execution does not reduce current inspection features.
20. As a developer, I want operation feedback to use the existing app message patterns, so that errors and successes feel consistent with scan/copy/open behavior.
21. As a developer, I want the implementation to avoid shell string execution, so that package names are passed as structured arguments rather than interpolated into shell text.
22. As a developer, I want pnpm actions to follow the same confirmation safety model as npm maintenance, so that destructive package-manager actions feel predictable.
23. As a maintainer, I want pnpm uninstall execution covered by tests, so that future changes do not silently remove or loosen the allowlisted command behavior.
24. As a maintainer, I want pnpm store prune execution covered by tests, so that store maintenance remains constrained to the intended pnpm command.
25. As a maintainer, I want UI execution states covered by tests, so that confirmation, pending state, success, failure, and duplicate-click prevention remain stable.
26. As a maintainer, I want docs updated to describe the expanded safety model, so that README no longer implies pnpm maintenance is copy-only or out of scope.

## Implementation Decisions

- Add direct pnpm maintenance execution; do not limit the feature to copying commands.
- Keep execution allowlisted and structured. The backend should expose explicit pnpm maintenance operations rather than accepting arbitrary command strings from the frontend.
- Execute pnpm global package uninstall as program `pnpm` with arguments for global remove and the selected package name.
- Execute pnpm store cleanup as program `pnpm` with arguments for store prune.
- The frontend should trigger execution from a button or icon in the pnpm package row for uninstall and near the pnpm store path/card for store prune.
- Destructive execution should require an explicit confirmation step before the backend command runs.
- While a pnpm maintenance action is running, the relevant action should show a pending state and prevent duplicate submissions.
- After successful uninstall, refresh pnpm manager data so package rows, paths, failures, and status are consistent with current disk state.
- After successful store prune, refresh pnpm store disk usage at minimum; refreshing the full pnpm manager is acceptable if it better matches existing state flow.
- Failure output should be surfaced through the existing message/banner system with enough context for the user to diagnose permissions, missing pnpm, timeout, global package state, or pnpm command errors.
- Keep scan commands read-only: version probe, global package list, store path lookup, and global root lookup remain the only commands executed during normal scan.
- Reuse the npm maintenance safety pattern where practical, but keep pnpm operation types, copy, labels, and command mapping explicit so npm and pnpm cannot be confused.
- Tauri permissions and command handlers should be reviewed because this feature expands the safety model from npm-only destructive execution to pnpm destructive execution.
- Update user-facing Chinese labels and accessible labels so uninstall and store prune execution actions are specific and not confused with copy actions.
- Update README feature list, current boundary, safety strategy, out-of-scope section, and verified behavior once implementation lands.

## Testing Decisions

- Good tests should assert external behavior: allowlisted pnpm operations execute the expected structured command, arbitrary command execution is not possible through the public API, UI confirmation gates execution, and state refresh/feedback occurs after success or failure.
- Rust backend tests should cover pnpm maintenance execution with a fake runner: successful uninstall, failed uninstall, scoped package uninstall, successful store prune, failed store prune, timeout or missing binary where feasible, and absence of arbitrary command execution.
- Rust backend tests should verify the command runner receives structured args and not a shell string.
- Frontend tests should cover clicking the pnpm package uninstall button/icon, confirming the action, pending state, success feedback, failure feedback, and no duplicate execution while pending.
- Frontend tests should cover clicking the pnpm store prune button/icon, confirming the action, pending state, success feedback, failure feedback, and store size refresh behavior.
- Existing pnpm package-table tests should remain valid: pnpm uses the compact table columns while still preserving package actions.
- Existing path formatting and disk usage tests should remain valid: pnpm store/global modules retain hardlink-aware size semantics and do not double-count shared physical files.
- Existing npm maintenance tests should remain valid so adding pnpm execution does not regress npm uninstall or npm cache clean.
- Regression checks should include `pnpm test`, `pnpm build`, and `cd src-tauri && cargo test`.
- Manual verification should include scanning pnpm, uninstalling a harmless test global package, confirming the package disappears after refresh, pruning pnpm store, confirming store size refreshes, and confirming neither action is available when pnpm is missing.

## Out of Scope

- Arbitrary command execution from the frontend.
- Batch uninstall for multiple packages.
- Per-package size analysis.
- Deleting the pnpm store directory directly.
- Running `pnpm store prune` automatically without explicit confirmation.
- Modifying pnpm config.
- Adding equivalent direct execution for Yarn, Bun, uv, Homebrew, Maven, pip, Cargo, Docker, or nvm.
- Changing the existing npm maintenance command semantics.
- Discovering local project dependencies or uninstalling local project packages.
- Operation history or audit log beyond immediate success/failure feedback.
- Undo or automatic reinstall after uninstall.

## Further Notes

- This PRD intentionally changes the prior safe-action boundary for pnpm only. The implementation should be narrow and explicit.
- pnpm store cleanup should be described as pruning unreferenced store packages, not as clearing every cached file.
- If the team later wants direct execution for other package managers, it should be handled by separate PRDs or issues because each manager has different destructive command semantics.
- The implementation should keep the diff surgical: explicit pnpm maintenance commands, confirmation UI, pending/result state, refresh behavior, docs, and tests.

## Comments

> *This was generated by AI during triage.*

All implementation issues for this PRD are complete:

- `.scratch/pnpm-package-store-actions/issues/01-add-pnpm-maintenance-execution-allowlist.md`
- `.scratch/pnpm-package-store-actions/issues/02-confirm-and-execute-pnpm-package-uninstall.md`
- `.scratch/pnpm-package-store-actions/issues/03-confirm-and-execute-pnpm-store-prune.md`

Verified with `pnpm test`, `pnpm build`, and `cd src-tauri && cargo test`.
