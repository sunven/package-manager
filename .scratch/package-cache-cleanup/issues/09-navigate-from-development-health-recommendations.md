Status: done

# Make Development Health Recommendations Navigate to Their Owning Manager

## Parent

.scratch/package-cache-cleanup/PRD.md

## What to build

The Development Health page is where the user forms the intent to clean up — it ranks storage, sums `maintenanceBytes`, and lists recommendations carrying exact byte counts. Right now every one of those recommendations is a dead end, so the user has to remember which tab owns it.

Make recommendations clickable, navigating to the owning manager's tab. **They do not execute.** Execution stays anchored beside the cache path, its measured size, and the cleanup button, because the confirmation figure's provenance differs per manager (exact dry-run for Homebrew, Docker-reported reclaimable for Docker, path usage for full-clear, none for prune-type) and the user needs all three in one view to judge it. Firing a confirmation dialog from the health page would divorce it from the data justifying it.

`HealthRecommendation` already carries the manager identity needed to route. Recommendations for managers with no cleanup plan (nvm, Maven, Cargo) still navigate — landing on the tab to inspect usage is useful even when no cleanup is offered.

No batch or one-click cleanup. Per the PRD, that is the widest blast radius per misclick, and the provenance-specific figures cannot survive a combined dialog — it would degrade to one aggregate number, which is exactly the black-box confirmation rejected for individual managers, scaled up 8×.

## Acceptance criteria

- [x] Development Health recommendations are clickable.
- [x] Clicking a recommendation selects the owning manager's tab.
- [x] Clicking a recommendation executes no backend operation and opens no confirmation dialog.
- [x] Recommendations for nvm, Maven, and Cargo navigate normally.
- [x] No batch or "clean everything" affordance is added.
- [x] Keyboard activation works, and the clickable element carries an accessible label naming the destination.
- [x] Existing recommendation ordering, deduplication (`uniqueRecommendations`), and the 5-item cap are unchanged.
- [x] Existing `maintenanceBytes` and `totalBytes` computation is unchanged.
- [x] A frontend test asserts clicking a recommendation changes the selected manager.
- [x] A frontend test asserts clicking a recommendation triggers no cleanup invocation.
- [x] Existing `developmentHealth` tests pass unchanged.
- [x] `pnpm test` passes.

## Blocked by

- .scratch/package-cache-cleanup/issues/07-add-homebrew-cleanup-execution.md
- .scratch/package-cache-cleanup/issues/08-add-docker-cleanup-execution.md

## Comments

- **Most of this issue was already built.** `RecommendationRow` already had a 查看 button calling `onOpenManager(recommendation.managerId)`, and `App.tsx` already wired it to select the manager and switch views. That shipped with the Development Health Page (commit `96a8df9`), before this PRD existed. Writing the issue was worth it anyway: it surfaced that the behaviour had **zero test coverage** and one real defect.
- The defect: every row's button read 查看 and nothing else, so a screen reader user heard the same word up to five times with no way to tell which row led where. The button now carries an `aria-label` naming the manager and the recommendation.
- Added `DevelopmentHealthPage.test.tsx` — the page had no component test at all. Four tests cover the accessible label, navigation for managers with no cleanup plan (nvm/Maven/Cargo), absence of any cleanup or confirm affordance, and absence of a batch affordance.
- Two of my own test mistakes, worth recording because the second was a real methodology error:
  - The fixture title contained 清理, which tripped my own assertion.
  - More importantly, asserting the page does not contain the substring 清理 was **wrong as a test**: real recommendation text legitimately contains that word (`developmentHealth.ts:224` produces "Homebrew 清理预演有回收空间"). The assertion now targets the actual affordance labels from `cleanupCopy`, so it tests the thing it claims to test and cannot be broken by wording changes.
- Nothing in `developmentHealth.ts` was touched, so ordering, `uniqueRecommendations` deduplication, the 5-item cap, and the byte computations are unchanged by construction.
- Verified with `pnpm test` (73 passed, 4 new), `cargo test` (74 passed), `pnpm build`.
- Test teeth verified by mutation: removing the `aria-label` failed 2 tests. Reverted.
