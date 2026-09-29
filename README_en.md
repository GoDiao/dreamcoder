<div align="right">

English | [简体中文](./README.md)

</div>

<div align="center">

# DreamCoder

**A locally run, multi-provider AI coding workspace**

*Manage Claude Code workflows on your desktop and continue sessions from your phone on the same LAN.*

[![Tauri 2](https://img.shields.io/badge/Tauri-2-blue)](https://v2.tauri.app/)
[![React 18](https://img.shields.io/badge/React-18-61DAFB)](https://react.dev/)
[![Bun](https://img.shields.io/badge/Bun-✓-fbf0df)](https://bun.sh/)
[![License: MIT](https://img.shields.io/badge/License-MIT-green)](./LICENSE)
[![Good First Issues](https://img.shields.io/github/issues/GoDiao/dreamcoder/good%20first%20issue?color=7057ff&label=good%20first%20issues)](https://github.com/GoDiao/dreamcoder/issues?q=is%3Aopen+is%3Aissue+label%3A%22good+first+issue%22)
[![Help Wanted](https://img.shields.io/github/issues/GoDiao/dreamcoder/help%20wanted?color=008672&label=help%20wanted)](https://github.com/GoDiao/dreamcoder/issues?q=is%3Aopen+is%3Aissue+label%3A%22help+wanted%22)

[![AtomGit G-Star](https://atomgit.com/GoDiao/DreamCoder/star/new_badge.svg)](https://atomgit.com/GoDiao/DreamCoder)

Also hosted on AtomGit: [atomgit.com/GoDiao/DreamCoder](https://atomgit.com/GoDiao/DreamCoder) (mirror; please open issues and pull requests on [GitHub](https://github.com/GoDiao/dreamcoder))

</div>

> 🌱 **Contributions welcome!** Browse [good first issues](https://github.com/GoDiao/dreamcoder/issues?q=is%3Aopen+is%3Aissue+label%3A%22good+first+issue%22) and [help wanted](https://github.com/GoDiao/dreamcoder/issues?q=is%3Aopen+is%3Aissue+label%3A%22help+wanted%22), and read the [contributing guide](docs/CONTRIBUTING_en.md) before starting.

---

## ✨ Why DreamCoder?

DreamCoder runs its desktop app and session service locally, bringing model configuration, coding sessions, the terminal, and tool activity into one workspace.

*   **Choose a model provider**: Configure Anthropic or OpenAI-compatible endpoints. Presets include DeepSeek, Qwen, Kimi, Zhipu GLM, LM Studio, and Ollama; custom endpoints are also supported. Model availability depends on your provider and configuration.
*   **Follow the work**: Review sessions, file changes, terminal activity, and tool calls on your desktop.
*   **Continue on your phone**: Enable H5 Access to reach desktop sessions from a phone browser on the same LAN. Access across networks requires a reverse proxy you configure yourself.
*   **Learn how a coding agent works**: A seven-part source code walkthrough follows one code change through the execution loop, tools, permissions, sessions, and desktop integration. See the [Coding Agent Implementation Guide](docs/tutorial/README.en.md).

Provider settings and API keys are stored in local files. When you use a cloud model, requests are sent to your chosen provider. See the [privacy notice](PRIVACY.md).

---

## 🚀 Key Features

### 1. Native Desktop Experience
*   **Smoother session management**: Visual history, sidebar navigation, and a tabbed interface.
*   **Terminal built into the workflow**: Built-in PTY (PowerShell/Bash/Zsh) with xterm.js.
*   **Settings you can manage visually**: Configure providers, API keys, and preferences without editing JSON files.

![Main workspace](./assets/main.png)

### 2. Multi-Provider Configuration
*   **Presets and custom endpoints**: Set the API key, endpoint, and model mapping for your chosen provider.
*   **Connection check**: Test the availability and latency of configured endpoints in Settings.

![Provider settings](./assets/setting_provider.png)

### 3. Claude Code Workflows
*   **Dual Computer Use modes**: Supports visual screenshot control and **UIA Tree mode** (text-based accessibility).
*   **Transparent tool execution**: File edits and terminal commands are surfaced clearly, so it's easy to understand and review what the agent is doing.
*   **MCP extensibility**: Expand context and tooling through the Model Context Protocol.

![Computer Use settings](./assets/setting_computeruse.png)

### 4. Continue on Your Phone over LAN
*   **H5 Access**: Enable access in Settings, manage the token, and use the QR code to connect a phone on the same LAN.
*   **Access scope**: Keep the desktop app running. Cross-network access requires your own reverse proxy; the deployment guide is still in progress.

### 5. MCP Extensions
*   **Visual configuration**: Manage MCP servers in the UI instead of editing JSON by hand.

![MCP settings](./assets/setting_skills.png)

---

## 📖 Source Code Walkthrough

To learn how a coding agent works under the hood, read the [Coding Agent Implementation Guide](docs/tutorial/README.en.md) (also available in [Chinese](docs/tutorial/README.md)). The seven-part series follows one small code change through the execution loop, code tools, permissions, sessions and context, streaming and failure recovery, and desktop integration, with source links for each point.

---

## 🛠️ Tech Stack

| Component | Technology |
|-----------|------------|
| Desktop Shell | [Tauri 2](https://v2.tauri.app/) (Rust) |
| Frontend UI | React 18 + Vite + TailwindCSS 4 |
| Backend Runtime | Bun (Node.js compatible) |
| Terminal | portable-pty (Rust) + xterm.js |
| State Management | Zustand |
| Protocol | WebSocket, MCP, LSP |

---

## 💻 Platform Support

| Platform     | Status                                  | Pre-built Installer                                      |
|--------------|-----------------------------------------|----------------------------------------------------------|
| Windows x64  | ✅ Maintainer-tested regularly           | No installer attached to v0.4.5; check Releases or run from source below |
| macOS arm64  | ⚠️ Not part of daily validation yet      | ❌ Community help welcome                                 |
| Linux x64    | ⚠️ Not part of daily validation yet      | ❌ Community help welcome                                 |

> DreamCoder is developed and validated primarily on **Windows x64**.
> The codebase already includes `#[cfg(target_os = "macos" / "linux")]` branches, but those platforms
> are not part of the maintainer's day-to-day workflow yet, so non-Windows support is still best-effort.
> If you're running DreamCoder on macOS or Linux, issues and PRs are especially valuable;
> for the current Linux memory investigation, see [#25](https://github.com/GoDiao/dreamcoder/issues/25).
> Check [GitHub Releases](https://github.com/GoDiao/dreamcoder/releases) for the actual assets available with each release.

---

## 📅 Roadmap

- [x] **Phase 1**: Desktop GUI implementation + Multi-Provider System + Project Workspace
- [x] **Phase 2**: CLI Backend Integration + Computer Use + MCP + Skills + Agent Teams
- [x] **Phase 2.5**: Performance — bundle splitting, polling throttle, terminal LRU, sessionStore refactor
- [x] **Phase 3**: H5 LAN Access (access desktop sessions from a phone/browser after enabling it)
- [ ] **Phase 4**: IM Adapter Integration (Feishu, DingTalk, Telegram, WeChat)
- [ ] **Phase 5**: Release Automation + Auto-update

See [ROADMAP](docs/ROADMAP_en.md)

---

## 🏁 Getting Started

### Prerequisites
*   [Bun](https://bun.sh/) >= 1.0
*   [Rust](https://www.rust-lang.org/tools/install) (required to build the desktop app)
*   Node.js >= 18 (still needed by parts of the dependency chain)

### Installation

> Release v0.4.5 does not include a pre-built installer. These steps run the development version from source. This is a Bun monorepo, with separate dependencies at the repo root and in `desktop/`. **Run all four steps below** to avoid startup failures in `tauri dev`, especially around the sidecar binary or missing Tauri CLI pieces.

```bash
# 0. Clone the repo
git clone https://github.com/GoDiao/dreamcoder.git
cd dreamcoder

# 1. Install root workspace dependencies (sidecar runtime: Anthropic SDK, AWS SDK, ink, etc.)
bun install

# 2. Install desktop dependencies (Tauri CLI + React frontend)
cd desktop && bun install

# 3. Build the sidecar binary
bun run build:sidecars

# 4. Launch the desktop app in dev mode
bun run tauri dev
```

> **Linux users**: you will also need system packages such as WebKitGTK, libappindicator, and librsvg.
> See the [Tauri prerequisites guide](https://v2.tauri.app/start/prerequisites/) for details.
> If you can contribute distro-specific setup commands, a PR would be greatly appreciated.

### Configure Your Model

1. Open DreamCoder and go to **Settings -> Providers**.
2. Add your API key (for example Anthropic, OpenAI, or DeepSeek).
3. Choose a default model and start coding.

### UI Language

On first launch, DreamCoder detects your system locale: Chinese systems (`zh-*`) get the Chinese UI, everything else defaults to English. You can switch languages anytime in **Settings**, and your manual choice is persisted and always takes precedence afterwards.

---

## 🤝 Contributing

Issues and pull requests are welcome. If you'd like to improve DreamCoder, start with the [Contributing Guide](docs/CONTRIBUTING_en.md) to get familiar with the workflow and collaboration style.

## 📝 Changelog

For release history and notable updates, see [CHANGELOG.md](CHANGELOG.md).

## 📄 License

[MIT](./LICENSE) &copy; 2024-2026 GoDiao & DreamCoder Contributors
