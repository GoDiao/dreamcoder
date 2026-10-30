English | [简体中文](./ROADMAP_zh.md)

# Roadmap

## Phase 1 — Desktop GUI + Multi-Provider ✅

- [x] Electron desktop app (macOS Apple Silicon is the daily platform; Windows x64 is well tested; Linux is best-effort)
- [x] Multi-provider configuration (Anthropic/OpenAI-compatible endpoints; presets for DeepSeek, Qwen, Kimi, Zhipu GLM, LM Studio, and Ollama)
- [x] Visual settings UI (Providers, API Keys, model mapping)
- [x] Session management (tabs, sidebar, history search)
- [x] Built-in PTY terminal (PowerShell/Bash/Zsh)
- [x] Permission control (4 modes)
- [x] Chinese/English i18n

## Phase 2 — CLI Backend + Computer Use ✅

- [x] Sidecar backend architecture (dreamcoder-sidecar.exe)
- [x] Computer Use (now on cua-driver; the visual and UIA Tree modes were replaced)
- [x] MCP protocol support + visual management
- [x] Skills system
- [x] MCP marketplace (browse and install curated servers)
- [x] Agent Teams multi-agent collaboration
- [x] Code Diff visualization
- [x] Scheduled tasks + Cron expressions
- [x] Worktree/branch isolation launch
- [x] Auto-update checker (UpdateChecker)

## Phase 2.5 — Performance Optimization ✅

- [x] Bundle splitting (manualChunks + lazy Settings)
- [x] KaTeX/Mermaid dynamic import + error UI
- [x] Polling throttle/debounce
- [x] Terminal LRU eviction (active-process aware)
- [x] sessionStore single source of truth refactor
- [x] Scheduled task poll failure toast
- [x] Configurable max terminal count

## Phase 3 — H5 Remote Access ✅

Once H5 Access is enabled, phone browsers on the same LAN can reach desktop sessions. Cross-network access requires a reverse proxy configured by the user.

- [x] H5 access toggle & token management
- [x] Mobile chat UI adaptation
- [x] WebSocket remote bridge
- [x] CORS security policy
- [x] LAN direct-connect + QR pairing
- [ ] Reverse proxy deployment guide (in progress)

See: [Issue #3](https://github.com/GoDiao/dreamcoder/issues/3)

## Phase 4 — Release Automation

- [x] GitHub Actions builds the installers when a version tag is pushed, into a draft release
- [x] Cross-platform packaging: macOS `.dmg` and Windows `-setup.exe`, from v0.5.0
- [x] Version numbers synced by one script (`scripts/release.ts`)
- [x] Release notes taken from the CHANGELOG section for the version
- [x] Installer smoke tests on every release
- [ ] In-app auto-update with our own signing key ([#118](https://github.com/GoDiao/dreamcoder/issues/118))

## Phase 5 — Remote Agent Backend

- [ ] Run the agent on a remote host over SSH / WebSocket, with the local desktop as the UI

See: [RFC #24](https://github.com/GoDiao/dreamcoder/issues/24)

## Now

- [ ] Desktop responsiveness while replies stream ([#153](https://github.com/GoDiao/dreamcoder/issues/153), [#154](https://github.com/GoDiao/dreamcoder/issues/154))
- [ ] Faster desktop startup ([#152](https://github.com/GoDiao/dreamcoder/issues/152))
- [x] Server-side session state shared by every client ([#150](https://github.com/GoDiao/dreamcoder/pull/150))

## Under Research

- Agent teams: [RFC #162](https://github.com/GoDiao/dreamcoder/issues/162)
- System 1 decision models, starting with permission guardrails: [RFC #124](https://github.com/GoDiao/dreamcoder/issues/124)
- Visual content in sessions: [#151](https://github.com/GoDiao/dreamcoder/issues/151)

## Future Exploration

- Token usage statistics panel
- Memory system enhancement (AutoDream)
- Plugin marketplace
- Linux desktop support
