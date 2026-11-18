# 代理层评审：传输、容错与提供方配置（P-NET）

范围：请求怎样到达提供方再回来、失败时发生什么、DreamCoder 对每个提供方和模型知道什么。DreamCoder 路径相对仓库根；`codex:` 相对 `refs/coding-agents/codex/codex-rs`；`zcode:` 相对 `refs/coding-agents/zcode`。

运行验证说明：没有向任何模型提供方发请求。为确认 Bun 运行时行为，在本地用 Bun 1.4.2（项目使用的版本）跑了几个只连 127.0.0.1 的小实验（脚本未收入仓库）：
- `idle.ts`：`Bun.serve` 的 `idleTimeout` 会切断「处理函数还没返回响应」的请求，也会切断「已发出部分数据后停顿」的流式响应，并调用流的 `cancel()`。
- `timeout0.ts`：在处理函数里调用 `server.timeout(req, 0)` 后，同样的慢请求正常完成。
- `cancel.ts`：仿照代理的结构（`start()` 循环读上游、`cancel()` 里 `reader.cancel()`）。客户端在流开始后中止，上游连接立即被中止；客户端在上游返回响应头之前中止，上游请求继续跑到响应头到达后才被中止。
- `proxyopt.ts`：Bun `fetch` 的 `proxy` 选项对 `http://127.0.0.1:<port>` 也会走代理；设置 `NO_PROXY=127.0.0.1` 后直连。
- `msg.ts`：按 SDK 的拼接规则模拟代理返回的 429，确认 CLI 显示的内容（见 P-NET-03）。

## 1. 发现清单

### P-NET-01 本地 Bun 服务的 60 秒空闲超时会切断走代理的请求，导致重试和重复计费

- 状态：已在 #262 修复：代理处理函数对每个请求调用 `server.timeout(req, 0)`。更正：#262 实测 Bun 1.4.2 下，POST 请求在处理函数返回响应之前，即使沉默 70 秒也不会被 60 秒的 `idleTimeout` 切断（GET 会）；会被切断的是流式响应发出后中途停顿的情况。所以第 2、6 步里「非流式请求也受 60 秒限制」不成立。另外 `idleTimeout` 的计时粒度约 4 秒。
- 类型：问题
- 严重程度：高
- 现状：
  1. 服务端用 `Bun.serve({ idleTimeout: 60 })` 启动（src/server/index.ts:152-155），`/proxy/` 路由和其他路由共用这个设置（src/server/index.ts:349-366）。
  2. 代理处理函数先 `await sendToUpstream(...)`，拿到上游响应头之后才返回 `Response`（src/server/proxy/handler.ts:64-85）。非流式请求要等上游完整返回（src/server/upstream/client.ts:103-116）。
  3. 流式转换器只在上游有可转换的数据时才向 CLI 写字节：chat 流跳过空行和 `:` 开头的注释行（src/server/proxy/streaming/openaiChatStreamToAnthropic.ts:88-90），Responses 流只处理 `event:`/`data:` 行（src/server/proxy/streaming/openaiResponsesStreamToAnthropic.ts:61-99）。代理自己不发心跳或 `ping` 事件。
  4. Responses 请求不设 `reasoning.summary`（src/server/proxy/transform/anthropicToOpenaiResponses.ts:17-60），所以 OpenAI 推理模型思考期间不会有 `reasoning_summary_text.delta` 事件（推断：依据 OpenAI 的事件语义）。
  5. 实验 `idle.ts` 证实：只要连续约 60 秒没有字节写给 CLI，不论处理函数是否已返回，Bun 都会关闭这条连接。
  6. CLI 收到连接关闭：响应头之前的失败按连接错误重试（src/services/api/withRetry.ts:753-755），最多 10 次；流中途断开则改发非流式请求（src/services/api/claude.ts:2552-2601），非流式请求也走代理、也受 60 秒限制。
  7. 设置里的「AI 请求超时」（5–600 秒，src/server/services/networkSettings.ts:13-15）同时传给代理和 CLI（`API_TIMEOUT_MS`，src/server/services/networkSettings.ts:76-78；src/services/api/client.ts:214）。在代理路径上，超过 60 秒的设置值不起作用。
- 场景：自定义提供方，`openai_responses`，OpenAI 官方 `gpt-5` 系列，任务较难，模型静默推理超过 60 秒。第 60 秒左右 Bun 关闭 CLI 的连接，转换器 `cancel()` 中止上游（推断：已产生的输入和推理 token 照常计费）。CLI 改发非流式请求，这次代理要等完整结果，60 秒时再被切断；而非流式的上游请求不会被中止（见 P-NET-02），会在提供方那边跑完并计费，代理拿到结果后无人接收。CLI 再按连接错误重试最多 10 次，每次都重复上述过程。另一个场景：OpenRouter 在排队或推理时发 `: OPENROUTER PROCESSING` 注释保活（推断：依据 OpenRouter 文档），代理把注释丢掉，CLI 一侧仍然 60 秒没有字节。流中途断开后改发非流式请求时，如果流式部分已经开始执行工具，可能重复执行同一工具（推断：claude.ts:2512-2518 的注释说明了这个风险）。
- 参考：Codex 的流空闲超时按提供方配置，默认 300 秒（codex:model-provider-info/src/lib.rs:68, 515-519），超时报 `idle timeout waiting for SSE`（codex:codex-api/src/sse/responses.rs:584），没有中间进程。ZCode 流空闲超时默认 600 秒（zcode:apps/zcode-cli/packages/contracts/src/config/index.ts:284），每次重试再加 30 秒（zcode:apps/zcode-cli/packages/adapters/src/model/stream-idle-timeout.ts:5-24），也没有中间进程。
- 改法方向：代理路由对每个请求调用 `server.timeout(req, 0)`（实验 `timeout0.ts` 证实可用），不再依赖全局 60 秒；上游静默时，代理按固定间隔向 CLI 写 Anthropic 的 `ping` 事件，并把上游的注释行当作活动信号；真正的空闲判定放在代理读上游的地方，用一个明确的、可配置的空闲超时（参考 Codex 300 秒）。
- 确定程度：代码确认；Bun 行为经本地实验确认；具体模型的静默时长为推断。

### P-NET-02 提供方的上下文溢出错误认不出来，会话卡死，手动 /compact 也救不回来

- 类型：问题
- 严重程度：高
- 现状：
  1. 上游返回 400，代理原样保留状态码，把上游响应体包进 `api_error` 的字符串字段（src/server/upstream/client.ts:83-90；src/server/proxy/handler.ts:66-71）。
  2. CLI 只用 `prompt is too long` 识别上下文溢出（src/services/api/errors.ts:560-573）；`parseMaxTokensContextOverflowError` 只认 Anthropic 文案（src/services/api/withRetry.ts:550-575）。400 不重试（withRetry.ts:696-786）。
  3. 没认出来时，用户看到通用的 `API Error: 400 {...}`（errors.ts 末尾的通用分支）。被动压缩在本构建里是 stub（前一份报告已确认，src/query.ts:15-17）。
  4. 手动 `/compact` 也要把整段历史发给模型，同样溢出。compact 有一条「截掉最早的消息再试」的路径，但它只在摘要结果以 `Prompt is too long` 开头时才触发（src/services/compact/compact.ts:449-480；src/services/api/errors.ts:62-64），所以也不触发。
  5. 自动压缩只按配置的上下文窗口提前触发；窗口配大了（见 P-NET-10），或一次工具输出很大，就会越过真实上限。
- 场景：Qwen 预设（`openai_chat`），模型的真实窗口比 DreamCoder 认定的 200,000 小。某次请求超过真实上限，DashScope 返回 400（文案含 `Range of input length should be`，见下面 ZCode 的匹配规则）。这一轮失败，下一轮带着更长的历史再次失败；用户执行 `/compact` 也失败，只能 `/clear` 或回退。各家的文案：OpenAI `context_length_exceeded`（Codex 测试数据，codex:codex-api/src/sse/responses.rs:1159）；DeepSeek 的 OpenAI 格式端点用 `maximum context length ... tokens`（推断）；智谱 BigModel 业务码 1261（zcode:apps/zcode-cli/packages/adapters/src/model/failure-provider-business-codes.ts:166-173）；Moonshot 是 `total message token length ... exceed ... model limit` 一类文案（推断：依据 ZCode 的匹配规则 zcode:apps/zcode-cli/packages/adapters/src/model/failure-inspection.ts:239-241）。直连路径（Kimi、智谱、DeepSeek 的 Anthropic 端点）的溢出文案是否为 `prompt is too long`，未核实。
- 参考：Codex 把 `context_length_exceeded` 映射为 `ContextWindowExceeded`，不重试（codex:codex-api/src/sse/responses_error.rs:48；codex:protocol/src/error.rs:434）。ZCode 按错误码和文案识别（`context_length_exceeded` 等 4 个码；`maximum context length`、`prompt is too long`、`range of input length should be`、`input token count ... maximum number of tokens allowed` 等短语，zcode:apps/zcode-cli/packages/adapters/src/model/failure-inspection.ts:212-245），400/422 时归为上下文超限（zcode:apps/zcode-cli/packages/adapters/src/model/failure-classifier.ts:229-244），由上层触发压缩（前一份报告：zcode:apps/zcode-cli/packages/core/src/runtime/internal-turn-methods.ts:191）。
- 改法方向：在代理里识别各家的溢出错误码和文案（可照 ZCode 的匹配表），改写成 Anthropic 形态：400、`invalid_request_error`、消息以 `prompt is too long` 开头，能解析出数字时带上 `N tokens > M maximum`，这样 CLI 现有的识别和 compact 的截头重试会生效；直连路径的识别放在 CLI 的 errors.ts，两处共用同一张匹配表。
- 确定程度：代码确认（DreamCoder 一侧）；各提供方文案部分为推断。

### P-NET-03 代理转发错误时把原因转义进字符串、丢掉响应头，429 时用户看不到原因

- 类型：问题
- 严重程度：中
- 现状：
  1. 上游非 2xx：代理读出响应体前 500 字，拼成 `Upstream returned HTTP <s>: <body>`，作为 `{type:'error', error:{type:'api_error', message}}` 返回，状态码沿用，上游响应头全部丢弃（src/server/upstream/client.ts:83-90；src/server/proxy/handler.ts:66-71）。网络错误和超时得到 502，消息为 `Request timed out (120s)` 或底层错误文本（client.ts:76-81；handler.ts:70）。
  2. SDK 生成错误消息时，响应体没有顶层 `message`，于是把整个 JSON 序列化为 `"<status> {json}"`（node_modules/@anthropic-ai/sdk/core/error.js，SDK 0.98.0，`makeMessage`）。上游原文在里面是转义过的字符串。
  3. CLI 的 429 分支用正则 `"message"\s*:\s*"([^"]*)"` 取内层消息（src/services/api/errors.ts:551-556）。第一处匹配是代理那层的 message，`[^"]*` 碰到转义引号就停。实验 `msg.ts` 的结果：用户看到 `API Error: Request rejected (429) · Upstream returned HTTP 429: {\`，原因丢失。
  4. 丢掉 `retry-after` 后，CLI 用自己的退避：0.5 秒起，翻倍，封顶 32 秒（src/services/api/withRetry.ts:530-548），不知道提供方要等多久。丢掉 `x-request-id` 后，无法拿请求号找提供方查问题。
  5. `is529Error` 和 `shouldRetry` 里的 `"type":"overloaded_error"` 子串检查（withRetry.ts:610-621, 733-735）对转义后的文本也匹配不上（实验确认）。
- 场景：OpenAI 兼容端点返回 429，正文写着「请 20 秒后重试」，响应头 `retry-after: 20`。CLI 在 0.5、1、2、4、8 秒后连续重试（前 5 次都早于 20 秒），每次都被拒；10 次用完后，用户看到上面那条被截断的消息。
- 参考：Codex 保留状态码、响应头和正文，从 `retry-after` 或正文的「try again in Ns」取等待时间（codex:codex-api/src/sse/responses_error.rs:90-96, 104-110；codex:codex-client/src/retry.rs:103-110），并从响应头取 request id 用于诊断（codex:response-debug-context/src/lib.rs:19-35）。ZCode 解析 `retry-after` 和 `retry-after-ms`，在其上加不超过 20% 且不超过 5 秒的抖动（zcode:apps/zcode-cli/packages/adapters/src/model/runner-retry.ts:40-60, 97-110）。
- 改法方向：代理解析上游错误体，取出 message、code、type，作为 Anthropic 错误体的 `error.message`（不再整体塞进字符串），`error.type` 按状态码映射（`rate_limit_error`、`authentication_error`、`invalid_request_error`、`overloaded_error` 等）；透传 `retry-after`、`retry-after-ms` 和上游 request id 响应头。
- 确定程度：代码确认，CLI 显示经本地模拟确认。

### P-NET-04 重试分类按 Anthropic 设计，对第三方提供方会重试不该重试的错误、等待过久

- 类型：问题
- 严重程度：中
- 现状（主循环请求 `maxRetries` 默认 10，即最多 11 次，src/services/api/withRetry.ts:52, 789-794；SDK 自身重试关闭，claude.ts:1831）：
  1. 401 总是重试（withRetry.ts:773-776）。这是为 OAuth 令牌刷新设计的；对固定 API key，重试 10 次后结果不变。
  2. 429 总是重试（withRetry.ts:767-770），不区分限流和余额或配额耗尽。
  3. 5xx 和连接错误重试（withRetry.ts:753-755, 784）。代理在上游超时或网络失败时返回 502（handler.ts:70），每次要等满 `aiRequestTimeoutMs`（默认 120 秒）才失败，再按 5xx 重试。
  4. 非流式请求收到 2xx 但正文是 `{"error":...}` 时，代理返回 502（src/server/upstream/client.ts:103-107, 299-303），CLI 按 5xx 重试，不管这个错误本身是什么。
  5. 流式请求中途出错（代理发 SSE `error` 事件，src/server/proxy/streaming/openaiChatStreamToAnthropic.ts:497-505；openaiResponsesStreamToAnthropic.ts:307-315）时，CLI 改发非流式请求，并开始一轮新的 `withRetry`（claude.ts:2552-2601；executeNonStreamingRequest，claude.ts:817-900）。两轮叠加，一次调用最多 22 次请求。代理本身不重试，三层不会再叠加。
- 场景：
  - 填错 key：上游 401，CLI 等约 160 秒（0.5+1+2+4+8+16+32×4，另加最多 25% 抖动）后才显示 `Failed to authenticate`（errors.ts:864-880）。
  - 余额或配额耗尽：OpenAI `insufficient_quota`、Moonshot `exceeded_current_quota_error`、智谱 1113 都以 429 返回（推断：依据 ZCode 的注释和映射，zcode:apps/zcode-cli/packages/adapters/src/model/failure-provider-business-codes.ts:174-181, 294-313），CLI 照样等约 160 秒，最后显示的还是 P-NET-03 那条截断消息。Kimi 和智谱预设走直连，同样受影响。
  - 上游挂起不回响应头：11 次 × 120 秒超时，加上约 160 秒退避，用户大约 25 分钟后才看到错误。
- 参考：Codex 的 HTTP 层只重试 5xx 和传输错误，不重试 429，最多 4 次，基础间隔 200 毫秒（codex:model-provider-info/src/lib.rs:70, 455-461；codex:codex-client/src/retry.rs:23-41）；配额类错误码直接终止（codex:codex-api/src/api_bridge.rs:223-233；codex:codex-api/src/sse/responses_error.rs:49-54）。ZCode 401/403 不重试（zcode:apps/zcode-cli/packages/adapters/src/model/failure-classifier.ts:218-226）；配额类码和 BigModel 的 1113、1304、1308 等终止，1302、1303 等限流可重试（failure-provider-business-codes.ts:174-327）；默认 10 次重试，2 秒起，封顶 60 秒（zcode:apps/zcode-cli/packages/adapters/src/model/retry-policy.ts:13-30）。
- 改法方向：对 API key 类提供方（所有 DreamCoder 预设和自定义提供方）不重试 401/403；代理按错误码和文案把配额、余额类错误标为终止（比如改成 400 或 403，并给出可读消息），或由 CLI 依据代理传回的 `error.type` 判断；2xx 正文里的错误按其内容映射状态码，不统一用 502；网络超时类失败减少重试次数。
- 确定程度：代码确认；各提供方错误码对应的 HTTP 状态为推断。

### P-NET-05 代理不随 CLI 中止上游请求：非流式请求和等待响应头期间的请求会跑完并计费

- 状态：已在 #262 修复：`sendToUpstream` 接收调用方的取消信号，与超时信号合并；代理传入 `req.signal`。
- 类型：问题
- 严重程度：中
- 现状：
  1. `handleProxyRequest` 不读 `req.signal`（src/server/proxy/handler.ts:8-85）；`sendToUpstream` 的 `fetch` 只挂超时信号（非流式用 `AbortSignal.timeout`，流式用一个只在等响应头期间生效的定时器，src/server/upstream/client.ts:258-277）。
  2. 流式响应开始后，CLI 断开会触发转换器的 `cancel()`，进而 `reader.cancel()` 中止上游（openaiChatStreamToAnthropic.ts:143-146；openaiResponsesStreamToAnthropic.ts:107-110）。实验 `cancel.ts` 证实这一段能立即传到上游。
  3. 在上游返回响应头之前 CLI 断开：上游请求继续，直到响应头到达后流才被取消（实验确认）。非流式请求：上游一直跑到完成或 120 秒超时。
- 场景：用户点「停止」或删除会话，而此时 CLI 正在走非流式回退请求（例如 P-NET-01 之后）。提供方继续生成完整回复并计费，代理拿到结果后丢弃。CLI 因 P-NET-01 重试时，前一次的非流式上游请求也没有被中止，多次重试的生成同时进行。
- 参考：ZCode 每次尝试都用与调用方中止信号联动的 AbortController（zcode:apps/zcode-cli/packages/adapters/src/model/runner-stream.ts:175-178；stream-idle-timeout.ts:63-80）。Codex 中止回合时丢弃请求 future，底层连接随之关闭（推断：Rust async 的取消语义，未逐行核对）。
- 改法方向：`sendToUpstream` 接收调用方的 `AbortSignal`，与超时信号合并（`AbortSignal.any`），代理把 `req.signal` 传进去。
- 确定程度：代码确认，传播行为经本地实验确认。

### P-NET-06 OpenAI 格式的 base URL 被强制改成 `.../v1/...`，版本号不是 v1 的提供方都会 404

- 状态：已在 #262 修复：OpenAI 格式下，base URL 末段是版本号（`/v4`、`/v1beta` 等）或 `<版本>/openai` 时当完整前缀；否则仍补 `/v1`，已保存的配置行为不变。请求、拉取模型和测试连接共用这一个函数。表单占位示例未改。
- 类型：问题
- 严重程度：中
- 现状：`normalizeUpstreamBaseUrl` 只去掉末尾的 `/v1`（src/server/upstream/baseUrl.ts:1-3），然后固定拼上 `/v1/chat/completions` 或 `/v1/responses`（src/server/upstream/client.ts:211-222）；拉取模型列表固定拼 `/v1/models`（client.ts:121, 136）。界面上 base URL 的占位符只举了 Anthropic 的例子（desktop/src/i18n/locales/en.ts:500）。
- 场景：自定义提供方，`openai_chat`，填智谱 OpenAI 兼容地址 `https://open.bigmodel.cn/api/paas/v4`。请求实际发到 `.../api/paas/v4/v1/chat/completions`，404，连「测试连接」和「拉取模型」都失败。同样受影响的还有 Z.ai `https://api.z.ai/api/paas/v4`（这两个地址取自 zcode:config/provider/zcode-builtin.json:42, 112）、火山方舟 `.../api/v3`、Gemini 的 OpenAI 兼容地址 `.../v1beta/openai`（这两个为推断，依据公开文档）。
- 参考：Codex 把 base_url 当作已经含版本号的完整前缀，只追加 `/responses`，另可附加 query 参数（codex:codex-client/src/provider.rs:55-77；默认值 `https://api.openai.com/v1`，codex:model-provider-info/src/lib.rs:441-446）。ZCode 的 openai-compatible 直接把 baseURL 交给 SDK，由 SDK 追加 `/chat/completions`，只对 Anthropic 格式补 `/v1`（zcode:apps/zcode-cli/packages/adapters/src/model/model-execution.ts:333-360, 466-480）。
- 改法方向：OpenAI 格式下，base URL 末段已经是版本号（`/v\d+…`）或含 `/openai` 时直接追加 `/chat/completions`、`/responses`、`/models`，否则仍补 `/v1`，这样已保存的 `https://api.openai.com` 一类地址继续可用；表单给出 OpenAI 格式的占位示例。
- 确定程度：代码确认；ZCode 配置里的智谱地址为仓库内证据，其余提供方地址为推断。

### P-NET-07 手动代理模式下，CLI 访问本地代理的请求也被送进外部 HTTP 代理

- 状态：已在 #262 修复：手动代理模式下 CLI 环境写入 `NO_PROXY`/`no_proxy`（与继承值合并，加上 `127.0.0.1,localhost,::1`；继承值为 `*` 时原样保留）。实测 Bun 的 fetch 在设置了 `NO_PROXY` 时，即使显式传了 `proxy` 选项也会直连，所以 `getProxyFetchOptions` 未改。系统代理模式未处理。
- 类型：问题
- 严重程度：中
- 现状：
  1. 网络设置为手动代理时，服务端给 CLI 进程设置 `HTTP_PROXY`、`HTTPS_PROXY` 及小写版本，但不设置 `NO_PROXY`（src/server/services/networkSettings.ts:75-89；conversationService.ts:1036）。
  2. CLI 创建 SDK 客户端时用 `getProxyFetchOptions({ forAnthropicAPI: true })`（src/services/api/client.ts:216-218）；在 Bun 下，只要有代理地址就返回 `{ proxy }`，不检查 `NO_PROXY`（src/utils/proxy.ts:307-315）。
  3. 走代理的提供方，CLI 的 `ANTHROPIC_BASE_URL` 是 `http://127.0.0.1:<port>/proxy...`（src/server/services/providerRuntimeEnv.ts:214-216）。实验 `proxyopt.ts` 证实：Bun 的 `proxy` 选项对 127.0.0.1 照样生效，只有设置了 `NO_PROXY` 才直连。
- 场景：公司网络，用户在设置里填 `http://proxy.corp:8080`，使用 `openai_chat` 提供方。CLI 把发往 `127.0.0.1:<port>` 的请求交给 proxy.corp，proxy.corp 连的是它自己的 127.0.0.1，连接失败或返回 502，CLI 按 5xx 或连接错误重试 10 次后报错，所有走代理的提供方都不可用。用本机 Clash（`127.0.0.1:7890`）时能否通，取决于 Clash 规则是否让回环地址直连。系统代理模式下，如果应用继承的环境里有 `HTTPS_PROXY` 而没有 `NO_PROXY`，情况相同。
- 参考：ZCode 给子进程环境显式处理 `NO_PROXY`/`no_proxy`（zcode:apps/zcode-cli/packages/adapters/src/network/subprocess-env.ts:30-40, 104-110），自己的 fetch 按 `NO_PROXY` 判断是否绕过代理（zcode:apps/zcode-cli/packages/adapters/src/network/http-config.ts:190-200）。Codex：无对应（不经本地中转）。
- 改法方向：`buildNetworkEnvironment` 同时写入 `NO_PROXY`/`no_proxy`，至少包含 `127.0.0.1,localhost,::1`，并与已有值合并；`getProxyFetchOptions` 的 Bun 分支用已有的 `shouldBypassProxy` 判断。
- 确定程度：代码确认，Bun 行为经本地实验确认。

### P-NET-08 直连路径没有流空闲超时，连接半开时会话无限等待；两条路径的超时语义不一致

- 状态：已在 #262 修复：服务端给 CLI 设 `CLAUDE_ENABLE_STREAM_WATCHDOG=1`，`CLAUDE_STREAM_IDLE_TIMEOUT_MS` 与 `API_TIMEOUT_MS` 相同（「AI 请求超时」），代理侧用同一个时长，两条路径都按「多久没有内容事件」计。`ping` 不重置 CLI 看门狗（SDK 跳过 ping），所以代理也不让 ping 重置自己的计时。两条路径超时后，CLI 都走同一个 catch，退回非流式把请求重发一次（`claude.ts:2519-2558`），除非设了 `CLAUDE_CODE_DISABLE_NONSTREAMING_FALLBACK`。
- 类型：问题
- 严重程度：中
- 现状：CLI 的流空闲看门狗默认关闭，要设 `CLAUDE_ENABLE_STREAM_WATCHDOG` 才开（src/services/api/claude.ts:1924-1928）。SDK 的 `timeout`（= `API_TIMEOUT_MS`）只管到响应头（推断：SDK 行为，claude.ts:1916-1923 的注释也这样说明）。代理路径的上游 fetch 在拿到响应头后清掉定时器（src/server/upstream/client.ts:268-276），此后唯一的空闲限制是 P-NET-01 的 Bun 60 秒。结果：代理路径 60 秒（对静默推理太短），直连路径没有上限。
- 场景：Kimi 预设（直连），笔记本合盖或切换 Wi‑Fi 后 TCP 连接半开，流不再有数据，也没有收到断开通知。会话一直显示在生成，直到用户手动停止。
- 参考：Codex 每个提供方默认 300 秒（codex:model-provider-info/src/lib.rs:68, 515-519）；ZCode 默认 600 秒，每次重试加 30 秒（zcode:apps/zcode-cli/packages/contracts/src/config/index.ts:284；zcode:apps/zcode-cli/packages/adapters/src/model/stream-idle-timeout.ts:5-24）。
- 改法方向：DreamCoder 启动 CLI 时默认打开流空闲看门狗，超时取一个与 P-NET-01 的代理空闲超时一致的值；代理的 `ping` 心跳会重置看门狗，二者不冲突。
- 确定程度：代码确认（默认关闭）；半开连接场景为推断。

### P-NET-09 自定义提供方对所有模型一律声明全部思考能力，没有按模型的能力配置

- 类型：问题
- 严重程度：中
- 现状：`presetId === 'custom'` 时，三档模型的 `*_SUPPORTED_CAPABILITIES` 都设为 `thinking,effort,adaptive_thinking,max_effort`，主模型同时作为 SONNET 和 OPUS 默认模型（src/server/services/providerRuntimeEnv.ts:38, 229-250），与 `apiFormat` 和模型无关。CLI 按这些覆盖值决定发 `thinking:{type:'adaptive'}`，允许 `max` 档 effort（src/utils/model/modelSupportOverrides.ts:30-48；thinking.ts:91-95, 125-129；effort.ts:28-31, 53-56；claude.ts:1649-1659）。`SavedProvider` 没有能力字段，界面上无法修改（src/server/types/provider.ts:46-59）。
- 场景：自定义 Anthropic 格式提供方，是一个转发 `claude-sonnet-4-5` 的中转站。CLI 发 `thinking:{type:'adaptive'}`；按 CLI 自己的判断，adaptive 只有 opus-4-6、sonnet-4-6 及更新的模型支持（thinking.ts:139-150），上游返回 400（推断：依据 Anthropic API 对旧模型的行为）。用户把 Effort 设为 max 时，代码注释说其他模型会报错（effort.ts:50-51）。走代理的自定义提供方上，adaptive 不产生任何推理字段（前一份报告已述）。
- 参考：ZCode 有按模型正则、协议、站点叠加的规则（zcode:config/provider/zcode-builtin.json 中 `modelRules` 83 条、`modelApiRules` 73 条、`providerSiteRules` 58 条），用户手动模型可覆盖窗口、输出上限、推理档位等字段（前一份报告：zcode:packages/provider/src/config/manual-model-config.ts:7-28）。Codex 有内置目录和可选的 `model_catalog_url`，未知模型用回退元数据：不发 effort，窗口 272,000（codex:models-manager/src/model_info.rs:98-146）。
- 改法方向：提供方的每个模型保存能力声明（thinking、adaptive、effort、max effort、窗口、输出上限），自定义提供方的默认值按 `apiFormat` 和模型名给出（Claude 名字按 CLI 已有判断，其他名字取保守值），界面允许修改；服务端按所选模型生成环境变量，不再整档写死。
- 确定程度：代码确认；中转站返回 400 为推断。

### P-NET-10 Qwen 预设没有声明上下文窗口；窗口只在用户手动「拉取模型」时获取，未知模型一律当 200,000

- 类型：问题
- 严重程度：中
- 现状：
  1. DeepSeek、Kimi、智谱预设带 `modelContextWindows`；Qwen 预设没有，也没有能力声明（src/server/config/providerPresets.json；Qwen 默认模型 `qwen-max`、`qwen-plus`、`qwen-turbo`）。
  2. CLI 的窗口查找顺序：环境变量 `CLAUDE_CODE_MODEL_CONTEXT_WINDOWS`，然后内置表，最后 200,000（src/utils/context.ts:11, 53-115）。内置表有 `qwen3-max`、`qwen3.5-*`、`qwen-long`，没有上面三个名字（src/utils/model/modelContextWindows.ts:5-48）。
  3. 窗口发现（`/v1/models` 列表字段、DashScope 和 DeepSeek 的专用接口等）只在拉取模型时运行（src/server/upstream/client.ts:187-189；src/server/upstream/contextWindows/index.ts:11-66），结果作为表单建议值（desktop/src/components/settings/ProviderFormModal.tsx:592-616），之后不会刷新。会话启动和运行时都不查询提供方。
  4. 输出上限：非 Claude 名字的模型 CLI 用 32,000（前一份报告：context.ts:203-260），代理路径上不转发。
- 场景：用户选 Qwen 预设，保留默认模型 `qwen-max`，不点拉取模型。DreamCoder 按 200,000 计算自动压缩；若 `qwen-max` 的真实窗口是约 32K（未核实，依据对阿里云文档的记忆），固定开销（前一份报告估算约 12 万字符的 system 和工具描述）已经接近或超过上限，第一轮或前几轮就会溢出，然后进入 P-NET-02 的卡死状态。
- 参考：ZCode 内置规则给每个已知模型写窗口和输出上限，未知模型用基线 1,000,000 和 128,000（zcode:config/provider/zcode-builtin.json `modelRules[0]`）。Codex 未知模型回退 272,000，并标记 `used_fallback_model_metadata`（codex:models-manager/src/model_info.rs:98-146）；对 OpenAI 兼容提供方可从 `/models` 刷新目录，5 秒超时（codex:model-provider/src/models_endpoint.rs:44-45）。
- 改法方向：Qwen 预设补上默认模型的窗口（可用 DashScope 接口在发布前核对），并更新默认模型列表；创建或编辑预设提供方时，自动对有专用来源的主机运行一次窗口发现，不依赖用户点击。
- 确定程度：代码确认；Qwen 各模型的真实窗口未核实。

### P-NET-11 走代理的提供方不能配置额外请求头和 query 参数

- 状态：部分在 #262 修复：提供方配置加了可选的 `extraHeaders` 和 `queryParams`，只对 `openai_chat`/`openai_responses` 生效，anthropic 格式保存时拒绝。请求头按固定顺序合并：先放配置的头，再放鉴权头和 `Content-Type`，后者覆盖前者（不区分大小写）。请求都会带上；测试连接和拉取模型只对已保存的提供方带上，未保存配置的这两个输入等做表单时补字段。桌面端表单和直连路径未做：直连路径的头要走 `ANTHROPIC_CUSTOM_HEADERS`，它不在受管 key（`providerRuntimeEnv.ts:19`）里，纳入后会清掉用户手写的同名设置；query 参数在直连路径上需要改 CLI。
- 类型：优化
- 严重程度：低
- 现状：代理发往上游的请求头只有 `Content-Type` 和 `Authorization: Bearer`（src/server/upstream/client.ts:213, 221），URL 不带 query 参数；OpenAI 格式下 `authStrategy` 不起作用。`SavedProvider` 没有请求头字段（src/server/types/provider.ts:46-59）。直连路径的 CLI 支持 `ANTHROPIC_CUSTOM_HEADERS`（src/services/api/client.ts:404-428），但提供方表单不会写入它。
- 场景：Azure OpenAI 需要 `api-key` 请求头和 `api-version` query 参数（推断：依据 Azure 文档），在 DreamCoder 里无法接入；OpenRouter 建议的 `HTTP-Referer`/`X-Title` 归因头也无法设置。
- 参考：Codex 的提供方有 `http_headers`、`env_http_headers`、`query_params`（codex:model-provider-info/src/lib.rs:173-181, 399-426；codex:codex-client/src/provider.rs:64-74）。ZCode 的提供方 `api.headers`（zcode:packages/provider/src/config/provider-data-schema.ts:70；zcode:packages/provider/src/resolver.ts:63），并对 OpenRouter 自动加归因头（zcode:apps/zcode-cli/packages/adapters/src/model/model-execution.ts:231）。
- 改法方向：`SavedProvider` 增加可选的请求头和 query 参数，代理和直连两条路径都使用；鉴权头仍由 `authStrategy` 决定，不允许被覆盖。
- 确定程度：代码确认。

### P-NET-12 代理日志不足以诊断失败的上游请求，也没有逐请求的统计

- 状态：已在 #262 修复：`sendToUpstream` 对每个上游请求记一条 `upstream_request` 诊断事件（提供方、模型、主机、格式、状态、响应头耗时、总耗时、上游 request id、结果），流式请求在流结束时记，结果分为正常结束、流中错误、未正常结束、空闲超时、客户端中止和客户端断开（调用方已中止后出现的错误按客户端断开记）；不含 key 和正文。
- 类型：优化
- 严重程度：低
- 现状：代理只在上游返回非 2xx 或网络失败时打一行 `console.error('[Proxy] Upstream request failed:', result.error)`（src/server/proxy/handler.ts:67），被诊断服务捕获并脱敏写入 diagnostics 文件（src/server/services/diagnosticsService.ts:70-112）。这一行没有提供方 id、模型、上游主机和路径、apiFormat、耗时、上游 request id。流中途的上游错误（SSE `error`）、上游连接中断、Bun 空闲断开都不记录。成功请求不记录。token 用量只来自 CLI 写入转录的 usage，由会话服务汇总（src/server/services/sessionService.ts:868-890）；代理侧没有按提供方和模型的请求数、失败数、延迟统计。key 不会出现在这行日志里（只含上游响应体前 500 字），诊断文件按键名再做一次脱敏（diagnosticsService.ts:42, 258-270）。
- 场景：用户报告「OpenRouter 上某模型经常卡住然后报错」，日志里要么什么都没有（P-NET-01 的断开不记录），要么只有一行不带模型和提供方的 `Upstream returned HTTP 502: ...`，无法区分是哪个会话、哪个提供方、在第几秒失败。
- 参考：Codex 每次请求和重试都有遥测（尝试次数、状态、耗时，codex:codex-client/src/telemetry.rs:5-14；codex:codex-client/src/retry.rs:62-81），并从响应头提取 request id（codex:response-debug-context/src/lib.rs:19-35）。ZCode 按 `x-request-id` 记录请求观测（zcode:apps/zcode-cli/packages/adapters/src/model/request-observations.ts:1-40），调试输出有专门的脱敏（zcode:apps/zcode-cli/packages/adapters/src/model/runner-debug-redaction.ts）。
- 改法方向：代理对每个请求记一条结构化事件（提供方 id、模型、上游主机、格式、状态、耗时、首字节时间、结束原因、上游 request id，不含 key 和正文），失败和流中途错误记为 warn/error，写入现有 diagnostics。
- 确定程度：代码确认。

### P-NET-13 代理不支持 count_tokens；终端里的 `/context` 会把每个统计项变成一次完整生成

- 状态：已在 #262 修复，用的是第二种做法：代理对 `count_tokens` 和其他未知路径都返回 Anthropic 格式的 `not_found_error`。服务端给经代理的提供方设 `DREAMCODER_PROVIDER_PROXIED=1`，CLI 的 `/context` 计数在 API 计数返回 null 时直接用本地粗估，不再发 Haiku 请求。FileRead 的大小检查不变（仍是 404 → null → 按文件类型粗估）。没有采用本地估算，因为代理拿不到文件类型，会让 FileRead 对 JSON 文件少算约一半。
- 类型：问题
- 严重程度：低
- 现状：
  1. 代理只接 `POST .../v1/messages`，其他路径返回 404，正文不是 Anthropic 错误格式（src/server/proxy/handler.ts:9-21）。
  2. `countMessagesTokensWithAPI` 调 `/v1/messages/count_tokens`，失败返回 null（src/services/tokenEstimation.ts:141-196）。读大文件时（FileReadTool.ts:764）只是多一次本地往返，然后用估算值。
  3. `/context` 在非估算模式下，API 计数失败后调用 `countTokensViaHaikuFallback`，发一次 `max_tokens: 1` 的 `/v1/messages`（tokenEstimation.ts:233-302）；代理不转发 `max_tokens`（src/server/proxy/transform/types.ts:35-36 有字段，转换代码不赋值），上游按默认上限完整生成。system 的每一段、每个记忆文件、每个自定义 agent 等各发一次，并发执行（src/utils/analyzeContext.ts:327-331, 368-376, 786-795）。
  4. 桌面端拦截 `/context`，用 `estimateOnly: true` 只做估算（desktop/src/components/chat/LocalSlashCommandPanel.tsx:1104；src/server/api/sessions.ts:535-548），不受影响。
- 场景：用户在终端运行 dreamcoder CLI，提供方由桌面端的 active provider 注入（src/utils/managedEnv.ts:109-111，基础地址指向本地代理），提供方是 `openai_chat`。输入 `/context` 后，CLI 并发发出几十个请求，每个都让模型完整回答一段 system 文本，按全价计费，并可能触发 429。
- 参考：Codex、ZCode：无对应（没有 count_tokens 调用）。
- 改法方向：代理对 `/v1/messages/count_tokens` 返回本地估算值（Anthropic 响应格式），或返回 Anthropic 格式的 404，并让 CLI 在代理提供方上跳过 Haiku 回退；`max_tokens` 的转发由请求形态评审处理。
- 确定程度：代码确认。

### P-NET-14 各预设的能力声明不一致，同一个 Effort/思考开关在不同预设上产生不同的请求字段

- 类型：优化
- 严重程度：低
- 现状：DeepSeek 预设声明三档 `thinking,effort,adaptive_thinking,max_effort`；Kimi、智谱预设不声明能力，只设 `DREAMCODER_SEND_DISABLED_THINKING=1`；Qwen 什么都不设（src/server/config/providerPresets.json）。不声明能力时，CLI 对 `kimi-k2.6`、`glm-5.1` 判定不支持 thinking（非一方地址时只认 sonnet-4/opus-4，src/utils/thinking.ts:91-117），但判定支持 effort（未知名字在 firstParty 下返回 true，src/utils/effort.ts:23-49）。于是 Kimi、智谱直连时：思考开启，不发 `thinking`，由提供方默认决定；思考关闭，发 `thinking:{type:'disabled'}`（claude.ts:1596-1600, 1674-1678）；两种情况下都可能发 `output_config.effort`（claude.ts:1607-1616, 439-465）。
- 场景：用户在 Kimi 预设上把 Effort 从 high 调到 low，请求里的 `output_config.effort` 变了；Kimi 的 Anthropic 端点是否理会这个字段，未核实。用户以为调节有效，实际可能不起作用。
- 参考：ZCode 每个模型和站点写明推理档位以及映射到哪个请求字段（zcode:config/provider/zcode-builtin.json `providerSiteRules`，例如 glm-5.3-flash 映射到 `reasoning_effort`）。Codex：无对应（只有 OpenAI 模型）。
- 改法方向：与 P-NET-09 合并处理：每个预设的每个默认模型显式声明能力，界面只在声明支持时显示 Effort 档位。
- 确定程度：代码确认；提供方是否理会这些字段未核实。

## 2. 已知结论的核实

| 已知结论 | 结论 | 说明与位置 |
|---|---|---|
| 上游错误统一包成 `api_error`，响应头（含 `retry-after`）丢失 | 确认并补充 | src/server/upstream/client.ts:83-90；src/server/proxy/handler.ts:66-71。补充：状态码保留；上游原文被转义进字符串，导致 429 分支只显示到 `{\`，`overloaded_error` 子串也匹配不上（P-NET-03，本地模拟确认）；`x-request-id` 一并丢失；网络失败和超时统一为 502，按 5xx 重试，每次等满超时（P-NET-04）。 |
| `max_tokens` 和 effort 不转发 | 确认（属请求形态，未深入） | `max_tokens` 有类型字段无赋值（src/server/proxy/transform/types.ts:35-36, 112）；Responses 转换也不设 `max_output_tokens`（anthropicToOpenaiResponses.ts:17-60）。补充一个由此引发的计费后果：P-NET-13。 |
| `reasoning_content` 只对 deepseek 和 opencode.ai 主机回写 | 确认 | `shouldUseDeepSeekReasoningCompat` 用主机名正则判断（src/server/upstream/client.ts:206-210, 251-256）；同一判断还控制是否透传 `thinking` 开关。 |
| 计费头 `cch` 每请求变化 | 不在本部分，未复核哈希；补充一处不一致 | 代理对所有请求无条件加计费头（handler.ts:64；claudeCodeAttribution.ts:29-46），不看 `CLAUDE_CODE_ATTRIBUTION_HEADER`。服务端对非 Claude 模型名把这个变量设为 0（attributionHeaderPolicy.ts；providerRuntimeEnv.ts:251），直连路径因此不加；代理路径对同一模型名照加。 |
| 图片、无 id 的工具调用、`cache_control` | 不在本部分，未复核 | — |

前一份报告中属于本部分、本次另行核对的几点：
- 代理超时只覆盖到响应头：确认（client.ts:258-277）。补充：此后的实际空闲上限是 Bun 的 60 秒（P-NET-01）。
- CLI 重试 10 次，0.5 秒起翻倍，封顶 32 秒，加不超过 25% 的抖动：确认（withRetry.ts:52-55, 530-548）。补充：`retry-after` 没有上限，直连路径上提供方给多大就等多久（withRetry.ts:535-539）。
- 流中途出错改走非流式：确认（claude.ts:2512-2601），默认开启（GrowthBook 默认 false，claude.ts:2520-2524）。补充：与第一轮 `withRetry` 叠加（P-NET-04），并受 P-NET-01 影响。

### 第 3 项要求的错误逐项表（代理路径，OpenAI 兼容上游）

| 上游错误 | CLI 收到 | CLI 行为 | 用户看到 | 评价 |
|---|---|---|---|---|
| 400 参数错误 | 400，`api_error` 包装 | 不重试 | `API Error: 400 {"type":"error",...转义的上游原文...}` | 不重试正确；文本难读 |
| 401 | 401 | 重试 10 次，约 160 秒 | `Failed to authenticate. API Error: 401 {...}`（errors.ts:864-880） | 不应重试（P-NET-04） |
| 403 | 403 | 不重试 | 同 401 的认证提示 | 地区或权限类 403 也被说成认证失败 |
| 404 模型不存在 | 404 | 不重试 | 「所选模型 X 可能不存在或无权访问」（errors.ts:905-917） | 合理；部分提供方对未知模型返回 400，只能显示通用文本 |
| 413 | 413 | 不重试 | 请求过大提示（errors.ts:659-664） | 合理 |
| 429 带 `retry-after` | 429，响应头被丢 | 按自身退避重试 10 次 | `Request rejected (429) · Upstream returned HTTP 429: {\` | 早于提供方要求重试；原因丢失（P-NET-03） |
| 429 不带 `retry-after` | 同上 | 同上 | 同上 | 退避本身合理；原因丢失 |
| 429 配额或余额耗尽 | 同上 | 同上，约 160 秒 | 同上 | 应立即终止（P-NET-04） |
| 402 余额不足（DeepSeek 一类） | 402 | 不重试 | 通用 `API Error: 402 {...}` | 可接受 |
| 500/502/503/504 | 原状态码 | 重试 10 次 | 最后显示 `API Error: 5xx {...}` | 次数偏多但可接受（Codex 4 次，ZCode 10 次） |
| 代理到上游超时或网络失败 | 502 | 按 5xx 重试，每次等满超时 | 约 25 分钟后看到错误 | 等待过长（P-NET-04） |
| 上下文溢出（OpenAI、DashScope、Moonshot、BigModel 各自的文案或码） | 400 | 不重试，不压缩 | 通用 400 文本；之后每轮失败，`/compact` 也失败 | 会话卡死（P-NET-02） |
| 内容过滤：chat 流 `finish_reason: content_filter` | 映射为 `end_turn`（openaiChatStreamToAnthropic.ts:535） | 当作正常结束 | 回复中途结束，没有说明 | Codex 把 ContentFilter 作为可重试错误并在历史中记录提示（codex:core/src/responses_retry.rs:63-80） |
| 内容过滤：Responses `incomplete` | 不看 `incomplete_details.reason`，一律映射为 `max_tokens`（openaiResponsesStreamToAnthropic.ts:325-327） | 触发「输出超限」续写，最多 3 次 | 「超过 32000 输出上限」类提示 | 判断错误（属响应转换，此处只记录） |
| 2xx 但正文是错误（非流式） | 502 | 按 5xx 重试 10 次 | 上游 message 文本 | 应按错误内容分类（P-NET-04） |
| 2xx 流中出现 error 对象 | SSE `error`，无状态码 | 改发非流式请求，再走一轮重试 | 依第二次的结果而定 | 多一次完整请求 |

直连路径（Kimi、智谱、DeepSeek 的 Anthropic 端点）：状态码和响应头原样到达 CLI，`retry-after` 生效（没有上限）；401 同样重试 10 次；429 配额类同样重试；上下文溢出是否被识别，取决于提供方文案是否含 `prompt is too long`（未核实）。

### 第 6 项：直连 Anthropic 格式路径发出的 Anthropic 专有内容

- `anthropic-beta`：不发。`getMergedBetas` 对非一方地址返回空数组（src/utils/betas.ts:398-404），`useBetas` 为假（claude.ts:1415, 1763），因此 `context_management` 也不发（claude.ts:1767-1770）。
- `output_config.effort`：DeepSeek 预设声明了 effort，会发；Kimi、智谱因 `modelSupportsEffort` 对未知名字为真，也会发（P-NET-14）。
- `thinking`：DeepSeek 发 `adaptive`；Kimi、智谱只在关闭时发 `disabled`（P-NET-14）。
- `metadata.user_id`：总是发，内容是含 `device_id`、`session_id` 的 JSON 字符串（claude.ts:502-527, 1764），会送到第三方提供方。没有已知的失败，属隐私层面的考虑。
- `cache_control`：照发在消息块上（claude.ts:3131-3290）；`ttl: '1h'` 只对符合条件的一方用户生效（claude.ts:357-372）。各端点是否理会未核实。
- 计费头：非 Claude 模型名不加（attributionHeaderPolicy.ts；providerRuntimeEnv.ts:251）。
- 代理侧的修复是否也需要用在直连路径：P-NET-02（溢出识别）、P-NET-04（401 和配额类重试）、P-NET-08（空闲超时）需要在 CLI 一侧处理，直连路径才能受益；P-NET-01、P-NET-03、P-NET-05、P-NET-06、P-NET-07 只涉及代理路径。

## 3. 覆盖范围

完整阅读：
- src/server/proxy/handler.ts、claudeCodeAttribution.ts
- src/server/upstream/client.ts、baseUrl.ts、contextWindows/（index、source、listed、qwen、deepseek）
- src/server/services/providerRuntimeEnv.ts、networkSettings.ts（前 90 行）、attributionHeaderPolicy.ts
- src/server/config/providerPresets.json
- src/services/api/withRetry.ts
- src/utils/model/modelSupportOverrides.ts

部分阅读（与本部分相关的段落）：src/server/index.ts（服务启动与路由）、h5AccessPolicy.ts、middleware/cors.ts、proxy/streaming 两个流转换器（开头、结尾、取消、错误、结束原因）、anthropicToOpenaiResponses.ts、providerService.ts（测试连接、拉取模型）、titleService.ts、conversationService.ts（CLI 环境）、diagnosticsService.ts、src/services/api/client.ts、errors.ts、claude.ts（参数构建、流式与非流式回退、用量合并）、src/utils/proxy.ts、betas.ts、thinking.ts、effort.ts、modelContextWindows.ts、tokenEstimation.ts、analyzeContext.ts、compact.ts（PTL 重试）、Anthropic SDK 0.98.0 的 core/error.js 与 core/streaming.js。

参考实现：Codex 的 model-provider-info/src/lib.rs、codex-client/src/provider.rs 与 retry.rs、core/src/responses_retry.rs、protocol/src/error.rs（retry_delay）、codex-api/src/api_bridge.rs 与 sse/responses_error.rs（部分）、model-provider/src/models_endpoint.rs（开头）；ZCode 的 adapters/src/model 下 retry-policy、runner-retry、failure-classifier、failure-inspection、failure-provider-business-codes、stream-idle-timeout、model-execution（provider 创建与 base URL）、model-request-headers、request-observations，adapters/src/network（NO_PROXY），config/provider/zcode-builtin.json 的结构与相关条目。

没有覆盖：
- 请求和响应字段的逐项翻译（另一位评审负责），只在影响传输或计费时引用。
- 请求体大小和压缩：Bun.serve 默认请求体上限、上游请求是否压缩，没有逐项核对；没有找到会撞上限的具体场景。
- TLS：代理和 CLI 都经 `getProxyFetchOptions` 使用同一套 CA/mTLS 设置（src/utils/proxy.ts:288-321），没有进一步核对。
- 「系统代理」模式只读取进程继承的环境变量（界面文案也这样写，desktop/src/i18n/locales/en.ts:1045），不读 macOS 系统代理设置；从 Dock 启动的应用是否因此连不上被墙的提供方，未核实。
- 会话未指定 providerId、走 `/proxy/v1/messages`（按请求时的 active provider 转发）时，用户中途切换 active provider 的后果，未追踪。
- 标题生成（非流式，15 秒超时，`max_tokens` 不转发）在推理模型上可能超时，未展开。
- 所有提供方的错误码、HTTP 状态和真实上下文窗口都没有联网核实，文中已逐条标注。
