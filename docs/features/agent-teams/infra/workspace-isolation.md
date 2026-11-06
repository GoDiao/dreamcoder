# 成员工作区隔离：统一接口与实现对照

| 项 | 内容 |
| --- | --- |
| 状态 | 调研，未进入技术设计 |
| 日期 | 2026-10-23 |
| 关联 | [#162](https://github.com/GoDiao/dreamcoder/issues/162) 开放问题「How does the lead merge members' worktrees, and what happens on conflicts?」 |
| 依据 | [layerfs.md](layerfs.md)、[landscape-workspace.md](landscape-workspace.md)、本机实测（第 3 节）、fork 源码 `@939d934` |

第 1–5 节写事实与实测，第 6–8 节是判断与建议。

## 1. 要解决的问题

agent team 的每个成员需要一份能独立读写、能跑构建和测试的项目目录，成员的成果最后要合并回用户的项目目录。

现状：

- fork 里的同进程队友没有独立目录，全部在 lead 的目录里工作。`runWithCwdOverride`（`src/utils/cwd.ts:12`）只被普通子 agent 和恢复子 agent 使用（`src/tools/AgentTool/AgentTool.tsx:641`、`src/tools/AgentTool/resumeAgent.ts:228`），队友的派生路径在处理 `isolation` 之前就返回（见 [../research/claude-code.md](../research/claude-code.md) 第 8 节）。
- 六个产品里没有一家把「每成员一份隔离目录、lead 审阅并合并」做完整（[../README.md](../README.md) 对比矩阵第 8 行）。

git worktree 作为默认方案的问题：

- `git worktree add` 只检出被跟踪的文件。被忽略的依赖与构建产物不会带过去，每个成员都要重新安装、重新构建。
- 以本仓库为例：被跟踪文件 2,940 个、44.7 MB；根目录 `node_modules` 40,987 个文件、318 MB（`du -sh`），另有 `desktop/node_modules` 与构建产物未计入。
- 每个成员一个分支，会进入用户仓库的分支列表。

## 2. 可用的隔离机制

| 机制 | 原理 | 平台 | 前提 | 来源 |
| --- | --- | --- | --- | --- |
| git worktree | 同一仓库的多个工作目录，共用 `.git` 对象库，各自检出一个分支 | 全平台 | 项目是 git 仓库 | git 文档 |
| APFS `clonefile(2)` | 文件系统级写时复制；对目录调用时一次克隆整棵目录树 | macOS | 源与目标在同一 APFS 卷 | [clonefile(2)](https://keith.github.io/xcode-man-pages/clonefile.2.html) |
| ReFS 块克隆 | 文件系统级写时复制，按文件、按字节范围克隆 | Windows（ReFS，如 Dev Drive） | 同一 ReFS 卷；Dev Drive 需 Windows 11 22621.2338 起、管理员权限、最小 50 GB | [Block cloning](https://learn.microsoft.com/en-us/windows/win32/FileIO/block-cloning)、[Dev Drive](https://learn.microsoft.com/en-us/windows/dev-drive) |
| ProjFS | 由用户态进程向系统投影出一个目录；文件首次被读时填充内容，被修改后变为本地文件 | Windows 10 1809 起 | 可选功能 `Client-ProjFS` 需管理员开启，可能需重启；投影进程须常驻 | [Enabling ProjFS](https://learn.microsoft.com/en-us/windows/win32/projfs/enabling-windows-projected-file-system)、[Programming guide](https://learn.microsoft.com/en-us/windows/win32/projfs/projfs-programming-guide) |
| FUSE 虚拟文件系统（如 LayerFS） | 用户态文件系统，读从存储取块，写进覆盖层 | Linux 原生；macOS 需 Docker；Windows 需 WSL2 | 见 [layerfs.md](layerfs.md) 第 6 节 | [layerfs.md](layerfs.md) |
| 复制 | 普通文件复制，依赖可用链接共享 | 全平台 | 无 | — |

APFS 克隆与链接的区别：

| | 软链接 | 硬链接 | APFS 克隆 |
| --- | --- | --- | --- |
| 本质 | 指向路径的指针 | 同一文件的两个名字 | 两个独立文件，暂时共享数据块 |
| 写入 | 改到原文件 | 改到原文件 | 只有被写的数据块另存，另一方不受影响 |
| 删除原文件 | 链接失效 | 另一个名字照常可用 | 克隆照常可用 |

## 3. macOS 实测

环境：Apple M1 Pro，macOS 26.6.2，APFS（Data 卷），2026-10-23。对象为主仓库根目录 `node_modules`（40,987 个文件，318 MB）。目标目录在同一卷的临时目录，测完已删除。磁盘占用取 `df` 前后差值。

| 方式 | 耗时 | 额外磁盘 |
| --- | --- | --- |
| `cp -R` | 51.3 秒 | 约 320 MB |
| `cp -cR`（逐文件 `clonefile`） | 23.1 秒 | 约 0（在测量噪声内） |
| 对目录调用一次 `clonefile(2)` | 1.7 秒 | 约 25 MB（元数据） |

隔离验证：在克隆中对 `yoga-layout/package.json` 追加内容后，原文件 SHA-1 不变（`48a1a22…` 前后一致），克隆中的文件 SHA-1 变为 `902b299…`。

注意：`du` 与 Finder 会把每份克隆按完整大小计算，真实占用应看 `df`。

## 4. 合并的参考做法

来自 LayerFS（[layerfs.md](layerfs.md) 第 4 节，`@1aa56ec`）：

- 文本文件做按行三方合并（`core/crates/layerfs-content/src/merge/text.rs:40` `merge3`），同一文件不同区域的改动自动合并，只有同一处两侧改得不同才算冲突。
- 超过 1 MiB 或非文本的文件两侧都改时，判为二进制冲突（`core/docs/architecture/81-compare-and-merge.md:83`）。
- 工作区提交冲突时，冲突标记写进该工作区，由发起提交的 agent 解决；标记未清除前不能再提交。
- 发布到 `main` 是覆盖而非合并，合并须先单独完成。

不依赖仓库的等价工具：`git merge-file <成员版本> <基线> <主目录版本>` 对单个文件做三方合并，输出带冲突标记的结果。

## 5. 上游已有的抽象

fork 里已有 `WorktreeCreate` / `WorktreeRemove` hook：配置后，`--worktree` 与 `EnterWorktree` 改用 hook 创建和删除隔离目录，可不依赖 git（`src/tools/EnterWorktreeTool/prompt.ts:16-22`、`src/setup.ts:190-208`、`src/types/hooks.ts:160`）。它只覆盖创建与删除，不提供改动列表与基线。

## 6. 统一接口（建议）

合并只需要三样东西：哪些文件改了、每个文件的基线版本、成员的版本。据此，各种隔离机制实现同一个「工作区提供者」接口，团队调度与合并层只依赖这个接口。

| 操作 | 作用 |
| --- | --- |
| 创建 | 给成员造一份隔离副本，返回目录路径，并记下基线 |
| 列出改动 | 列出新增、修改、删除、重命名的文件 |
| 读基线 | 取某个文件在创建时的内容 |
| 重新接上 | 应用重启后恢复已有副本；不需要常驻进程的实现什么都不做 |
| 丢弃 | 删除副本，释放资源 |
| 能力声明 | 创建是否秒级、创建后依赖是否已就绪、依赖目录是否也隔离、是否需要常驻进程 |

各实现的对照：

| | git worktree | APFS 克隆 | ProjFS（待定） | 复制 |
| --- | --- | --- | --- | --- |
| 创建 | `git worktree add`；依赖由成员自行安装，或由提供者按 `.worktreeinclude` 复制、克隆或链接进去 | 对项目目录调用一次 `clonefile` | 投影出虚拟目录 | 复制源码，依赖用链接 |
| 基线 | 起始提交 | 再克隆一份作为基线 | 冻结的快照（做法未定） | 起始源码副本 |
| 列出改动 | `git status` / `git diff` | 与基线逐文件比较 | 系统的文件修改通知 | 与基线比较 |
| 常驻进程 | 否 | 否 | 是 | 否 |
| 平台 | 全平台 | macOS | Windows | 全平台 |

合并层（全平台一套）：对每个改动文件取基线、主目录现状、成员版本做按行三方合并；有冲突时把标记写回成员副本，由成员解决后重新提交；合并后的构建与测试检查另行执行。

## 7. 要统一的规则

- **成员不自己提交 git。** worktree 共用主仓库的 `.git`，成员提交会直接出现在主仓库；克隆与复制得到独立的 `.git`，成员提交回不到主仓库。为让行为一致，成员的成果一律经合并层交回。
- **成果的范围。** 构建产物与依赖不算成果，统一按 `.gitignore` 规则过滤后再列出改动。
- **依赖由谁准备。** 用 worktree 时常见做法是先建 worktree，再由 agent 在任务里自己安装依赖；Claude Code 另有 `.worktreeinclude`，在创建时把列出的被忽略文件复制过去（fork 中 `src/utils/worktree.ts:411`）。克隆类实现创建时依赖已在，不需要这一步。要统一规定：依赖的准备算提供者的职责（创建时补齐，或声明「需要成员自行安装」），不能让同一个团队在不同实现下，有的成员一开始就能跑测试，有的要先花几分钟和 token 装依赖。
- **改动的格式统一。** 重命名、删除、符号链接、二进制文件、权限位，各实现须报告成同一种格式。
- **生命周期。** 副本的存在与基线要记录在服务端，应用重启后由「重新接上」恢复。

## 8. 建议的范围与未决事项

第一版实现两种，用来验证接口没有偏向某一种机制：

1. **git worktree**：全平台兜底，不需要管理员权限；依赖可由成员自行安装，也可由提供者用该平台最好的复制方式补齐。
2. **APFS 克隆**：主平台，秒级就绪，磁盘随改动增长。

Windows 的方案（ReFS 块克隆、ProjFS）待定，需要 Windows 实测后再决定。

未决：

- 构建缓存里的绝对路径（如 `tsbuildinfo`、cargo 增量缓存）在克隆后的新目录下是否导致重新构建。未实测。
- 克隆耗时随文件数的增长。本次只测了约 4 万个文件。
- 与基线逐文件比较的开销。对几万个文件按大小和修改时间比较的耗时未实测。
- 成员工作期间主目录持续变化时，成员要不要、怎样同步主目录的新改动。
- 合并顺序：多个成员先后合并时，后合并者以哪个版本为「主目录现状」，失败时如何回退。
