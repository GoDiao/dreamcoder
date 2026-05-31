<!--
╔══════════════════════════════════════════════════════════════════════════╗
║  DreamCoder: Open-Source Claude Desktop Alternative                      ║
╚══════════════════════════════════════════════════════════════════════════╝
-->

<div align="center">

# DreamCoder

**The Open-Source Desktop GUI for Claude Code**

*A full-featured AI coding workbench that combines the power of Claude Code with a modern native desktop experience.*

[![Tauri 2](https://img.shields.io/badge/Tauri-2-blue)](https://v2.tauri.app/)
[![React 18](https://img.shields.io/badge/React-18-61DAFB)](https://react.dev/)
[![Bun](https://img.shields.io/badge/Bun-✓-fbf0df)](https://bun.sh/)
[![License: MIT](https://img.shields.io/badge/License-MIT-green)](./LICENSE)

</div>

---

## ✨ Why DreamCoder?

Claude Code is powerful, but it's CLI-only.
DreamCoder brings a **native desktop interface** to that powerful engine.

> "I want the power of Claude Code, but I need a GUI for session management, provider switching, and visual interaction."

*   **Not a Fork**: DreamCoder runs alongside Claude Code logic (or replaces it with compatible runtimes). It wraps the CLI experience in a beautiful, usable window.
*   **Privacy First**: Your API keys and data stay on your machine. No cloud dependency required.
*   **Universal Provider**: Seamlessly switch between Anthropic, OpenAI, DeepSeek, Azure, Google Vertex, and more.

---

## 🚀 Key Features

### 1. Native Desktop Experience
*   **Session Management**: Visual history, sidebar navigation, and tabbed interface.
*   **Integrated Terminal**: Built-in PTY (PowerShell/Bash/Zsh) with xterm.js.
*   **Settings GUI**: Manage providers, API keys, and preferences without editing JSON files.

### 2. Claude Code Compatibility
*   **Computer Use Mode**: Native support for visual AI control (screenshots) AND the new **UIA Tree mode** (text-only accessibility, faster, lower cost).
*   **Tool Execution**: Fully transparent file editing and command execution.
*   **MCP Support**: Extend AI capabilities with the Model Context Protocol.

### 3. Advanced Provider System
*   One-click switching between multiple LLM providers.
*   **Supported**: Anthropic (Claude), OpenAI, DeepSeek, Moonshot (Kimi), MiniMax, Azure OpenAI, Google Vertex, AWS Bedrock.
*   **Visual Testing**: Test connectivity and latency directly in the settings UI.

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

## 📅 Roadmap

- [x] **Phase 1**: Desktop App (Windows/macOS) + Multi-Provider System + Project Workspace
- [x] **Phase 2**: CLI Backend Integration + Computer Use (Visual + UIA Mode)
- [ ] **Phase 3**: Cloud Sync & H5 Remote Access (Access AI from phone/browser)
- [ ] **Phase 4**: IM Adapters (Feishu, Slack, Discord, Telegram)

---

## 🏁 Getting Started

### Prerequisites
*   [Bun](https://bun.sh/) >= 1.0
*   [Rust](https://www.rust-lang.org/tools/install) (for building the desktop app)
*   Node.js >= 18 (for some dependencies)

### Installation

```bash
# 1. Clone the repository
git clone https://github.com/GoDiao/dreamcoder.git
cd dreamcoder

# 2. Install dependencies
bun install

# 3. Run in development mode
cd desktop && bun run dev
```

### Configuration

1.  Open DreamCoder and go to **Settings -> Providers**.
2.  Add your API Key (e.g., for Anthropic, OpenAI, or DeepSeek).
3.  Select the default model and start coding.

---

## 🤝 Contributing

Contributions are welcome! Please read our [Contributing Guide](docs/CONTRIBUTING.md) for details.

## 📄 License

[MIT](./LICENSE) &copy; 2024-2026 GoDiao & DreamCoder Contributors