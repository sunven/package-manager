Status: done

# Add Docker Cleanup as a Two-Step Build Cache and Dangling Image Prune

## Parent

.scratch/package-cache-cleanup/PRD.md

## What to build

Docker is the only manager whose plan is genuinely multi-step, so it is the real exercise of the step-sequence and partial-completion machinery from issue 01.

The plan is `docker builder prune -f`, then `docker image prune -f`. Build cache is pure derived data. Dangling images qualify because Docker itself guarantees they carry no tag and no container reference — a structural orphan, which is a stronger safety case than the Cellar old versions already accepted for Homebrew in ADR-0002.

**Hard boundaries.** Never `-a` on `image prune` (that removes tagged images not currently referenced by a container, including ones the user deliberately pulled). Never `docker system prune`. Never `--volumes`. Containers and volumes are never touched under any circumstance.

The dialog figure comes from `docker system df` reclaimable, already captured at scan time in `DockerDiskUsageRow.reclaimable`. Note this figure covers more resource types than the plan actually prunes, so present it as reclaimable space reported by Docker rather than implying the plan will reclaim all of it.

Partial completion matters most here. If `builder prune` succeeds and `image prune` fails, the user must be told build cache was reclaimed and image pruning was not — otherwise they retry and cannot tell what already happened. The most likely failure is a stopped Docker daemon, which will fail the first step; execution stops there rather than hitting the same wall twice.

This also makes actionable the `docker-cleanup-signals` recommendation that `developmentHealth.ts:279` already computes from `danglingImageCount` and `unusedImageCount`.

## Acceptance criteria

- [x] Docker's plan is exactly two steps: `docker builder prune -f`, then `docker image prune -f`.
- [x] The args contain no `-a` or `--all`.
- [x] The args contain no `system`.
- [x] The args contain no `--volumes`.
- [x] No step removes containers or volumes.
- [x] A cleanup affordance appears in the Docker view.
- [x] The confirmation dialog shows the `docker system df` reclaimable figure.
- [x] The dialog makes clear the figure is Docker's reported reclaimable space, not a promise that the plan reclaims all of it.
- [x] The dialog states that build cache and dangling images will be removed, and that tagged images, containers, and volumes will not.
- [x] The dialog shows both command texts that will run.
- [x] Confirming executes the plan; cancelling executes nothing.
- [x] `builder prune` succeeding and `image prune` failing reports **partially completed**, naming which step reclaimed space and which failed.
- [x] `builder prune` failing stops execution; `image prune` does not run.
- [x] A stopped Docker daemon produces a useful error rather than a generic failure.
- [x] Pending state is shown and duplicate submissions are prevented.
- [x] Success refreshes Docker so image/container/volume counts and disk usage rows update.
- [x] Failure surfaces the underlying error without hiding existing Docker scan data.
- [x] No affordance renders when Docker is `Missing`.
- [x] Table-driven Rust tests assert the exact `(program, args)` of both steps and the absence of `-a`, `system`, and `--volumes`.
- [x] Fake-runner tests cover both-succeed, first-fails, and second-fails, asserting the reported state in each case.
- [x] A frontend test asserts partial completion renders as partial, not as failure.
- [x] `pnpm test` and `cargo test` pass.

## Blocked by

- .scratch/package-cache-cleanup/issues/01-add-cache-cleanup-plan-table-and-entry-point.md
- .scratch/package-cache-cleanup/issues/02-migrate-npm-cache-clean-and-guard-npx-deletion.md

## Comments

- The button lives in `DockerSummary` inside `PackageTable`, not on a path card. Docker's reclaimable figures render there, and the PRD anchors execution beside the data that justifies it. Docker's copy entry carries no `pathKind` for the same reason Homebrew's does not: the plan spans build cache *and* dangling images, so no single directory owns it. This is the fourth entry-point shape in the feature.
- **Deviation from one acceptance criterion, deliberately.** The criterion says the dialog shows "the `docker system df` reclaimable figure" — singular. It shows the **per-resource-type rows** instead, with no aggregate. Two reasons: the rows are pre-formatted display strings (`1.8GB`), so summing them would mean parsing display text; and more importantly `system df` reports reclaimable space for volumes and containers this plan never removes, so a single total would be a figure the plan cannot deliver. The criterion's intent — tell the user what Docker says is reclaimable without implying the plan reclaims all of it — is met more honestly by the breakdown.
- A test asserts **Local Volumes are excluded from the displayed rows**. A user staring at "9GB reclaimable" next to a confirm button would reasonably expect that space back; volumes are never pruned, so showing that row would be a lie regardless of what the plan does.
- The description states positively what survives: 已打 tag 的镜像、容器和卷不会被删除. The dangerous flags stay absent and are guarded by Rust tests (`-a`, `--all`, `system`, `--volumes`, `container`, `volume`).
- **Partial completion is exercised end-to-end for the first time.** Until now the three-state model and the `warn` tone only had unit coverage in `cleanup.rs`; Docker is the only manager whose plan really runs two commands. Three tests cover it: build-cache-succeeded-then-image-prune-failed reports what ran and what did not, the UI renders it in the `warn` tone with the dialog left open, and an unreachable daemon fails the first step, skips the second, and reports plain failure with the daemon's own stderr.
- Verified with `cargo test` (74 passed), `pnpm test` (69 passed, 9 new), `pnpm build`, no warnings.
- Test teeth verified by mutation on both sides: dropping the resource-type filter leaked volumes into the figures and failed that test, and adding `-a` to the image prune failed 2 Rust tests. Both reverted.
