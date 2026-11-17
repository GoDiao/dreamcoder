# 代理层评审：响应方向（P-RES）

范围：从提供方返回的字节，到 CLI 收到的 Anthropic 格式响应（流式与非流式），以及 CLI、服务端、桌面端对它的后续处理。上游格式 `openai_chat` 与 `openai_responses`。

路径约定：DreamCoder 路径相对仓库根；`codex:` 相对 `refs/coding-agents/codex/codex-rs`；`zcode:` 相对 ZCode 仓库根。全部为静态阅读；唯一运行的是现有测试 `bun test src/server/__tests__/proxy-streaming.test.ts`（31 通过）。ZCode 依赖的 Vercel AI SDK 源码不在本地，凡是 AI SDK 内部行为一律标「未核实」。

## 1. 发现清单

### P-RES-01 上游没给 usage 时代理写 0，CLI 的上下文估算以 0 为基准，自动压缩不会触发

- 类型：问题
- 严重程度：高
- 现状：
  1. chat 流：`message_start` 的 usage 固定为 0（src/server/proxy/streaming/openaiChatStreamToAnthropic.ts:178）。收到 `finish_reason` 时，只认 chunk 顶层的 `usage`，没有就把 `message_delta` 暂存（:446-462）；之后只有 `choices` 为空的 chunk 能补 usage（:297-301）。流结束仍没有 usage，就发出暂存的 `message_delta`，其 usage 为 `mapUsage(undefined)` = `{input_tokens:0, output_tokens:0}`（:512-516；src/server/proxy/transform/openaiChatToAnthropic.ts:82-84）。
  2. Responses 流：usage 只来自 `response.completed`/`response.incomplete`（src/server/proxy/streaming/openaiResponsesStreamToAnthropic.ts:318-341）；没收到这两个事件时根本没有 `message_delta`，消息的 usage 保持 `message_start` 的 0（:131）。
  3. CLI：每个内容块在 `content_block_stop` 时生成一条消息，usage 来自 `message_start`（src/services/api/claude.ts:2221-2262）；`message_delta` 只把 usage 写到最后一条（:2294-2297）。
  4. `getTokenUsage` 只要消息有 `usage` 字段就返回它，不管是不是全 0（src/utils/tokens.ts:7-20）；`tokenCountWithEstimation` 取最近一条带 usage 的助手消息作基准，再加其后消息的粗估（:244-285）。基准为 0 时，结果只等于最后几条消息的粗估。
  5. 自动压缩用这个数判断阈值（src/services/compact/autoCompact.ts:210）。
- 场景：自定义 provider，`openai_chat`，Moonshot（Kimi）OpenAI 兼容端点。按 Moonshot 公开文档，流式 usage 放在最后一个 chunk 的 `choices[0].usage` 里，而不是 chunk 顶层（推断，依据外部文档，未在运行时核实）。代理读不到 → 每个回复 usage 全 0 → `tokenCountWithEstimation` 每轮都只算最后几条消息 → 对话长到超过窗口也不压缩 → 上游返回超长 400；CLI 不认 OpenAI 风格的超长错误（已有报告 Q7），会话卡死。同样的结果也出现在：中转站去掉 `stream_options` 不回 usage；Responses 流在 `response.completed` 前被关闭（见 P-RES-04）。桌面端的用量面板和上下文估算会跳过全 0 记录（src/server/services/sessionService.ts:883, 985-993），只是显示偏旧，不会报错。
- 参考：
  - ZCode：usage 的 input 不大于 0 时不作为基准（zcode:apps/zcode-cli/packages/core/src/agent/message-history-usage.ts:14-16），继续往前找有效 usage（zcode:apps/zcode-cli/packages/core/src/runtime/methods/turn-model-step-usage.ts:62-72），找不到就整段本地估算（zcode:apps/zcode-cli/packages/core/src/compact/policy.ts:104-106）。是否读取 `choices[0].usage` 取决于 AI SDK（未核实）。
  - Codex：usage 只来自 `response.completed`（codex:codex-api/src/sse/responses.rs:134-137）；流在 completed 之前结束按错误处理并重试（:574-579），不会留下 0 用量的回复。
- 改法方向：代理在 chunk 顶层没有 usage 时也读 `choices[0].usage`；没有任何 usage 时不要写 0，而是不带 input/output 字段或带一个能被识别为“未知”的值；CLI 的 `getTokenUsage`/`tokenCountWithEstimation` 把全 0 的 usage 当作没有，退回整段估算。
- 确定程度：CLI 链路代码确认；Kimi 的 usage 位置推断。

### P-RES-02 提供方要求回传的推理数据在响应方向就被丢弃（Gemini 的 thought_signature、OpenRouter 的 reasoning_details、Responses 的 encrypted_content）

- 类型：问题
- 严重程度：高（Gemini 3 场景成立时功能失效；其余为推理质量和 token 损失）
- 现状：
  1. chat 流：推理只取 `reasoning_content`、`reasoning`、`thinking_blocks[0]`（openaiChatStreamToAnthropic.ts:246-268），签名只来自 `thinking_blocks`，其余情况签名为空串（:248, 252）。工具调用只读 `index`、`id`、`function.name`、`function.arguments`（:387-431），`tool_calls[].extra_content` 不读。`reasoning_details` 不读（全仓 grep 无匹配）。
  2. chat 非流式同样只读这三个字段，工具调用只取 id/name/arguments（openaiChatToAnthropic.ts:18-45）。
  3. Responses 流不处理 `response.output_item.done`，reasoning item 只把 summary 文本变成 thinking 块（openaiResponsesStreamToAnthropic.ts:268-305）；非流式也只取 `summary[].text`（openaiResponsesToAnthropic.ts:67-79）。请求里 `store:false`（src/server/proxy/transform/anthropicToOpenaiResponses.ts:21），全仓没有 `include: ["reasoning.encrypted_content"]`。
- 场景：
  - 自定义 provider，`openai_chat`，Gemini 的 OpenAI 兼容端点，模型 Gemini 3 Pro。按 Google 文档，函数调用的思考签名放在 `tool_calls[].extra_content.google.thought_signature`，当前回合的函数调用缺签名时请求返回 400（推断，依据外部文档）。第一步模型调用 Read → 代理丢掉签名 → 第二步带着工具结果的请求缺签名 → 400，工具循环无法继续。
  - OpenRouter（`openai_chat`）上的 Gemini 3、Claude、OpenAI 推理模型：OpenRouter 要求在工具调用循环中回传 `reasoning_details` 才能保留推理（推断，依据外部文档）；DreamCoder 只保留 `reasoning` 文本，签名和加密推理丢失。
  - OpenAI GPT-5 系列经 `openai_responses`（以及 ChatGPT 登录路径，它复用同一个流转换器：src/services/openaiAuth/fetch.ts:101）：`store:false` 又不请求 `encrypted_content`，工具调用之间推理全部丢失，模型每步重新推理，输出 token 和延迟上升（推断）。
- 参考：
  - Codex：请求总带 `include: ["reasoning.encrypted_content"]`（codex:core/src/client.rs:1075），从 `response.output_item.done` 取完整 item（codex:codex-api/src/sse/responses.rs:354-361）并在下一轮回传。
  - ZCode：adapters 里没有处理 `thought_signature`、`reasoning_details`、`encrypted_content` 的代码（grep 无匹配），依赖 AI SDK（未核实）。
- 改法方向：响应方向把这些不透明数据保存在 thinking 块的 `signature` 或 tool_use 块的附加字段里（Anthropic 格式能原样存进转录）；请求方向（P-REQ 评审范围）再按上游格式写回。Responses 路径同时在请求里加 `include` 并读取 `output_item.done` 的 reasoning item。
- 确定程度：DreamCoder 不读这些字段为代码确认；各提供方的强制要求为推断。

### P-RES-03 上游流停滞时没有任何超时，回合一直挂着

- 类型：问题
- 严重程度：中
- 现状：
  1. 代理的流式请求只在收到响应头之前计时，拿到响应头就清掉定时器（src/server/upstream/client.ts:268-276）。
  2. 两个流转换器都在 `start()` 里循环 `reader.read()`，没有读超时（openaiChatStreamToAnthropic.ts:80-82；openaiResponsesStreamToAnthropic.ts:53-55）。
  3. 上游的 SSE 注释（keep-alive）被直接跳过，不向 CLI 转发任何事件（openaiChatStreamToAnthropic.ts:90）。
  4. CLI 的流空闲看门狗默认关闭，需 `CLAUDE_ENABLE_STREAM_WATCHDOG`（src/services/api/claude.ts:1924-1928）；SDK 的请求超时同样只覆盖到响应头（同处注释 :1918-1923）。服务端没有给 CLI 设置这个变量（`buildNetworkEnvironment` 只设 `API_TIMEOUT_MS` 和代理，src/server/services/networkSettings.ts:76-88）。
- 场景：中转站或提供方在输出到一半时卡住但不断开连接（TCP 仍在）。代理一直等 `reader.read()`，CLI 一直等事件，桌面端一直显示生成中，直到用户手动停止。
- 参考：
  - Codex：每次读 SSE 都套 `idle_timeout`（codex:codex-api/src/sse/responses.rs:557），默认 300 秒（codex:model-provider-info/src/lib.rs:68, 515-519），超时作为可重试的流错误（:582-586；codex:protocol/src/error.rs:445-460）。
  - ZCode：默认 600 秒（zcode:apps/zcode-cli/packages/contracts/src/config/index.ts:284），每次重试加 30 秒（zcode:apps/zcode-cli/packages/adapters/src/model/stream-idle-timeout.ts:5-24），在 runner-stream.ts:164 应用并归类为可重试（failure-classifier.ts:137）。
- 改法方向：在代理的两个流转换器里加读空闲超时，超时后发 SSE `error` 并取消上游；同时把上游的 keep-alive 注释转成 Anthropic 的 `ping` 事件，这样以后若开启 CLI 看门狗，也不会误杀只发 keep-alive 的长推理。
- 确定程度：代码确认。

### P-RES-04 上游在结束标记之前正常关闭连接，被当成正常结束，回答被截断且不重试

- 类型：问题
- 严重程度：中
- 现状：
  1. chat 流：`reader.read()` 返回 done 后进入 `finalizeStream`（openaiChatStreamToAnthropic.ts:81-82, 135-140）。只要之前有过合法 chunk，就关闭所有块并补一个 `stop_reason: end_turn`、`output_tokens: 0` 的 `message_delta` 和 `message_stop`（:508-527）。没有收到 `finish_reason` 与收到 `stop` 无法区分。
  2. Responses 流：读完后直接 `controller.close()`（openaiResponsesStreamToAnthropic.ts:105），没有 `message_delta`、没有 `message_stop`，未收到 `.done` 的文本块和工具块也不关闭。
  3. CLI：只有“没有 message_start”或“没有完成任何块且没有 stop_reason”才判为异常并回退（src/services/api/claude.ts:2400-2413）。chat 路径补了 end_turn，Responses 路径已关闭的块已经产出消息，两种情况都通过检查，回合按正常结束处理。
- 场景：经中转站（反向代理有读超时）调用 DeepSeek 推理模型，长回答输出到一半时中转站正常关闭分块响应。用户看到半截回答、没有任何提示；如果截在工具参数中间，工具块被关闭，参数 JSON 不完整，CLI 解析成 `{}` 后执行（见 P-RES-07）。用量为 0（见 P-RES-01）。
- 参考：
  - Codex：`Ok(None)`（流结束）而没有 `response.completed` 时报 “stream closed before response.completed”（codex:codex-api/src/sse/responses.rs:574-579），属可重试错误（codex:protocol/src/error.rs:445）。
  - ZCode：没有 finish 事件时的处理在 AI SDK 内（未核实）；流中断后由 streamRecovery 重发（zcode:apps/zcode-cli/packages/core/src/runtime/methods/streaming-recovery.ts:24-40）。
- 改法方向：chat 流在没有收到 `finish_reason`（也没有 `[DONE]`）就结束时、Responses 流在没有 `response.completed/incomplete` 就结束时，发 SSE `error`（“上游流提前结束”），让 CLI 走现有的重试路径。
- 确定程度：代码确认。

### P-RES-05 finish_reason 映射过粗：内容过滤、资源不足、上下文用满都变成 end_turn；Responses 的内容过滤变成 max_tokens

- 类型：问题
- 严重程度：中
- 现状：
  1. chat（流式与非流式相同）：`stop`→end_turn，`tool_calls`→tool_use，`length`→max_tokens，`content_filter` 与其他任何值→end_turn；出现过工具调用时 end_turn 改为 tool_use（openaiChatStreamToAnthropic.ts:442-445, 530-538；openaiChatToAnthropic.ts:65-78）。缺失 `finish_reason` 时见 P-RES-04。
  2. Responses：`completed`→end_turn/tool_use，`incomplete`→max_tokens（不看 `incomplete_details.reason`），`failed`/`cancelled`→end_turn（openaiResponsesStreamToAnthropic.ts:325-327；openaiResponsesToAnthropic.ts:83-91）。
  3. CLI 对 `max_tokens` 生成“超过 32000 输出上限”的错误消息并进入最多 3 次的续写恢复（claude.ts:2316-2327；src/query.ts:1173-1234）；对 `model_context_window_exceeded` 有专门提示并复用续写恢复（claude.ts:2329-2341）；对 `refusal` 给出拒答提示（:2308-2314，文案指向 Anthropic 使用政策，src/services/api/errors.ts:1194-1196）；对 end_turn 不做任何提示。
- 场景：
  - Azure OpenAI 或 Qwen（DashScope，预设）在输出中途触发内容审核，`finish_reason: "content_filter"` → end_turn，用户只看到半截回答，没有任何提示。
  - 自定义 provider 直连智谱 `/api/paas/v4`（`openai_chat`）：`sensitive`（审核）、`network_error`（推理错误）、`model_context_window_exceeded` 都成了 end_turn；最后一种本应触发 CLI 已有的上下文用满处理。
  - DeepSeek 的 OpenAI 端点（`openai_chat`，代码专门支持该域名：src/server/upstream/client.ts:251-256）返回 `insufficient_system_resource`（服务端资源不足中断）→ end_turn，截断且不重试。
  - OpenAI 经 `openai_responses`，`response.incomplete` 且 `reason: "content_filter"` → max_tokens → CLI 显示“超过输出上限”并发送续写提示，重复撞同一个过滤。
  以上 provider 特有取值来自各家公开文档（推断）。
- 参考：
  - Codex：`incomplete` 时读 `incomplete_details.reason`，`content_filter` 报 ContentFilter，非 `interrupted` 报 ResponseIncomplete（codex:codex-api/src/sse/responses.rs:419-448）。
  - ZCode：保留原始 finish reason；把 `content_filter`/`sensitive` 识别为内容过滤并报不可重试的错误（zcode:apps/zcode-cli/packages/core/src/runtime/helpers/model-errors.ts:27-72），把 `model_context_window_exceeded` 等识别为上下文超限（:252-260）或输出截断（zcode:apps/zcode-cli/packages/core/src/runtime/methods/turn-output-token-continuation.ts:29-33），`network_error` 归为可恢复的网络错误（zcode:apps/zcode-cli/packages/core/src/runtime/methods/streaming-recovery.ts:34-40）。
- 改法方向：映射表补上这些取值：上下文用满类映射到 `model_context_window_exceeded`；内容过滤类映射成一个 CLI 能显示中性提示的结果（不要复用指向 Anthropic 政策的 refusal 文案）；资源不足、`network_error` 类转成 SSE `error` 以便重试；Responses 的 `incomplete` 按 `incomplete_details.reason` 区分。
- 确定程度：映射为代码确认；各 provider 取值为推断。

### P-RES-06 流中途的上游错误丢掉错误码和状态，CLI 一律改走非流式请求，长回答在 120 秒总时长内完不成

- 类型：问题
- 严重程度：中
- 现状：
  1. chat 流里的 `error` 对象只取 `message`（openaiChatStreamToAnthropic.ts:486-491），之后只发一个 SSE `error`，类型固定 `api_error`（:497-505）；Responses 的 `response.failed`/`error` 同样只取 message（openaiResponsesStreamToAnthropic.ts:15-21, 307-316）。上游的 `code`（如 `context_length_exceeded`、`rate_limit_exceeded`）丢失。
  2. SDK 遇到 SSE `error` 抛出没有状态码的 `APIError`（主检出 node_modules/@anthropic-ai/sdk/core/streaming.js:99-103）。
  3. CLI 的流错误处理：不是用户取消就改走非流式请求（claude.ts:2519-2601），已产出的部分消息被替换（src/query.ts:713-726）。
  4. 非流式请求的总时长：CLI 用 `API_TIMEOUT_MS`（claude.ts:806-810），服务端把它设为网络设置里的值，默认 120 秒（networkSettings.ts:13, 77）；代理的非流式 fetch 也用同一个值，并且覆盖读取整个响应体（client.ts:63, 264-265）。超时后代理返回 502（handler.ts:66-71），CLI 按 5xx 重试（src/services/api/withRetry.ts:784）。
- 场景：
  - 经 OpenRouter（`openai_chat`）用推理模型写长回答，第 90 秒时下游提供方出错，OpenRouter 在流里发 `{"error":{...}}`。CLI 丢掉已输出内容，改发非流式请求；推理加输出要 3 分钟，每次在 120 秒时被代理和 CLI 同时掐断，返回 502，CLI 再重试，最多 10 次，每次都是一次完整的上游计费请求（推断：上游被中断后是否计费因提供方而异）。
  - OpenAI 经 `openai_responses`，`response.failed` 带 `code: "context_length_exceeded"`（Codex 测试里的真实负载：codex:codex-api/src/sse/responses.rs:1159）：CLI 不知道是超长，先改发一次非流式请求，再收到 400 文本错误，也不会触发压缩。
- 参考：
  - Codex：按 `code` 分类为上下文超限、额度不足、限流（带从文本解析的重试等待）等（codex:codex-api/src/sse/responses_error.rs:26-80）；流错误按回合层重试仍用流式（codex:core/src/responses_retry.rs）。
  - ZCode：识别业务错误码和 finish 中的错误（zcode:apps/zcode-cli/packages/adapters/src/model/provider-finish-business-error.ts:15-62），流中断后用流式重发（streaming-recovery.ts）。
- 改法方向：代理把上游错误的 `code`/`type` 映射为对应的 Anthropic 错误类型（如上下文超限映射为 `invalid_request_error` 并使用 CLI 认得的超长文本，限流映射为 `rate_limit_error`）；在服务端启动 CLI 时设置 `CLAUDE_CODE_DISABLE_NONSTREAMING_FALLBACK`（claude.ts:2519-2523 已支持），让流错误直接交给 withRetry 用流式重试。
- 确定程度：代码确认；计费影响推断。

### P-RES-07 被截断或损坏的工具参数在 CLI 里变成 `{}`，模型看到“缺参数”而不是“参数被截断”

- 类型：问题
- 严重程度：中
- 现状：
  1. 流式路径把参数片段原样作为 `input_json_delta` 转发（openaiChatStreamToAnthropic.ts:420-428；openaiResponsesStreamToAnthropic.ts:227-239），不在代理侧校验。
  2. CLI 在 `content_block_stop` 解析；JSON 无效时记一条分析事件，参数变成 `{}`（src/utils/messages.ts:2770-2789）。
  3. 工具执行前 zod 校验失败，回给模型 `InputValidationError: ... required`（src/services/tools/toolExecution.ts:616-671）。转录和下一轮请求里，这次调用的参数是 `{}`。
  4. 非流式路径则是 `{raw: 原文}`（src/server/proxy/transform/toolArguments.ts:10-16），与流式不一致。
  5. `length` 时，即使有工具调用也只映射为 max_tokens（openaiChatStreamToAnthropic.ts:534）；CLI 有 tool_use 时照常执行工具（已有报告 Q5）。
- 场景：DeepSeek OpenAI 端点（`openai_chat`），代理不转发 `max_tokens`（已有结论），上游用自身默认输出上限。模型用 Write 写一个大文件，参数在 `content` 中间被 `length` 截断 → CLI 得到 `{}` → 返回 “file_path is required” 一类错误 → 模型以为自己漏了参数，再次用同样长的内容重试，再次截断，循环。
- 参考：
  - Codex：参数解析失败时把 `failed to parse function arguments: <错误>` 回给模型（codex:core/src/tools/handlers/mcp_resource.rs:378）。
  - ZCode：同样降级为 `{}` 并记录警告（zcode:apps/zcode-cli/packages/adapters/src/model/tool-input-normalization.ts:31-47），但请求里明确发送输出上限（已有报告 Q5），且有工具调用时不做续写（turn-output-token-continuation.ts:44）。
- 改法方向：CLI 在参数 JSON 解析失败时不再执行工具，而是回给模型一个说明“参数 JSON 不完整（可能因输出上限被截断），请分小块重试”的错误结果；非流式路径与流式统一。
- 确定程度：代码确认；DeepSeek 默认上限导致截断为推断。

### P-RES-08 同一个 delta 同时带正文、推理或工具调用时，只处理其中一种，其余被丢弃

- 类型：问题
- 严重程度：中
- 现状：`detectBlockTransition` 按 tool_calls → content → reasoning 的顺序只返回一种类型（openaiChatStreamToAnthropic.ts:270-292），`processChunk` 只调用对应的一个处理函数（:320-330）。同一 delta 里的其余字段直接丢弃。
- 场景：
  - 自部署 vLLM 开启 `--reasoning-parser` 运行 Qwen3 或 DeepSeek-R1（`openai_chat`）：推理结束的那个 chunk 同时带 `reasoning_content` 的结尾和 `content` 的开头时，推理结尾被丢掉（推断，依据 vLLM 推理解析器按 delta 同时返回两段的实现）。
  - 网关的伪流式模式把整个回复放进一个 chunk（`content` + `tool_calls`）：正文全部丢失，只剩工具调用（推断）。
- 参考：
  - Codex：只支持 Responses，事件本身按类型分开，不适用。
  - ZCode：AI SDK 的 openai-compatible 对同一 delta 依次处理推理、正文、工具调用（未核实）。
- 改法方向：`processChunk` 对同一 delta 依次处理 reasoning、content、tool_calls 三类字段，每类按现有的块切换规则开关块。
- 确定程度：丢弃行为代码确认；触发它的上游为推断。

### P-RES-09 Responses 流转换只依赖增量事件，不读完整 item，也不在结束时关闭文本和工具块

- 类型：问题
- 严重程度：低
- 现状：
  1. 文本增量必须先有 `response.content_part.added` 建立索引，否则丢弃（openaiResponsesStreamToAnthropic.ts:176-209）。
  2. 工具块只在 `response.function_call_arguments.done` 关闭，文本块只在 `output_text.done` 关闭（:241-266）；`response.completed` 只关闭推理块（:329-335）。
  3. `output_item.added` 里已有的 `arguments`、`.done` 事件里的完整 `arguments`/`text`、`response.output_item.done` 都不读（:151-174, 256-266）。
  4. `response.created` 读 `data.model`，而事件里模型在 `data.response.model`（:145-146），所以总是沿用请求的模型名。
- 场景：第三方 Responses 兼容服务若不发 `content_part.added` 或只在 `.done` 里给完整参数，正文丢失或工具参数为 `{}`；若漏发 `.done`，块从不关闭，CLI 不会为它产出消息（claude.ts:2221-2262 只在 stop 时产出）。目前能确认的上游只有 OpenAI 官方，它会发全部事件；第三方的行为未核实，因此定为低。
- 参考：Codex 以 `response.output_item.done` 的完整 item 为准（codex:codex-api/src/sse/responses.rs:354-361），文本增量不依赖 content_part 事件（:362-366）。ZCode 由 AI SDK 处理（未核实）。
- 改法方向：文本增量在没有索引时自动开块；`response.completed` 时关闭所有仍开着的块；用 `output_item.done` 的完整 item 补齐缺失的参数（也为 P-RES-02 取 reasoning item 提供入口）。
- 确定程度：代码确认；第三方触发推断。

### P-RES-10 正文里的 `<think>` 标签原样当作回答

- 类型：优化
- 严重程度：低
- 现状：chat 流与非流式只从专用字段取推理（openaiChatStreamToAnthropic.ts:246-268；openaiChatToAnthropic.ts:18-30），`content` 原样成为 text 块（:358-368；:32-34）。服务端标题生成也直接用 text（src/server/services/titleService.ts:95-100）。
- 场景：MiniMax M2 的 OpenAI 兼容端点（自定义 provider，`openai_chat`）默认把推理以 `<think>…</think>` 放进 `content`（推断，依据 MiniMax 文档）。桌面端把推理当回答显示；子代理最终报告带着推理文本交给主代理；标题可能取到推理内容。回传给上游时推理保留在正文里，这一点符合 MiniMax 的建议，不需要改变回传。
- 参考：Codex 无。ZCode 主路径无；仅在标题和输入预测里去掉 `<think>` 段（zcode:apps/zcode-cli/packages/core/src/runtime/methods/title-generation-sidecar.ts:267）。
- 改法方向：至少在标题生成里去掉 `<think>` 段；是否在显示层折叠该段由产品决定。
- 确定程度：代码确认；MiniMax 默认格式推断。

### P-RES-11 缓存命中只读 `prompt_tokens_details.cached_tokens`

- 类型：优化
- 严重程度：低
- 现状：`mapUsage` 只读 `prompt_tokens_details.cached_tokens`（openaiChatToAnthropic.ts:85）；Responses 只读 `input_tokens_details.cached_tokens`（openaiResponsesToAnthropic.ts:38）。CLI 把 `cache_read_input_tokens` 计入上下文和费用（src/utils/tokens.ts:46-53），桌面端单列“缓存读/写”（desktop/src/components/chat/LocalSlashCommandPanel.tsx:291）。
- 场景：DeepSeek OpenAI 端点用 `prompt_cache_hit_tokens` 报告命中；若它不同时返回 `prompt_tokens_details.cached_tokens`，缓存读恒为 0，全部算作普通输入（是否同时返回未核实）。Moonshot 用顶层 `usage.cached_tokens`（推断）。只影响显示和估算费用，上下文总量不变（input 未扣除缓存，总和相同）。
- 参考：ZCode 由 AI SDK 归一化（未核实）。Codex 只读 Responses 的 `cached_tokens`（codex:codex-api/src/sse/responses.rs:134）。
- 改法方向：`mapUsage` 依次读 `prompt_tokens_details.cached_tokens`、`prompt_cache_hit_tokens`、`cached_tokens`。
- 确定程度：代码确认；提供方字段推断。

### P-RES-12 有合法 chunk 但没有任何内容的回复，CLI 静默结束

- 类型：优化
- 严重程度：低
- 现状：chat 流里只要出现过带 `choices` 的 chunk 就算合法（openaiChatStreamToAnthropic.ts:121），结束时发 end_turn（:518-527）。CLI 的空流检查要求“没有块且没有 stop_reason”（claude.ts:2400），此时 stop_reason 已是 end_turn，检查不触发，本次请求不产出任何助手消息。
- 场景：中转站或高负载的提供方返回只有 `role` 的 chunk 加 `finish_reason: stop`，没有正文也没有工具调用。回合结束，用户看不到任何回复，也没有错误（推断：query.ts 对零条助手消息的后续处理未逐行核实）。
- 参考：ZCode 在“无正文、无工具调用、无 usage”时重试 1 次（zcode:apps/zcode-cli/packages/adapters/src/model/empty-completion-retry.ts:8-31），排除内容过滤与上下文超限（runner-diagnostics.ts:438-450）。Codex 未找到对应处理。
- 改法方向：代理在“有 chunk 但无任何内容块且无 usage”时发 SSE `error`，交给 CLI 的回退或重试。
- 确定程度：代理与 CLI 检查为代码确认；CLI 最终表现推断。

### P-RES-13 用户取消在非流式请求和流式响应头到达之前传不到上游

- 类型：问题
- 严重程度：低
- 现状：`handleProxyRequest` 调 `sendToUpstream` 时不传 `req.signal`（src/server/proxy/handler.ts:64）；`sendToUpstream` 只用超时信号（src/server/upstream/client.ts:70-75, 264-276）。流开始之后的取消可以传到上游（流转换器的 `cancel` 取消上游 body，openaiChatStreamToAnthropic.ts:143-146，有测试 src/server/__tests__/proxy-streaming.test.ts:613-637）。
- 场景：P-RES-06 的非流式回退进行中，用户点停止。CLI 断开与代理的连接，代理对上游的请求继续，直到上游生成完或 120 秒超时，这段生成照常计费。
- 参考：Codex 在接收方关闭时停止读取（codex:codex-api/src/sse/responses.rs:555-556）。ZCode 把父级 abort 信号连到模型请求（zcode:apps/zcode-cli/packages/adapters/src/model/stream-idle-timeout.ts:63-80）。
- 改法方向：把 `req.signal` 与超时信号合并后传给上游 fetch。
- 确定程度：代码确认；Bun 在客户端断开时触发 `req.signal` 为推断。

### P-RES-14 SSE 解析不完全按规范

- 类型：优化
- 严重程度：低
- 现状：
  1. 两个转换器都要求 `data: ` 带空格（openaiChatStreamToAnthropic.ts:98；openaiResponsesStreamToAnthropic.ts:69），`event:` 同样要求空格（:64）。SSE 规范允许冒号后无空格。
  2. 一个事件多行 `data:` 不拼接，每行单独解析。
  3. chat 能识别 200 状态下的非 SSE JSON 错误体，但只限单行 JSON（:98-101, 128-131）；多行格式化的错误体识别不到，最终报“没有合法 chunk”，原错误信息丢失。Responses 转换器没有这项识别。
- 场景：本次没能确认哪个提供方发 `data:` 无空格或格式化的错误体（未核实），所以只作为健壮性改进。
- 参考：Codex 用 eventsource 解析器（codex:codex-api/src/sse/responses.rs:548）；ZCode 用 AI SDK 的 SSE 解析（未核实）。
- 改法方向：两个转换器共用一个按规范实现的 SSE 分帧函数（处理可选空格、多行 data、空行分隔），并在非 SSE 响应时整体解析响应体以取错误信息。
- 确定程度：代码确认。

### P-RES-15 响应里的模型名来源不一致

- 类型：优化
- 严重程度：低
- 现状：chat 流用上游 chunk 的 `model` 覆盖（openaiChatStreamToAnthropic.ts:304），非流式用 `response.model`（openaiChatToAnthropic.ts:56；openaiResponsesToAnthropic.ts:28），Responses 流实际总用请求的模型名（见 P-RES-09 第 4 点）。这个名字写进转录的 `message.model`，桌面端按它分模型统计并查上下文窗口（src/server/services/sessionService.ts:897, 1000-1015）。
- 场景：OpenAI 经 `openai_chat` 请求 `gpt-4.1`，响应里返回带日期的快照名（推断），桌面用量面板按另一个名字分组，上下文窗口查表可能落到默认值。
- 参考：Anthropic 原生 API 在 message_start 里返回请求的模型 id；Codex 把服务端模型名作为单独事件上报（codex:codex-api/src/sse/responses.rs:609-619），不替换会话模型。
- 改法方向：Anthropic 消息里的 `model` 统一用请求的模型名。
- 确定程度：代码确认；OpenAI 返回快照名推断。

## 2. 已知结论的核实

- 「流式里不带 id 的 tool_call 被丢弃」：确认（openaiChatStreamToAnthropic.ts:405，`block.id && block.name` 才开块）。补充：被丢弃的调用不设 `sawToolUse`，参数缓冲随之丢失；若上游 `finish_reason` 为 `tool_calls`，CLI 收到 `stop_reason: tool_use` 却没有 tool_use 块，回合直接结束（CLI 以块是否存在决定是否继续）。非流式路径不丢弃，而是生成 `id: undefined` 的 tool_use（openaiChatToAnthropic.ts:38-43），两条路径不一致。本次未能确认哪个提供方不发 id，故未列为发现。
- 「上游错误统一包成 `api_error`，响应头被丢弃」：HTTP 非 2xx 部分确认（handler.ts:66-71；client.ts:83-89）。流内错误同样确认，且错误码也被丢弃（见 P-RES-06）。
- 「`reasoning_content` 只对 deepseek 和 opencode.ai 写回」：属于请求方向。响应方向核实：所有域名的 `reasoning_content`/`reasoning`/`thinking_blocks` 都会转成 thinking 块并进入转录（openaiChatStreamToAnthropic.ts:246-268），丢失发生在下一轮请求转换时；另外签名、`reasoning_details`、`extra_content` 在响应方向就没有保存（见 P-RES-02）。
- 已有报告「流截断（无 finish_reason）补 end_turn」：确认，并补充其后果，列为 P-RES-04。
- 已有报告「代理在流结束时总会补 end_turn，所以合法但空的回复不会触发 CLI 空流分支」：需要修正。chat 流若一个合法 chunk 都没有，代理发的是 SSE `error`（openaiChatStreamToAnthropic.ts:497-505），CLI 走非流式回退；只有出现过合法 chunk 时才补 end_turn，此时空回复确实不触发空流分支（P-RES-12）。Responses 流不补 end_turn，没有 completed 且没有完成的块时会触发空流分支，有完成的块时不触发（P-RES-04）。
- 已有报告「DeepSeek 的 `prompt_cache_hit_tokens` 未处理」：确认代码不读（P-RES-11）；DeepSeek 是否同时返回 `prompt_tokens_details.cached_tokens` 未核实，影响可能比已有报告估计的小。
- 已有报告「非流式参数解析失败得 `{raw}`，流式得 `{}`」：确认（toolArguments.ts:10-16；src/utils/messages.ts:2770-2789），并扩展为 P-RES-07。
- 已有报告「流空闲看门狗默认关闭」：确认（claude.ts:1924-1928），服务端也没有开启它（networkSettings.ts:76-88），扩展为 P-RES-03。
- 「`stream_options.include_usage` 是否请求」：流式 chat 总是请求（src/server/proxy/transform/anthropicToOpenaiChat.ts:38）。

## 3. 覆盖范围

完整阅读：
- src/server/proxy/streaming/openaiChatStreamToAnthropic.ts
- src/server/proxy/streaming/openaiResponsesStreamToAnthropic.ts
- src/server/proxy/streaming/openaiResponsesStreamToAnthropicResponse.ts
- src/server/proxy/transform/openaiChatToAnthropic.ts
- src/server/proxy/transform/openaiResponsesToAnthropic.ts
- src/server/proxy/transform/toolArguments.ts
- src/server/proxy/handler.ts
- src/server/upstream/client.ts

部分阅读：src/services/api/claude.ts（流事件处理 1900-2420、错误与回退 2470-2720、非流式请求 800-900、updateUsage 2977-3080）；src/utils/tokens.ts；src/utils/messages.ts（工具参数解析）；src/services/tools/toolExecution.ts（输入校验）；src/services/api/withRetry.ts（shouldRetry）；src/services/api/errors.ts（refusal）；src/server/services/sessionService.ts（用量与上下文估算）；src/server/api/sessions.ts；src/server/services/networkSettings.ts；src/server/services/titleService.ts；src/services/openaiAuth/fetch.ts；desktop/src/components/chat/LocalSlashCommandPanel.tsx；src/server/__tests__/proxy-streaming.test.ts（并运行，31 通过）。参考实现：codex:codex-api/src/sse/responses.rs、responses_error.rs、protocol/src/error.rs 相关段；ZCode adapters 的 stream-idle-timeout、stream-retry-boundary、streaming-tool-call-assembler、provider-finish-business-error、empty-completion-retry、tool-input-normalization，以及 core 里 finish reason、压缩基准相关文件。

未覆盖：
- 任何提供方的真实响应（不做网络请求）；文中各提供方的字段和取值来自公开文档，均标推断。
- AI SDK（`@ai-sdk/openai-compatible`、`@ai-sdk/openai`）源码不在本地，ZCode 在 SDK 层的 SSE 解析、tool call id 缺失处理、usage 归一化未核实。
- 桌面端和 H5 页对 thinking 块、空签名、`<think>` 文本的渲染细节；会话中途从 openai 格式 provider 切到 Anthropic provider 时空签名 thinking 块的处理。
- ChatGPT 登录路径（src/services/openaiAuth）只看了它复用流转换器这一点，请求构造与非流式聚合未评审。
- 请求方向见 [request.md](request.md)，非 2xx 错误映射见 [transport.md](transport.md)。
