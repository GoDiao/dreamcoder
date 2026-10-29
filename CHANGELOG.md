# Changelog

All notable changes to DreamCoder will be documented in this file.

## [Unreleased]

### Added

- **The agent can show pages in the conversation** (#202). When a chart, a diagram or a walkthrough explains better than text, the agent builds a page from [ShowAI](https://github.com/Renaissance-Mind/ShowAI) components: charts and over forty G2 chart types, flowcharts, sequence and architecture diagrams, mind maps, step-by-step walkthroughs, comparison matrices, roadmaps, 3D scenes, PDFs and more, plus HTML it writes itself for what no component can draw. The page appears in a card in the conversation; each change is a new revision, and the card can be enlarged or opened in the side panel. Pages follow the app's light or dark theme and run in a sandbox that cannot reach the network, the app or your files. The page reader makes the macOS `.dmg` about 6 MB larger.
- **A built-in browser** (#201). A side panel tab opens a local dev server, an HTML file in the project or an https site. Sign-ins are kept across restarts and cleared with "Clear browsing data"; other link types are offered to the system browser. Desktop app only.
- **The side panel is a strip of tabs.** Changes, the file tree, single files, web pages, terminals and pages each open as a tab, from the new tab page or from the chat. Each session keeps its own tabs, and they come back after a restart, except terminals. The panel now runs the full window height with its tabs in the title row; one button at the top right opens and closes it, and the separate terminal button is gone. The H5 page offers file and page tabs only.

### Changed

- **The desktop interface is rebuilt on shadcn/ui** (#191). The app now runs on React 19, and buttons, dialogs, menus, notifications and panels share one set of components in all seven themes. Dialogs keep focus inside and return it when closed, and menus and the file tree work from the keyboard. Icons are lucide SVGs instead of the Material Symbols font. The H5 page needs Safari 17.5 or later.
  - Code blocks are highlighted with Shiki in light and dark themes and show plain text while highlighting loads. Chat and workspace diffs are rendered with Pierre, with line comments and quoting of selected lines.
  - A new conversation stays a local draft until the first message or attachment is sent. Opening a new conversation from the sidebar, a project or the keyboard shortcut no longer creates an empty session.
  - The context button under the input shows usage as a ring; hover it for the breakdown. The task list shows how many steps are done.
  - The model and effort are picked from two separate lists under the input. Typing while no text field has focus goes to the message input.

### Fixed

- MermaidRenderer tests pass when run in different orders, preserving the record of Mermaid's one-time initialization (#206).
- Tool calls that arrived after a reply fell back to a non-streaming request were missing from the conversation; they are now shown.
- Read no longer rejects a text file when a model sends an empty page range.
- A group of tool calls is no longer marked as failed when a failed call was followed by a successful call of the same tool; the failed call is still shown inside the group.
- Sessions with an effort level selected before a model now generate an AI title through the active provider instead of keeping the placeholder (#193).
- When the AI title of a session cannot be generated, the server log now says why (session, provider, model and reason: upstream status and error excerpt, no text in reply, reply is not a title) instead of keeping the placeholder silently (#176).
- **In-process teammates claim the team's tasks** (#163). Once the lead creates a team, its tasks are stored in the team's task list, but in-process teammates looked for them in a list named after the lead's session, so they never claimed one and the tasks stayed unowned. Teammates now read the same task list as the lead, both when they start and while they are idle.
- Streamed replies from providers using the OpenAI Chat Completions format show their token usage and cost instead of 0 (#203). The request now asks for usage with `stream_options`, which backends such as Qwen (DashScope) and vLLM need before they report it.
- An in-process teammate can no longer call `EnterWorktree` or `ExitWorktree` (#198). Teammates share one process with the lead, so entering a worktree moved the lead and every other teammate into it, and their reads, writes and commands ran there.

## [0.8.0-beta.1] — 2026-10-26

A pre-release of the Electron desktop app. Windows has not been tested on real machines yet; reports are welcome in the Windows testing issue.

### Changed

- **The desktop app runs on Electron instead of Tauri** (#174). The interface now renders in Chromium on every platform. On macOS, long sessions are much faster: laying out a streaming reply takes about 1 ms per update instead of about 20 ms (265 ms at the slow end), and scrolling up through 1,000 messages no longer stalls. The installers are larger: the macOS `.dmg` is about 150 MB instead of 46 MB.
  - Install the new version by hand, as before. On Windows it installs to a new folder, so uninstall the previous DreamCoder from Settings → Apps afterwards.
  - Sessions, providers and settings carry over. The window position and portable mode start fresh, and so do the preferences the old window kept in its own storage: theme, interface language, zoom, sidebar width and open tabs. Set up portable mode again in Settings → General.
  - On Windows and macOS the title bar areas still move the window; the empty middle of the sidebar no longer does.
- **The terminal runs in the local server** (#173). Each terminal is a shell the DreamCoder server starts, so it behaves the same in every desktop build. Closing a terminal tab or quitting the app ends its shell. The terminal is available only in the desktop app, not on the H5 page.
- Building from source no longer needs Rust: `bun run electron:install`, `bun run build:sidecars` and `bun run electron:dev` in `desktop/` (see CONTRIBUTING).
- **Context windows beside each model** (#105). In Settings → Providers each model has its own context window field next to its name. Fetching models fills empty fields with the window the provider reports and never replaces a typed or saved value.
  - Providers whose model list includes a context length, such as OpenRouter and Kimi, need no extra requests. Ollama, LM Studio, DeepSeek and Qwen are looked up from their own model APIs.
  - The form can be saved only after the current settings have loaded. If they fail to load, the form says so instead of saving over them.
- **Auto-compact at 90% of the context window** (#105). Long conversations are compacted at 90% of the model's context window, after the room kept for the summary, instead of about 33K tokens before it is full. A 1M model now compacts around 882K tokens instead of 967K, and a 200K model around 162K instead of 167K. Settings → General → Auto-compact sets a different percentage for every session. The provider form no longer has "Unknown Model Fallback Window": despite its name it replaced the window of every model of the provider when deciding when to compact. A value saved there is dropped.
- Typing in a dialog no longer lights up the dialog's whole border; only the focused field is highlighted.

### Fixed

- Opening a memory file from a chat link no longer shows "An unexpected error occurred" when the file does not exist yet. The memory page selects the project and shows that it has no memory files.
- The close button of the settings window no longer covers the buttons at the top right of a settings page, such as Add Provider.

## [0.7.0] — 2026-10-25

### Changed

- **Terminal settings** (#173): the Settings page no longer has a Terminal tab. Use the terminal in the session's workspace panel; the Skills page's install button now opens plugin settings directly. The startup shell and, on Windows, the Bash path are under General. Both are saved in the sidecar's settings, and an existing Bash path is migrated automatically.
- **Each session keeps its own permission mode** (#149). The selector under the input shows and changes only that session's mode. Before, it showed and wrote one mode shared by every session, so switching one session changed what the others displayed and the mode every later session started in.
  - The mode is saved in the session's transcript, as Claude Code saves it, so a session resumes in its own mode after a restart. A session imported from Claude Code resumes in the mode it last ran in.
  - Switching a session that is not running is no longer dropped; it applies when the session next starts.
  - Turning Bypass permissions on or off in one session no longer makes it the default for new sessions.
  - When the CLI changes mode by itself, for example after you approve a plan, the selector follows. Before, the change was shown as "thinking".
  - Settings → Permissions now sets only the default for new sessions, which the selector marks with a "default" tag. A forked session starts in the mode of the session it came from.
  - "Default" is renamed "Manual". The Chinese interface uses the English mode names too.
- **Scheduled tasks run in the permission mode chosen for them** (#149). A new task starts with the default for new sessions, and the mode can be changed in the task.
- **A session looks the same in every window** (#150). The server now keeps each session's state in one place, and every desktop window and phone browser connected to the session sees the same mode, model, title, running status and permission requests.
  - A permission request answered on one device closes on the others, which say it was allowed or denied elsewhere. A second answer is ignored.
  - Messages typed on one device show up on the others, and refreshing during a reply no longer loses or duplicates history.
  - Switching the mode or model while a reply is running waits until the reply ends instead of restarting the CLI mid-reply. The permission selector shows the new mode at once, with a dot that means it takes effect after this reply finishes; switching back before then removes the dot. Opening a session no longer restarts it.
- **Each session keeps its own model** (#150). The model and effort are saved in the session's transcript, so they survive a restart and are the same on every device. A fork starts with the model of its source. A choice saved on this device by an earlier version moves to the session the first time it is opened.
- A session that moved into a worktree no longer splits into two files. Its title, mode and worktree survive `/clear`, and a rename is no longer undone when the CLI exits (#150).
- Agent team updates go only to the sessions of that team (#150).
- **The worktree choice for a new session is in the branch menu** (#150). "Run in a new worktree" is a switch at the bottom of the branch menu, and the branch button shows a fork icon when it is on. The separate worktree button is gone, so the controls under the input fit on one row, as they do in an existing session.
- **Starting on another branch is refused when the current checkout has uncommitted changes** (#150). Before, DreamCoder switched the branch and Git carried the changes over. Now the error appears next to the project controls, with a button to run in a new worktree instead.
- Groups of tool calls, such as "Read 3 files", are collapsed by default, also while they run. A group with a failed step stays collapsed and shows a red marker (#150).
- **Thinking and tool calls between two pieces of reply text fold into one group** (#170), so a short turn no longer pushes the answer far down the page. The summary counts thinking too, e.g. "ran 2 commands, read 1 file, thought 4 times", and the expanded group lists the steps in their original order. Thinking with no tool calls around it is still its own row.
- **Faster desktop startup** (#152, #161): KaTeX, Mermaid, the diff viewer, the Doctor panel, the Settings pages, the workspace panel and session search load the first time they are needed, which cuts the JavaScript loaded at startup by about half. Thanks @ibrahimmaq14.
- **A provider holds any number of models, in order, and an optional fast model** (#159). The first model is the main model. Settings → Providers can fetch the provider's model list and pick from it, and the generated settings JSON follows the list. Session titles use the fast model, or the session's model when there is none. Thanks @AIR-Xie.
  - Existing providers are migrated on first start, and the old file is kept as `providers.json.bak-before-migration-*`. Older versions cannot read the migrated file: restore that backup before downgrading.

### Removed

- "Don't ask" is no longer offered as the default for new sessions; a session can still be in "Don't ask" when the CLI switches to it (#149).
- Unused design mockup pages and their mock data (#149).

### Fixed

- **Bundled file search** (#106): desktop builds include ripgrep, so Glob and Grep work without a system installation. Source development prepares the same pinned binary automatically. Searches with the bundled binary ignore personal ripgrep configuration so it cannot silently exclude project files.
- **Proxy** (#148): when the ChatGPT sign-in path streams a non-streaming request and the upstream ends with `response.failed` or `error`, the caller now gets an `api_error` (HTTP 502) with the upstream message, instead of an empty `end_turn` reply. Thanks @pcbeingused333.
- **Sidebar re-renders** (#157, #158): the sidebar no longer re-renders on streamed text updates. Running indicators still follow session and tab status. Thanks @tedy69.
- **Re-renders while a reply runs** (#156, #165): the session page no longer re-renders every second during a reply. Only the elapsed time updates, and it now counts from when the server starts the turn. Thanks @princecherry9905.
- **Fewer redraws while a reply streams** (#153, #169): the input box, the status line, the permission dialog and the question card now redraw only when something they show changes, instead of on every streamed update of any session. Tool groups that have finished no longer redraw while the reply continues.
- **Smoother streaming replies** (#154, #171): a reply that is still streaming is no longer re-parsed and redrawn in full on every update. Finished paragraphs, lists, tables and code blocks are drawn once and stay in place; only the part still being written is redrawn. Text selected in the finished part stays selected while the reply continues. Code in a streaming reply uses the lighter highlighter and gets full highlighting when the reply ends, so code blocks no longer flicker. Following the bottom of the reply now scrolls at most once per frame.
- New sessions start on the active provider's main model. Before, activating a provider saved its main model in a hidden setting, and that saved value kept overriding the provider after its main model was edited (#150).
- The selected model card in the dark theme had light pink colors with text that was hard to read (#150).
- Saving a provider that the server rejects now shows the error in the form. Before, the Save button did nothing and the form gave no sign of why (#175).

## [0.6.1] — 2026-10-21

### Added

- **Report a problem** (#132): the sidebar's More menu opens a preview of what would be shared: app version, OS, provider type and recent errors, already redacted. Copy it, open a GitHub issue with the version filled in, or export the full diagnostics bundle. Nothing is sent until you click.
- **Export a session** (#133): "Export…" in the session menu saves the conversation as Markdown or JSON. Thinking and full tool output are optional, and secrets and your home folder can be redacted.
- **Agent teams switch** (#134): Settings → General → Experimental turns on agent teams for new sessions and scheduled tasks. It replaces setting `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` in your shell, which DreamCoder now ignores.

### Changed

- Diagnostics redaction also removes bare provider and GitHub keys (`sk-…`, `ghp_…`), and finds the home folder written with either slash or as `/c/Users/…`. It no longer touches a longer folder name such as `/Users/alice` when the home folder is `/Users/al`.
- The bug report template lists the current provider presets.
- **Faster session list and recent projects** (#111, #138): each transcript is scanned from its first 100 lines and last 64KB instead of end to end, so large imported sessions no longer slow the sidebar or the project picker. For a transcript too large to cover this way, the mobile session header shows the message count as "N+". Thanks @notlakshitha.
- **Session header** (#140): one row with the title, the running indicator and the buttons. Drag anywhere on it to move the window, and double-click to maximize or restore; the buttons still click normally.
  - The project and branch, already shown under the input, and "last updated" are gone from it.
  - An active goal shows at the top of the chat instead.
  - When a session's working directory has been deleted, the input box says which directory is missing.
  - Pages without a session header, such as the new-session page and scheduled tasks, get a top strip as tall as the header to drag the window by.
- **Title row** (#140): on macOS the traffic lights, the sidebar button and the session title share one row. The sidebar button stays in the same place whether the sidebar is open or not, and a collapsed sidebar now slides away completely instead of leaving a narrow rail.
- **Message actions** (#140): copy and fork are icons, outlined only while the pointer is on them, and a user message shows when it was sent. A reply gets one set of actions under its last text: copy takes the whole reply and fork starts from its end.

### Removed

- The DreamField provider preset. A saved DreamField provider keeps working, but its models now get the default 200K context window instead of the preset's 1M. The DreamField Emerald theme stays.

### Fixed

- **Gemini and similar OpenAI-compatible providers** (#139): parallel tool calls streamed without an `index` run as separate calls instead of being merged into one. A turn that calls tools and ends with finish_reason `stop` now reports `tool_use`. Thanks @pcbeingused333.
- **Proxy** (#143): a reply that stops at the output limit (`response.incomplete`) is reported as `max_tokens` with its tool calls and token usage, instead of `end_turn` with plain text and zero usage. Thanks @pcbeingused333.
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
