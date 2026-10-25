[English](./TROUBLESHOOTING.md) | 简体中文

# 常见问题排查

构建或运行 DreamCoder 时的常见问题及解决方法。

> **想贡献解决方案？** 先看 [CONTRIBUTING_zh.md](CONTRIBUTING_zh.md) 了解 PR 流程。
> 问题跟踪在 [github.com/GoDiao/dreamcoder/issues](https://github.com/GoDiao/dreamcoder/issues)。
> 在 app 里反馈问题：侧边栏 **更多 → 报告问题**。它会列出版本、系统、服务商类型和最近的错误（已去掉密钥和用户目录），并打开一个已填好版本号的新 issue。

---

## 构建与安装

### `Electron failed to install correctly`

**现象：** `bun run electron:dev` 报错 `Electron failed to install correctly, please delete node_modules/electron and try installing again` 后退出。

**原因：** Bun 不会运行 Electron 的安装脚本，所以 `bun install` 之后 Electron 本体还没有下载。

**解决：**
```bash
cd desktop
bun run electron:install
bun run electron:dev
```

---

### 窗口打开了，但显示 "Local server failed to start"

**现象：** `bun run electron:dev` 打开了窗口，界面显示 **Local server failed to start**，原因是 `sidecar failed to start: spawn … ENOENT`。

**原因：** 漏跑了 `bun run build:sidecars`。`desktop/binaries/` 目录在 `.gitignore` 里，全新 clone 的仓库没有 sidecar 二进制，必须手动编译。

**解决：**
```bash
cd desktop
bun run build:sidecars
bun run electron:dev
```

---

### `Vite did not answer on http://localhost:1420`

**现象：** `bun run electron:dev` 在窗口打开之前就退出了。

**原因：** 1420 端口被其他进程占用，或者 Vite 启动失败（错误信息打印在上方）。

**解决：** 结束占用 1420 端口的进程（macOS 和 Linux 上可用 `lsof -i :1420` 查看），再重新运行 `bun run electron:dev`。

---

## 运行时

### 内存占用过高（8–16 GB）/ UI 卡死 / 系统 OOM

**现象：** 启动后，DreamCoder 的 sidecar 或 WebView 进程内存飙升至 8–16 GB，导致 UI 卡死或系统杀进程（OOM）。

**状态：** 部分修复 —— 跟踪 issue [#25](https://github.com/GoDiao/dreamcoder/issues/25)。

**已确认平台：** Windows 10 x64、Arch Linux。

**目前已知：**

目前看来存在**两个独立的问题**：

1. **Sidecar 启动时内存飙升** — `listSessions` 会把每个 session 的完整 JSONL 文件加载到内存。已在 [#31](https://github.com/GoDiao/dreamcoder/pull/31) 修复：48 个 session 的机器上 sidecar 峰值从 ~2.5 GB 降到 ~900 MB。如果你还在用旧版本，请更新到最新的 `dev` / `master`。

2. **WebKitGTK 内存泄漏（Linux 专属）** — 此前的 Tauri 外壳在 Linux 上，即使 sidecar 没运行、前端在独立浏览器中正常，`WebKitWebProcess` 仍以 ~100 MB/s 的速度增长。Electron 外壳不使用 WebKitGTK，欢迎反馈 Linux 上是否还有这个现象。

各平台的具体调查记录见 [ENVIRONMENT_TESTING.md](ENVIRONMENT_TESTING.md)。

---

### 窗口打开了但页面白屏

**现象：** DreamCoder 窗口打开了，但显示空白页面。

**原因：** 通常是 Vite 开发服务器连接问题：前端 dev server 没启动或端口被占用。

**解决：**
1. 确认用的是 `bun run electron:dev` 而不是 `bun run dev`（后者只启动 Vite）。
2. 改用构建好的前端：`cd desktop && bun run build && bun run electron:start`。
3. 用 F12 或 Ctrl/Cmd+Shift+I 打开开发者工具（仅开发版）查看控制台报错。

---

## 参与维护本指南

本文件由社区共同维护。如果你遇到了这里没列出的问题并找到了解决方案：

1. 先开 issue 描述问题和解决方法。
2. 确认后，提 PR 将你的条目加入本文件。
3. 格式参照现有条目：**现象 → 原因 → 解决 → （可选）备注**。
