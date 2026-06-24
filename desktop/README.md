# DreamCoder Desktop

DreamCoder — AI Coding Agent 桌面应用。DreamSeed 竞赛参赛作品。

## 功能特性

- **多 AI 服务商支持** — DreamField、Anthropic、OpenAI 及 OpenAI 兼容服务
- **内置终端** — 在应用内直接执行命令行操作
- **MCP 服务管理** — 一键配置和管理 MCP 工具服务
- **多主题支持** — 包含 DreamField 翡翠绿主题在内的多种配色方案
- **中英文双语界面** — 完整的国际化支持
- **权限模式控制** — 灵活的文件系统和命令执行权限管理
- **会话管理与历史回溯** — 保存、搜索和恢复历史对话
- **Provider 预设快速配置** — 常用服务商开箱即用的预设模板

## 技术架构

| 层级 | 技术 |
|------|------|
| 桌面壳 | Tauri 2 (Rust) |
| 前端 | React + TypeScript |
| 运行时 | Bun |
| 样式 | Tailwind CSS v4 主题系统 |

## 系统要求

- Windows 10+ (x64)
- WebView2 Runtime（Windows 10 较新版本已内置）
- Git Bash

## 开发指南

```bash
git clone https://github.com/GoDiao/dreamcoder.git
cd dreamcoder/desktop
bun install
bun run tauri dev
```

## 构建发布

```bash
bun run tauri build
```

构建产物位于 `build-artifacts/` 目录。

## 许可证

[MIT License](LICENSE)

## 致谢

感谢 Claude Code 开源社区的贡献与支持。
