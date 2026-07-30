Status: done

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

- [x] Homebrew's plan is a single `brew cleanup` step with no additional flags.
- [x] The args contain no `--prune`, `--scrub`, or `--prune-prefix`.
- [x] The execute affordance lives on the existing `HomebrewCleanupCard` alongside the dry-run preview.
- [x] The confirmation dialog shows the exact reclaimable byte count from `HomebrewCleanupPreview`.
- [x] The confirmation dialog shows the itemized `rawOutput` list of what will be removed.
- [x] The dialog states that old versions of installed formulae will also be removed, before the user confirms.
- [x] The dialog shows the command text that will run.
- [x] The execute affordance is unavailable while the dry-run preview is still `Pending`, since there would be nothing to show.
- [x] Confirming executes the plan; cancelling executes nothing.
- [x] Pending state is shown and duplicate submissions are prevented.
- [x] Success triggers a full Homebrew refresh so the package list, path sizes, and the re-hydrated dry-run preview all update.
- [x] The reclaimable figure does not remain stale after a successful cleanup.
- [x] Failure surfaces the underlying error without hiding existing Homebrew scan data.
- [x] No affordance renders when Homebrew is `Missing`.
- [x] Homebrew scans continue to disable auto-update.
- [x] A Rust test asserts the exact `(program, args)`.
- [x] A frontend test asserts the dialog renders both the exact figure and the itemized list.
- [x] A frontend test asserts the dialog discloses the old-version removal.
- [x] Existing Homebrew formula/cask parsing, outdated/leaves merging, status, and dry-run tests pass unchanged.
- [x] `pnpm test` and `cargo test` pass.

## Blocked by

- .scratch/package-cache-cleanup/issues/01-add-cache-cleanup-plan-table-and-entry-point.md
- .scratch/package-cache-cleanup/issues/04-add-yarn-and-bun-cache-cleanup.md

## Comments

- Homebrew is the third entry-point shape in this feature. npm/pnpm/Yarn/Bun/uv hang their button on an inline path card, pip on a stacked path card, and Homebrew on its own `HomebrewCleanupCard`. Its copy entry deliberately carries **no `pathKind`**, so no button appears on the cache path card — the button has to sit beside the itemised dry-run output, because that pairing *is* the safety argument in ADR-0002.
- `ReclaimSource` gained a second member, `homebrewDryRun`. This is why the union exists: Homebrew's cache path measures one thing while `brew cleanup` removes that *plus* old Cellar versions, so only the dry-run knows the real total. A test pins this by giving the cache path 500 MB and the dry-run 1.2 GB and asserting the dialog reports 1.2 GB.
- Added `cleanupReady()`, which gates the affordance on the dry-run having landed. A `Pending` or `Failed` dry-run means there is no itemised list to confirm against, and confirming Homebrew cleanup without that list would be exactly the black-box confirmation the PRD rejects.
- `cleanupPreviewDetails()` feeds the dialog a new `reclaimDetails` prop, rendered as a scrollable block. Only Homebrew produces it; every other manager passes null.
- The description discloses the Cellar old-version removal up front, with "当前版本不受影响" so the disclosure does not read as more alarming than it is. Tested.
- Refresh needs no change: `brew cleanup` alters the package list as well as sizes, and `refresh("Homebrew")` already rescans, re-measures paths, and re-hydrates the dry-run preview — so the reclaimable figure cannot stay stale and invite a second click.
- Replaced a fragile test of my own: it counted occurrences of the button label to prove there was exactly one, which depended on `IconButton` emitting both `aria-label` and `title`. Now the component test asserts the button, the dry-run card and the itemised list coexist, and the path-card exclusion is asserted at the copy-table level where it belongs.
- Verified with `cargo test` (74 passed), `pnpm test` (60 passed, 9 new), `pnpm build`, no warnings.
- Test teeth verified by mutation on both sides: removing the dry-run gate failed 2 tests, and switching the Rust plan to `brew cleanup --prune=all` failed 2 Rust tests. Both reverted.
