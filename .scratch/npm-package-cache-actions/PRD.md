Status: done

# PRD: npm Package Uninstall and Cache Clean Execution

## Problem Statement

Users can already inspect npm global packages, npm cache paths, npx cache paths, global modules paths, and package-level details in Package Manager Control Center. When they find a global npm package they no longer need, or when npm cache usage is high, the app currently stops at observation: the user must leave the app and run the relevant npm command manually.

This creates friction for common npm maintenance work. It is especially easy to mistype scoped package names, choose the wrong global uninstall form, or forget the modern npm cache clean syntax.

The requested behavior is direct maintenance from the app: clicking a button or icon should execute the package uninstall or cache cleanup flow, rather than only copying a command.

Assumption: because uninstalling packages and clearing cache are destructive operations, clicking the button/icon should start an in-app execution flow with an explicit confirmation step before the npm command runs.

## Solution

Add npm-specific maintenance actions that execute through the app:

- For each npm global package row, expose an uninstall button/icon that starts an uninstall flow for that exact package.
- For npm cache maintenance, expose a cache clean button/icon near npm cache information.
- Confirm the selected destructive action before executing it.
- Execute only allowlisted npm maintenance commands through a Tauri backend command:
  - `npm uninstall -g <package-name>`
  - `npm cache clean --force`
- Show pending, success, and failure feedback in the existing message/banner style.
- Refresh the affected npm data after a successful operation so the package table and cache size do not remain stale.
- Preserve the current npm scan behavior for package list, npm cache, npx cache, global modules, and disk usage.

Success criteria:

- npm package rows expose a clickable uninstall affordance for the exact package name, including scoped names.
- npm cache information exposes a clickable cache clean affordance.
- Clicking either affordance cannot run an arbitrary command; it can only execute the intended allowlisted npm operation.
- The user sees confirmation before the destructive command executes.
- The UI shows that the operation is running and prevents duplicate submissions for the same action.
- Successful package uninstall refreshes npm package state so the removed package no longer appears after rescan.
- Successful cache clean refreshes npm cache size state so the displayed cache usage is updated.
- Failures surface stderr/stdout-tail or a useful error message without hiding the existing scan data.
- Existing npm, disk usage, frontend, and Rust tests continue to pass.

## User Stories

1. As a developer, I want to click an npm global package uninstall icon, so that I can remove an unwanted global package without leaving the app.
2. As a developer, I want the uninstall action to target the selected package name, so that I do not accidentally uninstall a different package.
3. As a developer, I want scoped npm package names to be passed correctly, so that packages such as `@scope/tool` can be uninstalled safely.
4. As a developer, I want the uninstall command to use global uninstall mode, so that it targets packages installed under npm global modules rather than a local project.
5. As a developer, I want to confirm before uninstalling, so that a misclick does not immediately remove a package.
6. As a developer, I want to see when uninstall is running, so that I do not click repeatedly or assume the app is stuck.
7. As a developer, I want uninstall success to refresh the npm package table, so that I can verify the package was removed.
8. As a developer, I want uninstall failure to show a clear error, so that I know whether npm permissions, package state, or another problem blocked the action.
9. As a developer, I want package action labels and icons to be clear, so that I can distinguish opening a package path from uninstalling it.
10. As a developer, I want to click an npm cache clean button/icon near the npm cache path, so that cache maintenance is available where cache size is displayed.
11. As a developer, I want to confirm before cleaning npm cache, so that I do not accidentally delete cache contents.
12. As a developer, I want the cache clean action to use npm's supported cache cleaning syntax, so that it works with modern npm.
13. As a developer, I want cache clean success to refresh npm cache size, so that I can see the effect of the cleanup.
14. As a developer, I want cache clean failure to show a clear error, so that I know whether permissions or npm itself blocked the action.
15. As a developer, I want npx cache path visibility to remain unchanged, so that I understand what is included under the npm cache directory.
16. As a developer, I want the app to continue avoiding double-counting npx cache usage, so that cache cleanup decisions are based on the same size semantics as today.
17. As a developer, I want uninstall and cache clean execution to appear only for npm, so that other package managers are not given incorrect npm operations.
18. As a developer, I want missing npm installations to remain reported as missing, so that action buttons are not shown as executable when npm is unavailable.
19. As a developer, I want npm scan failures to remain visible, so that action feedback does not hide package list or cache lookup errors.
20. As a developer, I want existing package paths and open-path actions to continue working, so that adding maintenance execution does not reduce current inspection features.
21. As a developer, I want operation feedback to use the existing app message patterns, so that errors and successes feel consistent with scan/copy/open behavior.
22. As a developer, I want the implementation to avoid shell string execution, so that package names are passed as structured arguments rather than interpolated into shell text.
23. As a maintainer, I want npm uninstall execution covered by tests, so that future changes do not silently remove or loosen the allowlisted command behavior.
24. As a maintainer, I want npm cache clean execution covered by tests, so that cache maintenance remains constrained to the intended npm command.
25. As a maintainer, I want UI execution states covered by tests, so that confirmation, pending state, success, failure, and duplicate-click prevention remain stable.
26. As a maintainer, I want docs updated to describe the new safety model, so that README no longer says npm uninstall/cache clean are only out-of-scope copy commands.

## Implementation Decisions

- Add direct npm maintenance execution; do not limit the feature to copying commands.
- Keep execution allowlisted and structured. The backend should expose explicit npm maintenance operations rather than accepting arbitrary command strings from the frontend.
- Execute npm global package uninstall as program `npm` with arguments for global uninstall and the selected package name.
- Execute npm cache cleanup as program `npm` with arguments for cache clean and force.
- The frontend should trigger execution from a button or icon in the npm package row for uninstall and near the npm cache path/card for cache clean.
- Destructive execution should require an explicit confirmation step before the backend command runs.
- While an npm maintenance action is running, the relevant action should show a pending state and prevent duplicate submissions.
- After successful uninstall, refresh npm manager data so package rows, paths, failures, and status are consistent with current disk state.
- After successful cache clean, refresh npm cache disk usage at minimum; refreshing the full npm manager is acceptable if it better matches existing state flow.
- Failure output should be surfaced through the existing message/banner system with enough context for the user to diagnose permissions, missing npm, timeout, or npm command errors.
- Keep npx cache represented as a child path of npm cache. The feature does not introduce separate npx cache cleanup.
- Keep scan commands read-only: version probe, global package list, cache path lookup, and global root lookup remain the only commands executed during normal scan.
- Tauri permissions and command handlers should be reviewed because this feature changes the safety model from observation/copy/open to destructive execution.
- Update user-facing Chinese labels and accessible labels so uninstall and cache clean execution actions are specific and not confused with copy actions.
- Update README feature list, current boundary, safety strategy, and verified behavior once implementation lands.

## Testing Decisions

- Good tests should assert external behavior: allowlisted npm operations execute the expected structured command, arbitrary command execution is not possible through the public API, UI confirmation gates execution, and state refresh/feedback occurs after success or failure.
- Rust backend tests should cover npm maintenance execution with a fake runner: successful uninstall, failed uninstall, successful cache clean, failed cache clean, timeout or missing binary where feasible, and scoped package name handling.
- Rust backend tests should verify the command runner receives structured args and not a shell string.
- Frontend tests should cover clicking the npm package uninstall button/icon, confirming the action, pending state, success feedback, failure feedback, and no duplicate execution while pending.
- Frontend tests should cover clicking the npm cache clean button/icon, confirming the action, pending state, success feedback, failure feedback, and cache size refresh behavior.
- Existing path formatting tests should remain valid: `Cache` is counted, `NpxCache` is not counted separately, and npm cache/npx cache labels still render correctly.
- Existing package action tests should remain valid for package name copy/open-path behavior, if those affordances remain.
- Regression checks should include `pnpm test`, `pnpm build`, and `cd src-tauri && cargo test`.
- Manual verification should include scanning npm, uninstalling a harmless test global package, confirming the package disappears after refresh, cleaning npm cache, confirming cache size refreshes, and confirming neither action is available when npm is missing.

## Out of Scope

- Arbitrary command execution from the frontend.
- Batch uninstall for multiple packages.
- Per-package size analysis.
- Cleaning npx cache separately from npm cache.
- Modifying npm config.
- Adding equivalent direct execution for pnpm, Yarn, Bun, uv, Homebrew, Maven, pip, Cargo, or Docker.
- Discovering local project dependencies or uninstalling local project packages.
- Managing packages inside each nvm-installed Node runtime.
- Operation history or audit log beyond immediate success/failure feedback.
- Undo or automatic reinstall after uninstall.

## Further Notes

- This PRD intentionally changes the prior safe-action boundary for npm only. The implementation should be narrow and explicit.
- If the team later wants direct execution for other package managers, it should be handled by separate PRDs or issues because each manager has different destructive command semantics.
- The implementation should keep the diff surgical: explicit npm maintenance commands, confirmation UI, pending/result state, refresh behavior, docs, and tests.
## Comments

- Completed implementation. Verified with `pnpm test`, `pnpm build`, and `cd src-tauri && cargo test`.
