# Changelog

All notable changes to DreamCoder will be documented in this file.

## [Unreleased]

### Added

- **Report a problem** (#132): the sidebar's More menu opens a preview of what would be shared: app version, OS, provider type and recent errors, already redacted. Copy it, open a GitHub issue with the version filled in, or export the full diagnostics bundle. Nothing is sent until you click.
- **Export a session** (#133): "Export…" in the session menu saves the conversation as Markdown or JSON. Thinking and full tool output are optional, and secrets and your home folder can be redacted.
- **Agent teams switch** (#134): Settings → General → Experimental turns on agent teams for new sessions and scheduled tasks. It replaces setting `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` in your shell, which DreamCoder now ignores.

### Changed

- Diagnostics redaction also removes bare provider and GitHub keys (`sk-…`, `ghp_…`), and finds the home folder written with either slash or as `/c/Users/…`. It no longer touches a longer folder name such as `/Users/alice` when the home folder is `/Users/al`.
- The bug report template lists the current provider presets.

### Removed

- The DreamField provider preset. A saved DreamField provider keeps working, but its models now get the default 200K context window instead of the preset's 1M. The DreamField Emerald theme stays.

### Fixed

- **Gemini and similar OpenAI-compatible providers** (#139): parallel tool calls streamed without an `index` run as separate calls instead of being merged into one. A turn that calls tools and ends with finish_reason `stop` now reports `tool_use`. Thanks @pcbeingused333.
- **Agent teams:** opening a teammate from the team view shows its conversation instead of an empty page.
  - Each teammate now keeps one transcript. Before, every message it received started a new file with its whole history copied in.
  - Transcripts written before this update still open.
  - The team view no longer lists a tool name such as "Read" as a member.
- **Agent teams:** the team card shows when teammates finish. Teammates that run inside DreamCoder never reported going idle, so the card kept counting them as running and none as done.

## [0.6.0] — 2026-10-19

### Upgrading from 0.5

Computer Use was rebuilt on cua-driver. If you never saved its settings in 0.5, it is now **off**: turn it on under Settings → Computer Use, which downloads cua-driver the first time. If you did save them, the switch stays on but cua-driver is not installed yet, so Computer Use does nothing until you click **Install** on the same page. The screenshot and UIA Tree modes, the Python runtime and the per-app approval dialog are gone. Clicks, typing and other actions now go through the normal permission prompt, where you can allow once or for the session; Bypass permissions mode skips it. The old Python environment can be removed from the same page.

### Added

- **Install from the MCP catalog** (#46, #102): catalog entries open a review screen where you pick the scope and project, fill in required environment values and check the command before saving. Thanks @harrisonoconnorhover.
- **Provider logos** (#121, #122): Settings → Providers and the Add Provider presets show each provider's logo before its name; custom providers get a generic icon. Thanks @spjyotiranjan.

### Changed

- **Computer Use runs on cua-driver** (#74). Turning Computer Use on downloads [cua-driver](https://github.com/trycua/cua) 0.34.0 (MIT) through cua's official installer, or reuses an existing install of 0.34.0 or newer. It works in the background without taking the mouse or focus, targets UI elements, and drives browsers. Tools that only read state, such as listing apps and windows, run without asking. Clicks, typing, window screenshots, clipboard reads and other actions go through the permission prompt, unless the session is in Bypass permissions mode. cua telemetry is turned off. Verified on macOS; Windows needs community testing, Linux is a preview.
  - **Breaking:** the visual screenshot and UIA Tree modes, the Python runtime and the per-app approval dialog are removed. Computer Use is now off by default: if you never saved its settings, turn it on again under Settings → Computer Use. If you did, click Install on that page to download cua-driver. The old Python environment can be removed from that page.
- **Compact tool calls in chat** (#129): each tool call is one row with the tool, its command or file and a result summary. Expanded, the input and the output share one box, and the output turns red on error. The full raw input is behind "Show full input". Image paths that appear in Bash, Glob or Grep output no longer load as images.
- The terminal CLI's "What's new" panel and `/release-notes` show DreamCoder's own CHANGELOG, built into the app, instead of fetching Claude Code's. The terminal welcome, help and logo say DreamCoder.

### Fixed

- Expanded Bash tool calls now show their output (#129).
- On macOS, selecting text across messages no longer paints the highlight across the whole window width (#129).
- The CLI, `/status` and session metadata report the app version instead of `999.0.0-local`, and `--version` says DreamCoder instead of Claude Code.
- The website links to the installers and the renamed READMEs (#115).
- In the Dark theme, diffs in the side panel use dark row colors instead of the light theme's pale ones, so the code is readable.
- The README and website screenshots show the current UI (#108).
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
