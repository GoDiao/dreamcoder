# Roadmap

## Phase 1 — Desktop GUI + Multi-Provider ✅

- [x] Tauri 2 desktop app (Windows/macOS)
- [x] Multi-provider support (Anthropic, OpenAI, DeepSeek, MiniMax, Azure, Google Vertex, AWS Bedrock)
- [x] Visual settings UI (Providers, API Keys, model mapping)
- [x] Session management (tabs, sidebar, history search)
- [x] Built-in PTY terminal (PowerShell/Bash/Zsh)
- [x] Permission control (4 modes)
- [x] Chinese/English i18n

## Phase 2 — CLI Backend + Computer Use ✅

- [x] Sidecar backend architecture (dreamcoder-sidecar.exe)
- [x] Computer Use (visual screenshot mode + UIA Tree text mode)
- [x] MCP protocol support + visual management
- [x] Skills system
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

Expose desktop capabilities to mobile browsers via LAN or reverse proxy.

- [x] H5 access toggle & token management
- [x] Mobile chat UI adaptation
- [x] WebSocket remote bridge
- [x] CORS security policy
- [x] LAN direct-connect + QR pairing
- [ ] Reverse proxy deployment guide (in progress)

See: [Issue #3](https://github.com/GoDiao/dreamcoder/issues/3)

## Phase 4 — IM Adapter Integration

Chat with AI remotely via Feishu/DingTalk/Telegram/WeChat.

- [ ] Adapter configuration UI (skeleton exists in `AdapterSettings`)
- [ ] Pairing code security mechanism
- [ ] Per-platform adapter verification & debugging
- [ ] Session mapping persistence
- [ ] Permission approval flow adaptation (button/card UI)

## Phase 5 — Release Automation

- [ ] GitHub Actions automated build & release
- [ ] Cross-platform packaging (Windows/macOS)
- [ ] Version number auto-sync
- [ ] Release notes auto-generation
- [ ] Auto-update signing & distribution

## Future Exploration

- Token usage statistics panel
- Memory system enhancement (AutoDream)
- Plugin marketplace
- Linux desktop support
