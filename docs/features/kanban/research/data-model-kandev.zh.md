# kandev 数据模型拆解

路径均相对主工作区的 `refs/agent-kanban/kandev/apps/backend/internal/`（缩写 `I/`），commit `ce9918b094855c38e5b3b4c79c1b565fe5c379cb`（简写 ce9918b）。AGPL-3.0，只借鉴思路，不复制代码。

## 1. 身份

- URL：https://github.com/kdlbs/kandev
- License：AGPL-3.0（仓库根 `LICENSE`；`README.md:330`）
- 技术栈：Go 后端（`apps/backend/go.mod`：go 1.26、sqlx、go-sqlite3、pgx、mcp-go、nats），Web 前端，桌面壳（`apps/desktop`）
- 存储：SQLite 与 PostgreSQL 两种方言（`go.mod` 同时引入两个驱动；`I/persistence/storeconformance/testdata/upgrades/v0.93.0/` 下有 sqlite.sql 与 postgres.sql 两份升级基线）
- 注意：代码里有两层产品。"kanban"（看板任务 + 工作流步骤）和 "office"（带负责人、项目、预算的编排层）共用 `tasks` 表。本报告以 kanban 为主，office 只在影响任务模型处提及。
- 规模：仓库很大（后端 `internal/` 下 100+ 个包），我只读了任务、工作流、MCP、协调者（coordinator）相关部分。

## 2. 实体与关系

核心实体（Go 结构体；表结构以 v0.93.0 升级基线 `I/persistence/storeconformance/testdata/upgrades/v0.93.0/sqlite.sql` 核对，行号见括号，该基线早于 HEAD，是旧快照）。

- Task（`I/task/models/models.go:1561`；表 `tasks`，sqlite.sql:1270）
  - `ID`、`WorkspaceID`、`WorkflowID`、`WorkflowStepID`（任务当前所在列）
  - `Title`、`Description`
  - `State` v1.TaskState（见第 3 节）
  - `Priority` critical|high|medium|low（表上有 CHECK 约束）
  - `Position int`（步骤内排序）
  - `WIPAdmitted bool`、`QueuedForStepID`、`QueuedAt`：WIP 限额排队
  - `ParentID string`：父任务（子任务）
  - `Autopilot bool`：创建时固定
  - `Origin`：manual|agent_created|routine|onboarding|automation_run|automation_task|coordinator（:1541-1553）
  - `Metadata` JSON、`Labels` JSON 字符串、`Identifier`（如 "KAN-42"）
  - `ExternalID`、`ExternalIDSettledAt`：创建幂等，`(workspace_id, external_id)` 唯一
  - `ArchivedAt`、`ArchivedByCascadeID`：归档
  - 负责人：`AssigneeAgentProfileID`（读时投影，真实存储在 `workflow_step_participants` 的 runner 行，:1618-1627）、`AssigneeUserID`（人类负责人，只作提示，不做限制，:1631-1635）
- Workflow（`:1893`）：`Name`、`Prompt`、`AgentProfileID`、`Source`（manual|github）、`Style`（kanban|office|custom，仅前端提示）。
- WorkflowStep（`I/workflow/models/models.go`，约 :265-300）：一个步骤就是看板的一列。
  - `Position`、`IsStartStep`、`AllowManualMove`、`WIPLimit`、`PullFromStepID`
  - `StageType` work|review|approval|custom|hold（`I/workflow/models/phase2.go`）
  - `Events`：`on_enter`、`on_turn_start`、`on_turn_complete`、`on_exit` 与 `on_comment`、`on_blocker_resolved`、`on_children_completed`、`on_approval_resolved`、`on_pr_merged` 等动作列表（:140-160）
  - `AgentProfileID`、`SessionTarget`、`AutoAdvanceRequiresSignal`、`CompleteTaskOnEnter`、`OrderRevision int64`
- TaskSession（`I/task/models/models.go:2481`）：见第 7 节。
- TaskEnvironment / TaskEnvironmentRepo：见第 7、9 节。
- Message（:2290）：会话内的消息，`TaskSessionID`、`TaskID`、`TurnID`、`AuthorType`、`Content`、`Type`、`Metadata`。
- Turn（:2375）：一次 agent 回合。
- TaskPlan（:3356）：任务的计划文档，一个任务一份，带 `WriteVersion`（乐观并发令牌）、`CommentsRevision`。
- task_documents、task_plan_revisions：任务文档与计划版本（sqlite.sql:858、其后）。
- Proposal（协调者的提议，`I/coordinator/models.go:120`）：见第 8 节。

关系怎么存：

- 父子：`tasks.parent_id` 列，单父。创建工具描述写明 "Kanban allows one subtask level"（`I/mcp/server/server.go:1637` 附近的 `toolDesc`），用 `parent_id="self"` 创建时若调用者已是子任务，会改成其同级（`I/mcp/handlers/create_task_self_placement.go`）。office 层是否允许多级：[未核实]。
- 依赖/阻塞：关联表 `task_blockers(task_id, blocker_task_id, created_at)`，主键 `(task_id, blocker_task_id)`，`CHECK (task_id != blocker_task_id)`（sqlite.sql:826-832）。
  - 加边：`AddDependency`（`I/task/service/service_dependencies.go:174`）检查自依赖、ID 长度、授权、同工作区（:134-159）、环（`checkDependencyCycle` :546，遍历上限 `dependencyCycleWalkLimit = 1000`）。每个任务的依赖数上限 512。
  - 创建时可带 `blocked_by`（见第 7 节 MCP 工具）。
  - 设计说明在工具描述里："A subtask means 'part of'; a dependency means 'not until'"（`I/mcp/server/server.go:1660` 附近的 `blockedByParamDesc`）。父子和依赖是两种独立的边。
- 重复/相关：任务间还有 "related" 概念（`list_related_tasks_kandev`、`AddTaskRelationExact` :212）[其存储未读]。
- 步骤与任务：`tasks.workflow_step_id` 列。步骤转换历史见第 4 节。

## 3. 状态

两套状态，不要混：

1. 任务状态 `Task.State`（`pkg/api/v1/task.go:9-18`）：`TODO | CREATED | SCHEDULING | IN_PROGRESS | REVIEW | BLOCKED | WAITING_FOR_INPUT | COMPLETED | FAILED | CANCELLED`。存 `tasks.state`（TEXT）。
2. 看板列（工作流步骤）`tasks.workflow_step_id`。用户看到的"列"是它。

- 合法流转：没有转换表。`UpdateTaskState` 只跳过 old == new 的空操作，然后直接写（`I/task/service/service_workflow.go:186-203`）。MCP `update_task_kandev` 只校验 state 是不是合法枚举值，并做别名归一（"done"/"complete" -> COMPLETED，`I/mcp/handlers/config_task_handlers.go:797-830`）。
- 步骤流转由工作流引擎驱动：步骤上的事件动作 `move_to_next | move_to_previous | move_to_step`；触发源有 manual、auto_complete、approval、on_turn_start、on_children_completed、on_pr_merged 等（`I/workflow/models/models.go` 的 `StepTransitionTrigger`）。步骤上 `AllowManualMove` 决定人能不能手动拖。
- 依赖门：`DependencyGate`（`service_dependencies.go:875`）只看前置任务的 State：COMPLETED 算已解决，FAILED/CANCELLED 算失败，其他算未完成（:857-870）。前置失败会使后继保持阻塞，需人工处理（工具描述 `add_task_dependency_kandev`）。
- 会话状态 `TaskSession.State`：`CREATED | STARTING | RUNNING | IDLE | WAITING_FOR_INPUT | COMPLETED | FAILED | CANCELLED`（`models.go:2433-2444`）。
- 谁能改：
  - agent 的 MCP 调用经 `guardedMCPDispatcher`（`I/mcp/handlers/automation_authorization.go:23-42`）。该分发器只对 automation 和 coordinator 两类调用者做动作白名单。
  - 对普通任务 agent，`handleUpdateTask`（`I/mcp/handlers/handlers.go:2144`）自身没有"只能改自己的任务"的检查。任务服务里有工作区级作用域授权（`authorizeTaskScope`，`I/task/service/service_access.go:188-195`），按"工作区读/写/管理"等作用域判断，不是按任务或角色。
  - 因此我读到的结论是：任务 agent 可通过 `update_task_kandev` 改同工作区其他任务的字段与状态 [部分未核实：未读 `authorizeTaskScope` 的实现与 `UpdateTask` 的全部授权调用]。
  - 只有少数工具带父子限制：`stop_task_kandev`（只有直接父任务能停子任务）、`message_task_kandev` 的 `interrupt` 模式（只有直接父任务）、`add_workspace_sources_kandev`（只有直接父任务能给子任务挂源，`handlers.go:2424`，`task_target_access.go`）。

## 4. 历史与并发

- 步骤转换账本 `task_step_transitions`（sqlite.sql:1177）：`StepTransition{ID, FromWorkflowID, FromWorkflowStepID, ToWorkflowID, ToWorkflowStepID, Trigger, OccurredAt}`（`I/task/models/step_transitions.go`）。只追加，`Task.WorkflowStepTransitionID` 是最近一次写入的行号（临时字段，不入 tasks 表，`models.go:1593`）。
- 会话步骤历史 `SessionStepHistory`：`SessionID`、`FromStepID`、`ToStepID`、`Trigger`、`ActorID`、`Metadata`（`I/workflow/models/models.go` 约 :430）。
- 转换发起者：`StepTransitionActor` = human|agent|system。
- 管理权账本 `TaskManagementClaim`（`models.go:1679`）与 `TaskManagementClaimHistory`（:1721）：任务级"谁在管理它"的认领，带 `Generation int64` 与 `ResourceVersion string`，动作 acquire|transfer|release，change 请求里带 `ExpectedTaskResourceVersion`、`ExpectedClaimResourceVersion`（:1696-1712）。这是乐观锁 + 围栏令牌的组合。
- 其他并发令牌：TaskPlan 的 `WriteVersion`（:3356 附近）、WorkflowStep 的 `OrderRevision`、TaskEnvironment 的 `OwnershipGeneration`（:3122 附近）。
- 软删除：任务用 `archived_at`；工作树记录有 `deleted_at`（`TaskEnvironmentRepo.DeletedAt`，:3185 附近）。归档级联用 `archived_by_cascade_id` 标记，恢复时只恢复这次级联归档的后代（`models.go:1599-1604` 注释）。
- 事件：服务层每次变更发布事件（如 `events.TaskStateChanged`，`service_workflow.go:218`），事件总线使用 NATS（`go.mod`）。

## 5. 评论、交付物与证据

- 没有"任务评论"表。任务上的交流是会话里的 Message（`TaskSessionID` + `TaskID` + `TurnID`）。
- 计划：`TaskPlan`（每任务一份，`CreatedBy` agent|user）和 `TaskPlanComment`（用户对计划的批注，带 `SelectedText`、`AnchorFrom`，:3375 附近），agent 用 `create_task_plan_kandev`、`get_task_plan_kandev`、`update_task_plan_kandev` 读写。
- 文档：`task_documents`，agent 用 `list_task_documents_kandev`、`get_task_document_kandev`、`write_task_document_kandev`（`I/mcp/server/handoff_handlers.go:40-62`）读写，用于任务间交接。
- 步骤完成信号：`step_complete_kandev(summary, handoff?, blockers?)`（`I/mcp/server/server.go:1910` 附近）。
  - `summary` 必填，展示给用户。
  - `handoff` 只传给紧随其后的步骤 agent 一次，上限 8192 字节。
  - `blockers` 记在本步骤的转换历史里，不传给下一步。
  - 信号写在会话 metadata 的 `pending_step_completion_signal` 键（`models.go:1154`），由编排器消费。
- 代码审查结果：另一套 `TaskReviewRun` 与审查发现（findings），MCP `ActionMCPPublishReviewFindings`（`I/mcp/handlers/review.go:36-45`）；会话上还有 `review_status`（空|pending|approved，`models.go:2397-2410`）。
- 验证记录：没有"验收标准"这类结构化表。验证靠两种机制：步骤上的审查/审批决定（第 6 节），或原生代码审查（`on_enter` 动作 `run_code_review`，可选 `agent_profile_id`，让不同模型来审，失败不阻塞转换，`workflow/models/models.go:46-55`）。
- 变更/PR 关联：`task_change_request`、PR/MR 自动化（`task_pr_automation.go` 等）[未深读]。

## 6. 角色与权限的存储

- 任务负责人：agent 负责人是单值（`workflow_step_participants` 里 role=runner 的那一行），人类负责人另有单值字段 `AssigneeUserID`，两者独立、互不清除，且人类负责人"不限制任何操作"（`models.go:1631-1635`）。
- 步骤参与者 `WorkflowStepParticipant`（`I/workflow/models/phase2.go`）：`StepID`、`TaskID`（可空，空表示步骤级默认）、`Role`、`AgentProfileID`、`DecisionRequired bool`、`Position`、`Provenance`（auto|manual）。
  - 角色枚举：`reviewer`、`approver`、`watcher`、`collaborator`、`runner`。
  - 所以"角色"绑在（步骤，任务）上，不绑在 agent 上；一个 agent profile 可以在不同步骤担任不同角色。
- 审批决定 `WorkflowStepDecision`（`workflow_step_decisions`，sqlite.sql:1371）：`TaskID`、`StepID`、`ParticipantID`、`Decision`、`Note`、`DecidedAt`、`SupersededAt`、`DeciderType`（agent|user）、`DeciderID`、`Role`、`Comment`。被取代的决定用 `superseded_at` 标记，不删除。
- 法定人数守卫（`I/workflow/engine/quorum.go`）：步骤转换可带 `wait_for_quorum` 守卫，阈值：`all_approve`、`all_decide`、`any_reject`、`majority_approve`、`n_approve:<N>`（:35-42）。只统计 `decision_required` 的 reviewer/approver 席位。`changes_requested` 等同 `rejected`（:79 `isRejectionVerdict`）。未满足时返回 `threshold_not_met` 等封闭的原因码集合（:56-66）。
- 记录决定时检查决定者占着有效席位（`ErrParticipantNotFound`，quorum.go:925 `ResolveParticipantRole`；office 层 `RecordDecision` 在 `I/office/engine_dispatcher/dispatcher.go:279`）。
- 人与 agent 区分：`DeciderType` agent|user；`TaskSession` 有 `ExecutorActorUserID`；创建者类 provenance 用 `ActorKind`。
- MCP 工具的权限（决定哪些工具对 agent 可见）：
  - 按"界面（surface）"分：`kanban-task`、`office-task`、`configuration`、`external`、`automation`、`managed-conversation`、`coordinator`（`I/mcp/profile/profile.go:25-33`）。
  - 按"能力"开关：`user-question`、`parent-question`、`task-title`、`github-pr`、`canvas-authoring`、`workspace-collaboration-report` 等（:35-45）。
  - 内置工具归入包：`PackageCore` 等（`I/mcp/profile/builtin_catalog.go`）。
  - 调用时校验：`MCPExecutionContext.BuiltinAuthority.Allows(action)`（`automation_authorization.go:25`）。
  - 数据层授权：`authz.Scope`（`workspace.read`、`session.prompt`、`workspace.manage` 等）在任务服务内判断（`service_access.go:188-211`）。
- 没有"每卡一个角色，嵌套"的概念；父子关系只授予有限的专门权限（停止、打断、挂源、答复父问题）。

## 7. 任务与执行的关联

- 任务 -> 会话：一对多。`task_sessions.task_id`（外键，级联删除，sqlite.sql:1134 起）。
  - `TaskSession.IsPrimary`：每个任务一个主会话。
  - 会话字段（`models.go:2481`）：`AgentProfileID`、`ExecutionProfileID`、`ExecutorID`、`ExecutorProfileID`、`EnvironmentID`、`RepositoryID`、`BaseBranch`、`BaseCommitSHA`、`WorkspacePath`、`State`、`ReviewStatus`、`CostSubcents`、`TokensIn/Out`、各类 Snapshot（`AgentProfileSnapshot`、`ExecutorSnapshot`、`EnvironmentSnapshot`、`RepositorySnapshot`）、`StartedAt`、`CompletedAt`、`TaskEnvironmentID`。
  - 快照字段说明会话创建时的配置被冻结保存，之后改 profile 不影响历史。
- 会话 -> 回合：一对多，`Turn{TaskSessionID, TaskID, ExecutionProfileID, StartedAt, CompletedAt}`（:2375）；Message 带 `TurnID`。
- 任务 -> 环境（工作树）：`task_environments(task_id …)`，`TaskEnvironment{TaskID, OwnershipGeneration, ExecutorType, Status(creating|ready|stopped|failed), WorkspacePath, ContainerID, TaskDirName, Repos[]}`（:3122）；会话通过 `task_sessions.task_environment_id` 指向环境（"共享环境"，:2560 附近注释）。
  - 环境下的 `TaskEnvironmentRepo` 才是物理工作树：`RepositoryID`、`BranchSlug`、`WorktreeID`、`WorktreePath`、`WorktreeBranch`、`MergedAt`、`DeletedAt`，唯一键 `(task_environment_id, repository_id, branch_slug)`（:3185；sqlite.sql:876-892）。
  - 所以"一任务一工作树"实际是：一任务一环境，环境内每个（仓库，分支）一个工作树，多个会话共用环境。
  - `worktree.Worktree` 结构的注释写着 "Multiple worktrees can exist for the same task (one per agent session)"（`I/worktree/worktree.go:35-48`），同时又说物理记录在 `task_environment_repos`。两处说法不完全一致，以环境表为准 [未核实旧字段是否仍写入]。
  - 子任务默认继承父任务的工作区和工作树（`workspace_mode: inherit_parent`，`new_workspace` 则另建）。所以父子任务可能共用同一个工作树。
- 执行位置：`ExecutorProfileID`（local、worktree、docker、ssh 等，`create_task_kandev` 的 `executor_profile_id` 描述）。
- 执行结束后保留：会话行（含终态 COMPLETED|FAILED|CANCELLED）、回合、消息、Snapshot、用量；工作树在 `stop_task_kandev` 后明确保留（"Worktrees, commits, records, descendants, and queued messages are preserved"，`server.go:1485` 附近）。CANCELLED 的会话不可恢复，只能用 `spawn_session_kandev` 开新会话（同一工作区）。

### 任务 MCP 工具（名称与参数，`I/mcp/server/`）

任务创建与结构：
- `create_task_kandev`（`server.go:1632` 附近）
  - 参数：`parent_id`（可为 "self"）、`workspace_id`、`workflow_id`、`workflow_step_id`、`workspace_mode`（inherit_parent|new_workspace）、`title`（必填，≤60 字符）、`prompt`、`priority`、`autopilot`、`agent_profile_id`、`executor_profile_id`、`start_agent`（默认 true）、`repository_id`、`local_path`、`repository_url`、`base_branch`、`external_id`、`blocked_by[]`、`start_when_unblocked`。
  - 能改什么：创建新任务；`blocked_by` 同时写依赖边；`start_agent` 启动 agent。子任务继承父任务的工作区、工作流、仓库、profile、执行器。
  - 限制：不能设负责人（`assignee_agent_profile_id` 报错，"office-only"，`handlers.go:920`）；带 `start_agent` 的子任务必须有描述，作为 agent 的唯一初始上下文（`handlers.go:932`）。
  - 一个重要细节：有 `blocked_by` 时 `start_agent=true` 只记录"解除阻塞后启动"的意图（`start_when_unblocked` 默认 true），不立即启动。
- `update_task_kandev`（`server.go:1500` 附近）：参数 `task_id`、`title`、`description`、`priority`、`state`、`deferred_launch_prompt`。只改这些字段；`deferred_launch_prompt` 只对"带 blocked_by 且尚未启动"的任务有效，已启动则拒绝，且同一次调用的其他字段也不应用。
- `add_task_dependency_kandev(task_id?, depends_on_task_id)`、`remove_task_dependency_kandev(task_id?, depends_on_task_id)`：`task_id` 默认当前任务。移除最后一条边只解除阻塞，不会自动启动。
- `move_task_kandev`、`delete_task_kandev`、`archive_task_kandev`、`update_task_state_kandev`（`core_task_tools.go:24-103`）：移动到某步骤、删除、归档、改状态 [参数细节未逐一读]。
- `transfer_task_kandev`（`server.go:1376`）[未读]。
- `set_task_title_kandev`：一次性标题交接。

任务间消息与会话：
- `message_task_kandev(task_id, session_id?, prompt, delivery_mode?, reply_to_question_id?)`（`server.go:1470`；处理 `handlers.go:2865`）
  - `delivery_mode`：`queued`（默认，等对方当前回合结束）、`interrupt`（取消对方当前回合并立即投递，只允许发送者是目标的直接父任务，否则 Forbidden，`handlers.go:2934-2940`）、`report`（需要启用工作区协作能力，追加状态报告，不唤醒对方）。
  - 不能给自己发消息；要给自己任务的兄弟会话发，必须带 `session_id`（:2889-2896）。
  - 消息被包一层 "来自哪个任务/会话" 的头（`wrapAgentMessage`）后写入目标会话，发送者信息放在消息 metadata（`senderMeta`）里。
  - 对任何同工作区任务可发送，没有"只能发给相关任务"的限制 [部分未核实：`resolveMessageTargetSession` 与服务层作用域检查未全读]。
  - `reply_to_question_id`：答复自动驾驶子任务的问题，幂等（`parent_question.go`）。
- `stop_task_kandev(task_id)`：停止直接子任务的所有会话，只有直接父任务可调用；会话变 CANCELLED，可停任务进 REVIEW；不发 prompt。
- `spawn_session_kandev(prompt, agent_profile_id?, name?, task_id?)`：在已有任务上再开一个会话（不新建任务），共享工作区和对话界面，返回 `{task_id, session_id, state, agent_profile_id}`。
- `list_task_sessions_kandev(task_id)`：列出会话（name、state、is_primary、is_current、agent_profile_id、时间戳）。
- `get_task_conversation_kandev`、`list_tasks_kandev`、`list_related_tasks_kandev`：只读。
- `ask_parent_question_kandev`：只有自动驾驶子任务可用。向直接父任务发一条持久的问题消息并暂停本回合，不等待；父任务用 `message_task_kandev` + `reply_to_question_id` 回答（`server.go:2043-2046`）。
- `step_complete_kandev`：见第 5 节。

## 8. 提议、草稿或审批

kandev 有一套专门的"提议"机制，在协调者（coordinator）里，不在任务表里：

- `propose_task_kandev(title, description, rationale, workflow_id, step_id?, repository_id?, source_task_id?, in_reply_to?, standing_order_ids?)`（`I/mcp/server/coordinator_tools.go:91`）。工具描述写明 "never creates a task by itself: it stores a pending proposal that a workspace manager must approve before any task or agent exists"。
- Proposal（`I/coordinator/models.go:120`）：`Status`、`Spec`、`FinalSpec`（批准时可被改）、`ClaimedAt`、`ClaimToken`、`TaskID`（批准后生成的任务）、`Error`、`RejectReason`、`DecidedBy`、`Kind`、`TargetTaskID`、`StartsAgent`、`ReplyText`、`InReplyTo`（修订退回的提议）、`DecidedAutomatically`、`AutomaticAt`。
- 状态：`pending | approving | approved | rejected | failed | returned`（`models.go:97-104`）。`returned` 只能从 `pending` 进入，由管理者回复触发；agent 用 `in_reply_to` 提交修订版。
- `approving` 是中间态，配合 `ClaimToken`/`ClaimedAt` 做认领，防止两个批准动作同时执行（`approve.go:64`、`readForApprove` :97）。
- 提议种类 `Kind`：`create_task`、`message`、`move`、`resume`、`improvement`（:174-178）。对应工具：`propose_message_kandev`、`propose_move_kandev`、`propose_resume_kandev`、`propose_improvement_kandev`。也就是说提议的不只是"新卡"，还有"向某任务发消息""移动""恢复"。
- 自动批准：存在 `automatic_approve.go`，条件之一是 `phase3` 开启且 `Kind == create_task` 且 `!StartsAgent`（:100）[完整条件未读]。
- 谁能批准：工具描述写 "workspace manager"，数据上是 `workspace.manage` 作用域。
- 范围：这套机制挂在协调者（一个对话式的看板助手）上，调用者界面是 `SurfaceCoordinator`（`profile.go:33`）。普通任务 agent 不用它，而是直接 `create_task_kandev` 创建子任务（无审批）。

## 9. 文件、路径或范围信息

- 任务不记录"将要改哪些文件"。记录的是仓库和分支：`TaskRepository`（`models.go:1964`）、`TaskEnvironmentRepo`（仓库 + 分支 slug + 工作树路径）、会话上的 `BaseCommitSHA`（"Git commit SHA at session start (for cumulative diff)"）。
- 已改文件通过 git 差异得到：`I/task/changes/`（`coordinator_*.go` 处理导出、恢复、清理）、`models.TurnChanges`（`turn_changes.go`）按回合记录变化 [细节未读]。
- 冲突检测：
  - 物理工作树层面有互斥：`physicalclaim.Lock` 对工作树槽位（`Slot{ID, EnvironmentID, RepositoryID, BranchSlug}`）加锁，序列化"物理库存归属"的认领（`I/task/physicalclaim/claim.go`）；PostgreSQL 用 advisory 锁，SQLite 依靠写事务（注释）。
  - 这只防止两个会话同时认领同一个槽位，不是任务级的"同一文件被两张卡同时修改"检测。
  - 任务级文件冲突检测：未找到 [未核实]。
  - 隔离靠"每任务（或继承父任务）一个独立工作树 + 独立分支"，冲突留到合并时处理。子任务默认继承父工作树，意味着父子不隔离。

## 10. 对我们的启示

借鉴：

1. 提议用独立表，不用卡片上的 "proposed" 状态。Proposal 有 `Spec`（agent 提的）与 `FinalSpec`（批准时的）、`Status`、`DecidedBy`、`RejectReason`、`TaskID`（批准后生成的卡）、`InReplyTo`（修订链）。对应"Worker 只能提议、PM 或人决定"：提议与真卡分离，批准后才生成卡，被拒的提议不污染卡片表。我们还要加"提议人"和"目标父卡"。
2. 提议带中间态与认领令牌：`pending -> approving -> approved|failed`，`ClaimToken` 防双批。对应"服务器检查每次变更"和单用户下多个 session 同时批准的情形。
3. 退回状态 `returned`：管理者回复，提议人修订后用 `in_reply_to` 重新提交。对应 PM 与 Worker 之间的来回。
4. 依赖与父子是两种边，分开存：`parent_id` 列表示"属于"，`task_blockers` 关联表表示"必须先完成"；加边时统一校验自依赖、同范围、环（带遍历上限）。对应"卡片依赖"和"PM/子卡嵌套"。前置失败会使后继保持阻塞并等人处理，而不是自动重试（`DependencyGate`）。
5. 审批决定独立成表，带席位与决定者类型：决定行记录 `ParticipantID`、`DeciderType`、`Role`、`Decision`，被取代的决定用 `superseded_at` 标记。对应"Reviewer 独立于 Worker"和"只有人最终验收"（可以让最终席位的 `DeciderType` 只接受 user）。
6. 会话与任务的关联独立于任务树，并冻结配置：`task_sessions.task_id` 一对多，会话上存 profile、执行器、环境的 Snapshot，回合与消息挂在会话下。执行历史在会话结束后保留。对应"session 与卡片的链接独立于 session 树"和"历史在 session 之后仍在"。

避免：

1. 任务状态没有转换表，`UpdateTaskState` 直接写；`update_task_kandev` 只验枚举。我们要求服务器检查每次变更，应把合法流转写成表并只留一个变更入口。
2. 权限按"工作区作用域"和"界面/工具包"划分，而不是按每张卡的角色。任务 agent 看起来能改同工作区的其他任务（第 3 节，部分未核实）。我们的 Worker 只能看自己的卡，需要按卡的角色检查。
3. 人类负责人与 agent 负责人是两个独立字段，人类负责人"不限制任何操作"（`models.go:1631`）。我们的"人批准分配"要有强制力，不能只是提示字段。
4. 子任务默认继承并共用父任务的工作树（`inherit_parent`）。对应"两张卡不应同时改同一批文件"：父子默认不隔离，冲突检测只在工作树槽位层，不在文件层。
5. 子任务一级限制写在工具描述与创建逻辑里，不是数据模型的约束（`parent_id` 列本身不限制深度）。我们要嵌套的角色（Worker 同时是子卡的 PM），应该在数据模型里明确深度规则。
6. 两层产品共用一张 `tasks` 表（office 字段通过读时投影、负责人落在参与者表）。字段含义随 `Origin` 和是否 office 而变，难以理解。我们应保持一张卡一种语义。

## 11. 未核实与未读

- `update_task_kandev`、`message_task_kandev` 对"调用者是否有权限操作目标任务"的服务层检查：只读到 `authorizeTaskScope` 的入口（`service_access.go:188-211`），未读实现与全部调用点。
- `move_task_kandev`、`delete_task_kandev`、`archive_task_kandev`、`update_task_state_kandev`、`transfer_task_kandev` 的参数与限制：只看到注册名。
- 任务间"related"关系的存储（`AddTaskRelationExact`）：未读。
- 每个步骤的 `WIPLimit` 与 `PullFromStepID` 的行为：未读。
- office 层（`I/office/`）的负责人、预算、项目、`checkout_agent_id` 等字段（sqlite.sql:1270 的 tasks 表里有 `checkout_agent_id`、`checkout_at`、`checkout_run_id`，疑似任务签出机制）：未读。
- 协调者的自动批准完整条件：只读到 `automatic_approve.go:100` 一处。
- 步骤引擎的动作执行与失败处理（`I/workflow/engine/engine.go` 等）：只读了常量和模型。
- sqlite.sql 基线是 v0.93.0，早于当前 HEAD，表列可能有增减；以 Go 结构体为准。
- 文档类声明（README 中的 "kanban plus pipeline workflows with review gates, one worktree per task"）以任务给出的描述为准，未重新抓取 URL；`docs/specs/` 下的规格文档未读。
- 未运行、未构建任何代码。
