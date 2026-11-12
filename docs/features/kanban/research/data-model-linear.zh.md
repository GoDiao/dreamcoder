# Linear 数据模型拆解（仅公开文档与公开 schema）

## 0. 来源与核实方式

- S1：Linear 公开 GraphQL schema，`https://raw.githubusercontent.com/linear/linear/master/packages/sdk/src/schema.graphql`（2026-11-06 抓取 master，54759 行；未记录 commit 哈希）。字段注释来自该文件的 description。下文写 `schema:行号` 的，行号对应抓取的这一份副本。
- S2：`https://linear.app/developers/agents`
- S3：`https://linear.app/developers/agent-interaction`
- S4：`https://linear.app/docs/parent-and-sub-issues`
- 未能读取：`linear.app/docs/issue-relations`、`/docs/configuring-workflows`、`/docs/workflows`、`/docs/issue-relations-and-blocking` 均返回 404。凡依赖这些页面的内容，只引用 S1 的 schema 注释，其余标 [未核实]。
- 没有读到 Linear 的服务端实现，所有"行为"都来自文档与 schema 注释。
- 闭源 SaaS，只借鉴思路。

## 1. 身份

- 产品：Linear（闭源 SaaS），公开 GraphQL API 与 TypeScript SDK。
- 存储：服务端内部不可见 [未核实]。多租户（workspace、team、organization），这些字段我们不需要。
- Agent 能力：S2、S3。

## 2. 实体与关系

### Issue（S1 `type Issue`，`schema:~20000` 附近，字段取自抓取内容）

- 标识：id（ID）、identifier（"ENG-123"）、number（Float，团队内唯一）、previousIdentifiers、url、branchName（建议分支名）。
- 内容：title、description（markdown）、descriptionState、documentContent。
- 状态：`state: WorkflowState!`（必填，单值）。时间戳 startedAt、completedAt、canceledAt、triagedAt、autoClosedAt、autoArchivedAt、archivedAt、snoozedUntilAt。
- 优先级：`priority: Float`，0 无、1 紧急、2 高、3 中、4 低（schema 注释）。
- 估点：estimate（Float，量表随团队配置）、dueDate、sla*。
- 人：`assignee: User`（单值）、`delegate: User`（单值）、creator、subscribers。
- 结构：`parent: Issue`、`children`、`team: Team!`（必填）、project、projectMilestone、cycle。
- 关系：relations、inverseRelations。
- 排序：sortOrder、subIssueSortOrder（仅有 parent 时设置）、prioritySortOrder。
- 其他：labels / labelIds、attachments、comments、documents、history（IssueHistory）、stateHistory（IssueStateSpan）、agentSessions、trashed（软删除标志）。
- 无 `metadata` 自由 JSON 字段；扩展靠 attachments 的 metadata。

### 父子（sub-issue）

- 存为 Issue 上的单个 `parent` 指针（schema `Issue.parent`、`IssueUpdateInput.parentId`）。一个 issue 至多一个父。
- 文档（S4）：
  - 未给出最大嵌套深度，文档只描述一层关系；
  - 子 issue 继承父的 team，并继承 priority 与 project，在满足条件时继承 cycle 和 assignee，不继承 labels；
  - 按团队设置：全部子 issue 完成时父自动完成；父完成时子自动完成（团队 Workflow 设置）；
  - `IssueUpdateInput.autoClosedByParentClosing` 记录自动关闭来源。
- 父 issue 不是特殊类型，没有 epic 类型。

### Issue 关系（S1 `type IssueRelation`）

- 实体 IssueRelation：id、`issue`（源）、`relatedIssue`（目标）、`type: String!`、createdAt、updatedAt、archivedAt。有方向。
- 创建输入：`IssueRelationCreateInput {id, issueId, relatedIssueId, type: IssueRelationType!}`；mutation `issueRelationCreate`（`schema:27712`）。
- 类型枚举 `IssueRelationType`：`blocks`、`duplicate`、`related`、`similar`（4 个值）。
- 语义：
  - `blocks`：源阻塞目标。"blocked by" 在 schema 里是 `inverseRelations` 的另一侧读法，没有独立枚举值（推断，文档页未读到）。
  - `duplicate`：重复。同时存在 workflow state 类型 `duplicate`（见第 3 节）。关联的自动关闭行为 [未核实]。
  - `related`：松散相关。
  - `similar`：schema 里有该值，注释只写 "blocks, duplicate, and related"，`similar` 的语义与来源 [未核实]（可能是系统推荐的相似 issue）。
- 存储形态：独立关联表（一行一条有向边），不是列。
- 阻塞对状态是否有强制效果：没有读到。schema 注释无"blocked 状态"，Issue 上也无 is_blocked 字段。看板上的阻塞标记是显示用 [未核实]。

### 评论（S1 `type Comment`）

- 字段：id、body（markdown，派生自 bodyData）、bodyData（ProseMirror，规范存储）、`issue`/issueId、`parent`/parentId（回复树）、user、botActor、externalUser、editedAt、resolvedAt、resolvingUser、resolvingComment、quotedText、reactions、url。
- 评论也能挂在 project、initiative、post、各类 update 上，所以 `issueId`、`projectId`、`initiativeId` 等并列，只有一个有值。
- 与 agent 的联系：`agentSession`、`spawnedAgentSessions`、`isArtificialAgentSessionRoot`（无评论提及时合成的会话根评论，内部字段）。
- 线程可被"解决"（resolvedAt）。

### 附件（S1 `type Attachment`）

- 字段：id、`issue: Issue!`、title、subtitle、`url: String!`、metadata（JSONObject，因来源而异：PR 状态、评审数、提交信息等）、source（JSON）、sourceType、groupBySource、creator、bodyData。
- `url` 同时是同一 issue 内的唯一标识：同一 issue 下不能有两个相同 url 的附件（schema 注释）。
- 用途：把外部资源（PR、工单、Slack 消息）链接到 issue，并带外部系统状态。
- 附件挂在 issue 上，不是文件上传。文件与图片在 description 里用 markdown 引用 [未核实]。

### 标签、其他

- labels：多对多（Issue.labels、labelIds）。
- 还有 Project、Cycle、Initiative、Milestone、Customer Need 等规划实体，本次不展开。

## 3. 状态

- 存在 `Issue.state`（指向 WorkflowState 的单值引用，必填）。
- WorkflowState（S1）：id、name、`type: String!`、position（Float，同类型组内排序）、color、description、`team: Team!`、`inheritedFrom`、issues。
- `type` 的取值，来自 schema 注释："triage"、"backlog"、"unstarted"、"started"、"completed"、"canceled"、"duplicate"，共 7 个。
- 每个团队有自己的一套 WorkflowState，名称、数量可自定义，type 是固定的分类。这样既能自定义列名，又能让系统按 type 统一判断（例如 startedAt 在进入 started 类时设置，`Issue.startedAt` 注释）。
- 每个团队默认有哪些状态、哪些可删 [未核实]（workflows 文档页 404）。
- 合法流转：没有读到流转限制。schema 与文档都未提到流转表；`IssueUpdateInput.stateId` 可直接写。流转时的自动动作（如 PR 合并后改状态）属于集成，细节 [未核实]。
- 谁能改状态：按 OAuth scope 与团队访问权限，细节 [未核实]。

## 4. 历史与并发

- `IssueHistory`（S1，`schema:20590`）：每次变更一行，字段成对：fromX / toX，涵盖 assignee、delegate、state、parent、project、cycle、team、priority、estimate、title、dueDate、labels（addedLabelIds / removedLabelIds）、relationChanges、updatedDescription 等。还有 actor / actors、botActor、`autoClosed`、`autoArchived`、`trashed`、`archived`、`createdAt`。
- 即：历史是"变更行"，一次变更可同时含多个字段的前后值，不是按字段拆开的事件。
- `IssueStateSpan`（`Issue.stateHistory`）：每个状态的停留区间（用于周期统计）。
- 乐观锁：Issue 上没有版本号字段；`updatedAt` 存在，但是否用作条件写入 [未核实]。
- 软删除：`trashed` 标志加 `archivedAt`；查询有 `includeArchived` 参数（schema 各 connection 字段）。

## 5. 评论、交付物与证据

- 评论见第 2 节。
- 交付物：没有专门实体。交付物以附件挂接，主要是 PR 链接，PR 状态放在 `Attachment.metadata`。AgentSession 上另有 `pullRequest` / `pullRequests`（内部字段，S1）。
- Agent 过程证据：`AgentActivity` 的 action（工具、参数、结果）、response、error（见第 7 节）。
- AgentSession 另有 `summary`（会话标题，由系统生成或应用设置）、`plan`、`externalLinks`（外部仪表盘链接）。
- 验证结果没有专门字段 [未核实]。

## 6. 角色与权限的存储

- `assignee`：单值 User，表示负责的人。
- `delegate`：单值 User，表示被委派去做事的 agent。S2：把 issue 分配给 agent，设置的是 `delegate`，不是 `assignee`；"人保留所有权，agent 代为行动"。schema 注释：`delegate` 是"被委派来处理这个 issue 的 agent 用户"。
- `IssueUpdateInput` 同时有 `assigneeId` 和 `delegateId`（S1）。
- agent 是 workspace 里一种用户（`AgentSession.appUser: User!`，`Issue.delegate: User`）。S2 称"agent 像其他用户一样，可以被 @ 提及、被委派 issue、创建与回复评论"。agent 不计入付费席位（S2）。
- agent 不能作为项目成员或项目负责人（S2）。
- 区分人与 agent：靠用户类型与 `botActor`（评论、历史里有 botActor 字段）。
- 权限：OAuth 安装时 `actor=app`；scope 包括 `app:assignable`（可被分配）、`app:mentionable`（可被提及）；`actor=app` 不能同时申请 `admin`（S2）。团队访问可被管理员随时撤销，并触发 `PermissionChange` webhook（S2）。
- 没有"每张卡片的角色"。角色只有两个槽：assignee 与 delegate。Reviewer、PM 无对应字段。

## 7. 任务与执行的关联：AgentSession 与 AgentActivity

### AgentSession（S1 `type AgentSession`）

- 创建：被 @ 提及或被委派 issue 时自动创建（S2、S3）；也可用 `agentSessionCreateOnIssue`、`agentSessionCreateOnComment` 主动创建（S3）。
- 关联：`issue: Issue`、`comment`、`sourceComment`、`appUser: User!`（哪个 agent）、`creator: User`（负责的人；自动化或 agent 发起时为空）。
- 一个 issue 有多个 session（`Issue.agentSessions` 是 connection）：一对多。一个 session 至多关联一个 issue（`issue` 单值）。
- 状态 `status: AgentSessionStatus!`：`pending`、`active`、`awaitingInput`、`complete`、`error`、`stale`、`stopping`（S1 枚举 7 个；S3 页只列了前 6 个，`stopping` 仅见于 schema）。
- 状态由系统根据 agent 最近一条 activity 自动推进，agent 不手动设置（S3："Linear tracks session lifecycle automatically based on the last emitted activity"）。
- 其他字段：startedAt（转为 active 的时间）、endedAt、dismissedAt、dismissedBy、lastAgentReplyAt（内部）、summary、plan、context（JSON）、externalLinks、`externalUrls`（已弃用）、sourceMetadata、codingHarness、codingHarnessModelLabel、modelSelection、pullRequest(s)、url、slugId。
- 用户可以关闭（dismiss）会话。schema 注释：关闭时 agent 会被从该 issue 的 delegate 中移除（`AgentSession.dismissedAt`）。
- `plan`：JSON，元素为 `content` + `status`（pending、inProgress、completed、canceled），更新时整体替换，不能改单项（S3，技术预览）。
- `promptContext`：webhook 里下发的格式化字符串（issue、评论、指引）（S2、S3）。
- 超时规则：webhook 须在 5 秒内响应；收到 `created` 后 10 秒内要发 activity 或设置外部 URL，否则会话被标为无响应（S3）。`stale` 的定义文档未写 [未核实]。

### AgentActivity（S1 `type AgentActivity`）

- 字段：id、`agentSession`、`content`（联合类型）、`user`（创建者）、`ephemeral`、`signal`、`signalMetadata`、`sourceComment`、`sourceMetadata`、promptAuthor、contextualMetadata、createdAt、updatedAt、archivedAt；内部字段 queued、sentAt、executionSkippedReason（permissionDenied、quotaExceeded）、pushSummary。
- 类型 `AgentActivityType`：`thought`、`action`、`elicitation`、`response`、`error`、`prompt`。
- 内容结构（S1）：
  - thought、elicitation、response、error、prompt：`body: String!` + `bodyData`；
  - action：`action`（工具名）、`parameter`、`result`、`resultData`；
  - error 另有 `reasonCode`；
  - prompt 另有 `title`。
- `prompt` 只能由用户产生，agent 不能创建；创建它会触发 `prompted` webhook（S3）。
- `ephemeral` 只对 thought 与 action 有效，下一条 activity 出现时消失（S3）。
- `signal`（`AgentActivitySignal`）：`auth`、`continue`、`select`、`stop`（S1）。含义见 S3 提到的 Signals 页，未读 [未核实]；`stop` 对应用户发出的停止请求（`promptAuthor` 注释提到 "including stop requests"）。
- 创建：mutation `agentActivityCreate`，输入含 `agentSessionId`、`content`、`ephemeral`、`signal`、`signalMetadata`、`contextualMetadata`（`schema:325`）；另有 `agentActivityCreatePrompt`（`schema:24830`）。
- Webhook：`AgentSessionEvent`，action 为 `created`、`prompted`（S3）。
- 执行结束后保留：session、activity、plan 都保留在 issue 上，可查询。

## 8. 提议、草稿、审批

- 工作流 type 里有 `triage`：新进来的 issue 先进 triage，再由人分流；有 `triagedAt`、`startedTriageAt`、`snoozedUntilAt`（"在 Triage 视图里 snooze"）（S1）。这是与"提议"最接近的机制。
- Issue 上还有 `IssueSuggestion`（incomingSuggestions、suggestions），内部类型，含义 [未核实]。
- agent 能否只"提议"而不直接创建 issue，没有读到对应机制 [未核实]。
- `elicitation` activity 是 agent 向人请求确认或澄清，会话进入 `awaitingInput`（S3）。这是会话层面的人工确认点，不是任务层面的审批状态。

## 9. 文件、路径、范围

- Issue 上无文件或路径字段。
- 仓库关联：query `issueRepositorySuggestions` 返回带置信度的仓库建议（S3）。
- 只有 `branchName`（建议分支名）与附件里的 PR 链接。没有"两个任务改同一文件"的冲突检测。

## 10. 对我们的启示

借鉴：

1. 状态拆成"团队可自定义的名称"加"固定的类型分类"（WorkflowState.name 与 .type）：UI 列可改，系统逻辑只看分类（如 started、completed）。对应"状态在服务端校验"，且列名可演进。
2. assignee 与 delegate 分两个单值槽：人负责，agent 代为执行；关闭会话时只移除 delegate，不动 assignee。对应"会话与卡片的关联独立于会话树，负责的人不因会话结束而变"。
3. AgentSession 与 Issue 一对多，状态由最后一条 activity 推导而不是手工设置（S3）。对应"会话关联可重复，卡片状态不依赖会话存活"，也符合"状态只存一份、其余派生"。
4. activity 是只追加的类型化流（thought、action、elicitation、response、error，`prompt` 只允许人产生）。对应"执行历史长期保留"，也说明"谁能产生哪类记录"可以在写入时校验。
5. 变更历史一行一次变更，成对的 from/to 字段（IssueHistory）。对应"状态变化、负责人变化可追溯"。
6. 附件用 `url` 在同一 issue 内唯一，状态放 metadata。对应"交付物（PR、产出文件）挂在卡片上，不随会话消失"。

避免：

1. 关系只有 blocks、duplicate、related、similar 四种，且阻塞不影响任何状态（没有派生的 ready 或 blocked）。我们需要"Worker 只看到必需依赖"，要把阻塞做成可计算的。
2. 角色只有 assignee 与 delegate 两个槽，没有 Reviewer，也没有每卡角色。我们的 PM、Worker、Reviewer 要按卡片、可嵌套存储。
3. 没有 proposed 的写入限制：未读到 agent 只能提议的机制。我们的"Worker 只能提议"必须由服务端在写入时拒绝。
4. 没有路径或文件范围，无冲突检测。我们需要自己的"占用"机制。
5. 多租户字段（team、organization、workspace、权限撤销 webhook）与单用户本地场景无关，不要照搬。
6. 父子关系只是单个 parent 指针，没有"父的完成由子汇总"的显式规则，只有团队级自动关闭开关。我们要的"PM 收尾"、"人类最终验收"应在卡片自己的状态里体现。

## 11. 未核实与未读

- 关系、工作流两个文档页 404：blocked by 的存储方式、duplicate 的自动关闭、默认工作流状态、状态流转自动化、`similar` 的含义，均 [未核实]。
- 乐观锁或条件写入：[未核实]。
- Signals 文档页、`stale` 与 `stopping` 的定义：[未核实]。
- agent 对 issue 的写权限边界（能改哪些字段）：[未核实]。
- agent 是否能只提议不创建 issue：[未核实]。
- Project、Cycle、Initiative、Customer Need、Release 等实体：未读。
- schema 中标 `[Internal]` 的字段（queued、sentAt、executionSkippedReason、pushSummary、lastAgentReplyAt 等）只作存在性记录，不保证稳定。
- 使用的 schema 抓取没有 commit 哈希；行号只对本次抓取副本有效。
