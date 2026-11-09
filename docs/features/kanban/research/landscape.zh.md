# Agent 看板：同类产品调研

日期：2026-11-03。调研对象：11 个仓库的源码，浅克隆在主工作区的 `refs/agent-kanban/` 下，只读，未运行；Linear、GitHub Copilot、OpenAI Symphony 的公开文档；另外 12 个候选只读了 README。

这份报告写在维护者做决定之前。第六节的方向草图和第七节的问题，后来的结论以 [PRD](../prd.zh.md) 为准。当时各仓库的分项报告没有保存下来；下文引用的路径都相对于对应仓库的克隆目录，可以在 `refs/agent-kanban/` 里核对。

## 一句话结论

这类产品分两派。**拉取派**：agent 自己来看板领任务，看板不负责启动 agent。**启动派**：看板为卡片启动 agent，并负责隔离和收尾。

决定好坏的不是看板 UI，而是三件事：

- 领取是否原子；
- 状态由谁说了算：运行时规则，还是模型自觉；
- "完成" 之前的评审关口是否由服务端强制。

调研里只有少数项目把这三件事做对了。

## 一、两派对比

| | 拉取派 | 启动派 |
|---|---|---|
| 代表 | graywrk/agent-kanban、LokalBoards、Kanbrawl、Beads、Backlog.md、Task Master、kanzo、kanban-pro、agent-task-board | vibe-kanban、Multica、Paperclip、kandev、kanbots、kander、Chorus |
| 谁启动 agent | 外部：人自己开终端，或别的工具 | 看板或它的 daemon |
| 隔离 | 不管 | 多数每卡一个 worktree（vibe-kanban、kandev、kanbots、kander；Multica 可选） |
| agent 怎么拿到任务 | MCP 工具，如 `get_next_task`、`claim_task` | 启动时由看板把卡片内容拼进提示词 |
| 崩溃恢复 | 需要租约、心跳、回收：看板不知道 agent 是否还活着 | 看板持有进程，进程退出即可知道 |

启动派里最出名的 vibe-kanban 已经宣布停运：`README.md:19` 写着 "Vibe Kanban is sunsetting"，看板页只显示 "Project functionality has been retired"（`packages/web-core/src/pages/kanban/ProjectSunsetPage.tsx:29`）。原因之一是它把卡片放在云端 Postgres，把运行数据放在本地 SQLite，云端产品一停，本地看板也就不能用了。

## 二、关键机制对比

| 项目 | 领取原子性 | 租约与崩溃恢复 | 状态机 | "完成" 关口 | 存储与实时 |
|---|---|---|---|---|---|
| graywrk/agent-kanban | 一条条件 UPDATE（`status='ready'`，`src/agent_kanban/services.py:161`） | 无，人工挪回 | 无，任意改 | 只有提示词约定 | Postgres；WebSocket |
| LokalBoards | 事务里 `SELECT … FOR UPDATE` 锁卡片行（`server/utils/cardAssignees.ts:174-204`）；但 REST 改负责人时绕过它 | 无 | 无，只有 done 标志 | 无 | MySQL；socket.io |
| Kanbrawl | 无 | 无 | 无 | 无 | 单个 JSON 文件整体重写，多进程会互相覆盖；SSE |
| Beads | 一个事务内比较并交换 | 5 分钟租约（`internal/storage/issueops/lease.go:28`）、`bd heartbeat`、`bd reclaim` | 有 | 只有负责人能关（`--force` 例外） | Dolt 库，放在仓库旁 |
| kanban-pro | `INSERT … ON CONFLICT … WHERE 已过期` | 租约过期自动恢复 | 每块板强制，非法移动直接拒绝 | 认领者不能自己写验收检查；`human:` 才能关人工门 | SQLite |
| agent-task-board | SQLite `BEGIN IMMEDIATE`，由服务端挑下一个 | 每次认领发新 token，过期的 worker 不能完成 | 有 | 人工审批后才解锁下游 | SQLite；10 秒轮询 |
| vibe-kanban | 无，MCP 启动的工作可能撞车 | 进程由它持有 | 列可自定义；自动流转按列名匹配，改名即失效 | 只有 PR 合并或手动拖动 | 云 Postgres 加本地 SQLite |
| Multica | `UPDATE … WHERE id=(SELECT … FOR UPDATE SKIP LOCKED)`（`server/pkg/db/queries/agent.sql:734`） | 15 秒心跳、孤儿恢复、最多重试 2 次 | 不写死流转，任意改 | 只有提示词约定（"done 留给人"） | Postgres 加 Redis；WebSocket |
| Paperclip | 单条条件 UPDATE 检查 `checkoutRunId`，冲突返回 409，agent 不得重试 | 搁浅后自动恢复一次，再失败转为 `blocked` 交给人 | 7 个状态，合法流转写在规范文档里（`doc/SPEC-implementation.md:748-757`）；代码只检查状态名是否存在，不检查流转（`server/src/services/issues.ts:362`，2026-11-06 核对时更正） | 运行时强制的评审阶段，见下 | Postgres；WebSocket |

## 三、值得借鉴的

1. **领取由服务端原子完成，不让模型去改 owner 字段。** agent-task-board 更进一步：每次领取发一个 token，过期的 worker 拿旧 token 不能完成。
2. **评审关口由运行时强制，Paperclip 最完整。** 卡片带评审阶段；执行者把状态设为 done 时，服务端改成 in_review 并转给评审者；评审者不能是执行者本人；要求修改时打回原执行者；连续 3 轮打回后升级给人；决定和评论必须在同一次请求里。Multica 和 graywrk 只靠提示词，agent 实际上可以自己标 done。
3. **agent 不直接改自己的状态，只报告结果。** Paperclip 的 native runner 只报告 `done`、`blocked`、`needs_review`、`yielded`，由服务端仲裁后再写状态。
4. **进入 blocked 必须写明在等谁、等什么**（Paperclip），否则就是一张静默的死卡。
5. **一个 "停车" 状态**（Multica 的 backlog、kanzo 的 Backlog 列）：放进去的卡不会触发 agent，其余状态一指派就开工。
6. **状态自动流转按事实驱动，只往前走，不覆盖人的选择**（vibe-kanban：关联第一个 session 进 In progress，开 PR 进 In review，合并进 Done）。要按状态 id 匹配，不能按列名。
7. **一张卡可以有多次尝试**（vibe-kanban：一卡多个 workspace，人选择合并哪一个）。
8. **失败回滚规则要窄**（Multica）：只有 in_progress 且没有其他运行、没有排队重试时才回到待办；in_review 和 blocked 属于人，不动。
9. **卡片上只放一个 "有 agent 在跑" 的指示**，细节在悬停或点开时再看（Multica、Paperclip）。
10. **子任务分阶段**（Multica 的 sub-issue `stage`）：同一阶段的子任务全部完成才唤醒父任务。
11. **其他想法**：kander 按文件重叠程度调度，避免两张卡改同一批文件；kander 和 saltbo/agent-kanban 用另一个 agent 做独立评审；overclick 把卡片写成 "做什么、为什么、怎么确认"，交付时附带实测的 token 和耗时。

## 四、要避开的

1. **卡片和运行数据分两处存储**（vibe-kanban 的云端加本地），一处停了另一处也不能用，两边还会不一致。
2. **按列名驱动自动化**（vibe-kanban），用户改了列名，规则就悄悄失效。
3. **"完成" 只靠提示词约定**（Multica、graywrk、Backlog.md）。
4. **默认跳过权限**：vibe-kanban 默认带 `--dangerously-skip-permissions`，Multica 和 Paperclip 也默认跳过。
5. **照搬多机场景的租约、心跳和回收**（Multica、Beads）：我们的 CLI 进程由本机 server 持有，进程退出 server 当场就知道。只需要处理 "应用重启后，原来在跑的卡怎么办"。
6. **一开始就做自定义状态、工作流引擎和五种视图**（Multica 有 list、board、table、Gantt、swimlane，迁移文件 1262 个）。先固定状态，先做 board 和 list。
7. **整个文件重写、不加锁的 JSON 存储**（Kanbrawl），多个写入者会互相覆盖。
8. **多租户审计字段**（Multica 的 originator、accountable），单用户场景用不上。

## 五、我们已有的、能直接接上的

以下行号以 2026-11-03 的 `main` 为准。

- **CLI 自带共享任务表**：`<配置目录>/tasks/<列表 id>/<任务>.json`，字段有 `owner`、`status`、`blocks`、`blockedBy`（`src/utils/tasks.ts:76`）。`claimTask` 用文件锁做原子领取，会拒绝已被领取、已完成、被阻塞的任务（`src/utils/tasks.ts:541`）。
- **列表 id 由环境变量决定**：`CLAUDE_CODE_TASK_LIST_ID`（`src/utils/tasks.ts:199`）。
- **server 已经能读这些任务**（`src/server/services/taskService.ts`），桌面端有接口（`desktop/src/api/cliTasks.ts`），目前只读。
- **server 已经能自己启动 agent**：定时任务在指定目录建 session 跑提示词（`src/server/services/cronScheduler.ts:371`）。
- **session 状态归 server 所有**，有回合阶段、进程阶段、待处理的权限请求等（`src/server/session/state/types.ts`）。
- **页面挂载点**：标签页类型现在有 `session`、`scheduled`、`artifacts`（`desktop/src/stores/tabStore.ts:18`），看板可以作为第四种。

CLI 的任务表只有 3 个状态（pending、in_progress、completed），没有待评审、阻塞和停车。

2026-11-06 起，session 之间的创建和消息已随 #239 合并，见 [session-links 技术设计](../../session-links/tech-design.md)。

## 六、当时的方向草图

- 看板挂在项目上，卡片有固定的几个状态：停车、待办、进行中、待评审、阻塞、完成、取消。
- 卡片开始时，server 为它启动一个 session，默认在独立 worktree 里。一张卡可以有多次尝试。
- 卡片状态由服务端根据事实推导和仲裁：session 开始运行进入进行中；agent 报告完成进入待评审；人批准才完成。agent 只报告结果，不直接改状态。
- 被启动的 agent 通过工具读写同一张看板：拆子任务、原子领取、标阻塞并写明原因。
- 卡片上显示 "有 agent 在跑" 和 "等你处理"。

后来的方向见 [PRD](../prd.zh.md)。

## 七、当时提出的问题

1. 推送、拉取，还是两者都要？
2. 卡片存在哪里：CLI 任务文件、server 自有存储，还是仓库里的 markdown？
3. 每个项目一张看板，还是跨项目总看板？
4. "完成" 只能由人决定，还是允许评审 agent？
5. 每张卡默认独立 worktree，还是默认在项目目录里？
6. 和 agent teams（#162）的关系是什么？
7. 非代码任务是否也是一等公民？

## 附：抽查和未覆盖的部分

设计者亲自对照源码抽查过的结论：graywrk 的条件 UPDATE；vibe-kanban 停运；Beads 租约 5 分钟；LokalBoards 的行锁事务；Multica 的 `ClaimAgentTask` 用 `FOR UPDATE SKIP LOCKED`；Paperclip 的合法状态流转。

没有覆盖的：12 个候选里有 10 个只读了 README。kandev、kanbots、kander、Chorus 和 DreamCoder 的架构最接近，值得拆解。许可：kanzo、Chorus、kandev、kanban-pro 是 AGPL，Multica 是附加条件的 source-available，saltbo/agent-kanban 是 FSL，都只借鉴思路，不抄代码。
