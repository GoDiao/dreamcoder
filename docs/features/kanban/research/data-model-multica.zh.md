# Multica 数据模型拆解

范围：只看数据模型。不设计 DreamCoder。

路径简写：`M:` = `refs/agent-kanban/multica/server/migrations/`，`G:` = `refs/agent-kanban/multica/server/pkg/db/generated/models.go`（sqlc 从迁移生成，反映当前表结构），`H:` = `server/internal/handler/`，`D:` = `apps/docs/content/docs/`。所有行号对应 commit a7a61f15f148ba8c901fe24a36a61d6d73e247d6。

## 1. 身份

- URL：https://github.com/multica-ai/multica
- commit：a7a61f15f148ba8c901fe24a36a61d6d73e247d6（2026-11-03）
- license：Apache-2.0 加附加条件（`LICENSE` Part I）：不得向第三方提供托管服务，不得去掉界面品牌。属于 source-available。本报告只取思路，不拷代码。
- 技术栈：Go 后端（Chi + WebSocket）、Next.js 前端、PostgreSQL 17（`README.md:235,253`）。守护进程（daemon）在用户机器上启动 Codex、Claude Code 等 CLI。
- 存储：Postgres，查询由 sqlc 生成。迁移约 1262 个文件。约定不使用外键（M:332_issue_status.up.sql 注释"No foreign keys"，M:573 同），完整性由应用层维护。
- 多租户：所有表带 `workspace_id`。这是我们要去掉的部分。

## 2. 实体与关系

### issue（G:837，卡片）

- 标识：`id uuid`、`number int`（工作区内递增，显示为 MUL-123）。
- 内容：`title text`、`description text`、`acceptance_criteria jsonb`、`context_refs jsonb`、`metadata jsonb`、`properties jsonb`（自定义属性值）。
- 状态与优先级：`status text`（状态键）、`priority text`（urgent/high/medium/low/none）。
- 排序与时间：`position float8`、`due_date`、`start_date`、`first_executed_at`、`last_activity_at`。
- 负责人：`assignee_type text`（member/agent/squad，可空）、`assignee_id uuid`。
- 创建者：`creator_type text`、`creator_id uuid`。
- 来源：`origin_type`、`origin_id`（autopilot、快速创建、飞书、Slack 等）。
- 父子：`parent_issue_id uuid`、`stage int`（>=1 或空）。
- 归属：`project_id uuid`。
- 并发：`revision bigint`（见第 4 节）。
- 分诊：`triage_state text`（目前只有 `pending`，M:483）。
- 重复：`duplicate_of_issue_id uuid`（M:536）。

### 关系：每种怎么存

- **父子（sub-issue）**：issue 上的一列 `parent_issue_id`，无外键，单父。创建环检测在应用层，只向上走 10 层（H:issue.go:3967-4000）。文档：父子状态互不影响（D:issues.mdx "Projects and sub-issues"）。
- **stage（批次屏障）**：`issue.stage` 一列（M:123_issue_stage.up.sql）。只在同一父卡的兄弟之间有意义。最低未完成 stage 内的子卡全部到终态（done/cancelled）时，才通知并唤醒父卡负责人。无 stage 的兄弟视为一个隐式 stage。它是通知屏障，不阻止任何子卡开始执行。
- **子卡变化事件**：表 `issue_child_event`（M:558，G:870 附近）。字段：`parent_id`、`child_id`、`kind`（closed/reopened/attached/detached/restaged）、`source_task_id`、`claimed_at`、`processed_at`。在写入事务内由触发器 `record_issue_child_event` 写入，提交后处理，调度器扫描补漏。`source_task_id` 用来避免唤醒刚做出这次变化的那个 run。
- **依赖/阻塞**：表 `issue_dependency`（M:001_init.up.sql:89-94，G:882）。字段：`issue_id`、`depends_on_issue_id`、`type`（CHECK 为 blocks/blocked_by/related）。**这张表在当前代码里没有读写路径**：`pkg/db/queries/` 与 `internal/` 中只有工作区删除时的 DELETE（`pkg/db/queries/workspace_delete.sql:366`）和索引迁移。我没有找到创建依赖的 API。结论：依赖在 schema 里存在，但功能上未启用（按 grep 结果推断，见第 11 节）。
- **阻塞**：实际用的是状态 `blocked`（内置状态），不是依赖表。文档：`blocked` 表示暂时无法继续（D:issues.mdx "Status"）。
- **重复**：`duplicate_of_issue_id` 单列。只在状态为 cancelled 时保留，状态离开 cancelled 就清除；只允许一层（D:issues.mdx "Mark as duplicate"；M:536 注释）。
- **相关**：issue 之间的 `mention://issue/` 评论链接，不产生关系行。依赖表的 `related` 类型同样未启用。
- **标签**：`issue_label`（G:889）加多对多关联表（M:001 中 `PRIMARY KEY (issue_id, label_id)`）。
- **关联 PR**：`issue_pull_request`（G:923）：`issue_id`、`pull_request_id`、`close_intent bool`。
- **来源上下文**：`issue_source_context`（G:949 附近，M:407）：`origin_task_id`、`source_issue_id`、`anchor_comment_id`、`snapshot jsonb`、`capture_digest`。"从评论创建子卡"时快照父卡和线程内容，之后不随源更新。

### 其他实体（与卡片相关的）

- **project**（G:1369）：`title`、`status`、`lead_type/lead_id`、`workflow_id`。issue 至多属于一个项目。
- **issue_status**（G:981）：状态目录，见第 3 节。
- **issue_workflow**（G:1110）：见第 3 节。
- **squad / squad_member**（G:1493、1508）：见第 6 节。
- **agent**（G:25）：`name`、`instructions`、`runtime_id`、`max_concurrent_tasks`、`permission_mode`（private/public_to）、`archived_at`。
- **agent_task_queue**（G:112）：run 记录，见第 7 节。

## 3. 状态

- **存储**：`issue.status` 是 TEXT，存状态键（key）。早期有 7 值 CHECK（M:001:57-58），后来由状态目录取代（M:332、337 改为开放检查）。
- **状态目录**：表 `issue_status`（M:332，G:981）。字段：`key`（正则 `^[a-z0-9][a-z0-9_]{0,31}$`，创建后不可改）、`name`、`description`、`category`、`color`、`icon`、`is_system bool`、`position float8`、`archived_at`。`issue.status` 不引用 id，只存 key。
- **类别（category）**：四类 `unstarted / started / done / closed`（D:issue-status-lifecycle-rollout.md "Contract"；迁移 469、478、491-494）。内置七个状态对应关系：backlog、todo 属 unstarted；in_progress、in_review、blocked 属 started；done 属 done；cancelled 属 closed。类别创建后不可改，因为改类别会静默改变已有卡片的机器语义（M:332 注释）。
- **自定义状态**：只有工作区 owner/admin 能创建（`errStatusCreateForbidden`，H:issue_workflow.go:335）。自定义状态不继承内置状态的特殊行为；标签不带行为（D:issue-status-lifecycle-rollout.md "Contract"）。归档前要先把使用它的卡片全部移走，服务端在目录锁下计数，返回 409 `issue_status_in_use`。
- **合法流转**：**没有流转图**。服务端不检查"从 A 到 B 是否允许"，只检查目标状态是否在项目工作流列出的步骤里（`issueworkflow.CheckStatus`，H:issue_workflow_entry.go:70-79）。
- **工作流（workflow）**：表 `issue_workflow`（M:573，G:1110）。字段：`name`、`initial_status_key`、`steps jsonb`（数组）、`is_default bool`、`owner_id`。`steps` 每项：`status_key`、`handler{type,id}`、`instructions`、`next_status_key`、`back_status_key`（`internal/issueworkflow/issueworkflow.go:160-172`）。项目通过 `project.workflow_id` 选用；没选的项目用隐式 Default，接受所有状态且无交接。步骤用 JSONB 的理由：编辑器整体保存，且不跨工作流查询单个步骤（M:573 注释）。
- **步骤交接**：进入有 handler 的步骤时，服务端把卡片分给该 handler 并启动 run，带步骤说明（H:issue_workflow_entry.go:97-113）。交接走与手动分配相同的权限检查。run 结束不会自动改状态，由处理该步骤的人或 agent 改（D:workflows.mdx "Move work to the next step"）。
- **谁能改**：成员和 agent 都能直接改状态（D:issues.mdx "Status"）。agent 的限制：run 只能从它所在的步骤移动卡片。run 记录 `workflow_step`（M:578），如果卡片已被别人移走，run 的状态变更被拒绝（`StepMovedError`，`internal/issueworkflow/issueworkflow.go:680`；检查在 H:issue_workflow_entry.go:80-88）。`workflow_step` 为空表示"不检查"。
- **系统改状态**：run 失败且无其他 run、无重试时，`in_progress` 回到 `todo`；PR 合并后移到工作区配置的状态（D:issues.mdx 的 Callout）。
- **backlog 规则**：分给 agent 但在 backlog 时不启动 run，离开 backlog 才启动（D:assigning-issues.mdx）。
- **分诊**：Triage 从 status 移到独立列 `triage_state`。理由："status 回答进展多远，Triage 回答这是不是工作"（M:483 注释）。

## 4. 历史与并发

- **活动日志**：`activity_log`（M:001:156-165，G:14）。字段：`issue_id`、`actor_type`（member/agent/system）、`actor_id`、`action text`、`details jsonb`、`created_at`。由事件监听器在事件总线上写入（`cmd/server/activity_listeners.go:36,105,128,164`），不是在业务事务内。读取取最新 N 条。
- **状态变更记录**：评论类型 `status_change` 与 `system` 由平台生成，客户端不能伪造（H:comment.go:1926-1936 的白名单只放行 `comment` 和 `progress_update`）。
- **乐观锁**：`issue.revision` 和 `comment.revision`（M:351，bigint 默认 1）。更新请求可带 `expected_revision`，不匹配返回 409（H:issue.go:3884-3893、4112-4115；SQL 在 `pkg/db/queries/issue.sql:259,312`）。`revision` 只在状态改变等有意义的变化时递增（issue.sql:334 的 `CASE WHEN i.status IS DISTINCT FROM $2`）。可选参数，不传则不检查。
- **事件与唤醒**：`issue_wakeup` 和 `issue_wakeup_receipt` 在源事务内用 SQL 钩子记录匹配事件，不做通用事件归档，也没有全局顺序或回放（`docs/engineering/issue-wakeups.md` "Implementation"）。
- **软删除**：评论有 `deleted_at`（M:471，G:605）。有回复的线程起始评论保留"已删除"占位（D:comments.mdx "Edit and delete"）。issue 是硬删除，附带评论、附件，并取消未完成的 run（D:issues.mdx "Delete an issue"）。状态、属性、squad 用 `archived_at`。

## 5. 评论、交付物与证据

- **comment 表**（G:605）：`issue_id`、`author_type`（member/agent，M:001:100）、`author_id`、`content`（Markdown 源）、`type`（comment/status_change/progress_update/system，M:001:103-104）、`parent_id`、`resolved_at/resolved_by_*`、`source_task_id`、`quick_action_id`、`revision`、`deleted_at`、`suppressed_agent_ids uuid[]`。
- **线程**：回复可嵌套，但都归在同一顶层线程下；线程可标记已解决，在已解决线程里回复会自动重开（D:comments.mdx "Resolve a discussion"）。
- **评论与 run 的链接**：agent 发评论时，服务端从请求头取当前 task，把 `source_task_id` 写入评论（H:comment.go:1746-1791、1824）。评论因此可追溯到产生它的 run，并用于继承"最上层人类发起者"（`originator_user_id`）。
- **评论触发的约束**：评论触发的 task 不能发顶层评论，只能回复触发评论或合并进来的评论，否则 409（H:comment.go:1760-1778）。这是对"恢复会话沿用上一轮 parent_id"的防护。
- **"最终评论只发一条"规则**：**是提示词规则，不是数据库或服务端约束**。守护进程在 agent 的运行说明里写："Post exactly ONE comment per run — your final result ... Do NOT post progress updates or plans along the way."（`server/internal/daemon/execenv/runtime_config_sections.go:881`）。同一处写明结果必须通过 `multica issue comment add` 提交，用户看不到终端输出。服务端没有"每个 run 至多一条评论"的唯一约束；`progress_update` 类型仍然允许客户端写入（H:comment.go:1926-1929）。我只读到上述提示词和白名单，没有找到服务端按 run 计数的检查（见第 11 节）。例外：只有定时唤醒检查可以用 `wakeup checkin` 代替评论（同一行）。
- **squad 的 no_action**：squad 负责人记录 `no_action` 评估后，服务端拒绝它在该 task 内再发评论，409（H:comment.go:1779-1789）。这是少数由服务端强制的"评论次数"规则。
- **交付物**：表 `attachment`（G:192）。字段：`issue_id`、`comment_id`、`task_id`、`uploader_type/uploader_id`、`filename`、`url`、`content_type`、`size_bytes`、`source_context_id`。交付物就是评论上传的文件，`--attachment` 是文件到达读者的唯一途径（runtime_config_sections.go:883）。同名同类型文件再次上传形成新版本，在界面按版本合并显示（D:issues.mdx "Deliverables"）。版本号怎么存我没有读到（见第 11 节）。
- **run 产出**：`agent_task_queue.result jsonb`、`error`、`failure_reason`；转录在 `task_message`（G:1542：`seq`、`type`、`tool`、`input jsonb`、`output`、`call_id`）；用量在 `task_usage`（G:1590：token 数与 `cost_usd_ticks`）。
- **验证结果**：没有独立的验证/测试结果实体。验证只能表现为评论、附件或 run 转录。
- **验收标准**：`issue.acceptance_criteria jsonb`（G:837）。纯数据列；我没有找到按它校验完成的服务端检查（见第 11 节）。

## 6. 角色与权限的存储

- **负责人是单值**：`assignee_type` + `assignee_id` 一对列。三种类型：member、agent、squad（CHECK 在 M:084:32-33）。`assignee_type` 与 `assignee_id` 必须成对提供，否则 400（H:issue.go:4264-4272）。没有多负责人，没有参与者表。
- **squad**：`squad`（G:1493）：`name`、`leader_id`（必须是 agent）、`instructions`、`archived_at`。`squad_member`（G:1508）：`member_type`（agent/member）、`member_id`、`role text`。`role` 只是给负责人看的描述，"不授予权限，也不自动触发成员"（D:squads.mdx "Squad composition"）。分给 squad 时只给 leader 开 run，leader 通过评论里 @成员来委派。归档 squad 时，它名下的卡片转给原 leader。
- **订阅者**：`issue_subscriber`（G:997），`user_type` + `user_id`，评论过的人自动订阅。
- **人与 agent 区分**：全部身份字段都带类型列（`author_type`、`actor_type`、`creator_type`、`uploader_type`、`assignee_type`）。不是外键，是"类型 + id"的多态引用。
- **没有按卡片的角色字段**：没有 worker/reviewer/PM 这类每卡角色。唯一接近的是：工作流步骤的 `handler`（按状态指定处理人）、项目的 `lead_type/lead_id`、squad 的 leader 与成员 `role` 描述文字。
- **权限在哪检查**：
  - 分配：`validateAssigneePair`（H:issue.go:4261-4333）检查受让方存在、未归档，且调用者能调用该 agent（`canInvokeAgent`），失败 403。分给 squad 时检查的是 leader 的权限。
  - agent 调用权限：`agent.permission_mode`（private 仅 owner，public_to 查 `agent_invocation_target` 白名单，G:55 附近）。
  - run 身份：每个 run 发一个 run 级令牌，绑定 agent 和 task（`task_token`，`pkg/db/queries/task_token.sql`；D:security-model.mdx "What Multica does isolate"）。所以 agent 不能冒充人或其他 agent。令牌对 agent 能访问哪些卡片的限制我没有核实（第 11 节）。
  - 评论编辑删除：作者本人或 owner/admin；agent 的评论界面只给删除（D:comments.mdx）。
  - 工作区成员删除 issue 无需特别权限（D:issues.mdx "Delete an issue"）。
- **人类责任链**：run 上 `originator_user_id`（授权依据）和 `accountable_user_id`（审计、成本）、`originator_source`（direct_human/delegation/comment_source/rule_owner/owner_fallback/backfill/unattributed）、`delegated_from_task_id`。agent 触发的 run 从父 run 继承最上层人类（G:112 的字段注释）。

## 7. 任务与执行的关联

- **run 是 `agent_task_queue` 的一行**（G:112，表名保留了早期叫法）。issue 与 run 是一对多：每次执行新增一行，旧行不覆盖（D:tasks.mdx "Issues and runs"）。
- **关键字段**：
  - 归属：`issue_id`、`agent_id`、`runtime_id`、`squad_id`、`is_leader_task`、`chat_session_id`、`autopilot_run_id`。一个 run 可以不属于任何 issue（聊天、autopilot）。
  - 状态：`status`，八值：queued/dispatched/running/completed/failed/cancelled/waiting_local_directory/deferred（M:128_comment_routing_escalation.up.sql:8-16）。
  - 时间：`dispatched_at`、`started_at`、`completed_at`、`fire_at`。
  - 重试链：`attempt`、`max_attempts`、`parent_task_id`、`retry_of_task_id`（系统重试）、`rerun_of_task_id`（人手动重跑）。重试和重跑分开记录。
  - 触发：`trigger_comment_id`、`trigger_summary`、`trigger_evidence_kind` + `trigger_evidence_ref_id`（统一的"直接原因"标签：comment/issue_assignment/autopilot_run/rerun 等）。
  - 会话：`session_id text`（agent CLI 的会话 id）、`force_fresh_session`、`retired_session_id`。
  - 上下文：`context jsonb`、`issue_snapshot jsonb`（派发时的卡片快照）、`handoff_note`、`coalesced_comment_ids uuid[]`、`delivered_comment_ids uuid[]`。
  - 工作流：`workflow_step`。
  - 取消：`cancelled_by_type/id/name`。
- **一个 issue 同时多个 run**：允许。同一 agent 已有 queued/dispatched 的 run 时，新评论合并进去，不新增（D:mentioning-agents.mdx "Coalescing consecutive comments"）。
- **session 与卡片**：agent 的 CLI 会话 id 存在 run 行上（`session_id`），没有独立 session 表，也没有 session 与卡片的角色链接。重试时若会话仍安全且同一 runtime 认领，则续用会话（D:tasks.mdx "Manual retry"）。
- **结束后保留**：run 行、`result`、`error`、`failure_reason`、转录（`task_message`）、用量（`task_usage`）、分支名和工作目录都保留。唯一被清掉的是运行时 MCP 覆盖：`runtime_mcp_overlay`、`runtime_connected_apps` 在 task 完成后由触发器清除（G:112 字段注释，`trg_clear_runtime_mcp_overlay`）。
- **完成语义**：run `completed` 只表示这次执行正常结束，不表示卡片目标达成，卡片状态由负责人另行更新（D:tasks.mdx "Run completion and issue completion"）。

## 8. 提议、草稿或审批类状态

- **Triage**：`issue.triage_state = 'pending'`（M:483）。有此值的卡片不触发工作流交接（H:issue_workflow_entry.go:90-92：`prev.TriageState.Valid` 时返回）。M:483 注释说明处置结果（拒绝、合并）以后扩展这个 CHECK；目前只有 pending。
- **agent 创建的卡片**：issue 有 `creator_type`，agent 可作为创建者；创建卡片后是否进入 triage 的规则我没有读到（第 11 节）。
- **分配确认**：批量分给 agent 或 squad 时界面先让人确认将启动的 run（D:issues.mdx "Batch edits"）。这是界面层确认，不是数据库状态。
- **没有**"提议卡片由 PM/人批准"的状态，也没有按配置要求人批准分配的字段。
- **最终验收**：没有"只有人能验收"的强制。`in_review` 是普通状态，agent 默认也能把卡片设为 done（D:issues.mdx：agent 默认在开始时设 in_progress，交付时设 in_review；谁能设 done 未见限制，第 11 节）。

## 9. 文件、路径或范围信息

- **卡片上没有"将改/已改的文件"字段**。issue 无文件列表；run 无 diff 记录。
- **run 上的位置信息**：`work_dir text`、`durable_work_dir text`（M:376：临时 worktree 被确认清理后的持久目录，空则继续用 `work_dir`）、`branch_name text`（M:308）。分支名在成功与失败两条终止路径上都写入，因为失败的 run 仍会提交已有产出，用户此时最需要知道去哪里找（M:308 注释）。
- **分支约定**：worktree 模式下每个 issue 一个分支 `agent/<agent>/<issue>`，聊天用 `agent/<agent>/chat-<session>`；同一 issue 上两个 run 重叠时第二个分到 `agent/<agent>/<issue>-<task>`（D:project-resources.mdx "The result is a branch in your repo"；"A follow-up continues where the last run stopped"）。
- **冲突检测（粒度是目录，不是文件）**：
  - `project_resource`（G:1386）记录项目资源：`resource_type`、`resource_ref jsonb`、`label`、`position`。local_directory 资源有 `execution_mode`：`in_place`（默认）或 `worktree`（D:project-resources.mdx）。
  - `in_place`：同一真实目录一次只跑一个 run。后到的 run 进入状态 `waiting_local_directory`，等前一个释放（含不同符号链接指向同一目录的情况）。该状态是 run 状态机里的一个值（M:128），由 `internal/service/task.go:4530-4547` 标记。目录锁本身在哪里持有（数据库还是守护进程内存），我没有核实（第 11 节）。
  - `worktree`：每个 run 自己的 git worktree，并行不等待，结果是用户仓库里的分支。工作区未提交修改会被重放进 worktree；你和 agent 改了同一行时，run 在冲突的 worktree 中启动，并被要求先完成合并；有未合并文件则 run 失败并保留 worktree（D:project-resources.mdx "How runs share the directory"）。
  - 不检测两个任务是否改同一文件：并行靠 worktree 隔离，冲突留到合并时由 git 暴露。
- **安全边界**：默认没有文件系统沙箱，run 拥有守护进程用户的全部权限（D:security-model.mdx "The boundary is the daemon user"）。

## 10. 对我们的启示

借鉴：

1. **状态键存字符串，类别做行为分组**（对应"状态流转由服务端检查"）。`issue.status` 存键，另有 category 四类决定行为，自定义状态不继承行为。我们可以只留内置状态加类别，不做自定义目录，因为单用户本地不需要；若将来要加，这个分层可直接用。
2. **run 与卡片分表，一对多，历史不覆盖**（对应"执行历史、交付物比 session 长寿"）。run 行保留 result、失败原因、重试/重跑链、触发证据、卡片快照、转录和用量。比我们现有 session 存储更完整，可直接对照字段。
3. **run 记录自己所处的状态并拒绝过期写入**（`workflow_step`，对应"服务端检查每次改动"）。别人已把卡片移走时，run 的状态变更被拒，不会回滚别人的决定。可用于 Worker 与 PM/人同时改一张卡的场景。
4. **分支名、工作目录在成功与失败两条路径都写入**（对应"交付物比 session 长寿"、"文件冲突"）。失败的 run 的产出位置同样要保存。
5. **触发原因用统一的 `kind + ref_id` 记录**（`trigger_evidence_kind/ref_id`），并区分重试与重跑。适合我们的"谁让这个 session 开始工作"审计，与 session 树（谁启动谁）分开存。
6. **乐观锁 `revision` 加 `expected_revision`**（对应多个 session 并发改同一张卡）。只在有意义的变化时递增，避免无谓冲突。我们的服务端本来就是唯一写入点，可把它设为必填而不是可选。

避免：

1. **多态引用"类型 + id"到处散布，且无外键**。我们的角色是按卡片的（Worker/Reviewer/PM），Multica 没有按卡片的角色，只有单一负责人。我们需要自己的"卡片—session—角色"链接表，不能照搬 `assignee_type/id`。
2. **依赖表存在但没有启用**。我们要求"Worker 只看自己的卡和必需依赖"，依赖必须有真实的读写路径和校验（比如防环），不能只建表。Multica 只对父子做了环检测，且只向上走 10 层。
3. **"最终只发一条评论"只靠提示词**。我们若需要此规则，应在服务端按 run 强制，不能依赖 agent 遵守。Multica 里只有 squad 的 `no_action` 是服务端强制的。
4. **没有提议状态，也没有人类最终验收的强制**。我们的"Worker 只能提议新卡、只有人最终验收"需要服务端状态和权限检查。Multica 的 Triage 只有一个 `pending` 值，agent 默认可以自己把卡片推到完成，不能当作模板。
5. **没有文件范围信息，冲突靠目录锁或 git worktree**。我们要求"两张卡不同时改同一文件"，这需要卡片或 run 上有范围字段并在派发时比较；Multica 的做法只能在目录粒度串行，或在合并时才发现冲突。
6. **activity_log 由事件总线异步写入，不在业务事务内**。我们要求"卡片状态与历史一致"，应在同一事务里写变更和历史。Multica 的 `issue_child_event` 和唤醒收据是在事务内写的，值得学这一类，不要学活动日志。

## 11. 未核实与未读

- `issue_dependency` 是否在非 Go 代码（前端、CLI）里有入口：我只在 `server/` 里 grep，前端和 CLI 目录没有查。结论"未启用"仅限服务端。
- "一个 run 至多一条评论"：只读到提示词（runtime_config_sections.go:881）和客户端类型白名单，没有逐个读评论处理函数里是否有按 `source_task_id` 计数的检查。
- 评论上传文件的版本号怎么存（`attachment` 表无版本列，版本可能由文件名+类型分组推导）：未读上传与展示代码。
- 谁能把卡片设为 done、agent 能否自行验收：`UpdateIssue` 全文只读了乐观锁、父子、stage、工作流、分配几段（H:issue.go:3831-4240），没有找到状态级权限限制，但没有读完整函数。
- run 令牌（`task_token`）是否限制 agent 只能访问本卡或有依赖的卡：只读了表和文档的一句话。
- 目录锁（`waiting_local_directory`）的持有位置：只读到状态标记，没读守护进程侧实现。
- agent 创建的卡片是否自动进入 triage，及 `triage_state` 的写入点：未读。
- `issue_wakeup` 表结构、autopilot、chat、plugin、channel、quick action 等：与卡片数据模型关系远，未读。
- `G:` 是 sqlc 生成文件，反映当前表结构，但个别列的原始 DDL 与默认值我只读了上面引用的迁移。`docs/` 里除 `issue-status-lifecycle-rollout.md`、`engineering/issue-wakeups.md` 外的文档未读。
- 文档 URL：本报告引用仓库内路径。公开站点 URL 未核实；仓库内同路径可查：https://github.com/multica-ai/multica/tree/a7a61f15f148ba8c901fe24a36a61d6d73e247d6/apps/docs/content/docs
