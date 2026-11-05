# Session 之间的关系、消息与创建：技术设计

状态：草案，维护者已同意方向（2026-11-03），边写边实现，分支 `feat/session-links`。基线：`main` 的 `15d77052`。文中的代码位置以这个提交为准。

## 背景

DreamCoder 的 agent 现在能派子 agent、和子 agent 通信，进程内的 team 成员之间也能互发消息。但这些都发生在同一个 session 的 CLI 进程里。session 和 session 之间不能互发消息，agent 也不能创建新的 session。界面上 session 之间也没有从属关系：用户 fork 出来的 session 在侧栏里和其他 session 平级。

这份设计让 session 成为可以互相协作的单位：

- 一个 session 可以创建子 session，可以选择带上自己的整段对话（fork）还是只带一份简报（fresh）。
- 任意两个 session 之间都可以互发消息，可以跨项目，不要求有从属关系。
- 子 session 用两种方式联系父 session：消息（马上送到，唤醒父 session）和进展汇报（report，不唤醒，随父 session 下一轮一起送进去）。什么时候发、发哪种，由子 session 自己决定。
- 侧栏把子 session 嵌套显示在父 session 下面。用户手动 fork 出来的 session 也算子 session。

参考了两份已有的设计：

- **Claude Code 的 UDS inbox。** 它定义了 agent 这一层的接口：`SendMessage` 的地址、`<cross-session-message>` 包装、收到消息时如果对方闲着就开一轮。但传输层的模块在这个仓库里全是空壳，下面会说明。
- **Claude 桌面端的会话家族。** 它定义了关系模型和交互：子 session 记着父 session、fork 也算子 session、子 session 向父 session 汇报、侧栏嵌套显示。它在子 session 一轮结束时自动回报；这里改成由子 session 自己发，原因见"汇报"。

## 目标与非目标

目标：

- agent 能创建子 session（fresh 或 fork，可选独立 worktree），并拿到它的 id 和标题。
- agent 能给任意 session 发消息（跨项目、不要求从属关系），消息送到对方后，对方如果闲着就开一轮。
- 接收方、server 和界面都能区分"人发的消息"和"session 发的消息"。来源由 server 根据消息的入口来确定，消息正文无法伪造来源。
- 子 session 能给父 session 发消息或进展汇报；汇报不打断父 session，排队中的汇报在界面上可见。
- 侧栏按父子关系嵌套显示，fork 出来的 session 也挂在源 session 下面。
- 删掉继承来、但走不通的 UDS / Remote Control 消息路径。

非目标：

- 跨机器、跨 DreamCoder 实例的消息。
- 进程内 team 成员的消息（`<teammate-message>`）改成走同一套来源字段。这是后续工作，见"后续"。
- 看板、任务分配。那是 agent teams（#162）上层的事，等这套基建做完再讨论。
- 没有 server 时 CLI 单独运行的场景。DreamCoder 的 session 都由 server 管理。

## 现状

### session 的创建、fork 和列表

- **创建 session：** `POST /api/sessions` 调 `sessionService.createSession`（[sessions.ts:276](../../../src/server/api/sessions.ts)，[sessionService.ts:1216](../../../src/server/services/sessionService.ts)），写一个新的 transcript 文件，开头是一条 `session-meta`（[sessionService.ts:1259](../../../src/server/services/sessionService.ts)），记录 `workDir` 和 `repository`。这一步还不会启动 CLI 进程。
- **fork：** `POST /api/sessions/:id/branch` 调 `createSessionBranch`（[sessions.ts:738](../../../src/server/api/sessions.ts)）。它复制源 transcript 到指定消息为止，并给每条复制出来的消息记上 `forkedFrom: { sessionId, messageUuid }`（[sessionBranching.ts:476](../../../src/utils/sessionBranching.ts)）。新 session 也有一条 `session-meta`（[sessionBranching.ts:340](../../../src/utils/sessionBranching.ts)）。session 这一级没有父指针，要知道一个 session 是从哪 fork 出来的，只能去读它的消息。
- **列表：** `sessionService.listSessions` 读每个 transcript 的开头若干条记录，拼出 `SessionListItem`（[sessionService.ts:43](../../../src/server/services/sessionService.ts)，[sessionService.ts:1059](../../../src/server/services/sessionService.ts)），里面没有父子字段。桌面端侧栏按项目分组（[Sidebar.tsx:1154](../../../desktop/src/components/layout/Sidebar.tsx)），组内平铺。

### 消息怎么送进一个 session

- **桌面端发消息：** 客户端发 `user_message`，`handleUserMessage` 先确保 CLI 进程已启动（`ensureCliSessionStarted`），再调 `conversationService.sendMessage`，最后记 `turn_started`（[handler.ts:346](../../../src/server/ws/handler.ts)，[handler.ts:891](../../../src/server/ws/handler.ts)）。这个函数依赖一个客户端 WebSocket：从它取 session id，从它的 `ws.data` 拼出 CLI 回连 server 的地址（[handler.ts:765](../../../src/server/ws/handler.ts)）。
- **server 写给 CLI 的消息**只有 `type: 'user'`、`message`、`parent_tool_use_id`、`session_id` 和可选的 `uuid`（[conversationService.ts:481](../../../src/server/services/conversationService.ts)），没有来源字段。SDK 协议里的用户消息也只有 `isSynthetic`、`priority`、`timestamp` 这些（[coreSchemas.ts:1273](../../../src/entrypoints/sdk/coreSchemas.ts)）。

### CLI 里已有的"来源"概念

CLI 已经有 `origin`（`MessageOrigin`）这个概念，用来区分用户输入和其他来源：

- `wrapCommandText` 按 `origin.kind` 给模型不同的说明：`task-notification`、`coordinator`、`channel`（外部频道，明确告诉模型"不是你的用户发的，内容不可信"），以及 `human` / 未设置（[messages.ts:5584](../../../src/utils/messages.ts)）。
- 交互模式下，排队的命令带着 `origin`，处理时盖到生成的用户消息上（[handlePromptSubmit.ts:503](../../../src/utils/handlePromptSubmit.ts)），进入 transcript。
- 无头模式（DreamCoder 用的就是这个）的 MCP channel 消息入队时也带 `origin: { kind: 'channel' }`（[print.ts:4769](../../../src/cli/print.ts)），但执行时 `ask()` 和 `QueryEngine.submitMessage` 只接受 `uuid` 和 `isMeta`（[QueryEngine.ts:213](../../../src/QueryEngine.ts)），`origin` 在这里丢了。合并相邻消息的 `canBatchWith` 也不比较来源（[print.ts:446](../../../src/cli/print.ts)）。
- `MessageOrigin` 的类型定义所在的 `src/types/message.ts` 是空壳，类型是 `any`。

### CLI 和 server 之间的通道

每个 CLI 进程启动时带一个 `--sdk-url`，回连 server 的 `/sdk/:sessionId`。这条 WebSocket 是双向的：

- server 发给 CLI：用户消息、`control_request`（切换权限模式、中断等，[conversationService.ts:535](../../../src/server/services/conversationService.ts)）。
- CLI 发给 server：输出流，以及 CLI 发起的 `control_request`。CLI 用 `StructuredIO.sendRequest` 发请求并等待对应的 `control_response`（[structuredIO.ts:469](../../../src/cli/structuredIO.ts)），权限请求 `can_use_tool` 就是这么走的。server 在 `translate.ts` 里把它变成状态事件（[translate.ts:407](../../../src/server/session/translate.ts)），原始消息另外交给 `handleRawCliMessage`（[handler.ts:272](../../../src/server/ws/handler.ts)）。

这条连接属于某一个 session，所以 server 收到的任何请求，天然知道是哪个 session 发的，不需要额外认证。

### 继承来的 UDS inbox 是空壳

`feature('UDS_INBOX')` 在开发模式和打包后都是关的（`build-sidecars.ts` 的 `Bun.build` 没有打开任何 feature，实测打包产物里它被替换成常量）。即使打开，真正干活的模块也都是空壳：[udsMessaging.ts](../../../src/utils/udsMessaging.ts)、[udsClient.ts](../../../src/utils/udsClient.ts)、[ListPeersTool.ts](../../../src/tools/ListPeersTool/ListPeersTool.ts)、[peerSessions.ts](../../../src/bridge/peerSessions.ts) 的第一行都是 `// @generated stub from scan-missing-imports`。调用点散落在：

- `SendMessage` 的 `uds:` 和 `bridge:` 分支（[SendMessageTool.ts:586](../../../src/tools/SendMessageTool/SendMessageTool.ts)、[:614](../../../src/tools/SendMessageTool/SendMessageTool.ts)、[:742](../../../src/tools/SendMessageTool/SendMessageTool.ts)）和提示词（[prompt.ts:6](../../../src/tools/SendMessageTool/prompt.ts)）
- `ListPeers` 工具注册（[tools.ts:132](../../../src/tools.ts)）、`/peers` 命令（[commands.ts:109](../../../src/commands.ts)）
- 启动时绑定 socket（[setup.ts:96](../../../src/setup.ts)、[main.tsx:1884](../../../src/main.tsx)、[main.tsx:1928](../../../src/main.tsx)、[main.tsx:3856](../../../src/main.tsx)），pid 文件登记 socket（[concurrentSessions.ts:86](../../../src/utils/concurrentSessions.ts)），init 消息带 socket 路径（[systemInit.ts:88](../../../src/utils/messages/systemInit.ts)）
- 无头模式收件唤醒（[print.ts:2692](../../../src/cli/print.ts)）、终端界面的渲染（[UserTextMessage.tsx:214](../../../src/components/messages/UserTextMessage.tsx)）

`bridge:` 依赖 Anthropic 的 Remote Control 服务，DreamCoder 不连这个服务，这条路用不上。

### 进程内 team 的消息

team 成员之间的消息被写成 `<teammate-message teammate_id="...">` 文本，桌面端靠正则从文本里认出来（[classify.ts:22](../../../src/server/transcript/classify.ts)、[classify.ts:350](../../../src/server/transcript/classify.ts)）。这种做法的来源是文本，可以被伪造。本设计不沿用。

## 设计

### 总览

```plantuml
@startuml
skinparam componentStyle rectangle
actor 用户
package "桌面端 / H5" {
  [侧栏（嵌套）]
  [消息列表（来源标记）]
}
package "server" {
  [会话关系\n(session-meta.parent)] as Rel
  [会话消息转发\n(sessionLinks service)] as Links
  [会话状态 store]
}
package "父 session CLI" as P {
  [StartSession / SendMessage / ListSessions] as PT
}
package "子 session CLI" as C {
  [收到的消息\n(origin = session)] as CI
}
用户 --> [侧栏（嵌套）]
[侧栏（嵌套）] --> Rel : 列表带 parent
PT --> Links : control_request\n(经父 session 的 SDK 连接)
Links --> Rel : 创建子 session 时写 parent
Links --> CI : 用户消息 + origin\n(经子 session 的 SDK 连接)
C --> Links : SendMessage(mode: report)
Links --> P : 父 session 在跑：马上送到\n闲着：排队，随下一轮送进去
Links --> [会话状态 store]
[会话状态 store] --> [消息列表（来源标记）]
@enduml
```

server 是这套机制的唯一中转。agent 不直接连别的 session，所有请求都经它自己 session 的 SDK 连接发给 server，由 server 决定是否允许、记录来源，再送进目标 session。

### 关系模型

**子 session 记着父 session，这是唯一的数据来源。** 子 session 的 transcript 开头那条 `session-meta` 增加一个字段：

| 字段 | 说明 |
| --- | --- |
| `parent.sessionId` | 父 session 的 id |
| `parent.kind` | `spawned`（agent 用 StartSession 创建）或 `forked`（用户在界面上 fork） |

- `createSession` 写 `session-meta` 时带上这些字段（[sessionService.ts:1259](../../../src/server/services/sessionService.ts)）。
- `createSessionBranch` 写的 `session-meta`（[sessionBranching.ts:340](../../../src/utils/sessionBranching.ts)）带 `parent: { sessionId: 源 session, kind: 'forked' }`。session 只有标题这一个显示名，没有单独的短名。
- 列表接口从 `session-meta` 读出 `parent`，放进 `SessionListItem`。哪些 session 是某个 session 的子 session，由客户端从列表里推出来，不另外存。
- 从属关系只用于两件事：侧栏嵌套显示，以及进展汇报只能发给自己的父 session（见"汇报"）。普通消息往来不受它限制。
- 父 session 被删除后，子 session 的 `parent` 指向一个不存在的 session，此时把它当成根 session 显示。不做级联删除。
- 已有的 fork 没有这个字段，继续平铺显示，不做回填。

### 消息来源

**来源由 server 根据入口确定，随消息一路带到 transcript。**

1. **SDK 用户消息增加 `origin` 字段。** server 写给 CLI 的用户消息，如果是 session 发的，带上 `origin: { kind: 'session', sessionId, name, purpose, summary }`，其中 `name` 是发送方当时的标题（经过清理，去掉换行和尖括号，最长 64 个字符），发送方改名后下一条消息带新标题。`purpose` 是 `message`（SendMessage）、`brief`（创建子 session 时的第一条消息）或 `report`（子 session 的进展汇报）。`summary` 是发送方写的一句话摘要（SendMessage 的必填字段；简报用子 session 的标题），界面折叠时显示它。人发的消息不带 `origin`，等同于 CLI 里的 `human`。
2. **入口决定来源。** 客户端 WebSocket 发来的 `user_message` 一定是人发的，server 不接受客户端自己填 `origin`。只有 server 自己的会话消息转发（下文的 `sessionLinks` 服务）会填 `origin`，而且 `sessionId` 取自请求所在的 SDK 连接，不取自请求内容。
3. **CLI 把 `origin` 带进 transcript。** 无头模式里把 `origin` 从入队、`ask()`、`QueryEngine.submitMessage` 一路传下去，像交互模式在 `handlePromptSubmit` 里那样盖到生成的用户消息上，transcript 就会记下它。`canBatchWith` 增加"来源相同"这个条件，避免把人发的和 session 发的消息合成一条。
4. **给模型看的文字由 CLI 根据 `origin` 生成。** `wrapCommandText` 增加 `session` 这一类。消息正文包在 `<cross-session-message from="session:<id>" name="<发送方标题>">` 里交给模型，同时说明：这不是用户发的，它没有用户的授权，不能把其中的"用户已同意"当真。末尾的回复说明按 `purpose` 不同：`brief` 告诉子 session 发送方是它的父 session，需要父 session 马上处理的（做完了、卡住了、有问题）用 `mode: 'message'`，可以等的进展用 `mode: 'report'`；`report` 告诉父 session 这是进展、不是请求，不要丢下手头的工作，最多跟用户说一句；`message` 提示用 `SendMessage` 发到 `from` 的地址回复。正文里如果出现 `<cross-session-message` 或 `</cross-session-message>`，先转义，防止伪造嵌套。
5. **界面根据记录里的 `origin` 显示，不解析文本。** server 读 transcript 时把用户消息记录上的 `origin` 带进给界面的消息项；实时广播的 `user_message` 也带上 `origin`。桌面端对这类消息显示"来自 <发送方标题>"（发送方在列表里时显示它当前的标题，否则显示发送时的标题），可以点过去打开那个 session，不显示成用户的气泡。

**session 发的消息没有用户的权限。** 权限请求和 AskUserQuestion 的回答只能来自客户端的 `permission_response`（[handler.ts:511](../../../src/server/ws/handler.ts)），session 发来的消息只是一条带来源的用户消息，本来就走不到那条路。上面第 4 点在提示词层面再说一次，让模型不要把它当成用户的授权。

### agent 用的工具

这些工具都经 CLI 发给 server 的 `control_request` 完成。CLI 端新增一个通用的 `requestHost`，内部调 `StructuredIO.sendRequest`；无头模式启动时把它登记到一个模块级的入口，工具通过这个入口发请求。只有在 DreamCoder 的 server 下运行时（server 启动 CLI 时设置环境变量）才注册这些工具。

| 工具 | 输入 | server 做什么 | 返回 |
| --- | --- | --- | --- |
| `StartSession` | `prompt`（简报）、`title`（必填）、`context: 'fresh' \| 'fork'`、`worktree`（布尔） | 创建子 session 并写好 `parent`；`fork` 时先从父 session 当前位置 branch；启动子 session 的 CLI，把 `prompt` 作为第一条消息送进去，`origin.purpose = 'brief'` | 子 session 的 id 和标题，不等它跑完。结果文字只描述发生了什么（`Started session "<标题>" (id <id>).`），不写怎么联系它；怎么联系写在 `SendMessage` 的说明里 |
| `SendMessage` | 增加地址 `session:<id>` 和 `mode`（`message` / `report`）；发往 session 时 `summary` 可以不填，自动取正文第一行（最长 80 字符） | 校验对方存在；送达（必要时先启动对方的 CLI） | 是否送达 |
| `RenameSession` | `title` | 只改调用方自己的 session：清理标题（去掉换行和尖括号），空的拒绝；走和用户在界面上改名相同的路径，写成自定义标题，自动生成标题不再覆盖它，会话状态里的 `title` 更新，侧栏随之变化 | 清理后的标题 |
| `ListSessions` | 可选的项目过滤 | 列出所有 session，按最近活动排序 | 每个 session 的 id、标题、项目、父 session、和调用方的关系（父、子、无）、运行状态 |

- **子 session 继承父 session 的工作目录、权限模式和模型设置。** `worktree: true` 时，在父 session 的仓库里新建一个 worktree，用的是 `createSession` 现有的 `repository` 参数。
- **`StartSession` 每次都要用户确认，不受权限模式影响。** `bypassPermissions` 和自动模式也跳不过：它返回 `safetyCheck` 类型的 ask，并设 `classifierApprovable: false`，和原来 `bridge:` 发送的做法一样（[SendMessageTool.ts:586](../../../src/tools/SendMessageTool/SendMessageTool.ts)）。`SendMessage` 发往 session 不需要确认。更细的权限规则留给 agent teams（#162）去定。
- **`SendMessage` 现有的队员和子 agent 路由不变。** 只是把 `uds:` / `bridge:` 换成 `session:`。结构化消息（`shutdown_request` 等）不能发往 session。原来这个工具只在 agent teams 打开时启用；现在 session-links 打开时也启用。只开 session-links 时，工具说明里只有 `session:<id>`，发往其他地址会被拒绝。
- **发出消息或创建 session 后结束这一轮，不编造对方的回复。** 实测中父 session 发完消息后写"等待回复…"，然后照着前几轮的样子自己续写了一段 `<cross-session-message>`。`SendMessage` 和 `StartSession` 的说明里写明：简短告诉用户做了什么就结束这一轮；回复之后作为新消息送来，永远不是自己写的；不要以任何形式编造或预测对方的回复；用户追问时只说还没回复。写法照 Claude Code 后台 agent 和协调者模式的提示（[AgentTool/prompt.ts:93](../../../src/tools/AgentTool/prompt.ts)、[coordinatorMode.ts:140](../../../src/coordinator/coordinatorMode.ts)）。
- **fork 出来的子 session 知道父 session 那一轮不归它。** agent 调 `StartSession` 时，父 session 正在一轮当中，复制过去的对话结尾是父 session 这一轮的指令和还没有结果的 `StartSession` 调用。CLI 恢复时会丢掉没有结果的调用（[conversationRecovery.ts:187](../../../src/utils/conversationRecovery.ts)），父 session 的指令就像一条没做完的任务，子 session 会接着去做。所以 fork 时 server 给每个没有结果的调用补一条结果，说明"这次调用创建了你所在的 session，上面这一轮由父 session 继续，你只做下一条消息"，再补一条合成的 assistant 回复，让这一轮完整结束，之后再送简报。Claude Code 的 fork 子 agent 用的是同一个做法（[forkSubagent.ts:107](../../../src/tools/AgentTool/forkSubagent.ts)）。用户在界面上 fork 不走这一步。
- **地址统一用 session id。** 标题只用于显示，不唯一，不用于寻址。
- **`RenameSession` 不需要确认**，只改显示，随 session-links 一起启用，子 agent 不可用（在 `ALL_AGENT_DISALLOWED_TOOLS` 里）。这样用户说"改个名字"时，agent 能直接改，不用再区分"名字"指哪一个。

### 送达和唤醒

`handleUserMessage` 里"确保 CLI 已启动、发送、记录本轮开始"这一段，拆成一个不依赖客户端 WebSocket 的函数，例如 `deliverUserTurn(sessionId, content, options)`。客户端发消息和 session 之间的消息都调用它。拆分时 SDK 回连地址改由 server 自己的监听地址生成，不再从客户端的 `ws.data` 取。

- **对方的 CLI 没在运行：** 先启动，再送达，和用户在一个已停止的 session 里发消息一样。
- **对方正在跑一轮：** 消息送进 CLI 后会排队。CLI 在本轮的下一次工具调用时把它作为"工作中收到的消息"交给模型（`wrapCommandText` 的说明文字），或者在本轮结束后开新的一轮。
- **对方闲着：** 送达后立即开一轮。
- **中途送到的消息要写进 transcript。** CLI 写 transcript 时原本丢弃几乎所有附件（[sessionStorage.ts:4406](../../../src/utils/sessionStorage.ts) 的 `isLoggableMessage`，上游为训练数据隐私加的），一轮中途送到的消息正是以 `queued_command` 附件交给模型的，于是刷新后看不到、CLI 续上对话时模型也不知道。这类附件现在照样写入；server 读历史时把它转成带 `origin` 的用户消息，id 用发送时的 `source_uuid`，和实时显示去重；fork 和回退按这个 id 也能定位到那条附件记录。

### 一轮进行中用户发的消息

session 发来的消息照上面的规则插进当前这一轮；**用户自己发的消息默认排到下一轮**，不再插话。CLI 的消息队列本来就有三档优先级（[textInputTypes.ts:278](../../../src/types/textInputTypes.ts)）：`later` 等这一轮结束再作为新的一轮处理，`next` 在下一次工具调用后插进当前这一轮，`now` 立即中断当前这一轮。排队就放在 CLI 的队列里，server 只同步一份状态给界面。

- **发送：** 一轮进行中（或者队列里还有没处理的消息），用户发的非斜杠命令消息带 `priority: 'later'` 交给 CLI，记进会话状态的 `queuedMessages`（id、正文、附件数、时间），不广播、不标记新一轮开始。
- **开始处理：** CLI 处理每条消息时用同一个 uuid 回放（`--replay-user-messages`）。server 收到排队消息的回放，就把它移出 `queuedMessages`、广播这条 `user_message`、标记新一轮开始；界面这时才把它显示在对话里。
- **撤回：** 客户端发 `cancel_queued_message`，server 向 CLI 发 `cancel_async_message`；CLI 确认删掉了才从队列状态里移除，已经开始处理的就不动。
- **立即发送和停止：** 客户端发 `send_queued_now`，server 只给 CLI 发 `interrupt`，当前这一轮结束后 CLI 接着处理排队的消息。队列里有消息时，"停止"也走这条路，和打断一样；队列为空时停止照旧（中断、3 秒后仍未结束就强制结束进程）。
- **一轮结束时要重启 CLI**（一轮中途切换了模型，或切进切出 `bypassPermissions`）：重启一排上日程，server 就把已经交给 CLI 的排队消息撤回来暂存，之后新排队的也只暂存；重启完成（或发现不需要重启）后按顺序重新发出，第一条开新的一轮，其余照旧排队。这样它们用上新的设置，也不会和 CLI 在这一轮结束时自动取队列抢时机。
- **CLI 进程退出、`/clear`：** 清空排队状态。排队的消息和 CLI 进程在一起，应用在一轮中途退出时会和这一轮一起丢失，和现状一致。

### 汇报

**server 不替子 session 回报。** 子 session 什么时候告诉父 session、用哪种方式，由它自己决定。早先的设计是子 session 一轮结束时由 server 自动把最后回复送回父 session，端到端测试里子 session 同时也会用 `SendMessage` 发一遍，父 session 收到两次、被唤醒两次，所以去掉了。

- **两种方式都走 `SendMessage`，用 `mode` 区分。**
  - `mode: 'message'`（默认）：马上送到。父 session 闲着就开一轮，正在工作就在下一次工具调用时看到。用于需要父 session 马上处理的事。
  - `mode: 'report'`：进展汇报，只能发给自己的父 session，server 校验调用方的 `session-meta.parent`。
- **汇报的送达：**
  - 父 session 正在跑一轮（会话状态里 `turn.phase` 不是 `idle`）：马上送到，`origin.purpose = 'report'`。CLI 的包装文字告诉它这是进展、不是请求。
  - 父 session 闲着或 CLI 没在运行：不唤醒它。server 往父 session 的 transcript 追加一条 `session-report` 记录（id、发送方、摘要、正文、时间），更新会话状态里的 `pendingReports`。
  - 父 session 下一轮开始时（不管是用户发消息还是别的 session 发消息），`deliverUserTurn` 取出排队的汇报，随这条消息一起交给 CLI（SDK 用户消息的 `reports` 字段），再追加一条 `session-report-delivered` 记录这些 id，清空 `pendingReports`。CLI 把每条汇报写成一条单独的用户消息，带各自的 `origin`，排在这一轮的 prompt 前面，同一次模型请求里送出。
- **排队的汇报只存在 transcript 里。** 还没送出的 = 没出现在任何 `session-report-delivered` 里的 `session-report`。会话恢复时从 transcript 读出 `pendingReports`，重启不丢。
- **代价：** 子 session 做完之后如果什么都不发，父 session 收不到结果。简报的包装文字里写明做完要发消息。

### 界面

- **侧栏嵌套。** 在项目分组内，子 session 显示在父 session 下面，缩进并带一条连线；父 session 行上有展开/收起的按钮，收起状态按 session 记在客户端。子 session 和父 session 不在同一个项目分组时（例如子 session 换了工作目录），子 session 留在自己的分组里平铺显示。fork 和 spawn 用不同的小图标区分。
- **消息来源。** `origin.kind === 'session'` 的用户消息显示成和思维链、工具调用一样的单行折叠条：图标、"来自 <发送方标题>"、`brief` / `message` / `report` 的标签和摘要，点开看正文。点击来源可以打开那个 session。
- **待送达的汇报。** 父 session 的 `pendingReports` 不为空时，输入框附近显示"N 条进展待送达"，展开是每条的发送方、摘要和时间，并说明它们会随下一条消息送达。实时界面里，随某条消息送达的汇报排在这条消息前面，和刷新后的历史一致。
- **H5** 用的是同一套前端，侧栏和消息卡片自然覆盖。
- 所有文字走 i18n，中英文都要加，两种主题都要检查。

### 删掉的东西

`UDS_INBOX` 相关的调用点全部删掉，包括 `SendMessage` 里的 `uds:` / `bridge:` 分支和提示词、`ListPeers` 工具、`/peers` 命令、启动时绑定 socket 和 `--messaging-socket-path` 参数、pid 文件里的 socket 字段、init 消息里的 socket 字段、无头模式的收件唤醒、终端界面里 `<cross-session-message>` 的渲染分支，以及 [udsMessaging.ts](../../../src/utils/udsMessaging.ts)、[udsClient.ts](../../../src/utils/udsClient.ts)、[ListPeersTool](../../../src/tools/ListPeersTool)、[peerSessions.ts](../../../src/bridge/peerSessions.ts) 这些空壳。`CROSS_SESSION_MESSAGE_TAG`（[xml.ts:59](../../../src/constants/xml.ts)）保留，新的包装用它。

## 主要流程

### 创建子 session，子 session 汇报

```plantuml
@startuml
participant "父 CLI" as P
participant "server" as S
participant "子 CLI" as C
P -> S : control_request StartSession\n(prompt, context, worktree)
S -> S : createSession / branch\n写 session-meta.parent
S -> C : 启动 CLI
S -> C : 用户消息 prompt\norigin = {session: 父, purpose: brief}
S --> P : control_response {id, title}
C -> S : SendMessage(mode: report)
alt 父 session 在跑
  S -> P : 用户消息\norigin = {session: 子, purpose: report}
else 父 session 闲着
  S -> S : 父 transcript 追加 session-report\npendingReports 更新
end
C -> S : SendMessage(mode: message)：做完了
S -> P : 排队的汇报 + 这条消息，同一轮送进去
S -> S : 追加 session-report-delivered
@enduml
```

### 两个 session 之间发消息

```plantuml
@startuml
participant "A 的 CLI" as A
participant "server" as S
participant "B 的 CLI" as B
A -> S : control_request SendMessage\n(to: session:B, message)
S -> S : 来源 = A（取自连接）\n校验 B 存在
S -> B : 需要时先启动 CLI
S -> B : 用户消息 + origin = {session: A, purpose: message}
S --> A : control_response {delivered}
B -> B : 包装成 <cross-session-message from="session:A">\n闲着则开一轮
@enduml
```

## 出错与边界

- **目标不存在：** `SendMessage` 返回失败和原因，不送达。
- **目标 CLI 启动失败：** 返回失败，带上启动错误，和用户发消息时看到的错误一致。
- **子 session 创建失败**（例如 worktree 建不出来）：`StartSession` 返回失败，已经写下的 transcript 文件删掉。
- **汇报发给不是自己父 session 的 session：** 返回失败。
- **父 session 已被删除：** 汇报和消息都返回目标不存在。
- **父 session 的一轮在 server 判断"在跑"之后、汇报送到之前结束：** 这条汇报会让 CLI 开新的一轮。不加额外处理。
- **应用在子 session 跑到一半时退出：** 子 session 的这一轮中断，没发出的消息就没有了。暂不处理。

## 测试

- **server：** `session-meta.parent` 的写入（创建、fork）和列表读取；跨项目送达；`deliverUserTurn` 在 CLI 未启动、运行中、闲着三种情况下的送达；客户端发来的 `origin` 被忽略；发送方改名后，下一条消息的来源带新标题；`RenameSession` 写成自定义标题、空标题被拒绝；汇报只能发给父 session，父 session 在跑时马上送到、闲着时排队，排队的汇报随下一轮送达、送达失败时不标记、重启后能恢复。
- **CLI：** `origin` 从入队到 transcript 一路不丢；`canBatchWith` 不合并来源不同的消息；`<cross-session-message>` 包装和正文转义；`SendMessage` 的 `session:` 地址校验；`StartSession`、`ListSessions` 发出的 `control_request` 形状。
- **桌面端：** 侧栏嵌套、展开收起、父 session 不存在时的显示；带来源的消息卡片在历史记录和实时消息里都正确显示。
- **端到端：** 在开发模式的应用里，一个 session 创建子 session（fresh、fork、fork 加 worktree），子 session 发消息和汇报，排队的汇报随下一轮送达，两个 session 互相发消息。

## 上线

- transcript 里新增的字段都是可选的，旧数据照常读取，旧的 fork 继续平铺显示。
- SDK 消息新增的 `origin` 字段只有 DreamCoder 的 server 会发送，CLI 不认识这个字段时会忽略它。

## 考虑过但没有采用的做法

- **实现 UDS inbox，让 CLI 之间直接通信。** 消息会绕过 server：server 的会话状态不知道这条消息，桌面端看不到它从哪里来，刷新后也对不上，这违背了"会话状态归 server 所有"。来源也只能靠对方自报，无法由第三方盖章。每个进程还得自己开 socket、登记、互相扫描。
- **给每个 session 发一个令牌，让 CLI 用 HTTP 调 server。** 浏览器控制就是这么做的。可行，但这是第二条通道；SDK 连接本来就属于这个 session，走它不需要令牌，server 也一定知道请求来自谁。
- **只用 `<cross-session-message>` 文本标签区分来源。** 标签是文本，可以被伪造，例如一个 session 读到的网页里藏着这样的标签，再转述给另一个 session。来源必须是结构化字段，由 server 填写。
- **由父 session 记录它的子 session 列表。** 那样父子两边各存一份，删除、fork 时要同时改两处。子 session 记父 session，子 session 列表靠推导，只有一个数据来源。

## 后续

- 进程内 team 成员的消息改成同一套来源字段，取代 `<teammate-message>` 文本识别。
- agent teams 的看板和任务分配，建立在这套基建之上。
