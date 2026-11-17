# 代理层评审：请求方向（P-REQ）

范围：CLI 发出的 Anthropic Messages 请求，经本地代理变成发往上游的 HTTP 请求（URL、头、body），覆盖 `openai_chat` 与 `openai_responses` 两种上游格式，以及经代理的辅助请求和服务端标题请求的请求侧。

路径约定：DreamCoder 相对仓库根；`codex:` 相对 `refs/coding-agents/codex/codex-rs`；`zcode:` 相对 ZCode 仓库根（`refs/coding-agents/zcode`）。ZCode 规则文件 `zcode:config/provider/zcode-builtin.json` 里的规则按解析后的数组下标写，例如 `modelApiRules[37]`、`providerSiteRules[49]`（均在 `.config.modelConfigRules` 下）。

静态阅读为主；另运行了 DreamCoder 现有测试 `src/server/__tests__/proxy-transform.test.ts`、`src/server/__tests__/upstream-client.test.ts`、`src/utils/claudeCodeCch.test.ts`（66 个通过），并用仓库自带的 zod 打印了一个 schema 样例，确认 `toJSONSchema` 的输出形状。没有对任何模型提供方发请求；凡是依赖提供方文档的结论都标「未核实」。

## 1. 发现清单

### P-REQ-01 代理给每个请求的 system 首行加计费行，`cch` 随整个请求体变化，提供方前缀缓存从第一行起失配

- 类型：问题
- 严重程度：高
- 现状（按执行顺序）：
  1. 服务端按模型名给 CLI 设 `CLAUDE_CODE_ATTRIBUTION_HEADER`：模型名不以 `claude` 开头时为 `0`（`src/server/services/attributionHeaderPolicy.ts:3-15`，注入点 `src/server/services/providerRuntimeEnv.ts:251`），CLI 因此不加计费行（`src/constants/system.ts:52-57`）。
  2. 代理收到请求后无条件调用 `ensureClaudeCodeAttribution`（`src/server/proxy/handler.ts:64`）：只要 system 里没有以 `x-anthropic-billing-header:` 开头的块，就在最前面插一块 `x-anthropic-billing-header: cc_version=2.1.92.<指纹>; cc_entrypoint=unknown; cch=00000;`（`src/server/proxy/claudeCodeAttribution.ts:29-46`，格式 `src/constants/claudeCodeCompatibility.ts:10-17`）。它不看模型名，也不看第 1 步的环境变量，所以第 1 步对经代理的请求不起作用。
  3. 转换时 system 各块用 `\n` 拼成一条 role=system 消息（`src/server/proxy/transform/anthropicToOpenaiChat.ts:19-26`）或 Responses 的 `instructions`（`src/server/proxy/transform/anthropicToOpenaiResponses.ts:24-30`），计费行在最前。
  4. `JSON.stringify` 后再签名：`cch` = 对**整个转换后请求体字符串**做带种子的 xxHash64 取低 20 位（`src/server/upstream/client.ts:214,222`；`src/utils/claudeCodeCch.ts:27-58,135-139`）。请求体含全部历史，所以每个请求的 `cch` 都不同。
  5. 模型名以 `claude` 开头时（例如中转站用 OpenAI 格式卖 `claude-sonnet-4-5`），CLI 自己加计费行并在 fetch 包装里按 Anthropic 请求体签名（`src/services/api/client.ts:461`），代理看到已有计费行就不再加（`claudeCodeAttribution.ts:30,49-57`），转换后不再含 `cch=00000`，不会重签；`cch` 仍逐请求变化。
- 用途与依赖：文件头注释说明这段逻辑取自 sub2api（`claudeCodeAttribution.ts:1-4`；常量注释「accepted by upstream billing validation」`claudeCodeCompatibility.ts:6`），用途是让 Anthropic 订阅类中转站把请求认作 Claude Code。代理只服务 `openai_chat` / `openai_responses`（`handler.ts:39-52` 拒绝 anthropic 格式），在仓库内 grep 不到任何读取或校验这行的下游代码（只有 `handler.ts`、`upstream/client.ts`、CLI 的 `client.ts` 三处写入）。OpenAI 格式的上游没有已知的校验方（推断）。服务端标题请求直接调 `sendToUpstream`，不经过 `ensureClaudeCodeAttribution`，是唯一不带这行的请求（`src/server/services/titleService.ts:83-89`）。
- 场景：Qwen 预设（`openai_chat`，`src/server/config/providerPresets.json:28-42`）或任何自定义 OpenAI 格式提供方。同一会话第 N 与第 N+1 个请求的 system 只有第 79–83 个字符不同（`cch` 的 5 位）。DashScope、DeepSeek、OpenAI、Kimi 等按前缀自动缓存的提供方在第一行就失配，system、工具定义（约 3 万 token 量级，见 request-cache.md Q7）和全部历史每个请求都按未命中计费。子代理、WebFetch 二次处理、压缩请求同样带这行。这行 84 个字符本身也作为普通文本进入模型上下文。
- 参考：Codex 的前缀逐请求不变，并有测试断言第 N 个请求的 input 是第 N+1 个的前缀（`codex:core/tests/suite/prompt_caching.rs`，见 request-cache.md Q2）；指令项的 id 由线程 id 和文本做 UUIDv5，重试与恢复后不变（`codex:core/src/client.rs:1010-1041`）。ZCode 的 system 首行固定（`You are ZCode…`），无此类内容。两者都没有计费行。
- 改法方向：代理对 `openai_*` 目标不再插入计费行、不再签名（删除 `handler.ts:64` 的调用和 `client.ts:214,222` 的签名），与 `attributionHeaderPolicy` 的意图一致；如果确有「OpenAI 格式中转 Claude」的需求，按模型名沿用 CLI 自带的那一行，作为单独的产品决定处理。
- 确定程度：代码确认（缓存失配的计费影响为推断，未测量）

### P-REQ-02 Effort 与思考开关在两种 OpenAI 格式上都到不了上游

- 类型：问题
- 严重程度：高
- 现状：
  1. 自定义提供方三档模型都声明 `thinking,effort,adaptive_thinking,max_effort`（`src/server/services/providerRuntimeEnv.ts:38,229-236`），CLI 因此发 `thinking:{type:'adaptive'}`（`src/services/api/claude.ts:1649-1659`），并在用户设置了 Effort 时写 `output_config.effort`（`claude.ts:439-455,1603-1614`；`src/utils/effort.ts:23-49`）。关闭思考时 CLI 发 `thinking:{type:'disabled'}` 并删掉 effort（`claude.ts:1600-1607,1674-1678`）。
  2. Qwen 预设没有能力声明，模型名不含 sonnet/opus，`modelSupportsThinking` 为假，CLI 不发 thinking；`modelSupportsEffort` 对未知模型名在 firstParty 下为真（`effort.ts:47-49`），会写 `output_config.effort`。
  3. 代理的 `AnthropicRequest` 类型里没有 `output_config`（`src/server/proxy/transform/types.ts:161-181`），effort 被丢弃。chat 只在 `budget_tokens` 存在或 `type==='enabled'` 时写 `reasoning_effort`（`anthropicToOpenaiChat.ts:64-72`），Responses 同理写 `reasoning.effort`（`anthropicToOpenaiResponses.ts:51-60`）。`adaptive` 和 `disabled` 都不产生任何字段。
  4. 唯一例外：baseUrl 含 `deepseek` 或 `opencode.ai` 时，chat 原样透传 `thinking:{type: body.thinking.type}`（`anthropicToOpenaiChat.ts:73-75`；`src/server/upstream/client.ts:206-210,251-256`），自定义提供方下传的是 `adaptive`。
  5. 带 budget 的分支只有在关闭 adaptive（`CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING`）或能力声明不含 adaptive 时才走到，桌面现有配置下等于没有用到。
- 场景：
  - 自定义 `openai_chat` 接 Kimi（`https://api.moonshot.cn/v1`，`kimi-k2.6`），桌面把 Effort 设为 low 或关闭思考：上游请求里没有 `thinking`、`reasoning_effort`，模型按默认（思考开）运行，设置无效。
  - Qwen 预设 `qwen-plus`：无法打开思考（DashScope 用 `enable_thinking`，未核实其默认值），Effort 选择器无效果。
  - 自定义 `openai_chat` 接 `https://api.deepseek.com`：每个请求带 `thinking:{type:"adaptive"}`。ZCode 对 DeepSeek chat 只发 `enabled`/`disabled`；DeepSeek 是否接受 `adaptive` 未核实（若拒绝则每个请求 400，若忽略则用户的开关不生效）。
  - 自定义 `openai_responses` 接 OpenAI `gpt-5.x`：Effort 不进入 `reasoning.effort`。
- 参考：
  - ZCode：每个模型/协议有字段映射。通用 chat 映射同时写 `thinking.type`、`enable_thinking`、`reasoning_effort`（disabled→`none`）、`reasoning.effort`（`modelApiRules[2]`）；Responses 通用映射写 `reasoning.effort`（`modelApiRules[3]`）；DeepSeek v4 chat 写 `thinking.type` + `reasoning_effort`（`modelApiRules[37],[39],[63],[67]`），DeepSeek 官方 Responses 写 `reasoning.effort`（`providerSiteRules[42]-[44]`）；Kimi k2.5/k2.6 chat 写 `thinking.type`（`modelApiRules[33],[35]`），k3 写 `reasoning_effort`（`[24],[26]`）；Qwen plus/flash/3.x 写 `enable_thinking`（`[44],[46],[48],[50],[69]`），qwen3.8 写 `reasoning_effort`（`[41]`）；OpenRouter 上部分模型写 `reasoning:{effort}` 或 `reasoning:{enabled:false}`（`providerSiteRules[49],[50]`）。默认档取最高（见 model-adaptation.md Q3）。
  - Codex：`reasoning.effort` 与 `reasoning.summary`（`codex:core/src/client.rs:957-976`）。
- 改法方向：在代理请求类型中加入 `output_config`，把「effort 档位 + thinking 开/关」按上游格式写到对应字段：Responses 写 `reasoning.effort`（关闭时 `none`）；chat 先按 ZCode 通用映射的做法写一组通用字段，再按模型/站点覆盖（DeepSeek、Kimi、Qwen、OpenRouter）；不再透传 `adaptive` 这个 Anthropic 专有值。
- 确定程度：代码确认（各提供方对字段的接受情况未核实）

### P-REQ-03 PDF（document 块）在两种格式上被静默丢弃，模型只看到「已读取」

- 类型：问题
- 严重程度：高
- 现状：
  1. Read 工具读整份 PDF 时，tool_result 只写 `PDF file read: <路径> (<大小>)`（`src/tools/FileReadTool/FileReadTool.ts:670-676`），PDF 内容放在随后一条 meta user 消息的 `document` 块里（`FileReadTool.ts:997-1011`）。是否走这条路只看 `isPDFSupported()`，它只排除 `claude-3-haiku`（`src/utils/pdfUtils.ts:59-61`），对第三方模型都为真。
  2. chat 转换 `convertUserMessage` 只处理 text、image、tool_result（`anthropicToOpenaiChat.ts:108-121`），`document` 块没有分支，被直接跳过；Responses 转换同样只处理 text、image、tool_use、tool_result（`anthropicToOpenaiResponses.ts:82-105`）。只有出现在 tool_result 内部时才会留下 `[omitted content: document]`（`src/server/proxy/transform/toolArguments.ts:43-44`）。
- 场景：Qwen 预设或任何自定义 OpenAI 格式提供方，用户让模型「读一下 spec.pdf 并总结」。模型调用 Read，收到「PDF file read: spec.pdf (120KB)」，后面没有任何内容，也没有提示内容缺失；模型据此编造总结，或认为已读而不再尝试 `pages` 参数（该参数会把页面转成图片，见 `FileReadTool.ts:886-944`）。
- 参考：ZCode 对 file 块：模型声明支持 PDF 时作为 SDK file part 发送，不支持时换成明确的「不支持该媒体」文本（`zcode:apps/zcode-cli/packages/adapters/src/model/transform.ts:540-563`；`zcode:apps/zcode-cli/packages/adapters/src/model/media-transform-policy.ts:8-15`；基线规则 `supportsPdf:false`，`modelRules[0]`）。Codex：无 PDF 读取。
- 改法方向：代理对 `document` 块不再静默跳过：模型支持 PDF 输入时转成 chat 的 file 内容块 / Responses 的 `input_file`，否则换成一段明确文本（说明 PDF 未送达、可用 `pages` 参数按页读取）；或由服务端告知 CLI 当前提供方不支持 PDF，让 `isPDFSupported` 为假。
- 确定程度：代码确认

### P-REQ-04 工具结果里的图片被换成文字占位，视觉模型看不到截图

- 类型：问题
- 严重程度：高
- 现状：tool_result 的内容块经 `extractToolResultContent` 拍平成字符串，图片变成 `[image omitted: <mime>]`（`toolArguments.ts:29-38`），chat（`anthropicToOpenaiChat.ts:114-120`）和 Responses（`anthropicToOpenaiResponses.ts:98-104`）都这样。产生图片结果的工具：Read 读图片（`FileReadTool.ts:650-666`）、Bash 输出 data URI（`src/tools/BashTool/utils.ts:71-90`）、内置浏览器截图（MCP 内容 `{type:'image'}`，`src/server/browserHost/service.ts:826`）以及其他返回图片的 MCP 工具。
- 场景：自定义 `openai_chat` 接一个视觉模型（例如 `qwen3-vl-plus` 或 OpenRouter 上的 Claude/GPT），用户让 agent 在内置浏览器里检查页面布局。截图工具返回 JPEG，上游只收到 `[image omitted: image/jpeg]`，模型无法完成任务，通常会反复截图，多花轮数。
- 参考：
  - ZCode（chat）：tool 消息里保留文本，图片移到紧随其后的一条 user 消息，并按模型输入能力决定保留还是换成说明文字（`zcode:apps/zcode-cli/packages/adapters/src/model/transform.ts:59-66,120-151`；`tool-result-media-projection.ts:26-39`）。
  - Codex（Responses）：`function_call_output` 的内容项支持 `input_image`（`codex:protocol/src/models.rs:2249-2261`）。DreamCoder 的 Responses 路径本可直接带图，却同样拍平。
- 改法方向：chat 路径把同一条 user 消息里所有 tool_result 的图片收集起来，在这些 tool 消息之后追加一条 user 消息放图片（文字留在 tool 消息里，并注明图片在下一条）；Responses 路径把图片作为 `function_call_output.output` 数组里的 `input_image`。是否发送图片取决于 P-REQ-11 的模型图像能力。
- 确定程度：代码确认

### P-REQ-05 `max_tokens` 不转发；上游按自身默认值截断，CLI 的截断提示与实际不符

- 类型：问题
- 严重程度：中
- 现状：CLI 对第三方模型默认 `max_tokens: 32000`（`src/utils/context.ts:203-262`；`src/services/api/claude.ts:3454-3474`，放进请求 `claude.ts:1765`）。`OpenAIChatRequest` 有 `max_tokens`、`max_completion_tokens` 字段但没有任何赋值（`types.ts:35-36`；`anthropicToOpenaiChat.ts:32-76`），`OpenAIResponsesRequest.max_output_tokens` 同样无赋值（`types.ts:112`；`anthropicToOpenaiResponses.ts:17-62`）。直接照抄 32000 也不行：它不是按模型给出的值。
- 场景：
  - 自定义 `openai_chat` 接 `https://api.deepseek.com`、模型 `deepseek-chat`：上游默认输出上限较小（外部文档记忆为 4K，未核实），Write 一个较大的文件时参数被截断，`finish_reason: length` → `max_tokens`，CLI 提示「exceeded the 32000 output token maximum」（`claude.ts:2316-2326`），被截断的工具参数解析失败后由 zod 报错回给模型，多出重试轮次。
  - 反方向：如果简单转发 32000，`qwen-max` 这类输出上限为 8192 的模型会直接 400（未核实具体上限）。
  - 压缩请求不设输出上限（`src/services/compact/compact.ts:1177-1191`），标题请求的 `max_tokens: 100`（`titleService.ts:8,85`）也被丢弃。
- 参考：ZCode 每步发 `min(模型输出上限, 窗口 − 估算输入 − 1000)`，模型未声明时 32K（`zcode:apps/zcode-cli/packages/core/src/runtime/methods/model-token-limits.ts:5-41`），chat 写 `max_completion_tokens`、Responses 写 `max_output_tokens`（`modelApiRules[2],[3]`），部分站点改写 `max_tokens` 并给出模型上限（`providerSiteRules[0]-[14]`）；适配层校验不超过模型上限（`zcode:apps/zcode-cli/packages/adapters/src/model/model.ts:112-121`）。Codex 不发送输出上限。
- 改法方向：代理把 `max_tokens` 写到上游字段（chat 默认 `max_tokens`，可按站点换 `max_completion_tokens`；Responses 写 `max_output_tokens`），并按模型上限截取；模型上限来自 provider 配置或模型列表，没有时不发送而不是发 32000。
- 确定程度：代码确认（各提供方默认值未核实）

### P-REQ-06 OpenAI 格式的 baseUrl 被强制改成 `<去掉 /v1 的 base>/v1/...`，路径里版本段不是 `/v1` 的端点无法接入

- 类型：问题
- 严重程度：中
- 现状：`normalizeUpstreamBaseUrl` 去掉结尾的 `/v1`（`src/server/upstream/baseUrl.ts:1-3`），然后固定拼 `/v1/chat/completions`、`/v1/responses`、`/v1/models`（`src/server/upstream/client.ts:136,212,220`）。测试也按这个行为写（`src/server/__tests__/upstream-client.test.ts:79-84`）。界面上 Base URL 的占位示例是 Anthropic 风格（`desktop/src/i18n/locales/en.ts:500`），没有说明 OpenAI 格式的写法。
- 场景：
  - 智谱 GLM 的 OpenAI 兼容端点 `https://open.bigmodel.cn/api/paas/v4`（以及 `https://api.z.ai/api/paas/v4`）→ 实际请求 `.../api/paas/v4/v1/chat/completions`，404。无论用户怎么填都拼不出正确路径。
  - 火山方舟 `.../api/v3`、Gemini 的 OpenAI 兼容端点 `.../v1beta/openai` 同理。Gemini 没有 Anthropic 兼容端点，因此在 DreamCoder 里完全无法接入（推断）。
  - 模型列表拉取（`client.ts:136`）也走同一个错误路径，连接测试就会失败。
- 参考：Codex 把配置的 base_url（默认 `https://api.openai.com/v1`）当作完整前缀，只拼 `/responses`（`codex:codex-client/src/provider.rs:55-62`；`codex:model-provider-info/src/lib.rs:430-446`）。ZCode 把 baseURL 原样交给 AI SDK，SDK 拼 `/chat/completions` 或 `/responses`（`zcode:apps/zcode-cli/packages/adapters/src/model/model-execution.ts:333-365`）。
- 改法方向：对 `openai_*` 把用户填写的 base 当作完整前缀，只追加 `/chat/completions`、`/responses`、`/models`；对已保存的、路径为空的 OpenAI 格式提供方（例如 `https://api.openai.com`）在读取时补 `/v1`，保证磁盘上已有配置继续可用；界面按格式给出示例。
- 确定程度：代码确认（各端点路径来自外部文档记忆，未核实）

### P-REQ-07 历史推理内容只对 deepseek / opencode.ai 域名回传，判断依据是域名而不是模型或上游实际返回的字段

- 类型：问题
- 严重程度：中
- 现状：`shouldUseDeepSeekReasoningCompat` 只看 baseUrl 是否含 `deepseek` 或 `opencode.ai`（`src/server/upstream/client.ts:251-256`），命中时同时打开两件事：把历史 thinking 写回 `reasoning_content`、透传 `thinking.type`（`client.ts:206-210`；`anthropicToOpenaiChat.ts:73-75,146-147,168-170`）。其他上游的历史 thinking 全部丢弃。Responses 路径从不回传推理（见 P-REQ-08）。响应侧把 `reasoning_content` / `reasoning` / `thinking_blocks` 都转成 thinking 块，signature 为空（见 model-adaptation.md Q2），请求侧因此不知道这段推理原来来自哪个字段。
- 场景：
  - 自定义 `openai_chat` 接 Kimi（`api.moonshot.cn`）的思考模型，多步工具调用：上一步的 `reasoning_content` 不回传。Moonshot 对思考模型在工具调用循环中要求保留 `reasoning_content`（外部文档，未核实是报错还是质量下降）。
  - DeepSeek 模型经 SiliconFlow、OpenRouter 等其他域名提供：不命中域名，推理丢失，思考开关也不透传。
  - opencode.ai 上的 GLM、Kimi 等非 DeepSeek 模型：也会被透传 `thinking:{type:"adaptive"}`；ZCode 对 opencode go 的这些模型只写 `reasoning_effort` 或什么都不写（`providerSiteRules[0]-[14]`）。
- 参考：ZCode 按模型把推理作为 reasoning part 交给 SDK，并在请求前规范化推理历史（跨模型的推理会去掉），空推理不写（`zcode:apps/zcode-cli/packages/adapters/src/model/transform.ts:371-394`；`zcode:apps/zcode-cli/packages/adapters/tests/openai-compatible-extra-body-wire.test.ts:106-133`）；SDK 是否把非空推理写成 `reasoning_content` 未核实。Codex（Responses）回传 reasoning item 和 `encrypted_content`，对非 OpenAI 提供方也保留（`codex:core/src/client.rs:1048-1059,1075`）。
- 改法方向：响应侧把推理来源字段记在 thinking 块上（例如写进现在为空的 signature），请求侧按这个记录写回同名字段；思考开关的写法并入 P-REQ-02 的按模型映射，不再与推理回传绑在同一个域名判断上。
- 确定程度：代码确认（各提供方是否要求回传未核实）

### P-REQ-08 Responses 路径不回传 reasoning item、不请求 `encrypted_content`、不请求推理摘要

- 类型：问题
- 严重程度：中
- 现状：Responses 请求固定 `store:false`（`anthropicToOpenaiResponses.ts:17-22`），没有 `include`、没有 `reasoning.summary`（`types.ts:107-125`）；历史中的 thinking 块在 `convertMessageToInputItems` 里没有分支，被丢弃（`anthropicToOpenaiResponses.ts:82-105`）。
- 场景：自定义 `openai_responses` 接 OpenAI `gpt-5.x`，一个回合内连续多次工具调用。`store:false` 下没有 `encrypted_content`，前一步的推理无法带入下一步，模型每步重新推理，输出 token 和延迟增加（OpenAI 文档建议在函数调用中回传推理项，外部文档，未核实具体影响）。未请求摘要，桌面上也看不到这类模型的思考内容（推断，取决于提供方默认）。
- 参考：Codex 总是带 `include: ["reasoning.encrypted_content"]`，回传 reasoning item，并在模型支持时发 `reasoning.summary`（`codex:core/src/client.rs:957-976,1075,1112-1128`）。ZCode 用 AI SDK 的 Responses 实现，并在无状态回放时只去掉 `store=true` 的 item 引用（`zcode:apps/zcode-cli/packages/adapters/src/model/transform.ts:371-385,406-416`）。
- 改法方向：Responses 请求带 `include: ["reasoning.encrypted_content"]` 和 `reasoning.summary: "auto"`；响应侧把 reasoning item 的 id 与 `encrypted_content` 存进 thinking 块；请求侧把这类 thinking 块还原成 `{type:"reasoning", encrypted_content, summary}` 输入项。
- 确定程度：代码确认（对模型表现的影响为推断）

### P-REQ-09 原生 web_search 服务端工具被翻译成一个没有参数的普通函数，搜索「成功」但没有结果，也不会回退到 Tavily/Brave

- 类型：问题
- 严重程度：中
- 现状：
  1. WebSearch 在模型名「像 Claude」时选原生 Anthropic 搜索（`src/tools/WebSearchTool/backend.ts:40-46,90-92,178-181`），正则对 `anthropic/claude-sonnet-4.5` 这类网关名也成立。
  2. 原生搜索把 `{type:'web_search_20250305', name:'web_search', …}` 作为 `extraToolSchemas` 发出（`src/tools/WebSearchTool/WebSearchTool.ts:90-98,383-424`）。
  3. 代理把每个工具都当作客户端函数：`{type:'function', function:{name, description, parameters: t.input_schema}}`（`anthropicToOpenaiChat.ts:47-58`；Responses 同样 `anthropicToOpenaiResponses.ts:35-45`）。服务端工具没有 `input_schema`，于是上游收到一个名为 `web_search`、没有参数定义的函数，`type`、`max_uses`、域名限制都丢失。
  4. 回退到外部搜索只在出错时发生，判断依据是错误文本含 400/422 或 web_search 等字样（`backend.ts:112-120`；`WebSearchTool.ts:298-345`）。上游接受了这个函数，不报错，所以不会回退。
- 场景：自定义 `openai_chat` 接 OpenRouter，模型 `anthropic/claude-sonnet-4.5`，并在设置里配了 Tavily key。模型调用 WebSearch → 二次请求里模型要么调用这个空参数函数（返回普通 tool_use，而不是 `server_tool_use` / `web_search_tool_result`），要么直接用文字作答；WebSearch 拿不到任何结果块，返回空结果或模型编造的文本（推断），Tavily 从未被使用。
- 参考：ZCode 只在 anthropic-messages 且模型声明支持时编码原生搜索，其他协议直接报错（`zcode:apps/zcode-cli/packages/adapters/src/model/tool-transform.ts:250-283`）。Codex：无对应。
- 改法方向：代理遇到带 `type` 字段的服务端工具时返回 400（错误文本含 `web_search`），让现有回退逻辑生效；更直接的做法是服务端在提供方为 `openai_*` 时告知 CLI 不使用原生搜索。
- 确定程度：代码确认（上游与模型的具体反应为推断）

### P-REQ-10 没有任何缓存键或会话亲和信息，CLI 已经提供的会话 id 被丢弃

- 类型：优化
- 严重程度：中
- 现状：CLI 给每个请求带 `X-Claude-Code-Session-Id` 头（`src/services/api/client.ts:155-158`）和 `metadata.user_id`（内含 `session_id`、`device_id`，`src/services/api/claude.ts:502-527,1764`），还在 system、工具和最后一条消息上标 `cache_control`。代理只读 body（`handler.ts:54-64`），类型里没有 `metadata`（`types.ts:161-181`），发往上游的头只有 `Content-Type` 和 `Authorization`（`client.ts:213,221`）。
- 场景：
  - 自定义 `openai_responses` 接 OpenAI：没有 `prompt_cache_key`，同一会话的请求可能落到不同缓存节点（OpenAI 文档说明该字段影响缓存路由，未核实命中率差异）。
  - 自定义 `openai_chat` 接 opencode.ai：ZCode 会带 `x-opencode-session`，DreamCoder 不带。
  - OpenRouter 上的 Claude / Gemini 模型、DashScope 的显式缓存，都接受 OpenAI 格式内容块上的 `cache_control`（外部文档，未核实）；代理丢弃，这些模型在 OpenAI 格式下拿不到缓存。
  - 此项要在 P-REQ-01 修掉之后才有收益。
- 参考：Codex 发 `prompt_cache_key`（默认取会话 id，子线程用 `<来源>:<父线程 id>`）和 `session-id` 头（`codex:core/src/client.rs:657-689,1124`；`codex:core/src/thread_manager.rs:271-281`；`codex:codex-api/src/requests/headers.rs:8`）。ZCode 对所有提供方发 `x-session-id`、`x-request-id` 等，对 opencode go 另发 `x-opencode-session`（`zcode:apps/zcode-cli/packages/adapters/src/model/runner-attribution.ts:35-66`）；它在 chat 路径上同样不发 `cache_control`（推断，见 request-cache.md Q3）。
- 改法方向：代理读取 `X-Claude-Code-Session-Id`，Responses 写 `prompt_cache_key`，chat 对已知支持的站点写 `prompt_cache_key` 或会话头；对已知接受 `cache_control` 的上游（OpenRouter 的 Claude/Gemini、DashScope）把断点挪到对应 OpenAI 内容块上。
- 确定程度：代码确认（提供方支持情况未核实）

### P-REQ-11 用户图片无条件以 `image_url` 发给上游，不看模型是否支持图像

- 类型：问题
- 严重程度：中
- 现状：user 消息里的 image 块直接转成 `image_url` data URL（`anthropicToOpenaiChat.ts:111-113`）或 `input_image`（`anthropicToOpenaiResponses.ts:85-89`）。DreamCoder 没有模型图像能力的配置（`src/server/types/provider.ts:47-60` 无此字段），代理拿到的 `UpstreamTarget` 也只有 baseUrl、key、格式和鉴权（`client.ts:26-31`）。
- 场景：Qwen 预设 `qwen-max`（纯文本模型）或自定义 `deepseek-chat`，用户在对话里贴一张截图。上游以「不支持图片输入」拒绝（未核实具体错误）；图片留在历史里，之后同一会话的每个请求都带着它，会话无法继续，只能新开。
- 参考：ZCode 每个模型有 `inputFormat`，基线规则为不支持图片（`modelRules[0]`），不支持时把图片换成说明文字（`zcode:apps/zcode-cli/packages/adapters/src/model/transform.ts:484-497`；`media-transform-policy.ts:8-15`）。Codex 回退元数据默认支持文本+图像，不支持时在构造请求时剥离（见 request-cache.md Q4）。
- 改法方向：provider 配置里按模型记录是否支持图像（模型列表能提供时自动填），代理在不支持时把图片换成一段说明文字；与 P-REQ-04 共用同一个能力判断。
- 确定程度：代码确认（提供方报错行为未核实）

### P-REQ-12 不发送 `parallel_tool_calls`

- 类型：优化
- 严重程度：低
- 现状：chat 与 Responses 请求都没有 `parallel_tool_calls`（`types.ts:32-46,107-125`）；CLI 侧也不使用 `disable_parallel_tool_use`（grep 无结果）。
- 场景：Qwen 预设走 DashScope，`parallel_tool_calls` 默认为 false（外部文档记忆，未核实），模型每轮只发一个工具调用；agent 并行读多个文件时变成多轮，延迟和输入 token 都增加。
- 参考：Codex 请求固定带 `parallel_tool_calls`（`codex:core/src/client.rs:1117`）。ZCode 未找到设置。
- 改法方向：chat 与 Responses 请求在有工具时发 `parallel_tool_calls: true`；个别不接受该字段的站点再单独关闭。
- 确定程度：代码确认（DashScope 默认值未核实）

### P-REQ-13 工具 schema 原样转发，带 `$schema`、超大 `maximum` 等提供方用不上的关键字

- 类型：优化
- 严重程度：低
- 现状：内置工具的 schema 由 zod v4 `toJSONSchema` 生成（`src/utils/zodToJsonSchema.ts:5,17-23`），形状如 `{"$schema":"https://json-schema.org/draft/2020-12/schema", …, "additionalProperties":false}`，整数字段带 `"maximum":9007199254740991`，URL 字段带 `"format":"uri"`（本地用仓库 zod 打印确认）。代理把 `input_schema` 原样作为 `parameters`（`anthropicToOpenaiChat.ts:47-58`；`anthropicToOpenaiResponses.ts:35-45`）。MCP 工具的 schema 也原样转发。
- 场景：每个请求的约 30 个内置工具都带一个 `$schema` URL（约 55 个字符），总计约 1.6K 字符；对校验较严格的 OpenAI 兼容后端（例如基于 OpenAPI 子集的函数声明），`$schema` 或 `format` 可能导致 400（哪些提供方会拒绝未核实）。
- 参考：Codex 把工具 schema 规范化成一个受限子集，只保留 type、description、properties、required、items、enum、anyOf/oneOf/allOf、`$ref`/`$defs`、additionalProperties 等（`codex:tools/src/json_schema.rs:47-116`；`codex:tools/src/json_schema/types.rs:40-77`）。ZCode 原样发送，只对 Kimi K3 把 `$ref` 提升到 `$defs`（`zcode:apps/zcode-cli/packages/adapters/src/model/tool-transform.ts:96-153`；`providerSiteRules[34]`）。
- 改法方向：代理在转换工具时去掉顶层 `$schema` 和等于 `Number.MAX_SAFE_INTEGER` 的 `maximum`；更多关键字的清理等出现具体提供方报错时再按站点加。
- 确定程度：代码确认（提供方拒绝情况未核实）

### P-REQ-14 服务端标题请求在 OpenAI 格式上既不限输出也关不掉思考

- 类型：问题
- 严重程度：低
- 现状：标题请求是非流式、15 秒超时、`max_tokens: 100`，只有用户设置 `alwaysThinkingEnabled === false` 时才带 `thinking:{type:'disabled'}`（`src/server/services/titleService.ts:82-89,177-180`）。经 `sendToUpstream` 转换后：`max_tokens` 丢弃（P-REQ-05），`disabled` 只在 deepseek/opencode.ai 域名透传，其余上游没有关闭思考的字段（P-REQ-02）。
- 场景：自定义 `openai_chat` 接一个默认开思考的模型（例如 Kimi 思考模型），第一条用户消息后生成标题：上游完整推理、没有输出上限，非流式等待超过 15 秒即 `Request timed out`，会话没有 AI 标题（推断）。DashScope 的部分开源 Qwen3 模型对非流式请求要求关闭思考（外部文档记忆，未核实），这类模型的标题请求会直接 400。
- 参考：ZCode 无头模式不生成标题；ZCode 与 Codex 都没有对应的服务端标题请求（见 request-cache.md Q6）。
- 改法方向：标题请求总是声明「关闭思考」，并依赖 P-REQ-02、P-REQ-05 的映射把它和 `max_tokens` 写到上游字段。
- 确定程度：代码确认（超时与 400 为推断/未核实）

### P-REQ-15 结构化输出（`output_config.format`）被丢弃

- 类型：优化
- 严重程度：低
- 现状：prompt 类 hook 用 `outputFormat` 要求 JSON schema 输出（`src/utils/hooks/execPromptHook.ts:61-98`），CLI 放进 `output_config.format`（`claude.ts:1626-1636`）；代理类型里没有 `output_config`（`types.ts:161-181`），不转成 `response_format` / `text.format`。hook 只靠 system 里的文字要求返回 JSON，解析失败时报 `JSON validation failed`（`execPromptHook.ts:110-127`）。
- 场景：用户配置了 `type: "prompt"` 的 hook，提供方为 Qwen 预设。小模型偶尔在 JSON 外加说明文字或代码围栏，hook 判为非阻塞错误，条件检查失效。
- 参考：ZCode 按模型 `supportsJsonSchemaOutput` 决定是否让 SDK 发原生 JSON schema 输出（`zcode:apps/zcode-cli/packages/adapters/src/model/model-execution.ts:356-365`；`runner-options.ts` 中 `withNativeGenerateOutputFormat`）。Codex 把输出 schema 写进 `text`（`codex:core/src/client.rs:1090-1094`）。
- 改法方向：`output_config.format` 为 json_schema 时，chat 写 `response_format: {type:"json_schema", …}`，Responses 写 `text.format`；模型不支持时退回 `json_object` 或不写。
- 确定程度：代码确认

### P-REQ-16 提供方缺少自定义请求头、查询参数和请求体补丁的配置项

- 类型：优化
- 严重程度：低
- 现状：`SavedProvider` 只有 baseUrl、key、鉴权方式、格式、模型、上下文窗口（`src/server/types/provider.ts:47-60`）；`UpstreamTarget` 不带 presetId 和模型信息（`client.ts:26-31`），代理里唯一的提供方分支是 P-REQ-07 的域名判断。上游请求头固定为 `Content-Type` + `Authorization: Bearer`（`client.ts:213,221`）。
- 场景：Azure OpenAI 需要 `api-key` 头和 `api-version` 查询参数，无法配置；OpenRouter 的应用标识头、DashScope 的 `enable_thinking` 这类按模型的 body 字段，只能等代码内置规则。
- 参考：Codex provider 配置有 `http_headers`、`env_http_headers`、`query_params`（`codex:model-provider-info/src/lib.rs:172-181,400-420`）。ZCode provider 有 `api.headers`（`zcode:apps/zcode-cli/packages/adapters/src/model/model-execution.ts:401-411`），并有手动模型规则覆盖内置规则（见 model-adaptation.md Q4）。
- 改法方向：provider 配置增加可选的额外请求头和额外 body 字段（按模型匹配），代理在构造上游请求时合并；P-REQ-02、P-REQ-05、P-REQ-11 的内置规则也通过同一结构表达。
- 确定程度：代码确认

### 按提供方的对照（第 6 项）

DreamCoder 代理里唯一的提供方分支是 `shouldUseDeepSeekReasoningCompat`（`client.ts:251-256`）；其余提供方的请求完全相同。预设里只有 Qwen 是 `openai_chat`，DeepSeek、Kimi、智谱、LM Studio、Ollama 预设都是 `anthropic` 格式，不经代理（`src/server/config/providerPresets.json`）。下表是用户以自定义提供方接 OpenAI 格式端点时的情况。

| 提供方 | DreamCoder 代理 | ZCode 规则 |
|---|---|---|
| DeepSeek（`api.deepseek.com`） | 回传 `reasoning_content`；透传 `thinking.type`（可能是 `adaptive`） | chat：`thinking.type` enabled/disabled + `reasoning_effort`（`modelApiRules[37],[39],[63],[67]`）；Responses：`reasoning.effort`（`providerSiteRules[42]-[44]`）；v4-flash 支持图片（`providerSiteRules[45]`） |
| Kimi（`api.moonshot.cn/v1`） | 无 | k2.5/k2.6：`thinking.type`（`modelApiRules[33],[35]`）；k3：`reasoning_effort`（`[24],[26]`）；k2.7-code 三种协议各自映射（`[29]-[31]`） |
| 智谱 GLM（`/api/paas/v4`） | 无法接入（P-REQ-06） | chat 落到通用映射（`modelApiRules[2]`）；opencode go 上按模型给 `reasoning_effort` 档位和 `max_tokens` 上限（`providerSiteRules[0]-[3]`） |
| Qwen（DashScope，预设） | 无（思考与 effort 都不发） | plus/flash/3.5–3.7：`enable_thinking`（`modelApiRules[44],[46],[48],[50],[69]`）；3.8：`reasoning_effort`（`[41]`） |
| MiniMax | 无 | 只有 opencode go 上 anthropic 协议的条目（`providerSiteRules[15]-[17]`） |
| OpenRouter | 无 | chat 上部分模型写 `reasoning:{effort}` / `reasoning:{enabled}`（`providerSiteRules[49],[50]`），并给出窗口、输出上限（`[48],[51]`） |
| opencode.ai | 与 DeepSeek 同一兼容分支（对所有模型） | 每个模型给 `reasoning_effort` 档位、`max_tokens` 上限、图像能力（`providerSiteRules[0]-[14]`）；请求带 `x-opencode-session`（`runner-attribution.ts:47-64`） |
| 未知模型 | 无 | 通用映射写 `thinking.type`、`enable_thinking`、`reasoning_effort`、`reasoning.effort`、`max_completion_tokens`（`modelApiRules[2]`），基线不支持图片/PDF（`modelRules[0]`） |

DreamCoder 缺少的配置维度：推理字段的写法与档位、输出上限字段名与上限、图像/PDF 输入能力、推理回传字段、JSON schema 输出支持、`parallel_tool_calls`、会话头与缓存键、自定义头与 body 字段、base 路径。

### 其余检查过、未列为发现的项

- system 块顺序：CLI 为 [计费行（仅 Claude 名）][CLI 前缀句][各段][advisor]（`claude.ts:1394-1404`），代理再在最前插计费行，用 `\n` 拼接（`anthropicToOpenaiChat.ts:23`；`anthropicToOpenaiResponses.ts:28`）。ZCode 合并开头连续 system 时用空串拼接，靠各段自带边界（`zcode:apps/zcode-cli/packages/adapters/src/model/system-message-compat.ts:6-35`）。除 P-REQ-01 外，代理侧的转换是确定性的，同一份历史两次转换得到相同字节；会话内其他可能变化的前缀内容（MCP 说明、中途新增工具、locale 相关排序）在 CLI 侧，见 request-cache.md Q2。
- 消息顺序：同一条 user 消息里的 tool_result 先输出为 tool 消息，文本和图片放在其后的 user 消息（`anthropicToOpenaiChat.ts:105-131`），满足「tool 结果紧跟 tool_calls」。CLI 在 `normalizeMessagesForAPI` 中已合并相邻 user 消息、去掉只有 thinking 的孤立 assistant 消息、给空 assistant 补占位（`src/utils/messages.ts:2316-2345,5027-5060,5085-5150`），代理没有再遇到连续同角色或空 assistant 的输入路径。
- `is_error`：转换时丢弃，但 CLI 的错误结果文本已带 `<tool_use_error>` 包裹（`src/services/tools/toolExecution.ts:402,481,671`），模型能区分。chat 与 Responses 都没有对应字段。
- `tool_choice`：auto→auto、any→required、none→none、tool→指定函数（`anthropicToOpenaiChat.ts:175-187`；Responses 为扁平形状 `anthropicToOpenaiResponses.ts:125-137`）。CLI 唯一发 `type:'tool'` 的地方是 WebSearch 的小模型分支，受 `tengu_plum_vx3` 控制、默认关（`WebSearchTool.ts:395-414`）。
- `stop_sequences`：chat 转为 `stop`，Responses 丢弃（`anthropicToOpenaiChat.ts:43-45`）。CLI 只在 yolo 分类器和 sideQuery 中使用（`src/utils/permissions/yoloClassifier.ts:792`；`src/utils/sideQuery.ts:187`），本场景默认不触发。
- `temperature`：只在思考关闭时发 1（`claude.ts:1741-1745`），即 WebFetch 二次处理、hook 等辅助请求和用户关闭思考时；未找到会因此报错的具体模型。
- `defer_loading` 与 `tool_reference`：代理场景下 ToolSearch 默认关闭（ANTHROPIC_BASE_URL 非 Anthropic 官方，`src/utils/toolSearch.ts:296-309`），服务端不设 `ENABLE_TOOL_SEARCH`；用户手动开启时 `tool_reference` 会变成 `[omitted content: tool_reference]`（`toolArguments.ts:43-44`），所有工具仍全量发送。
- 工具名长度：MCP 工具名只做字符替换、不截断（`src/services/mcp/normalization.ts:17-23`；`mcpStringUtils.ts:50-52`），超过 64 字符时 Anthropic 与 OpenAI 端点都会拒绝，不是代理特有的问题。
- 空内容：空数组 content 转成 `content: ''`（`anthropicToOpenaiChat.ts:93-96`）；ZCode 用 `(no content)` 防止提供方把空串当缺失（`zcode:apps/zcode-cli/packages/adapters/src/model/transform.ts:457-469`）。没找到 CLI 发出空 user content 的具体路径，未列为发现。
- 多个 assistant 文本块用 `+=` 直接相连、没有分隔（`anthropicToOpenaiChat.ts:144-145`）；CLI 把 tool_use 重排为连续段（`messages.ts:2318-2330`），两段文本会被粘在一起。影响很小，未列为发现。

### 辅助请求的请求侧（第 7 项）

| 请求 | 是否经代理 | 请求侧特点 |
|---|---|---|
| 子代理 | 是 | 各自的 system，带计费行（指纹按子代理首条 user 文本算）；与主会话同一进程、同一 `X-Claude-Code-Session-Id`，可共用缓存键（P-REQ-10） |
| WebFetch 二次处理（`queryHaiku`） | 是 | fastModel、思考关闭、`temperature: 1`、无工具；计费行照加；关闭思考的字段到不了上游（P-REQ-02） |
| 压缩 | 是 | 与主循环相同的 system、工具和历史，加一条压缩提示，不设输出上限（`compact.ts:1150-1191`）；本意复用主循环缓存，因 P-REQ-01 不成立；输出无上限（P-REQ-05） |
| prompt hook | 是 | 结构化输出要求被丢弃（P-REQ-15） |
| 服务端标题 | 否（直接 `sendToUpstream`） | 无计费行；`max_tokens` 与关闭思考都到不了 OpenAI 格式上游（P-REQ-14） |

## 2. 已知结论的核实

| 已知结论 | 核实结果 | 位置与补充 |
|---|---|---|
| 代理在开头加计费行，`cch` 是整个请求体的哈希，请求开头每次都变 | 确认，并补充 | `handler.ts:64`；`claudeCodeAttribution.ts:29-46`；`client.ts:214,222`；`claudeCodeCch.ts:56,135-139`。补充：代理加这行无视服务端按模型名关闭计费行的策略（`attributionHeaderPolicy.ts:3-15`）；Claude 名模型由 CLI 预先签名，代理不重签，结果同样逐请求变化；标题请求是唯一不带这行的请求；仓库内没有读取它的下游。 |
| `max_tokens` 和 effort 不转发 | 确认，并补充 | `types.ts:35-36,112` 有字段无赋值；`types.ts:161-181` 无 `output_config`。补充：`thinking: adaptive/disabled` 也不产生任何字段，带 budget 的映射在现有配置下走不到；直接转发 32000 会超出部分模型上限（P-REQ-02、P-REQ-05）。 |
| 上游错误统一包成 `api_error`，响应头（含 `retry-after`）丢失 | 不在本部分范围 | 代码位置与描述一致（`handler.ts:66-71`；`client.ts:83-89`），留给错误方向的评审。 |
| `reasoning_content` 只对 deepseek 与 opencode.ai 域名写回 | 确认，并补充 | `client.ts:206-210,251-256`；`anthropicToOpenaiChat.ts:146-147,168-170`。补充：同一判断还打开 `thinking.type` 透传，对 opencode.ai 上的所有模型生效；Responses 路径完全不回传（P-REQ-07、P-REQ-08）。 |
| 工具结果里的图片变成 `[image omitted]` | 确认，并补充 | `toolArguments.ts:37-38`，chat 与 Responses 两条路径都是。补充：PDF 的 `document` 块不在 tool_result 里，被完全静默丢弃（P-REQ-03）；Responses 本可在 `function_call_output` 里带图片（P-REQ-04）。 |
| 流式工具调用没有 id 时被丢弃 | 不在本部分范围 | 响应方向。 |
| `cache_control` 被丢弃，不发缓存键或会话头 | 确认，并补充 | `types.ts:149-181` 只声明不使用；`client.ts:213,221` 只有两个头。补充：CLI 已经给代理带了 `X-Claude-Code-Session-Id` 和 `metadata.user_id`，代理没读（P-REQ-10）。 |

## 3. 覆盖范围

完整阅读：
- DreamCoder：`src/server/proxy/handler.ts`、`src/server/proxy/claudeCodeAttribution.ts`、`src/server/upstream/client.ts`、`src/server/upstream/baseUrl.ts`、`src/server/proxy/transform/anthropicToOpenaiChat.ts`、`anthropicToOpenaiResponses.ts`、`types.ts`、`toolArguments.ts`、`src/utils/claudeCodeCch.ts`、`src/constants/claudeCodeCompatibility.ts`、`src/server/services/attributionHeaderPolicy.ts`、`src/server/services/titleService.ts`、`src/server/config/providerPresets.json`、`src/server/types/provider.ts`。
- ZCode：`apps/zcode-cli/packages/adapters/src/model/transform.ts`、`tool-transform.ts`、`strict-tool-schema.ts`、`system-message-compat.ts`、`runner-attribution.ts`、`model-request-headers.ts`、`opencode-session.ts`、`media-transform-policy.ts`；`config/provider/zcode-builtin.json` 的 `modelApiRules` 全部、`providerSiteRules` 全部、`modelRules[0]`；`patches/@ai-sdk__openai-compatible@2.0.60.patch`；`core/src/runtime/methods/model-token-limits.ts`。
- Codex：`core/src/client.rs` 640–690、950–1135 行；`tools/src/json_schema.rs` 前 130 行与 `json_schema/types.rs`；`core/src/thread_manager.rs` 的 `PromptCacheKey`；`codex-client/src/provider.rs` 的 URL 拼接；`model-provider-info/src/lib.rs` 的 provider 字段。

部分阅读：`src/services/api/claude.ts`（metadata、system 组装、参数构造 1380–1420、1560–1790、3450–3475 行）、`src/services/api/client.ts`（默认头与 fetch 包装）、`src/utils/messages.ts`（normalize 末段与 thinking 过滤）、`src/tools/FileReadTool/FileReadTool.ts`（图片/PDF 结果）、`src/tools/WebSearchTool/backend.ts` 与 `WebSearchTool.ts`、`src/utils/toolSearch.ts`、`src/utils/api.ts`（`toolToAPISchema`）、`src/utils/effort.ts`、`src/utils/context.ts`（输出上限）、`src/server/services/providerRuntimeEnv.ts`、`src/utils/hooks/execPromptHook.ts`；ZCode 的 `model-execution.ts`、`runner-options.ts`、`tool-result-media-projection.ts`（前 60 行）与相关测试。

未覆盖：
- 响应方向（流转换、usage、无 id 工具调用）见 [response.md](response.md)，错误和重试见 [transport.md](transport.md)。
- CLI 内的 `azureOpenAI` 直连路径（`claude.ts:1027-1050`）不经代理，未看。
- `src/utils/fingerprint.ts` 的算法细节未重读，沿用 request-cache.md 的结论。
- ZCode 的 `reasoning-history-normalization.ts` 只看了调用点；`@ai-sdk/openai-compatible` 是否把推理写成 `reasoning_content` 仍未核实（refs 中无该依赖源码）。
- 所有提供方行为（默认输出上限、是否接受 `adaptive`、是否要求回传推理、`parallel_tool_calls` 默认值、`cache_control` 支持、端点路径）均来自外部文档记忆，没有联网核实，已逐条标注。
