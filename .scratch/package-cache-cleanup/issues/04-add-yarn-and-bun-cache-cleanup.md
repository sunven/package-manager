Status: done

# Add Yarn and Bun Cache Cleanup

## Parent

.scratch/package-cache-cleanup/PRD.md

## What to build

The two simplest full-clear plans, which also establish the **full-clear** dialog presentation: `yarn cache clean` and `bun pm cache rm`, each a single step.

Because both commands empty their cache directory outright, the already-measured cache path usage *is* the amount reclaimed. Full-clear managers therefore show that figure in the confirmation dialog — unlike prune-type managers, here the number is honest.

Yarn needs one deliberate decision honored: **Yarn 2+ gets a cleanup affordance even though `ManagerStatus::Unsupported`**. That status only denies a global package listing — `scan_yarn_modern` (`node.rs:207`) still resolves `PathKind::Cache` and measures it. Withholding the button would produce an absurd screen: "缓存 3.2 GB" displayed with no way to act, for a reason (no package listing) unrelated to what the user wants to do.

Yarn 2+ commands typically require running inside a Yarn project, and this app sets no cwd (`command.rs:88` has no `.current_dir()`), so berry's `yarn cache clean` may fail. **Do not pre-detect this.** A non-zero exit flows through the existing failure path and the dialog reports stderr faithfully, which is correct behavior. This was not verifiable locally — the machine has Yarn 1.22.22.

## Acceptance criteria

- [x] Yarn's plan is a single `yarn cache clean` step.
- [x] Bun's plan is a single `bun pm cache rm` step.
- [x] Both expose a cleanup affordance on their cache path card, following the existing `PathPanel` pattern.
- [x] The Yarn affordance renders when the manager status is `Unsupported` (Yarn 2+).
- [x] The Yarn affordance renders for Yarn Classic.
- [x] No cwd detection or berry pre-check is added; a failing berry command reports its stderr through the existing failure path.
- [x] Both confirmation dialogs show the measured cache path usage as the reclaimable figure.
- [x] Both dialogs show the command text that will run.
- [x] Confirming executes the plan; cancelling executes nothing.
- [x] Pending state is shown and duplicate submissions are prevented.
- [x] Success refreshes the manager so displayed cache usage updates.
- [x] Failure surfaces the underlying error without hiding existing scan data.
- [x] Neither affordance renders when the manager is `Missing`.
- [x] Table-driven Rust tests assert the exact `(program, args)` for both plans.
- [x] A frontend test asserts the Yarn affordance renders despite `Unsupported`.
- [x] A frontend test asserts the full-clear dialogs render a figure.
- [x] `pnpm test` and `cargo test` pass.

## Blocked by

- .scratch/package-cache-cleanup/issues/01-add-cache-cleanup-plan-table-and-entry-point.md
- .scratch/package-cache-cleanup/issues/03-migrate-pnpm-store-prune-with-prune-dialog-copy.md

## Comments

- The Rust plans and their `(program, args)` assertions already landed in issue 01, so this slice was frontend: `cleanupCopy.ts` entries for Yarn and Bun, plus the full-clear reclaim figure the PRD calls for.
- **The reclaim-figure machinery arrives here**, since Yarn and Bun are the first full-clear managers to need it. `CleanupCopy.reclaimSource` records where a figure may be sourced from and `cleanupReclaimable()` resolves it; absence of `reclaimSource` means show nothing. Issues 07 and 08 extend the `ReclaimSource` union for Homebrew's dry-run and Docker's `system df` reclaimable.
- **Applied the figure to npm too**, not just Yarn and Bun. npm is a full-clear manager and the PRD assigns it path usage; leaving it as the only full-clear cleanup without a figure would have been an arbitrary gap. The measured npm cache already includes `_npx` and the plan removes both, so the number is exact.
- **Added an explicit `Missing` guard.** The criterion was already satisfied emergently — a missing Yarn or Bun returns early from its scan and produces no cache path, so no card and no button. But that is fragile: Docker already keeps its paths when missing (`scan_docker_reports_missing_but_keeps_known_paths`), so a future manager could silently start showing a delete button while uninstalled. `PathPanel` now computes `cleanupAvailable` from the manager status once and threads one prop, rather than relying on the absence of a path.
- Yarn 2+ renders the affordance despite `Unsupported`, verified by test. No cwd detection or berry pre-check was added, per the decision: a failing berry command reports its stderr through the existing failure path. This remains unverified against a real berry install — the machine has Yarn 1.22.22.
- Corrected a weak test: the "no plan" case originally used Cargo, whose paths render as stacked cards that never carry a cleanup button, so it passed for the wrong reason. Switched to nvm, which renders inline path cards like npm and Yarn, so the assertion actually exercises the copy table's gate.
- Verified with `pnpm test` (45 passed, 8 new), `cargo test` (70 passed), `pnpm build`, no warnings.
- Test teeth verified by mutation: removing the `cleanupAvailable` guard failed the not-installed test. Reverted.
