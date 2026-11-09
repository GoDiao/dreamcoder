# kander：文件冲突感知调度与两阶段评审（研究记录）

范围：只回答"README 说的 conflict-aware scheduling 到底怎么做"，并简述数据模型、评审、角色、run。路径均相对 `refs/agent-kanban/kander`，commit `285fb4f2994a2dc6e10dff589179fa8a6ead4cb6`。

## 1. 身份

- URL：https://github.com/dualface/kander
- license：MIT（`LICENSE:1`，已确认）
- 技术栈：Go（`go.mod`），终端 TUI 看板；另有 Node 集成 `integrations/kander-dsh`。
- 存储：文件系统。卡片是 `kanban/<状态目录>/<task-id>/spec.md`（`docs/card-transactions.md` 不变量 1、3）。控制文件在 `kanban/.kander/`：`locks/`、`versions/<task-id>.json`、`operations/pending|committed/`（同文档第 2 节）。无数据库。
- 它不是调度器进程。看板只做存储与状态检查；"调度"由一个 agent 会话（orchestrator / coordinator）按规则文本（`rules/*.md`）执行。

## 2. 核心问题：文件重叠怎么处理

README 原文（`README.md` Key Features）："Static analysis of Git branch overlaps and file modification boundaries ensures controlled concurrency without write conflicts."

实际上有两件互相独立的事，都不在 Go 调度代码里：

### 2.1 卡片间的文件范围（建卡时，预测，agent 写，纯文本）

- 文件集合来自**事前预测**，由**规划卡片的 agent**写出，再由人在计划里确认。
- 规则原文：建组时"List for every member the paths it is expected to change (directories are acceptable)"，两个成员共享路径则视为顺序依赖，不并行（`rules/KANDER-TASK-GROUP-RULES.md:31`）。
- 单卡场景：出计划前，把"计划要改的路径"与 `working/`、`review/` 里每张卡及每个打开的组分支已改的文件比较，`git diff --name-only $(git merge-base <branch> develop) <branch>`；有重叠就不规划并行，新卡通过 `PREREQUISITES` 排在后面（`rules/KANDER-TASK-INTAKE-RULES.md:21`）。
- 粒度：文件路径，允许目录。规则明说"按文件隔离，而不是按模块名"（`rules/KANDER-TASK-GROUP-RULES.md:50`）。不涉及 glob、符号、函数。
- 热点文件（生成代码、lock 文件、IDE 工程文件、共享契约/schema、各语言字符串表）一律算重叠，即使改的区域不同；只能分给一个成员，或串行（`KANDER-TASK-GROUP-RULES.md:51`，INTAKE:21）。
- 这些预测路径**没有结构化字段**。卡片字段只有 `TYPE/SIZE/TASK_GROUP/LANGUAGE/OWNER/SESSION/WINDOW/TASK_BRANCH/RESULT` 等（`internal/board/schema.go:13-25`）和 `GOAL/EXPECTED_OUTCOME/ACCEPTANCE_CRITERIA/OUT_OF_SCOPE/DISCUSSION/...` 等段落（`schema.go:27-37`）。预期路径写在自由文本里（`DISCUSSION` 或计划），Go 代码不解析它。检索 `expected.*path`、`name-only` 等，Go 源里没有对应的卡片路径解析。
- 发现重叠后的动作：**串行化**。写成 `PREREQUISITES: <id>,<id>`（`KANDER-TASK-GROUP-RULES.md:36-39`），或把新卡放进后继组。依赖满足条件：组内前置卡到 `review/` 或 `done/` 且其交付提交已在组分支上；组外前置卡到 `done/` 且已包含在 `develop`（同文件 43-44 行）。
- 依赖图的校验在 Go 里：`internal/board/deps.go` 的 `TaskDependenciesOf` 解析并展开 `PREREQUISITES`，检查缺失引用与环，只在 `kander check` 中使用（`deps.go:186,340`）。在 `internal/launch` 里没有检索到用它拦截 `kander start` 的调用 [未核实：未逐行读完 launch]。"并行启动哪些卡"由 orchestrator agent 判断（`rules/snippets/orchestrate-start.md` "Starting Ready Cards"：同时就绪且无文件级资源冲突的才并行）。
- `orchestrate-start.md` 提到 "resource conflicts that cannot be isolated block the affected cards"，但 `kander check` 的 Go 实现里没有对应的资源冲突检测（检索 `overlap`/`conflict` 只命中下述 2.2 与无关的 Windows overlapped IO）。该句是给 agent 的指令，不是程序检查。

### 2.2 分支间的实测重叠（运行中，从 git 测量，程序算）

- 命令：`kander check overlap --source <ref> [--head <ref>] [--json]`（`docs/check-command.md` "Overlap"；`rules/snippets/commands/check.md:14,21`）。
- 算法（`internal/check/overlap.go:8-54`）：解析 head 与 source → 取 merge base → 分别 `git diff --name-status -z --find-copies-harder`（`internal/check/git.go:202`）得到两侧改动 → 取路径交集（`intersectPaths`，`overlap.go:56-78`）。重命名/复制把旧路径和新路径都计入。
- 粒度：精确的文件路径字节串比较。不看目录、glob、行区间、符号。
- 来源是**事后测量**（git diff），不是预测。比较的是"任务分支自分叉以来改了什么"与"源分支（`develop` 或组分支）自分叉以来改了什么"。它不比较两张并行卡。
- 状态：`pass`（无交集）、`action-required`（有交集）、`error`；退出码 0/1/2/3（`docs/check-command.md`；`check.md:40`）。
- 何时运行：规则要求执行 agent 在"每个自然停顿"运行：开始一个工作项前、完成后、请求评审前、交付前，先 `git fetch`（`rules/snippets/git-sync.md:7-12`）。orchestrator 还在评审计划创建前，用组分支作 HEAD、`develop` 作 SOURCE 跑一次，有交集则必须同步（`orchestrate-start.md:70`）。这些时点由 agent 遵守规则，不由程序触发。
- 有交集时的动作：**rebase**，且尽早（`git-sync.md:14`）：`action-required` 时立刻 rebase 到最新源分支，"趁上游改动还小"。无交集也要在下一次交付前 rebase。不等待、不阻塞、不警告用户。退出码 2/3 不得当作"无交集"。评审批次打开期间禁止 rebase（`git-sync.md:15`）。
- 重叠检查器是只读的、无看板依赖的（`check.md:34`）。

### 2.3 预测错了会怎样

- 没有程序层面的"预测 vs 实测"对账。预测路径不是结构化数据，也不会与实际 diff 比较。
- 预测漏了，两张并行卡改了同一文件：靠 2.2 在各自分支与 `develop`/组分支之间发现；发现时是 rebase，冲突在 rebase 时由执行 agent 解决（`git-sync.md:16` 要求冲突解决后重跑相关测试）。组内成员交付到组分支时还要 "rebase, re-verify"（`orchestrate-start.md` 执行 agent 职责）。
- 评审阶段还有一层：`kander review` 把每个评审 run 绑定到 `base` 与 `commit` 范围，列出 FILE LEDGER（`internal/review/git.go:92`，`git diff --name-status base..commit`）。这是评审用的文件清单，不用于调度。
- 作者自己的复盘把这套机制称为"strongly supported"，并说明依据是真实项目里的热点（`docs/KANDER_PRODUCTION_RETROSPECTIVE_FULL_EN.md` 13.4、第 9 节）。该文列为设计理由，不是实现。

### 2.4 小结表

| 问题 | 答案 |
| --- | --- |
| 文件集合来源 | 两处：卡片间=规划 agent 事前预测（自由文本）；分支间=git diff 实测（程序） |
| 谁声明 | 规划 agent 写预期路径，人在计划里确认；执行 agent 不声明 |
| 粒度 | 文件路径（可写目录）；热点文件按整文件算 |
| 重叠怎么算 | 预测：agent 比较；实测：`check overlap` 路径集合交集 |
| 重叠时 | 预测阶段串行（PREREQUISITES）；实测阶段 rebase |
| 何时检查 | 计划前、各工作项前后、评审前、交付前、组评审计划前；均由 agent 依规则触发 |
| 预测错了 | 无自动对账；靠实测 overlap + rebase + 重测发现和修复 |

## 3. 两阶段独立评审

- 阶段：`PMQA`（阶段一，合同符合性 + 架构/正确性/回归/测试/代码质量）与 `Security`（阶段二，PMQA 通过后）；`rules/KANDER-REVIEW-RULES.md:37,39,86-96`。历史上有 PM/QA/CSA/Hacker 四角色与六键形式，读取时仍兼容（同文件 46 行）。
- 是否运行：配置 `review_stages`，按任务规模 `large|small` 与角色给出 `auto|skip|required`，默认 `auto`（`internal/config/review_stages.go:5-17`；规则 `KANDER-REVIEW-RULES.md:160-179`）。
- 评审者是谁：配置 `reviewers[scale][role] = agent 名`，缺省回落到默认 agent（`internal/config/reviewers.go` `ReviewerFor`）。选择优先级：用户当前指令 > 项目 AGENTS.md/CLAUDE.md > 用户全局规则 > 配置（`KANDER-REVIEW-RULES.md:30`）。卡上还可固定 `REVIEW_<ROLE>_AGENT/_MODEL/_EFFORT`（同文件 31 行）。
- 独立性的实现：
  - 评审是独立进程，由 `kander review` 启动，不是执行会话自己评审（`docs/review-runtime-isolation.md` "Reviewer Entry"）。
  - 只读靠各 agent 的沙箱或工具白名单；Codex 沙箱强制只读，Grok/Kimi 限定读搜索工具，Claude 去掉 Edit/Write，Cursor/Pi/Devin 只靠提示加运行后 worktree 校验（同文档 "Per-Reviewer Posture"）。运行后检查只看 git 可见状态，看不到 worktree 外或被忽略路径的写入。
  - 评审 run 存放在私有运行时目录，提示词文件与 `review-contract.md` 受保护；退出后强制回收进程组。
  - 未发现强制"评审者必须不同于执行者"的程序检查（检索 `reviewer`/`owner` 对比未命中）[未核实]。独立性主要来自：独立进程 + 只读 + 默认可按角色配置不同 agent。
- 存储：每张被评卡保留 `reviews/<run_id>/` 不可变原件（输入、原始输出、日志、报告、`process-evidence.json`、sidecar、manifest），并在 `REVIEWS` 中追加一行 JSON 索引（`KANDER-REVIEW-RULES.md:149`）。结构体：`ReviewInput`（run_id、batch_id、role、reviewer、model、base、commit、input_hashes…，`internal/board/reviews.go:29-52`）、`ReviewBatch`（requirements 为 role→`required`/`N/A: 原因`，`reviews.go:62-75`）、`ReviewIndex`（`reviews.go:77`）、`ReviewManifest`、`ReviewPlan`（先冻结计划再评审，`review_plan.go:22`）、`ReviewDisposition`（对每条 finding 的处置，作者、状态、修复提交，`review_disposition.go:30-52`）。
- 强制：移动卡片到 `done` 时，事务内调用 `validateTaskReview(tx, id, true)`，缺评审计划或批次未关闭则失败（`internal/board/snapshot.go:200-203`，`review_gate.go:50-75,309-321`）。所以评审门槛在程序里强制，而不只是规则文本。
- 发现的处理：finding 要有作者处置才能关闭批次；安全 finding 中 blocking/high/medium 交给用户决定，medium 有 15 分钟超时（`KANDER-REVIEW-RULES.md:123-124`）。
- 评审的文件清单（FILE LEDGER）是评审输入的一部分，见 2.3。

## 4. 卡片与 run 数据模型（简述）

对应 brief 第 2、3、6、7 节。

### 实体与关系（第 2 节）
- 卡片：目录 + `spec.md`，字段是 `- NAME: value` 形式的文本行（`schema.go:RenderField`），非数据库列。task_id 是身份；路径只是查找结果（`card-transactions.md` 开头）。
- 小卡与大卡：`SIZE: small|large`；大卡另有 `plan.md`、`report.md`（`docs/directory-cards.md`）。
- 组：`TASK_GROUP` 字段（`YYYYMMDD-slug-group`）；组不是独立实体，"adds no board entry or state"（`KANDER-TASK-GROUP-RULES.md:28`）。
- 依赖：`DISCUSSION` 开头代码块中的 `PREREQUISITES: id,id`；可混用卡 ID 与组 ID（组引用展开为全部成员）。无关联表。

### 状态（第 3 节）
- 7 个状态：`backlog, todo, working, review, done, archived, trash`（`internal/board/board.go:21`）。
- 状态存在**卡片所在目录**，没有状态字段（`card-transactions.md` 不变量 3）。
- 流转检查：`validateTarget`（`snapshot.go:197`）；进 `todo` 需 GOAL/EXPECTED_OUTCOME/ACCEPTANCE_CRITERIA/OUT_OF_SCOPE 完整、无 `<FILL_IN>`、有 `SELF_REVIEW:`/`CARD_REVIEW:`（`KANDER-KANBAN-RULES.md:110`）；进 `done` 需评审门槛；`archived` 终态，无出边（不变量 6）。
- 契约冻结：进 `todo` 后 GOAL、EXPECTED_OUTCOME、ACCEPTANCE_CRITERIA、OUT_OF_SCOPE、SIZE、组关系冻结，改动需显式用户决策（`KANDER-KANBAN-RULES.md:195`；不变量 4）。

### 角色与权限（第 6 节）
- 负责人：`OWNER` 单值，另有 `SESSION`、`WINDOW`（`schema.go:18-21`）。
- 角色是运行时的会话角色（执行 agent、orchestrator/coordinator、评审者），不存在卡片字段里；人与 agent 的区分靠规则与用户决策引用（如 `--decision <decision-ref>`）。
- 没有 per-card 权限矩阵。写保护靠受控事务：`kander update --expect-revision`、`kander move`；加 `kander guard-write` 作为编辑工具前置钩子，只防误写，不是安全边界（`docs/kanban-write-guard.md`）。

### 任务与执行（第 7 节）
- 一张卡同时只有一个执行记录：`OWNER/SESSION/WINDOW` 写入卡片；`ExecutionFence{RecordID, Cycle}` 让被 takeover/reclaim 取代的启动器失效（`internal/board/execution_entry.go:20-26`）。接管用 `TakeoverInput`。
- 派发（给执行会话发 fix/sync/wrap-up 消息）有独立持久记录：`Dispatch{State, Attempts, Accepted, Completed, Authorization{DispatchID, Epoch}}`（`internal/board/dispatch.go:64-77`）。
- 执行结束后保留：卡片本体、`IMPLEMENTATION/SUMMARY`/`report.md`、`reviews/<run_id>/`、`dispatches/<id>/*.json`、事务日志。会话本身不是持久实体。

### 历史与并发（补充）
- 乐观锁：每次写入 `--expect-revision`，成功后 revision +1；`versions/<task-id>.json` 记录 `{revision, operation_id, contract_frozen}`。
- 两阶段提交 + 预写日志：`operations/pending/` → `committed/`；崩溃后恢复。锁层级 board.lock → group locks → task locks → journal.lock（`card-transactions.md` 第 2、3 节）。

## 5. 其他项目的做法

只检索了源码、迁移和文档，没有运行任何东西。

- vibe-kanban（commit `7c38070`）：记录的是**事后实测的统计**，不是文件列表。工作区有 `files_changed`、`lines_added`、`lines_removed` 三个可空整数（`crates/api-types/src/workspace.rs:16-18`），由 worktree diff 计算（`crates/server/src/routes/workspaces/workspace_summary.rs:176` 调用 `diff_stream::compute_diff_stats`）。没有预测文件、没有重叠检测。检索 overlap/conflict 的命中是 worktree 元数据重试和 HTTP 错误，与文件冲突无关。
- multica（commit `a7a61f1`）：只在 GitHub PR 表上存 `additions/deletions/changed_files` 三个整数，来自 webhook（`server/migrations/092_pr_stats.up.sql`，`216_vcs_integration.up.sql:61`）。是数量，不是路径。没有任务级文件范围与冲突检测。none found（路径级）。
- paperclip（commit `82c033e`）：交付物元数据里有 PR 和 commit 的 `additions/deletions/changedFiles` 数量（`packages/shared/src/types/work-product.ts:70-90`）。另有 execution workspace 相关表（`packages/db/src/schema/execution_workspaces.ts` 等，名称可见，内容 [未核实]）。没有预测文件列表，没有重叠检测。none found（路径级）。
- beads（commit `8373677`）：未找到任务记录所改文件的字段或文件重叠逻辑。检索命中只是 AGENTS.md 里的无关文字与测试名。none found。
- kanban-pro（commit `6942b8a`）：`SPEC.md` 明确说附件只存引用（PR、文档、图片 URL），"no file storage"（`SPEC.md:177`）。没有文件范围或重叠检测。none found。

## 6. 未核实与未读

- `internal/launch` 的 `start` 是否在 Go 里检查 `PREREQUISITES` 已满足：检索未发现调用，但没有逐文件读完。
- 评审者与执行者是否在程序里强制不同：检索未命中，未读 `internal/review` 全部实现。
- `check overlap` 对子模块、符号链接、大小写不敏感文件系统的行为：未读。
- 运行时的 TUI、herdr/tmux 终端层、GitHub issue 导入：未读（与本问题无关）。
- 作者复盘文档里的 2,477 卡、51% 等数字：只引用，未验证。
- paperclip 的 execution_workspace 表字段：只看到文件名。
