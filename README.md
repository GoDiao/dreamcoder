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

# DreamCoder

<p align="center">
  <strong>立志成为 DreamField 官方 Coding Agent</strong>
</p>

<p align="center">
  中文原生 AI 编程桌面工作台 — 集成 AI 对话、代码生成/编辑、项目管理、多模型切换于一体，专为国内开发者打造。
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Tauri-2-blue" alt="Tauri 2" />
  <img src="https://img.shields.io/badge/React-19-61DAFB" alt="React 19" />
  <img src="https://img.shields.io/badge/TypeScript-5-3178C6" alt="TypeScript" />
  <img src="https://img.shields.io/badge/License-MIT-green" alt="License" />
</p>

---

## 特性

- 🖥️ **桌面工作台** — 基于 Tauri 2 的 Windows 桌面应用
- 💬 **多会话管理** — 标签页式会话，支持项目切换与 Worktree 隔离
- 🔀 **代码 Diff 面板** — 实时查看 AI 编辑的代码变更
- 🤖 **多模型支持** — DreamField 官方 Provider + DeepSeek、通义千问、Kimi 等
- 🏠 **DreamField 深度集成** — 默认接入 DreamField 平台，开箱即用
- 🔐 **权限审批流** — 危险操作集中审批，安全可控
- 🇨🇳 **中文原生** — 全中文界面、文档与预设 Prompt
- 🔌 **MCP 支持** — 接入任意 MCP 工具服务器

## 快速开始

```bash
# 安装依赖
bun install

# 启动桌面端开发
cd desktop && bun run dev

# 或启动后端服务
SERVER_PORT=3456 bun run src/server/index.ts
```

## 技术栈

| 类别 | 技术 |
|------|------|
| 桌面框架 | Tauri 2 |
| 前端 UI | React 19 + Vite + TailwindCSS 4 |
| 状态管理 | Zustand |
| 本地运行时 | Bun |
| 语言 | TypeScript |
| 协议 | MCP, LSP |

## Roadmap

- ✅ Phase 1: Windows 桌面端 + 后端服务 + 多模型支持
- 🔜 Phase 2: CLI 终端 UI (macOS + Windows)
- 🔜 Phase 3: IM 适配器 (飞书/Telegram/微信/钉钉)
- 🔜 Phase 4: Computer Use / H5 远程 / 定时任务 / Teams

## 贡献

欢迎提交 Issue 和 PR！

## License

MIT
