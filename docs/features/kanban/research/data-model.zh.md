# 看板数据模型：同类项目对比

日期：2026-11-06。基线：`main` 的 `23cc8560`。

这份文档总结 7 个参考项目的数据模型，供技术设计参考。看板自己的数据模型在技术设计里按 [PRD](../prd.zh.md) 决定。分项报告见同目录下的 `data-model-*.zh.md` 和 `file-overlap-kander.zh.md`。各报告的关键结论，设计者已对照源码抽查过，抽查项列在文末。

## 一、对比

### 1. 七个项目的数据模型

| | Paperclip | Multica | Beads | Linear | Chorus | kandev | kander |
|---|---|---|---|---|---|---|---|
| 许可 | MIT | source-available | MIT | 闭源 SaaS | AGPL | AGPL | MIT |
| 父子 | `parentId` 列 | `parent_issue_id` 列，加 `stage` 分批 | 依赖表里的 `parent-child` 边 | `parent` 指针 | 只有 Idea 有，Task 没有 | `parent_id` 列 | 简述，见报告 |
| 依赖 | `issue_relations` 关联表，只有 `blocks`，写入时检测环 | 有表但没有读写路径，实际没启用 | 一张表 19 种类型，其中 4 种影响 "就绪" | `IssueRelation`，阻塞不影响任何状态 | `TaskDependency` 关联表，检测环 | `task_blockers` 关联表，检测环 | 计划里的 `PREREQUISITES` |
| 状态流转 | 只写在文档里，代码只检查状态名 | 只检查目标状态是否在工作流里 | 只检查取值 | 没找到规则 | 有常量表，但检查分散，`updateTask` 不检查 | 不检查 | 移到完成时检查评审 |
| 负责人 | 人或 agent 二选一，单值 | 单值，可以是人、agent 或 squad | 单个字符串，自报 | `assignee`（人）加 `delegate`（agent） | 单值 | 人和 agent 两个字段 | 简述，见报告 |
| 每卡角色 | 无；评审时把负责人换成评审者 | 无 | 无 | 无 | 权限按 agent 全局绑定 | 角色绑在（步骤，任务）的参与者上 | 评审者按规模和角色配置 |
| 提议 | 独立记录，接受后才建卡 | 无 | 无 | 无 | Proposal，批准时一个事务里生成任务 | 独立提议表，有退回和修订链 | 无 |
| 执行记录 | run 表，用字符串和任务关联 | run 表一对多，保留分支和工作目录 | 无 | AgentSession 一对多，状态由最后一条活动推导 | 执行记录弱关联，永不删除 | 会话一对多，保存配置快照 | 简述，见报告 |
| 历史 | 决定追加表，状态版本由触发器递增 | 活动日志，异步写入，不在业务事务里 | 事件表加只追加的来源表；硬删除 | IssueHistory，每次变更一行 | 由各调用方手写，容易漏 | 决定表，用 `superseded_at` 标记被取代的决定 | 简述，见报告 |
| 交付物 | 独立表，记录产生它的 run | run 上的分支和目录 | 来源表绑定 git SHA 和 PR | 附件按 url 唯一 | 验收标准子表 | 简述，见报告 | 简述，见报告 |
| 文件范围 | 无 | 无，只有目录锁 | 无 | 无 | 无 | 无，只有工作树槽位锁 | 事前自由文本预测，事后 `git diff` 求交集 |

### 2. 共同的缺口

这几样我们的约束要求，但几乎没有项目做：

1. **每卡角色。** 每个项目都只有单值负责人，或者把角色绑在 agent 全局。没有项目能表达 "同一个 session 在这张卡上是 PM，在那张卡上是 Reviewer"。
2. **服务端强制状态流转。** 7 个项目里只有 kander 在 "移到完成" 时检查评审；其余要么只写在文档里，要么只检查状态名。
3. **只有人能最终验收。** Paperclip 的批准者可以是 agent；Chorus 的 admin agent 可以 "代表人类" 批准。
4. **文件范围。** 只有 kander 做了，而且事前预测只是自由文本，程序不解析。

### 3. 值得借鉴的做法

1. **父子和依赖分开存。** 父子是卡片上的一列；依赖是一张关联表，加边时检测环（Paperclip、Chorus、kandev）。
2. **"就绪" 是派生的。** Beads 根据依赖算出 `is_blocked`，写依赖或状态时只重算受影响的卡。"等依赖" 和 "人为标记的阻塞" 是两回事。
3. **状态变更和历史在同一个事务里写**（Beads、Multica 的部分事件），不靠调用方手写（Chorus 的教训）。
4. **评审决定单独记录**，每条记下谁、在哪个阶段、结论（Paperclip、kandev）。不要把负责人字段换成评审者：Paperclip 这样做，事后就查不出谁是 Worker。
5. **验收标准独立记录**，Worker 自查和评审者验证分开存（Chorus）。
6. **一张卡可以有多个 session，session 的状态从它自己的状态推导**（Linear 的 AgentSession、kandev 的 task_sessions）。
7. **提议有退回和修订**（kandev 的 `returned` 加 `in_reply_to`）。
8. **乐观锁**：卡片带版本号，改动时带上自己看到的版本，过期就拒绝（Paperclip、Multica）。

## 附：抽查

设计者对照源码抽查过下面这些结论：
- Paperclip：`assertTransition` 只检查状态名（`server/src/services/issues.ts:362`）；`status_version` 由触发器递增（迁移 `0358`）。
- Multica：`issue_dependency` 只在删除工作区时被引用；乐观锁是可选的 `expected_revision`（`server/pkg/db/queries/issue.sql:259`）。
- Beads：影响就绪的是 `blocks`、`parent-child`、`conditional-blocks`、`waits-for` 这 4 种依赖（`internal/types/types.go:1500`）。
- Chorus：`TaskDependency` 关联表，组合唯一（`prisma/schema.prisma:451`）。
- kandev：提议工具 `propose_task_kandev`（`apps/backend/internal/coordinator/toolprofile.go:25`）；决定表的 `superseded_at`（`apps/backend/internal/office/repository/sqlite/step_decisions.go`）。
- kander：分支重叠按文件路径求交集（`internal/check/overlap.go:42`）；评审检查在移到完成的事务里（`internal/board/review_gate.go:50`）。

Linear 部分有两个文档页面返回 404，结论依据公开的 GraphQL schema 和 agent 相关页面，读不到的已在分项报告里标为未核实。
