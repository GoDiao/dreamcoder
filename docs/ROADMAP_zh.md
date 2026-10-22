[English](./ROADMAP_en.md) | 简体中文

# 路线图

## Phase 1 — 桌面端 GUI + 多模型支持 ✅

- [x] Tauri 2 桌面应用（macOS Apple Silicon 为日常开发平台；Windows x64 测试充分；Linux 尽力支持）
- [x] 多 Provider 配置（Anthropic/OpenAI 兼容接口；DeepSeek、通义千问、Kimi、智谱 GLM、LM Studio、Ollama 等预设）
- [x] 可视化设置界面 (Provider、API Key、模型映射)
- [x] 会话管理 (多标签、侧边栏、历史搜索)
- [x] 内置 PTY 终端 (PowerShell/Bash/Zsh)
- [x] 权限控制 (4 种模式)
- [x] 中英文国际化

## Phase 2 — CLI 后端 + Computer Use ✅

- [x] Sidecar 后端架构 (dreamcoder-sidecar.exe)
- [x] Computer Use（现由 cua-driver 驱动，取代了视觉截图模式和 UIA Tree 模式）
- [x] MCP 协议支持 + 可视化管理
- [x] Skills 技能系统
- [x] MCP 市场（浏览并安装精选服务器）
- [x] Agent Teams 多代理协作
- [x] 代码 Diff 可视化
- [x] 定时任务 + Cron 表达式
- [x] Worktree/分支隔离启动
- [x] 自动更新检查 (UpdateChecker)

## Phase 2.5 — 性能优化 ✅

- [x] Bundle 拆分 (manualChunks + lazy Settings)
- [x] KaTeX/Mermaid 动态导入 + 错误 UI
- [x] 轮询节流/防抖
- [x] 终端 LRU 驱逐 (活跃进程感知)
- [x] sessionStore 单一数据源重构
- [x] 定时任务轮询失败 Toast 提示
- [x] 可配置终端数量上限

## Phase 3 — H5 远程访问 ✅

启用 H5 接入后，可在同一局域网内从手机浏览器访问桌面端会话。跨网络访问需要用户自行配置反向代理。

- [x] H5 访问开关与 Token 管理
- [x] 手机端聊天 UI 适配
- [x] WebSocket 远程桥接
- [x] CORS 安全策略
- [x] LAN 直连 + 二维码配对
- [ ] 反向代理部署指南（仍在编写）

参考: [Issue #3](https://github.com/GoDiao/dreamcoder/issues/3)

## Phase 4 — Release 自动化

- [x] 推送版本 tag 后由 GitHub Actions 构建安装包，生成草稿 Release
- [x] 跨平台打包：macOS `.dmg` 和 Windows `-setup.exe`（从 v0.5.0 起）
- [x] 版本号由一个脚本统一同步（`scripts/release.ts`）
- [x] Release Notes 取自 CHANGELOG 中对应版本的段落
- [x] 每次发版对安装包做冒烟测试
- [ ] 用自有签名密钥的应用内自动更新（[#118](https://github.com/GoDiao/dreamcoder/issues/118)）

## Phase 5 — 远程 Agent 后端

- [ ] 通过 SSH / WebSocket 在远程主机上运行 Agent，本地桌面端作为界面

参考: [RFC #24](https://github.com/GoDiao/dreamcoder/issues/24)

## 进行中

- [ ] 回复流式输出时桌面端的流畅度（[#153](https://github.com/GoDiao/dreamcoder/issues/153)、[#154](https://github.com/GoDiao/dreamcoder/issues/154)）
- [ ] 加快桌面端启动（[#152](https://github.com/GoDiao/dreamcoder/issues/152)）
- [x] 服务端统一管理会话状态，所有客户端共享（[#150](https://github.com/GoDiao/dreamcoder/pull/150)）

## 调研中

- Agent Teams：[RFC #162](https://github.com/GoDiao/dreamcoder/issues/162)
- System 1 决策模型，先从权限守卫做起：[RFC #124](https://github.com/GoDiao/dreamcoder/issues/124)
- 会话内的可视化内容：[#151](https://github.com/GoDiao/dreamcoder/issues/151)

## 未来探索

- Token 用量统计面板
- 记忆系统增强 (AutoDream)
- 插件市场
- Linux 桌面端支持
