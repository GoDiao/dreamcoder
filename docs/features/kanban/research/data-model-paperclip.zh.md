# Paperclip 数据模型拆解

范围：只读数据模型。路径均相对 `refs/agent-kanban/paperclip`，commit `82c033ed127d07862e6765aa4b69a3cf339bde81`（2026-11-02）。缩写：SCH = `packages/db/src/schema/`，SHA = `packages/shared/src/`，SPEC = `doc/SPEC-implementation.md`，EXE = `doc/execution-semantics.md`，POL = `docs/guides/execution-policy.md`。

## 1. 身份

- 仓库：paperclipai/paperclip，LICENSE 为 MIT（`LICENSE:1-3`），可借鉴设计和代码思路，但本次不复制代码。
- 技术栈：TypeScript monorepo（pnpm），Node 服务（`server/`），React UI（`ui/`），zod 校验（`SHA/validators`）。
- 存储：PostgreSQL，drizzle-orm（`SCH/issues.ts:1-26`），迁移在 `packages/db/src/migrations/`（已到 0418）。
- 产品定位：多公司（`company_id` 出现在几乎所有表）的 "agent 公司"。agent 按组织架构（`agents.reportsTo`）接任务，人是 "board"。

## 2. 实体与关系

核心实体（SCH，括号内为关键字段）：

- `issues`（`issues.ts:26-99`）：`id uuid`、`parentId uuid`、`projectId`、`goalId`、`title text`、`description text`、`status text`、`statusVersion bigint`、`priority text`、`workMode text`、`reviewPolicy text`、`assigneeAgentId uuid`、`assigneeUserId text`、`checkoutRunId`、`executionRunId`、`executionLockedAt`、`executionPolicy jsonb`、`executionState jsonb`、`executionWorkspaceId`、`createdByAgentId/UserId`、`responsibleUserId`、`originKind/originId/originRunId`、`hiddenAt`、`startedAt/completedAt/cancelledAt`。一张表 90 多列，监控、会话、隐私、恢复等能力都堆在这里。
- `issue_relations`（`issue_relations.ts`）：`issueId`、`relatedIssueId`、`type`（当前只有 `"blocks"`，`SHA/constants.ts:433`）、`createdByAgentId/UserId`。唯一索引 (company, issue, related, type)。
- `issue_comments`、`issue_documents`、`issue_work_products`、`issue_attachments`、`issue_execution_decisions`、`issue_thread_interactions`：见后文。
- `issue_labels`、`issue_approvals`（issue 与 approval 的多对多，复合主键）、`issue_access_grants`（`subjectType user|agent`、`source explicit|assignment|project`、`revokedAt`）、`issue_tree_holds` 与 `issue_tree_hold_members`（对整棵子树暂停）、`issue_recovery_actions`、`issue_plan_decompositions`。
- `agents`（`agents.ts:17-52`）：`role text`（ceo、cto、engineer、pm、qa 等固定 12 个，`SHA/constants.ts:47-60`）、`reportsTo`、`permissions jsonb`、`adapterType`、`status`。
- `heartbeat_runs`、`heartbeat_run_events`、`agent_task_sessions`、`activity_log`：见 4、7。

三种关系的存法：

| 关系 | 存法 | 语义 |
|---|---|---|
| 父子 | `issues.parentId` 自引用列 | 结构性：拆分、汇总、解释来由。不构成执行依赖（EXE:417-428） |
| 阻塞 | 关联表 `issue_relations`，type=`blocks`；API 里叫 `blockedByIssueIds`（`SHA/validators/issue.ts` 多处） | 依赖：未完成时不能继续，全部解除时唤醒（EXE:430-444） |
| 重复、相关 | 未发现专门关系 | `type` 枚举只有 `blocks`；另有 `issue_reference_mentions`、`origin*` 列做溯源，不是相关关系 |

补充：

- 父任务真要等子任务，必须再加一条 blocker，不能只靠 parent（EXE:442）。创建时 agent 若省略 `parentId`，服务端默认挂到当前 run 所在任务，且不加 blocker（SPEC:437）。
- 阻塞环检查：`server/src/services/issues.ts:7640-7665` 做 BFS，报 "Blocking relations cannot contain cycles"；自阻塞报错在 `:7676-7679`。同步 blocker 时按 id 排序 `FOR UPDATE` 锁住相关 issue（`:7681-7688`）。
- 被取消的 blocker 不算满足依赖，边保留为未解除（EXE:442-444）。
- 父子环：未核实 `parentId` 是否有环检查。
- 其他溯源：`originKind`（manual、routine_execution、task_watchdog 等，`SHA/constants.ts:363-376`）、`originRunId` 记录由哪个 run 创建。

## 3. 状态

- 集合：`backlog | todo | in_progress | in_review | done | blocked | cancelled`（`SHA/constants.ts:190-198`），存 `issues.status`（text，无 DB 枚举）。终态 `done`、`cancelled`。
- 派生显示状态 `monitoring` 不落库（`SHA/constants.ts:202-205`；SPEC:426）。
- 流转表写在 SPEC:736-757（如 `backlog -> todo|cancelled`，`in_review -> in_progress|done|cancelled`）。
- 代码里的检查很弱：`assertTransition`（`server/src/services/issues.ts:362-367`）只校验目标状态是已知值，不校验流转矩阵。流转表主要是文档约定，真正的硬规则散在其他检查里：
  - `in_progress` 必须有 assignee（`issues.ts:10225`、`:11300`）。
  - 进入 `blocked` 必须有可路由的等待路径：blocker、待处理 interaction/approval、或 `unblockDescriptor {owner, action}`（EXE:131-146；`issues` 表有 `unblockDescriptor jsonb`）。
  - `in_review -> done|cancelled` 的裁决按当前 `reviewPolicy` 在行锁内授权（SPEC:462-463）。
  - 进入 `in_progress` 必须走 checkout（EXE:298-303）。
- `statusVersion`：见 4。
- 谁能改：路由层 `server/src/routes/issues.ts` 加服务层。agent 的 run 令牌只能改自己 checkout 的 issue 及其后代（EXE:446-448）；权限键 `tasks:assign`、`tasks:assign_scope`、`tasks:manage_active_checkouts`（`SHA/constants.ts:1028-1030`）。
- 非终态活性规则：agent 持有的 todo、in_progress、in_review、blocked 必须有实时执行路径、等待路径或恢复路径（SPEC:765-767）。这是靠后台扫描和恢复动作表（`issue_recovery_actions`）实现的，复杂度很高。

## 4. 历史与并发

- 审计日志：`activity_log`（`SCH/activity_log.ts`）：`actorType`、`actorId`、`action`、`entityType`、`entityId`、`runId`、`details jsonb`。通用追加表，issue 变更都往里写（例如 `issue.admin_force_release`，SPEC:1501）。
- 运行事件：`heartbeat_run_events`（`runId`、`seq bigint`、`eventType`、`payload`），唯一索引 (runId, seq)；`heartbeat_runs.nextEventSeq` 分配序号（`heartbeat_runs.ts:78`）。
- 评审决定：`issue_execution_decisions` 每次评审或批准一行，只追加。
- `statusVersion bigint`（`issues.ts:48`）：不是由应用层递增，而是 DB 触发器。状态变化时 +1（`migrations/0227_modern_pandemic.sql:146-158`），assignee 变化时也 +1（`migrations/0358_issue_assignment_status_version.sql:1-14`）。用途：别的表记下 "我基于哪个版本做的决定"，应用时比对。例子：`server/src/routes/issues.ts:13943` 的 `expectedStatusVersion`；`case-handoffs.ts:295`、`:399` 的 "Task changed; reload before handing off" 冲突错误。这是乐观锁，但只覆盖状态和 assignee，不覆盖标题、描述等字段。
- 另有悲观锁：行锁 `FOR UPDATE`（blocker 同步、评审裁决）；`executionPolicy` 更新可带 `expectedExecutionPolicy`（`issues.ts` 11179 附近，路由 13930 附近）。
- `workspaceBindingRevision int`（`issues.ts:84`）是另一个版本号，用于工作区绑定。
- 软删除：`issues.hiddenAt`（列表查询带 `isNull(hiddenAt)`，`issues.ts:957`）；评论用 `deletedAt` 加 `deletedBy*`（`issue_comments.ts:32-36`）。
- 外键：评论、文档、附件、work product 对 issue 均 `onDelete: cascade`；run 删除时 issue 上的 lock 列 `set null`。

## 5. 评论、交付物与证据

评论 `issue_comments`：

- `body text`；作者双列 `authorAgentId` / `authorUserId`，另有 `authorType`、`onBehalfOfUserId`、`createdByRunId`（评论记得是哪个 run 写的）。
- `presentation jsonb`、`metadata jsonb`、`clientRequestId`（幂等，唯一约束 (issue, author, clientRequestId)）。
- 扁平评论流，没有 `parentCommentId`；结构化交互另放 `issue_thread_interactions`。

交付物分三类：

1. `issue_work_products`（`issue_work_products.ts`）：`type`（preview_url、runtime_service、pull_request、branch、commit、artifact、document，`SHA/validators/work-product.ts:10-18`）、`provider`、`externalId`、`url`、`status`（active、ready_for_review、approved、changes_requested、merged、closed、failed、archived、draft）、`reviewState`（none、needs_board_review、approved、changes_requested）、`isPrimary bool`、`healthStatus`、`summary`、`metadata jsonb`、`executionWorkspaceId`、`createdByRunId`。每个 work product 自带审核状态，与 issue 的 `executionState` 独立。
2. `issue_documents`（关联表）连 `documents` 与 `document_revisions`：issue 下按 `key`（小写字母数字，如 `plan`）挂文档；文档有 `latestRevisionNumber`，每个修订记 `createdByRunId`、`changeSummary`；文档可加锁（`lockedAt`、`lockedBy*`）。计划（`plan` 文档）的接受绑定到修订号（`issue_plan_decompositions.acceptedPlanRevisionId`）。
3. `issue_attachments`：`assetId`（指向 `assets`）、`issueCommentId`、`originatingRunId`；`assetUq` 唯一，一个 asset 只属一个 issue。

验证与证据：

- 没有单独的 "验证结果" 表。证据来自 work product 的 `healthStatus`/`reviewState`、PR 元数据里的 `changedFiles`/additions/deletions（`SHA/types/work-product.ts:70-92`）、评审决定正文、run 日志。
- `executionPolicy.requiredQualityReview` 里有 `deliverables[]`，key 唯一（`SHA/validators/issue.ts` 455 行前后）：评审时按交付物 key 勾验。细节未展开读 [未核实]。
- 强制留痕：每个绑定 issue 的 run 必须留一条评论，否则重试一次，仍无则记 `retry_exhausted`（POL "Comment Required Backstop"）；run 上有 `issueCommentStatus`（`heartbeat_runs.ts:110`）。

## 6. 角色与权限的存储

- 负责人单值：`assigneeAgentId` 与 `assigneeUserId` 两列，互斥，硬不变量（EXE:57-67）。人与 agent 分列，不用多态列。
- 创建者同样双列 `createdByAgentId/UserId`；另有 `responsibleUserId`（agent 行动背后的责任人，评论、run、activity 都带）。
- 没有任务级 "角色" 字段（没有 worker/reviewer 列）。角色只出现在：
  - `agents.role`：agent 的职能（工程师、QA 等），是 agent 的属性，与具体任务无关。
  - `executionPolicy.stages[].participants[]`：评审人、批准人，每人 `{type: agent|user, agentId|userId}`（`SHA/validators/issue.ts:318-360`），每个 stage 的 `approvalsNeeded` 固定为 1。
  - `executionState.currentParticipant` 与 `returnAssignee`：当前评审者，以及评审后退回给谁。
  - 评审时 issue 的 assignee 被运行时改成评审者，原执行者存进 `returnAssignee`（POL "Workflow"）。即同一个 assignee 字段在不同阶段承载不同角色。
- `reviewPolicy`：`anyone | not_creator | human_only`（`SHA/constants.ts:219`），决定谁能给 `in_review` 下结论；`not_creator` 要求不能是把 issue 送入评审的人（`server/src/services/issue-review-policy.ts:108-139`）。
- 可见性：`visibility open|private` 加 `privacyRootIssueId` 与 `issue_access_grants`（user 或 agent，可撤销）；读权限是一条统一谓词（SPEC:489）。
- 权限检查位置：路由层 `assertIssueReadAllowed` 等加服务层；agent 权限在 `agents.permissions jsonb`，权限键见 `SHA/constants.ts:1020-1031`。公司层成员角色在 `company_memberships` [未读]。
- 评审权限：只有 `currentParticipant` 能推进或驳回当前阶段，其他人得 422（POL "Access Control"）；决定评论必须与状态变更在同一个 PATCH 里。

## 7. 任务与执行的关联

- `heartbeat_runs`（`heartbeat_runs.ts:31-118`）：`agentId`（必填）、`issueId`（可空，`scopeKind company|issue`）、`status`（queued、scheduled_retry、running、succeeded、interrupted、failed、cancelled、timed_out，`SHA/constants.ts:925-933`）、`startedAt/finishedAt`、`error`、`exitCode`、`usageJson`、`resultJson`、`contextSnapshot jsonb`、`sessionIdBefore/After`、日志引用（`logStore/logRef/logBytes/logSha256`）、`stdoutExcerpt/stderrExcerpt`、`retryOfRunId`、`livenessState`、`nextAction`。
- 一个 run 对应一个 agent、至多一个 issue；一个 issue 有多个 run（run 的 `issueId` 指过来）。issue 上只留两个指针：
  - `checkoutRunId`：谁拥有执行权（所有权锁）。
  - `executionRunId`：此刻哪个 run 在执行。
  - 两者含义不同（EXE:298-309）。run 终态后，收尾时用 compare-and-clear 清掉仍指向它的锁，不清已被后继 run 重新获取的锁（EXE:315-318）。
- 原子 checkout（SPEC:1476-1493；`server/src/services/issues.ts:12150-`）：先查子树暂停（tree hold），再查未解除 blocker（有则 422），再一条 SQL `UPDATE ... WHERE status IN expected AND (assignee 为空或等于本 agent) AND 执行锁为空或属于本 run`；0 行返回 409。成功后写 `assigneeAgentId`、`checkoutRunId`、`executionRunId`、`status=in_progress`、`startedAt`。
- 释放：`POST /issues/:id/release` 清锁；终态 issue 保留 assignee 与时间戳；未完成则清 assignee，`in_progress` 退回 `todo`（SPEC:1495-1499）。`admin/force-release` 是人工恢复入口，写审计（SPEC:1501）。
- 执行结束后保留：run 行本身不删（issue 删除时 run 的 `issueId` set null）；评论、文档修订、work product、附件、决定都记 `createdByRunId` / `originatingRunId`，可从产出反查 run；日志留引用与摘要；`agent_task_sessions` 以 (company, agent, adapterType, `taskKey`) 为键保存 `sessionParamsJson`、`lastRunId`，供同一任务续接会话（`agent_task_sessions.ts:16-44`）。
- 会话与 issue 的关联：靠 `taskKey` 字符串，不是外键；`heartbeat_runs.contextSnapshot->>'issueId'` 也建了表达式索引（`heartbeat_runs.ts:203`）。
- 与我们的 "会话树" 对应：Paperclip 没有 session 父子树；run 之间用 `retryOfRunId` 串重试链，任务之间用 `issues.parentId` 与 `originRunId`。

## 8. 提议、草稿与审批类状态

- 没有 "proposed" issue 状态。提议走 `issue_thread_interactions`（`issue_thread_interactions.ts:16-61`）：`kind`（suggest_tasks、ask_user_questions、request_confirmation、request_checkbox_confirmation、request_item_verdicts、connection_intent，`SHA/constants.ts:266-273`）、`status`（pending、accepted、rejected、answered、cancelled、expired、failed）、`payload jsonb`、`result jsonb`、`addresseeAgentId/UserId`（指定谁来答）、`requestedResolverPolicy` 与 `effectiveResolverPolicy`（anyone 等，`:25-40`）、`continuationPolicy`（none、wake_assignee、wake_assignee_on_accept）、`idempotencyKey`、`resolvedBy*`。
- `suggest_tasks` 的 payload 是任务草稿数组（`suggestedTaskDraftSchema`，`SHA/validators/issue.ts:1264-1291`）：`clientKey`、`parentClientKey`、`title`、`description`、`assignee*`、`priority`、`workMode`、`labels`；只允许一个 assignee。草稿存在 interaction 的 JSON 里，接受后才由 `acceptSuggestedTasks`（`server/src/services/issue-thread-interactions.ts:4178`）创建真 issue。这与我们 "worker 只能提议 proposed 卡" 最接近，但草稿不是 issue 行，而是挂在父 issue 线程上的审批项。
- `issue_plan_decompositions`：接受一份 `plan` 文档修订后拆分子任务；`requestFingerprint` 与唯一索引 (source issue, 修订) 保证同一修订只拆一次（SPEC 与 EXE:464-532）。
- 审批：`approvals` 表经 `issue_approvals` 链到 issue（公司级审批，如招聘 agent，细节 [未读]）。
- `workMode`：standard、ask、planning、skill_test。`planning` 模式只产出计划；接受计划确认时在同一事务里改回 `standard`（SPEC:464）。
- 评审阶段：`executionPolicy.stages` 有序，type 为 review 或 approval；`executionState.status` 为 idle、pending、changes_requested、completed。流程：执行者把状态改成 done，运行时拦截，改为 `in_review` 并转给第一个评审者；评审通过则转给下一阶段；全部通过才真正 `done`；要求修改则退回 `returnAssignee` 并回到同一阶段（POL "Workflow"）。`maxReviewRounds`、`changesRequestedCount` 限制往返次数。
- 最终验收：不强制人。批准阶段的 participant 可以是 agent，`reviewPolicy` 设 `human_only` 才限定人。

## 9. 文件、路径与范围

- issue 本身没有 "将改文件" 或 "已改文件" 的列表。表里没有路径列。
- 范围信息挂在工作区上：
  - `issues.executionWorkspaceId`、`executionWorkspacePreference`、`executionWorkspaceSettings jsonb`、`projectWorkspaceId`。
  - `execution_workspaces`（`SCH/execution_workspaces.ts`）：`mode`、`strategyType`（`project_primary | git_worktree | adapter_managed | cloud_sandbox`，`SHA/types/workspace-runtime.ts:5-8`）、`cwd`、`repoUrl`、`baseRef`、`branchName`、`status`、`sourceIssueId`。
  - 模式：`shared_workspace`（共用项目目录）、`isolated_workspace`（每 issue 一个 git worktree 加分支）、`operator_branch`、`reuse_existing`（`workspace-runtime.ts:15-21`）。
- 冲突处理：靠隔离，不靠文件级检测。默认可为每个 issue 开独立 git worktree，两张卡不会写同一目录。共享工作区时有 `sharedWorkspaceConcurrency: auto | serialize | allow`（`workspace-runtime.ts:24`；issue 级 `SHA/validators/issue.ts:249`，项目级 `validators/project.ts:27`），"serialize" 让共享同一工作区的运行排队。该开关的调度实现位置未找到 [未核实]。
- 事后文件证据：只有 work product 的 PR/commit 元数据里的 `changedFiles` 计数，没有文件名清单。
- 分支一致性：运行收尾时校验 worktree 仍在记录的分支，能安全恢复则自动恢复（EXE:759）。

## 10. 对我们的启示

借鉴：

1. 父子与阻塞分开存，父子是列，阻塞是带唯一约束的关联表，写入时做环检测并按 id 排序加锁。对应约束 "状态、依赖、历史在会话之外保存"，也符合 Worker 只看见 "自己的卡加必需依赖"：依赖边是显式的，可以按边求可见集。
2. 状态版本由 DB 触发器维护，状态或负责人变更就 +1，其他表记 "基于哪个版本" 并在应用时比对。对应 "服务端检查每次变更" 和 "批准基于过期状态" 的问题。我们若有人工批准分配，可以直接记 `expectedVersion`。
3. 提议走独立的 interaction 记录，草稿存 JSON，接受后才建真卡，并带 `addressee`、幂等键、状态机。对应 "Worker 只能提议，PM 或人决定"。注意我们要的是 "proposed" 卡态，可选择直接用卡态，Paperclip 的做法是不让草稿进卡表，减少 "半成卡" 污染看板。
4. 评审阶段是有序数组加当前阶段状态，决定落独立追加表，每条决定记 stage、actor、outcome、run。对应 "Reviewer 独立于 Worker"：`not_creator` 策略与 "评审时排除原执行者" 可直接参考。
5. 交付物独立成表，带 type、状态、审核状态、`createdByRunId`，文档用 key 加修订号。对应 "交付物在会话之后仍存在" 和证据溯源。
6. checkout 用单条条件 UPDATE 做原子认领，所有权锁与 "当前活跃 run" 分成两列，收尾时 compare-and-clear。对应 "两张卡不同时改同一文件" 的互斥思路，也避免会话崩溃后卡死。

避免：

1. 不要把所有能力塞进一张 issue 表（90 多列，含监控、会话、隐私、恢复）。对应 "单用户本地、不要多租户字段"；我们不需要 `company_id`、`visibility`、`privacyRoot`、`issue_access_grants`。
2. 不要用同一个 assignee 字段在评审阶段换成评审者，再用 `returnAssignee` 存回。对应 "角色按卡嵌套、Worker 与 Reviewer 独立"：这种做法会让 "谁是 Worker" 在历史上丢失。应该单独存 "卡与会话的角色绑定"（我们本来就有这个约束）。
3. 不要把状态流转表只写在文档里。`assertTransition` 只验证状态名合法（`issues.ts:362-367`），矩阵没有被强制。我们要 "服务端检查每次变更" 就该把矩阵写进代码。
4. 不要依赖后台扫描去维持 "活性"（`issue_recovery_actions`、watchdog、monitor）。这是自治 agent 公司的需要，对本地单用户过重；我们的会话由用户可见，崩溃时直接标记卡状态并提示即可。
5. 不要用字符串键关联会话和任务（`taskKey`）。我们要 "会话以角色挂到卡上" 且与会话树分离，应该用显式关联表。
6. 不要把最终验收做成 agent 也能担任。Paperclip 的批准阶段 participant 可以是 agent（`type: agent`），只有设置 `reviewPolicy=human_only` 才限人。我们 "只有人给最终验收" 应该是硬规则，不是策略可选项。文件冲突也不要只靠隔离工作区；我们若要 "两张卡不改同一文件"，需要卡级声明范围，Paperclip 没有这个字段，没有可借鉴的实现。

## 11. 未核实与未读

- 父子环检测：未找到 `parentId` 的环检查。
- `sharedWorkspaceConcurrency` 的调度实现位置未找到；"serialize" 具体如何排队 [未核实]。
- `requiredQualityReview.deliverables` 的校验与使用流程未读。
- `approvals`、`approval_comments`、`goals`、`projects`、`company_memberships`、`agent_memberships` 表未读；公司级角色细节 [未核实]。
- `cases`、`case_handoffs`、`pipeline_cases`、`workflows`、`work_assessments`、`completion_contracts`、native runner 相关表（`native_run_*`）未读。
- 服务端各状态变更的完整授权代码（`routes/issues.ts` 约 14000 行，`services/issues.ts` 14284 行）只读了 checkout、blocker 同步、assertTransition，未逐路径核对。
- `doc/execution-semantics.md` 和 SPEC 只读了与本任务相关的章节（状态、checkout、blocker、blocked 规则），其余恢复、watchdog、native 运行时章节未读。
- 未运行、未构建任何代码；表结构以 drizzle schema 为准，未对照实际迁移后的数据库。
