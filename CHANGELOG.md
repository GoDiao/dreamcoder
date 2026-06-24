# Changelog

All notable changes to DreamCoder will be documented in this file.

## [Unreleased]

## [0.4.0] — 2026-06-13

### Added
- **Phase 3 — H5 Remote Access landed**: access desktop sessions from a phone or browser over LAN. Includes the H5 access toggle with token rotation, QR-code pairing, mobile chat UI, WebSocket remote bridge, and a strict CORS / loopback-vs-token request classifier (`src/server/h5AccessPolicy.ts`).
- Direct-connect session manager and headless connect entrypoint (`src/server/createDirectConnectSession.ts`, `connectHeadless.ts`).
- Static H5 asset serving with long-lived cache for `/assets/*` (`src/server/staticH5.ts`).
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
