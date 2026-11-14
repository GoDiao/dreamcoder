# Side chat：技术设计

状态：已实现，在 `feat/side-chat` 分支上，基于 `main` 的 `2d145753`。文中的行号以这个分支合并时的代码为准，之后代码变了，行号可能对不上。

## 背景

用户在一个会话进行中想问点别的，比如顺手查一个函数、确认一个想法，现在只能打断当前这一轮，或者另开一个会话再把上下文讲一遍。side chat 让用户在不打断会话的情况下另开一段对话，并且自带会话到目前为止的全部上下文。

## 目标与非目标

目标：

- side chat 是从父会话最新位置完整分叉出来的会话。工具、MCP、卡片、附件都和普通会话一样，和父会话共用同一个工作目录，没有自己的 worktree。
- 显示在父会话右侧面板里，作为一个标签页，和终端、浏览器、文件并列。一个会话可以开多个。
- 标签菜单可以重命名、Detach（变成普通的分叉会话，出现在左侧列表），以及关闭。关闭就是删除，不二次确认，正在运行的会先停掉。
- 删除父会话时，它的 side chat 一起删除，不做归档。
- 标题是 `btw: <第一条用户输入>`。
- 会话之间互发消息走现有路径，见[会话关系技术设计](../session-links/tech-design.md)。

非目标：

- 不专门支持 H5。手机布局本来就不显示右侧面板，side chat 也就不出现。
- 不在多个客户端之间实时同步 side chat 标签。各客户端在打开父会话面板时向服务端对账一次。

## 设计

### 数据模型

- 父会话关系类型加一个 `side`（[sessionBranching.ts:100](../../../src/utils/sessionBranching.ts)，桌面端 `SessionParent['kind']` 同步）。关系仍然只写在 `session-meta` 的 `parent` 字段里，不另存。
- 左侧列表的关系图标表不包括 `side`（`Sidebar.tsx` 的 `ListedRelation`），因为 side chat 不进列表。

### 分叉：`forkSession`

- [`forkSession`](../../../src/server/services/sessionLinksService.ts)（`sessionLinksService.ts:130`）是唯一的分叉入口。分叉路由、StartSession 的 fork 和 side chat 都调用它。它负责：
  - 调用 `createSessionBranch`；
  - 继承权限模式和模型配置；
  - 按标题改名；
  - 失败时清理。
- 分叉说明用 `BranchNote`（`sessionBranching.ts:128`）表示，形如 `{ text, always }`：
  - 有未完成的工具调用时，用这段说明作为它们的结果；
  - `always` 为真时，即使没有未完成的调用，也追加一条 isMeta 说明和一条 "No response requested."。
- side chat 用 `SIDE_CHAT_NOTE`（`sessionLinksService.ts:32`，`always: true`），告诉模型父会话会继续执行上面那一轮，它只管下一条消息让它做的事。StartSession 的 fork 用 `always: false`，行为和以前一样。
- 接口沿用 `POST /api/sessions/:id/branch`。body 带 `kind: 'side'` 时 `targetMessageId` 可以不传，从最新位置分叉，标题用 `exactTitle` 原样写成 `btw`，不加 "(Branch)"。

### 会话列表：服务端默认不返回 side chat

- `listSessions`（`sessionService.ts:1068`）按文件修改时间排序，先切出 `[offset, offset + limit)` 这一页，再去掉 side chat；`total` 是文件总数。一页因此可能不满。分页读取的调用方都按 `total` 循环，所以能读完。
- 例外：传了 `sideChatsOf` 时，调用方自己的 side chat 会保留。CLI 的 `ListSessions` 用它（`sessionLinksService.ts:319`），这样父会话能找到自己的 side chat 并给它发消息。
- 左侧列表、命令面板搜索、看板的指派人选择都读这个接口，所以都看不到 side chat，不用各自过滤。
- `GET /api/sessions/:id/side-chats` 列出某个会话的全部 side chat（`listSideChats`，`sessionService.ts:1098`），不设数量上限。
- 查找 side chat 时（`findSideChatFiles`），先按项目目录把父会话分组，每个目录只扫一遍，并发读文件数上限 16（`FILE_SCAN_CONCURRENCY`）。每个文件只读开头 100 行里的关系（`readSessionRelation`），只有命中的才组装成列表项。

### 删除：`removeSessions`

- [`removeSessions`](../../../src/server/services/sessionLinksService.ts)（`sessionLinksService.ts:90`）负责全部删除。单个删除、批量删除和 `discardSession` 都调用它。步骤：
  1. 查出这些会话的 side chat，并入待删列表；
  2. 拦截这些会话的启动（`blockStarts(ids, 'deleted')`）；
  3. 等每个进程退出（`stopSessionAndWait`）；
  4. 删除文件；
  5. 删失败的撤销拦截，并逐个记日志；
  6. 关闭删掉的会话的连接（`closeSessionConnection` 已从 ws handler 挪到这个服务里）。
- 返回 `{ successes, failures, sideChatFailures }`：
  - `failures` 只含调用方要删的会话；
  - 没删掉的 side chat 单独放进 `sideChatFailures`；
  - `successes` 包含删掉的 side chat，桌面端靠它清理本地状态。
- 单个删除：父会话本身删失败时返回 404 或 500；成功时返回 `{ ok: true, sideChatFailures }`。批量删除原样返回这三个列表。桌面端两种删除共用 `warnSideChatFailures`（`sessionStore.ts:260`），有 side chat 没删掉时弹警告。侧栏的批量删除成功提示只数用户选中的会话。

### Detach：`detachSideChat` 和 `setSessionParent`

- [`detachSideChat`](../../../src/server/services/sessionLinksService.ts)（`sessionLinksService.ts:176`）的步骤：
  1. 检查：会话不存在返回 404，不是 side chat 返回 400，正在运行返回 409；
  2. 拦截启动（`blockStarts([id], 'detaching')`）；
  3. 等进程退出；
  4. 调用 `setSessionParent` 把关系改成 `{ 父会话, forked }`；
  5. 在 `finally` 里撤销拦截。
- `setSessionParent`（`sessionService.ts:1529`）在写队列里改写文件中所有带 `parent` 的 `session-meta`。只改开头那一条不够，原因有两个：
  - 后续追加的 `session-meta` 会复制关系，读取时以最后一条为准；
  - 会话列表和 `getSessionLinkInfo` 只读文件开头和末尾，会话写长以后，追加在中间的那条读不到。
- 接口：`PATCH /api/sessions/:id`，body 带 `{ detach: true }`。桌面端运行中不允许 Detach，菜单项是禁用的。

### 启动拦截

- `conversationService` 用一个 `blockedStarts` 表记录暂时不允许启动的会话，以及原因 `deleted` 或 `detaching`（`StartBlock`，`conversationService.ts:112`）。
- 两个启动入口都先调用 `assertStartAllowed`，分别报 `SESSION_DELETED` 或 `SESSION_DETACHING`。后者可以重试，桌面端提示"正在分离为独立会话，请稍后再发送"。
- 这样删除和 Detach 改写文件期间，不会有消息把进程重新拉起来。

### 标题

- `deliverUserTurn` 收到第一条用户消息时，调用 `titleSideChat`（`sessionLinksService.ts:190`）。只有同时满足以下几条才改名为 `btw: ` 加 `deriveTitle(input)`：
  - 会话标题还是 `btw`；
  - 父会话关系是 `side`；
  - `deriveTitle` 有结果。
- handler 里的 `renameSideChat`（`ws/handler.ts:879`）只调用这个函数，再通知客户端改名。起标题失败只记日志，这条消息照样发给 CLI。
- 用"标题还是 `btw`"来判断，不另存状态：服务重启后不会重复改名，用户自己改过的名字也不会被覆盖。首条消息里没有能用作标题的文字时（比如只有 XML 包起来的内容），标题保持 `btw`。

### 预热

- 桌面端连接会话后发 `prewarm_session`，服务端提前启动 CLI，空闲 5 分钟后停掉（`DEFAULT_PREWARM_IDLE_TIMEOUT_MS`）。
- 父会话面板会连接所有 side chat 标签，这样标题和运行状态都能看到，但都不预热（`connectToSession(id, { prewarm: false })`）。只有当前显示的那个 side chat 才预热（`SessionConversation` 在 `primary` 为假时调用 `prewarmSession`）。用户从切到一个 side chat 到打字发送，中间的时间足够预热完。
- 服务端只对"有仓库记录、但还没有任何消息"的会话跳过预热（`ws/handler.ts:573`）。这类会话要等第一次启动才切分支或建 worktree，这一步不能在用户发消息之前做。从仓库会话分叉出来的会话和 side chat 照抄父会话的仓库记录，但一开始就有消息，所以照常预热。

### 桌面端：会话视图

- [`SessionConversation`](../../../desktop/src/components/chat/SessionConversation.tsx) 从 `ActiveSession` 抽出来，主页面和 side chat 标签共用。它包括：
  - 目标条；
  - 空状态或消息列表；
  - 任务栏和待办栏；
  - 输入框；
  - 建立连接的 effect。
- side chat 外面不套页面外壳。
- 聊天组件（`MessageList`、`ChatInput`、`PermissionDialog`、`AskUserQuestion`、`StreamingIndicator`）一律必须传 `sessionId`，删掉了"没传就读当前标签页"的兜底。`PermissionModeSelector` 改由 `ChatInput` 传入 `workDir`。
- `primary` 为假（side chat）时，`ChatInput` 不做以下几件事：
  - 打字自动聚焦；
  - 运行状态变化时抢焦点；
  - 显示新会话的启动控件；
  - 替换空的占位会话。
- `cliTaskStore` 按会话分开存任务（`bySession`）。主视图和 side chat 各显示自己的任务栏。断开连接时清掉这个会话的任务，并用 `clearedCounts` 丢弃断开后才回来的旧请求结果。
- Cmd+. 停止焦点所在的会话视图（`data-session-view`，`lib/sessionView.ts`）。焦点不在任何会话视图里时，停止主会话。

### 桌面端：面板

side chat 标签：

- `WorkspaceTab` 加一种 `{ kind: 'sideChat'; sessionId }`（`workspacePanelStore.ts:60`），像其他标签一样存进 localStorage。
- 父会话面板打开时，`syncSideChats` 调 `GET /side-chats` 和本地标签对账：缺的补上，服务端已经没有的删掉。
  - 哪些 side chat 存在以服务端为准；标签顺序和当前激活哪个以本地为准。
  - 只在请求发出时已有的标签里判断哪些过期，请求期间新开的标签不会被删掉。
  - 刚在本地删除的会话不会被补回来（`isDeletedSession`）。
- `disposeTab` 遇到 side chat 标签时断开它的连接。父会话被释放或删除时，每个标签都会经过它。
- 新建：面板的新标签页里有 "Side chat" 入口，调用 `createSideChat`。
- 标签菜单（`SideChatTabTrigger`，`WorkspacePanel.tsx:1218`）：
  - 重命名：用 `RenameSessionDialog`，和会话标题栏菜单共用；
  - Detach：运行中禁用，接口成功后关掉标签；
  - 关闭：接口成功后关掉标签。标签上的 × 也是关闭。
  - 失败时标签保留，并弹出带原因的提示（`lib/sideChats.ts`）。

面板归属：side chat 的面板就是父会话的面板。

- `findSideChatParent`（`workspacePanelStore.ts:304`）从已打开的 side chat 标签推出 side chat 对应的父会话。不能从桌面端的会话列表推：列表只取最近 100 个会话，而且服务端本来就不返回 side chat。
- `openTab`、`selectFile`、`activateTab`、`closeTab`、`patchTab`、`closePanel`、`togglePanel`、`loadStatus` 等入口先用 `panelOwner` 把 sessionId 换算成父会话。这样 ShowUI、文件链接、agent 打开浏览器等调用方都不用改。
- side chat 打开的标签进入父会话面板，但不抢当前激活的标签，也不改面板开关（`fromSideChat`，`workspacePanelStore.ts:477`）。
- 有些标签的内容属于某个会话。`file`、`browser`、`uiPage` 标签带一个可选的 `sessionId`，记下打开它的 side chat，渲染时用 `tab.sessionId ?? 面板会话`（`WorkspacePanel.tsx:1335-1339`）。浏览器标签在面板里重新挂载时，网页实例、操作提示条和"停止控制"因此仍然属于 side chat。
- `browserControlRequests.isKnownSession` 认面板归属里的 side chat，否则 side chat 开标签的请求会被丢掉。`browserViewReporter` 按面板归属判断浏览器是否在前台。
- 系统通知或会话链接指向 side chat 时，`openSessionTab` 打开父会话，并激活对应的 side chat 标签（`lib/sessionNavigation.ts`）。
- `useReleaseIdleSessions` 把"有 side chat 在运行"的父会话当成忙碌，不释放。

## 顺带修复：丢弃分叉会话时删掉父会话的 worktree

- 问题：分叉会照抄父会话 `session-meta` 里的 `repository`，其中带着 `worktree: true` 和 `worktreePath`。`discardSession` 看到它就删掉对应的 worktree。StartSession 以 fork 启动且不另建 worktree，之后改名或投递失败时，父会话的 worktree 会被删掉。
- 改法：创建 worktree 的地方（`createDesktopWorktree`、`planIsolatedWorktree`）在 `repository` 里记下 `worktreeOwnerSessionId`。分叉时照抄这条记录，创建者 id 不变。`discardSession` 只在创建者就是自己时才删除 worktree。
- 没有这个字段的旧记录，丢弃时不删除 worktree。

## 出错与边界

- 删除时有 side chat 删失败：父会话照常删除，服务端记日志，接口在 `sideChatFailures` 里返回，桌面端弹警告。删不掉的 side chat 留在磁盘上，它的父会话已经不在，任何列表里都看不到它。
- Detach 时 side chat 正在运行：返回 409，桌面端菜单项本来就是禁用的。
- 删除或 Detach 期间有消息要启动这个会话：被启动拦截挡住，报 `SESSION_DELETED` 或 `SESSION_DETACHING`。
- 两个客户端同时开着：A 把 side chat 分离成普通会话后，B 上的标签要到下次打开面板才消失。这期间 B 点关闭，会删掉这个已经是普通会话的会话。这是接受的情况，见"考虑过但没有采用的做法"。
- 会话列表一页可能不满：side chat 占着文件下标但被过滤掉。侧栏只取第一页 100 个，side chat 多时，侧栏能显示的会话会相应少一些。

## 测试

服务端：

- `session-links.test.ts` 的 "side chats" 组：
  - 分叉：没有未完成的工具调用时也追加说明，有时给它们补结果；
  - 分叉路由和 `side-chats` 路由，以及 branch 路由的三种 400；
  - 分页和 side chat 过滤；
  - 只读关系；
  - 一次扫描，并发有上限；
  - 删除：
    - 单个删除和批量删除时 side chat 删失败的报告；
    - 删父会话时保留其他关系的子会话；
    - 删除前等进程退出；
  - Detach：
    - 改写所有 `session-meta`，文件写长后仍读到 `forked`；
    - 运行中返回 409；
    - 改写期间启动报 `SESSION_DETACHING`；
    - 不是 side chat 时拒绝；
    - 走路由的 Detach；
  - CLI `ListSessions` 只列调用方自己的 side chat。
- 同一文件还有第 7 节的 worktree 测试：从 worktree 会话不建 worktree 地分叉，投递失败后父会话的 worktree 还在。
- `session-links-delivery.test.ts`：
  - 标题：第一条消息后改名；第二条消息、服务重启、用户改名后都不再改；没有能用作标题的文字时保持 `btw`；起标题失败时消息照样投递；
  - 预热：已有消息的仓库会话会预热，还没设置好分支或 worktree 的新会话不预热。

桌面端：

- `SessionConversation.test.tsx`。
- `WorkspacePanel.test.tsx` 的 "side chats" 组：
  - 标签标题；
  - 浏览器和页面标签属于 side chat；
  - Detach 运行中禁用；
  - 菜单的 Detach、重命名，以及失败提示；
  - × 关闭。
- `WorkspacePanel.sideChatPrewarm.test.tsx`：全部连接，只预热当前显示的那个。
- `workspacePanelStore.test.ts` 的 "side chats" 组：
  - 各入口落到父会话面板；
  - 不抢激活标签；
  - 对账：补上、删掉、空列表关闭面板、激活标签失效时改激活最后一个、请求期间删除和新建；
  - 重启后从 localStorage 恢复。
- 其他测试文件：
  - `ChatInput.test.tsx`：`primary` 为假时不抢焦点、不显示启动控件，发送到传入的会话；
  - `lib/sideChats.test.ts`：接口失败时标签保留；
  - `sessionStore.test.ts`：Detach 后刷新列表；单个和批量删除的 side chat 警告；
  - `Sidebar.test.tsx`：批量删除的成功数只数选中的会话；
  - `cliTaskStore.test.ts`：按会话分开存；断开后回来的旧请求不写入；
  - `useKeyboardShortcuts.test.tsx`：Cmd+. 停止焦点所在的会话；
  - `useReleaseIdleSessions.test.ts`：有 side chat 在运行时父会话不释放；
  - `browserControlRequests.test.ts`、`browserViewReporter.test.ts`：side chat 的浏览器请求和前台判断；
  - `desktopNotificationNavigation.test.ts`：通知指向 side chat 时打开父会话和对应标签。

## 上线与兼容

- 不需要迁移。旧版本不认识 `side`，会把 side chat 当成没有父会话的普通会话显示在左侧列表里。删除父会话时，旧版本也不会连带删除 side chat。
- 旧的 worktree 记录没有 `worktreeOwnerSessionId`，丢弃会话时不再自动删除它们的 worktree。
- localStorage 里已有的面板标签照常加载。`browser` 和 `uiPage` 标签的 `sessionId` 是可选字段。

## 考虑过但没有采用的做法

- **列表先过滤 side chat 再切页。** 这样每次请求都要读所有文件开头的关系，分页越往后读得越多。现在先切页再过滤，代价是一页可能不满。
- **从桌面端会话列表推出 side chat 对应的父会话。** 列表只取最近 100 个会话，而且服务端不返回 side chat。
- **Detach 时在文件末尾追加一条 `session-meta`。** 会话写长以后，这条落在文件中间，读不到。
- **只连接当前显示的 side chat。** 那样其他 side chat 标签看不到标题和运行状态。现在全部连接、只预热当前显示的那个，进程数不随标签数增加。
- **关闭标签前由服务端检查它还是不是 side chat。** 只有两个客户端对同一个 side chat 做相反操作时才用得上，而且要给删除接口加参数。项目发布前不为这种情况加保护。
- **在 `setSessionParent` 里停进程。** 会让 `sessionService` 依赖 `conversationService`，形成循环引用。停进程放在 `detachSideChat` 里做。
