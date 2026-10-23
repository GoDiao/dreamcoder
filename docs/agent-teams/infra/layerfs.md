# LayerFS 拆解

| 项 | 内容 |
| --- | --- |
| 项目 | LayerFS（Ephemeral-AI-Lab），<https://github.com/Ephemeral-AI-Lab/layerfs>，文档 <https://layerfs.ai/docs/> |
| 核实版本 | commit `1aa56ece78e2ecd71b46cf07076100345df47239`（main，2026-10-23 03:57 +0800，下文简写 `@1aa56ec`）；最新发布 v1.0.0，仅源码，发布页无附件（`gh release view v1.0.0`） |
| 核实日期 | 2026-10-23 |
| 许可证 | MIT（`LICENSE`，GitHub 同）；代码可参考程度：可参考（Rust 实现，合并算法与冲突规则可直接读） |
| 类别 | 工作区隔离、合并与冲突、状态与历史、沙箱执行 |
| 平台 | 只有 Linux 原生：每个 Workspace 是 Sandbox 容器里 daemon 提供的 FUSE 挂载，Store 只允许同一 Linux 内核内的进程直接打开（`core/crates/layerfs-store-service/src/kernel_guard.rs:1-9,59-65@1aa56ec`）。macOS 靠 Docker Desktop，Windows 靠 WSL2 内自带的 Docker Engine（均经 dsh-layerfs 插件，`dsh/README.md:84,202,206-213@1aa56ec`）。无 macFUSE/FSKit/NFS 路线（第 6 节）。 |
| 成熟度 | 仓库创建 2026-08-10，首个 Developer Preview v0.1.0 发布于 2026-09-01，v1.0.0 发布于 2026-10-21（`gh repo view`、`gh release list`）；官方标注 Store 只运行 Disposable 档位，无崩溃/断电持久性（`README.md:34-37@1aa56ec`）。Windows WSL2 适配晚于 v1.0.0，只在 main 上（`dsh/README.md:1@1aa56ec`）。 |
| 主要来源 | `core/docs/architecture/81-compare-and-merge.md`、`core/crates/layerfs-content/src/merge/`、`core/crates/layerfs-store-service/src/{history/branch.rs,store/commit_merge.rs}`、`core/crates/layerfs-persistence/src/history/layerstack.rs`、`sdk/js/README.md`、`dsh/README.md`、`dsh/packages/dsh-layerfs/presets/layerfs-dsh-minimalist.patch.yml`、`.agents/skills/layerfs-js-sdk/`、<https://layerfs.ai/docs/core-ideas/>、issue 见第 11 节 |

下文路径均相对仓库根目录，commit 均为 `@1aa56ec`。

## 1. 定位

LayerFS 是给 agent 用的版本化文件系统底座：把整个项目树（含 `.git`、被忽略文件、依赖、构建产物）放进一个 SQLite 文件，每个 agent 挂载一个可写的 Workspace，改动以 Commit 形式记入 Branch，Branch 之间可 fork、合并，只有发布才改变 `main`（`README.md:139-155`；`docs/general/concepts.md:10-22`）。它解决「多个 agent 各有一份完整可写工作树，成果汇到一处并带历史」这一层，不包含 agent 循环、通信或任务分配。

要点：多 agent 共享的版本化工作树底座，Linux FUSE + 单文件 SQLite Store，只管文件与历史，不管 agent 调度。

## 2. 核心模型

- **Store**：一个 `LayerStackStore` 是一个 SQLite 文件加一个内容对象命名空间，含 LayerStack、Layer、Branch、Commit 与按 `ObjectId` 全局去重的 canonical 对象（`docs/general/concepts.md:10-22`）。无数据库服务器，daemon 与 SDK 进程直接打开该文件（`README.md:146-148`；`sdk/js/README.md:40-47`）。
- **Layer / main**：Layer 是不可变的已发布快照，`main` 是 LayerStack 的头部 Layer，只能通过 publish 前进（`sdk/js/README.md:159-163`）。新项目的 `main` 为空，必须 fork Branch 才能写（`dsh/packages/dsh-layerfs/presets/layerfs-dsh-minimalist.patch.yml:33`）。
- **Branch / Commit**：Branch 是以某个 Layer 为基的可写线，Commit 是 Branch 的不可变快照；fork 只写元数据，可从 `main`、Branch、Commit 或 Layer 出发（`core/crates/layerfs-store-service/src/history/branch.rs:167-205`）。
- **Workspace**：某个 Branch 头和基 Layer 的可写视图，无自己的持久数据库（概念文档称之为 ephemeral），生命周期为 Create、Exec、Commit、End，End 绝不隐式 Commit（`docs/general/concepts.md:24-39`）。实现上每个挂载的 Workspace 有一个挂载时从模板复制、卸载时删除的本地 overlay SQLite 文件（`docs/general/workspace-filesystem-view.md:41-46`）。
- **Sandbox**：一个运行单个 daemon 的容器，每个项目有编号的 Sandbox，每个最多容纳 16 个 Workspace，空闲 2 分钟后 daemon 自行退出（`sdk/js/README.md:83-110`）。
- **内容模型**：对象只追加、不原地改写，按内容定义分块与 delta 编码，小改动只重建被修改的前沿（`docs/general/concepts.md:41-54`）。
- **「rewind」**：SDK 29 个方法中无重置 Branch 头的方法（`sdk/js/README.md:151-157`）；回到某个检查点的做法是从该 Commit fork 新 Branch（`core/crates/layerfs-store-service/src/history/branch.rs:196-203`）。README 正文未使用「rewind」一词（`README.md@1aa56ec` 全文检索）。

要点：Store（SQLite）→ Layer / Branch / Commit 的不可变历史 → 每次挂载一个临时 Workspace，只有 Commit 才改写历史。

## 3. 隔离

- **每个 agent 看到什么**：Workspace 包含整个已提交树，含 `.git` 及其索引、被忽略文件、依赖、符号链接、缓存和输出，不按 git 忽略规则过滤（`AGENTS.md:58-60`，`.agents/skills/layerfs-js-sdk/SKILL.md:151` 亦称 commit 保存 `node_modules`、`.git`、构建产物）。
- **能写什么**：写入落在 Workspace 自己的 overlay，直到 Commit；卸载删除 overlay，不删历史（`README.md:150-152`）。已提交内容不可变（`docs/general/concepts.md:48-52`）。
- **读写的可见性**：`fs.*` 读只看已提交状态，看不到已挂载 Workspace 里未提交的改动（`dsh/packages/dsh-layerfs/presets/layerfs-dsh-minimalist.patch.yml:59`）。
- **隔离粒度**：文件系统视图级。一个 Sandbox 容器可同时承载同一项目的至多 16 个 Workspace，可属于同一 Branch 或不同 Branch（同上 `:61`）；每个 Workspace 一个 FUSE 辅助进程，每次 exec 一个新进程（`docs/general/concepts.md:66-68`）。未查到 Workspace 之间的 PID、网络、资源配额隔离。
- **创建方式**：`workspace.mount(branch)` 返回 `{ sandbox, path }`，由 LayerFS 选择最低编号且未满的 Sandbox，满了就新起容器；agent 不创建也不关闭 Sandbox（`sdk/js/README.md:56-65,83-93`）。挂载不扫描、不复制整棵树（`sdk/js/README.md:47`）。
- **命令执行**：`exec` 在 Workspace 根目录运行 `bash -c`，`HOME=/tmp`，无超时（`dsh/packages/dsh-layerfs/presets/layerfs-dsh-minimalist.patch.yml:60`）。
- **FUSE 功能缺口**：FIFO、socket、设备节点、set-id 位、独立的 atime/ctime 被有意省略（`README.md:165`）。

要点：每个 Workspace 是整棵项目树（含 `.git` 与依赖）的写时复制视图，隔离粒度是文件系统，不是进程或网络。

## 4. 合并与冲突

### 4.1 判定粒度

- **按 inode 序号而非路径配对**，再对两侧都改动的条目逐项决策；移动跟随序号，一侧移动目录、另一侧改目录内文件，改动落到新路径（`core/docs/architecture/81-compare-and-merge.md:89-111,133-134`）。
- **文本文件按行做三方合并**：`merge3` 用 LCS 把 base 在两侧匹配到的行作锚点切块，只被一侧改动的块取该侧，两侧改成相同取任一，两侧改成不同才产生冲突块（`core/crates/layerfs-content/src/merge/text.rs:1-9,40-86@1aa56ec`）。不是整文件粒度，也不是字节区间粒度。
- **文本的界定**：至多 1 MiB、合法 UTF-8、无 NUL 的普通文件，以 `\n` 分行；行差异的 LCS 表受 `MAXIMUM_DIFF_CELLS` 限制，超过后保留公共前后缀、中间整块处理（`core/docs/architecture/81-compare-and-merge.md:24,83-85`）。
- **非文本或超限文件**：两侧都改则冲突类型 `binary`，保留 ours、不加标记（`core/crates/layerfs-content/src/merge/decide.rs:245-255`）。
- **字节相同判定**：内容根不同但字节相同的两个文件视为未改（`core/docs/architecture/81-compare-and-merge.md:58-77`）。
- **元数据**：mode、mtime 等按字段分别合并，只有一侧改的字段取该侧，两侧改成不同 mode 才算 `mode` 冲突（`core/docs/architecture/81-compare-and-merge.md:127-131`）。
- **冲突类型**：`content`、`add/add`、`modify/delete`、`delete/modify`、`type`、`binary`、`markers`、`mode`（`core/crates/layerfs-content/src/merge/types.rs:9-45`）。一侧删除、另一侧修改，保留文本并放进删除标记块（`core/crates/layerfs-content/src/merge/decide.rs:270-301`，`text.rs:88-103`）。
- **hunk 不重叠但同文件的情形**：按上面的 `merge3`，两侧改同一文件的不同行区域会自动合并，不冲突；官方文档的「同一文件会被拒绝」是简化表述（`README.md:153-155`、<https://layerfs.ai/docs/core-ideas/> 与 `merge/text.rs:53-57` 不一致）。

### 4.2 `.lww` 规则

`/.lww` 是 gitignore 语法的规则文件，支持 `%include <file>`（例如 `%include .gitignore`），命中的路径在两侧都改时取 mtime 较新的一侧，平手取 ours；删除取最近的仍存在的父目录的 mtime（`core/crates/layerfs-content/src/merge/lww.rs:1-9`，`decide.rs:229-239`；`core/docs/architecture/81-compare-and-merge.md:121-122`）。规则从哪一侧读：Workspace Commit 读 theirs（Branch 头），Branch 合并读 ours（左 Branch）（`core/crates/layerfs-content/src/merge/types.rs:71-78`）。LayerFS 仍保存这些文件，`.lww` 只改变合并方式（`.agents/skills/layerfs-js-sdk/references/rules/lww.md:38-39`）。

### 4.3 合并发生的三个地方与冲突后的行为

| 场景 | 触发 | 冲突时 | 谁解决 |
| --- | --- | --- | --- |
| Workspace Commit（及 `fs.*` 写，内部用私有 Workspace） | Branch 头在挂载后移动 | 不发布；合并结果（含标记文件）装为该 Workspace 的本地基，Workspace 此后跟随新头；在标记块仍存在时再次 Commit 一律被拒（`Conflict`，`markers: true`），`force` 也无效（`core/docs/architecture/81-compare-and-merge.md:238-241,254-262`；`.agents/skills/layerfs-js-sdk/references/rules/conflicts.md:62-63`）。`fs.*` 写则是拒绝并不提交（`core/crates/layerfs-store-service/src/write/files.rs:123-136`）。 | 发起 Commit 的 agent，在该 Workspace 内编辑后重新 Commit |
| `branch.merge(a, b, name)` | 显式调用 | 不创建任何东西，两个 Branch 不变，不写标记（`core/crates/layerfs-store-service/src/history/branch.rs:442-448`；`.agents/skills/layerfs-js-sdk/references/methods/branch.md:144-147`） | 调用者：在两个输入 Branch 的工作 fork 上把同一份人工合并结果写进去再合并（`conflicts.md:154-197`） |
| `branch.publish(branch)` | 显式调用 | 不合并，见 4.4 | 无 |

- **谁决定、如何决定**：LayerFS 不指派解决者；dsh 预设的提示词规定「合并冲突属于调用 `branch.merge` 的 agent」，且「只有主 agent 发布到 main」（`dsh/packages/dsh-layerfs/presets/layerfs-dsh-minimalist.patch.yml:92-94`）。这是提示词约定，不是运行时强制（同文件 `:4` 声明「本包不带工具代码」）。
- **强制覆盖**：只有 Workspace Commit 有 `force`，且只在头移动后的第一次 Commit、冲突尚未写入时有效；它把 Workspace 视图盖在新头上，对方的 Commit 留在历史里但不在 Branch 上（`conflicts.md:126-146`，`81-compare-and-merge.md:243-245`）。`branch.merge` 无 `force`（`conflicts.md:211-224`）。
- **合并单元（merge units）**：`branch.merge` 可传 `units`，一个单元被两侧都改时整体取较晚写入的一侧，不做文本合并（`core/docs/architecture/81-compare-and-merge.md:171-206`）。
- **诊断截断**：冲突列表、lww 列表有字节窗口，会被截断，截断不影响合并语义；被截断的合并不等于干净合并（`sdk/js/README.md:236-251`）。
- **规模上界**：Commit 的 lane 内第二步合并最多处理 1024 个变更序号，超过则以 `LaneMerge` 拒绝（`core/crates/layerfs-store-service/src/store/commit_merge.rs:21-24,98-101`）。

### 4.4 合并一个 Branch 与发布到 main 的区别

- `branch.merge(a, b, name)` 把 `a`、`b` 合进一个**新** Branch `name`，`name` 不能是 `main` 或已存在的名字；`a`、`b` 可以是 `main`；若一侧已包含另一侧则快进（`core/crates/layerfs-store-service/src/history/branch.rs:284-340`；`branch.md:101-108,140`）。合并基为两个节点的共同祖先，无共同历史则 `NoMergeBase`（`branch.rs:366`）。
- `branch.publish(branch, commit?)` 往 `main` 加一个 Layer，实现注释称「只覆盖」（overwrite-only）：新 Layer 直接放在栈头上，不管 `main` 自 Branch 基之后又得到了什么，被跳过的 Layer 数记在 `overwrote_count`，仍在历史里（`core/crates/layerfs-persistence/src/history/layerstack.rs:318-339`；`core/crates/layerfs-store-service/src/history/branch.rs:571-572`）。发布前要求 Branch 头等于待发布 Commit、基 Layer 未变（`layerstack.rs:300-311`）。
- 官方推荐流程是先 `branch.merge(work, "main", ...)` 得到新 Branch，测试后再发布它（`branch.md:178-185`）。

要点：文本按行做三方合并，同文件不同区域自动合并；Workspace Commit 冲突时在 Workspace 写标记、`branch.merge` 冲突时什么都不建；`publish` 不合并、只覆盖，合并要先自己做。

## 5. 历史与回退

- **检查点**：`fs.*` 每次调用是一个 Commit，Workspace 里每次 `commit` 一个 Commit，无变更则不产生 Commit（`sdk/js/README.md:165-170`；<https://layerfs.ai/docs/core-ideas/>）。Bash 调用并不自动 Commit，须调用方显式 `commit`（见第 8 节）。检查点只含文件，不含进程、内存、套接字、命令输出（<https://layerfs.ai/docs/core-ideas/>）。
- **读取历史**：`branch.list_commits`（沿首父、最新在前）、`diff_commits`、`diff_branches`、`fs.blame`、`fs.diff_files`；任何 Commit 或 Layer 可作 ref 读取（`sdk/js/README.md:151-157,210-221`）。
- **分叉**：fork 是元数据操作，可递归、任意深度（`core/crates/layerfs-store-service/src/history/branch.rs:167-168`；`README.md:82`）。
- **回退**：无就地重置；从旧 Commit fork，或在 Workspace 中 `unmount(ws, true)` 丢弃未提交改动（`.agents/skills/layerfs-js-sdk/references/rules/conflicts.md:148-152`）。
- **保留时间**：对象只追加，常规操作不删对象（`docs/general/concepts.md:48-54`）。无 Branch 退役与不可达历史回收（issue #411，开）；`core/docs/architecture/84-global-sqlite-store.md` §8 称安全 GC 尚无契约、未实现（引自 #411）。
- **Store 格式不兼容**：旧 Disposable Store 不迁移，直接拒绝（`sdk/js/README.md:390-392`）。

要点：每次写与每次 Commit 都是可 fork 的不可变检查点，历史只增不删，没有重置，也没有 GC。

## 6. 平台与前提

- **Linux**：原生。Store 必须在 ext4、xfs 或 btrfs 上，所有打开者共享同一 Linux 内核，否则 Store 调用失败 `Unsupported`（`core/crates/layerfs-store-service/src/kernel_guard.rs:1-9,12-18`；`sdk/js/README.md:40-47`）。Sandbox 是 Docker 容器，SDK 通过本机 Docker Engine 套接字创建它（`sdk/js/README.md:67-77,83-100`）。Linux 上运行 dsh 的用户要能写 Docker 的卷目录（默认 `/var/lib/docker/volumes`，通常是 root）（`dsh/README.md:204`）。
- **macOS**：Mac 本机不运行任何 Store 调用。Host 启动一个常驻 Linux 容器 `layerfs-store`，所有 SDK 调用在其中用 Linux 版 `layerfs.node` 运行；Sandbox 也是 Docker Desktop 里的容器；需要 Docker Desktop 与 Node ≥22.19（`dsh/README.md:84,93,122,202`）。无 macOS 原生 FUSE 层：`layerfs-fuse` 对 `fuser` 的依赖只在 `cfg(target_os = "linux")` 下声明，`attributes/mount/request/session` 模块只在 Linux 编译（`core/crates/layerfs-fuse/Cargo.toml:14-17`；`core/crates/layerfs-fuse/src/lib.rs:10-17`）。项目内曾写道「Linux 优先，macFUSE 与 Windows 适配以后再做」（`core/docs/architecture/proposal/01-projection-and-runtime.md:30`）。vendored 的 `fuser-0.18.0` 带 `macfuse-4-compat` 特性开关，但 LayerFS 未启用（`core/vendor/fuser-0.18.0/Cargo.toml:52`；`core/crates/layerfs-fuse/Cargo.toml:15`）。issue #368「请加 macOS 支持」于 2026-10-21 以 COMPLETED 关闭，无评论（<https://github.com/Ephemeral-AI-Lab/layerfs/issues/368>，关）。FSKit、fuse-t、NFS 回环：未查到（全仓库检索 macfuse、fskit、fuse-t、nfs、winfsp、projfs、dokan，仅命中上述提案句、`fuser` vendor 与 pjdfstest 对 NFSv4 ACL 的说明）。
- **Windows**（开发中，只在 main，默认不属于 v1.0.0）：dsh 与默认 profile 留在 Windows，另有 `windows/` 适配器在选定的 WSL2 发行版里启动常驻 Node worker，该发行版需有自己运行中的 Docker Engine、`/dev/fuse`、Node ≥22.19 和用 `tools/worktree.py build` 构建的封装 Linux bundle；不使用 Docker Desktop 的 Windows 命名管道；Store 不得放在 `/mnt/c` 等 Windows 挂载上（`dsh/README.md:1,206-243`）。Docker Desktop 的卷对 WSL Linux 主机不可见是另一个不支持的拓扑（`dsh/README.md:271-275`；issue #380，开）。原生 Windows（无 WSL2）：未查到，且无对应代码。
- **打包形态**：只有源码；SDK 为无依赖纯 JS，原生 addon 与 daemon 需在 `rust:1.85.1-bookworm` 容器里自行构建，运行时镜像也要自行构建；打包后的 dsh 桌面版与 npm 安装未验证（issue #406，开）（`dsh/README.md:91-142,271-273`）。
- **多机**：「不同电脑共享一个无服务 Store」是首页宣传语（README 核心想法 02），但同一页文档与 `kernel_guard.rs:1-9` 规定所有打开者共享一个 Linux 内核；跨机的 PostgreSQL 共享层只是提案（issue #420，开）。

要点：只有 Linux 是原生的；macOS 与 Windows 都是在 Docker 容器或 WSL2 里的 Linux 上跑，没有原生 FUSE 层，也没有人在做。

## 7. 性能与资源

- **挂载与 Commit 延迟（#352 range 15 基线，2026-10-19，Docker Desktop 的 Linux VM，每类一个样本集的 p50 / p95）**：`sandbox.mount` 9.4 / 14.0 ms，`unmount` 8.8 / 14.0 ms，一次性 Workspace（mount + exec + Commit + unmount）p50 531 ms（231 次），`fs.write ≤8 KiB` 约 6 ms，空变更 Commit（`UpToDate`）3.3 ms，一个文件的 Commit 8.3 ms，每个变更文件约 6 ms（`core/docs/issues/352/BASELINE_R15.md:46-70`）。这些是 v1.0.0 之前的数字，且是 Disposable 档位。
- **执行开销（#362 基线，2026-10-18，同样 Docker Desktop on macOS，单样本，仅冷热对比）**：`node_modules` 约 5.1 万条目的树上，git status 冷 627 ms 对原生 141 ms（4.5 倍），git status 热 154 ms 对 8.3 ms（18 倍）；`find` 冷 29 倍，`grep -r` 冷 36 倍，`rm -rf node_modules` 39 倍（22.3 s）；`pnpm install` 首次 11.6 s 对 4.4 s（2.6 倍）；`vitest` 冷 1.4 倍，`tsc -b` 热 1.3 倍。该基线自称 wall time 是 warm-Store 诊断，计数才是精确比较，且未测内存、Store 体积、挂载时间（<https://github.com/Ephemeral-AI-Lab/layerfs/issues/362>，开；该 issue 称 commit 在本地分支，未推送）。
- **#364（关）的后续优化**：含 `node_modules` 的 Branch 合并 p50 1,897 ms，其中 171 次 LWW 决策有 160 次在 `node_modules` 下；pnpm relink 后一次 Commit 11.8 s 处理 94,536 个字节相同的重写文件，仅新增 647 KB（<https://github.com/Ephemeral-AI-Lab/layerfs/issues/364>，关）。关闭后的实测值：未查到。
- **磁盘与去重**：README 称某真实项目 157 个快照（4.94 GB 树）存为 100.1 MB，比 Btrfs + zstd 的 1,994.6 MB 小 19.9 倍；该数据来自官方基准，承认 Btrfs 在大文件原地小改、持久性与成熟度上更好（`README.md:121,166`）。dsh 演示的两次运行：Wayfare 91.5 MB 快照存为 1.21 MB，Quarry 4.93 TB 快照存为 8.90 GB（`dsh/README.md:346-351`）。
- **依赖复用**：`project.init` 把源码、`.git`、依赖、缓存、被忽略文件一并捕获为 main 的第一个 Layer，之后每次挂载都带着它们，无需重新安装；先装一次再 Commit，后续挂载都有（`<https://layerfs.ai/docs/core-ideas/>`，`AGENTS.md:58-60,76-78`）。首次读文件内容仍要从 Store 取（同上页）。
- **顺序带宽**：fio 上顺序写 0.31 倍、顺序读 0.81 倍、随机写 0.40 倍于 libfuse passthrough（`README.md:122`）。
- **限额**：每个 Sandbox 16 个 Workspace；每个 `exec` 流内联至多 1 MiB，更大的写入临时文件；binding 默认把 `UV_THREADPOOL_SIZE` 设为 64（`sdk/js/README.md:56-65,86,134-149`）。进程内存与 daemon RSS：未查到汇总数字。

要点：挂载约 10 ms、小 Commit 数十毫秒、依赖随挂载复用且全局去重，但元数据密集操作（git status、find、pnpm）比原生慢 1.3 到 39 倍，数据为 v1.0.0 之前的 Docker Desktop 单样本。

## 8. 接入方式

- **JS SDK（`@layerfs/sdk`，唯一公开接入面）**：29 个方法，位置参数、全部返回 Promise（`sdk/js/README.md:151-163`）。
  - `project`：`init(sourcePath)`、`list_branches`。
  - `branch`：`fork(name, fromRef?)`、`list_commits`、`diff_commits`、`diff_branches`、`merge(a, b, name, message?, units?)`、`publish(branch, commit?)`。
  - `fs` 读：`read`（仅文本，每次至多 2000 行或 48 KiB）、`list`、`stat`、`grep`、`glob`、`diff_files`、`blame`。
  - `fs` 写：`write`、`edit`（旧文本须恰好匹配一次）、`apply`（有序多变更，一次发布）、`mkdir`、`rm`、`cp`、`mv`；每个调用一个 Commit（`sdk/js/README.md:172-182`）。
  - `workspace`：`mount(branch)`、`exec(ws, command, message?, {stdout?, stderr?}?)`、`status`、`commit(ws, message?, force?)`、`unmount(ws, discard?)`。
  - 内部 operator 子路径：`process.start/list/cancel`（后台进程）、`sandbox.list`、`inspect.snapshot` 等（`sdk/js/README.md:253-276`）。
  - 无二进制读取方法：`fs.read` 拒绝非 UTF-8 文本（issue #417，开）。
- **CLI**：仓库内无公开发布的 CLI；dsh 预设引用的 `$DSH_LAYERFS_CLI` 提供 `status|log|ls|cat|grep|diff|fork|write|run` 等（`dsh/packages/dsh-layerfs/presets/layerfs-dsh-minimalist.patch.yml:35`）。
- **HTTP**：只有本地演示服务器把 SDK 映射为 `/api/{sdk|operator}/{group}/{method}`，不属于公开接口（`sdk/js/README.md:275-276`）。
- **文件系统视图**：任何有挂载可见性的进程都用普通文件系统调用访问 Workspace，daemon 不监督命令；命令由 Sandbox 或外部执行器启动，常规 Bash 无自动超时、隐式 Commit 或自动卸载（`AGENTS.md:64-72`）。
- **已知集成：DeepSeek Harness（dsh）的 `dsh-layerfs` 插件**。
  - **不改 dsh 代码**，作为 bundle 加入 profile（`dsh/README.md:29`）。
  - **没有 hook Bash 工具，也没有 hook 文件工具**：预设只保留 bash、后台 job、subagent，删除了 read/write/edit 工具；agent 通过 bash 运行从 stdin 喂入的短 Node 脚本调用 SDK（`dsh/packages/dsh-layerfs/presets/layerfs-dsh-minimalist.patch.yml:1-5,25-26,39-49`；`dsh/README.md:516-518`）。
  - Host 插件只做三件事：给每次 Bash 调用注入环境变量（`DSH_LAYERFS_PROJECT`、SDK 与 operator 的 file URL、每个 agent 一个 trace 文件、Bash 调用 id 作 trace step），把每次 SDK 调用记成 `plugin:layerfs/call` 会话记录，提供 `/layerfs` Web 路由与 Work、History 标签页（`dsh/README.md:428-437`）。
  - **「每次 Bash 调用 mount → exec → commit → unmount」是写在系统提示里的约定**，不是运行时机制：提示要求把四步放进同一个脚本、用 `finally` 卸载，并说「没有任何东西会替你卸载」（`dsh/packages/dsh-layerfs/presets/layerfs-dsh-minimalist.patch.yml:62-73`）。README 的图（`README.md:128-134`）把它画成工具层行为。
  - 文件读写：在提示里是 `fs.*` 的 SDK 调用，同样由 agent 自己写脚本调用；官方文本把它描述为「file tools go via SDK in-process」，实际是 agent 在 Bash 里起的 Node 进程（`README.md:140`；预设 `:32,54,59-60`）。
  - 项目在会话首次使用时固定；预设规定一个 Workspace 属于挂载它的 agent，只有主 agent 发布（`dsh/README.md:436`；预设 `:92-94`）。
  - macOS 上 Host 另起 Store 容器，Bash 调用中的 SDK 经它运行（`dsh/README.md:202`）。
- **其他集成**：issue #425（开）中第三方维护的 `layerfs-wsl` 称已让 OMP 与 Claude Code 在 Windows 上使用 LayerFS，方式是对 WSL2 内 Linux 客户端容器做 `docker exec`（<https://github.com/Ephemeral-AI-Lab/layerfs/issues/425>）；issue #382「Pi，Linux/macOS」被 #425 提到，未单独核实。Claude Code 的接入细节：未查到。

要点：公开接入面只有 JS SDK；dsh 集成靠提示词、环境变量和 agent 自写的 Node 脚本，不替换也不拦截任何内置工具。

## 9. 与 git 的关系

- **独立于 git，不包裹 git**：LayerFS 有自己的 Branch / Commit / merge / blame，预设称「像用 git 一样用它」（`dsh/packages/dsh-layerfs/presets/layerfs-dsh-minimalist.patch.yml:32`）；README 把 git worktree 列为相近的前人工作，差异是 Workspace 含整棵树，Commit 按工具调用而不是按 `git commit`（`README.md:167`）。
- **导入**：`project.init(sourcePath)` 复制宿主目录，所有内容含 `.git` 与被忽略文件都被导入，之后源目录与项目无关联（`.agents/skills/layerfs-js-sdk/references/methods/project.md:16`；`dsh/README.md:242`）。预设要求把源目录里的文件当作临时草稿，不当作项目内容（预设 `:30`）。不接受 set-user-ID/set-group-ID 位、文件上的 sticky 位、符号链接作为源根（`sdk/js/README.md:28-34`）。
- **导出为 git 分支或提交**：未查到。SDK 29 个方法无导出，`sdk/js/README.md:161-163` 明说没有「harness export」；仓库检索 `git export|git import|git push|to a git` 无命中。
- **写回用户原有目录**：未查到。
- **在 Workspace 内运行 git**：可以，`.git` 随树进入 Workspace，预设把 git 列为 Workspace 内可运行的命令之一（预设 `:60`），其变更会作为文件被 Commit；`.gitignore` 还可通过 `/.lww` 的 `%include` 变成合并规则（`lww.md:7-18`）。
- **二进制取回**：因 `fs.read` 不返回原始字节（issue #417，开），经 SDK 把二进制文件取出 LayerFS 没有现成路径；Workspace 内可用 `exec` 的 stdout，但文本解码按 UTF-8，非法字节变 U+FFFD（`sdk/js/README.md:134-149`）。

要点：与 git 并行的独立版本系统；能导入含 `.git` 的目录，没有导出或写回，成果取出路径未查到。

## 10. 可靠性与安全

- **持久性**：只允许 Disposable / WAL / `synchronous=OFF`，Durable 档位被 owner 无限期禁用且不执行；官方建议不要把 LayerFS 当唯一副本（`AGENTS.md:42-54`；`README.md:34-37`）。每个 Workspace 的 overlay 是单独的 MEMORY/OFF/EXCLUSIVE 数据库（`AGENTS.md:53-54`）。崩溃或断电后的恢复：未查到（文档明确排除「daemon/容器重启恢复与不确定操作的重放」，`sdk/js/README.md:130`）。
- **并发写入**：写者通过 Store 的短发布通道（对 Store 目录的 `flock`）轮流提交，读不等待（`kernel_guard.rs:1-6`；<https://layerfs.ai/docs/core-ideas/>）。Commit 在发布通道里读 Branch 头、合并、发布，并发写者看不到「头已移动」（`sdk/js/README.md:184-189`）。头在合并后再次移动，则返回 `HeadMoved`，不再次合并（`core/docs/architecture/81-compare-and-merge.md:251-253`）。
- **调用语义**：一次尝试，不重试、不重放；请求在发送前失败是 `Failed`，已发送但丢失回复是 `Unknown`，永不重放（`sdk/js/README.md:394-396`；`dsh/README.md:257-259`）。同一个 Workspace 的操作要自己保持顺序（`sdk/js/README.md:65`）。
- **与 agent 的权限约束**：LayerFS 自身未查到对 agent 命令的权限约束；约束来自外层。dsh 要求预设会话运行在 Workspace Write 模式，该模式的 Bash 沙箱只允许写 OS 临时目录，LayerFS 的 home 与 trace 都放在那里（`dsh/README.md:292,368`）。Sandbox 容器的唯一挂载是项目的 Store 卷（`sdk/js/README.md:94-96`）。
- **与 Store 通信**：daemon 控制通道用 Noise 认证；Docker 端口只发布在宿主 `127.0.0.1`（`core/docs/architecture/81-compare-and-merge.md:263-268`；`sdk/js/README.md:77`）。
- **本地信任**：`LAYERFS_HOME` 必须是当前用户私有目录，权限 0700，记录 0600（`sdk/js/README.md:69`）。
- **资源泄漏**：Workspace 未卸载会让 Sandbox 容器永远运行（issue #422，开）、Sandbox 容器留下 Workspace 外的临时文件（#423，开）；磁盘满导致 Commit 被拒后，已写入的 pack 留在 Store 里，之后所有写入都被拒 `Capacity`（#379，开）。

要点：只有 Disposable 档位，无崩溃持久性与恢复；写入串行经发布通道，调用不重放；对 agent 命令的约束完全来自外层沙箱。

## 11. 已知问题

均为 <https://github.com/Ephemeral-AI-Lab/layerfs/issues/N>，状态截至 2026-10-23。

- #411（开）：Store 无法退役 Branch 或回收不可达历史，空间只增不减。
- #379（开）：磁盘满时被拒的 Commit 留下 pack，之后所有写入都被拒 `Capacity`，无公开或 operator 调用可清除。
- #422（开）：被遗弃的 Workspace 使 Sandbox 容器永远运行，Docker 占用持续增长。
- #423（开）：Sandbox 容器保留写在 Workspace 之外的临时文件。
- #417（开）：`fs.read` 拒绝二进制文件，无法经 SDK 读回二进制内容。
- #380（开）：Docker Desktop 上的 WSL2，引擎卷路径对宿主不可见，配置的 `volumes` 到不了 Store。
- #406（开）：打包的 dsh 桌面版与树外插件安装不可用。
- #420（开）：提议在多机之间用 PostgreSQL 作共享层，说明当前 Store 不能跨机。
- #425（开）：第三方提议把 WSL2 路线共享给非 dsh 适配器。
- #412（开）：dsh 的 LayerFS 标签页在暗色主题下仍是亮色。
- #362（开）：39 个 Sandbox 成本用例的基线，多项未达目标（`git status` 热 18 倍、`find` 29 倍等）。
- #370（关）：脚本中断后 Workspace 一直挂着，占满 daemon 的 16 个名额后同一 Sandbox 的所有新挂载被拒；标题为「v1.0.1：自动卸载空闲 Workspace」，关闭但 #422 仍开。
- #372（关）：对文件或符号链接再往下写，被拒为 `Unknown` 且泄漏一个 Workspace，16 次后所有写入被拒 `Capacity`。
- #361（关）：FUSE 模式下写超过约 1 MiB、mmap 写与 fallocate 失败，导致 `cargo build` 失败（v0.1.6）。
- #364（关）：`node_modules` 的合并、relink Commit、FUSE 上的 pnpm 三处慢点。
- #368（关）：请求 macOS 支持，无评论。

## 12. 对 DreamCoder 的启示

### 可借鉴

- **文本三方行合并加「冲突写入 Workspace 标记、标记未清不得再 Commit」**：与 DreamCoder 的场景直接对应，lead 合并成员改动时，冲突留给持有文件的一方在原地解决，而不是在合并现场处理（`merge/text.rs:40-86`，`commit_merge.rs:57-82`）。git 本身也有同样的行级三方合并，这一点不依赖 LayerFS。
- **「只有 lead 发布、合并冲突归调用合并的人」的角色规则**：把「谁合并、谁负责冲突」写进规则，回答了 #162 里「lead 如何合并成员的 worktree」。预设里是提示词约定，DreamCoder 可以做成运行时检查（`presets/layerfs-dsh-minimalist.patch.yml:92-94`）。
- **`.lww` 加 `%include .gitignore`**：把被 git 忽略的生成物（依赖、构建输出、锁文件）与源码分开处理，前者取最新、后者必须冲突暴露。在 git worktree 方案里，这类文件根本不进合并，等价效果可以用 `.gitignore` 达到。
- **`publish` 不合并、只覆盖，合并要先显式做**：把「与主线同步」和「落地」拆成两步，先在新分支上合并并跑测试，再落地，值得照搬到 lead 的合入流程。
- **成员各占一个 Branch、同一 Branch 可多成员各挂一个 Workspace**：对应「每个成员一个独立工作目录」的需求（`presets/...:92`）。
- **每次写即检查点，加 blame 到调用级**：成员改了什么、是哪次工具调用改的，可回溯；Claude Code fork 已有工具调用记录，可以在 git 层模拟（每个成员分支每步提交）。

### 要避开

- **整棵树含 `.git` 与依赖一起捕获进私有 SQLite**：与用户真实 git 仓库没有同步、导出或写回（第 9 节），DreamCoder 用户要的是改动落在自己的仓库里，这是最大的鸿沟。
- **Disposable 档位、无崩溃持久性**：用户代码只存在于该 Store 中时，这是不可接受的。官方自己也建议不要当唯一副本。
- **靠提示词保证「mount → exec → commit → unmount」且无自动卸载**：脚本被打断就泄漏 Workspace 与容器（#422、#370）；DreamCoder 若用隔离，生命周期必须由运行时管理，而不是由模型自觉。
- **元数据密集命令的开销**：git status、find、pnpm 在 FUSE 上慢 1.3 到 39 倍（#362），对依赖这些命令的编码 agent 是实打实的体验成本，且是 v1.0.0 之前的 Docker Desktop 单样本。
- **与 Docker Desktop 绑定的 macOS 路线**：见下。

### 接入成本

- **macOS（主平台）**：没有原生路线。要用就得让用户装 Docker Desktop，并自行构建 Linux 版 daemon、addon 与运行时镜像，DreamCoder 的安装包要负责这些，同时 Mac 本机不跑任何 Store 调用，所有 SDK 调用都要经一个常驻 Linux 容器（`dsh/README.md:91-142,202`）。原生移植需要为 `layerfs-fuse` 另写 macFUSE（或 FSKit/NFS 回环）后端，并去掉 `kernel_guard` 对 Linux 内核的限定，且 SQLite 的 WAL 与 `flock` 协调假设（`kernel_guard.rs:1-9`）要重新验证；仓库没有这方面的 issue、计划或代码，只能自己做。
- **Windows**：要求用户自备 WSL2 发行版及其内部 Docker Engine、`/dev/fuse`、封装好的 bundle，并运行一个经认证的 loopback worker；仍在 main、不属 v1.0.0（`dsh/README.md:206-243`）。
- **Bash 工具**：dsh 的做法不改内置工具，而是删掉文件工具、让 Bash 里跑 SDK 脚本。在 Claude Code fork 里照做，等于删除 Read/Write/Edit/Grep/Glob 并改写系统提示，这会破坏 Claude 模型对这些工具的习惯用法；若要保留工具，需把它们的实现改为调用 `fs.*`，把 Bash 工具包成 `mount → exec → commit → unmount`，并保证异常路径下的卸载，同时让 `fs.*` 读与 Workspace 内未提交改动保持一致（目前 `fs.*` 读不到未提交改动，预设 `:59`）。
- **服务端与桌面端**：DreamCoder 需要一个宿主侧适配层，相当于 dsh 的 `layerfs-host`，负责环境变量、Docker 容器生命周期、Init 导入与进度、成果取回。成果取回目前没有 git 导出，要自己用 `fs.read`（仅文本）和 `exec` 实现。
- **整体判断**：即使 macOS 与 Windows 的障碍不存在，LayerFS 提供的收益（整树去重、依赖随挂载复用、每次调用一个检查点）对「teams 目前所有成员共用 lead 的目录」这一痛点来说，用 git worktree 加每成员独立的 `node_modules` 软链或共享缓存可以得到大部分，而不带任何平台前提。建议只当作设计参考，不作为依赖。

### 对应 #162 的开放问题

- **「lead 如何合并成员的 worktree，冲突时怎么办？」**：LayerFS 的答案是：每个成员一个 Branch，lead 用 `branch.merge` 逐个合进新 Branch（`.lww` 管生成物，源码按行三方合并），冲突则「什么都不创建」，lead 在两个输入 Branch 的工作 fork 上写同一份人工合并结果后重试（`conflicts.md:154-197`）；成员自己在共享 Branch 上 Commit 时冲突则在其 Workspace 里写标记，由该成员解决（`81-compare-and-merge.md:254-262`）。对比 git worktree：成员各一个分支，lead `git merge` 得到带标记的工作区，由 lead 或指派的成员解决，没有「冲突时不创建」的原子性，但天然在用户的真实仓库里。LayerFS 的可取之处是把「谁是冲突的负责人」写成规则，不是机制。
- **「第一版只做进程内，还是一开始就含进程成员？」**：本项目无直接证据；它的隔离是文件系统级，与成员是否在同一进程无关，所以不构成选择进程内或进程成员的依据。
- **「空闲的进程成员是否卸载并恢复？」**：LayerFS 的 Workspace 本身是临时的，Sandbox 空闲 2 分钟自行退出（`sdk/js/README.md:101-110`），但「挂载中的 Workspace 阻止其退出」带来泄漏（#422），说明卸载/恢复必须由运行时负责。
- **「预算与成本模型」**：不适用，LayerFS 不涉及模型调用成本；其 Store 空间无回收（#411）。
