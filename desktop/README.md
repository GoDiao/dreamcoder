# DreamCoder Desktop

DreamCoder — AI Coding Agent 桌面应用。DreamSeed 竞赛参赛作品。

## 功能特性

- **多 AI 服务商支持** — DeepSeek、通义千问、Kimi、智谱 GLM 等 Anthropic / OpenAI 兼容服务，以及 Ollama、LM Studio 本地模型
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
| 桌面壳 | Electron |
| 前端 | React + TypeScript |
| 运行时 | Bun |
| 样式 | Tailwind CSS v4 主题系统 |

## 系统要求

- Windows 10+ (x64)：终端使用 Git Bash 时需要另装 Git for Windows
- macOS (Apple Silicon)：提供 `.dmg` 安装包，也可从源码运行
- Linux：尚未日常验证，详见根目录 README 的「平台支持现状」

## 开发指南

```bash
git clone https://github.com/GoDiao/dreamcoder.git
cd dreamcoder
bun install                # 根工作区依赖（sidecar 运行时）
cd desktop && bun install  # 桌面端依赖（Electron + React 前端）
bun run electron:install   # 下载 Electron 本体
bun run build:sidecars     # 编译 sidecar 二进制
bun run electron:dev       # 同时启动 Vite 和 Electron
```

主进程和 preload 的说明见 [electron/README.md](electron/README.md)。

## 构建发布

```bash
bun run electron:pack
```

构建产物位于 `electron-release/` 目录。

## 许可证

[MIT License](LICENSE)

## 致谢

感谢 Claude Code 开源社区的贡献与支持。
