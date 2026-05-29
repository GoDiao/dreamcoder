<!--
╔══════════════════════════════════════════════════════════════════════╗
║  DreamSeed 种梦计划 — AI创造者大赛  官方 README 模板                ║
║                                                                      ║
║  使用说明：                                                          ║
║  1. 将本模板放在参赛仓库根目录 README.md 的顶部                       ║
║  2. 头图使用 DreamField 官方公开活动图片地址                         ║
║  3. 请保留 DREAMFIELD_README_HEADER_START / END 标识                 ║
║  4. 分割线以下供创作者自由编写项目内容                               ║
╚══════════════════════════════════════════════════════════════════════╝
-->

<!-- DREAMFIELD_README_HEADER_START -->

<p align="center">
  <a href="https://www.dreamfield.top">
    <img src="https://www.dreamfield.top/dream-field/contest-readme/assets/dreamseed-readme-banner.png" alt="DreamSeed 种梦计划参赛作品" width="100%" />
  </a>
</p>

<!-- DREAMFIELD_README_HEADER_END -->

---

<div align="center">

# DreamCoder

**面向国内开发者的 AI 编程桌面工作台**

[![Tauri 2](https://img.shields.io/badge/Tauri-2-blue)](https://v2.tauri.app/)
[![React 18](https://img.shields.io/badge/React-18-61DAFB)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6)](https://www.typescriptlang.org/)
[![Bun](https://img.shields.io/badge/Bun-✓-fbf0df)](https://bun.sh/)
[![License: MIT](https://img.shields.io/badge/License-MIT-green)](./LICENSE)

</div>

---

## DreamCoder 是什么

DreamCoder 是一个开箱即用的 AI 编程助手桌面应用。它把 AI 对话、代码编辑、终端操作和项目管理整合到一个窗口里，让你用自然语言描述需求，AI 帮你写代码、改文件、跑命令。

核心定位：

- **中文原生体验** — 全中文界面和文档，默认接入 DreamField 平台，无需科学上网
- **多模型自由切换** — 支持 Claude 系列模型，也支持 DeepSeek、通义千问、Kimi、MiniMax 等国产模型，以及 OpenRouter、Azure 等国际平台
- **桌面级工作台** — 不是浏览器标签页，而是完整的桌面应用：内置终端、Diff 查看器、文件管理、会话管理

## 功能亮点

### AI 对话 & 代码编辑

- 多会话标签页管理，每个会话绑定独立项目目录
- 实时流式输出，支持 Markdown 渲染（代码高亮、Mermaid 图表、KaTeX 公式）
- 代码 Diff 面板，直观查看 AI 对文件的每一步修改
- 工具调用可视化，AI 读写文件、执行命令的过程全程透明

### 多模型 Provider 系统

- 内置 Claude Opus / Sonnet / Haiku 官方模型
- 支持添加自定义 Provider：填入 API 地址和密钥即可接入任意 OpenAI 兼容接口
- 通过 `.env` 或 LiteLLM 代理接入 DeepSeek、MiniMax、OpenRouter、Azure OpenAI 等
- 一键测试连接状态和延迟

### 项目工作台

- 内置 PTY 终端，支持 PowerShell / bash / zsh / 自定义 Shell
- 文件系统浏览和在线编辑
- MCP (Model Context Protocol) 工具服务器支持，扩展 AI 的能力边界
- 插件系统，支持加载和管理第三方技能插件

### 安全 & 权限

- 危险操作（文件删除、命令执行等）集中审批流，用户逐条确认
- 多级权限模式：自动批准 / 逐条确认 / 计划模式
- API 密钥本地存储，不上传任何凭据

### 桌面体验

- Windows / macOS 双平台支持
- 系统托盘常驻，关闭窗口不退出
- 窗口位置和大小自动记忆
- 便携模式（Portable），配置文件随 exe 移动
- 中英双语界面切换

## 技术架构

```
┌─────────────────────────────────────────────┐
│                 Tauri 2 桌面窗口              │
│  ┌──────────┐  ┌──────────┐  ┌───────────┐  │
│  │  React   │  │  Zustand │  │  xterm.js │  │
│  │  UI 层   │  │  状态管理 │  │   终端    │  │
│  └────┬─────┘  └────┬─────┘  └─────┬─────┘  │
│       │    HTTP / WebSocket     PTY IPC      │
│  ┌────▼──────────────────────────────▼─────┐ │
│  │          Rust (Tauri Core)              │ │
│  │   窗口管理 · 侧车进程 · 系统托盘        │ │
│  └────┬────────────────────────────────────┘ │
│       │ Sidecar IPC                          │
│  ┌────▼────────────────────────────────────┐ │
│  │      Bun Server (TypeScript)            │ │
│  │   AI 代理 · 会话管理 · 文件操作 · MCP   │ │
│  └─────────────────────────────────────────┘ │
└─────────────────────────────────────────────┘
```

| 层级 | 技术栈 |
|------|--------|
| 桌面框架 | [Tauri 2](https://v2.tauri.app/) — Rust 核心，原生性能 |
| 前端 UI | React 18 + Vite 8 + TailwindCSS 4 |
| 状态管理 | Zustand |
| 终端 | portable-pty (Rust) + xterm.js |
| 后端运行时 | Bun |
| 语言 | TypeScript + Rust |
| 协议 | MCP, LSP, WebSocket |

## 快速开始

### 环境要求

- [Bun](https://bun.sh/) >= 1.0
- [Rust](https://www.rust-lang.org/tools/install) (桌面端编译)
- Node.js >= 18 (部分依赖需要)

### 安装 & 运行

```bash
# 克隆仓库
git clone https://github.com/GoDiao/dreamcoder.git
cd dreamcoder

# 安装依赖
bun install

# 启动桌面端开发模式
cd desktop && bun run dev
```

首次启动时，应用会引导你配置 AI Provider（也可以跳过，之后在设置中配置）。

### 配置 AI 模型

复制 `.env.example` 为 `.env`，根据注释选择一个 Provider 配置：

```bash
# 示例：接入 MiniMax
ANTHROPIC_AUTH_TOKEN=your_api_key
ANTHROPIC_BASE_URL=https://api.minimaxi.com/anthropic
ANTHROPIC_MODEL=MiniMax-M2.7
```

也可以在桌面端的 **设置 → Provider** 中可视化配置。

## 项目结构

```
dreamcoder/
├── desktop/              # Tauri 桌面应用
│   ├── src/              # React 前端
│   │   ├── components/   # UI 组件 (聊天、设置、终端...)
│   │   ├── stores/       # Zustand 状态管理
│   │   ├── pages/        # 页面级组件
│   │   ├── api/          # 后端 API 客户端
│   │   └── i18n/         # 中英文翻译
│   └── src-tauri/        # Rust 后端 (窗口、终端、侧车管理)
│       ├── src/
│       └── icons/
├── src/                  # 核心运行时
│   ├── server/           # Bun HTTP/WS 服务器
│   │   ├── api/          # REST API 路由
│   │   ├── services/     # 业务逻辑 (会话、MCP、文件系统...)
│   │   └── proxy/        # 模型代理 (Anthropic ↔ OpenAI 格式转换)
│   ├── constants/        # 配置和常量
│   └── hooks/            # CLI/终端 hooks
├── adapters/             # IM 适配器 (飞书/Telegram/微信/钉钉)
└── runtime/              # 运行时工具
```

## Roadmap

- [x] **Phase 1** — Windows 桌面端 + 多模型支持 + 项目工作台
- [ ] **Phase 2** — CLI 终端 UI (macOS + Windows)
- [ ] **Phase 3** — IM 适配器上线 (飞书 / 钉钉 / Telegram / 微信)
- [ ] **Phase 4** — Computer Use / H5 远程访问 / 定时任务

---

## 性能优化分支说明

> **分支**: `perf/optimization-report` | **日期**: 2026-05-29

本分支包含完整的性能审计和优化实施，共 14 项优化（11 项已完成，2 项不可行，1 项暂缓）。

### Benchmark 关键结果

| 优化项 | Before | After | 提升 |
|--------|--------|-------|------|
| 会话元数据缓存 | 2.02s (cold) | 81ms (warm) | **24.8x** |
| Elapsed timer 外置 | 10.91ms in-store | 6.74ms external | **1.6x** |
| Markdown useDeferredValue | 105µs blocking | yields to UI | 主线程不阻塞 |
| Pipe transport | WS JSON | JSON+encode (+49%/msg) | 消除双跳延迟 |

### 相关文档

- `docs/perf-optimization-report.md` — 性能审计报告
- `docs/perf-optimization-plan.md` — 实施计划（含完成状态）
- `docs/perf-optimization-results.md` — Benchmark 结果详情
- `scripts/benchmark.ts` — 自动化 benchmark 脚本

### 运行 Benchmark

```bash
bun run scripts/benchmark.ts
```

---

## 贡献

欢迎提交 Issue 和 PR！

## License

[MIT](./LICENSE) &copy; 2024-2026 GoDiao & DreamCoder Contributors
