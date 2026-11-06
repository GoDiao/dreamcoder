# 共享任务与状态全景

核实日期：2026-10-23。范围：多个 agent 共用同一份任务与状态时，位于产品之下的一层：任务清单与看板、依赖、认领与租约、文件预留、消息，以及让多个进程与多个客户端看到同一份状态的同步层。上层产品见 [README](../README.md) 与 [research/](../research/)。背景讨论见 [#162](https://github.com/GoDiao/dreamcoder/issues/162)，Claude Code 现状见 [research/claude-code.md](../research/claude-code.md) 第 6 节。

## 0. 读法与核实约定

- 本次只读：没有安装、构建或运行任何被调研的工具；GitHub 只用 `gh` 读接口；npm 版本与许可证用 `npm view`（只查注册表）读取。
- 「许可证」「仓库创建」「最新 release 与日期」除特别标注外，均来自对应仓库的 GitHub API（`gh api repos/<owner>/<repo>` 与 `.../releases/latest`，2026-10-23 读取）。表格里的名称链接即该仓库，不在每格重复。仓库创建日不等于首次发布，只作成熟度的下限参考。
- GitHub 判定为 NOASSERTION 的仓库，在许可证格里写明读到的 LICENSE 实际内容。
- 文中 `@<sha>` 指在该提交读取的仓库路径；「未查到」表示查过但没有证据；「不适用」表示问题本身不适用。
- 表中「使用方」只写能给出出处的集成；没有出处的不写。
- 「是否能嵌入 Bun/TS 服务端」「Windows」两项，只写读到的文档声明；没有声明的写「未查到」，不推断。
- 判断与建议只出现在每节表中的「适配」列和第 6、7 节里。
- 已有拆解覆盖的产品（Codex、Multica、Paperclip、cc-haha、Raven）不在此重复，仅在第 5 节交叉引用；其他 agent 的合并、沙箱、通信见 [landscape-workspace.md](landscape-workspace.md)，AgentRoom 的 `room_claim` 与 Weave 的编辑前认领见该文件第 2、5 节。

---

## 1. 任务清单与看板（agent 用）

### 1.1 总表

| 名称 | 许可证 | 一句话 | 平台与前提 | 成熟度 | 使用方 | 对 macOS + Windows 桌面应用的适配 |
| --- | --- | --- | --- | --- | --- | --- |
| Claude Code 任务清单（[官方文档](https://code.claude.com/docs/en/agent-teams)；fork 见 [research/claude-code.md](../research/claude-code.md)@`939d934`） | 闭源 | 每个任务一个 JSON 文件，字段含 owner、`blocks`/`blockedBy`、三态（pending、in progress、completed）；文档称认领用文件锁，依赖解除自动完成；分配由 lead 的 `TaskUpdate(owner)` 或队友自行认领，同进程队友空闲时由运行时自动认领（claude-code.md 第 6 节）。文档与 fork 拆解均未提到租约或心跳；文档在 Limitations 里写明「任务状态可能滞后」，队友漏标完成会卡住下游任务 | 官方文档称任务清单位于 `~/.claude/tasks/{team-name}/`，会话结束后目录仍保留（受 `cleanupPeriodDays` 清理），`CLAUDE_CODE_TASK_LIST_ID` 可让多个会话共用一个目录（[interactive-mode](https://code.claude.com/docs/en/interactive-mode)）。官方文档称非交互的 `-p` 模式不会派生队友，DreamCoder fork 的 `--print` 行为与此不同（RFC #162）。队友的任务工具只在「有 Task 工具」的会话里存在（文档） | 上游 v2.1.309（2026-10-22）；团队功能实验性、默认关闭；DreamCoder fork 兼容 2.1.92，自动认领读错目录（[#163](https://github.com/GoDiao/dreamcoder/issues/163)，`c49c1fb` 实测） | Claude Code、cc-haha（见 research/cc-haha.md） | 数据模型（owner、依赖、三态、文件锁认领）已够用，不用另造；缺口在认领目录与 `--print` 下的唤醒，见第 7 节 |
| [Beads（`bd`）](https://github.com/gastownhall/beads)（`steveyegge/beads` 现已重定向到此） | MIT（LICENSE 在 `3b49066` 读取） | 依赖感知的任务图，Go 写的 CLI；`bd ready` 列出无阻塞任务，`bd update <id> --claim` 原子认领（置 assignee 与 in_progress）；`bd ready --claim` 只认领「未分配」的任务（`cmd/bd/protocol/lease_claim_test.go`@`3b49066`）。认领带租约：到期后 `bd reclaim` 把任务退回 ready，持有者用 `bd heartbeat` 续租，已被回收或已关闭时心跳失败（`cmd/bd/heartbeat.go`@`3b49066`）。默认 TTL 数值：未查到 | 存储为 Dolt（带版本的 SQL 数据库）：默认嵌入模式在进程内运行、单写者，数据在 `.beads/embeddeddolt/`；另有 `bd init --server` 连接外部 `dolt sql-server` 支持多写者；跨机同步走 git 远端的 `refs/dolt/data`；`.beads/issues.jsonl` 只是导出（README）。源码中的 heartbeat 注释写明：租约在节点本地的临时表里，只在授予它的节点上可强制，跨机器的认领可见性只靠会提交的 status 与 assignee（`cmd/bd/heartbeat.go`@`3b49066`）。README 标注 macOS、Linux、Windows、FreeBSD；npm 包 `@beads/bd` 1.3.1、PyPI 包 `beads-mcp`（README 徽章与安装节）。仓库树里另有 `backend/http` 与 `internal/httpapi/`（含 heartbeat、release 路由）：未读源码，稳定性未查到 | 创建 2025-10-12；v1.3.1（2026-09-30）；最近推送 2026-10-23 | `bd setup` 列出的集成：Claude Code、Codex、Cursor、Factory Droid、mux 等（README）。mcp_agent_mail 的 README 把它列为相邻的任务追踪项目（见 2.1） | 唯一找到的、认领带 TTL 与心跳且在 Windows 有声明的任务图；但它是 Go 二进制，不能链接进 Bun 进程，只能当外部 CLI 或服务调用 |
| [Task Master](https://github.com/eyaltoledano/claude-task-master) | MIT 加 Commons Clause（GitHub 判 NOASSERTION；LICENSE 首段写明授权不包含「出售」软件，且「出售」含为第三方提供托管或咨询支持以收费；npm 标 `MIT WITH Commons-Clause`） | 从 PRD 生成任务与子任务，模型经 MCP 的 `next_task`、`set_task_status` 等工具挑选并更新（README 列有 36 个 MCP 工具，约 21,000 token，可按 `TASK_MASTER_TOOLS` 缩减） | 任务存 `.taskmaster/tasks/tasks.json`（仓库树 `@c0c98d3`）；字段有 status（pending、done、deferred）、dependencies、priority、subtasks、metadata，页面未列 assignee 或 owner（[task-structure](https://tryhamster.com/docs/taskmaster/capabilities/task-structure)）。源码有 `file-storage` 与 `api-storage` 两个存储适配器（`packages/tm-core/src/modules/storage/adapters/`@`c0c98d3`）。Node 20 及以上（`package.json`）；README 给出 Windows 的 MCP 配置路径。认领或租约：未查到 | 创建 2025-03-04；task-master-ai@0.43.1（2026-03-31）；最近推送 2026-04-28 | README 列：Cursor、Windsurf、VS Code、Amazon Q CLI，Claude Code 经 `claude mcp add` | 是「单个模型规划自己的任务」的工具，没有多 agent 的归属与认领语义；Commons Clause 对打包进收费软件有限制，需法务确认 |
| [Backlog.md](https://github.com/MrLesk/Backlog.md) | MIT | 每个任务是仓库里的一个 Markdown 文件，带终端看板与本地 Web 看板；支持里程碑与依赖，agent 经 CLI 或 MCP 读写 | 存储为 `backlog/` 目录下的 `.md` 文件；git 可选，`--no-git` 为纯文件系统模式。配置里有跨分支准确性（`checkActiveBranches`）、`remoteOperations`、`autoCommit` 三项开关（README）。Web 看板监听 `127.0.0.1`。README 标 macOS、Linux、Windows；用 Bun 构建，Intel macOS 另用 npm 或 Bun 安装。owner 与认领语义、租约：README 未提 | 创建 2025-06-04；v1.55.2（2026-10-22，`@707c8fc`）；最近推送 2026-10-22 | README 列：Claude Code、Gemini CLI、Codex、Kiro、Cursor | 文件即数据，天然跨平台、可读、可 diff；没有认领原子性与过期，更像人与 agent 共用的计划板 |
| [vibe-kanban](https://github.com/BloopAI/vibe-kanban) | Apache-2.0 | 看板加每任务一个 workspace（分支、终端、dev server），可切换 10 余种 agent，评审 diff 后建 PR | `npx vibe-kanban`；README 顶部写明项目「sunsetting」。公告页（2026-04-10）称运营公司关闭、远端服务 30 天后下线、看板 issue 等远端数据随之删除，项目转为社区维护的纯本地架构（[公告](https://www.vibekanban.com/blog/shutdown)，原文未写确切下线日） | 创建 2025-06-14；v0.1.44（2026-04-24）；最近推送 2026-09-19 | 见 landscape-workspace.md 1.1 | 已在 landscape-workspace.md 列为 worktree 管理器；这里补充的事实是其看板数据随公司关闭，不能当作稳定依赖 |
| [CCPM](https://github.com/automazeio/ccpm) | MIT | 一套 agent skill：PRD 变 epic，epic 变 GitHub Issues，issue 变并行执行；任务文件带 `depends_on`、`parallel`、`conflicts_with`，每个 epic 一个 worktree（README@`3294c85`） | 依赖 GitHub Issues 与 git worktree；真正的认领原子性、租约：README 未提，未查到。README 称标记 `parallel: true` 的任务可由多个 agent 在同一 worktree 并行 | 创建 2025-08-18；无 GitHub release（`releases/latest` 返回 404）；最近推送 2026-10-19 | README 称兼容 Agent Skills 的 harness：Claude Code、Codex、OpenCode、Factory、Amp、Cursor | 把 GitHub Issues 当数据库、skill 当调度，由模型驱动；与「运行时规则分配」相反，作为反例对照 |

### 1.2 小结

- 分配者：Claude Code、Task Master、Backlog.md、CCPM 都靠模型（或人）在运行中挑任务；只有 Beads 把「认领」做成带条件的原子命令（只认领未分配、依赖已解除的任务），但调用它的仍是 agent 自己。
- 租约：这一类里只有 Beads 有 TTL 加心跳加回收；Claude Code 的任务清单只有文件锁，没有过期。
- 存储：Claude Code 是每任务一个 JSON 文件；Task Master 是单个 `tasks.json`；Backlog.md 是每任务一个 Markdown 文件；Beads 是 Dolt 数据库加 JSONL 导出。
- vibe-kanban 的看板数据随公司关闭而删除，是本类里唯一一个「数据在远端、服务已终止」的实例。
- 已有拆解中的看板（Multica 的 issue 看板、Paperclip 的 ticket、cc-haha 的计划审核任务）都是产品内置，不作为独立组件发布，见各自拆解文档。

---

## 2. 租约、认领、文件预留与消息

### 2.1 总表

| 名称 | 许可证 | 一句话 | 平台与前提 | 成熟度 | 使用方 | 适配 |
| --- | --- | --- | --- | --- | --- | --- |
| [mcp_agent_mail（Rust）](https://github.com/Dicklesworthstone/mcp_agent_mail_rust) | GitHub 判 NOASSERTION；LICENSE 标题为「MIT License (with OpenAI/Anthropic Rider)」。附加条款写明：对 OpenAI、Anthropic 及其关联方、代表它们行事的人，不授予任何权利，也不得向其提供、托管或使其访问本软件或衍生作品；任何违反即终止授权（LICENSE@`f7b4487`） | MCP 服务（README 称 45 个工具、25 个资源）：agent 身份、收发件箱、可搜索线程、对文件或通配符的「建议性」文件预留，附带提交前 hook 阻止提交他人预留的文件。预留调用形如 `file_reservation_paths(paths, ttl_seconds, exclusive)`，有 `renew`、`release`、`conflicts` 操作；README 称预留到期自动失效，过期的认领可被回收，获取预留时只报告冲突、不等待（README） | HTTP 服务默认 `127.0.0.1:8765`；SQLite 存实时状态，Git 存可读的持久账本；一个服务进程独占一个邮箱目录（README）。发布物含 `x86_64-pc-windows-msvc` 压缩包与 `install.ps1`（README）；安装需 `minisign` | 创建 2026-02-05；v0.3.39（2026-10-13）；README 有压力测试表，均为作者自测 | README 列：Claude Code、Codex CLI、Gemini CLI、Oh My Pi、GitHub Copilot CLI 等 | 设计最贴近需求（租约加信箱），但许可证附加条款直接点名 Anthropic，而 DreamCoder 驱动的是 Claude Code；使用或再分发前必须由法务确认，默认不能依赖 |
| [mcp_agent_mail（Python 原版）](https://github.com/Dicklesworthstone/mcp_agent_mail) | 同上，LICENSE 同样含 OpenAI/Anthropic 附加条款（`@5341e7f`） | README 开头称已被 Rust 版取代，不再维护 | Python 3.14 与 uv | 创建 2025-10-23；v0.3.2（2026-04-16） | 见 Rust 版 | 已停止维护，只作历史 |
| Beads 的认领与租约 | 同 1.1 | `--claim` 原子认领，TTL 租约，`heartbeat` 续租，`reclaim` 回收；Beads 另有 Message 类型的 issue，带线程与邮件式委派（README） | 同 1.1；租约只在授予节点强制 | 同 1.1 | 同 1.1 | 见 1.1 |
| Claude Code 的 `claimTask`（fork 拆解） | 闭源 | 任务文件加锁，拒绝认领被未完成任务阻塞的任务，有 `agent_busy` 选项（research/claude-code.md 引 `src/utils/tasks.ts:488-700@939d934`）；issue [#101029](https://github.com/anthropics/claude-code/issues/101029) 称 `TaskUpdate` 设 owner 能绕过依赖检查（二手，未核） | 随 fork | 实验性 | Claude Code | 原语已有锁与依赖检查，缺的是读对目录与过期机制 |
| Symphony 的 `claimed` 集合（见 3.1） | Apache-2.0 | 编排器内存里的「已认领、运行中、重试中」集合，加停滞超时与带退避的重试 | 见 3.1 | 见 3.1 | 见 3.1 | 认领状态不落盘，是「认领由运行时持有」的一个具体写法 |

### 2.2 小结

- 文件预留只找到 mcp_agent_mail 一家做成通用服务；Weave 与 AgentRoom 的认领见 [landscape-workspace.md](landscape-workspace.md) 第 2、5 节。
- 租约过期方式：Beads 是 TTL 加心跳；mcp_agent_mail 是 TTL 加显式续租，两者都是「到期即可被他人回收」，都不会强制中止持有者。Claude Code 与 Symphony 没有 TTL：前者靠文件锁，后者靠停滞超时（默认 5 分钟，`SPEC.md`@`be10a1b`）判定并重试。
- 跨进程同步：mcp_agent_mail 靠 HTTP 服务集中持有；Beads 靠本机 Dolt 加 git 远端；Claude Code 靠共享目录下的文件。
- 更重要的事实：mcp_agent_mail 的许可证对 Anthropic 与 OpenAI 有明文排除，且 Python 与 Rust 两个仓库都带。其作者另有 Rust 版 Beads 复刻（beads_rust，README 称原 Go 版「不再积极维护」），该说法与 Beads 仓库近期仍在发版不一致，以 Beads 仓库为准，未核 beads_rust 本身。

---

## 3. 外部 issue 系统当看板

### 3.1 总表

| 名称 | 许可证 | 一句话 | 平台与前提 | 成熟度 | 使用方 | 适配 |
| --- | --- | --- | --- | --- | --- | --- |
| [Linear MCP 服务](https://linear.app/docs/mcp) | 闭源托管服务 | 远端 MCP（`https://mcp.linear.app/mcp`，另有 `/mcp/readonly`），可查找、创建、更新 issue、项目、评论；页面未明示能否分配 issue、agent 能否作为被分配者 | 认证：OAuth 2.1，或把 OAuth token、API key 作 bearer；传输为 Streamable HTTP，`/sse` 已弃用（同页）。需要用户有 Linear 账号 | 未查到发布日期 | Claude Code 等 MCP 客户端（页面未逐一列出） | 需要用户自备 Linear 账号与联网；作为可选集成可行，不能是默认路径 |
| Linear 的 agent 接口（[agent-interaction](https://linear.app/developers/agent-interaction)） | 闭源 | 用户把 issue 委派或 @ 提及给 agent 时，Linear 创建 agent session 并发 webhook（`created`，之后用户追问为 `prompted`）；要求 5 秒内应答、10 秒内发出活动或更新外链；session 状态有 pending、active、error、awaitingInput、complete、stale，由 Linear 按最近活动自动设置，agent 不直接管理（同页）。issue 仍有一个负责的人类 assignee，agent 是「被委派方」（[Linear 博客，经搜索摘要，未核原文](https://linear.app/blog/our-approach-to-building-the-agent-interaction-sdk)） | 需要一个能接收 webhook 的公网地址或隧道（页面要求的是 webhook 回调，本地桌面应用如何接收：未查到）。Agent Plan API 标为 technology preview | 未查到 | Symphony（见下） | 「状态机由服务端维护、agent 只上报活动」的设计值得对照；桌面应用接 webhook 需要额外的转发服务 |
| [GitHub MCP 服务](https://github.com/github/github-mcp-server) | MIT | GitHub 官方 MCP：issue 读写（`issue_read`、`issue_write`）、子 issue（`sub_issue_write`）、issue 依赖（`issue_dependency_read`/`write`）、评论、Projects（`projects_get`/`list`/`write`），另有把 Copilot 分配给 issue 的工具（README@`f385262`） | 远端地址 `https://api.githubcopilot.com/mcp/`（OAuth）；本地可用 Docker 镜像 `ghcr.io/github/github-mcp-server`，或自行 `go build` 后 `github-mcp-server stdio`，用 PAT；GitHub Enterprise Server 不支持远端服务（README）。认领原子性、租约：未查到，README 没有这类原语 | 创建 2025-03-04；v2.0.3（2026-10-21） | README 列：VS Code、Copilot CLI、Claude Desktop、Cursor、Windsurf 等宿主，并给出 `claude mcp add github` 命令 | 工具齐全且官方维护；但只是 issue 的读写接口，没有认领或过期语义，要自己用标签或 assignee 约定实现 |
| [Symphony（OpenAI）](https://github.com/openai/symphony) | Apache-2.0 | 以 Linear 看板为控制面的编排器规范：按固定间隔轮询 tracker，按并发上限派发，每个 issue 一个工作区；状态由编排器内存持有，重启后从 tracker 与文件系统恢复，不需要持久数据库，内存里的调度状态不恢复（`SPEC.md`@`be10a1b`）。停滞超时默认 5 分钟，重试带退避 | 规范标「Draft v1，与语言无关」；仓库自带 Elixir 参考实现（目录 `elixir`）；`tracker.kind` 为必填、可选适配器（同 SPEC）。Windows：未查到 | 创建 2026-02-26；v0.0.3（2026-09-15）；最近推送 2026-09-15 | 以 Codex 为默认 agent（二手：[helpnetsecurity](https://www.helpnetsecurity.com/2026/04/28/openai-symphony-codex-orchestration-linear/)，搜索摘要，未核原文）；OpenAI 称不打算作为独立产品维护（同为二手，未核） | 「运行时轮询加分配」的规范正好与 #162 想要的运行时分配同向；但它的状态在外部 tracker，不在我们的服务端 |
| CCPM（GitHub Issues 为数据库） | MIT | 见 1.1 | 见 1.1 | 见 1.1 | 见 1.1 | 见 1.1 |
| Multica、Paperclip | 见各自拆解 | issue 看板内置于产品，分配由服务端规则或 checkout 完成 | 见 [multica.md](../research/multica.md)、[paperclip.md](../research/paperclip.md) | 见各自拆解 | 见各自拆解 | 说明「外部 issue 系统」路线的另一端：自建看板 |

### 3.2 小结

- 分配者：GitHub MCP 与 Linear MCP 只提供读写工具，分配由模型或人决定；Linear 的 agent 接口与 Symphony 则是服务端（或编排器）决定何时唤醒 agent。
- 过期：Linear 用 `stale` 状态标记长时间无活动的 session（页面未定义具体时限）；Symphony 用 5 分钟停滞超时；GitHub MCP 没有。
- 同步：三者都靠外部服务器持有状态，本机进程通过 HTTP 访问；离线不可用。
- 这一类依赖用户有账号、联网，且数据归外部服务所有，与桌面应用的本地优先定位不同。

---

## 4. 本地优先状态同步（CRDT 与同步引擎）

这一节回答「多个客户端（多个 UI 窗口、手机、浏览器）看到同一份任务与会话状态」的底层选择。#150 已在服务端实现带版本的会话状态快照与补丁，并向所有客户端广播（RFC #162）；这一节只列同步层现成方案，不评价 #150。

### 4.1 总表

| 名称 | 许可证 | 一句话 | 平台与前提 | 成熟度 | 使用方 | 适配 |
| --- | --- | --- | --- | --- | --- | --- |
| [Yjs](https://github.com/yjs/yjs) | MIT（LICENSE 文件；GitHub 判 NOASSERTION；npm 标 MIT） | 共享数据类型（Map、Array、Text 等）的 CRDT，更新可在任意传输上交换 | 纯 JS，TS 客户端即库本身；`y-websocket` 3.1.0（MIT）提供 WebSocket 服务器与客户端提供者。Bun 兼容：未查到声明 | 创建 2014-07-29；v13.6.33（2026-09-23） | 以 Yjs 对等端身份让 agent 编辑文档的实例：Electric 的博客（见 landscape-workspace.md 第 2 节） | 适合文本与文档型协同；任务这类「字段级更新加认领」的数据用它偏重 |
| [Automerge](https://github.com/automerge/automerge) | MIT | 类 JSON 文档的 CRDT，附紧凑编码与同步协议；核心为 Rust 编译为 WASM | `@automerge/automerge` 3.5.0；`automerge-repo` 提供 Repo、存储适配器（`NodeFSStorageAdapter`）与网络适配器（`NodeWSServerAdapter`，用 `ws`），官方示例在 Node 里运行（[文档](https://automerge.org/docs/reference/repositories/)）；`automerge-repo` 在 npm 的 latest 标签读到 `2.6.0-alpha.3`。Bun 兼容：未查到 | 创建 2019-12-26；js/automerge-3.5.0（2026-09-16）；README 称 3 版内存用量降到约十分之一（官方自述） | 未查到 | 文档模型与会话快照相似；Node 示例齐全，Bun 与 Windows 需自行验证 |
| [Loro](https://github.com/loro-dev/loro) | MIT | CRDT 库：文本、富文本、可移动树与列表、LWW Map，支持版本控制式的时间回溯与浅快照 | Rust、JS（WASM）、Swift；`loro-crdt` 1.17.1。Bun 与 Windows 声明：未查到 | 创建 2022-07-12；loro-crdt@1.17.1（2026-10-22） | 未查到 | 有树与历史能力，适合需要「任务树加历史」的场景；生态小于 Yjs 与 Automerge |
| [ElectricSQL](https://github.com/electric-sql/electric) | Apache-2.0 | Postgres 的实时同步引擎；README 称它只做读路径（从 Postgres 同步到客户端），按 Shape 做部分复制，经 HTTP API 与 CDN 分发（README@`3f9809f`）。仓库描述改为「The agent platform built on sync」 | 需要一个 Postgres 作源；TS 客户端 `@electric-sql/client` 1.5.28（Apache-2.0）。写路径：README 称由应用自己实现；服务端为 Elixir，随 Postgres 部署 | 创建 2022-06-01；最近 release 为 `@electric-sql/y-electric@0.1.54`（2026-09-09）；README 徽章 status 1.0（徽章 alt 文本写 Beta） | LiveStore 把它列为同步提供方（见下）；agent 场景：Electric 博客（见 landscape-workspace.md 第 2 节） | 桌面应用要先带一个 Postgres，成本高；适合有云端数据库的架构，不适合单机本地优先 |
| [Zero（Rocicorp）](https://github.com/rocicorp/mono) | Apache-2.0（仓库 LICENSE 与 `@rocicorp/zero` 1.11.2 的 npm 标注；注意仓库自述：自 2026-09-30 起部分测试不再公开，历史被重写，仓库由内部仓库单向发布，PR 由维护者移植） | 客户端查询、增量视图维护，服务端 `zero-cache` 同步；文档称需要 Postgres 15 及以上并开启逻辑复制，目前只支持 Postgres（[文档](https://zero.rocicorp.dev/docs/connecting-to-postgres)） | `zero-cache` 必须运行并保持与 Postgres 的连接（同页） | 创建 2023-02-09；GitHub release 只有旧的 `v12.2.2-source`，真实版本在 tag `zero/v1.11.2` 与 npm | 未查到 | 同 Electric：要 Postgres；开源状态在 2026-09 有收缩，选型时要看这一点 |
| [LiveStore](https://github.com/livestorejs/livestore) | Apache-2.0 | 事件溯源加响应式嵌入式 SQLite 的客户端数据层，事件持久化在本地并跨客户端同步，提供自定义冲突合并 | 适配器含 web、Expo、Node、Vue 的入门页（README）；同步提供方：Cloudflare Workers、ElectricSQL、S2，另有「自建同步提供方」指南（[文档](https://docs.livestore.dev/reference/syncing/sync-provider/cloudflare/)）；文档页未提及 Node 同步后端 | 创建 2023-09-21；v0.5.0（2026-10-15），0 版本号 | 未查到 | 事件加物化视图的模型与 #150 的「快照加补丁」同类，且有 Node 适配器；仍是 0.x，要自己实现同步后端 |
| [TinyBase](https://github.com/tinyplex/tinybase) | MIT | 响应式键值与表格存储，带同步器：WebSocket（`WsSynchronizer`）、BroadcastChannel、本地内存同步器；`MergeableStore` 用于同步（[文档](https://tinybase.org/guides/synchronization/using-a-synchronizer/)） | 示例服务端用 `ws`；也可在 Cloudflare Durable Object 里跑（同页）。冲突合并规则、持久化器清单、Bun 兼容：本次未查到 | 创建 2021-12-31；v10.0.0（2026-09-24），npm 读到 10.0.1 | 未查到 | 体量小、API 直观，适合会话级的小表；合并规则需读源码确认 |
| [Jazz 2.0（alpha）](https://github.com/garden-co/jazz) | MIT | 本地优先的关系型数据库，跨前端与后端同步部分表、持久流与文件；README 声明这是全新 API 的 alpha | 提供 Node 绑定（`jazz-napi`）与 WASM；从源码构建需要 Rust 工具链、RocksDB 编译（README 贡献节） | 创建 2026-01-04；v2.0.0-alpha.59（2026-10-04） | 未查到 | 仍是 alpha，API 全新，不适合现在依赖 |

### 4.2 小结

- 两类做法：数据结构自带合并（Yjs、Automerge、Loro、TinyBase 的 `MergeableStore`），与「服务端是权威、客户端复制」的同步引擎（Electric、Zero、LiveStore 的同步后端）。后一类中 Electric 与 Zero 都要求 Postgres；LiveStore 的同步后端是可插拔的，但未列出 Node 版。
- 跨进程：这些方案的「进程」是客户端与同步服务；没有找到把「agent CLI 进程」当作同步对等端的现成集成，除 Electric 博客里把 agent 作为 Yjs 对等端的例子外（见 landscape-workspace.md）。
- 存储：Yjs 与 Automerge 的更新是二进制（Automerge 另有 NodeFS 存储适配器）；LiveStore 是本地 SQLite；Electric 与 Zero 的权威存储是 Postgres。
- 在 Bun 与 Windows 上的运行声明，七项里只有 Automerge 的 Node 示例与 Jazz 的 Node 绑定有明文；其余均未查到。

---

## 5. 关键问题横向对照

只列事实，来源见前面各节表格。

| 条目 | 谁分配 | 认领如何过期 | 状态如何跨进程与客户端同步 | 存储格式 | 在 Bun/TS 服务端内嵌入 | TS/JS 客户端 |
| --- | --- | --- | --- | --- | --- | --- |
| Claude Code 任务清单 | 模型（`TaskUpdate`），或同进程队友空闲时运行时自动认领 | 无租约，仅文件锁 | 共享目录里的文件，靠各方读文件 | 每任务一个 JSON | 不适用（闭源 CLI 内部） | 不适用 |
| Beads | 模型或脚本调用 `--claim` | TTL 租约加心跳，`reclaim` 回收；租约只在授予节点强制 | 本机 Dolt；跨机用 git 远端的 `refs/dolt/data` | Dolt（SQL），JSONL 导出 | 否：Go 二进制，嵌入式 Dolt 单写者 | npm `@beads/bd`（安装 CLI 的包，API 形态未读） |
| mcp_agent_mail | 模型调用预留工具 | TTL，显式续租与释放 | 单个 HTTP 服务集中持有 | SQLite 加 Git 账本 | 否：Rust 二进制；许可证见 2.1 | 经 MCP |
| Task Master | 模型（`next_task`） | 未查到 | 文件，或 `api-storage` 适配器 | 单个 `tasks.json` | 它自己是 Node（`>=20`）包；作为库嵌入的方式：未查到 | npm 包，是否导出库 API：未查到 |
| Backlog.md | 人或模型 | 未查到 | 仓库文件（可选跨分支与远端检查） | 每任务一个 Markdown | 否：独立 CLI 与本地 Web 服务 | 经 CLI 或 MCP |
| Linear / GitHub MCP | 人或模型 | 无（Linear 的 session 有 `stale` 状态） | 外部服务，HTTP | 服务端 | 作为 MCP 客户端调用 | 经 MCP |
| Symphony | 编排器（轮询加规则） | 停滞超时 5 分钟，重试加退避；认领集合在内存 | 外部 tracker 为准，重启后重建 | 无持久库 | 规范可自行实现（语言无关） | 不适用 |
| Yjs、Automerge、Loro | 不适用 | 不适用 | CRDT 更新经 WebSocket 等传输交换 | 二进制更新 | 纯库，是 | 是（库本身） |
| ElectricSQL、Zero | 不适用 | 不适用 | Postgres 逻辑复制到客户端 | Postgres | 否：需要 Postgres 与独立服务 | 是 |
| LiveStore、TinyBase | 不适用 | 不适用 | 事件或 `MergeableStore` 经同步器 | SQLite 或内存 | Node 适配器已列出；Bun 未查到 | 是 |
| DreamCoder 服务端 #150（RFC #162 自述） | 不适用 | 不适用 | 带版本的快照与补丁广播给所有客户端 | 未查到（本次未读源码） | 已在服务端内 | 已有 |

---

## 6. 值得深拆的候选

下面只写意见，按推荐顺序，均按 [_template.md](../research/_template.md) 的格式做完整拆解。

1. Beads。唯一找到的、认领带 TTL 与心跳与回收、有 Windows 声明、且活跃发版的任务图；它的 `ready`、`claim`、`reclaim` 三个命令拆开正是「运行时分配加过期回收」的完整语义，可直接借来设计服务端的认领规则。要查默认 TTL、回收是否会中止持有者、`backend/http` 的 API 是否稳定。
2. Claude Code 任务清单的 `claimTask` 与自动认领路径（对照 #163）。数据模型已够用，拆解的目标是定出最小修法（认领目录、`--print` 下的唤醒）以及是否要在服务端增加租约，不用另造模型。
3. Symphony 的 `SPEC.md`。2312 行规范里定义了轮询、认领集合、停滞检测、重试退避与重启恢复，是「运行时规则分配」最完整的公开写法，且 Apache-2.0；Linear 的 session 状态机（含 `stale`）可作为对照。
4. mcp_agent_mail 的预留语义（只拆设计，不引用代码）。租约加信箱加提交前 hook 的组合最完整，但许可证排除 Anthropic，需要先请法务判断可否阅读借鉴；若不可，只能依据 README 的公开描述做设计层对照。
5. LiveStore（对照 #150）。事件溯源加响应式 SQLite 的模型与「快照加补丁加版本」同类，有 Node 适配器与可自建的同步后端；要查 Bun 与 Windows 是否可用，以及 0.x 的稳定性。
6. Backlog.md。文件即数据、跨分支与 worktree 的任务读取（`checkActiveBranches`）与我们的「每成员一个 worktree」直接相关，MIT；要查任务在多个 worktree 之间如何保持一致。

没有列入的：Task Master（单模型规划工具，无认领语义，且为 Commons Clause）、vibe-kanban（公司已关闭）、Electric 与 Zero（要 Postgres，与单机本地优先不合）、Jazz（alpha）、Yjs、Automerge、Loro、TinyBase（CRDT 适合协同文本，任务认领需要的是条件写入而不是无冲突合并；若以后要做多设备离线，再回头比较）。

## 7. 空白

按我们的需求逐项列出，目前没有找到做得好的现成方案：

1. 能嵌入 Bun/TS 服务端的任务认领库：带依赖、条件认领、TTL 与心跳的实现只找到 Go 二进制（Beads）与 Rust 服务（mcp_agent_mail），都不能链接进 Bun 进程，只能当外部进程；TS 库形态的没有找到。
2. 「运行时分配」的现成实现：Symphony 给了规范，参考实现是 Elixir，状态在外部 tracker；没有找到 TS 的、状态落在本地服务端数据库的实现。
3. 与 `--print` 模式的 CLI 进程协同的任务状态：所有方案都假设 agent 能调用工具（MCP 或 CLI）去认领或汇报；没有找到「由服务端在进程之外推进任务状态、并把任务以消息形式送入 CLI」的通用组件，Codex 的 NEW_TASK 消息与 Paperclip 的 checkout 都是产品内置。
4. 租约在多客户端下的语义：Beads 自己写明租约只在授予节点可强制；其余方案没有讨论「同一服务端、多个 UI 客户端同时看到并操作同一任务」的竞争，#150 的 first-wins 权限回复是我们这边已有的唯一类似做法。
5. mcp_agent_mail 的许可证风险：最接近的租约加信箱方案明文排除 Anthropic 与 OpenAI，没有等价的许可证干净的替代品。
6. 同步层与 agent 进程的对接：CRDT 与同步引擎都面向浏览器或应用客户端；把外部 CLI agent 进程当作同步对等端，只找到 Electric 博客里的一个 Yjs 示例，没有产品化实例。
7. Bun 与 Windows 的验证：本次调研的同步库与任务库里，Bun 兼容几乎都没有声明，Windows 只有 Beads、Backlog.md、mcp_agent_mail（Rust）、Task Master 的配置说明有文字依据，需要实测。
8. 任务看板的最小范围（RFC #162 的开放问题「做到多像 issue 跟踪器」）：Beads、Backlog.md、Linear、GitHub 说明了完整的 issue 系统包含的字段与命令，但没有任何一个把「面向 agent 团队的最小看板」（三态、依赖、owner、租约）单独做成可复用的最小集；Claude Code 自己的任务对象最接近。
