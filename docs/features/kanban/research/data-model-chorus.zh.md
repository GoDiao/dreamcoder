# Chorus 数据模型拆解

以下路径均相对主工作区的 `refs/agent-kanban/Chorus/`，commit `f50513ee84638152afe5bd22a2dc9092d0c4eb42`（简写 f50513e）。AGPL-3.0，只借鉴思路，不复制代码。

## 1. 身份

- URL：https://github.com/Chorus-AIDLC/Chorus
- License：AGPL-3.0（`LICENSE.txt:1`）
- 技术栈：Next.js（App Router）、Prisma、MCP server（`src/mcp/server.ts:15`）
- 存储：PostgreSQL，`relationMode = "prisma"`，不建数据库外键，关系由应用层维护（`prisma/schema.prisma:9-11`）
- 多租户：所有表带 `companyUuid`。我们不需要这一列。
- 主键惯例：`id Int` 自增 + `uuid String` 公开 ID。

## 2. 实体与关系

核心链路：Idea -> (Elaboration) -> Proposal -> Document + Task -> 执行 -> 验证 -> Done。

实体与关键字段（`prisma/schema.prisma`）：

- Idea（:338）
  - `status` string：`open | elaborating | elaborated`，只有三态。
  - `assigneeType/assigneeUuid`（user|agent，多态）、`assignedAt`、`assignedByType/Uuid`。
  - `parentUuid`：单父 forest，自引用，`onDelete: Restrict`（:361）。`isContainer` bool。
  - `elaborationDepth`、`elaborationStatus`。
  - `runtimeCwd`、`cwdHost`、`cwdSource`：任务要在哪个目录执行。
- Proposal（:492）
  - `inputType`（idea|document）、`inputUuids` Json（UUID 数组）。
  - `documentDrafts` Json、`taskDrafts` Json：草稿放在 JSON 列里，不是独立表。
  - `status`、`createdByType/Uuid`、`reviewedByUuid`、`reviewNote`、`reviewedAt`。
- Document（:378）：`type`、`content`、`version Int`、`proposalUuid`（来源可追溯）。
- Task（:400）
  - `status` string；`priority` low|medium|high；`storyPoints Float?`。
  - `acceptanceCriteria` string（旧的 Markdown）+ 子表 AcceptanceCriterion。
  - 多态负责人：`assigneeType`（user|agent|agent_instance）、`assigneeUuid`、`assignedAt`、`assignedByType/Uuid`。
  - `proposalUuid?`（来源提议）、`ideaUuid?`（Quick Task 直接挂 Idea，与 proposalUuid 互斥，`:424`）。
  - `cwdSource/cwdHost/runtimeCwd`。
  - `createdByUuid`（User 或 Agent 的 UUID，无类型列）。
- TaskDependency（:451）：关联表 `(taskUuid, dependsOnUuid)`，`@@unique`，`onDelete: Cascade`。
- AcceptanceCriterion（:465）：见第 5 节。
- Comment（:526）：见第 5 节。
- Activity（:568）：见第 4 节。
- ReferenceArtifact（:547）：外部证据链接，见第 5 节。
- Agent（:119）：`roles String[]`、`permissions String[]`、`ownerUuid`、`persona`、`systemPrompt`。
- AgentInstance（:212）：`(agentUuid, host, cwd)` 唯一，是"哪个 agent 在哪台机器的哪个目录"的稳定身份。
- AgentSession（:595）+ SessionTaskCheckin（:617）：见第 7 节。
- DaemonConnection / DaemonExecution / DaemonSession / DaemonSessionTurn / DaemonTranscriptMessage：见第 7 节。
- Notification（:947）：收件人、`entityType/entityUuid`、`action`、`readAt`。

关系怎么存：

- 父子：只有 Idea 有 `parentUuid` 列（单父，一种无区分的边，`:358` 注释写明"语义由上下文决定"）。Task 没有父子列，也没有子任务。拆分只通过 Proposal 一次生成一批 Task。
- 依赖/阻塞：Task 之间用 `TaskDependency` 关联表，是 DAG。
  - 加边时检查自依赖、同项目、环（`src/services/task.service.ts:1425-1452`，`wouldCreateCycle` 在 :1383）。
  - Proposal 草稿阶段用 `taskDrafts[].dependsOnDraftUuids`（JSON 里的草稿 UUID），批准时映射成真实 Task 的边（`src/services/proposal.service.ts:~985-1000`）。草稿环检查在 `findDependencyCycles`（:272）。
- 来源：`Task.proposalUuid`、`Document.proposalUuid` 列，不是关联表。
- 重复/相关：未发现。

## 3. 状态

Task：`open | assigned | in_progress | to_verify | done | closed`，存在 `Task.status`（string，无 DB 枚举）。

- 合法流转写在代码常量里（`src/services/task.service.ts:149-157`）：
  - open -> assigned, closed
  - assigned -> open, in_progress, closed
  - in_progress -> to_verify, closed
  - to_verify -> done, in_progress, closed
  - done -> closed；closed -> 无
- 检查位置有三处，各自调用 `isValidTaskStatusTransition`（:159）：
  - REST：`src/app/api/tasks/[uuid]/route.ts:129`
  - MCP `chorus_update_task`：`src/mcp/tools/public.ts:1390`
  - MCP `chorus_report_work`：`src/mcp/tools/developer.ts:293`（非法流转时静默不改状态，仍写评论）
- `updateTask` 本身不检查流转（`task.service.ts:814`）。调用方必须先检查。
- 谁能改：
  - claim `open|assigned -> assigned`：原子更新，WHERE 带 `status in (open, assigned)`（`task.service.ts:918-975`）。
  - release `assigned -> open`：WHERE `status: "assigned"`（:980）。
  - `in_progress`、`to_verify`：只有负责人（`isAssignmentOwnedByActor`，`src/lib/uuid-resolver.ts:160`）。MCP 的 status 枚举只允许这两个值（`public.ts:1350`），agent 无法通过它写 done。
  - `done`、reopen、close：`task:admin` 权限（`src/mcp/tools/permission-map.ts:90-92`）。
  - 进入 `in_progress` 时检查依赖全部 `done|closed`（`task.service.ts:1637`）。REST 允许 user/super_admin 用 `force` 绕过并记 `force_status_change` 活动（route.ts:~138-150）。
  - 进入 `done` 前检查必填验收标准全部 `passed`（`checkAcceptanceCriteriaGate`，:1288）。无标准时放行。
  - 离开 `to_verify` 且目标不是 done：所有验收标准重置为 pending（`updateTask` 内，:~862-880）。

Proposal：schema 注释写 `draft | pending | approved | rejected | revised`（:508），代码实际使用 `draft | pending | approved | closed`。
- submit：draft -> pending，先跑完整校验（`proposal.service.ts:1229-1260`）。
- approve：pending -> approved（MCP 层检查 pending，`src/mcp/tools/admin.ts:~78`；服务层 `approveProposal` :913 不检查）。
- reject：写回 `draft` 并记 `reviewNote`（:1161），没有独立的 rejected 状态。
- close：pending -> closed，终态（`admin.ts:~115`）。
- revoke：只允许 approved，关闭已生成的 Task、删除已生成的 Document（:1073）。

Idea：三态存储，批准之后的状态由 Proposal + Task 状态推导（`computeDerivedStatus`，`src/services/idea.service.ts:1603`）。推导结果如 `human_conduct_required`（badge：answer_questions、review_proposal、verify_work）、`in_progress`、`done`。
这是"不存冗余状态，从子对象推导"的做法。

## 4. 历史与并发

- Activity 表（:568）：`targetType/targetUuid`、`actorType/actorUuid`、`action`、`value Json`、`sessionUuid/sessionName`（冗余，避免联表）。只追加。action 例：created、assigned、released、submitted、approved、verified、comment_added、force_status_change。
- 写 Activity 由各调用方（MCP 工具、API 路由）手动调用 `activityService.createActivity`，没有集中在状态变更函数里。例：`developer.ts:~200`、`admin.ts:~100`。一致性靠约定 [未核实是否有遗漏路径]。
- `updateTask` 在状态进入或离开"执行态"时，在同一事务里写 `execution_started` Activity（task.service.ts:~838-850）。
- 乐观锁：Task 没有 version 列。并发控制用条件更新：`update where {uuid, status in [...]}`，未命中抛 `AlreadyClaimedError`/`NotClaimedError`（task.service.ts:918-1010）。Document 有 `version Int`，但创建时固定写 1 [未核实更新路径]。
- ProjectAgentTeam 有 `revision Int`（:~180），用于团队配置，与任务无关。
- 软删除：Task、Idea 没有 `deletedAt`；有 `chorus_admin_delete_task` 硬删除（permission-map.ts:96）。User 有 `deletedAt`（:~70）。
- 事件广播：`eventBus.emitChange(...)` 在每次变更后发出，用于 UI 实时刷新。

## 5. 评论、交付物与证据

- Comment（:526）：`targetType`（idea|proposal|task|document）+ `targetUuid` 多态，无外键；`authorType`（user|agent）+ `authorUuid`；`content` string。平铺，无回复层级列。
- `chorus_report_work`：把进度报告写成 Task 评论（`developer.ts:~300`）。
- 交付物：没有独立"交付物"表。
  - 文档类产出：Document（来自 Proposal，`proposalUuid` 回溯）；另有 `chorus_create_report`（权限 `document:write`）写完成报告。
  - 外部证据：ReferenceArtifact（:547），多态指向 idea|proposal|task，`type`（docs|repo|issue_pr|paper_blog）、`url`、`title`、`notes`。只存链接和备注，不抓内容。
- 验证记录：AcceptanceCriterion（:465），每条一行，两套并行字段：
  - 开发自查：`devStatus`（pending|passed|failed）、`devEvidence`、`devMarkedByType/By/At`。
  - 管理员验证：`status`、`evidence`、`markedByType/By/At`。
  - `required bool`、`sortOrder`。
  - 独立成表的原因写在注释里：逐行原子更新，避免并发写冲突（:464）。
  - 写入入口：`chorus_report_criteria_self_check`（`task:write`）、`chorus_mark_acceptance_criteria`（`task:admin`）。
- 没有"评审记录"表。`chorus_request_review` 只是写一条评论并把唤醒路由给指定 reviewer（`src/services/review-request.service.ts:1-6`）。

## 6. 角色与权限的存储

- 人和 agent 区分：`AuthContext.type` 为 `user | agent | super_admin`（`src/types/auth.ts:11-47`）。
- 负责人：Task 和 Idea 都是单值，多态（type + uuid）。没有多负责人。Task 另有 `agent_instance` 类型，把任务钉在某个（agent、host、cwd）上。
- Agent 的角色存在 `Agent.roles String[]` 和 `Agent.permissions String[]`（:123-124）。权限格式 `resource:action`。
  - resource：idea、proposal、document、task、project。action：read、write、admin（`src/lib/authz/types.ts:1-5`）。共 15 个权限位。
  - 三个预设（`src/lib/authz/presets.ts:3-41`）：
    - `developer_agent`：各资源 read + `task:write`
    - `pm_agent`：idea/proposal/document/task/project 的 read+write
    - `admin_agent`：全部 15 位
  - 有效权限 = 角色预设并集 + 自定义权限（`computeEffectivePermissions`，`src/lib/authz/permissions.ts:17-40`）。
- 角色是 per agent，不是 per card：一个 agent 对所有项目任务有同一权限集。没有按卡片的角色。
- 检查位置（两层）：
  1. 工具注册时：`registerPermissionedTool` 在权限缺失时不注册该工具，agent 看不到它（`src/mcp/tools/register-helpers.ts:26-38`）。每个工具所需权限列在 `src/mcp/tools/permission-map.ts:20-102`。读工具在调用时检查（`TOOL_READ_PERMISSIONS`，:108-130）。
  2. 工具内部：状态变更工具另查"是不是负责人"（`isAssignmentOwnedByActor`）。
- 权限与工具对应（摘自 permission-map.ts）：
  - `chorus_claim_task`、`chorus_release_task`、`chorus_submit_for_verify`、`chorus_report_work`、`chorus_report_criteria_self_check`：`task:write`
  - `chorus_pm_assign_task`、各 proposal 草稿工具、`chorus_pm_submit_proposal`：`proposal:write`
  - `chorus_admin_approve_proposal`、`chorus_admin_close_proposal`：`proposal:admin`
  - `chorus_admin_verify_task`、`reopen_task`、`close_task`、`mark_acceptance_criteria`、`delete_task`：`task:admin`
- 注意：`chorus_pm_assign_task` 被映射到 `proposal:write`，注释说明是为了保持旧版边界（permission-map.ts:65-68）。权限位按资源划分，不按"动作语义"划分，所以会有这种借位。
- admin 权限的 agent 可以"代表人类"批准提议、验证任务（工具描述写 "acts on behalf of humans"，`admin.ts:~66, 164`）。即 Chorus 允许 agent 做最终验收。
- 项目访问：`ProjectMember`（:304）`role: viewer | editor | admin`，只对用户；agent 继承其 owner 的成员资格。private 项目要有成员行。
- 看不到"只能看到自己的卡"这类限制：同项目内 task:read 可读所有任务。
- 本地单用户模式：`LocalUserAudit`、`default-auth.ts` 存在 [未深读]。

## 7. 任务与执行的关联

三层，关联都是弱引用（UUID 字符串，无外键）：

1. 谁在做：`Task.assigneeType/Uuid`（agent 或 agent_instance）。
2. 会话检入（swarm 子会话）：AgentSession（:595）+ SessionTaskCheckin（:617）。
   - 多对多：一个 session 可检入多个 task，一个 task 可有多个 session。`@@unique([sessionUuid, taskUuid])`，`checkinAt`、`checkoutAt`。
   - AgentSession：`agentUuid`、`name`、`status`（active|closed）、`lastActiveAt`。
   - 作用是可观测性和依赖阻塞提示，不是执行本身。
3. 守护进程执行（daemon）：
   - DaemonExecution（:760）：`connectionUuid`、`entityType`（task|idea|proposal|document|daemon_session）、`entityUuid`、`sessionId`、`status`（running|queued|ended|interrupted）、`interruptedReason`（user|crash）、`startedAt`。唯一键 `(connectionUuid, entityType, entityUuid, sessionId)`。
     - 与任务的关系：通过 `entityType='task' + entityUuid` 指向任务，不是 Task 上的列。也可指向 idea 等，所以一个"执行"不一定是任务执行。
     - 行永不删除，`ended` 即历史（`daemon-execution.service.ts:~16-20`）。
     - `interrupted` 是粘性状态，不被快照对账改成 ended，以保留"可恢复"入口。
   - DaemonSession（:823）：`sessionId`、`backendSessionId`、`directIdeaUuid`、`originConnectionUuid`、`runtimeCwd`、`status`、各项 token 累计。唯一键 `(agentUuid, sessionId)`。会话挂在 Idea 谱系上，不直接挂 Task。
   - DaemonSessionTurn（:871）：`seq`、`trigger`（task_assigned|mentioned|elaboration|...|resume|human_instruction）、`promptText`、`wakeContext` Json、`wakeNotificationUuid`（唯一，指向触发它的 Notification）、`status`（pending|running|ended|interrupted）、`executionUuid`、`usage` Json、起止时间。
   - DaemonTranscriptMessage（:933）：只存 user/assistant 文本，不存 tool 和 thinking，按滚动窗口裁剪。
4. 唤醒路径：任务分配 -> 事件 -> 生成 Notification（`action: assigned`）-> 通知监听器 `task_assigned`（`src/services/notification-listener.ts:22, 219`）-> 创建 DaemonSessionTurn，`wakeNotificationUuid` 指向该通知 -> 守护进程拉起 Claude Code/Codex。
   - 即 "task -> notification -> turn -> execution" 的链，Task 与执行之间没有直接外键。
   - 目标位置：优先任务自己的 `agent_instance` 分配，否则继承根 Idea 的实例（`Task` 注释 :410-413）。
- 执行结束后保留：DaemonExecution（ended）、DaemonSessionTurn（含 usage 与 prompt）、转录窗口、Activity。

## 8. 提议、草稿或审批

- Proposal 是容器：一次提议带多份文档草稿和任务草稿（JSON 列），批准时在一个事务里物化为 Document、Task、TaskDependency、AcceptanceCriterion（`proposal.service.ts:913-1052`，`timeout: 15000`）。
- 草稿都有自己的 `uuid`（`ensureTaskDraftUuid`，:39）。物化时建 `draftUuid -> taskUuid` 映射（:~985）。返回值带 `materializedTasks`，可回溯。
- TaskDraft 字段：`uuid`、`title`、`description`、`storyPoints`、`priority`、`acceptanceCriteriaItems[]`、`dependsOnDraftUuids[]`、`kind`（:79-92）。
- 批准前校验：每个草稿的验收标准不能全是空白（:~940）；submit 前跑 `validateProposal`（:306），含 elaboration 门槛（E5）。
- 批准人：`reviewedByUuid` 可以是 user 或 admin agent（`admin.ts:84` 传入 `auth.actorUuid`）。
- 谁能提：`proposal:write`（PM 与 admin）。Developer 无此权限，所以 Chorus 的 worker 不能提新卡，只能改自己任务的字段和依赖（`chorus_update_task` 注释写 "Field/AC/dependency edits are open to any role"，`public.ts:1347`）。
- Quick Task：`chorus_create_task` 不带 `proposalUuid` 可直接建任务，跳过提议（`public.ts:1175`）。
- 分配审批：`chorus_pm_assign_task`（`proposal:write`）直接分配，不需要人批；`chorus_claim_task` 则是 agent 自领。是否有"分配需人批准"的开关：未找到 [未核实]。`yolo-request.service.ts` 与此相关 [未读]。
- 撤销：approved 提议可 revoke，关闭其所有 Task、删除其 Document。

## 9. 文件、路径或范围信息

- Task 不记录要改或已改的文件。没有文件列表、没有文件冲突检测。
- 只有目录锚点：`runtimeCwd`、`cwdHost`、`cwdSource`（Task 与 Idea 上），以及 `ProjectAgentCwdPreference`（:692，每个 `(user, project, agent)` 一个固定 `(host, cwd)`）。
- 两张卡在同一目录并发执行没有检查 [未核实，grep 未见互斥逻辑]。

## 10. 对我们的启示

借鉴：

1. 草稿用 JSON 放在 Proposal 上，批准时在一个事务里物化，并保留 `draftUuid -> taskUuid` 映射。对应"Worker 只能提议、PM 或人决定"：我们的 proposed 状态可以先放在草稿容器里，通过后再成为真卡。
2. 注册期权限过滤：没有权限的工具不出现在 agent 的工具列表里（`register-helpers.ts:26`），再在工具内部查负责人。对应"服务器检查每次变更"。但 Chorus 是 per agent，我们需要 per card 的角色，所以第二层检查要换成"该 session 在这张卡上的角色"。
3. 流转表 + 条件更新：合法流转放一张常量表；claim 用 `WHERE status in (...)` 做原子更新，不需要 version 列。对应单用户本地也会有多 session 并发。
4. 验收标准独立成表，开发自查与验证者两套字段并行（`devStatus` vs `status`），带证据文本和标记者。对应"Reviewer 独立于 Worker"和"只有人最终验收"。离开验证态时重置标准，防止旧结论残留。
5. 状态推导：Idea 批准后的状态从 Proposal + Task 推导，不存冗余字段。对应 PM 父卡的状态由子卡推导。
6. 执行历史独立于任务，行不删、`interrupted` 粘性、执行指向 `entityType + entityUuid`。对应"执行历史在 session 结束后保留"。

避免：

1. 权限按 agent 全局绑定，不能表达"同一 session 在父卡是 Worker、在子卡是 PM"。我们要把角色存在 session-卡 关联上。
2. admin agent 可以"代表人类"批准提议、验证任务（`admin.ts:66, 164`）。与"只有人最终验收"冲突。我们的 done 应只接受人的动作。
3. 状态流转检查散在 REST、两个 MCP 工具里，`updateTask` 本身不检查；`report_work` 非法流转时静默忽略。我们应把流转检查放进唯一的变更入口。
4. Activity 由各调用方手写，容易遗漏。我们应在变更入口里统一写事件。
5. 只有 Idea 有父子，Task 没有子任务；任务来源只靠 `proposalUuid`。我们需要卡片嵌套（子卡），不能照搬扁平 Task。
6. 多租户列（`companyUuid`）、无外键的多态 `(type, uuid)` 引用，在我们的单用户本地库里没有必要，且丢失引用完整性。

## 11. 未核实与未读

- 是否有"分配需人批准"的配置：未找到。`src/services/yolo-request.service.ts`、`start-development.service.ts` 未读。
- 所有 Activity 写入点是否齐全：未逐一核对。
- `Document.version` 的更新路径：未读 `document.service.ts`。
- 多个 session 同时 check in 同一任务时的互斥：未读 `checkin.service.ts`。
- 工作区文件冲突：grep 未见相关逻辑，但未全文检索 `src/services/daemon-*.ts`。
- `ElaborationRound/Question`（:1055-1098）只读了 schema，未读服务逻辑。
- `AgentTeam`、`ProjectAgentTeam`、`idea-team.service.ts`（团队与编排者）只读了 schema。
- 本地单用户认证（`default-auth.ts`、`local-user.service.ts`）未读。
- 文档类声明（README 的 "Idea -> Proposal -> doc + task DAG"）以任务给出的描述为准，未重新抓取 URL。
