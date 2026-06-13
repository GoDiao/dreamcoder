# 路线图

## Phase 1 — 桌面端 GUI + 多模型支持 ✅

- [x] Tauri 2 桌面应用 (Windows/macOS)
- [x] 多 Provider 支持 (Anthropic, OpenAI, DeepSeek, MiniMax, Azure, Google Vertex, AWS Bedrock)
- [x] 可视化设置界面 (Provider、API Key、模型映射)
- [x] 会话管理 (多标签、侧边栏、历史搜索)
- [x] 内置 PTY 终端 (PowerShell/Bash/Zsh)
- [x] 权限控制 (4 种模式)
- [x] 中英文国际化

## Phase 2 — CLI 后端 + Computer Use ✅

- [x] Sidecar 后端架构 (dreamcoder-sidecar.exe)
- [x] Computer Use (视觉截图模式 + UIA Tree 文本模式)
- [x] MCP 协议支持 + 可视化管理
- [x] Skills 技能系统
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

将桌面端能力通过局域网或反向代理暴露到手机浏览器。

- [x] H5 访问开关与 Token 管理
- [x] 手机端聊天 UI 适配
- [x] WebSocket 远程桥接
- [x] CORS 安全策略
- [x] LAN 直连 + 二维码配对
- [ ] 反向代理部署指南（仍在编写）

参考: [Issue #3](https://github.com/GoDiao/dreamcoder/issues/3)

## Phase 4 — IM 适配器集成

通过飞书/钉钉/Telegram/微信远程与 AI 对话。

- [ ] 适配器配置 UI (已在 `AdapterSettings` 有骨架)
- [ ] 配对码安全机制
- [ ] 各平台适配器验证与调试
- [ ] 会话映射持久化
- [ ] 权限审批流适配 (按钮/卡片形式)

## Phase 5 — Release 自动化

- [ ] GitHub Actions 自动构建与发布
- [ ] 跨平台打包 (Windows/macOS)
- [ ] 版本号自动同步
- [ ] Release Notes 自动生成
- [ ] 自动更新签名与分发

## 未来探索

- Token 用量统计面板
- 记忆系统增强 (AutoDream)
- 插件市场
- Linux 桌面端支持
