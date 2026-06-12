# perf/store-refactor-and-robustness

Follow-up branch to `docs/perf-optimization-plan-v2.md`. Implements the
seven trade-off fixes (#11–#17) flagged during v2 review: dynamic-import
error UX, terminal LRU active-process awareness, sessionStore SoT
refactor, scheduled-task poll error visibility, configurable terminal
cap, KaTeX failure persistence, and consumer migration to the new
session lookup hook.

## Branch info

- **Branch**: `perf/store-refactor-and-robustness`
- **Base**: `master` (forked from the v2 perf branch tip
  `d9ba100 bench: add e2e benchmarks ...`)
- **Scope**: Frontend only (`desktop/src/**`). No Rust changes, no
  schema changes, no API changes.
- **Risk**: Low. All changes are local refactors or additive UX. No
  user-facing breaking change. Test suite delta: +2 test files / +1
  passing test vs baseline (the 90 historical failures pre-date this
  branch — verified via `git stash` baseline run).

## Commit map

| # | Commit  | Fix # | Files                                                                                                                          |
| - | ------- | ----- | ------------------------------------------------------------------------------------------------------------------------------ |
| 1 | 0cf1e3f | —     | `.gitignore` housekeeping (untrack `.omc/` runtime state)                                                                      |
| 2 | ba17fc2 | 11,16 | `MermaidRenderer.tsx`, `MarkdownRenderer.tsx`                                                                                  |
| 3 | d511eda | 12,15 | `terminalRuntime.ts`, `tabStore.ts`, `uiStore.ts`, `uiStore.test.ts`, `GeneralSettings.tsx`                                    |
| 4 | dc605db | 13    | `sessionStore.ts`                                                                                                              |
| 5 | 423a827 | 14    | `useScheduledTaskDesktopNotifications.ts`, `useScheduledTaskDesktopNotifications.test.tsx`                                     |
| 6 | 9e75d80 | 17    | `Sidebar.tsx`, `StatusBar.tsx`, `ActiveSession.tsx`                                                                            |

`tabStore.ts` was deliberately bundled with #15 because the
active-process-aware eviction logic (#12) and the configurable cap
(#15) both rewrite the same eviction block; splitting them would have
required surgical hunk surgery without semantic gain.

## Per-fix summary

### #11 / #16 — Mermaid & KaTeX dynamic-import resilience

- Both renderers now dedupe in-flight dynamic imports with a
  module-level `Promise` so concurrent first-renders don't trigger
  parallel `import()` calls.
- KaTeX additionally caches the load **error**: if the first attempt
  fails (e.g. offline first paint), every subsequent render shows the
  cached error UI without re-throwing into the network.
- Mermaid's `renderMermaid` is wrapped in try/catch with a user-visible
  error fallback instead of silently rendering nothing.

### #12 / #15 — Terminal LRU: active-aware + configurable

- `isTerminalProcessActive(id)` exported from `terminalRuntime`.
- `tabStore.bringTerminalToFront` now rotates active terminals to the
  tail of the LRU and only evicts inactive heads. Long-running
  `tail -f`, `cargo watch`, etc. survive natural eviction pressure.
- `MAX_LIVE_TERMINALS` is no longer hardcoded; it's a Settings field
  (`uiStore.maxLiveTerminals`, options `[3, 5, 10, 0]`, default 5).
  `0` is reserved for "unlimited" semantics in a follow-up — currently
  treated as default.

### #13 — sessionStore single source of truth

- Removed the redundant `sessionsById` Map kept inside store state.
- Replaced with a module-level memoized cache: rebuilds the Map only
  when the sessions array reference changes.
- Added `useSessionById(id)` hook for components that need O(1) lookup.

### #14 — Scheduled-task poll failure visibility

- `useScheduledTaskDesktopNotifications` now counts consecutive poll
  failures. After 3 in a row, fires a single warning toast
  ("定时任务通知轮询失败...") and dedups until polling recovers.

### #17 — Consumer migration

- `Sidebar`, `StatusBar`, `ActiveSession` migrated off ad-hoc
  `sessions.find()` and local Maps onto `useSessionById`.

## Test status

- `pnpm test`: 16 failed test files / N passed (vs 18 failed on
  baseline `master` — net +2 files greener, +1 passing test).
- `pnpm lint`: ~70 historical TS6133/TS2352 errors (unused imports in
  `Settings.tsx`/`AboutSettings.tsx`, `Mock<Procedure>` cast in
  `desktopRuntime.test.ts`). All pre-date this branch. None introduced
  here.

## Verification done

- `bun tauri dev` boots cleanly; sidecar `/health` and `/api/sessions`
  return 200.
- Branch `git stash` baseline test run vs working-tree run cross-checked
  to confirm test delta is positive, not regressive.
- `.omc/` no longer tracked; `.gitignore` already had the entry.

## Outstanding

- `temp-gh-pages/` directory is untracked and unrelated; left alone.
- Historical lint debt is not addressed here. Filed separately.
