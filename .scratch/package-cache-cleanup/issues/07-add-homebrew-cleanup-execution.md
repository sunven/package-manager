Status: ready-for-agent

# Add Homebrew Cleanup Execution with Itemized Dry-Run Confirmation

## Parent

.scratch/package-cache-cleanup/PRD.md

## What to build

Homebrew's plan is a single `brew cleanup` step. It is the most safety-capable slice in this feature and also the one deliberate scope violation, both for the same reason.

Homebrew is the **only** manager with a native dry-run, and the app already runs it during scan: `HomebrewCleanupPreview` carries `rawOutput`, `reclaimedBytes`, and `reclaimedHuman`. Use it. The confirmation dialog should show the exact reclaimable byte count **and the itemized list of what will be removed**, so the user can veto something unexpected before confirming. This is the only place in the feature where the user sees specifics rather than a black box, and it is the reason Homebrew is allowed to exceed the cache-only scope at all.

The scope violation, per ADR-0002: `brew cleanup` also deletes **old versions of installed formulae** from the Cellar, which is an installed artifact, not cache. This is knowingly accepted. The dialog must say so plainly — the user should not discover it afterwards. The current version is never touched.

Use plain `brew cleanup`. Not `--prune=all`, not `--scrub`, not `--prune-prefix`.

The existing `HomebrewCleanupCard` keeps the dry-run preview and gains the execute affordance. After success, `refresh("Homebrew")` already re-hydrates the dry-run preview (`usePackageManagers.ts:383`), so the "可回收" figure must not remain stale and invite a second click.

Because `brew cleanup` removes old Cellar versions, cleanup can change the package list too — a full manager refresh is required, not just a path-size re-measure.

## Acceptance criteria

- [ ] Homebrew's plan is a single `brew cleanup` step with no additional flags.
- [ ] The args contain no `--prune`, `--scrub`, or `--prune-prefix`.
- [ ] The execute affordance lives on the existing `HomebrewCleanupCard` alongside the dry-run preview.
- [ ] The confirmation dialog shows the exact reclaimable byte count from `HomebrewCleanupPreview`.
- [ ] The confirmation dialog shows the itemized `rawOutput` list of what will be removed.
- [ ] The dialog states that old versions of installed formulae will also be removed, before the user confirms.
- [ ] The dialog shows the command text that will run.
- [ ] The execute affordance is unavailable while the dry-run preview is still `Pending`, since there would be nothing to show.
- [ ] Confirming executes the plan; cancelling executes nothing.
- [ ] Pending state is shown and duplicate submissions are prevented.
- [ ] Success triggers a full Homebrew refresh so the package list, path sizes, and the re-hydrated dry-run preview all update.
- [ ] The reclaimable figure does not remain stale after a successful cleanup.
- [ ] Failure surfaces the underlying error without hiding existing Homebrew scan data.
- [ ] No affordance renders when Homebrew is `Missing`.
- [ ] Homebrew scans continue to disable auto-update.
- [ ] A Rust test asserts the exact `(program, args)`.
- [ ] A frontend test asserts the dialog renders both the exact figure and the itemized list.
- [ ] A frontend test asserts the dialog discloses the old-version removal.
- [ ] Existing Homebrew formula/cask parsing, outdated/leaves merging, status, and dry-run tests pass unchanged.
- [ ] `pnpm test` and `cargo test` pass.

## Blocked by

- .scratch/package-cache-cleanup/issues/01-add-cache-cleanup-plan-table-and-entry-point.md
- .scratch/package-cache-cleanup/issues/04-add-yarn-and-bun-cache-cleanup.md
