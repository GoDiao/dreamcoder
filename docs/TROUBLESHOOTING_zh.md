# 常见问题排查

构建或运行 DreamCoder 时的常见问题及解决方法。

> **想贡献解决方案？** 先看 [CONTRIBUTING_zh.md](CONTRIBUTING_zh.md) 了解 PR 流程。
> 问题跟踪在 [github.com/GoDiao/dreamcoder/issues](https://github.com/GoDiao/dreamcoder/issues)。

---

## 构建与安装

### `failed to find binary 'dreamcoder-sidecar-...'`

**现象：** `bun run tauri dev` 启动即报错，提示找不到 sidecar 二进制文件。

**原因：** 漏跑了 `bun run build:sidecars`。`desktop/src-tauri/binaries/` 目录在 `.gitignore` 里，全新 clone 的仓库没有 sidecar 二进制，必须手动编译。

**解决：**
```bash
cd desktop
bun run build:sidecars
bun run tauri dev
```

---

### `command not found: tauri` 或 `@tauri-apps/cli` 找不到

**现象：** 运行 `bun run tauri dev` 提示 `tauri` 命令不存在。

**原因：** `@tauri-apps/cli` 在 `desktop/package.json` 的 `optionalDependencies` 里，根目录的 `bun install` **不会**安装它，必须在 `desktop/` 里再跑一次 `bun install`。

**解决：**
```bash
cd desktop
bun install
bun run tauri dev
```

---

### `dist/` 目录不存在

**现象：** Tauri 启动失败，提示找不到 `desktop/dist/`。

**原因：** Tauri 需要 Vite 构建产物。`bun run tauri dev` 通常会自动构建，但如果直接调 `cargo tauri` 或 Vite 步骤出错，dist 可能缺失。

**解决：**
```bash
cd desktop
bun run build          # 生成 dist/
bun run tauri dev
```

---

### Linux：找不到 WebKitGTK / GTK 库

**现象：** Linux 下 `bun run tauri dev` 报错，提示缺少 `webkit2gtk`、`libgtk-3`、`libappindicator`、`librsvg` 等动态库。

**原因：** Tauri 依赖多个系统级库，大多数 Linux 发行版不会预装。

**解决：** 安装 [Tauri Linux 系统依赖](https://v2.tauri.app/start/prerequisites/#linux)。不同发行版的包名不同：

| 发行版 | 安装命令 |
|---|---|
| Arch Linux | `sudo pacman -S webkit2gtk-4.1 libgtk-3 libappindicator-gtk3 librsvg libsoup3`（社区验证，可能需要调整） |
| Ubuntu / Debian | 见 [Tauri 官方文档](https://v2.tauri.app/start/prerequisites/#linux) |
| Fedora | 见 [Tauri 官方文档](https://v2.tauri.app/start/prerequisites/#linux) |

> **注意：** 维护者不在 Linux 上日常使用，上述 Arch 命令为推测。如果你确认了某发行版的正确包列表，欢迎 PR 更新此节。

---

## 运行时

### 内存占用过高（8–16 GB）/ UI 卡死 / 系统 OOM

**现象：** 启动后，DreamCoder 的 sidecar 或 WebView 进程内存飙升至 8–16 GB，导致 UI 卡死或系统杀进程（OOM）。

**状态：** 正在调查中 —— 跟踪 issue [#25](https://github.com/GoDiao/dreamcoder/issues/25)。

**已确认平台：** Windows 10 x64、Arch Linux。

**临时方案：** 暂无。如果你能抓取内存快照（如 sidecar 的 `heapsnapshot` 或系统进程监控数据）贴到 [#25](https://github.com/GoDiao/dreamcoder/issues/25)，会很有帮助。

---

### 窗口打开了但页面白屏

**现象：** Tauri 窗口打开了，但显示空白页面。

**原因：** 通常是 Vite 开发服务器连接问题 —— 前端 dev server 没启动或端口被占用。

**解决：**
1. 确认用的是 `bun run tauri dev` 而不是 `bun run dev`（后者只启动 Vite，不启动 Tauri）。
2. 尝试 production 构建：`cd desktop && bun run build && bun run tauri dev`。
3. 打开 Tauri 开发者工具（右键 → Inspect）查看控制台报错。

---

## 参与维护本指南

本文件由社区共同维护。如果你遇到了这里没列出的问题并找到了解决方案：

1. 先开 issue 描述问题和解决方法。
2. 确认后，提 PR 将你的条目加入本文件。
3. 格式参照现有条目：**现象 → 原因 → 解决 → （可选）备注**。
