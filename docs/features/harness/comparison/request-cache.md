# C 维度：请求形态、前缀稳定性、提示缓存、上下文增长与压缩

场景见 [README](../README.md#对比的场景)：第三方非原生模型，经 OpenAI 兼容端点。路径前缀：`codex:` 相对 `refs/coding-agents/codex/codex-rs`；`zcode:` 相对 `refs/coding-agents/zcode/apps/zcode-cli/packages`；DreamCoder 相对仓库根。ZCode 的模型规则文件和补丁不在 packages 下，写全路径 `refs/coding-agents/zcode/...`。

范围修正（A、D 维度也已记录）：Codex rust-v0.164.0 已删除 chat completions，`WireApi` 只剩 `Responses`，`wire_api = "chat"` 直接报错（`codex:model-provider-info/src/lib.rs:102,109-113`）。所以 Codex 在本场景只能对第三方端点发 `/v1/responses` 请求；下文 Codex 一列都按 Responses 格式写。

## 1. 结论

1. **DreamCoder 在本场景拿不到任何 provider 侧前缀缓存。** 代理给每个请求的 system 开头补一行计费头，其中 `cch=` 后 5 位是对整个请求体（含全部历史）的哈希，位于 system 消息第 79–83 个字符；每个请求都不同，其后的 system、工具定义、历史全部无法命中。`openai_chat` 和 `openai_responses` 两种上游格式都这样；只有 `anthropic` 格式的第三方端点不经代理、对非 Claude 模型名不加这行。另外两家第一字节起逐请求相同。
2. **除这一行外，DreamCoder 的前缀本身相当稳定**：system 各段会话内缓存、日期和 git 状态会话内只算一次、工具按名字排序且 schema 按会话缓存、提醒类内容作为新消息追加。这些继承自 Claude Code 的稳定性设计被计费头一行全部抵消。
3. **缓存控制字段**：Codex 发 `prompt_cache_key`（线程 id）、`session-id` 等头，并有测试断言第 N 次请求是第 N+1 次的严格前缀；ZCode 在消息上标 Anthropic 式 ephemeral 断点并发 `x-session-id`，但 chat-completions 路径上这些断点按 SDK 行为不会进入请求体（推断）；DreamCoder 的 CLI 发 `cache_control` 和 `prompt-caching-scope`，代理全部丢弃，上游请求只有 `Content-Type` 和 `Authorization` 两个头。
4. **每请求固定开销**（system + 工具定义 + 固定上下文）：DreamCoder 约 12 万字符，Codex 约 4.6 万，ZCode 约 2.7 万（ZCode 工具部分为推断）。DreamCoder 的大头是工具描述（约 9–10 万字符，推断）和 memory 段（约 1.25 万）。没有缓存时这部分每个请求按全价计费。
5. **上下文窗口**：DreamCoder 对内置表以外的模型（GLM-5.3、Kimi-K3、DeepSeek-V4.1 都不在表里）回落到 200,000，除非服务端从 `/v1/models` 回填到环境变量；ZCode 内置规则对任何模型默认 1,000,000，并对 glm-5.3、kimi-k3 有专门条目；Codex 回退元数据 272,000。
6. **旧工具结果的清理**：三家在本场景下都没有生效的「清除旧工具结果」机制（DreamCoder 各 microcompact 变体都被 GrowthBook 默认值或 `feature()` 关掉；ZCode 的 microcompact 默认 `enabled` 不为 true；Codex 未找到）。差别在单条结果的上限：Codex 写入历史时统一中间截断到约 12,000 字节；ZCode 默认 100KB、Bash 30KB 并落盘；DreamCoder 默认 50,000 字符、Bash 30,000、Read 25,000 token，超限落盘只留 2KB 预览。
7. **压缩请求本身的代价**：DreamCoder 用 fork 把主循环的 system、全部工具和完整历史原样重发再加一条压缩提示，本意是复用缓存，但在本场景因计费头无法命中，整份按全价；ZCode 同样带主循环工具（为了命中缓存），但只发需要摘要的部分，最近一轮保留不发，输出上限 20K；Codex 不带工具，只发历史和 426 字符的压缩提示。
8. **主循环以外的模型请求**：DreamCoder 有服务端标题生成（第 1、3 条用户消息各一次）、WebFetch 每次一次二次处理请求、子代理；ZCode 无头模式下没有标题生成，WebFetch 二次处理和子代理与 DreamCoder 同类；Codex 默认没有这类请求。

## 2. 逐项对比

### Q1 第 N 轮的请求布局

| | Codex | ZCode | DreamCoder（CLI → 代理 → 上游） |
|---|---|---|---|
| 接口 | `/v1/responses` | `/chat/completions`（`@ai-sdk/openai-compatible`） | CLI 发 `/v1/messages` 到本地代理；代理发 `/v1/chat/completions` |
| 系统提示位置 | `input[0]`，developer 角色；无 `instructions` 字段 | 开头 1 条 system（3 段合并） | 1 条 system（所有块用 `\n` 拼接） |
| system 首行 | `prompt.md` 正文 | `You are ZCode, an interactive agent` | 计费头 `x-anthropic-billing-header: …cch=xxxxx;` |
| 固定上下文 | developer 消息（权限等）+ user 消息（环境、AGENTS.md） | meta user 消息：skills 列表、指令文件、环境、模型、日期、git | 第一条 user 消息 `<system-reminder>`：CLAUDE.md、MEMORY.md、日期；git 状态在 system 末尾 |
| 工具 | 请求体 `tools` 字段，在 `input` 之后 | `tools` 字段 | `tools` 字段，在 `messages` 之后 |
| 历史之后 | 世界状态变化项追加在末尾 | 公告与提醒追加在末尾 | 附件（提醒、skill_listing 等）作为 user 消息追加 |

**DreamCoder CLI 侧**（`/v1/messages` 请求体）：
- system 数组顺序：[计费头（环境变量允许时）][身份前缀句][`getSystemPrompt()` 各段][git 状态]，`src/services/api/claude.ts:1394-1404`，git 状态由 `appendSystemContext` 追加（`src/utils/api.ts:437-447`，`src/query.ts:451`）。`--print` 下前缀句为 `You are a Claude agent, built on Anthropic's Claude Agent SDK.`（`src/constants/system.ts:30-46`）。
- 本场景模型名不以 `claude` 开头，服务端给 CLI 设 `CLAUDE_CODE_ATTRIBUTION_HEADER=0`（`src/server/services/attributionHeaderPolicy.ts:3-15`，注入 `src/server/services/providerRuntimeEnv.ts:251`），CLI 不加计费头（`src/constants/system.ts:52-57`）。
- 自定义 `ANTHROPIC_BASE_URL` 仍被判为 `firstParty`（`src/utils/model/providers.ts:12-23`），所以 `shouldUseGlobalCacheScope()` 为真（`src/utils/betas.ts:228-233`）：静态段标 `cache_control: {type:'ephemeral', scope:'global'}`，请求带 `prompt-caching-scope` beta（`src/services/api/claude.ts:1264-1268`，分块 `src/utils/api.ts:331-376`）。
- 静态段：intro、System、Doing tasks、Actions、Using your tools、Tone、Output efficiency（`src/constants/prompts.ts:560-572`）。动态段：session_guidance、memory、env_info_simple、language、output_style、mcp_instructions、scratchpad、frc、summarize_tool_results（`src/constants/prompts.ts:491-558`）。
- 第一条 user 消息是 `prependUserContext` 插入的 `<system-reminder>`，内容为 claudeMd（含 MEMORY.md）和 `Today's date is …`（`src/utils/api.ts:449-472`，`src/query.ts:661`）。

**代理改写后（openai_chat）**：
- 代理先 `ensureClaudeCodeAttribution`：system 里没有计费头就在最前插入一块（`src/server/proxy/handler.ts:64`，`src/server/proxy/claudeCodeAttribution.ts:29-47`）。
- 转换：system 块 `map(b => b.text).join('\n')` 成一条 system 消息，`cache_control` 丢弃（`src/server/proxy/transform/anthropicToOpenaiChat.ts:19-26`）；工具转 `{type:'function', function:{name, description, parameters}}`，过滤 `BatchTool`（`:47-58`）；顶层只拷 `model, messages, stream, stream_options, temperature, top_p, stop, tools, tool_choice, reasoning_effort`（DeepSeek 兼容时加 `thinking`）（`:32-76`）。
- `JSON.stringify` 后对 system 消息签 `cch`（`src/server/upstream/client.ts:205-216`）。请求头只有 `Content-Type`、`Authorization`（`:213`）。
- 工具结果：`tool_result` 转 `role:'tool'` 消息（`anthropicToOpenaiChat.ts:114-120`）；工具结果里的图片被替换成文字 `[image omitted: <mime>]`（`src/server/proxy/transform/toolArguments.ts:40-42`）。

**Codex**：
- 请求体字段顺序 `model, stream, service_tier, input, tools, tool_choice, parallel_tool_calls, reasoning, store, stream_options, include, prompt_cache_key, text, client_metadata`（`codex:codex-api/src/common.rs:279-304`）。
- `base_instructions` 作为 developer 角色消息插在 `input` 最前，消息 id 由线程 id 与文本做 UUIDv5（`codex:core/src/client.rs:1031-1041`，`codex:core/src/context/base_instructions.rs:31`）。非 OpenAI provider 清掉 `encrypted_content` 与元数据，`store:false`（`codex:core/src/client.rs:1048-1075`）。
- 之后是初始上下文（`codex:core/src/session/mod.rs:4552-4780`）：developer 消息（权限、沙箱、审批说明等），user 消息（`<environment_context>`：cwd、shell、`current_date`、`timezone`；AGENTS.md，总量上限 32 KiB，`codex:config/src/config_toml.rs:75`），然后是历史。

**ZCode**：
- `ContextBuilder` 产出三条 system：CLI 前缀；稳定段（Agent Identity，带 ephemeral 标记）；动态段（Dynamic Behavior、session guidance、Memory、Context management、`<total_tokens>` 固定行，带 ephemeral 标记）（`zcode:core/src/context/builder.ts:103-176,238-285`）。
- chat-completions 适配层把开头连续的 system 合并为一条（`zcode:adapters/src/model/system-message-compat.ts:6-36`，调用 `zcode:adapters/src/model/transform.ts:54`）。
- 环境、模型、日期、git、skills 列表、指令文件（AGENTS.md 等与 MEMORY.md 索引）作为 meta user 附件或「请求前公告」写入历史（`zcode:core/src/context/builder.ts:288-321`，`zcode:core/src/runtime/methods/context-refresh.ts:348-410`）。
- 本场景 `midConversationSystem` 为假，提醒都作为 user 消息里的 `<system-reminder>` 发送（`zcode:core/src/runtime/helpers/runtime-provider-request-messages.ts:13-20`；默认规则 `supportsMidConversationSystem:false`，`refs/coding-agents/zcode/config/provider/zcode-builtin.json` 的 `modelRules[0]`）。
- 请求头加 `x-request-id`、`x-session-id`、`x-zcode-trace-id`、`x-query-id`、`x-zcode-session-type` 等（`zcode:adapters/src/model/runner-attribution.ts:20-66`，用于所有 provider：`zcode:adapters/src/model/runner-options.ts:150-154`）。

### Q2 第 N 轮与第 N+1 轮开头可能不同的地方

| 项 | Codex | ZCode | DreamCoder |
|---|---|---|---|
| system 第一行 | 不变 | 不变 | **每请求变**（`cch`） |
| system 正文 | 不变（UUIDv5 id 固定） | 会话内快照，不变 | 不变（段缓存），MCP 说明段每轮重算 |
| 日期 | 变化时末尾追加 | 变化时末尾追加 | 会话内 memoize；跨天追加 `date_change` 附件 |
| git 状态 | 未找到注入（未核实） | 公告，按来源去重追加 | 会话开始快照，不变 |
| 指令文件 / 记忆 | 初始上下文固定 | 发出后不改写，变化追加增量 | memory 段会话内缓存；CLAUDE.md 在首条 user 消息，memoize |
| skills 列表 | developer 片段 | 写一次；冷恢复时原位改写一次 | 附件，写一次，新增按增量追加 |
| 工具顺序 | 固定（有测试） | 名单内按名字排序（固定 en-US），MCP 排最后 | 内置按名字排序，MCP 排最后 |
| 中途出现的工具 | 未核实 | MCP 工具按当前注册表发送，会变 | MCP 工具连上后追加在工具列表末尾 |

**DreamCoder 的 `cch` 行**。依据下面四个文件（两次独立阅读，结论一致）：
- 代理补头不看模型名也不看环境变量，只检查 system 里是否已有以 `x-anthropic-billing-header:` 开头的块（`src/server/proxy/claudeCodeAttribution.ts:29-30,49-57`）；入口取代理进程的 `CLAUDE_CODE_ENTRYPOINT`，未设时为 `unknown`（`:37`）。B 维度记录的 `sdk-cli` 是 CLI 进程里的值（`src/main.tsx:532`），代理在服务端进程里读，取不到（推断：服务端进程未设该变量）。
- 指纹 = `SHA-256(盐 + 首条 user 文本的第 4、7、20 个字符 + 版本)` 前 3 位（`src/utils/fingerprint.ts:56-69`）。首条 user 消息总是 `<system-reminder>\nAs you answer…`，这三个字符固定为 `t`、`-`、空格，所以指纹会话内不变（按此算出 `d27`，推断）。
- `cch` = 对**整个请求体字符串**做带种子的 xxHash64，取低 20 位，5 位十六进制（`src/utils/claudeCodeCch.ts:135-139`）；签名前要求请求体中 `cch=00000;` 恰好出现一次、该字段 JSON 字面量恰好出现一次（`:35,44,48,54`）。
- 三种上游格式：
  - `openai_chat`：签 `messages` 里 role=system 的内容（`src/server/upstream/client.ts:205-216`，选择器 `src/utils/claudeCodeCch.ts:89-107`）。
  - `openai_responses`：签 `instructions`（`src/server/upstream/client.ts:218-224`）。
  - `anthropic`：代理直接返回 400「proxy not needed」（`src/server/proxy/handler.ts:39-52`），CLI 直连上游（`src/server/services/providerRuntimeEnv.ts:211-214`）。非 Claude 模型名时 CLI 不加头，请求体里没有这行；Claude 模型名时 CLI 加头并在 `src/services/api/client.ts:461` 的 fetch 包装里签，仍每请求变。
- 两个连续请求的 system 开头：
  - 第 N 轮：`x-anthropic-billing-header: cc_version=2.1.92.d27; cc_entrypoint=unknown; cch=3fa1c;` + `\n` + `You are a Claude agent, …`
  - 第 N+1 轮：同上，只有 `cch=a07e2;` 不同（两个值仅示意）。
  - 前 78 个字符相同，第 79–83 个字符不同，整行 84 个字符。
- 偶发不签（头部保持 `cch=00000;`，反而稳定）：对话中别处也出现 `cch=00000;` 字面量（例如工具读到含该串的文件）。不是可依赖的行为。
- 波及范围：所有经代理的请求都带这一行，包括 WebFetch 的二次处理请求、子代理请求、压缩请求；服务端标题请求直接调 `sendToUpstream`，不经 `ensureClaudeCodeAttribution`，没有这行。

**DreamCoder 其余项**：
- 日期与 git：`getSystemContext`、`getUserContext` 都 `memoize`（`src/context.ts:116,155`）；跨午夜由 `date_change` 附件追加（`src/utils/attachments.ts:827-829`）。
- MCP 说明：`isMcpInstructionsDeltaEnabled` 非 ant 默认 false（`src/utils/mcpInstructionsDelta.ts:26-33`），说明段用 `DANGEROUS_uncachedSystemPromptSection` 每轮重算（`src/constants/prompts.ts:513-518`）；MCP 服务器中途连上或断开时 system 中部会变。
- memory 段：`systemPromptSection('memory', …)` 会话内缓存，`/clear`、`/compact` 清除（`src/constants/prompts.ts:495`，`src/constants/systemPromptSections.ts:20-62`）。
- skills 列表：`skill_listing` 附件（`src/utils/attachments.ts:866`）。
- 工具：`assembleToolPool` 内置与 MCP 分别按 `localeCompare` 排序（未指定 locale）（`src/tools.ts:366-388`）；schema 会话内按名字缓存（`src/utils/api.ts:119-175`）；ToolSearch 在非 Anthropic base URL 下关闭，全部工具每次全量发送（`src/utils/toolSearch.ts:270-312`，A 维度已核）。
- ZCode 专门修过不带 locale 的 `localeCompare` 会随进程语言改变顺序的问题（`zcode:core/src/tool/provider-visible-order.ts:60-66`）。DreamCoder 同样写法，换 locale 恢复会话时工具顺序可能变（推断）。
- 中途新增的 MCP 工具在请求体 `tools` 末尾，但很多 chat 模板把工具渲染进 system 区，此时会改变前缀中部（推断，依 provider 模板）。

**Codex**：
- 世界状态按段快照，每轮与上次比较，只在变化时追加更新项，不改写前缀（`codex:core/src/context/world_state/mod.rs`，日期和 shell 见 `codex:core/src/context/world_state/environment.rs:148-151`）。
- 测试断言第一次请求的整个 input 是第二次请求的前缀、`prompt_cache_key` 不变、工具一致（`codex:core/tests/suite/prompt_caching.rs:133,473,550-557,746,820-827`）。

**ZCode**：
- 主会话 system 第一次请求时写快照，之后按快照发送，冷恢复和升级后字节不变；压缩时清除快照（`zcode:core/src/runtime/helpers/prompt-snapshot.ts:1-8,70`，`zcode:core/src/runtime/methods/compact-active.ts:764-766`）。
- 请求前公告（指令文件、git 会话上下文、日期）发出后不改写，变化追加增量（`zcode:core/src/runtime/methods/context-refresh.ts:348-410,454`），注释写明原地改写曾导致缓存失效。
- skills 列表冷恢复或 rewind 时原位更新，会让缓存失效一次（`zcode:core/src/runtime/methods/context-refresh.ts:307-328`）。
- 工具不进快照，MCP 工具中途变化时按当前注册表发送（`zcode:core/src/runtime/helpers/prompt-snapshot.ts:5`）。

### Q3 缓存控制

| | Codex | ZCode | DreamCoder |
|---|---|---|---|
| 请求体缓存键 | `prompt_cache_key` = 线程 id；子代理 `<source>:<父线程 id>` | 无 | 无（CLI 的 `metadata.user_id` 不转发） |
| 断点标记 | 无（Responses 无此概念） | 2 个 system 段 + 最新非 system 消息，ephemeral | CLI 有，代理丢弃 |
| 断点能否到达上游 | 不适用 | chat 路径：否（推断） | 否 |
| 会话亲和头 | `session-id`、`x-client-request-id`、`x-codex-turn-state`、`x-codex-window-id` | `x-session-id`、`x-request-id`、`x-zcode-trace-id` 等 | 无 |
| 缓存命中数回到客户端 | 是：`cached_input_tokens` | 是（用于压缩判断） | 代理映射到 `cache_read_input_tokens`；回合结束消息不带，会话检查面板可见 |

- Codex：`codex:core/src/client.rs:658-677`（缓存键），`codex:core/src/thread_manager.rs:273-281`（策略），`codex:codex-api/src/requests/headers.rs:8`，`codex:core/src/client.rs:1430,2509`；用量 `codex:codex-api/src/sse/responses.rs:134`，`codex exec` 汇总时扣除缓存部分 `codex:exec/src/event_processor_with_human_output.rs:519-521`。
- ZCode 断点：
  - 两个 system 段带 `EPHEMERAL_CACHE_CONTROL`（`zcode:core/src/context/builder.ts:36,265,279`）。
  - 每次请求把最新非 system 消息设为断点；压缩请求前移一条（`zcode:core/src/runtime/helpers/provider-request-messages.ts:139-143,551-571`）。
  - 适配层只把它转成 `providerOptions.anthropic.cacheControl`（`zcode:adapters/src/model/transform.ts:575-589`），chat 路径由 `createOpenAICompatible` 发送（`zcode:adapters/src/model/model-execution.ts:353-366`）。
  - 推断：该 SDK 不读 `anthropic` 键，断点不进请求体。SDK 源码不在本地，未核实；ZCode 对该 SDK 的补丁只有 44 行，未涉及缓存（`refs/coding-agents/zcode/patches/@ai-sdk__openai-compatible@2.0.60.patch`）。
  - 所以 ZCode 在 chat 路径上依赖 provider 的自动前缀缓存，和 Codex 一样；它的前缀逐请求不变（Q2）。
- DreamCoder：
  - `cache_control`、`anthropic-beta: prompt-caching-scope`、`metadata`、`context_management`、`output_config`、`max_tokens` 都不转发（`src/server/proxy/transform/anthropicToOpenaiChat.ts:32-76`，请求头 `src/server/upstream/client.ts:213`）。
  - 用量：`cache_read_input_tokens = prompt_tokens_details.cached_tokens`，`input_tokens = prompt_tokens − cached`（`src/server/proxy/transform/openaiChatToAnthropic.ts:81-91`）；流式在 `message_delta` 里带，`message_start` 为 0（`src/server/proxy/transform/openaiChatStreamToAnthropic.ts:178,446-475`）；responses 路径同（`src/server/proxy/transform/openaiResponsesToAnthropic.ts:36-45`）。
  - 到达 CLI：是，写入 transcript。到达 UI：回合结束的 `message_complete` 只带 input/output（`src/server/session/translate.ts:427-431`）；会话检查接口从 transcript 读缓存读写数（`src/server/services/sessionService.ts:870-905`，`src/server/api/sessions.ts:513-517`），桌面端「缓存读 / 写」卡片显示它（`desktop/src/components/chat/LocalSlashCommandPanel.tsx:295`）。
  - DeepSeek 官方的 `prompt_cache_hit_tokens` 字段，仓库内 grep 无匹配，未处理。在本场景这个数应当一直接近 0（推断，因 Q2）。

### Q4 对话增长

| | Codex | ZCode | DreamCoder |
|---|---|---|---|
| 通用上限 | 写入历史时每个函数输出中间截断，约 12,000 字节 | 默认 100KB，从头保留 | 默认 50,000 字符，超限落盘 |
| Shell | `exec_command` `max_output_tokens` 默认 10,000 token，再按上一行截断 | Bash 30KB，落盘，保留尾部 | Bash 30,000 字符，保留头部，落盘 |
| Read | 无 Read 工具 | 25,000 token / 256KB；同文件同范围未改动时返回短提示 | 同左（25,000 token / 256KB；未改动去重默认开） |
| Grep / Glob | — | 20KB / 100 条、100KB | 20,000 / 100,000 字符 |
| 旧结果清理（压缩之外） | 未找到 | microcompact 存在，默认不启用 | 各变体全部不生效 |
| 工具结果图片 | 按模型输入模态保留或剥离 | 移到后续 user 消息；默认规则不支持图片则换成文字 | 代理替换成 `[image omitted]` |

- Codex：截断预算 `truncation_policy × 1.2`（回退 10,000 字节 → 12,000），中间截断，只截内存中的历史、rollout 保留完整（`codex:utils/output-truncation/src/lib.rs:19-37`，`codex:core/src/context_manager/history.rs:518,565-577`）；`max_output_tokens` 参数 `codex:core/src/tools/handlers/shell_spec.rs:56-60`；图片单边 2048 像素（`codex:utils/image/src/lib.rs:26,163`），不支持图片模态时在 `for_prompt` 剥离（`codex:core/src/context_manager/history.rs:603-617`）。
- ZCode：
  - 默认预算 `zcode:core/src/tool/executor/result-serialization.ts:25-31`；Bash `zcode:core/src/tool/handlers/bash.ts:600-612`；Grep `zcode:core/src/tool/handlers/grep.ts:23`；Glob `zcode:core/src/tool/handlers/glob.ts:20-21`；WebFetch 100KB `zcode:core/src/tool/handlers/webfetch-constants.ts:6`；Read `zcode:contracts/src/tools/read.ts:15-17`。
  - Read 去重：同一路径、同范围、文件未变时返回「Wasted call — file unchanged…」（`zcode:core/src/tool/handlers/read.ts:204-210`，`zcode:core/src/tool/handlers/read-text.ts:17-18`）。
  - microcompact：保留最近 5 个可清理结果，其余替换为 `[Old tool result content cleared]`，触发条件为空闲 60 分钟或接近压缩阈值（`zcode:core/src/compact/microcompact.ts:12-29`）。但运行时只在 `config.compact.microcompact.enabled === true` 时启用（`zcode:core/src/runtime/methods/microcompact.ts:104-115`），cli 与 bootstrap 里未找到设置 `compact` 的代码，所以默认不启用（推断，依据 grep 无结果）。
  - 图片：chat 路径把工具结果图片文字化，图片移到后续 user 消息（`zcode:adapters/src/model/tool-result-media-projection.ts:23-39`）；每请求媒体预算 40MB（`zcode:core/src/runtime/helpers/media-budget.ts:28`）；`.*` 默认规则 `supportsImage:false`。
- DreamCoder：
  - 上限 `src/constants/toolLimits.ts:13`；Bash `src/tools/BashTool/BashTool.tsx:424`；Grep `src/tools/GrepTool/GrepTool.ts:164`；Glob `src/tools/GlobTool/GlobTool.ts:60`；WebFetch `src/tools/WebFetchTool/WebFetchTool.ts:70`；Read `Infinity` 但自限（`src/tools/FileReadTool/FileReadTool.ts:340`，`src/tools/FileReadTool/limits.ts:1-18`）。
  - 超限时整段写入会话目录，对话里留提示和前 2000 字节预览（`src/utils/toolResultStorage.ts:109,137-197,272-330`）。Bash 另有头部保留截断（`src/tools/BashTool/utils.ts:133-165`）。
  - Read 去重：GrowthBook `tengu_read_dedup_killswitch` 默认 false，即去重开启（`src/tools/FileReadTool/FileReadTool.ts:534-565`）。
  - 单条消息 200,000 字符聚合预算由 `tengu_hawthorn_steeple` 控制，默认关（`src/utils/toolResultStorage.ts:451-455`）。
  - microcompact 各变体：时间触发版 `tengu_slate_heron` 默认关（`src/services/compact/timeBasedMCConfig.ts:30-36`）；cached 版需 `feature('CACHED_MICROCOMPACT')` 且模块是空桩（`src/services/compact/microCompact.ts:276`）；API 侧 `clear_tool_uses` 仅 ant（`src/services/compact/apiMicrocompact.ts:84-87`），且 `context_management` 不被代理转发。
  - 图片：用户图片转 `data:` URL（`src/server/proxy/transform/anthropicToOpenaiChat.ts:111-113`），工具结果里的图片被代理替换成文字（`src/server/proxy/transform/toolArguments.ts:40-42`），模型看不到 Read 读到的图片，但 CLI 侧仍按图片计入上下文估算（推断）。

### Q5 压缩

| | Codex | ZCode | DreamCoder |
|---|---|---|---|
| 触发 | 窗口 × 90% | 窗口 − min(最大输出, 21K) − 13K | (窗口 − min(最大输出, 20K)) × 90% |
| 第三方模型窗口 | 回退 272,000；可配 `model_context_window` | 规则表 `.*` 默认 1,000,000；glm-5.3 1M、kimi-k3 1,048,576 | 内置表 → 服务端回填的环境变量 → 200,000 |
| 计数来源 | provider 用量 | provider 用量，没有时估算 | provider 用量 + 估算 |
| 方法 | 本地摘要（远程压缩只给 OpenAI） | 摘要，保留最近一轮不进摘要 | fork 摘要整段历史 |
| 摘要请求带工具 | 否 | 是，与主循环同一份 | 是，与主循环同一份 |
| 摘要请求能否命中缓存 | 部分（工具段不同，推断） | 能，前缀相同（推断） | 否（计费头） |
| 摘要输出上限 | 未设置（未核实） | min(模型上限, 20K) | 不设；代理也不转发 `max_tokens` |
| 恢复内容 | 最近用户消息 ≤20,000 token + 摘要 + 重建初始上下文 | 最近一轮原样 + 摘要 + 最多 5 个文件（≤5K/个，≤50K 合计）+ 指令、skills、计划模式 | 最多 5 个文件（≤5K/个，≤50K）+ 用过的 skill + 计划、agent 状态、MCP 说明 |
| 失败处理 | 超窗口删最旧项重试；其他错误按流重试 | 自动压缩最多 3 次；超长时多保留几轮再试 | 超长按轮次删头重试 ≤3 次；fork 失败退回流式；连续失败 3 次停用 |

- Codex：阈值 `codex:protocol/src/openai_models.rs:529-541`；窗口 `codex:models-manager/src/model_info.rs:19-29,98-156`；远程压缩条件 `codex:model-provider/src/capabilities.rs:33`；本地压缩不带工具 `codex:core/src/compact.rs:318-326`；重试 `:345-360`；保留 `:63,83-111,697-710`；提示 426 字符 `codex:prompts/templates/compact/prompt.md`。
- ZCode：
  - 阈值 `zcode:core/src/compact/policy.ts:6-14,67-88`；provider 用量覆盖估算 `:30-39,104-106`。
  - 窗口来自模型规则，按顺序叠加（`refs/coding-agents/zcode/config/provider/zcode-builtin.json` 的 `modelConfigRules.modelRules[0]`、`[4]`、`[39]`；叠加规则见 `refs/coding-agents/zcode/docs/builtin-provider-maintenance/configuration.md:14`）。deepseek-v4 系条目未设窗口，继承 1M。未配置窗口的模型若实际窗口更小，自动压缩不会在超窗口前触发，只能靠超窗口错误后的被动压缩（D 维度：`zcode:adapters/src/model/failure-inspection.ts:185-243`）。
  - 摘要请求与主循环同一份工具，注释写明原因是命中主循环前缀缓存（`zcode:core/src/runtime/methods/compact-active.ts:282-286,335-347`）。
  - 保留最近一组（`zcode:core/src/runtime/helpers/compact-selection.ts:31-57`）；输出上限 `zcode:core/src/runtime/methods/compact-active.ts:864-873`；最多 3 次 `:101,783-813`；恢复文件 `zcode:core/src/runtime/helpers/compact-post-reminders.ts:27-30`。
- DreamCoder：
  - 阈值 `src/services/compact/autoCompact.ts:32-90`；窗口 `src/utils/context.ts:53-116`；内置表 `src/utils/model/modelContextWindows.ts:5-47`（有 glm-5.1、kimi-k2.6、deepseek-v4-*，没有 GLM-5.3、Kimi-K3、DeepSeek-V4.1）；服务端回填 `src/server/upstream/contextWindows/`，写入 `src/server/services/providerRuntimeEnv.ts:238-243`。
  - **fork 重发前缀：确认。** `tengu_compact_cache_prefix` 默认 true（`src/services/compact/compact.ts:1150-1153`），`runForkedAgent` 带主循环的 `cacheSafeParams`（system、工具、历史），加一条压缩提示，`maxTurns:1`、`skipCacheWrite:true`，有意不设 `maxOutputTokens`（`:1177-1191`）。这个请求同样经代理、带新的 `cch`，所以「复用缓存」在本场景不成立，整份历史 + 约 12 万字符的固定部分按全价计一次。
  - 失败回退到流式摘要（`src/services/compact/compact.ts:1246-1291`）；超长重试（`:227,440-489`）；连续失败停用（`src/services/compact/autoCompact.ts:60-65,215-224`）；恢复（`src/services/compact/compact.ts:122-131,520-600,1437-1515`）。session memory 压缩需两个 GrowthBook 开关，默认关（`src/services/compact/sessionMemoryCompact.ts:403-432`）。

### Q6 主循环以外的模型请求

| 请求 | Codex | ZCode | DreamCoder |
|---|---|---|---|
| 标题 | 无 | 无头模式无 | 服务端，第 1、3 条用户消息各一次，`fastModel` 或主模型 |
| WebFetch 二次处理 | 无 WebFetch | 每次一次，会话模型 | 每次一次，`ANTHROPIC_SMALL_FAST_MODEL`（未配则主模型） |
| WebSearch | 托管搜索（不是额外请求） | 一次模型请求（需模型支持原生搜索） | 默认不启用 |
| 压缩 | 当前模型 | 当前模型 | 当前模型 |
| 子代理 | 独立线程，`prompt_cache_key` 关联父线程 | 独立会话，会话模型 | 独立会话，各自 system，每轮一次 |
| 记忆提取 / 召回 | 默认关 | 召回关，整理未接线 | 默认关 |
| 预热 | 自定义 provider 不发 | 无 | 无 |

- Codex：`supports_websockets` 默认 false（`codex:model-provider-info/src/lib.rs:199-201`），没有 websocket 时预热只做鉴权、不发模型请求（`codex:core/src/session/startup_prewarm.rs:244-253`，`codex:core/src/client.rs:1146-1151`）；记忆默认关（`codex:features/src/lib.rs:1319-1321`）；自动审批子代理默认 `User`（`codex:protocol/src/config_types.rs:183-186`）；`current_time_reminder`、`token_budget` 默认关（`codex:features/src/lib.rs:1964-1991`）。
- ZCode：
  - 标题需 `config.titleGeneration` 存在且 taskType 为 interactive（`zcode:core/src/runtime/methods/session-title.ts:148-170`）；`titleGeneration` 只在调用方传入时设置（`zcode:bootstrap/src/app/runtime-config.ts:72-90`），`cli/src` 里没有传入（grep 无结果，推断无头模式不生成标题）。
  - 语义记忆召回常量关（`zcode:core/src/memory/project-memory-retrieval-branch.ts:4`）；`runProjectMemoryDream` 定义了但未找到调用方（`zcode:core/src/runtime/helpers/project-memory-dream.ts:56`）。
  - WebSearch 请求 `zcode:core/src/tool/handlers/websearch.ts:105-118`；WebFetch 处理 `zcode:core/src/tool/handlers/webfetch-processing.ts`。模型选择见 D 维度（都用会话模型）。
- DreamCoder：
  - 标题：`src/server/ws/handler.ts:897-939`（只在第 1、3 条用户消息触发），`src/server/services/titleService.ts:79,87`（模型 `provider.fastModel || selectedModel || models[0]`，system 约 800 字符 + 用户文本前 2000 字符）。直接调 `sendToUpstream`，没有计费头；`max_tokens:100` 被 chat 转换丢弃。
  - WebFetch：内容上限 100,000 字符，再发一次 `queryHaiku`（`src/tools/WebFetchTool/utils.ts:141,505-516`），模型 `ANTHROPIC_SMALL_FAST_MODEL`，服务端设为 `fastModel`，回退 `selectedModel`（`src/server/services/providerRuntimeEnv.ts:207-209,247-249`）。这个请求经代理，带计费头。
  - 默认不发的请求：记忆提取 `feature('EXTRACT_MEMORIES')`（`src/query/stopHooks.ts:158`）；相关记忆预取 `tengu_moth_copse`（`src/utils/attachments.ts:2349-2354`）；autoDream（`src/services/autoDream/config.ts:13-20`）；工具摘要需 `CLAUDE_CODE_EMIT_TOOL_USE_SUMMARIES`（`src/query/config.ts:36`）；Bash 前缀检测在生产路径跳过（`src/tools/BashTool/bashPermissions.ts:1937-1940`）。

### Q7 每请求固定开销（字符）

| | Codex | ZCode | DreamCoder |
|---|---|---|---|
| system | 16,979（剔除 Planning 后的 `prompt.md`） | 约 5,000 | 约 26,500（含 memory 约 12,550） |
| 其他固定上下文 | 权限约 400 + 环境约 300 | meta 约 1,500 | 计费头 84 + git 状态至多约 3,000 |
| 工具定义 | 约 28,000（12 个） | 约 20,000（推断） | 约 90,000–100,000（34 个，推断） |
| 合计 | **约 46,000** | **约 27,000** | **约 120,000** |
| 折合 token（按 4 字符/token） | 约 1.15 万 | 约 0.7 万 | 约 3 万 |

均不含 AGENTS.md / CLAUDE.md、skills 列表、MEMORY.md 正文（三家都视项目而定）。

- system：采用 B 维度按本场景分支求值的结果（Codex 16,979 + 片段，ZCode 约 5.0K + meta 约 1.5K，DreamCoder 约 26,450），我未重算。
- DreamCoder 工具：
  - 测量方法：对 34 个工具目录的 `prompt*.ts` 提取 ≥20 字符的字符串字面量，得 80,102 字符。这是上限估计；按本场景分支实际拼出的描述是 63,692 字符，见 [tools.md](tools.md)。
  - 这个数把条件分支两侧都算进去了。Bash 和 Agent 按 A 维度的精确值（10,003、6,992）替换后约 73,100。
  - 加上参数 `.describe()` 文本 14,083，再加 JSON schema 结构（估 8–12K），约 9–10 万字符（推断）。
- ZCode 工具：这里只测到部分描述常量（完整数字见 [tools.md](tools.md)）：Read 750、Edit 358、Grep 495、Glob 140、Write 240、AskUserQuestion 1,771、SendMessage 503、Bash 约 1,219、计划模式两工具约 6,000。同名工具的描述约为 DreamCoder 的 1/3 到 1/8；24 个工具合计约 2 万字符是推断。
- Codex 工具：按源码字面量粗估（shell_spec 约 7.1K、request_user_input 约 3.2K、view_image 约 1.3K、goal 约 1.8K、多代理一套约 11K），加 JSON 结构约 2.8 万（推断）。
- 折算：英文散文与 JSON 混合按约 4 字符/token；中文或密集 JSON 偏差较大，只用于比较量级。
- 本场景 DreamCoder 前缀不命中缓存，这约 3 万 token 每个请求都按全价计；另两家在 provider 支持自动前缀缓存时，第二个请求起这部分主要按缓存价计（推断，取决于 provider）。

## 3. 对 DreamCoder 的含义

### DreamCoder 有而另两家都没有

| 差异 | 事实 | 后果 |
|---|---|---|
| 每请求变化的计费头 `cch` | system 第 79–83 字符逐请求不同（Q2） | 推断：provider 前缀缓存命中率接近 0；固定部分约 3 万 token 加全部历史每个请求按全价计；缓存价通常是原价的 10%–50%，长会话里输入成本差距按历史长度放大。延迟上也拿不到缓存命中带来的首 token 提速。 |
| 代理丢弃全部缓存控制字段 | `cache_control`、beta 头、`metadata` 不转发；无会话亲和头（Q3） | 推断：即使去掉 `cch`，对需要显式标记或靠会话粘性路由的 provider 也拿不到缓存；靠自动前缀缓存的 provider 会恢复。 |
| 每请求约 9–10 万字符工具定义、memory 段约 1.25 万字符 | Q7 | 推断：固定开销是 Codex 的约 2.6 倍、ZCode 的约 4.5 倍；在 200K 窗口下约占 15%，压缩更早触发。 |
| 压缩用 fork 重发整份前缀，不设输出上限 | Q5 | 事实：这次请求的输入约等于当时整个上下文。推断：因计费头它不命中缓存，一次压缩的输入接近窗口阈值。输出无上限，非原生模型可能写出很长的摘要。 |
| 代理把工具结果图片换成文字 | `toolArguments.ts:40-42` | 推断：Read 读图、截图类工具对模型无效，模型可能重试，增加轮数。 |
| 服务端标题请求两次 | 第 1、3 条用户消息 | 事实：每会话多两次小请求，`fastModel` 未配置时用主模型。 |

### 另两家都有而 DreamCoder 没有

| 差异 | 事实 | 后果 |
|---|---|---|
| 逐请求严格不变的前缀 | Codex 有测试保证；ZCode 有 system 快照、公告只追加 | 推断：这是另两家在 benchmark 上输入成本低的直接原因之一，在 provider 自动缓存下效果最大。DreamCoder 除计费头外的设计也能做到，差的是那一行。 |
| 会话级缓存路由信息 | Codex `prompt_cache_key` + `session-id`；ZCode `x-session-id` | 推断：多副本部署的 provider 可据此把同一会话路由到同一缓存节点；DreamCoder 每请求可能落到不同节点。 |
| 第三方模型的上下文窗口来源更全 | ZCode 规则表覆盖 glm-5.3、kimi-k3，默认 1M；Codex 可配置 | 事实：DreamCoder 对表外且服务端未回填的模型按 200,000 计。推断：对 1M 窗口的模型过早压缩、多付压缩费用；对小窗口模型则可能来不及压缩就超窗口。ZCode 默认 1M 是另一方向的风险。 |
| 压缩摘要输出上限 | ZCode 20K；Codex 未核实 | 推断：DreamCoder 依赖 provider 默认 `max_tokens`，摘要长度和耗时不可控。 |
| 写入历史时统一截断 | Codex 每项约 12KB 中间截断 | 推断：DreamCoder 单项可达 50,000 字符（Bash 30,000），历史增长更快；ZCode 介于两者之间。 |

旧工具结果清理：三家在本场景都没有生效的机制，不构成差异；DreamCoder 与 ZCode 都有实现但默认关闭。

## 4. 没有核实的地方

- `@ai-sdk/openai-compatible` 是否忽略 `providerOptions.anthropic.cacheControl`：SDK 源码不在本地，按该 SDK 的已知行为推断为忽略。
- 各 provider 的 chat 模板是否把 `tools` 渲染到 system 附近（影响「中途新增工具」对前缀的破坏位置）：未核实。
- DeepSeek 官方端点是否同时返回 `prompt_tokens_details.cached_tokens`：未核实；DreamCoder 不读 `prompt_cache_hit_tokens`。
- Codex：git 状态是否进入初始上下文、本地压缩请求是否设置输出上限、中途出现的 MCP 工具对 `tools` 顺序的影响：未核实。
- ZCode：24 个工具的完整描述总长（只测了部分）；`cli/src` 未设 `compact` 与 `titleGeneration` 的结论依据 grep 无结果。
- DreamCoder：工具定义总长为静态提取的估计，未在运行时序列化核对；代理进程 `CLAUDE_CODE_ENTRYPOINT` 未设（推断为 `unknown`）。指纹值 `d27` 是按算法手算，未在运行中抓包。
- 各家实际缓存命中率与成本：没有运行，没有数据。
