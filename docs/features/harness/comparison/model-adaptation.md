# D 维度：适配模型与提供方（传输层）

路径约定：DreamCoder 相对仓库根（`src/...`）；`codex:` 相对 `refs/coding-agents/codex/codex-rs`；`zcode:` 相对 `refs/coding-agents/zcode/apps/zcode-cli/packages`；`zcode-rules:` 指 `refs/coding-agents/zcode/config/provider/zcode-builtin.json`（解析该 JSON 得到的规则序号写作 `modelApiRules[n]` 等）；`zcode-repo:` 指 zcode 仓库根下的 `packages/provider`、`packages/model-option-map`（规则引擎所在）。场景见 [README](../README.md#对比的场景)：第三方非原生模型，经 OpenAI 兼容 chat-completions 端点。全部为静态阅读，未运行任何代码。

## 1. 结论

1. **线协议**：Codex 只说 Responses API，配置 `wire_api = "chat"` 在反序列化时直接报错（codex:model-provider-info/src/lib.rs:108-135）；chat-only 的提供方在 Codex 里无法直接接入，只能在外部加 Responses→chat 网关（推断）。ZCode 用 Vercel AI SDK 原生支持 chat completions（zcode:adapters/src/model/model-execution.ts:301-312, 401-423）。DreamCoder 的 CLI 只说 Anthropic Messages，靠服务端本地代理逐字段翻译（src/server/upstream/client.ts:202-235）。
2. **每模型知识**：ZCode 有一份 83 条模型规则、73 条模型×协议规则、58 条站点规则的声明式表，按模型名正则和 baseUrl 叠加，决定上下文窗口、输出上限、推理档位及其写到哪个请求字段（zcode-repo:packages/provider/src/config/model-config.ts:398-436）。Codex 只有 11 条 OpenAI 自家模型，未知模型走固定回退值（codex:models-manager/src/model_info.rs:90-146）。DreamCoder 只有上下文窗口表（src/utils/model/modelContextWindows.ts:5-48）和以 Claude 名字为依据的输出上限/能力判断，第三方模型的推理参数没有按模型的映射。
3. **推理/effort 在 DreamCoder 的 chat 路径上到不了上游**：自定义 provider 下 CLI 总是发 `thinking:{type:'adaptive'}`（src/services/api/claude.ts:1649-1659），代理只在有 `budget_tokens` 或 `type:'enabled'` 时写 `reasoning_effort`（src/server/proxy/transform/anthropicToOpenaiChat.ts:64-72），`output_config.effort` 被丢弃。结果：桌面的 Effort 设置在 openai_chat 上游上不产生任何请求字段（DeepSeek/opencode.ai 域名只多透传一个 `thinking.type`）。ZCode 对每个模型/站点写对应字段（`reasoning_effort`、`thinking.type`、`enable_thinking` 等），默认取最高档。Codex 未知模型不发 effort，只发 `summary:"auto"`。
4. **输出上限**：ZCode 每步发 `max_completion_tokens = min(模型上限, 窗口−估算输入−1000)`（zcode:core/src/runtime/methods/model-token-limits.ts:6-45）；Codex 不发；DreamCoder 的 CLI 发 32000，但代理不转发（`OpenAIChatRequest.max_tokens` 无代码赋值），上游用自身默认值。截断后 ZCode 与 DreamCoder 都有同文的“继续”提示（最多 3 次），Codex 把 `response.incomplete` 当错误结束回合。
5. **DreamCoder 代理在每个请求的 system 首行插入随请求体变化的 billing 行**（src/server/proxy/handler.ts:64；src/server/proxy/claudeCodeAttribution.ts:28-46；src/utils/claudeCodeCch.ts:46-59 用整个请求体算哈希替换 `cch=00000`）。system 是请求的第一条消息，提供方的前缀缓存因此在第一行就失配（推断：缓存按前缀匹配）。另两家没有这类逐请求变化的前缀内容。
6. **推理内容跨轮回传**：DreamCoder 只对 baseUrl 含 deepseek 或 opencode.ai 的上游写回 `reasoning_content`（client.ts:251-256），其余（含 Kimi、GLM 的 chat 端点）历史 thinking 全部丢弃。ZCode 把 reasoning 作为 AI SDK 的 reasoning part 交给 SDK，是否序列化为 `reasoning_content` 取决于 `@ai-sdk/openai-compatible`（未核实）。Codex 的 Responses 路径保存并回传 reasoning item（含 `encrypted_content`）。
7. **非原生模型的容错**：ZCode 有空回复重试、重复调用提醒、参数规范化、媒体降级、`$ref` 修整、上下文溢出文本识别；Codex 有 schema 清理、调用/输出配对修补、参数错误回给模型；DreamCoder 有参数解析失败→`{}`、字符串布尔/数字容忍、zod 错误回给模型，但没有 schema 清理、空回复重试、重复调用检测，且 chat 流里不带 id 的 tool_call 会被丢弃（src/server/proxy/streaming/openaiChatStreamToAnthropic.ts:405）。
8. **错误与重试**：三家都有指数退避。DreamCoder 的代理把上游错误统一包成 `api_error` 并丢掉上游响应头（`retry-after` 失效，handler.ts:66-71）；CLI 的 Anthropic 专用识别（`prompt is too long`、`overloaded_error`、`input length and max_tokens exceed`）对 OpenAI 风格错误文本不命中，且被动压缩模块在本构建里是 stub，上下文溢出后没有自动恢复。ZCode 用文本和错误码识别上下文溢出并触发压缩。
9. **辅助请求的模型**：DreamCoder 在本场景用 `haiku` 别名（= provider.fastModel，未设则主模型）跑 Explore 子代理和 WebFetch 页面处理；ZCode 所有辅助请求都用会话主模型；Codex 压缩用主模型，review/memories 等有独立配置项。

## 2. 逐项对比

### Q1 到提供方的路径与支持的线协议

| | Codex | ZCode | DreamCoder |
|---|---|---|---|
| 支持的协议 | 仅 Responses | anthropic-messages / openai-responses / openai-chat-completions | CLI 仅 Anthropic Messages；代理上游 anthropic / openai_chat / openai_responses |
| chat-only 提供方 | 不能直连（`chat` 报错） | 原生（@ai-sdk/openai-compatible） | 经本地代理翻译 |
| URL | base_url + `/responses` | SDK 按协议拼接 | base（去掉尾部 `/v1`）+ `/v1/chat/completions` |
| 中间层 | 无 | option-map fetch 改写请求体 JSON | Bun 服务端代理 |

- Codex：`WireApi` 只有 `Responses`（codex:model-provider-info/src/lib.rs:108-113），`"chat"` 反序列化报 `CHAT_WIRE_API_REMOVED_ERROR`（:124-135）。仓库内 `responses-api-proxy` 只把 `POST /v1/responses` 转发给 OpenAI（codex:responses-api-proxy/README.md:26-30），不做协议转换。调用链：turn 循环（codex:core/src/session/turn.rs:1678-1690）→ `stream_responses_http`（codex:core/src/client.rs:1797-1996，另有 WebSocket 路径）→ `build_responses_request`（:979-1130）。
- ZCode：`api.type` 选择 SDK 工厂（zcode:adapters/src/model/model-execution.ts:401-423）；chat 用 openai-compatible，`includeUsage:true`（:301-312）；fetch 链为 option-map → business-error → request-security → endpoint-routing → 代理（:333-394）；SDK 的 `maxRetries:0`，重试自己做（zcode:adapters/src/model/runner-options.ts:101-167）。
- DreamCoder：CLI 的 `ANTHROPIC_BASE_URL` 指向 `http://127.0.0.1:<port>/proxy`（src/server/services/providerRuntimeEnv.ts:210-216），代理只接 `POST /proxy/v1/messages` 与 `/proxy/providers/:id/v1/messages`，`apiFormat==='anthropic'` 时 400 拒绝（src/server/proxy/handler.ts:9-52）；`normalizeUpstreamBaseUrl` 去掉尾部 `/v1`（src/server/upstream/baseUrl.ts:1-3），再拼 `/v1/chat/completions`（client.ts:205-215）。预设中只有 qwen 是 openai_chat；DeepSeek/Kimi/智谱预设是 anthropic 格式，CLI 直连上游的 Anthropic 兼容端点、不经代理（src/server/config/providerPresets.json；providerRuntimeEnv.ts:211-216）。

### Q2 DreamCoder 逐字段翻译

请求方向（chat，src/server/proxy/transform/anthropicToOpenaiChat.ts）：

| Anthropic 字段 | 发往 chat 上游 | 位置 |
|---|---|---|
| system（块数组） | 用 `\n` 拼成一条 role=system；代理先在最前插 billing 块 | :19-26；handler.ts:64 |
| cache_control | 丢弃 | — |
| user 的 tool_result | role=tool，排在同一条 user 的文本/图片之前 | :105-131 |
| tool_result 里的图片 | 文字 `[image omitted: <mime>]` | toolArguments.ts:37-38 |
| tool_result.is_error | 丢弃 | types.ts:153 有字段，转换未用 |
| user 图片 | `image_url` data URL | :111-113 |
| assistant text / tool_use | 拼接文本；`tool_calls` | :143-167 |
| assistant thinking | 仅 deepseek/opencode.ai 域名写 `reasoning_content`，否则丢弃 | :146-147, 168-170；client.ts:206-210, 251-256 |
| tools | `input_schema` 原样作 `parameters`；去掉 `BatchTool`；无 schema 清理 | :47-58 |
| tool_choice | auto→auto，any→required，none→none，tool→function | :175-187 |
| thinking | 见 Q3 | :64-76 |
| output_config（effort/format） | 丢弃（类型里无此字段） | types.ts:161-181 |
| max_tokens | 不转发 | types.ts:35-36 有字段，无赋值 |
| temperature / top_p / stop_sequences | 转发 | :40-45 |
| metadata、betas（在 HTTP 头里）、context_management | 丢弃 | — |
| stream_options.include_usage | 流式时总设 true | :38 |
| parallel_tool_calls | 不发送（全仓无此字段） | grep |

请求方向（Responses，src/server/proxy/transform/anthropicToOpenaiResponses.ts）：system → `instructions`（:24-30）；`store:false`（:21）；消息内块按原顺序展开，tool_use → `function_call`，tool_result → `function_call_output`（:90-105）；助手文本 `output_text`、用户文本 `input_text`（:80）；图片 `input_image`（:85-89）；thinking 块总是丢弃，不生成 reasoning item，也不请求 `encrypted_content`；tools 带 `strict:false`（:36-44）；`reasoning.effort` 规则与 chat 相同（:51-60）；stop_sequences、max_tokens、parallel_tool_calls 不发送。

响应方向（chat 流，src/server/proxy/streaming/openaiChatStreamToAnthropic.ts）：

| 上游 | 转成 | 位置 |
|---|---|---|
| `delta.content` | text 块 | :358-368 |
| `reasoning_content` / `reasoning` / `thinking_blocks` | thinking 块，signature 为空串（thinking_blocks 时取原值） | :246-268, 338-356 |
| `tool_calls[].index` | 每个 index 一个 tool_use 块；参数以 `input_json_delta` 增量转发 | :387-431 |
| 无 index 的并行调用 | 按 id 变化或 name 再次出现判定新调用 | :370-385 |
| 无 id 的 tool_call | 不开块，整个调用被丢弃 | :405 |
| finish_reason | stop→end_turn，tool_calls→tool_use，length→max_tokens，content_filter/其他→end_turn；出现过工具而 stop→tool_use | :433-445, 530-538 |
| usage | `prompt_tokens − cached_tokens`→input，`prompt_tokens_details.cached_tokens`→cache_read；无 cache_creation；usage 晚到时暂存 message_delta 等合并 | openaiChatToAnthropic.ts:81-91；:457-476 |
| 无 usage 块 | `output_tokens:0` | :518-525 |
| 流中 `error` 对象 / 无有效 chunk | SSE `error` 事件，type api_error，无 HTTP 状态 | :113-120, 497-505 |
| 流截断（无 finish_reason） | 补 end_turn 的 message_delta + message_stop | :508-527 |

- 非流式 chat（openaiChatToAnthropic.ts）：参数 JSON 失败 → `{raw: 原文}`（toolArguments.ts:7-22），与流式路径（CLI 侧解析失败得到 `{}`，src/utils/messages.ts:2770-2789）不一致；无 choices → 空文本。
- Responses 流（openaiResponsesStreamToAnthropic.ts）：`function_call` item → tool_use（:156-172），参数按 `item_id`（:227-239）；`reasoning_summary_text`/`reasoning_text` → thinking（:268-290）；`incomplete`→max_tokens，`completed` 且有工具→tool_use（:318-327）；`response.failed`/`error` → SSE error（:307-315）；usage 用 `input_tokens_details.cached_tokens`（openaiResponsesToAnthropic.ts:36-44）。
- 缓存用量字段：只读 `prompt_tokens_details.cached_tokens`。DeepSeek 原生端点用 `prompt_cache_hit_tokens` 报告缓存（推断，依据外部文档，代码中未处理），这种情况下缓存命中会记为 0。

### Q3 推理与 effort

| | Codex | ZCode | DreamCoder（openai_chat 上游） |
|---|---|---|---|
| 档位来源 | 配置 `model_reasoning_effort` 或目录默认 | 模型规则 `reasoningLevel.values`；选模型时取最高档 | 桌面 Effort → `--effort` |
| 未知模型默认 | 不发 effort，只发 `summary:"auto"` | `enabled` → 通用映射写 4 个字段 | 不发任何推理字段 |
| 写到哪里 | `reasoning.{effort,summary}` | option-map 按模型/站点写 `reasoning_effort` / `thinking.type` / `enable_thinking` / `reasoning.effort` | 仅在 thinking 有 budget 或 enabled 时写 `reasoning_effort` |
| 跨轮推理内容 | reasoning item + `encrypted_content` 回传 | reasoning part 交给 SDK（序列化未核实） | 仅 deepseek/opencode.ai 域名写回 `reasoning_content` |

- Codex：`build_reasoning`（codex:core/src/client.rs:957-976）；include 至少含 `reasoning.encrypted_content`（:1075）；reasoning item 属于发给 API 的历史项（codex:core/src/context_manager/history.rs:1048）。回退元数据 `default_reasoning_level: None`、`supported_reasoning_levels` 为空（codex:models-manager/src/model_info.rs:90-146）。DeepSeek/Kimi 式 `reasoning_content`：Codex 不说 chat，不适用。
- ZCode：通用 chat 映射（zcode-rules: modelApiRules[2]）同时写 `thinking.type`、`enable_thinking`、`reasoning_effort`（disabled→"none"，enabled→"high"）、`reasoning.effort`；kimi-k3 → 仅 `reasoning_effort`（modelApiRules[24],[26]）；`deepseek-v4[.-]1-flash` → `thinking.type` + `reasoning_effort`（modelApiRules[67]）；glm-5.3 走 chat 时落到通用映射；`deepseek-v4.1-pro` 无专门规则，落到基线（推断：正则整串匹配不命中）。默认档取 `values.at(-1)`（zcode-repo:packages/provider/src/model-selection-config.ts:57-72）。推理历史经 `normalizeReasoningHistory` 去掉跨模型 reasoning 等（zcode:adapters/src/model/reasoning-history-normalization.ts:44-52），以 reasoning part 交给 `@ai-sdk/openai-compatible` ^2.0.58（zcode:adapters/package.json:110）；空 reasoning 不写 `reasoning_content` 有测试（zcode:adapters/tests/openai-compatible-extra-body-wire.test.ts:106-133），非空时是否写出未核实。
- DreamCoder 链路（静态追踪，未运行）：
  1. 桌面 Effort 选项 low/medium/high/max；会话内经 WS `set_runtime_config`，全局经 PUT `/api/effort`；未设置时服务器不加参数（src/server/ws/handler.ts:1174-1180, 1202-1207）。启动参数 `--effort <level>`（src/server/services/conversationService.ts:976-978）；改 effort 会重启会话。
  2. CLI：`resolveAppliedEffort`（src/utils/effort.ts:152-167）；`configureEffortParams` 只在 `modelSupportsEffort` 为真时写 `output_config.effort`（claude.ts:439-465）。
  3. thinking：默认 `{type:'adaptive'}`（src/main.tsx:2422-2426）；`hasThinking && modelCanThink` 且支持 adaptive → `thinking:{type:'adaptive'}`，否则 `{type:'enabled', budget_tokens}`（claude.ts:1649-1673）；不能 think 时只有 `sendsExplicitDisabledThinking` 才发 disabled（:1674-1678）。
  4. **自定义 provider**：`presetId==='custom'` 时三档 `*_SUPPORTED_CAPABILITIES` 都是 `thinking,effort,adaptive_thinking,max_effort`，主模型同时是 SONNET/OPUS 默认模型（providerRuntimeEnv.ts:38, 229-250），因此走 adaptive 分支，`set_max_thinking_tokens` 的预算也不会被采用。代理收到 `thinking:{type:'adaptive'}` + `output_config.effort` → chat 请求里没有 `reasoning_effort`（adaptive 无 budget，type 不是 enabled），effort 丢弃。上游收到：非 deepseek/opencode.ai 域名无任何推理字段；这两个域名多一个 `thinking:{type:"adaptive"}`（client.ts:206-210；上游是否接受该值未核实）。关闭思考时同理，上游按模型自身默认决定是否思考。
  5. **预设 provider（qwen，openai_chat）**：无能力声明，模型名不含 sonnet-4/opus-4 → `modelSupportsThinking` 为假（src/utils/thinking.ts:91-117），不发 thinking；`modelSupportsEffort` 对未知名字在 firstParty 下为真（effort.ts:23-49），写入 `output_config.effort` 后被代理丢弃。上游收到：无推理字段。
  6. Kimi/智谱/DeepSeek 预设走 anthropic 格式直连，thinking 与 output_config 原样到上游；Kimi/智谱额外设 `DREAMCODER_SEND_DISABLED_THINKING=1`，关闭时显式发 disabled（providerPresets.json）。

### Q4 每模型知识及来源

| | Codex | ZCode | DreamCoder |
|---|---|---|---|
| 来源 | 内置 models.json 11 条（OpenAI）＋可选 `model_catalog_url` | zcode-builtin.json 规则叠加＋个人手动规则 | 上下文窗口表＋env 覆盖；其余按 Claude 名字判断 |
| 匹配方式 | slug 最长前缀，再去一段命名空间 | 模型 id 整串正则（忽略大小写）＋协议＋baseUrl | 窗口：精确/后缀匹配；能力：名字含 sonnet/opus/haiku |
| 未知模型窗口 | 272000，有效 95% | 1000000（基线） | 200000 |
| 未知模型输出上限 | 不发送 | 128000（基线） | 32000（CLI 内部；不转发） |
| 推理档位 | 空 | [disabled, enabled] | 无映射 |
| 图像 | 文本+图像 | 仅文本，媒体降级 | 无判断，照发 |
| 并行工具调用 | 请求固定 true | 未见设置 | 不发送 |
| 中途系统消息 | developer 角色项 | 由 `supportsMidConversationSystem` 决定 | 不用 system 角色（user 内 system-reminder） |
| 工具格式特例 | 回退时不声明 apply_patch | `requiresMfjsToolSchema`；strict 仅一方模型 | 仅过滤 BatchTool |

- Codex：目录匹配 codex:models-manager/src/manager.rs:888-931；回退 codex:models-manager/src/model_info.rs:90-146（截断 10000 字节、窗口 272000、`input_modalities` 默认文本+图像 codex:protocol/src/openai_models.rs:193-195、`used_fallback_model_metadata=true`）；`parallel_tool_calls: true` 固定（codex:core/src/session/turn.rs:1686），单个工具能否并行由注册表决定（codex:core/src/tools/registry.rs:606）；基础指令作为 developer 角色的首个 input 项（codex:core/src/client.rs:1031-1041；codex:core/src/context/base_instructions.rs:46-47）。
- ZCode：基线规则 `.*`：窗口 1000000、仅文本、`supportsToolCall` true、`supportsMidConversationSystem` false、输出上限 128000、档位 [disabled, enabled]（zcode-rules: modelRules[0]）；手动模型可覆盖的字段见 zcode-repo:packages/provider/src/config/manual-model-config.ts:7-28；媒体降级 zcode:adapters/src/model/media-transform-policy.ts、tool-result-media-projection.ts；中途 system 由 zcode:core/src/runtime/helpers/runtime-provider-request-messages.ts:13-20 控制；工具检索只在 anthropic-messages 可用（zcode:adapters/src/model/tool-search.ts:5-17）。
- DreamCoder：窗口优先级为 env `CLAUDE_CODE_MODEL_CONTEXT_WINDOWS`（预设表 + provider 配置；列模型时由 src/server/upstream/contextWindows 从 `/v1/models` 列表、ollama、lmstudio、deepseek、qwen 来源补全，index.ts:11-17）> 内置表（src/utils/model/modelContextWindows.ts:5-48，有 deepseek-v4、kimi-k2.x、glm-5.1 等，无 glm-5.3/deepseek-v4.1/kimi-k3）> 200000（src/utils/context.ts:11, 53-115）。输出上限按 Claude 名字（context.ts:203-260），未知模型 32000、上限 64000；`getModelCapability` 仅 ant（src/utils/model/modelCapabilities.ts:46-51）。thinking/effort 能力：3P 能力 env 覆盖 → 名字判断（effort.ts:23-49；thinking.ts:91-163）。

### Q5 输出上限与截断

| | Codex | ZCode | DreamCoder |
|---|---|---|---|
| 请求里的上限 | 不发 | `max_completion_tokens = min(模型上限, 窗口−输入估算−1000)` | CLI 32000，代理不转发 → 上游默认 |
| 截断判定 | `response.incomplete`（非 interrupted/content_filter） | finishReason length 或原始 max_tokens 等 | finish_reason length → max_tokens |
| 截断后 | `ResponseIncomplete` 错误，不重试，回合结束 | 无工具调用时注入继续提示，最多 3 次，第 4 次报错 | 无 tool_use 时注入继续提示，最多 3 次；有 tool_use 时照常执行工具 |

- Codex：codex:codex-api/src/sse/responses.rs:419-448；不重试 codex:protocol/src/error.rs:424。
- ZCode：zcode:core/src/runtime/methods/model-token-limits.ts:6-45；zcode:core/src/runtime/methods/turn-output-token-continuation.ts:17-66。
- DreamCoder：`getMaxOutputTokensForModel`（claude.ts:3454-3474；`tengu_otk_slot_v1` 默认 false，8K 封顶不生效）；截断时生成 “exceeded the 32000 output token maximum” 的 API 错误消息（claude.ts:2316-2326，数字是 CLI 的值，与上游实际上限无关）；续写提示 query.ts:1212-1242，次数上限 :165；有 tool_use 时 `needsFollowUp` 为真，不进入恢复（query.ts:830-835, 1050），被截断的参数解析为 `{}` 后由 zod 校验报错回给模型。

### Q6 对非原生模型的容错

| | Codex | ZCode | DreamCoder |
|---|---|---|---|
| 工具参数解析失败 | 错误文本回给模型 | 规范化为 `{}`（去 BOM） | 流式 `{}`、非流式 `{raw}`；zod 错误回给模型 |
| 参数类型容忍 | 未找到 | 未找到 | 字符串 "true"/"5" 接受为布尔/数字 |
| schema 清理 | MCP/动态工具 `sanitize_json_schema` | `$ref` 提升（仅 kimi-k3 某站点）；strict 仅一方 | 无 |
| 文本内嵌工具调用 | 未找到 | 未找到 | 未找到 |
| 无 id / 空名的调用 | 未找到 | 空名保留并让工具报错 | 无 id 的调用被丢弃 |
| 空回复 | 未找到专门处理 | 重试 1 次 | 无事件时改非流式重试；有效但空的回复直接结束 |
| 重复调用 | 未找到 | 同名同参连续 3 次注入提醒 | 未找到 |
| 角色顺序 | 补缺失 call output、删孤立 output | reasoning 历史规范化、补 “(no content)” | tool 消息放在同条 user 文本前；CLI 侧配对修补 |
| system 合并 | 基础指令为 developer 项 | 开头连续 system 合并为一条 | 所有 system 块合成一条 |

- Codex：codex:core/src/context_manager/normalize.rs:21, 171, 346, 394；codex:tools/src/json_schema.rs:47-116；参数错误 `RespondToModel("failed to parse function arguments: …")`（如 codex:core/src/tools/code_mode/wait_handler.rs:44-49）。
- ZCode：zcode:adapters/src/model/tool-input-normalization.ts:9-47；tool-call-validation.ts:5-27；empty-completion-retry.ts:6-27；zcode:core/src/runtime/helpers/model-anomaly.ts:21-113；zcode:adapters/src/model/system-message-compat.ts:6-36。
- DreamCoder：src/utils/messages.ts:2770-2789；src/utils/semanticBoolean.ts:22-28（另有 semanticNumber.ts:26，12 个工具文件使用）；src/services/tools/toolExecution.ts:616-671；空流分支 claude.ts:2400-2413（代理在流结束时总会补 end_turn，所以上游返回合法但空的回复不会触发该分支，推断）；无 id 丢弃 openaiChatStreamToAnthropic.ts:405。

### Q7 错误与重试

| | Codex | ZCode | DreamCoder |
|---|---|---|---|
| 次数 | HTTP 层 4，流/回合层 5；连接失败无限（5s 起，上限 60s） | 10 次重试 | CLI 10 次；代理 0 次 |
| 退避 | 200ms 起指数，或 retry-after | 2s×2，上限 60s，抖动，遵守 retry-after（≤5 分钟） | 500ms×2，上限 32s，+25% 抖动；retry-after 被代理丢掉 |
| 429 | HTTP 层不重试，回合层按类别重试 | 重试 | 重试 |
| 400/422 | 不重试 | 不重试 | 不重试 |
| 上下文溢出 | `context_length_exceeded` 码 → 标满；纯文本 400 → InvalidRequest | 码或文本（含 “maximum context length”）→ 被动压缩 | 仅认 “prompt is too long”；被动压缩是 stub，不恢复 |
| 流中断 | 回合层重试 | streamRecovery 重发 | 默认改走非流式请求 |

- Codex：codex:model-provider-info/src/lib.rs:68-70, 471-477；codex:core/src/responses_retry.rs:22-23, 56-173；codex:protocol/src/error.rs:415-460；codex:codex-api/src/sse/responses_error.rs:48。
- ZCode：zcode:adapters/src/model/retry-policy.ts:12-31；runner-retry.ts:15-60；failure-classifier.ts:194-300；failure-inspection.ts:185-243；zcode:core/src/runtime/internal-turn-methods.ts:191。
- DreamCoder 代理：上游非 2xx → `{type:'error',error:{type:'api_error',message:'Upstream returned HTTP <s>: <body 前 500 字>'}}`，状态码沿用，上游响应头不传（handler.ts:66-71；client.ts:83-89）；网络错误/超时 → 502；代理超时默认 120s（src/server/services/networkSettings.ts:13），流式只覆盖到收到响应头（client.ts:258-277）。SDK 把 body 序列化进消息 `"<status> {json}"`（node_modules/@anthropic-ai/sdk/core/error.js:18-26）；SSE `error` 事件生成无状态码的 APIError（node_modules/@anthropic-ai/sdk/core/streaming.js:99-103）。
- DreamCoder CLI：`withRetry` 默认 10 次（src/services/api/withRetry.ts:52, 789-794），退避（:530-548），可重试 408/409/429/401/5xx/连接错误（:696-786）。流中错误默认改非流式请求再走 withRetry（claude.ts:2512-2601）。流空闲看门狗默认关闭（claude.ts:1924-1928，需 `CLAUDE_ENABLE_STREAM_WATCHDOG`）。
- Anthropic 专用处理在翻译后的错误上是否触发：529 判定为 `status===529` 或消息含 `"type":"overloaded_error"`（withRetry.ts:610-621）——代理把上游 body 放进 JSON 字符串字段，引号被转义，该子串不会出现（推断）；OpenAI 兼容上游通常不返回 529。“prompt is too long”（src/services/api/errors.ts:560-573）与 “input length and `max_tokens` exceed context limit”（withRetry.ts:550-575）都是 Anthropic 文本，OpenAI 风格的 `context_length_exceeded` / “maximum context length” 不匹配；即使匹配，`REACTIVE_COMPACT` 为 false 且模块是生成的 stub（src/query.ts:15-17；src/services/compact/reactiveCompact.ts），不会被动压缩。429 的提示文案指向 status.anthropic.com（errors.ts:555）。

### Q8 辅助请求的模型

| | Codex | ZCode | DreamCoder |
|---|---|---|---|
| 机制 | 各功能独立配置项 | 无小模型，一律用会话模型 | `haiku` 别名与 `ANTHROPIC_SMALL_FAST_MODEL` |
| 本场景用到小模型的 | 无（压缩用主模型） | 无 | Explore 子代理、WebFetch 页面处理、claude-code-guide 子代理、prompt/agent 类 hook |
| 本场景不触发的 | memories 默认关；`codex exec` 无标题请求 | — | bash 前缀、工具摘要、WebSearch 小模型、away summary、CLI 内标题 |

- Codex：压缩用当前模型，非 OpenAI 提供方无远程压缩（codex:model-provider/src/capabilities.rs:33-40）；memories 默认关（codex:features/src/lib.rs:1317-1322），开启后用 `memories.extract_model/consolidation_model`（codex:config/src/types.rs:352-354）；`review_model`（codex:config/src/config_toml.rs:172）。
- ZCode：压缩、标题、web_fetch、web_search、project_memory_recall、子代理都用会话模型（zcode:core/src/runtime/methods/compact-active.ts:206-210；zcode:bootstrap/src/app/workflow-actor-model.ts:5-8）。
- DreamCoder：别名解析 `getSmallFastModel` → `ANTHROPIC_SMALL_FAST_MODEL` → `ANTHROPIC_DEFAULT_HAIKU_MODEL`（src/utils/model/model.ts:41-43, 142-148），两者都是 provider.fastModel，未设则主模型（providerRuntimeEnv.ts:220-222, 247-248）。Explore 子代理非 ant 时 `model:'haiku'`（src/tools/AgentTool/built-in/exploreAgent.ts:78），非 ant 默认启用（src/tools/AgentTool/builtInAgents.ts:13-16）；WebFetch `applyPromptToMarkdown` 调 `queryHaiku`（src/tools/WebFetchTool/utils.ts:516），预批准域名的短 markdown 例外（WebFetchTool.ts:261-276）；claude-code-guide `model:'haiku'`（claudeCodeGuideAgent.ts:119）；hook 默认 small-fast（src/utils/hooks/execPromptHook.ts:79；execAgentHook.ts:118）。不触发：bash 前缀生产路径不调用（src/tools/BashTool/bashPermissions.ts:2386-2393）；工具摘要需 `CLAUDE_CODE_EMIT_TOOL_USE_SUMMARIES`（src/query/config.ts:36）；WebSearch 小模型需 `tengu_plum_vx3`（src/tools/WebSearchTool/WebSearchTool.ts:395-398）；会话标题由服务端 titleService 用 `fastModel || 选中模型` 直连上游（src/server/services/titleService.ts:78-85，不经代理 handler，没有 billing 行）。`queryHaiku` 发出的请求 thinking 为 disabled、不带工具（claude.ts:3325-3340）。

## 3. 对 DreamCoder 的含义

### DreamCoder 有而另两家都没有

| 差异 | 事实 | 后果（推断） |
|---|---|---|
| 请求要经过 Anthropic→OpenAI 的有损翻译层 | effort、max_tokens、is_error、cache_control、tool_result 内图片、非白名单域名的历史 reasoning 被丢弃（Q2 表） | 非原生模型拿不到推理强度和输出上限；工具失败只能靠文本区分；推理模型跨轮丢失自己的推理，可能重复推理、输出变长 |
| system 首行逐请求变化的 billing 行 | handler.ts:64；claudeCodeCch.ts:46-59 | 提供方前缀缓存从第一行起失配，每轮按全量输入计费，输入成本和首 token 延迟都上升；与 benchmark 中 Claude Code 系输入 token 多、耗时长的方向一致，但未测量 |
| 以 Claude 名字为依据的能力推断 | thinking/effort/输出上限按 sonnet/opus/haiku 判断；自定义 provider 统一声明全部能力 | 同一个第三方模型，选“自定义”和选“预设”时请求字段不同；Effort 设置在 chat 上游没有效果 |
| `haiku` 别名驱动的子代理与 WebFetch | Q8 | 未设 fastModel 时等于主模型，无节省；设了 fastModel 时 Explore 子代理的质量取决于该小模型 |
| CLI 看不到上游的错误语义 | 代理统一包成 api_error，丢 retry-after | 限流时按固定退避重试，可能过早重试再被限流；上下文溢出直接失败，不自动压缩 |
| 截断提示中的上限数字来自 CLI | claude.ts:2316-2326 | 显示的 32000 与上游实际上限不符，只影响提示文本 |

### 另两家都有而 DreamCoder 没有

| 差异 | 事实 | 后果（推断） |
|---|---|---|
| 输出上限的请求语义一致（ZCode 明确发送；Codex 走 Responses 默认、不声称发送） | DreamCoder 的 CLI 以为发了 32000，实际被代理丢弃 | 输出上限由上游默认值决定，有的提供方默认较小，长文件写入更易被截断，进而触发续写或 `{}` 参数错误，增加轮数 |
| 按模型的推理参数映射 | ZCode option-map；Codex `reasoning.effort` | DreamCoder 无法让 GLM/Kimi/DeepSeek 在 chat 端点上开关或调节推理 |
| 跨轮推理内容的通用处理 | Codex 回传 reasoning item；ZCode 交给 SDK 并做历史规范化 | DreamCoder 只对两个域名回传；对要求回传的模型（如 Kimi 思考模式）可能出现质量下降或 400（未核实） |
| 上下文溢出的识别 | ZCode 文本+码识别并压缩；Codex 识别码 | DreamCoder 只靠按 200K（或配置值）提前自动压缩；窗口配置偏大时，溢出即失败 |
| 对未知模型给出集中的回退元数据 | Codex 回退 ModelInfo；ZCode 基线规则 | DreamCoder 的回退分散在多个按 Claude 名字判断的函数里，结果随 provider 类型变化 |

另外：ZCode 独有的容错（空回复重试、重复调用提醒、媒体按模型降级）DreamCoder 也没有；Codex 独有的工具 schema 清理 DreamCoder 也没有（MCP 工具 schema 原样发给上游；哪些提供方会拒绝含 `$ref`/`oneOf` 的 schema 未核实）。

## 4. 没有核实的地方

- ZCode：`@ai-sdk/openai-compatible` ^2.0.58 是否把非空 reasoning part 序列化为 `reasoning_content`（refs 中无 node_modules）；流空闲超时默认值 `DEFAULT_MODEL_STREAM_IDLE_TIMEOUT_MS` 的数值；chat 路径下是否发送 `parallel_tool_calls`。
- DreamCoder：DeepSeek/opencode.ai 端点是否接受 `thinking:{type:"adaptive"}`；DeepSeek 原生端点的缓存命中字段名是否导致 cache_read 为 0；各提供方在未设置 max_tokens 时的默认上限；billing 行导致缓存失配的实际 token 影响（未测量）；WebSearch 在代理场景下的后端选择（`resolveWebSearchProvider`）属于工具维度，未追。
- Codex：回退元数据下用户显式设置 `model_reasoning_effort` 时是否原样发送（`resolve_reasoning_effort` 未逐行核对）；外部网关后接 chat-only 提供方的实际行为（仓库外）。
- 所有数字（重试次数、上限、窗口）来自源码常量，未运行验证。
