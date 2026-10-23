# 多 agent 并行的基础设施全景

核实日期：2026-10-23。范围：为同一项目并行运行多个编码 agent 时，位于产品之下的一层：工作区隔离、合并与冲突、沙箱执行、状态与历史、agent 间通信。上层产品见 [README](../README.md) 与 [research/](../research/)。背景讨论见 [#162](https://github.com/GoDiao/dreamcoder/issues/162)。

## 0. 读法与核实约定

- 本次只读：没有安装、构建或运行任何被调研的工具；GitHub 只用 `gh` 读接口。
- 「许可证」「仓库创建」「最新 release 与日期」除特别标注外，均来自对应仓库的 GitHub API（`gh api repos/<owner>/<repo>` 与 `.../releases/latest`，2026-10-23 读取）。表格里的名称链接即该仓库，不在每格重复。仓库创建日不等于首次发布，只作成熟度的下限参考。
- GitHub 判定为 NOASSERTION 的仓库，在许可证格里写明读到的实际文本或「未核实」。
- 「未查到」表示查过但没有证据；「不适用」表示问题本身不适用。
- 表中「使用方」只写能给出出处的集成；没有出处的不写。
- 判断与建议只出现在每节末的「适配」列和文末两节里。
- LayerFS 只在表中列出，不展开，另有专门拆解。

---

## 1. 工作区隔离

### 1.1 总表

| 名称 | 许可证 | 一句话 | 平台与前提 | 成熟度 | 使用方 | 对 macOS + Windows 桌面应用的适配 |
| --- | --- | --- | --- | --- | --- | --- |
| [git worktree](https://git-scm.com/docs/git-worktree) | 未核（本次未抓到 git 许可证页） | 同一仓库的多个工作目录，各自检出不同分支，共享对象库与远端 | git 自带，三平台原生。官方文档写明 multiple checkout「仍是实验性」，子模块支持不完整，不建议对含子模块的超级项目多重检出（同页 BUGS 节）。git 最新源码版 2.56.0（[git-scm.com](https://git-scm.com/)） | 未查到首次引入版本；最新 2.56.0 | Claude Code `--worktree`、子 agent `isolation: worktree`（[官方文档](https://code.claude.com/docs/en/worktrees.md)）；Codex 仅有识别 worktree 身份的代码（`codex-rs/git-utils/src/worktree.rs`@`f3a9054`）；claude-squad、emdash、superset 等见 1.2 | 最稳的基线，两平台都能跑。要自己解决依赖（node_modules）与忽略文件的复制 |
| Claude Code 的 worktree 机制 | 闭源 | `--worktree` 建在 `.claude/worktrees/<name>/`，新分支 `worktree-<name>`；子 agent 在 frontmatter 加 `isolation: worktree`；`.worktreeinclude` 复制忽略文件；`WorktreeCreate` hook 可替换创建逻辑（非 git VCS）；运行中持有 `git worktree lock`；周期清扫无改动的 worktree（[文档](https://code.claude.com/docs/en/worktrees.md)） | 随 Claude Code。文档称文件隔离只检查路径、cwd 与命令文本，不追踪 shell 写了哪些文件，`cp` 或重定向写主目录不会被拦（同页） | 上游 v2.1.309（2026-10-22，[anthropics/claude-code](https://github.com/anthropics/claude-code)）；DreamCoder fork 兼容 2.1.92，这些能力在 fork 中是否存在：未查到（本次未读 fork 源码） | Claude Code 自身 | 是 DreamCoder 最近的现成实现，值得对照 fork 补缺口 |
| [Worktrunk](https://github.com/max-sixty/worktrunk) | MIT OR Apache-2.0（README 徽章） | 把 worktree 做成「像分支一样」的 CLI，带 hooks、`wt merge`（squash、rebase、快进目标分支、删 worktree）、构建缓存 reflink（[merge 文档](https://github.com/max-sixty/worktrunk/blob/main/docs/src/content/docs/merge.md)） | README 有 Windows 安装说明（`wt` 与 Windows Terminal 别名冲突，winget 装为 `git-wt`）。reflink 支持 APFS、btrfs、XFS、ReFS；ext4 与 NTFS 退化为完整复制（[step 文档](https://github.com/max-sixty/worktrunk/blob/main/docs/src/content/docs/step.md)） | 创建 2025-10；v0.81.0（2026-10-20） | CLI 工具，面向 Claude Code 等 agent（README、docs 有 `claude-code.md`） | reflink 与 `wt merge` 的做法可借；本身是 CLI，不是库 |
| worktree 管理器（桌面或 TUI）：[claude-squad](https://github.com/smtg-ai/claude-squad)、[ccmanager](https://github.com/kbwo/ccmanager)、[emdash](https://github.com/generalaction/emdash)、[superset](https://github.com/superset-sh/superset)、[vibe-kanban](https://github.com/BloopAI/vibe-kanban)、[Crystal → Nimbalyst](https://github.com/stravu/crystal)、[git-worktree-runner](https://github.com/coderabbitai/git-worktree-runner) | claude-squad AGPL-3.0；ccmanager MIT；emdash Apache-2.0；superset Elastic License 2.0（README）；vibe-kanban Apache-2.0；crystal MIT；git-worktree-runner Apache-2.0 | 每个 agent 一个 worktree 加分支，附带终端、diff、PR、合并入口 | claude-squad 需要 tmux（README）；emdash 提供 macOS、Windows、Linux 安装包（README）；superset 官方称 macOS 为主、Linux 实验、Windows 暂无（README）；ccmanager 不依赖 tmux（README） | claude-squad 2025-03 / v1.0.20（2026-08-20）；emdash 2025-08 / v1.2.8（2026-10-10）；superset 2025-10 / desktop-v1.39.0（2026-10-19）；vibe-kanban 2025-06 / v0.1.44（2026-04-24）；crystal 2025-06 / v0.3.5（2026-02-26，仓库描述称已更名 Nimbalyst）；ccmanager v4.4.9（2026-10-18） | 各自就是产品，不是底层 | superset README 自己写明「worktree 不做进程沙箱，也不防合并冲突」；emdash 称「review diffs、create pull requests、merge」；ccmanager 称可在应用内「create, merge, and delete worktrees」 | 这些是 DreamCoder 要对标或避开的产品层；底层都是 git worktree，没有新的隔离机制 |
| [Jujutsu (jj) workspaces](https://github.com/jj-vcs/jj) | Apache-2.0 | 多个工作副本共用一个仓库，`jj workspace add`，每个 workspace 检出不同提交（[文档](http://docs.jj-vcs.dev/latest/working-copy/)） | 文档有「Working on Windows」专页，称各平台行为一致，另列换行转换等注意点（[windows.md](https://github.com/jj-vcs/jj/blob/main/docs/windows.md)）。一个 workspace 的提交在另一个里被改写时，原 workspace 变 stale，需 `jj workspace update-stale`（working-copy 文档） | 创建 2020-12；v0.46.0（2026-10-07），尚未 1.0 | Weave 提供 jj merge-tool 配置（见 2）；Worktrunk、claude-squad 等：未查到对 jj 的支持 | 机制优雅，但要求用户换版本控制工具。可只借「工作副本与提交分离」的思路 |
| [GitButler](https://github.com/gitbutlerapp/gitbutler) | FSL-1.1-MIT（Fair Source，两年后转 MIT；[LICENSE.md](https://github.com/gitbutlerapp/gitbutler/blob/master/LICENSE.md)） | 在现有 git 仓库上提供并行分支（virtual branches）：同一工作目录里同时应用多个分支，并提供给 agent 的 hooks 与 skills（README） | 桌面应用与 `but` CLI。仓库含 Rust crates、`.taurignore`，另有 `electron-migration-assessment.md`；官方下载页：未抓取。三平台支持：未查到明确声明 | 创建 2023-01；release/0.22.3（2026-08-29） | README 称可为「所有主流 agent 系统」安装 hooks 或 skills；具体集成清单：未查到 | 与 DreamCoder 同为 Tauri 栈的 git 客户端，值得拆；FSL 许可需法务确认能否借鉴代码 |
| APFS `clonefile` / ReFS 块克隆 / Linux reflink | 不适用（文件系统特性） | 写时复制克隆，克隆后不占额外磁盘，直到一方写入 | macOS：`clonefile(2)` 创建文件的写时复制克隆（[man](https://keith.github.io/xcode-man-pages/clonefile.2.html)）。Windows：ReFS 块克隆是元数据操作，克隆须在同一 ReFS 卷，区域须对齐簇边界（[Microsoft Learn](https://learn.microsoft.com/en-us/windows-server/storage/refs/block-cloning)）；Dev Drive 基于 ReFS（二手来源，[elevenforum](https://elevenforum.com/t/microsoft-improves-refs-file-system-to-block-cloning-on-dev-drive-in-windows-11-24h2.29068)）。默认 NTFS 没有 reflink | 不适用 | Worktrunk 用于复制 `target/` 等构建缓存，称 14GB 目录首次构建从约 68 秒降到约 3 秒（作者自述，[step 文档](https://github.com/max-sixty/worktrunk/blob/main/docs/src/content/docs/step.md)）；git-sprout 称 Git for Windows 默认 `core.autocrlf` 会让 Dev Drive 上的共享无从谈起（二手，[docs.rs](https://docs.rs/crate/git-sprout/0.1.1)） | macOS 零成本可用；Windows 要用户把仓库放在 ReFS 或 Dev Drive 上才有收益，需提示或检测 |
| FUSE / NFS / ProjFS 分层文件系统：[macFUSE](https://github.com/macfuse/macfuse)、[WinFsp](https://github.com/winfsp/winfsp)、[ProjFS](https://learn.microsoft.com/en-us/windows/win32/projfs/projected-file-system)、[AgentFS](https://github.com/tursodatabase/agentfs) | macFUSE 见仓库 LICENSE.txt（未逐字核）；WinFsp GPLv3 加 FLOSS 例外，另有商业许可（README）；ProjFS 为系统组件；AgentFS 标 MIT（README 徽章），GitHub 未识别 | 用用户态文件系统给 agent 一个可写层或可审计层 | macFUSE 需内核扩展授权；WinFsp 需安装驱动；ProjFS 是 Windows 自带的投影文件系统，由用户态 provider 把后端数据呈现为文件目录（Microsoft Learn）；AgentFS 在 Linux 用 FUSE、macOS 用 NFS 挂载，Windows：README 未提（[README](https://github.com/tursodatabase/agentfs)） | macFUSE macfuse-5.4.0（2026-09-07）；WinFsp v2.1（2025-06-05）；AgentFS v0.6.4（2026-03-25），README 标 BETA | AgentFS：SDK 与 CLI，README 未列具体 agent 产品 | 桌面应用要求用户装内核或驱动级组件，分发与支持成本高；AgentFS 选 NFS 绕开 macFUSE 的做法值得记下 |
| [LayerFS](https://github.com/Ephemeral-AI-Lab/layerfs)（仅列出） | MIT | 每个 agent 挂载共享历史之上的可写 Workspace，提交后销毁；分支、合并、冲突、自动检查点 | README 徽章：Linux、macOS（经 DSH）、Windows（经 WSL2，v1.0.0 之后加入）；Store 仅 Disposable 档，无崩溃与断电持久性（README） | 创建 2026-08；v1.0.0（2026-10-21） | README：通过 `dsh-layerfs` 插件用于 DeepSeek Harness | 另有专门拆解 |
| [container-use](https://github.com/dagger/container-use)（Dagger） | Apache-2.0 | MCP 服务：每个 agent 一个容器加一个 git 分支，可查看命令历史、进入终端接管（README） | 需要 Docker 与 Git（[quickstart](https://container-use.com/quickstart)）；macOS 用 brew 安装，「所有平台」用安装脚本（README），Windows 原生：未查到 | 创建 2025-05；v0.4.2（2025-08-19），README 标 experimental，最近提交 2026-09-21 | 任何支持 MCP 的 agent：README 举 Claude Code、Cursor、Goose | 容器路线要求用户有 Docker；一年多没有发版，维护节奏要核实 |
| Docker Sandboxes `sbx`（本地模式 `--clone`） | 未查到（`docker/sandboxes` 仓库不存在，闭源可能性高） | 把仓库只读挂到 `/run/sandbox/source`，agent 在沙箱内私有克隆里工作，并给宿主仓库加 `sandbox-<name>` 远端（[architecture](https://docs.docker.com/ai/sandboxes/architecture/)） | 见 3.4 | 见 3.4 | 见 3.4 | 与「每成员一个克隆、lead 从远端取回」的流程形状接近，详见 3.4 |
| [devcontainers](https://github.com/devcontainers/cli)（规范与 CLI） | MIT | 用 `devcontainer.json` 描述开发容器 | 需要容器运行时；`microsoft/vscode-dev-containers` 已归档（2023-11-30），CLI 仍在更新 | CLI 创建 2022-04，无 GitHub release；仓库最近提交 2026-10-22 | Claude Code 提供官方参考 dev container（[文档](https://code.claude.com/docs/en/devcontainer.md)）；Trail of Bits 的 [claude-code-devcontainer](https://github.com/trailofbits/claude-code-devcontainer)（Apache-2.0） | 面向「一个环境」，不解决多 agent 的目录隔离；只在用户已有 Docker 时有意义 |

### 1.2 小结

- 事实上所有 GUI 产品的隔离都是 git worktree，没有找到第二种被广泛采用的机制。superset 在 README 里直说 worktree 不做进程沙箱也不防冲突。
- 创建一个隔离单元的开销主要在依赖与构建缓存。Worktrunk 的 reflink 是目前唯一找到的成体系做法，Claude Code 靠 `.worktreeinclude` 复制忽略文件。
- 「共享对象库」的 worktree 之间，同一分支不能同时检出：这条是 git 的通用行为，本次未在抓取的文档片段中直接核到原文，写作前请对照 `git worktree add` 的说明。

---

## 2. 合并与冲突

### 2.1 总表

| 名称 | 许可证 | 一句话 | 平台与前提 | 成熟度 | 使用方 | 适配 |
| --- | --- | --- | --- | --- | --- | --- |
| [git merge（ort）与 `git merge-tree --write-tree`](https://git-scm.com/docs/git-merge-tree) | 未核 | `merge-tree` 在不碰索引与工作区的前提下执行合并并输出结果树，`--write-tree` 自 2.38.0 起提供（官方文档版本表） | git 自带，三平台 | 2.38.0 起；git 最新 2.56.0 | 使用方：未查到 | lead 想「先预演合并是否冲突」不需要检出，适合做合并前的冲突探测 |
| jj 的一等冲突（[文档](https://github.com/jj-vcs/jj/blob/main/docs/conflicts.md)） | Apache-2.0 | 冲突作为逻辑状态记录在提交里，变基不会因冲突中断，可以稍后解决；没有 `--continue` 流程 | 见 1.1 jj 行 | v0.46.0 | 未查到 agent 产品集成 | 「先合进来、冲突留在提交里、之后再解」很适合 lead 汇总多成员成果，但需要 jj |
| [Mergiraf](https://codeberg.org/mergiraf/mergiraf)（Codeberg，不在 GitHub） | GPLv3（仓库首页） | 基于语法树的 git merge driver | 支持 `cargo install` 与 `cargo binstall`（[安装页](https://mergiraf.org/installation.html)）；三平台二进制：安装页未明示，未查到 | Codeberg 创建 2024-10；v0.20.0（2026-09-26，Codeberg API） | Weave 的自测对比项（见下）；agent 产品使用：未查到 | GPLv3，只能作为外部进程调用，不能链接进应用 |
| [Weave](https://github.com/Ataraxy-Labs/weave) | Apache-2.0 | 实体级（函数、类、JSON 键）语义合并驱动，面向多 agent 编辑同一文件产生的伪冲突；自带 MCP 服务（agent 协调工具）；git 用 merge driver，jj 用 merge-tool（README） | Homebrew 有包，支持 38 种语言（README 徽章）；Windows：未查到 | 创建 2026-02；v0.6.1（2026-10-19） | README 与第三方报道提到 MCP 集成；具体 agent 产品：未查到 | 与我们的缺口最贴近，且许可证宽松。性能数字均为作者自测（31 个手写场景：Weave 31/31，Mergiraf v0.16.3 28/31，git 17/31；另有 5 个真实仓库回放），未见独立复现 |
| [Spork](https://github.com/ASSERT-KTH/spork) | MIT | Java 的 AST 结构化合并，与 git 兼容 | JVM | 创建 2020-01；v0.5.1（2021-07-09）；最近提交 2025-02-25 | 学术工具，使用方：未查到 | 只支持 Java，实质停滞，不适用 |
| [IntelliMerge](https://github.com/Symbolk/IntelliMerge) | MIT | Java 的重构感知三路合并 | JVM | v1.0.9（2021-07-21），最近提交同日 | 使用方：未查到 | 停滞，只作文献 |
| [difftastic](https://github.com/Wilfred/difftastic) | MIT | 语法感知的 diff 工具，不做合并 | 三平台二进制：README 未核 | v0.71.0（2026-09-18） | 使用方：未查到 | 只用于展示 diff，不解决合并，列出避免混淆 |
| LayerFS 的 `.lww` 冲突规则 | 同 LayerFS | 声明某些文件永不冲突、最新写入胜出；其余文件提交到已变更文件时被拒绝并报冲突（[README](https://github.com/Ephemeral-AI-Lab/layerfs)） | 同 LayerFS | 同 LayerFS | 同 LayerFS | 仅列出 |
| CRDT 库：[Automerge](https://github.com/automerge/automerge)、[Loro](https://github.com/loro-dev/loro)、[Yjs](https://github.com/yjs/yjs) | Automerge MIT；Loro MIT；Yjs MIT（README 写明，另附商业使用的捐赠请求） | 文本与结构化数据的无冲突复制数据类型 | 纯库，三平台 | Automerge js 3.5.0（2026-09-16）；Loro loro-crdt 1.17.1（2026-10-22）；Yjs v13.6.33（2026-09-23） | 应用于代码的例子只找到一篇论文：[AgentRoom](https://arxiv.org/abs/2608.23740)（2026-08-24 提交，ICML 2026 列表）用 pycrdt（Yrs，即 Yjs 的 Rust 实现的 Python 绑定）做共享工作区，2 秒窗口内字符级合并并加括号平衡检查，另有 `room_claim(path)` 文件认领，作者称收益主要来自协调工具而非 CRDT（二手摘要，原文细节未逐段核）；Electric 的博客把 agent 作为 Yjs 对等端编辑文档（[文章](https://electric.ax/blog/2026/04/08/ai-agents-as-crdt-peers-with-yjs)） | 字符级合并保证文本收敛，不保证代码仍能编译；没有找到被产品采用的实例，不建议作为首选路线 |
| LLM 辅助合并：[LLMinus](https://lwn.net/Articles/1053714/)、Merge-Bench、ConflictAgent 研究 | LLMinus：RFC 阶段，许可证未查到 | LLMinus 用历史冲突解决记录做嵌入检索，再构造提示词（[LKML RFC v2](https://lkml.iu.edu/2601.1/06258.html)）。Merge-Bench 称最好的模型也解不对 60% 的冲突（[摘要](https://homes.cs.washington.edu/~mernst/pubs/merge-bench-icpr2026-abstract.html)）。ConflictAgent（Virginia Tech）称 LLM 在 Java 真冲突上与开发者解法一致约 55–62%，结构化工具最强为 36.7%，但 LLM 从不弃权（二手来源 [developersdigest](https://www.developersdigest.tech/blog/llm-merge-conflict-resolution-study-2026)，未核原文） | 不适用 | 均为 RFC 或研究阶段 | 通用的、可直接接入的开源 LLM 合并工具：未查到 | 合并这一步目前只能靠 agent 本身（读冲突标记、改文件、跑测试）加人复核，没有现成底层可接 |

### 2.2 小结

- 「结构化合并」有两条路：AST 级（Mergiraf、Spork）与实体级（Weave）。只有 Weave 同时在做「合并前的认领与冲突预警」（MCP 工具）。
- 没有找到任何一个工具把「每成员一个 worktree、lead 审阅后合并」做成完整流程。最接近的是 Worktrunk 的 `wt merge`（单分支 squash 加快进）和各 GUI 的 PR 按钮。

---

## 3. 沙箱执行

### 3.1 本机进程级沙箱

| 名称 | 许可证 | 一句话 | 平台与前提 | 成熟度 | 使用方 | 适配 |
| --- | --- | --- | --- | --- | --- | --- |
| macOS Seatbelt（`sandbox-exec`） | 系统组件 | 用 SBPL 配置文件限制进程文件与网络 | 仅 macOS；man 页标注 `sandbox-exec` 为 DEPRECATED（[man](https://keith.github.io/xcode-man-pages/sandbox-exec.1.html)） | 系统自带 | Claude Code 内置 Bash 沙箱（[文档](https://code.claude.com/docs/en/sandboxing.md)）；Codex 固定调用 `/usr/bin/sandbox-exec`（`codex-rs/sandboxing/src/seatbelt.rs`@`f3a9054`）；srt、MXC（见下） | 零安装、与现有 agent 一致；风险是已被官方标为 deprecated |
| [sandbox-runtime（srt）](https://github.com/anthropics/sandbox-runtime)（原 anthropic-experimental） | Apache-2.0 | 无需容器，用 `sandbox-exec` 或 bubblewrap 加代理过滤网络，限制任意进程的文件与网络；可包 MCP 服务 | README 称 Windows 也支持：独立本地用户 `srt-sandbox`、WFP 出站围栏、写受限令牌与工作树 ACE；Linux 需 bubblewrap 与 socat | 创建 2025-10；v0.0.81（2026-10-20）；README 标 Beta Research Preview | Claude Code（[sandbox-environments](https://code.claude.com/docs/en/sandbox-environments.md) 称其用同一套 Seatbelt/bubblewrap）。注意：同一份官方文档称内置沙箱在原生 Windows「不受支持」，只在 macOS、Linux、WSL2 可用（[sandboxing](https://code.claude.com/docs/en/sandboxing.md)），与 srt README 的 Windows 支持不一致，哪个是最新状态未查明 | 可直接作为 Node 依赖，覆盖整个进程树；Windows 部分较新，需要实测 |
| [bubblewrap](https://github.com/containers/bubblewrap) | 仓库含 COPYING、COPYING.LIB、LICENSE，GitHub 未识别，未核具体条款 | 无特权用户命名空间沙箱 | 仅 Linux。Codex 在 WSL2 走同一路径，WSL1 不支持（[codex-linux-sandbox README](https://github.com/openai/codex/blob/main/codex-rs/linux-sandbox/README.md)） | v0.13.1（2026-10-14） | Claude Code（Linux 与 WSL2 需装 bubblewrap 与 socat）；Codex（优先系统 bwrap，缺失用随包自带）；srt | 对 Windows 用户只能经 WSL2 |
| [Landlock](https://docs.kernel.org/userspace-api/landlock.html) | Linux 内核特性 | 让无特权进程自限访问范围；网络规则自 ABI v4（TCP）起，UDP 自 v10 | 仅 Linux | 内核特性 | Codex 仍保留旧版 Landlock 文件系统实现（`codex-rs/sandboxing/src/landlock.rs`、linux-sandbox README） | 与桌面双平台无关 |
| [Codex Windows 沙箱](https://learn.chatgpt.com/codex/windows/windows-sandbox) | Apache-2.0（随 openai/codex） | 两种原生模式：elevated 用专用低权限沙箱用户、文件系统权限边界、防火墙规则与本地策略；unelevated 用基于当前账号的受限令牌与 ACL，离线靠环境变量级控制，官方称更弱。两种模式默认用私有桌面 | 原生 Windows，elevated 需要管理员批准的初始化；企业可用 `allowed_sandbox_implementations` 强制 elevated（文档，经搜索摘要）。源码：`codex-rs/windows-sandbox-rs`、`windows-sandbox-service`。第三方博客称 elevated 建 `CodexSandboxOffline` 与 `CodexSandboxOnline` 两个本地用户，官方未证实 | openai/codex 创建 2025-04；rust-v0.163.0（2026-10-15） | Codex | 目前唯一找到的、由编码 agent 产品自己实现并发布的原生 Windows 沙箱，源码可读（Apache-2.0）；代价是需要管理员初始化 |
| [Microsoft MXC](https://github.com/microsoft/mxc) | MIT | 沙箱代码执行 SDK：统一 JSON 策略加 Rust、.NET、Node SDK，多个后端 | Windows 11 默认 `processcontainer`，另有 `windows_sandbox`、`wslc`、`microvm`、`hyperlight`、`isolation_session`（其中数项标 experimental）；Linux 默认 bubblewrap，另有 `lxc` 等；macOS 默认 `seatbelt`（README 后端表） | 创建 2026-02；v1.0.1（2026-10-17）；有第三方报道称其为早期预览、未必已是安全边界（二手，[搜索结果摘要](https://www.originhq.com/research/mxc-execution-containers-internals)，未核） | Codex 源码里有 `codex-rs/mxc-sandbox`，称其为 Windows 原生 MXC 后端，与既有 Codex Windows 沙箱并存（README@`f3a9054`）；其他产品：未查到 | 与 DreamCoder 的双平台需求最对口：一份策略、一套 SDK、macOS 与 Windows 各有原生后端。要评估成熟度与 Windows 版本下限 |
| Windows 11 的 agent workspace | 系统功能 | 实验性：agent 使用独立 Windows 账号，在单独会话与桌面里并行运行 | 需管理员开启「Experimental agentic features」，默认关闭（二手来源，[elevenforum](https://www.elevenforum.com/t/enable-or-disable-experimental-agentic-features-in-windows-11.42126/)；Microsoft Learn 原页未找到） | 预览 | 使用方：未查到 | 偏 GUI 自动化场景，对编码 agent 的文件隔离帮助不明，仅作观察 |
| [WSL2](https://github.com/microsoft/WSL) | MIT | Windows 内的 Linux 环境，可承载 bubblewrap 与 Linux 沙箱 | Windows，需虚拟化 | 3.0.3（2026-10-09） | Claude Code 官方文档的 Windows 沙箱方案（sandbox-environments）；Codex 走同一 Linux 路径 | 对用户有安装与文件系统跨边界（性能与路径）成本 |
| [NVIDIA OpenShell](https://github.com/NVIDIA/OpenShell) | Apache-2.0 | 自治 agent 的私有运行时，网关加监督进程加沙箱 | Linux、Apple Silicon macOS、Windows（WSL 2，实验性），需要 Docker、Podman 或主机虚拟化（README） | 创建 2026-02；v0.1.5（2026-10-20） | README 的示例用 OpenCode；其他：未查到 | 偏平台级网关，对单机桌面应用过重 |

### 3.2 容器与虚拟机（本机）

| 名称 | 许可证 | 一句话 | 平台与前提 | 成熟度 | 使用方 | 适配 |
| --- | --- | --- | --- | --- | --- | --- |
| [Apple Containerization](https://github.com/apple/containerization) 与 [container](https://github.com/apple/container) | Apache-2.0 | 每个 Linux 容器一个轻量虚拟机，Swift，基于 Virtualization.framework | 仅 Apple 芯片；`container` 工具需要 macOS 26（README） | containerization 创建 2025-05，无 GitHub release；container 1.6.0（2026-10-20） | 使用方：未查到 | 只有 macOS 26 与 Apple 芯片，不能成为跨平台唯一方案 |
| [Docker Sandboxes（`sbx`）](https://docs.docker.com/ai/sandboxes/) | 未查到（CLI 本地免费，包括商业，[文档](https://docs.docker.com/ai/sandboxes/)；源码仓库未找到） | 每个沙箱一个 microVM，自带 Docker 守护进程；工作区可直通挂载（宿主路径同名）或只读源加沙箱内私有克隆（[architecture](https://docs.docker.com/ai/sandboxes/architecture/)） | macOS：Apple 芯片、Sonoma 14 及以上；Windows 11 x64 并启用 Windows Hypervisor Platform；Linux：Ubuntu 24.04 及以上并需要 KVM；不需要 Docker Desktop（[install](https://docs.docker.com/ai/sandboxes/install.md)）。两处文档对 macOS 版本要求不一致（另一页称 Tahoe 26，经搜索摘要，未核） | 首次发布：未查到；云沙箱要求 `sbx` 0.45.0 及以上 | 官方列出：Claude Code、Codex、Copilot、Cursor、Devin、Docker Agent、Droid、Gemini、Kiro、OpenCode，另有无 agent 的 Shell（[agents](https://docs.docker.com/ai/sandboxes/agents.md)） | 两个平台都有官方 microVM 方案，且支持的 agent 最全；闭源、需要用户装一个独立 CLI 并登录（[install](https://docs.docker.com/ai/sandboxes/install.md) 写明需登录）。是否能被第三方桌面应用以 SDK 方式集成：未查到 |
| [microsandbox](https://github.com/superradcompany/microsandbox) | Apache-2.0 | 本地 microVM，可编程 | README 称 Linux、macOS（Apple 芯片）、Windows 均可；Windows 具体机制未核 | 创建 2024-10；v0.7.9（2026-10-22） | 使用方：未查到 | 值得关注的轻量选项，成熟度需实测 |
| [BoxLite](https://github.com/boxlite-ai/boxlite) | Apache-2.0 | 每个 box 一个硬件虚拟化 VM，加 OS 沙箱与出站白名单 | macOS Apple 芯片、Linux x86_64 受支持（README 表）；Windows：未查到 | 创建 2025-12；v0.10.7（2026-10-18） | 使用方：未查到 | 无 Windows，作观察 |
| [Firecracker](https://github.com/firecracker-microvm/firecracker) | Apache-2.0 | 基于 KVM 的 microVM 监控器 | 仅 Linux，需要 KVM | v1.17.0（2026-09-10） | E2B（见 3.3）、Vercel Sandbox | 桌面端不能直接使用，只在云端后端有意义 |
| [gVisor](https://github.com/google/gvisor) | Apache-2.0 | 用户态内核，拦截应用系统调用 | Linux | release-20261019.0（2026-10-22） | Modal Sandbox 的运行时之一（[文档](https://modal.com/docs/guide/sandbox)） | 同上，云端后端 |
| [kubernetes-sigs/agent-sandbox](https://github.com/kubernetes-sigs/agent-sandbox) | Apache-2.0 | 在 Kubernetes 上管理隔离的、有状态的单例工作负载 | Kubernetes | v1.0.8（2026-10-22） | 使用方：未查到 | 与桌面应用无关 |
| [Lima](https://github.com/lima-vm/lima)、[Colima](https://github.com/abiosoft/colima) | Apache-2.0；MIT | macOS 与 Linux 上跑 Linux 虚拟机或容器运行时 | Lima 面向 macOS 与 Linux；Windows：未查到 | Lima v2.2.1（2026-10-03）；Colima v0.10.3（2026-06-04） | 使用方：未查到 | 需用户自装，不适合内置 |

### 3.3 托管沙箱

| 名称 | 许可证 | 一句话 | 平台与前提 | 成熟度 | 使用方 | 适配 |
| --- | --- | --- | --- | --- | --- | --- |
| [E2B](https://github.com/e2b-dev/E2B) | Apache-2.0；运行时 [e2b-dev/infra](https://github.com/e2b-dev/infra) 也是 Apache-2.0 | Firecracker microVM，从快照恢复；「创建沙箱」即恢复一个预启动 VM，内存页按需加载；可暂停恢复（infra README） | 云服务，也可自托管（infra 仓库） | E2B 创建 2023-03；python-sdk 2.59.0（2026-10-22）；infra 2026.30（2026-09-10） | 使用方：未查到 | 快照与暂停恢复的实现可供参考；要用户上云，与本地优先的桌面应用定位不同 |
| [Modal Sandboxes](https://modal.com/docs/guide/sandbox) | Modal 客户端 Apache-2.0（[modal-client](https://github.com/modal-labs/modal-client)），服务闭源 | 沙箱可选 gVisor 或 vm 运行时；文件系统快照用于超过 24 小时的状态保存 | 云服务；GPU 沙箱仅 gVisor | 客户端创建 2022-10；服务 GA 状态：未查到 | 使用方：未查到 | 同上 |
| [Cloudflare Sandbox SDK](https://github.com/cloudflare/sandbox-sdk) | Apache-2.0（LICENSE 文件；GitHub 判定为 NOASSERTION） | 沙箱是一个 Durable Object 加其启动的 Container；`DirectoryBackup` 把目录存到 R2 再恢复到任意 Container | 云服务 | 创建 2025-06；@cloudflare/sandbox@1.0.3（2026-10-22） | 使用方：未查到 | 同上 |
| [Vercel Sandbox](https://github.com/vercel/sandbox) | Apache-2.0 | 内部是 Firecracker microVM，支持快照；按 Active CPU 计费，等待模型响应不收 CPU 费（[文档](https://vercel.com/docs/vercel-sandbox)） | 云服务 | 创建 2026-01；@vercel/sandbox-mock@3.9.0（2026-10-22） | 使用方：未查到 | 同上 |
| [Daytona](https://github.com/daytonaio/daytona) | 仓库 LICENSE 被 GitHub 标为 Other | 面向 AI 生成代码的弹性运行基础设施；**仓库已归档**，README 称 2026-06 起核心开发转入私有代码库，不再更新 | 云服务与自托管（旧版） | 创建 2024-02；v0.190.0（2026-06-23）后冻结 | 使用方：未查到 | 不能再当作开源依赖，已有人引用它的资料需要复核 |
| [Fly.io Sprites](https://fly.io/sprites/) | 服务闭源；SDK [sprites-go](https://github.com/superfly/sprites-go)、[sprites-py](https://github.com/superfly/sprites-py) 均 MIT | 持久、硬件隔离的 Linux 机器，提供完整环境检查点与恢复；检查点是块级快照（官网） | 云服务 | SDK 创建 2025-09 至 2026-01；sprites-go v0.2.2（2026-10-20） | 使用方：未查到 | 检查点语义是「整机」，值得与 agent 级检查点对照 |

### 3.4 小结

- 本机进程级沙箱的现状：macOS 用 Seatbelt（已被系统标为 deprecated 但仍是所有 agent 的选择），Linux 用 bubblewrap，Windows 原生方案只有 Codex 自己做的一套，以及新出现的 MXC 与 srt 的 Windows 后端。
- Claude Code 上游文档当前写明原生 Windows 不沙箱。fork 与 DreamCoder 的 Windows 行为未查。
- 本机 microVM 方案里，只有 Docker Sandboxes 在 macOS 与 Windows 都有官方支持且列出了 Claude Code 与 Codex。

---

## 4. 状态与历史

| 名称 | 许可证 | 一句话 | 平台与前提 | 成熟度 | 使用方 | 适配 |
| --- | --- | --- | --- | --- | --- | --- |
| Claude Code checkpointing（[文档](https://code.claude.com/docs/en/checkpointing.md)） | 闭源 | 每个启动一轮的提示创建一个检查点，保留最近 100 个；`/rewind` 可恢复代码、对话或两者；快照默认约 30 天后清扫 | 随 Claude Code。限制：只追踪文件编辑工具改过的文件，Bash 单独改的文件不追踪；子 agent 的编辑一般不进检查点；符号链接与硬链接不恢复；不追踪外部与其他并发会话的修改（同页） | 上游 v2.1.309 | Claude Code | 对多 agent 并行几乎不够用：子 agent 编辑与其他会话都不在范围内 |
| Cline checkpoints（[文档](https://docs.cline.bot/features/checkpoints)） | Apache-2.0（[cline/cline](https://github.com/cline/cline)） | 在与项目历史无关的 shadow git 仓库里，每次工具使用后提交当前文件状态，包含未被 git 跟踪的文件 | 默认开启；多根工作区时被禁用；大仓库可能占用大量存储并拖慢（文档，经搜索摘要） | cline desktop-v0.0.48（2026-10-17） | Cline | shadow git 覆盖面最大，代价是存储与速度 |
| Gemini CLI checkpointing（[文档](https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/checkpointing.md)） | 未核（仓库许可证本次未读） | 批准会修改文件的工具前，在 `~/.gemini/history/<project_hash>` 的 shadow git 里提交快照，同时保存对话与待执行工具调用；`/restore` 恢复并重提议工具调用 | 本地存储 | 未查到版本 | Gemini CLI | 把「文件快照加对话加待执行动作」打包的做法可借 |
| Aider：每次编辑自动提交，`/undo` | Apache-2.0 | 编辑前先提交用户已有的未提交改动，再提交 AI 改动；`/undo` 丢弃上一次（[文档](https://aider.chat/docs/git.html)） | 依赖 git | v0.86.0（2025-08-09），最近提交 2026-05-22 | Aider | 历史直接进用户分支，对多 agent 会污染历史 |
| Codex 的撤销 | Apache-2.0 | 在 `f3a9054` 的源码树里没有找到 ghost 快照或 undo 相关模块；`codex-rs/git-utils` 只有 apply、baseline、worktree 等 | 不适用 | 未查到 | Codex | 结论限于该提交，旧版本可能有 |
| [OpenCode](https://github.com/anomalyco/opencode) 快照 | MIT | 目录里有 snapshot 相关的基准脚本（`packages/core/script/benchmark-snapshot*.ts`），具体机制：未读源码，未查到 | 桌面端有 Windows 安装包（README） | v1.19.4（2026-10-22） | OpenCode | 未核实，不下判断 |
| [Entire CLI](https://github.com/entireio/cli) | MIT | 把 agent 会话捕获为存放在仓库对象库内的检查点，每个检查点一个 ref（`refs/entire/checkpoints/<shard>/<id>`），不进分支历史；可恢复会话 | 官方称支持 macOS、Linux、Windows（PowerShell 安装）；支持 Claude Code、Codex、Cursor 等（README） | 创建 2026-01；v0.12.0（2026-10-21） | 其 README 列出的上述 agent | 「检查点放在 git ref、不污染分支」的做法与 DreamCoder 的需求吻合，三平台均有 |
| [git-ai](https://github.com/git-ai-project/git-ai) | Apache-2.0 | agent 在写文件时调用 `git-ai checkpoint`，提交时把逐行归属写入 git notes（README） | Mac、Linux、Windows（README 分别给出 WSL 与原生 Windows 的安装说明，原生支持程度未核） | 创建 2025-07；v1.7.5（2026-09-09） | README 称面向主流 agent，具体清单未核 | 解决「谁写了哪一行」，不是回退工具，但对 lead 审阅有用 |
| jj 操作日志 | Apache-2.0 | 每个命令都是一次可撤销的操作，工作副本在每个命令前自动快照（working-copy 文档） | 同 jj | 同 jj | 未查到 agent 产品集成 | 若采用 jj，检查点基本是白送的 |
| AgentFS | MIT（README 徽章） | 文件操作、工具调用与状态变化都记录在一个 SQLite 文件里，可用 SQL 回查 | 见 1.1 | BETA | 未查到 | 审计导向，不是回滚导向 |
| 云端快照：[E2B](https://github.com/e2b-dev/infra)（暂停与恢复）、[Modal](https://modal.com/docs/guide/sandbox)（文件系统快照）、[Sprites](https://fly.io/sprites/)（整机检查点）、[Vercel](https://github.com/vercel/sandbox)（快照）、LayerFS（每步自动检查点） | 见各行 | 整机或整个文件系统的快照 | 云或 Linux | 见各行 | 见各行 | 只有在采用云沙箱时才有意义 |

小结：本机方案有三种形状：agent 自己在 shadow git 里提交（Cline、Gemini CLI）、自己维护文件快照（Claude Code）、写进用户仓库的专用 ref（Entire）。Claude Code 的官方文档明确列出子 agent 编辑与并发会话不在范围内。

---

## 5. agent 间通信与协议

| 名称 | 许可证 | 一句话 | 平台与前提 | 成熟度 | 使用方 | 适配 |
| --- | --- | --- | --- | --- | --- | --- |
| [A2A（Agent2Agent）](https://github.com/a2aproject/A2A) | Apache-2.0 | 基于 JSON-RPC 2.0 over HTTP(S)，用 Agent Card 做发现（README）；最初由 Google 开发后捐给 Linux Foundation，技术指导委员会成员含 AWS、Cisco、Google、IBM Research、Microsoft、Salesforce、SAP、ServiceNow（[a2a-protocol.org](https://a2a-protocol.org/latest/)） | 网络协议，与平台无关 | 创建 2025-03；v1.0.0（2026-03-12），最新 v1.0.1（2026-05-28） | Raven 经 A2A 包装外部 agent（见 [research/raven.md](../research/raven.md)）；其他编码 agent 产品：未查到 | 面向跨组织、跨服务的 agent，同机多个成员用它偏重 |
| [ACP（Agent Client Protocol）](https://github.com/agentclientprotocol/agent-client-protocol) | Apache-2.0 | 标准化「代码编辑器与编码 agent」之间的通信（README）；注意它不是 agent 对 agent | 本地子进程为主（stdio），文档未逐条核 | 创建 2025-06；schema-v1.26.0（2026-10-16）；当前稳定协议版本为 1（README） | 官方 agents 页列出：Claude Agent（经 Zed 的 SDK 适配器）、Codex CLI（经 ACP 适配器）、Cline、Cursor、Gemini CLI、GitHub Copilot（公开预览）、OpenCode、Goose、Junie、Kiro 等；clients 页列出 JetBrains、neovim、Sublime、Athas（Tauri）等（[agents](https://agentclientprotocol.com/get-started/agents.md)、[clients](https://agentclientprotocol.com/get-started/clients.md)）。Raven 把 ACP 子 agent 当常驻连接用（research/raven.md） | 是「桌面应用驱动多种 agent」的事实标准，但它只覆盖应用到 agent 这一段，不解决成员互发消息 |
| [MCP](https://github.com/modelcontextprotocol/modelcontextprotocol) | MIT（README） | 工具与资源的协议；可当协调通道：把共享状态做成 MCP 服务 | 与平台无关 | 创建 2024-09；规范 2026-07-28（2026-07-28 发布） | container-use、Weave、mcp_agent_mail 都以 MCP 服务形式向 agent 提供协调或隔离能力 | 对任何支持 MCP 的 agent 零侵入，但是拉取式，不能主动唤醒 |
| Claude Code 的跨会话消息（[文档](https://code.claude.com/docs/en/cross-session-messaging.md)） | 闭源 | `ListAgents` 与 `SendMessage`：同机、跨机、云端会话之间发文本；接收方在工具调用间隙读取，空闲时开启新一轮 | macOS 与 Linux（含 WSL2）需 v2.1.224 及以上，原生 Windows 需 v2.1.234 及以上 | 上游 v2.1.309；fork 兼容 2.1.92，不含此能力（未核 fork 源码） | Claude Code | 官方已把「会话间发消息」做成一等能力，与 agent teams 的文件 mailbox 是两套机制 |
| Claude Code agent teams 的文件 mailbox | 闭源 | 成员间经文件 mailbox，接收方轮询 | 见 [research/claude-code.md](../research/claude-code.md) | 实验功能 | Claude Code、cc-haha | 见已有拆解，不重复 |
| [mcp_agent_mail](https://github.com/Dicklesworthstone/mcp_agent_mail) | GitHub 判定 NOASSERTION，未核 | HTTP 的 FastMCP 服务：agent 身份、收发件箱、可搜索线程、对文件或通配符的「建议性租约」，用 Git 与 SQLite 存储 | Python 3.14 与 uv；README 称 Python 版已不再维护，由 [mcp_agent_mail_rust](https://github.com/Dicklesworthstone/mcp_agent_mail_rust) 取代（该 Rust 版本次未读） | 创建 2025-10；v0.3.2（2026-04-16） | 使用方：未查到 | 「信箱加文件租约」是最直接的协调原语，可借设计，不宜依赖 |
| [agentapi](https://github.com/coder/agentapi)（Coder） | MIT | 为 Claude Code、Goose、Aider、Gemini、Amp、Codex 提供 HTTP API | 仓库已归档 | v0.12.2（2026-05-27） | 使用方：未查到 | 已归档，不再选用 |
| Weave 的 MCP 协调工具、AgentRoom 的 `room_claim` | 见 2 | 在编辑前认领实体或文件 | 见 2 | 见 2 | 见 2 | 把「避免冲突」前移到编辑前，与合并后处理互补 |

小结：公开协议里没有「同机多个编码 agent 互发消息并带文件租约」的标准，现有做法是文件 mailbox（Claude Code teams）、会话间 `SendMessage`（Claude Code 新版）、MCP 邮件服务（mcp_agent_mail）。ACP 解决的是应用与 agent 之间的一层。

---

## 6. 值得深拆的候选

下面只写意见，按推荐顺序，均按 [_template.md](_template.md) 的格式做完整拆解。

1. Microsoft MXC。DreamCoder 的核心障碍是 Windows 沙箱，MXC 是唯一找到的、同时有 macOS（seatbelt）、Windows（processcontainer 等）、Linux（bubblewrap）后端和 Node SDK 的统一层，MIT 许可，且 Codex 已在源码里接入。要查成熟度、Windows 版本下限、策略模型能否表达「写入限于某个 worktree」。
2. Codex 的 Windows 沙箱（`windows-sandbox-rs` 与 `windows-sandbox-service`，顺带对比 srt 的 Windows 后端）。这是已发布、可读源码的原生 Windows 实现，可直接回答「elevated 需要管理员」这类落地问题，与 MXC 互为参照。
3. Worktrunk。覆盖「worktree 创建、依赖复制、reflink、`wt merge`」整条链，三平台都有，是最接近「worktree 加 lead 合并」的现成实践，许可宽松。
4. Weave（以 Mergiraf 为对照组）。目前唯一同时做实体级合并与「编辑前认领」的开源项目，Apache-2.0，支持 git 与 jj。需要核实它的自测数字能否复现，以及 Windows 可用性。
5. Docker Sandboxes（`sbx`）。macOS 与 Windows 都有官方 microVM，支持列表含 Claude Code 与 Codex，`--clone` 模式与我们的流程形状相近。先要弄清它是否有可集成的 SDK 与许可证；闭源则只能作为用户可选的外部运行环境来评估。
6. Entire CLI。把检查点放进仓库自己的 git ref 而不污染分支，三平台都有，覆盖主流 agent，可直接回答「历史存在哪里、怎么回退」。
7. GitButler。同为 Tauri 栈的 git 客户端，并行分支加面向 agent 的 hooks 与 skills；FSL 许可需先确认能否借鉴代码，值得看它的桌面端工程与 agent 集成方式。
8. Jujutsu。一等冲突、操作日志、workspace 一次解决了合并、历史、隔离三类问题，但要用户换工具。作为设计参照深拆，判断哪些概念可以在 git 之上模拟。

没有列入的：container-use（一年多没发版）、Daytona（仓库已归档）、AgentFS（BETA 且 Windows 未提）、CRDT 路线（没有被产品采用的实例）、云沙箱（与本地优先定位不合，可在 E2B 一项做简短补充）。

## 7. 空白

按我们的需求逐项列出，目前没有找到做得好的现成方案：

1. 「每成员一个 worktree，lead 审阅并合并」的底层流程：只有 Worktrunk 的单分支合并和各 GUI 的 PR 按钮，没有找到把多成员汇总、冲突预演（`git merge-tree`）、顺序合并与回退串起来的库。
2. 原生 Windows 的沙箱落地验证：Claude Code 上游文档称原生 Windows 不沙箱；Codex 方案需要管理员初始化；srt 与 MXC 的 Windows 后端较新，尚无独立评估。
3. 检查点覆盖子 agent 与并发会话：Claude Code 官方明确不覆盖；shadow git 覆盖面大但存储与速度有代价；Entire 的 ref 方案是否覆盖多个并发 agent，未查到。
4. NTFS 上的写时复制：Windows 默认文件系统没有 reflink，依赖复制只能完整复制，或要求用户使用 ReFS 与 Dev Drive。
5. 合并后语义冲突的检测：结构化合并只能保证文本层面不冲突，编译与测试级别的冲突仍靠 agent 与人。没有找到工具把「合并后自动构建与测试并回滚」做成标准步骤。
6. LLM 辅助合并：没有找到可直接接入的通用开源工具，研究结果显示最好的模型也远未可靠。
7. 同机多成员的通信标准：A2A 偏网络、ACP 偏应用到 agent，成员之间的消息与文件租约只有各产品私有实现和一两个社区项目。
8. 本机沙箱与 worktree 的结合：Claude Code 文档称隔离检查不追踪 shell 写了哪些文件；把「沙箱写入范围」精确限定在单个 worktree，只有沙箱运行时的文件策略能做，各产品如何配置未逐一核实。
