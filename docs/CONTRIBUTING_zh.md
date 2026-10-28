[English](./CONTRIBUTING_en.md) | 简体中文

# Contributing to DreamCoder

感谢你对 DreamCoder 的关注！无论是报告 bug、提出功能建议，还是提交代码，都非常欢迎。

## ⚡ 5 分钟快速上手 (TL;DR)

```bash
# 1. 在 GitHub 上 Fork，然后 clone 你的 fork（需要 Bun >= 1.0、Node >= 18）
git clone https://github.com/<your-name>/dreamcoder.git && cd dreamcoder

# 2. 装根工作区依赖（sidecar 运行时）
bun install

# 3. 装桌面端依赖（Electron + React 前端）
cd desktop && bun install

# 4. 下载 Electron 本体（Bun 不会运行 Electron 的安装脚本）
bun run electron:install

# 5. 编译 sidecar 二进制（不跑这步，第 6 步无法启动本地服务）
bun run build:sidecars

# 6. 启动桌面端开发模式（同时启动 Vite 和 Electron）
bun run electron:dev

# 7. 在 issue 列表挑一个带 `good first issue` 或 `help wanted` 标签的任务，
#    从 main 分支拉一个功能分支
git checkout main && git checkout -b feat/your-feature

# 8. 写代码 → bun run lint → bun run test → push → 提 PR 到 main 分支
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

1. **Fork 仓库**，从 `main` 分支创建你的功能分支：
   ```bash
   git checkout main
   git checkout -b feat/your-feature-name
   ```

2. **开发**。请遵循项目现有的代码风格：
   - TypeScript 严格模式，避免 `any`。
   - React 函数组件 + Hooks。
   - 状态管理使用 Zustand。
   - 样式使用 Tailwind CSS v4。
   - 新代码不写注释，JSDoc 和测试里的说明也不写，靠命名和结构表达意思。没改动的代码里原有的注释可以保留。

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
   bun run prepare:ripgrep    # 准备固定版本的搜索程序
   bun test                  # 服务端/CLI 测试
   cd desktop
   bun run lint              # TypeScript 类型检查
   bun run test -- --run     # 桌面端测试
   ```
   每个提到 `main` 的 PR,CI 都会跑这三项检查。

5. **提交 PR**。PR 目标分支为 `main`，描述清楚改了什么、为什么改。

## 项目结构

```
dreamcoder/
├── desktop/               # Electron 桌面应用
│   ├── src/
│   │   ├── components/    # React 组件
│   │   ├── stores/        # Zustand 状态管理
│   │   ├── lib/           # 工具函数 & 运行时
│   │   ├── hooks/         # React Hooks
│   │   ├── pages/         # 页面组件
│   │   └── i18n/          # 国际化
│   └── electron/          # Electron 主进程与 preload
├── src/                   # CLI 与后端服务（src/server/）
├── website/               # 项目官网
└── docs/                  # 文档
```

如果你要新增 Provider 预设，请先阅读网站技术手册中的“新增 Provider 预设”。

## 开发环境

> ⚠️ **平台支持说明**
>
> 维护者目前**主要在 macOS（Apple Silicon）上开发**，从源码运行（`bun run electron:dev`）。
> **Windows x64** 是此前的主力平台，经过长期实测，
> 但维护者现在不在 Windows 上日常开发，新改动的 Windows 验证尤其需要帮助。
> Linux 暂不打包，维护者日常也不在 Linux 上跑。
> 如果你在 Windows 或 Linux 上：
>
> - 桌面端**可能**能构建运行，但你可能撞到未验证过的问题
>   （Linux 内存问题正在 [#25](https://github.com/GoDiao/dreamcoder/issues/25) 调查中）。
> - Bug 报告和平台修复 PR **非常欢迎**。
> - 如果你是 Linux 首次贡献者，建议先选不需要本地运行的任务（如文档、i18n 字符串修复），
>   待确认能 build 成功后再啃需要跑应用的活儿。

```bash
# 环境要求
# - Bun >= 1.0
# - Node.js >= 18（Electron 的安装脚本在 Node 上运行）

git clone https://github.com/GoDiao/dreamcoder.git
cd dreamcoder

# Step 1: 安装根工作区依赖（sidecar：Anthropic SDK / AWS SDK / ink 等）
bun install

# Step 2: 安装桌面端依赖（Electron + React 前端）
cd desktop && bun install

# Step 3: 下载 Electron 本体
#   Bun 不会运行 Electron 的安装脚本，这一步下载一次即可。
bun run electron:install

# Step 4: 编译 sidecar 二进制
#   生成 desktop/binaries/dreamcoder-sidecar-<target>，主进程启动它作为本地服务。
bun run build:sidecars

# Step 5: 启动 dev 模式
#   在 1420 端口启动 Vite，编译主进程并打开 Electron。
bun run electron:dev
```

> 看到 `Electron failed to install correctly`？
> 是漏跑了 Step 3 `bun run electron:install`。
> 窗口打开了，但显示 "Local server failed to start"？
> 是漏跑了 Step 4 `bun run build:sidecars`。
> `bun run build` 生成 `desktop/dist`，sidecar 用它给 H5 页面提供界面；dev 模式不需要。
> `bun run electron:pack` 构建当前平台的安装包，产物在 `desktop/electron-release/`。
>
> 更多常见问题见 [TROUBLESHOOTING_zh.md](TROUBLESHOOTING_zh.md)。

### 桌面 UI 组件

桌面端使用 Radix 版本的 shadcn/ui，由 `desktop/components.json` 生成到 `desktop/src/components/shared/ui`。
调用方直接使用这些组件；`desktop/src/components/shared` 里的组合组件只增加行为，不做改名或转发。
[组件说明](../desktop/src/components/README.md)列出了全部组件、本地改动（`ui-` 命名空间的主题 token、Shiki、Pierre、H5 最低 Safari 17.5）以及用 shadcn CLI 更新组件的方法。

### 随包提供 ripgrep

`bun run build:sidecars` 会自动准备 ripgrep。
根目录的 `bun run build:sidecar` 也调用同一份桌面构建脚本。
单独运行服务端、CLI 或测试前，在仓库根目录执行 `bun run prepare:ripgrep`。
首次执行需要访问 GitHub Releases，并使用系统的 `tar`（macOS、Windows 和常见 Linux
开发环境均提供）。不需要新增 npm 包，也不需要安装系统级 ripgrep。

脚本固定使用 [ripgrep 15.2.0](https://github.com/BurntSushi/ripgrep/releases/tag/15.2.0)，
覆盖 macOS arm64/x64、Windows x64、Linux arm64/x64；Linux 的 GNU 和 musl 构建均使用
静态 musl 二进制。`scripts/prepare-ripgrep.ts` 中的压缩包 SHA-256 来自官方发布的
`.sha256` 文件，并与 GitHub asset digest 交叉核对；二进制 SHA-256 从校验通过的压缩包
解压后计算。只有文件内容匹配固定校验值才会跳过下载。升级版本时，需重新验证各平台的
两类校验值，并更新 `THIRD_PARTY_NOTICES.md` 及安装包冒烟测试中的版本。

源码运行读取 `vendor/ripgrep/<arch>-<platform>/rg`（Windows 为 `rg.exe`）。构建还会
生成 `desktop/binaries/rg-<target-triple>`（Windows 另带 `.exe`）。安装包里去掉 target
后缀：macOS 位于 `Resources/bin`，Windows 位于 `resources\bin`，均与 sidecar 相邻。
许可证作为资源随包分发。两个二进制目录均已被 Git 忽略。

查找顺序：`USE_BUILTIN_RIPGREP=0` 强制使用系统版本；否则依次查找可执行文件旁的版本、
源码 vendor 版本、`PATH` 中的系统 `rg`，最后报告不可用。标准 Bun 不在 sidecar 内嵌 ripgrep。

## 向精选 MCP 注册表添加服务器

DreamCoder 在仓库根目录的 [`mcp-registry.json`](../mcp-registry.json) 中内置一份经过审核的
小型 MCP 服务器目录。契约定义在
[`src/server/mcpRegistry/schema.ts`](../src/server/mcpRegistry/schema.ts)。

该目录**不是**用于信任校验的官方 MCP URL 注册表。精选目录只描述 DreamCoder 审核过、且会在本地安装的
服务器；官方注册表是另一个独立的远端信任来源。

### v1 范围

v1 **仅支持 stdio**。在安装流程能够表达远端传输之前，HTTP 与 SSE 条目不在范围内。

### 条目字段

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `id` | 是 | 稳定的标识符，小写并以短横线分隔。不得把同一个 id 复用于另一个服务器。 |
| `name` | 是 | 界面展示名称。 |
| `description` | 是 | 说明用户能得到什么。描述**作用**而非实现原理。 |
| `transport` | 是 | v1 中必须为 `stdio`。 |
| `command` | 是 | 包名或相对路径。拒绝绝对路径与 shell 元字符。 |
| `args` | 否 | 可引用 `{env:VAR_NAME}` 占位符。 |
| `env` | 否 | 只声明变量**名称**及取值来源。 |
| `homepage` | 是 | 项目主页或仓库地址。 |
| `tags` | 是 | 小写，至少一个。 |
| `runtime` | 是 | `node`、`bun`、`python`、`uvx` 或 `binary`。 |
| `version` | 条件必填 | `runtime: binary` 时**必须**填写；`uvx` 建议填写。 |

### 确认后安装

目录的安装确认页会将支持的包元数据转换为可执行命令和独立的参数。
以下命令形式用于说明生成的配置：

| 目录运行时 | 自动生成的配置 |
| --- | --- |
| `node` | `npx --yes -- <package>@<version>` |
| `bun` | `bun x --bun <package>@<version>` |
| `uvx` | `uvx --no-python-downloads <package>@<version>` |

仅支持普通包名和精确版本：Node/Bun 使用 npm SemVer，uvx 使用保守的精确 PEP 440 版本子集。
未填写版本时不添加版本后缀，并保持未固定版本状态。标签、版本范围、`python`、`binary`、
相对路径及其他含义不明确的元数据需要使用手动编辑器。主机必须已具备所需的命令工具和运行时。
打开确认页不会保存配置或启动服务器；确认后的连接检查可能将包下载到命令工具的缓存中并启动它。

用户需明确选择 `local`（仅对自己在所选项目中生效）、`project`（所选项目中共享的 `.mcp.json`）
或 `user`（对所有项目生效）。环境变量声明中的 `user` 和 `system` 均要求用户明确输入值；
`optional` 留空时会被省略，但被参数引用时仍须填写。`{env:NAME}` 替换会保留各参数的边界和输入值的
原始内容，确认页会隐藏这些值。确认后，值会存入所选范围的现有配置文件：项目范围会通过
`.mcp.json` 共享这些值，因此不要将含有密钥的配置提交到仓库。

### 安全规则

- **绝不要提交任何密钥。** `env` 条目只描述需要什么（`name`、`source`、`description`），
  取值由用户在安装时提供。校验会拒绝携带 `value` 字段、或在 `args` 中夹带令牌形态字符串的条目。
- **不得使用绝对路径。** `command` 必须是包名或相对路径，避免有人通过修改目录指向用户机器上的
  任意可执行文件。
- **尽可能锁定版本。** 未固定版本的 `binary` 条目可能在每次安装时行为不同，因此 v1 要求精确版本号。

### 校验你的条目

```bash
# 校验内置目录及全部非法条目用例
bun test ./src/server/__tests__/mcp-registry.test.ts
```

校验会一次性收集**全部**问题，并为每条错误给出点分路径（例如 `servers.3.homepage`），
因此可以一轮改完，而不是每次运行只暴露一个错误。

### 评审要求

- 优先选择 [官方 MCP servers 仓库](https://github.com/modelcontextprotocol/servers)
  或其他有活跃发版历史的、维护良好的项目。
- 通过 `uvx` 或以二进制方式安装的服务，务必填写精确 `version`。
- `description` 面向最终用户撰写：它会直接展示在目录界面上。
- 每个 PR 提交一个条目（或一小批相关条目），评审更快。

跟踪 issue：[#44](https://github.com/GoDiao/dreamcoder/issues/44) ·
父 issue：[#12](https://github.com/GoDiao/dreamcoder/issues/12)

## 许可证

贡献即表示你同意将你的代码以 [MIT License](LICENSE) 授权。
