# Changelog

All notable changes to DreamCoder will be documented in this file.

## [Unreleased]

### Added

- **Install from the MCP catalog** (#46, #102): catalog entries open a review screen where you pick the scope and project, fill in required environment values and check the command before saving. Thanks @harrisonoconnorhover.

### Fixed

- **OpenAI-compatible providers** (#38):
  - Cached prompt tokens are reported as cache reads, so cost estimates use the cached price. Non-streaming Chat requests no longer count them twice.
  - Screenshots and images now reach providers that use the OpenAI Responses format.
  - Images and other non-text content in tool results become short placeholders instead of being dropped silently.
  - Reasoning from Responses providers that stream it, such as OpenRouter, shows as thinking.

## [0.5.0] — 2026-10-18

### Added
- **Installers**: the first release with a macOS (Apple Silicon) `.dmg` and a Windows x64 `-setup.exe`, built by a new release workflow. They are not code-signed yet.
- **Refreshed desktop UI** (#107): warm light palette, new type scale and a new logo (crescent moon and star on a terracotta tile).
  - The tab bar is gone; the sidebar organizes sessions three ways, and the session header has a menu to rename, bulk-manage or delete.
  - Each session has its own right-side panel for files, diffs and multiple terminals. Diffs show real line numbers and accept line comments.
  - Settings open as a modal. The composer has per-session effort, and a provider card covers it until a provider is set up.
  - Skills add menu and a keyboard shortcuts dialog.
- **Own config directory** (#104): DreamCoder defaults to `~/.dreamcoder` (`DREAMCODER_CONFIG_DIR` still overrides). On first launch, or from Settings → Storage, it can import sessions, history and tasks from Claude Code without overwriting anything.
- **Inherit Claude Code customizations** (#103): skills, agents, commands, `CLAUDE.md` and rules from Claude Code's directory load read-only, at lower priority than DreamCoder's own.
- **Curated MCP catalog** (#56, #96): a searchable, tag-filterable catalog under Settings → MCP, backed by a validated registry.
- **Aurora theme** (#60).
- Provider-neutral first-run onboarding, localized in English and Chinese (#59).
- The default terminal shell is detected and configurable (#65).

### Changed
- Session history is interpreted on the server and served by `GET /api/sessions/:id/transcript`; the desktop history and team views use it (#93, #94).
- Typed live events and shared protocol types between server and desktop (#95).
- All upstream provider requests go through one module (#83); leftover upstream presets removed (#78).
- Per-session runtime state on the WebSocket server lives in one object (#86).
- The English README is now the default; Chinese moved to `README_zh.md` (#109).
- Credit cc-haha and include its MIT license notice (#72, #73).

### Removed
- IM adapters (Feishu, DingTalk, Telegram, WeChat) are no longer planned. Removed the `adapters/` package, the `/api/adapters` API, the hidden IM settings page, the adapter sidecar processes the desktop app spawned on startup, and the Telegram/Feishu notification channels for scheduled tasks. Scheduled-task notifications are desktop-only; tasks saved with only an IM channel no longer notify (#87).
- The stale `sidecar/` copy (#84).

### Fixed
- Light, White, Midnight and other themes no longer get repainted by the warm light palette; dark mode has its own error surfaces and readable quotes (#107).
- Midnight resolves to a dark color scheme (#69).
- The server sidecar exits when the desktop process dies; no macOS notification crash outside an app bundle.
- Dark theme tokens restored; Windows baseline Bun.
- Dollar sequences preserved in translations (#64); localized scheduled-task notifications and Computer Use settings (#61, #62).
- `bin/dreamcoder` exec bit, stale server tests and `/api/tasks` 404 (#85).

## [0.4.5] — 2026-06-25

### Fixed
- `chatStore` message list now capped at 5000 entries to prevent unbounded transcript growth during long-running sessions.
- `sessionService` stream-scanning optimization for `listSessions` reduces peak RSS by ~82% on machines with many sessions.
- Terminal runtime now emits xterm memory diagnostics to aid future performance investigations.

### Added
- New benchmark scripts: `mem-compare.ps1` and `mem-monitor.ps1` for sidecar memory profiling.
- New documentation: TROUBLESHOOTING guide (bilingual), ENVIRONMENT_TESTING matrix, language-switch links across all bilingual docs.

### Changed
- Repository history restarted from a new orphan baseline (`clean-master`).
- Bilingual README and contributor docs polished with clearer product-oriented language.
- E2E scripts renamed to DreamCoder branding.
- GitHub default branch switched from `master` to `clean-master`.

## [0.4.0] — 2026-06-13

### Added
- **Phase 3 — H5 Remote Access enabled**: access desktop sessions from a phone or browser over LAN, with token rotation, QR-code pairing, a mobile chat UI, a WebSocket remote bridge, a CORS / loopback-vs-token request classifier in `src/server/h5AccessPolicy.ts`, a direct-connect session manager, a headless connect entrypoint and static H5 asset serving.
- H5 Access settings tab is now visible by default in Settings.
- Performance optimization: bundle splitting (manualChunks), lazy-loaded Settings page, dynamic KaTeX/Mermaid imports.
- Performance optimization: sessionsById Map index for O(1) session lookups.
- Performance optimization: throttle/debounce on noisy polling loops.
- Performance optimization: terminal LRU eviction with active-process awareness.
- Performance optimization: Vec::with_capacity pre-allocation, DEV-only console.warn guard.
- Configurable max live terminals in Settings (3/5/10/unlimited).
- Mermaid/KaTeX render error UI with in-flight Promise deduplication.
- Scheduled-task poll failure toast after 3 consecutive errors.
- `useSessionById(id)` hook for memoized O(1) session lookups.
- E2E benchmark suite (store-e2e, TTI, Tauri RSS).
- Project website rebuilt on Vite (replaces the Docusaurus prototype) with a marketing landing page, architecture diagram, and 8 documentation pages (install, Computer Use, MCP, sessions/terminal, dev guide, troubleshooting, etc.).
- Community setup: structured `.github/ISSUE_TEMPLATE` (bug / feature / good-first-issue + Discussions routing), good-first-issue / help-wanted README badges, CONTRIBUTING 5-minute Quick Start (zh + en), pinned Contributor Hub issue, and 10 curated onboarding issues.
- Bilingual ROADMAP and CONTRIBUTING (zh + en).
- H5 Access settings tab unhidden in Settings.

### Changed
- sessionStore: removed dual `sessionsById` state; replaced with module-level memoized cache.
- Sidebar, StatusBar, ActiveSession migrated to `useSessionById`.
- Roadmap: Phase 3 marked complete; Phase 4 (IM adapters) opened as RFC #19.
- README screenshots refreshed; product copy softened (removed "first-class" marketing language).

### Fixed
- Midnight theme now correctly maps to dark color scheme.
- Various README encoding issues (mojibake).
- `switchConfig` removed from `colorMode` (deprecated upstream).

### Removed
- `docs/activity_rule.md` is no longer tracked (contest-specific doc moved out of the repo).

## [0.3.0] — 2026-05-31

### Added
- Sidecar backend architecture (dreamcoder-sidecar.exe) with dynamic port allocation.
- UIA Tree mode for text-only Computer Use (faster, lower cost than screenshot mode).
- Computer Use mode persistence across sessions.
- CLI mode and hidden settings tabs.
- Provider connectivity test in settings UI.
- Active-provider-only model filtering in selector.

### Changed
- Merged UIA Tree mode into root `src/`; removed `sidecar/src/` duplication.
- Dark Mode refined to Cold Slate theme.

### Fixed
- Race condition in Computer Use mode initialization.
- `[1m]` suffix stripping in provider model IDs and connectivity test.
- Missing `uia_helper.py` in runtime bundle.

## [0.2.0] — 2026-05-28

First DreamCoder release.

### Added
- Multi-provider support: Anthropic, OpenAI, DeepSeek, Moonshot (Kimi), MiniMax, Azure OpenAI, Google Vertex, AWS Bedrock.
- Built-in PTY terminal (PowerShell/Bash/Zsh) via portable-pty + xterm.js.
- MCP (Model Context Protocol) server management UI.
- Visual settings GUI for providers, API keys, and preferences.
- Session management with sidebar navigation and tabbed interface.
- Drag-to-resize sidebar with persistent width.
- 6 theme variants including DreamField Emerald.
- Chinese/English i18n support.
- Permission mode control (file system and command execution).
- Provider preset templates for quick configuration.
- Agents and Skills settings tabs.

### Changed
- Unified the product branding around DreamCoder.
- DreamField configured as default provider with preset models.
- Extracted settings into modular components (General, Provider, Agents, Skills, About, H5Access).
- Merged OAuth stores via factory pattern (~70 lines reduced).
- Deduplicated shared utilities (currentServerPort, isValidHttpProxyUrl, openExternalUrl).

### Fixed
- Hardcoded strings replaced with i18n keys.
- Removed dead code (SOCIAL_LINKS, unreachable JSX).
- Sidecar build timeout in tauri dev beforeDevCommand.
