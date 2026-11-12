# Beads 数据模型拆解

路径前缀：主工作区的 `refs/agent-kanban/beads/`，下文 `path:line` 均相对此目录。commit 837367719cbed8c29b71af0fe64da6dcd3822909（`git log -1` 所得，浅克隆）。

## 1. 身份

- URL：github.com/gastownhall/beads（原 steveyegge/beads）。
- License：MIT（`LICENSE:1`），可借鉴实现，仍不拷贝代码。
- 技术栈：Go，命令行 `bd`；构建用 Bazel（`CLAUDE.md`）。
- 存储：Dolt（带版本的 MySQL 兼容库），有 embedded 与 server 两种模式；SQL 迁移在 `internal/storage/schema/migrations/`（至少到 0073）。
- 定位：issue 追踪原语，面向 agent。`CLAUDE.md` 的 Scope 一节称不在核心里编码编排策略，能用 metadata 就不加字段。

## 2. 实体与关系

### issues 表（`internal/storage/schema/migrations/0001_create_issues.up.sql:1`；Go 类型 `internal/types/types.go:20`）

主键 `id VARCHAR(255)`（哈希 ID，子任务为层级 ID，如 `parent.1`，见 `internal/storage/issueops/child_id.go`）。字段分组：

- 内容：title(500)、description、design、acceptance_criteria、notes（均 TEXT）、spec_id。
- 状态：status(32)、priority INT 默认 2（0 最高）、issue_type(32)。
- 派生：`is_blocked TINYINT`（迁移 0046，见第 3 节）。
- 指派：assignee VARCHAR(255)（单值）、owner（人类归属，git 作者邮箱）、estimated_minutes。
- 时间：created_at/by、updated_at、started_at（0027）、closed_at、close_reason、closed_by_session、due_at、defer_until。
- 外部：external_ref、source_system、source_repo。
- 扩展：`metadata JSON`，默认空对象；创建/更新时校验是合法 JSON（`types.go:130-132`）。
- 并发：`row_lock BIGINT NOT NULL DEFAULT 0`（0054），Go 侧为 `RowVersion`（`types.go:75-99`）。
- 消息、事件、gate、molecule 字段（sender、await_type、await_id、timeout_ns、waiters、mol_type、work_type、event_kind、actor、target、payload 等）全部是 issues 表的列：一张宽表承载多种用途。
- 瞬态与压缩：ephemeral、no_history、wisp_type、storage_class、compaction_*、pinned、is_template。
- 0001 里还有 hook_bead、role_bead、agent_state、rig 等列；迁移 0038 `drop_hop_columns` 之后的去留 [未核实]。

### 瞬态表（wisps）

- `wisps`、`wisp_dependencies`、`wisp_comments`、事件表有一套平行副本（迁移 0020、0021）。
- ephemeral 或 no_history 的 issue 放进 wisps 表，不进 Dolt 历史。
- 代码里到处出现 `WispTableRouting`（`internal/storage/issueops/claim.go:63`）按表分流。对我们是反面教材：同一实体两套表，所有读写分两路。

### 关系：依赖边（dependencies 表，`0002_create_dependencies.up.sql:1`；Go `types.go:1206`）

- 列：issue_id、depends_on_id、type VARCHAR(32) 默认 'blocks'、created_at、created_by、metadata JSON、thread_id。
- 主键 `(issue_id, depends_on_id)`：同一对 issue 只能有一种类型的边。
- 迁移 0041 把目标拆成三列 `depends_on_issue_id / depends_on_wisp_id / depends_on_external`，以便指向 wisp 与外部项目（`external:` 前缀）。
- 迁移 0050 起边有确定性 UUID 代理键（`types.go:1207-1212`）。
- 父子、阻塞、重复、相关都走这一张边表，用 type 区分。没有单独的 parent_id 列。

### 依赖类型（`types.go:1460-1494`，共 19 种，类型列只限长度 ≤32，自定义类型也合法，`types.go:1521`）

影响 ready 计算的 4 种（`AffectsReadyWork`，`types.go:1549`）：

- `blocks`：B 依赖 A，A 未关闭则 B 阻塞。
- `parent-child`：结构边，issue_id 是子，depends_on 是父。本身不算硬阻塞（`IsBlockingEdge` 排除它，`types.go:1564`），但阻塞状态沿它向下传播给子孙（见第 3 节递归查询）。
- `conditional-blocks`：B 仅在 A 失败时运行（`types.go:1465` 注释）。注意 0046 的阻塞 SQL 把它与 blocks 同样处理，"失败"语义是否有另外实现 [未核实]。
- `waits-for`：扇出闸门，等动态产生的子节点。metadata 里 `{"gate":"all-children"|"any-children","spawner_id":...}`（`types.go:1570`）；SQL 在 `internal/storage/issueops/blocked_state.go:42` 起。

关联类型（不阻塞）：

- `related`、`relates-to`：松散关联。
- `discovered-from`：此 issue 是在做另一个 issue 时发现的。
- `replies-to`：对话串，用 thread_id 聚合。
- `duplicates`：去重链接。
- `supersedes`：旧 issue 被另一个取代（`bd supersede old --with new`，`docs/core-concepts/dependencies.md:74`）。
- `tracks`：convoy 跟踪，不阻塞。
- `until`：直到目标关闭前有效（如静音）。
- `caused-by`：被目标触发（审计线索）。
- `validates`：测试或验证链接（`docs/core-concepts/dependencies.md:73`）。

实体类（HOP 遗留，把人和技能建成边）：

- `authored-by`、`assigned-to`、`approved-by`：创建、指派、审批关系。
- `attests`：X 证明 Y 具备技能 Z，metadata 见 `AttestsMeta`（`types.go:1764`）。

委派类：

- `delegated-from`：工作从父级委派，完成向上级联（`types.go:1493` 注释；级联实现位置 [未核实]）。

循环检测只考虑 blocks 与 conditional-blocks（`internal/storage/issueops/cycles.go:13`）。

### Epic 与父子

- epic 只是 `issue_type='epic'`（`types.go:794-810`，内置类型：bug、feature、task、epic、chore、decision、message、molecule、gate、spike、story、milestone；`event` 为内部类型）。
- 子 issue 通过 `parent-child` 边挂到 epic；层级 ID 由 `child_counters(parent_id, last_child)` 发号（`0008_create_child_counters.up.sql`，`child_id.go:9`）。
- 可关闭 epic 的判定：所有子 issue 已关闭，且关闭原因不是"非完成类"（重复、wontfix、superseded 等，用正则 `internal/types/non_completing_close.go`）（`internal/storage/issueops/epic_closure.go:12`）。这是靠自由文本关闭原因做的判断，脆弱。

### 标签、评论

- labels：`(issue_id, label)` 复合主键的关联表（`0003_create_labels.up.sql`），无其他字段。
- comments：id CHAR(36) UUID、issue_id、author、text、created_at（`0004_create_comments.up.sql`）。纯文本，不可编辑字段，无类型，无附件。

## 3. 状态

- 内置集合（`types.go:597-605`）：open、in_progress、blocked、deferred、closed、pinned、hooked。
- 存在 `issues.status` 一列。另有自定义状态表 `custom_statuses`（0024），每个自定义状态带类别 active、wip、done、frozen（`types.go:650-678`），最多 50 个。
- 类别决定可见性：active 进 `bd ready` 且可被认领；wip 不进 ready。认领源状态 = open + active 类自定义状态（`claim.go:77-82` 注释）。
- 合法流转：**没有流转表**。`Issue.Validate` 只校验状态值是否在集合内（`types.go:432-470`）。在 `internal` 与 `cmd` 下搜 StatusTransition/validTransition/allowedTransition 无命中。流转约束分散在具体操作里：认领（CAS）、关闭守卫、重开等。
- 谁能改：无角色模型。关闭守卫 `CheckClosable`（`internal/storage/issueops/close_guard.go:60`）：模板只读；pinned 不能关；已有 assignee 且不是当前 actor 时拒绝（`CloseNotAssigneeError`）；`force` 绕过 pin 和 assignee。"actor"是调用者自报的字符串（`--actor` / `BEADS_ACTOR`，`claim.go:48-50`），没有认证。
- "blocked" 状态与 `is_blocked` 列是两回事：`is_blocked` 是派生投影，写入由 `RecomputeIsBlockedInTx` 在 dep 变更、状态变更、删除后重算（`blocked_state.go:160-290`，影响范围由 `AffectedBy*InTx` 计算）。

### ready 怎么算

1. 迁移 0046 的初始化 SQL 给出定义：issue 未关闭，且存在 type∈{blocks, conditional-blocks, waits-for} 的边指向未关闭、非 pinned 的目标，则 `is_blocked=1`。再沿 parent-child 边递归向下，把子孙全部标为阻塞（`reachable` CTE，`0046_add_is_blocked.up.sql` 后半）。
2. `waits-for` 另有单独的闸门 SQL：any-children 模式下只要有一个子已关闭就放行（`blocked_state.go:42` 起）。
3. 查询 `BuildReadyWorkWhere`（`internal/storage/sqlbuild/ready.go:207`）的条件：
   - 状态：默认 `open`/`in_progress`（`ready.go:180`）；
   - 非 pinned；
   - 未被阻塞（用 `is_blocked` 列，再补上"过期的阻塞标记"集合 `StaleBlockedIDsSQL`）；
   - 非 ephemeral；
   - issue_type 不在排除集（merge-request、gate、molecule、rig 与基础设施类型，`ready.go:16-30`）；
   - `defer_until` 为空或已到期；父级被 defer 的子孙也排除；
   - 其余：标签、assignee、metadata、parent 子树等过滤。
4. 排序：SortPolicy，默认按优先级与创建时间。
5. gate：`issue_type='gate'` 的 issue 作为闸门节点。`blocks` 或 `conditional-blocks` 边指向一个未关闭的 gate 就算被它挡住（`internal/types/gated.go`）。gate 自带列 await_type（gh:run、gh:pr、timer、human、mail）、await_id、timeout、waiters（`types.go:184-188`）。gate 自己不进 ready 列表。

## 4. 历史与并发

- `events` 表（`0005_create_events.up.sql`）：id、issue_id、event_type、actor、old_value、new_value、comment、created_at。事件类型（`types.go:1867-1892`）：created、updated、claimed、status_changed、commented、closed、reopened、dependency_added/removed、label_added/removed/renamed、compacted、lease_reclaimed、lease_rearmed。外键 ON DELETE CASCADE：删 issue 即删事件。
- `provenance_events`（0063）：只追加，把 issue 绑定到外部产物。kind 取自 cut、claim、suspend、resume、handoff、commit、land、used；字段 actor、ref、ref_kind、payload、source、occurred_at（事件时间）与 created_at（入库时间）（`types.go:1895-1934`）。可用来记 git SHA、PR、transcript。beads 不解释 ref。
- `bd_events_journal`（0064，`seq` 单调递增，op、issue_id、issue_json、dep_json、comment_json）：用于图变更的重放与同步，可被修剪（`journal_prune.go`）。
- Dolt 本身提供提交历史与 as-of 查询（`internal/storage/issueops/as_of.go`、`history.go`）。
- 乐观锁：`row_lock`（Go `RowVersion`），每次改状态或所有权的写入都重写成随机非零值，只能比较相等（`types.go:75-99`）。覆盖不完整：快照还原与压缩路径不改它。对外作为 `revision` 字符串暴露。
- 删除：硬删除（`delete.go`，外键级联）；无软删除列。瞬态 wisp 可被 GC。
- 压缩：`compaction_level`、`compacted_at`，旧 issue 的文本可被截断（会丢内容）。

## 5. 评论、交付物与证据

- 评论见第 2 节，只有作者和文本。
- 没有交付物、验证结果、产出的专用实体。可用的挂点：
  - `close_reason`（自由文本）；
  - `metadata`（任意 JSON，文件列表是其设计用途之一，`types.go:130`）；
  - `provenance_events` 的 commit、land 事件；
  - `validates` 边；
  - `acceptance_criteria` 文本。
- 没有独立的"证据"表；"完成"是否成立靠关闭原因的正则判断。

## 6. 角色与权限的存储

- assignee：单值字符串（`issues.assignee`），另有 owner。
- 没有角色字段（Worker/Reviewer/PM）；0001 里的 role_bead、role_type 是 Gas Town 编排用的 agent 档案，不是任务角色。
- 人和 agent 不区分：actor 是自由字符串。
- 权限检查：只有关闭守卫（上文）和认领 CAS。没有读权限控制，没有按卡片可见范围。
- 池：配置 `claim.pools` 里的别名（如 "fable-crew"）可被任何 actor 认领（`claim.go:92-97`）。

## 7. 任务与执行的关联

- 没有 run/session 实体。执行者只表现为 assignee 字符串加一条租约。
- 认领（`ClaimIssueInTx`，`claim.go:49`）：
  1. 读旧行；
  2. 判断 assignee 是否为空、是否本人、是否池别名；
  3. 用 `UPDATE ... WHERE id=? AND row_lock=? AND status IN (可认领状态)` 做 CAS；
  4. 置 `assignee=actor`、`status='in_progress'`，首次置 `started_at`；
  5. 同一 actor 重复认领是幂等成功；
  6. 失败返回 `ErrAlreadyClaimed`、`ErrNotClaimable`，带持有者信息。
- 租约（`leases` 表）：issue_id PK、holder、granted_at、lease_expires_at、heartbeat_at、granted_node（`0055_move_leases_to_table.up.sql`；`granted_node` 列的迁移文件未找到 [未核实]，写入见 `internal/storage/issueops/lease.go:177`）。
  - 租约表是节点本地、临时的，不进 Dolt 提交（`types.go:57-62` 注释）：认领提交，心跳不提交。
  - 默认 TTL 5 分钟（`lease.go:28`），可由 context 覆盖。
  - 心跳延长到期时间（`heartbeat_role.go`）；无租约行的手工认领，心跳会补发租约并记 `lease_rearmed`。
- 回收（`ReclaimExpiredLeasesInTx`，`lease.go:937`）：找出 `status='in_progress'` 且租约过期的 issue，删租约，状态退回 open，清 assignee，记 `lease_reclaimed`（old_value 为前持有者）。
  - 回收可按标签、assignee、id 限定范围。
  - 联邦部署下默认拒绝回收别的节点发出的租约（`granted_node` 守卫），`AnyReplica` 可覆盖。
- 关闭或结束后保留：issue 行、`closed_at`、`close_reason`、`closed_by_session`（Claude Code 会话 ID，纯字符串）、事件。租约行删除。
- 批量原子认领：`ExecuteClaimNext`（`internal/storage/issueops/claim_next.go:59`）按 WorkFilter 选下一个 ready 的并认领。

## 8. 提议、草稿、审批

- 没有 proposed 状态。能凑出的做法：自定义状态（如 draft，类别 frozen/wip）加 `bd config set status.custom`；或 `deferred`、`pinned`。
- 审批：`approved-by` 边与 `human` 类型的 gate（await_type=human），由人解决 gate。这是用图表达审批，不是状态机。
- `decision` 是内置 issue 类型。其审批流程 [未读]。

## 9. 文件、路径、范围

- 无字段记录任务将改或已改的文件。`metadata` 可放文件列表，但没有约定，也没有冲突检测。
- `source_repo` 是 issue 属于哪个仓库（多仓库路由），不是文件范围。
- 并发冲突检测只在 issue 行层面（row_lock），与文件无关。

## 10. 对我们的启示

借鉴：

1. 派生的 `is_blocked` 投影加"受影响集合重算"：读 ready 时是单列过滤；写 dep 或状态时只重算受影响节点（`blocked_state.go:719` 起）。对应"卡片状态与依赖要持久"和读多写少的看板视图。
2. 认领用 CAS：版本令牌（`row_lock`）比较后写，失败时返回当前持有者，重复认领幂等（`claim.go:75-130`）。对应"服务端检查每次改动"和"两张卡不同时占用"。
3. 租约与心跳单独成表，不进历史提交；到期可回收，且回收写事件（`lease.go:937`）。对应"会话崩溃后卡片仍存活，状态不依赖会话"。我们是单机，可去掉 granted_node 与联邦部分。
4. 依赖边类型化且一张表：blocks、parent-child 与"仅关联"类型分开，只有少数类型进 ready 计算（`types.go:1549`）。对应"依赖要持久、Worker 只看到必需依赖"。
5. 事件表记录 old_value/new_value/actor，另有只追加的 provenance 表绑定外部产物（git SHA、PR）（`types.go:1852`、`1907`）。对应"执行历史与交付物不随会话消失"。
6. 关闭守卫放在存储层同一事务内，所有入口共用（`close_guard.go:1-40` 注释说明这点）。对应"只有人类最终验收"：服务端守卫，不靠各入口自觉。

避免：

1. 一张宽表装所有用途（消息、gate、事件、角色、molecule 字段都在 issues 里）。我们的卡片、提议、会话关联应分表。
2. 状态流转没有表，只有值校验；约束散在各操作中。我们要的"proposed -> 批准"和"人类最终验收"需要集中的流转表。
3. actor 是自报字符串，人与 agent 不分，权限只有"assignee 是否等于 actor"。我们需要按卡片的角色，并区分人和会话。
4. 用关闭原因的正则判断"是否算完成"（`non_completing_close.go`）。我们应有结构化的验收结论字段。
5. 平行的瞬态表（wisps 等）使每个读写都分流。单用户本地场景不需要。
6. 硬删除且事件级联删除，历史随 issue 消失。我们要求历史、依赖、交付物长期保留，应软删除或不删。

## 11. 未核实与未读

- `delegated-from` 的完成级联实现、`conditional-blocks` 的"失败才运行"语义是否另有实现。
- `leases.granted_node` 的迁移文件（只看到写入）。
- 0038 之后 issues 表是否仍有 hook_bead、role_bead、agent_state 等列。
- `decision` 类型和 human gate 的完整流程；`bd gate` 的命令实现（`cmd/bd`）未读。
- 重开（reopen）与取消认领（unclaim）的约束代码未读。
- `internal/storage/issueops/aggregate.go`（authorize 相关测试名）未读，可能含按聚合的授权。
- 联邦同步、compaction、formula/molecule、journal 重放的细节未读。
- 本报告未运行任何代码，所有结论来自读源码与迁移 SQL。
