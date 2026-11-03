# Changelog

本文件由 git-cliff 生成，记录每个发布版本的变更。

## [0.1.5] - 2026-11-03

### Bug Fixes

- **macos**: Restore shell PATH before scanning managers

## [0.1.4] - 2026-11-03

### Features

- **claude**: Load plugin inventory on demand
- **vscode**: Add per-row removal action to workspace records

### Miscellaneous

- Rename product to Clean Up

### Performance

- **sessions**: Cache scans and stream source loads

## [0.1.3] - 2026-10-31

### Bug Fixes

- Allow opening package manager paths
- Ui
- Improve maintenance UI readability and accessibility
- Improve overview layout and responsive spacing
- Refine UI colors, layout, and accessibility
- Clarify maintenance actions and scan states
- **release**: Brace VERSION before CJK punctuation
- **deps**: Align @tauri-apps/api with tauri crate 2.12

### Documentation

- Plan cache cleanup execution across package managers

### Features

- Init
- Add Homebrew maintenance dashboard
- Add package manager shell and UI components
- Show per-path disk usage
- Add npx cache support and localization in path formatting
- Enhance styling and theming with new CSS variables and imports
- Add Toggle component and integrate with existing UI components
- Replace ToggleGroup with Tabs component for improved UI navigation
- Add path copy and open functionality in PackageTable and PathPanel components
- Refactor App component, remove FailurePanel, and enhance ManagerTabs and PathPanel for improved UI and functionality
- 添加对 Cargo 包管理器的支持，包括路径扫描、版本检测和命令复制功能
- 移除 Overview 组件，优化 Shell 和 App 组件，增强 UI 显示总占用信息
- Add structured learning and teaching documentation
- Add Development Health Page with metrics and recommendations
- Add cleanup functionality for various package managers with tests
- Add Rust build artifact cleanup
- Add node_modules project cleanup
- Redesign control center interface
- Add VS Code 占用
- Add Codex and Claude session record removal
- Remove several selected session records at once
- Put view navigation in the window title bar
- Session record sorting and per-tab refresh
- Add the overview dashboard
- Add FVM read-only observation
- Redesign polish and clear overview page
- Project cleanup result tabs, header sorting, and compact layout
- Inline cleanup totals into result header and wrap manager tabs
- Improve scan overview, diagnostics, and cleanup workflows
- Add agent
- Upgrade skills
- Add Codex plugin management
- Add Codex marketplace source management
- Add Codex hooks management
- Organize Codex plugins by marketplace
- Complete Codex marketplace and plugin management
- Add Codex hook definition configuration management
- Clean Maven build directories via delegated mvn clean
- Add Claude Code marketplace, plugin and hook management
- Codex skill
- Add Claude Code skill management
- Add cross-manager search, diagnostics, and history
- Cargo
- Add script
- Remove impeccable skill
- Clean
- Redesign DevScope UI across all pages
- Add skill
- Add Qoder session records for both editions
- Group session records by project
- Add Android SDK component inventory and removal

### Miscellaneous

- Refine package row actions menu
- Add Maven and pip package health scans
- Localize package manager UI to Chinese
- Move Homebrew stats into filters
- Add nvm manager and polish path display
- Refine manager tabs and npm cache note
- Add Docker Bun and uv managers
- Refactor Tauri backend into modules
- Polish package manager UI layout
- Add npm maintenance actions
- Add pnpm maintenance actions
- Mark current nvm node version
- Add GitNexus agent guidance
- Extract skill installation copy module
- Extract agent workflow coordination
- Add OpenCode session management
- Bind observation sources to manager scans

Freeze Docker connection settings and verify daemon identity around inventory reads. Preserve legacy history while excluding unverified sources from comparisons, with scan and compatibility coverage.
- Own session record operation lifecycles
- Add OpenCode age-based session deletion and month grouping
- Extract skill inventory lifecycle module
- Reuse skill inventory lifecycle in Codex and Claude hooks
- Extract session operation lifecycle module
- Reuse session operation lifecycle in session hooks
- Prepare OpenCode deletion plans in Rust
- Render prepared OpenCode deletion plans
- Extract session selection module
- Reuse session selection in the session page
- Extract native inventory hook
- Reuse native inventory in Claude Code
- Stream batch removal progress to the removal dialog

Batch removal previously blocked on one IPC call with no indication of
how many records remained. Report per-record progress over a per-call
Tauri channel so the confirmation dialog can show the execution-time
candidate total and live moved/skipped/failed counts.
- Add VS Code workspace storage removal

Only Missing and Unknown workspace records are removable, and only while
VS Code is closed. The backend revalidates every target at execution
time, skips restored project paths, and moves each record to Trash while
streaming progress to the dialog.
- Add cross-domain maintenance history

Persist manager, project cleanup, session, OpenCode, and VS Code removals in one v2 journal, migrate existing manager records, and add the top-level history page.
- Add cross-domain observation coverage

Track last successful reads, failed attempts, scope changes, and explicit
invalidation for all observation sources, and surface them in a new health
tab without persisting scan contents.
- Add command location association to environment diagnostics

Relate executable PATH candidates to observed installation ranges, package paths, and the pip interpreter without claiming installation ownership.
- Add per-preset project scan history

Persist terminal scan counts and candidate changes against the last complete scan, and show them in a read-only summary and detail view.
- Explain operation eligibility
- Remove completed issue files
- Mark completed features done and record vscode verification
- Remove completed vscode issue files and fix dangling issue links
- Unify the maintenance operation lifecycle

Move the repeated begin/append/finish/abort wiring out of lib.rs into one
maintenance operation module, with per-domain adapters owning scope, execution
and record payloads. Maintenance history now only stores records.
- State session age eligibility counts in Rust scans

Move the mirrored age filters out of the frontend and reuse the OpenCode
cascade rule from the deletion plan. Narrow the session operation adapter by
injecting follow-up recording and sharing completed-record removal.
- Run project cleanup batches in Rust

Execute the confirmed batch as one command with a stop flag and progress
channel, write maintenance history at each target, and remove the old
begin/clean/finish command trio.
- Read a manager in one Rust command

Scan, measure paths, and hydrate Homebrew/pip supplements in one command
with progress events, and let Rust state the final problems. Retries now
reread the whole manager.
- Unify observation state across source pages

Share coverage labels, times, completeness and actions, and migrate the
coverage, VS Code and session pages to the shared presentation.
- Complete observation state migration across sources

Use the shared strips and badges for managers, Codex, Claude Code,
project cleanup, VS Code and sessions; require coverage props and remove
the legacy status fallbacks.
- Simplify observation state presentation

Remove dead strip actions, duplicate label/option logic and the extra
manager map projection; reuse status labels and shared test fixtures.
- Simplify maintenance workflow and cleanup batch code

Merge the duplicate manager scan-result branches, drop the unused
retry-supplement kind path, and reduce scan phase labels to one map.
Reuse the shared maintenance receipt for cleanup batches, avoid cloning
each batch outcome, and compare pip outdated names without allocating.
- Deduplicate shared helpers and remove dead code

Reuse existing formatting, path resolution, notice, and maintenance-runner
helpers across the frontend and Rust backend, drop unused exports, and
avoid redundant scans, probes, and per-render computations.
- Add app self-update through GitHub Releases

Check for updates on launch and from Settings, install signed builds with
download progress, and relaunch automatically. Ship the release pipeline:
git-cliff changelog, version bump script, signing-key setup, and a tag-driven
workflow that publishes dmg/app plus a validated latest.json.
- Rename app bundle to DevScope
- Add Grok Build session record management

Support cross-project metadata browsing, exact session resume, and guarded directory removal to Trash. Integrate observation coverage and maintenance history, and decode result paths for display.
- Merge branch 'main' of github.com:sunven/package-manager
- Remove sidebar environment information card
- Remove completed feature docs from .scratch
- Remove completed fvm-support PRD from .scratch
- Remove completed grok-build session records docs from .scratch
- Ignore taste-skill artifacts
- Merge branch 'main' of github.com:sunven/package-manager

### Performance

- Cut redundant renders and hot-path work

### Refactor

- Deepen project cleanup workflow
- Localize manager scan modules
- Unify Codex extension maintenance workflow
- Share hook definition file persistence
- Unify hook observation behind one native read
- Unify manager maintenance and snapshot verification
- Simplify UI for desktop-only layout
- Drop redundant page headers from Codex, Claude and sessions

<!-- generated by git-cliff -->
