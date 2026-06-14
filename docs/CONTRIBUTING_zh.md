# Contributing to DreamCoder

感谢你对 DreamCoder 的关注！无论是报告 bug、提出功能建议，还是提交代码，都非常欢迎。

## ⚡ 5 分钟快速上手 (TL;DR)

```bash
# 1. 在 GitHub 上 Fork，然后 clone 你的 fork
git clone https://github.com/<your-name>/dreamcoder.git && cd dreamcoder

# 2. 安装依赖（需要 Bun >= 1.0、Rust、Node >= 18）
bun install

# 3. 启动桌面端开发模式
cd desktop && bun run dev

# 4. 在 issue 列表挑一个带 `good first issue` 或 `help wanted` 标签的任务，
#    从 dev 分支拉一个功能分支
git checkout dev && git checkout -b feat/your-feature

# 5. 写代码 → bun run lint → bun run test → push → 提 PR 到 dev 分支
```

👉 **第一次贡献？** 直接看 [good first issues](https://github.com/GoDiao/dreamcoder/issues?q=is%3Aopen+is%3Aissue+label%3A%22good+first+issue%22)，每条都有 mentor，可以在 issue 或 PR 里直接 at 他们。

---

## 行为准则

- 尊重每一位贡献者。
- 建设性的讨论，避免人身攻击。
- 如果你发现安全漏洞，请私下联系维护者，不要公开提交 Issue。

## 如何贡献

### 报告 Bug

1. 在 [Issues](https://github.com/GoDiao/dreamcoder/issues) 中搜索，确认是否已有相同问题。
2. 如果没有，新建 Issue，包含以下信息：
   - **环境**：操作系统版本、DreamCoder 版本（设置 → 关于）。
   - **复现步骤**：清晰描述触发 bug 的操作。
   - **期望行为 vs 实际行为**。
   - **截图或日志**（如有）。

### 功能建议

1. 先在 Issues 中搜索，避免重复。
2. 新建 Issue，描述：
   - 你希望解决什么问题。
   - 你期望的功能是什么样的。
   - 为什么这对你有价值。

### 提交代码

1. **Fork 仓库**，从 `dev` 分支创建你的功能分支：
   ```bash
   git checkout dev
   git checkout -b feat/your-feature-name
   ```

2. **开发**。请遵循项目现有的代码风格：
   - TypeScript 严格模式，避免 `any`。
   - React 函数组件 + Hooks。
   - 状态管理使用 Zustand。
   - 样式使用 Tailwind CSS v4。

3. **提交**。使用语义化 commit message：
   ```
   feat: 添加 XXX 功能
   fix: 修复 XXX 问题
   refactor: 重构 XXX
   docs: 更新 XXX 文档
   chore: 杂项变更
   ```

4. **测试**。确保你的改动不会破坏现有功能：
   ```bash
   cd desktop
   bun run lint    # TypeScript 类型检查
   bun run test    # 运行测试
   ```

5. **提交 PR**。PR 目标分支为 `dev`，描述清楚改了什么、为什么改。

## 项目结构

```
dreamcoder/
├── desktop/               # Tauri 桌面应用
│   ├── src/
│   │   ├── components/    # React 组件
│   │   ├── stores/        # Zustand 状态管理
│   │   ├── lib/           # 工具函数 & 运行时
│   │   ├── hooks/         # React Hooks
│   │   ├── pages/         # 页面组件
│   │   └── i18n/          # 国际化
│   └── src-tauri/         # Rust 后端
├── sidecar/               # Bun 后端服务
├── website/               # 项目官网
├── docs/                  # 文档
└── adapters/              # 第三方平台适配器
```

## 开发环境

> ⚠️ **平台支持说明**
>
> DreamCoder 当前**仅在 Windows x64 上开发与验证**。代码里有 macOS / Linux 的平台分支，
> 但维护者日常不在这两个平台上跑。如果你在 macOS 或 Linux：
>
> - 桌面端**可能**能构建运行，但你可能撞到未验证过的问题
>   （Linux 内存问题正在 [#25](https://github.com/GoDiao/dreamcoder/issues/25) 调查中）。
> - Bug 报告和平台修复 PR **非常欢迎** —— 你将是这个平台上的第一位用户。
> - 如果你是 Linux 首次贡献者，建议先选不需要本地运行的任务（如文档、i18n 字符串修复），
>   待确认能 build 成功后再啃需要跑应用的活儿。

```bash
# 环境要求
# - Bun >= 1.0
# - Rust (用于编译 Tauri)
# - Node.js >= 18

git clone https://github.com/GoDiao/dreamcoder.git
cd dreamcoder/desktop
bun install
bun run tauri dev
```

## 许可证

贡献即表示你同意将你的代码以 [MIT License](LICENSE) 授权。
