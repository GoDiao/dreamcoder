<!--
╔══════════════════════════════════════════════════════════════════════════╗
║  DreamCoder: Open-Source Claude Desktop Alternative                      ║
╚══════════════════════════════════════════════════════════════════════════╝
-->

<div align="right">

English | [简体中文](./README.md)

</div>

<div align="center">

# DreamCoder

**An open-source desktop GUI for Claude Code**

*A polished AI coding workspace built for everyday creation and collaboration.*

[![Tauri 2](https://img.shields.io/badge/Tauri-2-blue)](https://v2.tauri.app/)
[![React 18](https://img.shields.io/badge/React-18-61DAFB)](https://react.dev/)
[![Bun](https://img.shields.io/badge/Bun-✓-fbf0df)](https://bun.sh/)
[![License: MIT](https://img.shields.io/badge/License-MIT-green)](./LICENSE)
[![Good First Issues](https://img.shields.io/github/issues/GoDiao/dreamcoder/good%20first%20issue?color=7057ff&label=good%20first%20issues)](https://github.com/GoDiao/dreamcoder/issues?q=is%3Aopen+is%3Aissue+label%3A%22good+first+issue%22)
[![Help Wanted](https://img.shields.io/github/issues/GoDiao/dreamcoder/help%20wanted?color=008672&label=help%20wanted)](https://github.com/GoDiao/dreamcoder/issues?q=is%3Aopen+is%3Aissue+label%3A%22help+wanted%22)

</div>

> 🌱 **We're looking for contributors!** Browse our curated [good first issues](https://github.com/GoDiao/dreamcoder/issues?q=is%3Aopen+is%3Aissue+label%3A%22good+first+issue%22) and [help wanted](https://github.com/GoDiao/dreamcoder/issues?q=is%3Aopen+is%3Aissue+label%3A%22help+wanted%22) tasks — each one comes with a mentor who'll walk you through your first PR. Start with the [contributing guide](docs/CONTRIBUTING_en.md).

---

## ✨ Why DreamCoder?

Claude Code is powerful, but the command line is not the best interface for every workflow.
**DreamCoder brings Claude Code's core capabilities into a native desktop app, making session management, model switching, and file operations far more intuitive.**

> "I want the power of Claude Code, plus a desktop interface that makes sessions, models, and files easier to manage."

*   **Built on the Claude Code experience**: DreamCoder reuses Claude Code's core logic, or a compatible runtime, and adds the desktop interaction layer that many daily workflows need.
*   **Privacy first**: API keys and data stay on your machine by default, with no hosted cloud dependency required.
*   **Freedom across providers**: Seamlessly switch between Anthropic, OpenAI, DeepSeek, Azure, Google Vertex, and more.

---

## 🚀 Key Features

### 1. Native Desktop Experience
*   **Smoother session management**: Visual history, sidebar navigation, and a tabbed interface.
*   **Terminal built into the workflow**: Built-in PTY (PowerShell/Bash/Zsh) with xterm.js.
*   **Settings you can manage visually**: Configure providers, API keys, and preferences without editing JSON files.

### 2. Deep Claude Code Integration
*   **Dual Computer Use modes**: Supports both visual screenshot control and the new **UIA Tree mode** (text-based accessibility, faster and more cost-efficient).
*   **Transparent tool execution**: File edits and terminal commands are surfaced clearly, so it's easy to understand and review what the agent is doing.
*   **MCP extensibility**: Expand context and tooling through the Model Context Protocol.

### 3. Flexible Provider Layer
*   **Switch providers in one click**: Move between model vendors without friction.
*   **Broad model coverage**: Anthropic (Claude), OpenAI, DeepSeek, Moonshot (Kimi), MiniMax, Azure OpenAI, Google Vertex, AWS Bedrock.
*   **Connectivity visible at a glance**: Test availability and latency directly from Settings.

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
| Windows x64  | ✅ Maintainer-tested regularly           | ✅ NSIS `.exe` + MSI `.msi` (published with each release) |
| macOS arm64  | ⚠️ Not part of daily validation yet      | ❌ Community help welcome                                 |
| Linux x64    | ⚠️ Not part of daily validation yet      | ❌ Community help welcome                                 |

> DreamCoder is developed and validated primarily on **Windows x64**.
> The codebase already includes `#[cfg(target_os = "macos" / "linux")]` branches, but those platforms
> are not part of the maintainer's day-to-day workflow yet, so non-Windows support is still best-effort.
> If you're running DreamCoder on macOS or Linux, issues and PRs are especially valuable;
> for the current Linux memory investigation, see [#25](https://github.com/GoDiao/dreamcoder/issues/25).

---

## 📅 Roadmap

- [x] **Phase 1**: Desktop App (Windows/macOS) + Multi-Provider System + Project Workspace
- [x] **Phase 2**: CLI Backend Integration + Computer Use + MCP + Skills + Agent Teams
- [x] **Phase 2.5**: Performance — bundle splitting, polling throttle, terminal LRU, sessionStore refactor
- [x] **Phase 3**: H5 Remote Access (access desktop sessions from phone/browser)
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

> This is a Bun monorepo, with separate dependencies at the repo root and in `desktop/`. **Run all four steps below** to avoid startup failures in `tauri dev`, especially around the sidecar binary or missing Tauri CLI pieces.

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

---

## 🤝 Contributing

Issues and pull requests are welcome. If you'd like to improve DreamCoder, start with the [Contributing Guide](docs/CONTRIBUTING_en.md) to get familiar with the workflow and collaboration style.

## 📝 Changelog

For release history and notable updates, see [CHANGELOG.md](CHANGELOG.md).

## 📄 License

[MIT](./LICENSE) &copy; 2024-2026 GoDiao & DreamCoder Contributors