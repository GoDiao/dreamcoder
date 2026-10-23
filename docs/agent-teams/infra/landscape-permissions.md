# 权限与人工审批的基础设施全景

核实日期：2026-10-23。范围：多个编码 agent 并行时，位于产品之下的权限一层：把审批请求路由给人、按角色定规则、异步审批。上层产品见 [README](../README.md) 矩阵第 11 行与 [research/](../research/)。背景见 [#162](https://github.com/GoDiao/dreamcoder/issues/162)（Open questions 与「一个会话启动另一个会话时的同意」一条）、[#164](https://github.com/GoDiao/dreamcoder/issues/164)、[#150](https://github.com/GoDiao/dreamcoder/pull/150)。

## 0. 读法与核实约定

- 本次只读：没有安装、构建或运行任何被调研的工具；GitHub 只用 `gh` 读接口，网页只做抓取与搜索。
- 「许可证」「仓库创建」「最新 release 与日期」除特别标注外，均来自对应仓库的 GitHub API（`gh api repos/<owner>/<repo>` 与 `.../releases/latest`，2026-10-23 读取）。表格里的名称链接即该仓库，不在每格重复。仓库创建日不等于首次发布，只作成熟度的下限参考。npm 包的版本与许可证来自 npm registry（同日读取）。
- GitHub 判定为 NOASSERTION 的仓库，在许可证格里写明读到的实际文本。
- 「未查到」表示查过但没有证据；「不适用」表示问题本身不适用；「未核」表示只有二手来源或只读了摘要。
- 表中「使用方」只写能给出出处的集成；没有出处的不写。
- 判断与建议只出现在每节「适配」列和文末两节里。
- 官方文档站（code.claude.com、modelcontextprotocol.io、learn.chatgpt.com）的内容是 2026-10-23 抓取的当前版本。DreamCoder 的 CLI fork 兼容上游 2.1.92（见 #162），而下文引用的文档对应上游较新版本（最新 v2.1.309，2026-10-22）。文档里出现的 `PermissionRequest` hook、`defer`、`permissionPrompts`、`requestId` 等能力在 fork 中是否存在：未查到，本次没有读 fork 源码。
- 本文把「请求怎么标明来源」「按角色的规则」「超时与默认动作」「同步还是异步」「多端先到先得」「能否嵌进 Bun/TypeScript、macOS 与 Windows」作为每项的固定问题，表中答不出的写「未查到」。

---

## 1. Claude Code 与 Codex 的原生权限面

### 1.1 总表

| 名称 | 许可证 | 一句话 | 平台与前提 | 成熟度 | 使用方 | 对 macOS + Windows 桌面应用的适配 |
| --- | --- | --- | --- | --- | --- | --- |
| Claude Code 权限模式与规则（[permission-modes](https://code.claude.com/docs/en/permission-modes.md)） | 闭源 | 六种模式：`default`、`acceptEdits`、`plan`、`auto`（分类器模型审查）、`dontAsk`（把所有会弹的提示改为拒绝）、`bypassPermissions`；deny 规则在所有模式下都生效，包括 `bypassPermissions` | 随 Claude Code。非交互 `-p` 在 v2.1.302 起默认从 `default` 开始，需要审批的调用除非有 allow 规则、hook、`canUseTool` 或 `--permission-prompt-tool` 批准，否则被拒（同页）。`auto` 连续被拦 3 次或累计 20 次后暂停并回到弹提示（同页） | 上游 v2.1.309 | Claude Code；DreamCoder 经 `--print` 驱动 | 模式是整会话的，没有按成员设置的入口：文档称队友继承 lead 的模式，`dontAsk` 除外，且不能在 spawn 时按队友设置（见 [research/claude-code.md](../research/claude-code.md) 第 11 节） |
| Claude Code 评估顺序（[Agent SDK permissions](https://code.claude.com/docs/en/agent-sdk/permissions.md)） | 闭源 | 顺序为：hooks、deny 规则、ask 规则、权限模式、allow 规则、`canUseTool` 回调。hook 的 `allow` 不能越过 deny 与 ask 规则；已被前面步骤批准的调用不会到达回调 | 同上。文档称要对每个调用都生效的检查，必须用 `PreToolUse` hook，不能放在 `canUseTool` | 同上 | 同上 | 我们的服务端若只实现 `canUseTool`，会漏掉被 allow 规则或 `acceptEdits` 提前放行的调用，这是预期行为，不是缺陷 |
| `canUseTool` 回调与 `control_request`（[user-input](https://code.claude.com/docs/en/agent-sdk/user-input.md)、[TypeScript 参考](https://code.claude.com/docs/en/agent-sdk/typescript.md)） | 闭源（[claude-agent-sdk-typescript](https://github.com/anthropics/claude-agent-sdk-typescript) 仓库 GitHub 未识别许可证） | 回调参数含工具名、输入，以及 `signal`、`suggestions`、`toolUseID`、`agentID`（调用发生在子 agent 内时给出）、`requestId`（v2.1.199 起）。返回 allow（可改输入、可附带 `updatedPermissions`）或 deny（可带 `interrupt`） | 回调可以一直挂起：文档写「permission prompts don't time out」，返回 `null` 仅当应用已用自己的通道对同一个 `requestId` 发过 `control_response`，否则调用无限期阻塞（TypeScript 参考页）。`AskUserQuestion` 在子 agent 中不可用（user-input 页） | SDK v0.3.309（2026-10-22）；仓库创建 2025-09 | cc-haha 把成员进程的 `can_use_tool` 请求转发到 lead 会话，带 `agent_id=name@team` 与 `display_name`（`src/server/services/conversationService.ts:1692-1696@6ac5836`，见 [research/cc-haha.md](../research/cc-haha.md)） | 唯一一条在 `--print` 下能把请求交给宿主的官方通道，且 `requestId` 加「返回 null」的约定正好对应多端先到先得；DreamCoder 的 #150 已有这一半，缺的是对队友请求的接入（#164） |
| `PermissionRequest` hook（[hooks](https://code.claude.com/docs/en/hooks.md)） | 闭源 | 在 Claude Code 即将弹提示、或本应自动拒绝一个无法弹提示的调用时触发；`command`、`http`、`mcp_tool`、`prompt` 型 hook 可返回 allow/deny（allow 可改输入、附 `updatedPermissions`；deny 可带 `message`、`interrupt`）；不支持 `agent` 型 | 输入有 `tool_name`、`tool_input`、可选的 `permission_suggestions`，没有 `tool_use_id`；`agent_id` 与 `agent_type` 是公共输入字段，文档称在子 agent 或进程内队友里触发时给出，但该页对 `PermissionRequest` 事件没有单独写明。`command`/`http` 的默认超时 600 秒，超时即取消、一般不产生决定；设置 `onFailure: "block"` 时 `PermissionRequest` 的失败等于拒绝。Windows 上没有 Git Bash 时，shell 形式的 hook 失败可能直接阻断调用（同页）。沙箱命令的网络请求不触发该 hook | 同上 | HumanLayer 的 Claude Code 插件用它向守护进程发审批请求（见 2.1） | 它是「不改 CLI 就能外接审批」的最小入口，且能在 CLI 自带弹窗与外部审批之间并发。Windows 的 hook 失败行为需要实测 |
| `PreToolUse` 的 `defer`（[hooks](https://code.claude.com/docs/en/hooks.md)） | 闭源 | hook 返回 `defer` 后，本轮结束，结果带 `stop_reason: "tool_deferred"` 与 `deferred_tool_use`；外部进程取得答案后用 `claude -p --resume <session-id>` 恢复，同一调用再次触发 hook，此时返回 allow 或 deny | 只在 `-p` 下生效；一轮里有多个并发工具调用时 `defer` 被忽略并告警；恢复时不恢复原权限模式，需重新传参（同页）。队友调用能否 defer：未查到 | 同上 | 文档称面向「以子进程运行 `claude -p` 的集成」 | 是官方唯一的异步审批机制（审批人离线、进程可退出）。限制是单调用轮次，对并行队友的适用性要实测 |
| `--permission-prompts none` / `permissionPrompts: 'none'`（[headless](https://code.claude.com/docs/en/headless.md)） | 闭源 | 无人可答时，会弹提示的调用直接拒绝，并告诉模型无人能批准、不要重试；运行继续。同时移除 `AskUserQuestion`，未被 `Elicitation` hook 回答的 MCP elicitation 被取消 | v2.1.259 起 | 同上 | 同上 | 对应「没有人可问时拒绝」的默认动作，cc-haha 在自己的桥接层里做了同样的事（`src/utils/swarm/printLeaderPermissionBridge.ts:108-117@6ac5836`） |
| Claude Code 队友权限路径（[research/claude-code.md](../research/claude-code.md) 第 11 节，`@939d934`） | 闭源 | 同进程队友的请求进 lead 的确认队列，带队友名与颜色徽章；队列只由 REPL 注册。回退路径是向 lead 收件箱写 `permission_request` 并轮询 `permission_response` | `--print` 下没有确认队列，回退路径无人读（DreamCoder `c49c1fb` 实测，[#164](https://github.com/GoDiao/dreamcoder/issues/164)：队友挂起 3 分 35 秒）。较新版本：队友收到的 `SendMessage` 被标注为来自另一个会话，不能替用户批准 | 上游实验功能 | Claude Code、cc-haha | 已有拆解，不重复；本节只补充可用于补这个缺口的官方通道 |
| Codex `approval_policy` 与 `approvals_reviewer`（[源码 schema](https://github.com/openai/codex/blob/f3a90545aed3188ee1e5c119ec89a742de399cdc/codex-rs/app-server-protocol/schema/typescript/v2/AskForApproval.ts)、[文档](https://learn.chatgpt.com/docs/agent-approvals-security)） | Apache-2.0 | 策略值为 `on-request`、`never`、`granular`（按类别保留交互：沙箱升级、execpolicy 规则、MCP 提示、`request_permissions`、技能脚本），旧的 `untrusted` 已退役；审批人为 `user`（默认）或 `auto_review`（模型审查者） | `granular` 把不保留交互的类别自动拒绝；`--ask-for-approval never` 用于非交互运行（文档）。`approvals_reviewer` 的枚举定义在 `codex-rs/protocol/src/config_types.rs@f3a9054` | rust-v0.163.0（2026-10-15）；创建 2025-04 | Codex | 类别化的「哪些请求要人、哪些自动拒绝」值得借鉴，但它是整会话配置，不按成员或角色设置 |
| Codex guardian / auto_review | Apache-2.0 | 对需要审批的动作（沙箱升级、被拦的网络请求、有副作用的应用或 MCP 调用）先交给审查 agent：critical 风险拒绝，low 与 medium 在策略允许时放行，high 需要足够的用户授权且无匹配的 deny 规则（文档） | 审查超时 90 秒、最多 3 次尝试（`codex-rs/ext/guardian-reviewer/src/lib.rs:43-44@f3a9054`）；文档称超时时动作不执行且与拒绝分开报告，提示构造、审查会话、解析失败一律失败即关闭。V2 子 agent 的审查带根会话中最多 16 条有界的用户授权（`codex-rs/core/src/agent/control/user_authorization.rs:44-63@2f3fb11`，见 [research/codex.md](../research/codex.md)）；app-server 协议有逐项的 guardian 开始与完成通知，以及「批准被 guardian 拒绝的动作」的请求（`codex-rs/app-server-protocol/schema/typescript/v2/` 下 `ItemGuardianApprovalReview*`、`ThreadApproveGuardianDeniedAction*`@`f3a9054`） | 同上 | Codex | 超时即不执行、失败即关闭、审查者带根会话上下文，是目前找到的最完整的模型审查做法；但它是 Rust 内部实现，只能借设计，不能当库用 |
| Codex 按线程路由的审批 | Apache-2.0 | 请求按发起线程路由；非当前视图的线程也弹出审批层，标题为「Thread: <标签>」，另有「Approval needed in <thread>」提示条（`codex-rs/tui/src/bottom_pane/approval_overlay.rs:718-723@2f3fb11`、`pending_thread_approvals.rs:45-66@2f3fb11`）；非交互时无法弹出审批则报错交回父流程（[subagents 文档](https://learn.chatgpt.com/docs/agent-configuration/subagents)） | 子 agent 继承父的 `approval_policy`、`approvals_reviewer`、权限配置，角色文件不能放宽（`codex-rs/core/src/agent/child_config.rs:183-200@2f3fb11`、`role_tests.rs:548-560@2f3fb11`） | 同上 | Codex | 「来源标签加跳转」是我们团队视图里审批卡片的直接参照；按角色放宽被明确禁止，是与 lead 继承的另一种选择 |

### 1.2 小结

- Claude Code 在 `--print` 下有三条官方通道可接审批：`canUseTool` 的 `control_request`、`PermissionRequest` hook、`PreToolUse` 的 `defer`。前两条同步，第三条异步但限单调用轮次。
- 请求来源标识：`canUseTool` 有 `agentID`、`toolUseID`、`requestId`；`PermissionRequest` hook 的输入没有 `tool_use_id`（文档），HumanLayer 的插件因此要靠工具名与输入去匹配正在运行的调用（`apps/riptide-claude-code-plugin/hooks/mod.ts@3a8dd2d`）。角色或团队信息不在任何一个官方字段里，只有 `agent_type`（公共输入字段）。
- 超时：Claude Code 的提示本身不超时；hook 有默认 600 秒的超时，超时后一般无决定。Codex guardian 90 秒、失败即关闭。
- Codex 与 Claude Code 都没有「按成员设置权限」的入口：Codex 的角色文件不能放宽，Claude Code 队友继承 lead。

---

## 2. 人工审批路由产品与协议

### 2.1 总表

| 名称 | 许可证 | 一句话 | 平台与前提 | 成熟度 | 使用方 | 对 macOS + Windows 桌面应用的适配 |
| --- | --- | --- | --- | --- | --- | --- |
| [HumanLayer](https://github.com/humanlayer/humanlayer)（当前主线，`3a8dd2d`） | Apache-2.0（另有少数 vendored 目录保留 MIT，见 NOTICE） | 在你的机器上运行 Claude Code、Codex、OpenCode、Pi，并把任务、会话、计划、审核同步到桌面端、网页端和每台主机上的守护进程（README） | Bun 加 Docker，构建 `apps/riptide-native` 还需要 Rust；桌面端有 Electron 与 Tauri 两套（README）。Windows：README 只写「macOS desktop apps」，其余未查到 | 创建 2024-08；GitHub 最新 release `pro-0.20.0`（2025-12-23），主线最近提交 2026-10-23 | README 称其插件把 Claude Code、Codex、OpenCode、Pi 的会话镜像进来 | 技术栈与我们最接近（Bun、Tauri、Electron、Claude Code），是找到的唯一把「Claude Code 审批外移到多端」做成产品的开源实现，见下 |
| HumanLayer 的 Claude Code 审批路径（`apps/riptide-claude-code-plugin/hooks/mod.ts`、`apps/riptide-api/src/orpc/api/approvals/resolve.effect.ts`、`apps/riptide-api/src/db/reject-pending-approvals.ts`、`apps/riptide-daemon/src/agents/claudecode/approvals.ts`@`3a8dd2d`） | 同上 | 插件挂在 `PermissionRequest` hook 上，向本机服务发审批请求，请求含会话 id、工具调用 id、工具名、输入、`agentId`；hook 注释写明 Claude Code 自己的提示同时显示，「谁先答谁生效」；网页端的答案以 15 秒长轮询取回，允许、拒绝（可带中断）或「无」（交回 Claude Code 自己的流程） | 服务端 `resolve` 对已处理的审批幂等返回成功，并要求调用者对该会话有 prompt 级访问权限；会话结束或守护进程关闭时，`rejectPendingApprovals` 把同一会话下所有待处理审批批量改为 `denied` 并附说明；守护进程按「已批准审批里附带的允许规则」匹配后续同类调用。轮询循环里没有超时，直到请求被中止（`mod.ts` 的 `approval` 函数）。审批存在 Postgres，经 Electric 同步到各客户端（README、`apps/riptide-daemon/src/collections/electric/approvals.ts`） | 同上 | 同上 | 对应 #150 的「先到先得」与会话状态广播，并且是 `PermissionRequest` hook 的真实用例；但它依赖 Postgres 与云端控制面，不能原样搬进本地优先的桌面应用，可借的是请求字段、幂等语义、关闭时批量拒绝、与 CLI 自带提示的并发 |
| HumanLayer 旧 SDK（tag `v0.5.5`，`6c70eec`） | Apache-2.0（README 徽章） | Python 装饰器 `@hl.require_approval()` 包住高风险函数，调用时先向后端登记调用并等待人答复；另有 `hl.human_as_tool()` 让模型主动问人；渠道含 Slack 与邮件（[官方文档](https://humanlayer.dev/docs/channels/introduction)，经搜索摘要，原页本次未能抓取） | Python；同一仓库历史中的 `humanlayer/core/approval.py` | 同仓库，v0.5.5 为旧版本，未查到弃用声明 | 旧 README 列出 LangChain、CrewAI、ControlFlow 示例 | 请求身份是 `run_id`（可由环境变量 `HUMANLAYER_RUN_ID` 提供）加每次调用生成的 `call_id`；答复靠每 3 秒轮询，循环里没有超时；被拒绝时返回一段文字给模型，异常时返回错误文字而不是抛出（`humanlayer/core/approval.py@6c70eec`） | 设计上属于「工具内置的人工关卡」，与我们的 CLI 外挂形态不同；只有「调用 id 加运行 id 加文字化的拒绝理由」的约定可借 |
| MCP elicitation（[规范 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28/client/elicitation)） | 规范仓库 GitHub 判定 NOASSERTION；LICENSE 写明项目正从 MIT 过渡到 Apache-2.0，新内容为 Apache-2.0 | 服务器在处理客户端请求时，经 `InputRequiredResult` 里的 `elicitation/create` 向用户要信息；两种模式：`form`（受限的扁平 JSON Schema）与 `url`（敏感操作，带外完成）；用户有 accept、decline、cancel 三种答复 | 客户端必须让用户清楚是哪个服务器在请求，并提供明确的拒绝与取消；规范写明服务器必须把请求绑定到客户端与用户身份，且不能信任客户端自报的用户身份；没有超时字段；通过 `requestState` 或服务器自存状态实现「无状态」重试（同页） | 规范 2026-07-28；仓库创建 2024-09 | Claude Code 提供 `Elicitation` 与 `ElicitationResult` hook，无人应答时被取消（headless 文档） | 它是 MCP 服务器向人要输入的协议，不是编码 agent 的工具权限机制；无法用来给队友的 Bash 调用做审批。可借它的三态答复与「必须标明请求方」的要求 |
| MCP authorization（[规范 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization)） | 同上 | 对 HTTP 传输：MCP 服务器是 OAuth 资源服务器，客户端是 OAuth 客户端；要求 RFC 9728 受保护资源元数据、RFC 8707 resource 参数、PKCE 等；运行时权限不足时服务器返回 403 与 `insufficient_scope`，客户端做 step-up 重新授权（同页） | stdio 传输「不应」使用本规范，改从环境取凭据；授权是可选的（同页） | 同上 | 同上 | 管的是客户端到某个 MCP 服务器的令牌范围，不涉及「哪个 agent 角色能调用哪个工具」。规范文本里没有携带调用方 agent 或角色的字段：未查到 |
| [Permit.io](https://github.com/permitio/permit-mcp)（Access Request MCP） | MIT（仓库）；Permit 平台为托管服务，平台许可：未查到 | MCP 服务器，提供创建、列出、批准、拒绝访问请求与操作审批请求的工具；可在本地由有权限者在 AI 助手里使用，或作为托管部署供终端用户发起请求（README） | Python 3.10 以上与 uv（README）；平台托管。另有「MCP gateway 的 human-in-the-loop」：网关暂停敏感工具调用并路由给指定管理员，在平台的 Approvals 页处理，仅 Enterprise 套餐，且被描述为即将推出（[docs.permit.io](https://docs.permit.io/permit-mcp-gateway/human-in-the-loop)，经搜索摘要，未核原文）。Slack 作为审批渠道：未查到 | 仓库创建 2025-02；无 GitHub release | 官方教程称可与 LangGraph 的 `interrupt()` 结合（[博客](https://www.permit.io/blog/delegating-ai-permissions-to-human-users-with-permitios-access-request-mcp)，未核） | 依赖托管平台，与本地优先的桌面应用定位不合；可参考它把「访问请求」与「操作审批」分开建模 |
| [Knock Agent Toolkit](https://github.com/knocklabs/agent-toolkit) | MIT | 把 agent 的工具包一层，调用时先触发你在 Knock 里定义的通知工作流，人异步答复后再继续；Knock 负责邮件、短信、应用内、Slack、MS Teams 等多渠道投递与用户偏好（[文档](https://docs.knock.app/developer-tools/agent-toolkit/human-in-the-loop-flows)，经搜索摘要） | Node/TypeScript 包；Knock 是托管服务，本地自托管：未查到。默认不把任何工作流暴露为工具，要显式列出（同上，未核）。收到答复后恢复被暂停工具的代码需要自己写（第三方对比页的说法，未核） | 仓库创建 2025-03；v0.5.7（2026-04-17），版本号仍在 0.x | 使用方：未查到 | 能解决「离线审批人收到推送」这一段，不解决 CLI 里的挂起与恢复；依赖托管服务 |

### 2.2 小结

- 找到的唯一把 Claude Code 工具权限外移到多端并做成产品的开源实现是 HumanLayer 的 Claude Code 路径；它用 `PermissionRequest` hook 取得请求、用服务端表保存状态、用幂等的 `resolve` 处理多端重复答复。
- MCP 的 elicitation 与 authorization 解决的是 MCP 服务器向人要输入、客户端向服务器证明身份，与「编码 agent 的 Bash 调用谁来批」不是同一个问题。
- 两条异步审批的路线：HumanLayer 旧 SDK 的轮询加外部渠道（Slack、邮件）、Claude Code 的 `defer` 加 `--resume`。没有找到把二者接起来的现成实现。
- 超时与默认动作：HumanLayer 两代代码里都没有读到超时，等到答复或被中止；会话结束时批量拒绝。

---

## 3. agent 框架的中断与恢复原语

### 3.1 总表

| 名称 | 许可证 | 一句话 | 平台与前提 | 成熟度 | 使用方 | 对 macOS + Windows 桌面应用的适配 |
| --- | --- | --- | --- | --- | --- | --- |
| [LangGraph](https://github.com/langchain-ai/langgraph) `interrupt()`（[文档](https://docs.langchain.com/oss/javascript/langgraph/interrupts)） | MIT | 在节点里调用 `interrupt()` 暂停图，负载经 `__interrupt__` 返回调用方；用同一个 `thread_id` 加 `Command({ resume })` 恢复，恢复值成为 `interrupt()` 的返回值，节点从头重跑 | 需要检查点存储；并行的多个中断用「中断 id 到恢复值」的映射一次恢复；文档没有提超时，图会一直等（文档原文未写，本条为据此的读法） | 创建 2023-08；cli 0.4.37（2026-10-19） | Permit.io 教程称可结合 `interrupt()`（未核） | 面向自己写 agent 循环的场景；DreamCoder 的循环在 CLI 里，不能直接使用，可借「中断 id 对应恢复值」的建模 |
| [OpenAI Agents SDK（JS）](https://github.com/openai/openai-agents-js) 审批（[指南](https://github.com/openai/openai-agents-js/blob/be4f1f9aa4ad4f03cc5db5fdd57d0d0136923570/docs/src/content/docs/guides/human-in-the-loop.mdx)） | MIT | 工具设 `needsApproval`（布尔或异步函数），运行在该轮结束时暂停并在 `interruptions` 返回待批项；用 `state.approve()`、`state.reject()`（可带消息、可设「总是」）后用同一 `RunState` 恢复 | 审批面是整个运行范围的，包括交接后的 agent 与嵌套的 `agent.asTool()`，嵌套的批准会出现在外层运行上；`RunState` 可序列化后在别的进程恢复；指南明确要求服务端自持完整快照、只向审批人下发展示用信息与不透明 id、审批人身份必须来自服务端认证而非请求体、「检查归属并消费待处理请求」要原子完成以防重放（同页） | 创建 2025-05；agents-extensions 0.21.0（2026-10-20） | 使用方：未查到 | 这份指南对「多端先到先得」写得最具体（原子消费、重放防护、身份来自服务端），可直接当 DreamCoder 审批回复接口的检查清单 |
| [OpenAI Agents SDK（Python）](https://github.com/openai/openai-agents-python) | MIT | JS 版的 Python 对应实现 | 本次未读其 HITL 文档，是否与 JS 一致：未查到 | v0.24.0（2026-10-15） | 使用方：未查到 | 不适用于 Bun/TypeScript |
| [Vercel AI SDK](https://github.com/vercel/ai) 工具审批（[文档](https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling)） | LICENSE 文件为 Apache-2.0（GitHub 判定 NOASSERTION） | `generateText`、`streamText` 不暂停，而是返回带 `approvalId` 的 `tool-approval-request`；应用把带 `approved` 的 `tool-approval-response` 加进消息历史后再次调用 | 无状态：调用方要保存并重发消息历史（据文档流程的读法，页面未使用该词）；页面称旧的 `needsApproval` 选项已弃用，现用 `toolApproval: "user-approval"`；没有超时说明 | 创建 2023-05；最新包 `@ai-sdk/zai@3.0.39`（2026-10-22）（monorepo 以多包发版） | 使用方：未查到 | 与 Bun/TypeScript 同栈，但它管的是应用自己的工具，不是外部 CLI 的工具 |
| [Mastra](https://github.com/mastra-ai/mastra) suspend/resume 与 `requireApproval`（[agents HITL 文档](https://github.com/mastra-ai/mastra/blob/323c14179f5d7bcd3de346d4b135dc45a2147fcd/docs/src/content/en/docs/agents/human-in-the-loop.mdx)） | 混合：`ee/` 目录另有 `ee/LICENSE`，其余 Apache-2.0（根 LICENSE.md） | 工具设 `requireApproval: true`，或单次请求设 `requireToolApproval: true`，流里出现 `tool-call-approval`，用 `runId` 调用 `approveToolCall` 或 `declineToolCall`；工作流里 `suspend()` 暂停、`run.resume()` 带步骤 id 与数据恢复 | 需要配置存储提供者来保存恢复快照，否则报 snapshot not found；快照在运行结束后删除（同页）。超时：未查到 | 创建 2024-08；`@mastra/core@1.79.0`（2026-10-21） | 使用方：未查到 | 与 Bun/TypeScript 同栈，同样只管自家 agent 的工具 |
| [Inngest](https://github.com/inngest/inngest) `step.waitForEvent`（[文档](https://www.inngest.com/docs/reference/functions/step-wait-for-event)） | SSPL 1.0 加「Apache 2.0 未来许可」（LICENSE.md；GitHub 判定 NOASSERTION） | 函数里的一个步骤等待某个事件，返回事件负载，类型含 `null`（读法为超时返回 `null`）；`match`（按属性相等）与 `if`（CEL 表达式）二选一 | 示例都带 `timeout`，是否必填、最长多久：未查到；事件由外部发送，天然异步 | 创建 2021-06；v1.48.0（2026-10-22） | 使用方：未查到 | SSPL 对嵌入分发有限制，需法务确认；且需要运行 Inngest 服务 |
| [Temporal](https://github.com/temporalio/temporal) Signals 与 Updates（[文档](https://docs.temporal.io/encyclopedia/workflow-message-passing)） | 服务器 MIT；TypeScript SDK（[sdk-typescript](https://github.com/temporalio/sdk-typescript)）MIT，v1.24.0（2026-09-15） | Signal 是「发了不等结果」的异步写入；Update 是同步、可被校验、发送方可等待结果的写入；Query 只读 | 工作流等待信号的写法、超时、跨 worker 重启的持久性：本次抓取的页面未覆盖，未查到。需要运行 Temporal 服务（服务端 v1.32.1，2026-10-08） | 创建 2019-10 | 使用方：未查到 | 对桌面应用过重，需要自带服务进程 |

### 3.2 小结

- 这些原语的共同形状是「暂停并返回待批项，外部给出决定后恢复」，区别在状态放哪里：LangGraph 与 Mastra 放检查点或存储，OpenAI Agents SDK 放可序列化的 `RunState`，Vercel AI SDK 放调用方的消息历史，Inngest 与 Temporal 放事件与工作流历史。
- 它们都建立在「agent 循环在框架里」的前提上。DreamCoder 的循环在 CLI 进程里，对应的暂停点是 Claude Code 的 `canUseTool` 挂起或 `defer`，框架库本身不能直接接入。
- 嵌套 agent 的来源标识：只有 OpenAI Agents SDK 文档明确写到嵌套 `agent.asTool()` 的审批会回到外层运行并使用稳定的 agent 身份；其余未查到。
- 只有 OpenAI Agents SDK 的指南写到了多端并发答复的处理（原子消费）。

---

## 4. 策略引擎

### 4.1 总表

| 名称 | 许可证 | 一句话 | 平台与前提 | 成熟度 | 使用方 | 对 macOS + Windows 桌面应用的适配 |
| --- | --- | --- | --- | --- | --- | --- |
| [Open Policy Agent](https://github.com/open-policy-agent/opa)（Rego） | Apache-2.0 | 通用策略引擎；Rego 策略可编译为 Wasm 模块，在宿主里带输入与外部数据求值（[wasm 文档](https://github.com/open-policy-agent/opa/blob/main/docs/docs/wasm.md)） | 核心语言完整支持，部分内置函数（如 `http.send`）在 Wasm 里不支持，要由宿主实现（同页）。JS 运行 Wasm 的库是 [npm-opa-wasm](https://github.com/open-policy-agent/npm-opa-wasm)（`@open-policy-agent/opa-wasm` 1.10.0，Apache-2.0）。OPA 本体的 macOS 与 Windows 二进制：未查到 | OPA v1.21.3（2026-10-19）；npm-opa-wasm 最新 release 为 1.10.0（2024-11-08），仓库最近提交 2026-07-10 | 使用方：未查到 | 可在 Bun 里以 Wasm 嵌入，不依赖平台二进制；但 npm 包上次发版是 2024-11，要核实与当前 OPA 的兼容 |
| [Cedar](https://github.com/cedar-policy/cedar)（AWS） | Apache-2.0 | 授权策略语言与引擎（Rust）；有 Wasm 绑定包 `@cedar-policy/cedar-wasm`，提供 ES 模块、Node CommonJS（用 `fs` 同步加载）和 web 三种子包（[README](https://github.com/cedar-policy/cedar/blob/4fe34d23a161200ba989718b654f7555a60b9e41/cedar-wasm/README.md)） | 纯 Wasm，不依赖平台二进制；Bun 下的加载方式：未查到 | cedar v4.14.0（2026-10-17）；`@cedar-policy/cedar-wasm` 4.14.0（2026-10-19，npm） | 使用方：未查到 | 嵌入最直接，版本节奏与主线同步；Cedar 的决策是否只有允许与拒绝两值、能否表达「需要问人」：本次未核 |
| [Cedar for agents](https://github.com/cedar-policy/cedar-for-agents)（AWS 的 Cedar 与 agent 交叉项目） | Apache-2.0 | 从 MCP 服务器的工具描述自动生成 Cedar 模式（schema）与授权请求；含 Rust crate、JS/TS 的 Wasm 绑定、Python 绑定，以及把 Cedar 分析能力暴露给 agent 的 MCP 服务器（README） | 同上 | 创建 2025-10；cedar-policy-mcp-schema-generator v0.7.0（2026-10-22） | 使用方：未查到 | 针对「按工具描述写策略」的场景，与我们对 MCP 工具的权限控制相关；对内置工具（Bash、Edit）是否适用：未查到 |
| [Cerbos](https://github.com/cerbos/cerbos) | Apache-2.0 | 无状态的策略决策点（PDP），独立进程，提供 API；策略用 YAML 写；README 称可作为服务、sidecar、systemd 服务或 Lambda 部署，并列出 JavaScript 等多种语言 SDK | 要嵌进桌面应用必须随应用起一个进程；README 称「Embedded PDP」是 Cerbos Hub（托管控制面）的功能。macOS 与 Windows 二进制：未查到。JS 客户端 `@cerbos/core` 0.33.1（npm，Apache-2.0） | v0.56.0（2026-09-30）；创建 2021-03 | 使用方：未查到 | 进程外服务形态，对「本地优先、免安装」的桌面应用偏重 |
| [Oso](https://github.com/osohq/oso) | Apache-2.0（旧库） | 旧的开源授权库已归档、只读，不再发版；继任产品是托管的 Oso Cloud，同样使用 Polar 语言（README） | 旧库已归档（GitHub API `archived: true`）；Oso Cloud 为托管服务 | 旧库最后 release v0.27.1（2023-12-18） | 使用方：未查到 | 不再选用 |
| Claude Code 与 Codex 自带的规则语言 | 闭源 / Apache-2.0 | Claude Code 的 allow、ask、deny 规则语法（工具名加说明符，如 `Bash(npm test *)`、`Edit(//secrets/**)`）与 hook 的 `if` 过滤；Codex 的 execpolicy 规则与 `granular` 类别（文档） | 规则按会话或设置文件生效；按角色或成员分别设置：未查到 | 见 1 | 见 1 | 对内置工具已经够用，通用策略引擎只在需要「角色、资源、上下文」的跨工具规则时才有增量 |

### 4.2 小结

- 可在 Bun/TypeScript 里不依赖平台二进制嵌入的是 Wasm 路线：OPA（编译产物加 `opa-wasm`）与 Cedar（`@cedar-policy/cedar-wasm`）；Cerbos 是进程外服务；Oso 开源库已归档。
- 这些引擎回答的是「某主体对某资源能否做某动作」，没有一个自带审批流、超时或异步恢复；它们与第 1、2、3 节的关系是前置的规则层，不是审批层。
- 本次没有读到任何一个策略引擎的文档把「需要问人」作为一类决策；是否能在 OPA 的任意 JSON 输出或 Cedar 的注解里表达，未核。

---

## 5. 值得深拆的候选

下面只写意见，按推荐顺序，均按 [_template.md](_template.md) 的格式做完整拆解。

1. Claude Code 的三条审批通道（`canUseTool` 的 `control_request`、`PermissionRequest` hook、`PreToolUse` 的 `defer`），以 fork 实际版本为准。#164 的缺口最直接的补法就在这里，也是 `requestId` 加「返回 null」这类多端先到先得约定的来源。先要查明 fork（兼容 2.1.92）里这几项是否存在、`agent_id` 在 `PermissionRequest` 与 `canUseTool` 里对进程内队友的实际取值，以及 `defer` 对并行队友是否可用。
2. HumanLayer 的 Claude Code 审批路径。同为 Bun 与 Tauri 栈，Apache-2.0，且是找到的唯一已上线的「`PermissionRequest` hook 到多端审批」实现；可直接读它的请求字段、幂等的 `resolve`、关闭时批量拒绝、与 CLI 自带提示并发这几处。需要核实它在会话结束与客户端离线时的行为，以及哪些部分绑定了 Postgres 与云端。
3. OpenAI Agents SDK（JS）的审批与服务端自持状态指南。把「审批人身份来自服务端、原子消费待处理请求、重放防护、只下发展示信息」写成了清单，直接对应 #150 的先到先得回复；成本低，读文档与示例即可。
4. Codex 的 guardian 与按线程路由的审批。超时即不执行、失败即关闭、审查者带根会话授权，以及审批层标明来源并可跳转；可作为 DreamCoder 团队视图审批卡片与「模型审查」的设计参照。
5. Cedar（`@cedar-policy/cedar-wasm`，含 cedar-for-agents）。若要做按角色的跨工具规则，它是最容易嵌进 Bun 的一条：Wasm、Apache-2.0、版本与主线同步。先核实决策能否表达「需要问人」，以及相对 Claude Code 自带 allow/ask/deny 规则是否真有增量；若没有，不必引入。

没有列入的：MCP elicitation 与 authorization（解决的不是工具权限问题，只借三态答复与「必须标明请求方」）；Permit.io 与 Knock（依赖托管平台，且 Permit 的网关尚未发布）；LangGraph、Mastra、Vercel AI SDK（agent 循环不在我们手里）；Inngest 与 Temporal（服务进程过重，Inngest 还有 SSPL）；Cerbos（独立进程）；Oso（已归档）。

## 6. 空白

按我们的需求逐项列出，目前没有找到做得好的现成方案：

1. 请求里带成员身份：官方通道只给 `agentID`（`canUseTool`）或 `agent_id`、`agent_type`（hook 公共字段）；团队名、成员名与角色不在任何官方字段里，`PermissionRequest` hook 还没有 `tool_use_id`，只能靠我们的服务端自己维护映射。cc-haha 在服务端加了 `agent_id=name@team` 与 `display_name`，是目前唯一找到的做法。
2. 按角色的规则：Claude Code 队友继承 lead 且不能按队友设置；Codex 的角色文件不能放宽；Multica 与 Paperclip 把控制放在 agent 的 Access 与控制面，不在 CLI 里（见 [research/multica.md](../research/multica.md)、[research/paperclip.md](../research/paperclip.md)）。没有找到能对「同一进程内的不同队友」应用不同权限规则的现成实现；策略引擎能表达规则，但没有找到把它们接到队友权限请求上的例子。
3. 超时与默认动作：Claude Code 的提示不超时；HumanLayer 两代代码都没有读到超时；只有 Codex guardian（90 秒、不执行）与 cc-haha（没人可问就拒绝）有明确默认。没有找到可按角色或按风险配置超时与默认动作的实现。
4. 异步审批后恢复：`defer` 加 `--resume` 是官方机制，但限 `-p`、限单调用轮次、不恢复权限模式；在一个活着的团队里（队友在并行、lead 在等）审批人离线几小时再回来，没有找到现成做法，队友调用能否 defer 也未查到。
5. 多端先到先得：官方有 `requestId` 约定，OpenAI Agents SDK 指南有原子消费与重放防护的要求，HumanLayer 有幂等 `resolve` 加与本地提示并发；没有找到把这些合在一起、可直接复用的库。
6. 一个会话启动另一个会话时的同意（#162 中「每个请求说明是用户要求、agent 提议还是 agent 自主」）：只找到相邻的做法，Claude Code 的 `bypassPermissions` 下仍保留跨会话消息的安全措施，较新版本里来自其他会话的消息不能替用户批准权限；Codex 把 `create_thread`、`send_message_to_thread`、`fork_thread` 设为需要用户确认（见 [research/codex.md](../research/codex.md)）。没有找到带「请求来源类别」标注的同意请求。
7. 「需要问人」作为策略决策：本次读到的策略引擎文档都没有把它作为一类决策，是否可表达未核；若不可，需要自己在引擎外层加这一档。
8. Windows 行为：hook 命令在没有 Git Bash 时失败可能直接阻断调用（hooks 文档）；OPA、Cerbos 的 Windows 二进制未查到；HumanLayer 的 Windows 支持未查到。Wasm 路线（OPA、Cedar）不受平台二进制限制，其余需要实测。
9. fork 与上游的差距：本文引用的文档对应上游较新版本，fork 兼容 2.1.92，`PermissionRequest` hook、`defer`、`permissionPrompts`、`requestId` 的可用性均未核实。（2026-10-23 抽查 fork `@939d934`：`PermissionRequest` hook 存在，`src/types/hooks.ts:121`、`src/entrypoints/sdk/coreSchemas.ts:369`；`defer` 在 hook 类型与 SDK schema 中未查到，可能是 2.1.92 之后才加的。）
