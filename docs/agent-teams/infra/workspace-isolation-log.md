# 成员工作区隔离：探索记录

| 项 | 内容 |
| --- | --- |
| 状态 | 探索中的临时记录；结论稳定后并入 [workspace-isolation.md](workspace-isolation.md) 与 [#166](https://github.com/GoDiao/dreamcoder/issues/166) |
| 关联 | [#166](https://github.com/GoDiao/dreamcoder/issues/166)、[#162](https://github.com/GoDiao/dreamcoder/issues/162) |
| 依据 | 与维护者、AT 负责人的讨论（2026-10-23）；fork 源码 `@d091249`；第 3 节实测 |

第 1 节记维护者已经确认的事，第 2 节记倾向但未定稿的判断，第 3 节是读代码发现的问题，第 4、5 节是实验，第 6 节是方案对比。

## 1. 已确认

2026-10-23，维护者确认：

- **会话级 worktree 不等于成员隔离。** 新建会话时可选的 worktree（`src/server/services/repositoryLaunchService.ts:440`）隔开的是会话与会话。同一团队里，lead 和所有同进程队友共用这一个目录，成员之间没有隔离。
- **成员分两种。** 会话级成员是一个完整会话，可以有自己的 worktree；同进程成员跑在 lead 的进程里，目前没有自己的目录。
- **交付统一走合并层。** 成熟后，两种成员都通过 DreamCoder 的合并层把成果交回，不走 git 分支或 PR。过渡期会话级成员可以先走 git。
- **第一版只有一个出口：合回 lead 的目录。** 「导出成分支、开 PR」暂不考虑。

## 2. 倾向，未定稿

### 2.1 边界

| 归 #166（机制） | 归 agent teams（策略） |
| --- | --- |
| 提供者接口：创建、列出改动、读基线、重新接上、丢弃、能力声明 | 何时合并、合并顺序 |
| 合并接口，保证原子（整批写入或不写）、串行（同一时间只有一次合并写主目录）、可撤销 | 冲突交给谁、怎么唤醒成员 |
| 预演：不写主目录，只报告会不会冲突 | lead 审阅、批准或打回 |
| 写入前比对主目录是否在预演后又变了，变了就拒绝或重新预演 | 何时让成员同步主目录 |
| 反向同步：把主目录的新改动合进成员副本 | 桌面端界面 |
| 重命名、删除、二进制、权限位的处理规则 | |

撤销放在机制侧，因为只有合并层知道自己写了哪些文件、写之前是什么内容。交给上层用 `git checkout` 撤销，会把 lead 没提交的改动一起冲掉。

预演、写入前比对、反向同步三项由 AT 负责人提出。

### 2.2 合并引擎：私有 git

不自己写比较和合并算法。每个团队一个与用户 `.git` 分开的私有 git 仓库（下称影子库），只做算法：

- 把目录存成一棵树（快照）
- 比较两棵树，得到改动列表，含重命名
- 三方合并（`git merge-tree --write-tree`，需 git 2.38 起）

编排由我们写：何时存快照、拿哪几棵树合并、把结果写回真实目录、加锁、写入前比对、写入日志与回滚、副本状态记在服务端。

参照：调研中没有找到用影子 git 做多成员合并的产品；Cline、Gemini CLI、Entire CLI 只用它做单 agent 的检查点（[landscape-workspace.md](landscape-workspace.md) 第 4 节）。

要防的问题（AT 负责人整理，尚未逐条验证）：

- 不设 `GIT_DIR`、`GIT_WORK_TREE`、`GIT_INDEX_FILE` 等全局环境变量，每次调用显式传入，否则成员在 Bash 里跑的 git 会打到影子库或用户库。
- 影子库放在成员副本之外，成员看不到。
- 树里排除用户的 `.git`、子模块、嵌套 `.git`，并按 `.gitignore` 过滤。
- `core.autocrlf`、`core.filemode`、`core.symlinks` 与用户仓库一致，否则 Windows 上会出现假改动。
- 写回主目录不是原子的，要记录本次写了哪些文件，失败时按记录回滚。
- 每个团队的影子库要有清理时机。

### 2.3 成员用 git

不拦 git。改动列表比的是基线和成员目录的当前文件，成员提交与否结果相同，提交不算交付。

要防的只有 git worktree 提供者：worktree 与用户仓库共用 `.git`，成员删分支、改 remote、改 config、跑 gc 会动到用户仓库。第一版用提示词约束，加上把这几类命令设为需要权限确认，并在能力声明里写明「共用用户仓库」。APFS 克隆的 `.git` 是独立副本，没有这个问题。

### 2.4 隔离按成员可选，EnterWorktree 改为只作用于调用者

- **隔离按成员可选。** 只读的成员（审阅、调研）不需要自己的目录，只改少量不相干文件的成员共用目录也可以。派生成员时可选「共用」或「隔离」，不强制。
- **删掉 EnterWorktree 隔不掉。** 队友可以在 Bash 里自己 `git worktree add`，不改进程全局目录，对别人无害。限制是：每条 Bash 命令都要先 `cd` 过去（队友的 `cd` 不保留，`src/tools/BashTool/BashTool.tsx:643`）；文件工具全靠绝对路径，写错就写回主目录；建在项目目录外会触发权限请求（#164 下会挂住）；成果只能走 git 分支；UI 看不到。
- **问题在于 EnterWorktree 改的是全局目录。** 两种修法：
  - 止血：从队友的工具名单去掉它。归 Dev-Lead。
  - 并入 #166：EnterWorktree 识别出调用者是队友时，只改该队友自己的目录覆盖，不碰全局。队友由此有一个正规的自助隔离入口。
- **成员在哪个目录工作要显示给用户。** 已有的链路：
  - team 文件的成员记录有 `cwd` 与 `worktreePath`（`src/utils/swarm/teamHelpers.ts:84`），派生时不写 `worktreePath`，`cwd` 一律是 lead 的目录（`src/tools/shared/spawnMultiAgent.ts:948,970,989`）。
  - 服务端读 team 文件的类型含 `worktreePath`（`src/server/services/teamService.ts:58`），转成返回给桌面端的成员数据时丢掉了，只留 `cwd`（`src/server/services/teamService.ts:113-124`）。
  - 桌面端 `desktop/src/stores/teamStore.ts` 不使用成员目录。

  要补：提供者每次创建副本（无论是成员调用 EnterWorktree，还是派生时分配）都写一条记录，含目录与分支；服务端带出这些字段；成员卡片显示「在哪个目录、哪个分支」。team 文件作为过渡，最终进服务端会话状态。

### 2.5 排期建议

1. agent teams 先理顺：#163、#164、中止 lead 删团队、禁用队友的 EnterWorktree，跑通同进程成员。
2. 同时，#166 把提供者和合并层做成独立模块。第一个接入方是普通子 agent（`src/tools/AgentTool/AgentTool.tsx:590-641` 已有 `isolation: worktree` 和 `runWithCwdOverride`），替换行为放在开关后面。另写一组不依赖 AgentTool 的接口测试，覆盖多份副本交替合并、冲突往返、重启后重新接上、主目录中途变化。
3. 第 1 步稳定后接同进程成员。
4. 「会话作为成员」做出来后接会话级成员。

## 3. 读代码发现的问题

`@d091249`，只读，未在运行中的应用里复现。

- **EnterWorktree 会挪走整个团队。** 它在异步 agent 允许的工具名单里（`src/constants/tools.ts:69`），worktree 模式写死开启（`src/utils/worktreeModeEnabled.ts:10`），队友可以调用。它调用 `setCwd` 与 `setOriginalCwd`（`src/tools/EnterWorktreeTool/EnterWorktreeTool.ts:95-96`），改的是进程全局目录；同进程队友没有目录覆盖，会和 lead 一起被挪进去，权限白名单的依据也跟着变。止血修复归 Dev-Lead 排期，未开 issue；长期修法见 2.4。
- **中止 lead 会删除团队目录。** `cleanupTeamDirectories` 会强制删除成员的 `worktreePath`（`src/utils/swarm/teamHelpers.ts:532-588,681`）。接上隔离后会变成丢失成员成果，因此副本生命周期要由服务端管理。未开 issue。
- **`getOriginalCwd()` 被 53 个文件直接使用。** 包括权限工作目录（`src/utils/permissions/filesystem.ts:705-710`）、skills、临时目录、Bash 出错后重置目录。同进程成员第一版可能只做到部分隔离，能力声明要能表达这一点。

## 4. 实验 1：扫描与比较耗时

2026-10-23。问题：每次合并前扫描目录、和基线比较，在本仓库上要多久。

### 4.1 方法

- 环境：Apple M1 Pro，APFS，git 2.54.0（Apple Git-157）。
- 对象：主仓库 `main` 分支的干净检出。用一次 `clonefile(2)` 克隆整个目录作为 lead 的目录，再克隆一份作为成员副本；主仓库与其 `.git` 只读。
- 影子库为临时目录里的裸仓库，复制用户仓库的 `.git/info/exclude`，每次调用传 `--git-dir`、`--work-tree` 与单独的 `GIT_INDEX_FILE`。
- 成员改动：改 5 个文件、新增 2 个、删除 1 个、重命名 1 个，另在 `node_modules` 下写 1 个被忽略的文件。lead 改动：改 3 个文件，其中 1 个与成员改到同一处。
- 同一流程跑了三遍，前两遍分别在最后的 `git status` 参照和三方合并处因脚本错误中止，前面的数据保留；alternates 单独跑了两遍。表中给出范围。没有清空系统文件缓存（需要 sudo），表中「新建」指索引或对象库是新的，不代表磁盘是冷的。
- 脚本：[experiments/scan-benchmark/](experiments/scan-benchmark/)，运行 `bash scan.sh <源目录> <临时目录>`，结束后手动删除 `<临时目录>/lab`。

### 4.2 结果

| 环节 | 耗时与占用 |
| --- | --- |
| 克隆整个项目目录（含 6.9 GB Rust 构建产物、两份 `node_modules`、3 个嵌套 worktree） | 8.2–9.0 秒，额外占用约 0.1 GB（`df`） |
| 按 `.gitignore` 过滤后进树的文件数 | 2,941 |
| 存基线，影子库从零开始 | 4.2–6.4 秒，影子库 27 MB |
| 存基线，影子库用 alternates 引用用户仓库的对象 | 0.66–1.2 秒，影子库 172 KB |
| 无改动时再存一次 | 0.13–0.25 秒 |
| 成员副本存树，新建索引 | 1.3–2.0 秒 |
| 成员副本存树，复用基线索引，默认比较方式 | 0.76–0.92 秒 |
| 成员副本存树，复用基线索引，`core.checkStat=minimal`、`core.trustctime=false` | 0.14–0.19 秒 |
| 比较基线与成员（`diff-tree -r -M`） | 52–79 毫秒；重命名识别为 `R100`；`node_modules` 下的文件未报告 |
| 三方合并（`merge-tree --write-tree`） | 57 毫秒；文件开头与结尾各改一处的自动合并；两侧都在同一文件末尾追加的判为冲突 |
| 参照：在克隆目录里直接跑 `git status`，第一次 / 第二次 | 0.45–0.69 秒 / 0.09–0.14 秒 |

### 4.3 结论

- 在本仓库上，扫描加比较不是瓶颈。索引暖了以后，每次合并前的扫描与比较在 0.1–0.3 秒，合并本身不到 0.1 秒。
- 慢的是每个目录第一次存树，主要花在哈希和压缩写入对象上。alternates 把它缩短约 5 倍、影子库缩小约 150 倍，但用户仓库 gc 后影子库会损坏（5.4 节）。
- 克隆出的文件 inode 与 ctime 都变了，git 默认会全部重新哈希。`clonefile` 保留修改时间与大小，所以成员副本应复用基线索引，并让 git 只比较修改时间与大小。
- 克隆整个项目目录要 9 秒左右，此前 1.7 秒的数据只克隆了 `node_modules`。

## 5. 实验 2：准备耗时、增量编译与 alternates

2026-10-23。问题：基线 1 与方案 A、C 各要多久才能跑测试、编出桌面端；克隆耗时花在哪；克隆过去的 `target` 能否增量复用；alternates 能否抵御用户仓库的 gc。

### 5.1 方法

- 环境同第 4 节；bun 1.4.2，cargo 1.99.0。源为主仓库 `main` 分支 `6f07ea9` 的干净检出，只读。
- 所有 worktree 都从源的克隆里执行 `git worktree add --detach`，用的是克隆自己的 `.git`，不写源仓库。
- 「能跑测试」指 `bun test src/server/__tests__/session-state.test.ts` 通过（24 个用例）；「能编出桌面端」指 `desktop/` 下 `bun run build`、`bun run build:sidecars` 后，`desktop/src-tauri` 下 `cargo build`（dev 配置）完成。
- bun 与 cargo 的全局缓存是暖的：本机此前装过同一锁文件的依赖、编过同一组 crate。冷缓存（需要联网下载）的情形没测。
- 每项只跑一遍。磁盘为 `df` 前后差值。
- 脚本：[experiments/prep-benchmark/](experiments/prep-benchmark/)，运行 `bash run.sh <源目录> <临时目录>`，需要 bun、cargo 在 `PATH` 上，结束后手动删除 `<临时目录>`。

### 5.2 克隆耗时拆分

逐个克隆，单独计时：

| 部分 | 耗时 |
| --- | --- |
| `.claude/worktrees`（3 个嵌套 worktree） | 4.9 秒 |
| 根目录 `node_modules` | 2.5 秒 |
| `desktop/node_modules` | 1.3 秒 |
| `desktop/src-tauri/target`（6.9 GB） | 1.2 秒 |
| `.git` | 0.2 秒 |
| 其余（源码等） | 0.4 秒 |

`target` 体积最大但文件数少，克隆快；最慢的是嵌套 worktree，它对成员没有用处。

### 5.3 各方案的准备耗时

| 方案 | 到能跑测试 | 到能编出桌面端 | 额外磁盘 |
| --- | --- | --- | --- |
| 基线 1：worktree，成员自己装依赖、编译 | 2.9 秒（`git worktree add` 0.9 + `bun install` 根目录 1.2、`desktop` 0.8） | 92 秒（另加 vite 4.6、sidecar 2.0、`cargo build` 冷编译 83 秒，356 个 crate） | 装依赖后 76 MB；编译后再加 2.5 GB |
| A：worktree，克隆两份 `node_modules` 进去 | 4.2 秒（`git worktree add` 0.9 + 克隆 3.3） | 未测；Rust 部分与基线 1 相同，是冷编译 | 69 MB |
| C：按需克隆，不带 `target` | 2.4 秒 | 未测；Rust 部分是冷编译 | 21 MB |
| C：按需克隆，带 `target` | 3.2 秒 | 35 秒（`desktop/dist` 与 sidecar 随克隆带过去，`cargo build` 32 秒，只重编 `dreamcoder-desktop` 1 个 crate） | 35 MB；编译后再加 0.9 GB |

再跑一次 `cargo build`：4.5 秒。在方案 A 的目录里执行 `bun install --frozen-lockfile`：0.16 秒，说明克隆来的 `node_modules` 被 bun 认作完整。

### 5.4 alternates 与 gc

在一个克隆仓库里新建分支并提交一个新文件；影子库通过 alternates 引用该仓库的对象，存下包含这个文件的树。此时影子库自己的对象库里没有这个文件的对象，读取靠 alternates。然后在仓库里删掉分支，执行 `git reflog expire --expire=now --all` 与 `git gc --prune=now`。

结果：gc 之后影子库读不到这个对象，`fsck` 报错，基线树损坏。用户只要做「删分支、改写历史，再 gc」，影子库就会坏。

### 5.5 结论

- **在本机、bun 缓存暖的情况下，装 JS 依赖不是瓶颈。** 两次 `bun install` 共 2 秒，比把 `node_modules` 克隆进去（3.3 秒）还快：bun 在 macOS 上本来就从全局缓存克隆文件。方案 A 在这里没有优势。缓存冷、要联网时会慢得多，npm、pnpm 项目也不同，都没测。
- **真正的收益在 Rust 构建产物。** 带 `target` 克隆后，cargo 复用了 355 个依赖 crate 的产物，只重编项目自己的 crate（路径变了），从 92 秒降到 35 秒，磁盘多占 0.9 GB 而不是 2.5 GB。这回答了 #166 的开放问题：克隆后会重编，但只重编自己的 crate。
- **按需克隆必须跳过嵌套 worktree**，它占整目录克隆耗时的一半左右。
- **alternates 不能直接用。** 要么影子库自己存所有对象（第 4 节：首次 4–6 秒、27 MB），要么用 alternates 之后再把借来的对象复制进影子库再断开引用（做法与代价未测）。

## 6. 对比方案与基线

### 6.1 基线

- **基线 0：现状，共用 lead 的目录。** 正确性基线：准备时间与额外磁盘为零，成员之间没有隔离，代价体现为互相覆盖，不体现为耗时。不需要测。
- **基线 1：普通 git worktree。** 性能基线，即 Claude Code 现在给子 agent 开隔离的做法（`src/utils/worktree.ts:935`）：`git worktree add`，按 `.worktreeinclude` 复制文件，依赖与编译由成员自己完成。也是全平台兜底实现。

### 6.2 候选方案

| 方案 | 成员目录怎么来 |
| --- | --- |
| A. worktree，依赖由提供者补齐 | `git worktree add`，再把 `node_modules` 克隆进去 |
| B. APFS 克隆整个目录 | 对项目目录调用一次 `clonefile` |
| C. APFS 按需克隆 | 只克隆源码与 `node_modules`，跳过嵌套 worktree，`target` 可选 |

### 6.3 指标

1. 从创建到能跑 `bun test`。
2. 从创建到能编出桌面端（Rust 是冷编译还是增量复用）。
3. 额外磁盘（`df`）。
4. 合并前扫描加比较的耗时。
5. 成员日常操作速度（各方案都是原生目录，预计无差别，抽查即可）。
6. 隔离完整度：`.git` 是否与用户共用，依赖目录是否隔离。

### 6.4 已有数据

- 方案 B：克隆耗时与磁盘（第 4 节），耗时拆分见 5.2。
- 基线 1、方案 A、方案 C 的指标 1、3：5.3；指标 2 只有基线 1 与「C 带 `target`」。
- 指标 4：第 4 节，测于方案 B 的克隆目录。
- 指标 5、6：无实测。

### 6.5 LayerFS 参照

LayerFS 不作基线，作参照列：它在 macOS 上运行于 Docker 的 Linux 虚拟机里，成员命令在容器中执行，比较维度多出「日常操作慢多少」与「是否需要 Docker」。

下表数据来自 LayerFS 官方，v1.0.0 之前，Docker Desktop on macOS，多为单组样本（[layerfs.md](layerfs.md) 第 7 节），不是本机实测：

| 项 | 官方数据 |
| --- | --- |
| 挂载一个 Workspace | 约 10 毫秒，依赖随挂载可用 |
| 一个文件的 Commit | 约 8 毫秒 |
| 存储 | 157 个快照（4.94 GB 树）存为 100.1 MB |
| `git status` | 冷 4.5 倍、热 18 倍于原生 |
| `find` / `grep -r`（冷） | 29 倍 / 36 倍于原生 |
| `pnpm install`（首次） | 2.6 倍于原生 |
| `tsc -b`（热）/ `vitest`（冷） | 1.3 倍 / 1.4 倍于原生 |

本机实测的前提与代价：本机的 docker 来自 Rancher Desktop，不是文档所写的 Docker Desktop，容器能否使用 FUSE 未核实；LayerFS 无发布包，原生组件与镜像要在 `rust:1.85.1-bookworm` 容器里从源码构建，需拉取数 GB 镜像，属于机器级改动；Node 版本满足（要求 22.19 起，本机有 22.23 与 24）。

**待验证的假设：** 在 macOS 上、成员数量少且频繁 grep 与构建的场景下，原生目录加事后扫描的总耗时短于 LayerFS，因为 LayerFS 在准备阶段省下的几秒会被每一轮操作的倍数开销抵消。依据只有上表的官方数据，没有同机、同任务的端到端对比。该假设只针对 macOS；Linux 上 LayerFS 为原生 FUSE，结论可能相反。LayerFS 另有每次写可回退、历史可分叉、跨机共享等我们没有的能力，比较时不能只看耗时与磁盘。

## 7. 待测

- 冷缓存下的基线 1：清空或换用独立的 bun、cargo 缓存后重测装依赖与编译（会联网下载）。
- 其他包管理器（npm、pnpm）项目上，克隆 `node_modules` 相对重新安装的收益。
- alternates 的补救：引用之后把借来的对象复制进影子库再断开，耗时与磁盘多少。
- 与 LayerFS 的端到端对比：同一仓库、同一组成员任务（改代码、跑测试、合并），记录总耗时与磁盘。需要先在本机装 LayerFS。
- 文件数更多的仓库（10 万级）上的首次存树与扫描耗时。
