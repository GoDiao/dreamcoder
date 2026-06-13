<!--
╔══════════════════════════════════════════════════════════════════════════╗
║  DreamSeed 种梦计划 — AI创造者大赛  官方 README 模板                ║
║                                                                      ║
║  使用说明：                                                          ║
║  1. 将本模板放在参赛仓库根目录 README.md 的顶部                       ║
║  2. 头图使用 DreamField 官方公开活动图片地址                         ║
║  3. 请保留 DREAMFIELD_README_HEADER_START / END 标识                 ║
║  4. 分割线以下供创作者自由编写项目内容                               ║
╚══════════════════════════════════════════════════════════════════════════╝
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

**Claude Code 的开源桌面版 GUI**

*面向创造者的 AI 编程工作台*

[![Tauri 2](https://img.shields.io/badge/Tauri-2-blue)](https://v2.tauri.app/)
[![React 18](https://img.shields.io/badge/React-18-61DAFB)](https://react.dev/)
[![Bun](https://img.shields.io/badge/Bun-✓-fbf0df)](https://bun.sh/)
[![License: MIT](https://img.shields.io/badge/License-MIT-green)](./LICENSE)
[![Good First Issues](https://img.shields.io/github/issues/GoDiao/dreamcoder/good%20first%20issue?color=7057ff&label=good%20first%20issues)](https://github.com/GoDiao/dreamcoder/issues?q=is%3Aopen+is%3Aissue+label%3A%22good+first+issue%22)
[![Help Wanted](https://img.shields.io/github/issues/GoDiao/dreamcoder/help%20wanted?color=008672&label=help%20wanted)](https://github.com/GoDiao/dreamcoder/issues?q=is%3Aopen+is%3Aissue+label%3A%22help+wanted%22)

</div>

> 🌱 **正在招募贡献者！** 我们整理了一批 [good first issue](https://github.com/GoDiao/dreamcoder/issues?q=is%3Aopen+is%3Aissue+label%3A%22good+first+issue%22) 和 [help wanted](https://github.com/GoDiao/dreamcoder/issues?q=is%3Aopen+is%3Aissue+label%3A%22help+wanted%22)，每条都有 mentor 可以陪你走完第一个 PR。先读 [贡献指南](docs/CONTRIBUTING_zh.md) 再下手会更顺。

---

## ✨ 为什么是 DreamCoder？

Claude Code 非常强大，但它是一个纯命令行工具 (CLI-only)。
**DreamCoder 将 Claude Code 强大的核心引擎，封装进了现代的原生桌面应用中。**

> "我想要 Claude Code 的能力，但我需要一个 GUI 来管理会话、切换模型、处理文件。"

*   **非叉子 (Not a Fork)**：DreamCoder 复用了 Claude Code 的核心逻辑，或使用兼容的运行时。它只是给命令行体验穿上了一件漂亮的外衣。
*   **隐私优先**：你的 API Key 和数据完全保存在本地。不依赖任何云端服务。
*   **全模型支持**：无缝切换 Anthropic, OpenAI, DeepSeek, 阿里通义、MiniMax, Azure, Google Vertex 等。

---

## 🚀 核心功能

### 1. 原生桌面体验
*   **会话管理**：可视化历史、侧边栏导航、多标签页界面。
*   **集成终端**：内置 PTY (PowerShell/Bash/Zsh)，集成 xterm.js。
*   **可视化设置**：告别手动编辑 JSON 文件，在 UI 上直接管理 Provider 和 API Key。

![主界面](./assets/main.png)

### 2. 完美对接 Claude Code
*   **Computer Use 模式**：原生支持视觉模型控制电脑（截图模式），以及全新的 **UIA Tree 模式**（文本辅助访问模式，更快、更低成本）。
*   **工具调用可视化**：AI 读写文件、执行终端命令的过程全程透明可见。
*   **MCP 支持**：通过 Model Context Protocol 扩展 AI 能力。

![Computer Use 设置](./assets/setting_computeruse.png)

### 3. 高级 Provider 系统
*   **一键切换**：点击即可在不同模型供应商之间切换。
*   **支持列表**：Anthropic (Claude), OpenAI, DeepSeek, Moonshot (Kimi), MiniMax, Azure OpenAI, Google Vertex, AWS Bedrock。
*   **可视化测试**：在设置界面直接测试连接状态和延迟。

![Provider 设置](./assets/setting_provider.png)

---

### 4. MCP 扩展
*   **MCP 原生支持**：Model Context Protocol 全面支持。
*   **可视化配置**：告别 JSON 配置，图形界面管理 MCP 服务器。
*   **开箱即用**：内置常用 MCP 工具集成。

![MCP 技能设置](./assets/setting_skills.png)

---

## 🛠️ 技术栈

| 组件 | 技术选型 |
|------|----------|
| 桌面外壳 | [Tauri 2](https://v2.tauri.app/) (Rust) |
| 前端 UI | React 18 + Vite + TailwindCSS 4 |
| 后端运行时 | Bun (Node.js 兼容) |
| 终端 | portable-pty (Rust) + xterm.js |
| 状态管理 | Zustand |
| 协议 | WebSocket, MCP, LSP |

---

## 📅 路线图

- [x] **Phase 1**: 桌面端 GUI + 多模型支持 + 项目工作台
- [x] **Phase 2**: CLI 后端集成 + Computer Use + MCP + Skills + Agent Teams
- [x] **Phase 2.5**: 性能优化 — bundle 拆分、轮询节流、终端 LRU、sessionStore 重构
- [ ] **Phase 3**: H5 远程访问 (手机/浏览器接入桌面端会话)
- [ ] **Phase 4**: IM 适配器集成 (飞书/钉钉/Telegram/微信)
- [ ] **Phase 5**: Release 自动化 + 自动更新

详见 [ROADMAP](docs/ROADMAP_zh.md)

---

## 🏁 快速开始

### 环境要求
*   [Bun](https://bun.sh/) >= 1.0
*   [Rust](https://www.rust-lang.org/tools/install) (用于编译桌面端)
*   Node.js >= 18 (部分依赖需要)

### 安装与运行

```bash
# 1. 克隆仓库
git clone https://github.com/GoDiao/dreamcoder.git
cd dreamcoder

# 2. 安装依赖
bun install

# 3. 启动桌面端开发模式
cd desktop && bun run dev
```

### 配置 AI 模型

1.  打开 DreamCoder，进入 **设置 -> Provider (模型供应商)**。
2.  添加你的 API Key (例如：Anthropic, OpenAI, 或 DeepSeek)。
3.  选择默认模型，即可开始编程。

---

## 性能优化分支说明

> **分支**: `perf/optimization-report` | **日期**: 2026-05-29

本分支包含完整的性能审计和优化实施，共 14 项优化（11 项已完成，2 项不可行，1 项暂缓）。

### 已完成的优化

**Phase 1: 快速修复**
1. PTY 读缓冲区 8KB → 32KB — 大文件 `cat` 输出更流畅
2. `allUserMessages` 上限 3 条 — 防止标题生成内存无限增长
3. Team 成员轮询 in-flight 守卫 — 慢网络下不再堆叠请求
4. 工具模块 lazy import — `require()` 延迟加载 25+ 个工具模块
5. `terminal_environment()` OnceLock 缓存 — 环境变量只探测一次
6. 移除未使用的 `reqwest` 依赖 — 减少 Rust 编译时间和二进制体积

**Phase 2: Rust 层**
7. 窗口状态持久化防抖 500ms — 拖动窗口时写盘从数十次/秒降至 ≤2次/秒
8. Sidecar 启动异步化 — `std::thread::spawn`，窗口立即可交互

**Phase 3: 前端**
9. Elapsed timer 移出 Zustand — 计时器不再每秒触发全局 store 更新
10. chatStore granular selectors — MessageList 等组件只订阅需要的字段
11. Markdown 解析 `useDeferredValue` — 长代码输出时 UI 保持响应

**Phase 4: Server**
12. 会话元数据缓存 — 基于 mtime 的缓存，594 文件从 2s 降到 81ms

**Phase 5: 架构**
13. CLI↔Server pipe transport — stdin/stdout 替代 WebSocket 双跳（`DREAMCODER_USE_PIPE_TRANSPORT=1` 启用）

### 不可行 / 暂缓
- ~~Terminal sessions 换 DashMap~~ — `TerminalSession` 不满足 `Sync` trait
- ~~Query loop 遍历合并~~ — 内部有显式顺序依赖
- ~~二进制协议 (msgpack)~~ — 消息体积小，投入产出比低

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

## 🤝 贡献指南

欢迎提交 Issue 和 PR！请阅读我们的 [贡献指南](docs/CONTRIBUTING_zh.md) 了解更多详情。

## 📝 更新日志

版本历史详见 [CHANGELOG.md](CHANGELOG.md)。

## 📄 许可证

[MIT](./LICENSE) &copy; 2024-2026 GoDiao & DreamCoder Contributors
