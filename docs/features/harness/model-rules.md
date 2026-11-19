# 按模型的规则表：技术设计

状态：已实现（`feat/model-rules`，2026-11-19），方向由维护者确认（2026-11-18）。对应 [#264](https://github.com/GoDiao/dreamcoder/issues/264)。文中 path:line 指改动前的 `052a0e63`。

## 背景

DreamCoder 通过本地代理把 CLI 的 Anthropic 请求转成 OpenAI chat 或 Responses 格式，接 DeepSeek、Qwen、Kimi、GLM、MiniMax、OpenRouter 等提供方。CLI 继承自 Claude Code，按 Claude 的模型名推断能力；第三方模型的能力只能按提供方声明，代理拿不到任何模型信息。结果是同一个设置在不同模型上要么传不到上游，要么传了上游不认的字段（见 [proxy/request.md](proxy/request.md)、[proxy/response.md](proxy/response.md)、[proxy/transport.md](proxy/transport.md) 的 P-REQ、P-RES、P-NET 各条）。

#264 的其余条目（effort 和思考开关、能力声明、推理回传、图片和 PDF、上下文窗口、输出上限、原生搜索、结构化输出、额外请求体字段）都需要一个共同的东西：对「这个提供方上的这个模型」给出一份确定的规则。本文设计这张规则表。

## 目标与非目标

目标：

- 一张规则表，sidecar 负责存放和解析，代理和 CLI 读同一份解析结果。
- 已知模型有条目，任何没收录的模型都能通过一条通用兜底条目正常工作，并且界面能看出它在用兜底。
- 模型本身的事实（窗口、输出上限、思考控制方式和档位、图片、PDF、结构化输出）和端点的写法（思考写到哪个字段、输出上限字段名、原生搜索、额外请求体字段）分开描述。
- 用户可以按「提供方 + 模型」覆盖窗口、输出上限、思考档位、图片、PDF。
- 提供方 models 接口拉到的窗口和输出上限在保存提供方时存下来，参与解析。
- 替换现有的能力声明通道，不留兼容层。

非目标：

- 不做远程下发，表随应用版本发布。
- 不接外部实时目录（models.dev 一类）。
- 写法（`reasoningDialect`）和 `extraBody` 这一轮不提供设置界面，只能在 `providers.json` 里写。
- 不覆盖文字层的问题（#270 及其子 issue，包括 Read 工具描述里关于图片和 PDF 的条文）。
- 提供方是官方 Anthropic 地址、或者完全没有提供方时，不走这张表，CLI 按原有逻辑推断 Claude 的能力。桌面端没有提供方时会话起不来（`src/server/services/conversationService.ts:1100-1108` 抛 `PROVIDER_NOT_CONFIGURED`），所以后一种情况只出现在终端路径。
- Gemini 原生 OpenAI 兼容端点上工具调用的 `thought_signature` 回传不在本轮，见「推理回传」。
- 用户在终端里直接运行 CLI（不经过桌面端 sidecar 启动）的路径不生成规则，见「CLI」一节。

## 现状

### 能力只能按提供方声明

- 第三方模型唯一的能力声明入口是三个档位变量 `ANTHROPIC_DEFAULT_{OPUS,SONNET,HAIKU}_MODEL_SUPPORTED_CAPABILITIES`，模型名必须和档位值完全相等才命中（`src/utils/model/modelSupportOverrides.ts:30-49`）。读者是 `thinking.ts:92,126`、`effort.ts:28,54`、`betas.ts:93`。
- custom 提供方对三档一律写 `thinking,effort,adaptive_thinking,max_effort`（`src/server/services/providerRuntimeEnv.ts:231-238`）。预设里只有 DeepSeek 声明能力（`src/server/config/providerPresets.json` 的 `defaultEnv`）。
- 没声明的模型（Kimi、GLM、Qwen）：`modelSupportsThinking` 为 false（`src/utils/thinking.ts:91-117`），`modelSupportsEffort` 对未知名字在 firstParty 下为 true（`src/utils/effort.ts:48`）。于是请求里不发 thinking，却发 `output_config.effort`（P-NET-14）。
- Kimi、智谱预设另用 `DREAMCODER_SEND_DISABLED_THINKING` 让关思考时发 `thinking:{type:'disabled'}`（`thinking.ts:183-185`，读者 `src/services/api/claude.ts:1606-1608` 和 `src/utils/sideQuery.ts:226`）。

### 按模型存下来的只有窗口，而且有三份

- CLI 内置表 `src/utils/model/modelContextWindows.ts:5-48`、预设的 `modelContextWindows`、提供方保存的 `modelContextWindows`（`src/server/types/provider.ts:60`）。server 把后两者合并成 `CLAUDE_CODE_MODEL_CONTEXT_WINDOWS` 给 CLI（`providerRuntimeEnv.ts:225-228, 243-245`）。CLI 内置表里也有官方 Claude 的条目（`claude-opus-4-7` 为 1M，`modelContextWindows.ts:6-8`），官方地址的窗口也靠它。
- 「拉取模型」只在用户点击时运行，只取窗口，server 不保存结果（`src/server/types/provider.ts:120`，`desktop/src/components/settings/ProviderFormModal.tsx:573-607`）。
- 未列出的模型窗口按 200,000（`src/utils/context.ts:11`），输出上限按 32,000/64,000（`context.ts:252-255`）。

### 代理拿不到模型信息

- `UpstreamTarget` 只有连接字段（`src/server/upstream/client.ts:40-48`）。`getProviderForProxy` 拿到了完整提供方配置，但只往下传连接信息（`src/server/services/providerService.ts:287-296`）。
- 思考映射只认 budget 和 `enabled`，`adaptive`、`disabled` 不产生字段（`src/server/proxy/transform/anthropicToOpenaiChat.ts:66-78`）。`output_config` 不在代理的请求类型里（`src/server/proxy/transform/types.ts:171-191`）。`max_tokens` 不转发（`anthropicToOpenaiChat.ts:33-46`）。
- `reasoning_content` 回写和 thinking 透传按 base URL 正则判断 DeepSeek 和 opencode.ai（`client.ts:339-344`）。

### 重复

- effort 档位写死在五处：`src/utils/effort.ts:13-18`、`src/server/api/models.ts:28`、`desktop/src/stores/sessionRuntimeStore.ts:9-10`、`desktop/src/components/controls/ModelSelector.tsx:98-103`、`desktop/src/components/settings/GeneralSettings.tsx:126-131`。类型和 schema 里还有几处（`desktop/src/types/settings.ts:12`、`src/entrypoints/sdk/coreSchemas.ts:1060,1169`、`src/entrypoints/sdk/controlSchemas.ts:557`），代理类型里的 `reasoning_effort` 只有 low/medium/high（`src/server/proxy/transform/types.ts:45`）。
- DeepSeek 特判三处，条件各不相同：`src/utils/providerManagedEnvCompat.ts:9-21`、`client.ts:339-344`、`src/server/upstream/contextWindows/deepseek.ts:5`。另有按 base URL 判断 MiniMax 的 `isMiniMaxAnthropicEndpoint`（`thinking.ts:112-122`）。

### CLI 一个会话里会调用哪些模型

第三方提供方下，server 给三档只写两个值：选中模型占 OPUS 和 SONNET，快速模型占 HAIKU 和 SMALL_FAST（`providerRuntimeEnv.ts:248-252`）。Agent 工具的 `model` 参数只允许 `sonnet`/`opus`/`haiku`，经档位解析到这两个模型之一（`src/tools/AgentTool/AgentTool.tsx:87`，`src/utils/model/agent.ts:37-95`）。但下面几处可以写任意模型 id，原样作为请求模型：

- agent 定义的 `model:`（`src/tools/AgentTool/loadAgentsDir.ts:585-591`）
- skill 的 `model:`（`src/skills/loadSkillsDir.ts:222-226`）
- plugin 命令的 `model:`（`src/utils/plugins/loadPluginCommands.ts:276`）
- hook 的 `model`，包括 agent 类 hook（`src/schemas/hooks.ts:81-85, 149`）
- 环境变量 `CLAUDE_CODE_SUBAGENT_MODEL`（`agent.ts:43-45`）
- agent teams 队友：`/config` 里的 `teammateDefaultModel`（`src/tools/shared/spawnMultiAgent.ts:72-78`），都没设时用硬编码的 Claude Opus 4.6 id（`src/utils/swarm/teammateModel.ts:8-10`；推断：会发给第三方上游）
- 用 `--agent` 指定的主线程 agent 的模型（`src/main.tsx:2074`、`src/cli/print.ts:4454`）。server 不传 `--agent`，桌面端会话不走这条路径。

会话中途换模型、换 effort 时 server 重启 CLI（`src/server/ws/handler.ts:742, 781-811`），所以每个 CLI 进程启动时的模型集合是固定的。编辑提供方和切换思考开关不会重启 CLI（思考开关走控制请求，`src/server/api/settings.ts:119`）。

## 方案概览

```
            内置表 modelRules.json ──┐
  提供方 discoveredModels（保存时拉取）├──► resolveModelRules(provider, modelId) ──► ResolvedModelRules
       提供方 modelOverrides（用户）─┘            （sidecar）
                                                      │
              ┌───────────────────────────────────────┼─────────────────────────┐
              ▼                                       ▼                         ▼
   代理：每个请求解析一次                CLI：启动时一个 JSON 环境变量        桌面端和 H5：GET /api/providers
   决定字段、输出上限、模态、回传         决定能力判断、窗口、输出上限          effort 档位、兜底标记、覆盖表单
```

1. **两层规则**。模型层描述模型本身，端点层描述端点怎么写。两层用同一种条目形状，区别只在匹配条件；模型层只设能力字段，端点字段只在站点层（可以带模型前缀）和 apiFormat 层设。
2. **六层叠加**，从低到高，后面的按字段覆盖前面的：
   1. 通用兜底
   2. 按 apiFormat 的默认写法
   3. 模型条目
   4. 站点条目：先叠只按 host 和 apiFormat 匹配的条目，再叠同一 host 和 apiFormat 下带模型前缀的条目
   5. 提供方 models 接口拉到的数值
   6. 用户覆盖
3. **每层（站点层的两步各算一层）只取一条命中的条目**。模型层按最长前缀；站点层先按 host 和 apiFormat 取一条，再在同一 host 和 apiFormat 下按模型前缀取最长的一条。不像 ZCode 那样把所有命中的规则叠加。
4. **思考的写法是一个封闭枚举**，由代理代码实现，表里只选用哪一种。其余固定字段放 `extraBody`。
5. **推理回传按来源字段**。代理在思考块上记下推理从哪个字段来，下一轮原样写回。
6. **sidecar 解析，CLI 和代理只读结果**。旧的三档能力变量、`CLAUDE_CODE_MODEL_CONTEXT_WINDOWS`、`DREAMCODER_SEND_DISABLED_THINKING` 直接删除。

## 数据模型

### 规则条目

```ts
type ReasoningControl = 'none' | 'toggle' | 'effort' | 'toggle_effort' | 'always'

type ModelRuleFields = {
  contextWindow?: number
  maxOutputTokens?: number
  reasoning?: {
    control: ReasoningControl
    levels?: EffortLevel[]
  }
  input?: { image?: boolean; pdf?: boolean }
  structuredOutput?: boolean
  thinkTagsInText?: boolean
  reasoningReplay?: 'same_as_received' | 'off'
  unmarkedReasoningReplay?: 'reasoning_content' | 'none'
  reasoningDialect?: ReasoningDialect
  maxTokensField?: 'max_tokens' | 'max_completion_tokens' | 'max_output_tokens'
  nativeWebSearch?: boolean
  extraBody?: Record<string, unknown>
}

type ModelRuleEntry = {
  match: { modelPrefix: string }
  source: { url: string; checkedAt: string; status: 'verified' | 'unverified' | 'conflict'; note?: string }
  rules: ModelRuleFields
}

type SiteRuleEntry = {
  match: { host: string; apiFormat: ApiFormat; modelPrefix?: string }
  source: { url: string; checkedAt: string; status: 'verified' | 'unverified' | 'conflict'; note?: string }
  rules: ModelRuleFields
}
```

字段含义：

| 字段 | 层 | 含义 | 读者 |
|---|---|---|---|
| `contextWindow` | 模型 | 输入加输出的总窗口（token） | CLI 自动压缩和 `/context`；server 的会话统计 |
| `maxOutputTokens` | 模型 | 模型允许的最大输出 | 代理按下面「只发有出处的上限」决定发不发；CLI 的输出预算和上限 |
| `reasoning.control` | 模型 | `none` 不能思考；`toggle` 只能开关；`effort` 只有档位、不能关；`toggle_effort` 开关加档位；`always` 始终思考、不能关，可能有档位 | CLI 能力判断；代理生成字段；桌面端 effort 选择器 |
| `reasoning.levels` | 模型 | 用户可选的档位，取自 CLI 的 `low/medium/high/max`（`src/utils/effort.ts:13-18`），按原名写到线上 | 同上 |
| `input.image` / `input.pdf` | 模型 | 能否收图片、PDF | 代理决定携带还是换成说明文字；CLI 的 Read 工具 |
| `structuredOutput` | 模型 | 能否收 JSON Schema 约束的输出 | CLI 是否写 `output_config.format`；代理映射 |
| `thinkTagsInText` | 端点 | 正文里会出现 `<think>` 标签 | 代理把标签内容拆成思考块 |
| `reasoningReplay` | 端点 | 是否把带来源标记的推理写回下一轮 | 代理 |
| `unmarkedReasoningReplay` | 端点 | 没有来源标记的思考块（旧会话）怎样写回，默认 `none` | 代理 |
| `reasoningDialect` | 端点 | 思考和 effort 写到哪些字段，见「思考的写法」 | 代理；对 anthropic 格式提供方也决定 CLI 的请求 |
| `maxTokensField` | 端点 | 输出上限用哪个字段名，只管名字，不决定发不发 | 代理 |
| `nativeWebSearch` | 端点 | 是否提供 Anthropic 原生 `web_search` 工具 | CLI 选择搜索后端 |
| `extraBody` | 端点 | 合并进请求体的固定字段，在写法生成的字段之后按对象深合并（例如写法生成的 `thinking.type` 和 extraBody 的 `thinking.keep` 并存），同一路径上 extraBody 的值优先。层与层之间 `extraBody` 和其他字段一样整体覆盖，不跨层合并：用户覆盖里写了 `extraBody`，会替换站点条目的 `extraBody`（例如 MiniMax 的 `reasoning_split`），要保留就一起写上。不能设 `model`、`messages`、`stream`、`tools`、`tool_choice`、`input`，schema 拒绝这些键。写法所属的键（`thinking`、`reasoning`、`reasoning_effort`、`enable_thinking`、`output_config`）只在写法这次确实生成了思考字段时才合并，见「思考的写法」 | 代理 |

`source` 只用于维护和测试，不参与解析。

**各层能设哪些字段。** 兜底层给出全部字段。apiFormat 层和站点层只设端点字段：`reasoningDialect`、`maxTokensField`、`nativeWebSearch`、`extraBody`、`reasoningReplay`、`unmarkedReasoningReplay`、`thinkTagsInText`。模型能力字段（窗口、输出上限、`reasoning`、`input`、`structuredOutput`）只由模型层、拉取值和用户覆盖设置，站点条目带 `modelPrefix` 时也可以设。拉取值另外可以带 `reasoningDialect`，只和它的 `reasoning` 一起、在下层为兜底时生效（见「拉取能读到什么」）。这样，表里查不到的模型，能力字段一定来自兜底，不会被 apiFormat 层或站点层的默认值改掉。

模型层不设端点字段，包括 `extraBody` 和 `reasoningDialect`：模型条目对所有 host 都生效，同一个模型经 OpenRouter、DeepInfra 等中转时，厂商端点专有的字段和写法可能被拒。唯一的例外是 Claude 条目的 anthropic 写法：Claude 模型的 anthropic 兼容中转用的是原生请求形状，`claude-opus-4-7` 只接受 adaptive（官方 [thinking 排错页](https://platform.claude.com/docs/en/build-with-claude/thinking-troubleshooting) 写明它拒绝 `enabled` 加 `budget_tokens`），按 apiFormat 层默认的 budget 写法会收到 400。所以模型条目可以设 `reasoningDialect`，但只在它和提供方 apiFormat 配套时生效（同用户覆盖，都用 `dialectFitsFormat` 判断），不配套时静默忽略；站点层在模型层之后叠加，已登记的站点仍以站点为准。Claude 条目同样可以设 `nativeWebSearch: true`：Claude 的 anthropic 中转基本都转发原生 `web_search` 工具（维护者决定），它只在提供方 apiFormat 为 anthropic 时生效，openai 格式上 CLI 发出的服务端工具到不了上游。已登记的 anthropic 站点（DeepSeek、Kimi Code、智谱、MiniMax）是厂商自己的端点，host 条目设 `nativeWebSearch: false`，这些端点上的 Claude 名字不开原生搜索。例：custom、anthropic 格式、`https://relay.example.com` 上的 `claude-opus-4-7` 发 adaptive 加 effort；`api.kimi.com` 上同名模型仍按站点的 `anthropic_disable_only`；OpenRouter chat 上的 `anthropic/claude-opus-4-7` 仍用 `openrouter` 写法，也不用原生搜索。数据测试只允许 Claude 条目设 anthropic 写法和 `nativeWebSearch`，其余端点字段模型层一律不设。跟某个厂商端点绑定的字段一律放在带 `modelPrefix` 的站点条目里，例如 `api.moonshot.ai` 加 `kimi-k2` 的 `thinking.keep: 'all'`、`open.bigmodel.cn` 加 `glm-` 的 `clear_thinking: false`。不带 `modelPrefix` 的站点条目，`extraBody` 只放对这个 host 上任何模型都安全的字段。表里没有站点条目的中转，用 apiFormat 层的默认写法。

**只发有出处的上限。** 代理只在 `sources.maxOutputTokens` 是 `model`、`site`、`discovered` 或 `user` 时发输出上限字段，值为 min(CLI 请求值, `maxOutputTokens`)。来自兜底时不发，交给提供方的默认值。CLI 仍按兜底的 32,000 做预算。理由：兜底的 32,000 不是这个模型的事实，发出去会让输出上限更低的模型直接返回 400。

**anthropic 格式提供方上哪些字段起作用。** 这类提供方的会话请求由 CLI 直接发给上游，不经过代理，所以只有 CLI 读的字段起作用：窗口、输出上限、`reasoning`、`reasoningDialect`（决定 CLI 怎么发思考）、`input.pdf`、`input.image`（只影响 Read 的 `pages` 路径）、`structuredOutput`、`nativeWebSearch`。`extraBody`、`maxTokensField`、`thinkTagsInText`、`reasoningReplay`、`unmarkedReasoningReplay` 对它们不起作用。API 入口拒绝 anthropic 格式提供方的 `modelOverrides[*].extraBody`，和 #267 拒绝它们的 `extraHeaders` 一样（`providerService.ts:330-336`）。数据测试保证 anthropic 格式的站点条目不设这几个字段。

### 内置表文件

新文件 `src/server/config/modelRules.json`，启动时用 zod 校验：

```json
{
  "fallback": { "rules": { } },
  "formats": { "anthropic": { }, "openai_chat": { }, "openai_responses": { } },
  "models": [ { "match": { "modelPrefix": "deepseek-v4-pro" }, "source": { }, "rules": { } } ],
  "sites": [ { "match": { "host": "openrouter.ai", "apiFormat": "openai_chat" }, "source": { }, "rules": { } } ]
}
```

- `fallback` 必须给出全部字段，解析结果因此总是完整的。
- `formats` 三条只设端点字段：

| apiFormat | `reasoningDialect` | `maxTokensField` | 其他 |
|---|---|---|---|
| `anthropic` | `anthropic_budget` | `max_tokens` | |
| `openai_chat` | `reasoning_effort` | `max_tokens` | |
| `openai_responses` | `responses_reasoning` | `max_output_tokens` | |

  anthropic 格式默认用 budget 写法，不用 adaptive：adaptive 和 `output_config.effort` 是较新的 Anthropic 字段，第三方 anthropic 兼容端点不一定认（推断）；`thinking:{type:'enabled', budget_tokens}` 是更早、更普遍的写法。认 adaptive 的端点（DeepSeek、MiniMax）在站点层改成 `anthropic_adaptive`；支持 adaptive 的 Claude 模型（4.6 及以后）在模型层设 `anthropic_adaptive`，只支持 budget 的（`claude-opus-4-5`、`claude-sonnet-4-5`、`claude-haiku-4-5` 及更早的 Claude 4）不设。
- 预设里的 `modelContextWindows` 和能力相关的 `defaultEnv`（DeepSeek 的三档能力、Kimi 和智谱的 `DREAMCODER_SEND_DISABLED_THINKING`）迁进这张表，预设只保留连接信息。Kimi 和智谱的「关思考时发 disabled」落到它们 anthropic 端点的站点条目上（写法 `anthropic_disable_only`，见站点层初始条目）。
- CLI 内置窗口表 `modelContextWindows.ts:5-48` 里的第三方条目并进来，从 CLI 删除。官方 Claude 的条目（`claude-opus-4-7`、`claude-sonnet-4-6`、`claude-haiku-4-5`，`modelContextWindows.ts:6-8`）留在 CLI，供原逻辑使用。
- 数据测试保证：`models` 里没有两条规范化后的 `modelPrefix` 相同；`sites` 里没有两条 (host, apiFormat, 规范化后的 modelPrefix) 相同；每条前缀站点条目都有同一 host、同一 apiFormat 的 host 条目，否则它永远用不上。

### 匹配

- **名字规范化**：模型名和条目里的 `modelPrefix` 都做同样的处理：去掉 `[1m]`、`[2m]`、`:1m` 后缀，转小写，把 `.` 换成 `-`。换点号是因为同一个模型在不同地方写法不同，例如 OpenRouter 写 `anthropic/claude-opus-4.7`（现有代码 `modelContextWindows.ts:36-38` 也是这样写的），厂商写 `claude-opus-4-7`。两边都换，`gpt-5.4` 和 `gpt-5-4`、`qwen3.5-plus` 和 `qwen3-5-plus` 也就等价。这个函数叫 `normalizeModelId`，放在 `src/utils/model/modelRules.ts`，server 的解析、CLI 的查找、`modelOverrides` 和 `discoveredModels` 的键查找都用它，全仓只留这一个规范化函数：现有的 `normalizeModelContextKey`（`src/utils/model/modelContextWindows.ts:50-56`，只去后缀、转小写，不换点号）并进来，CLI 内置窗口表的查找也改用它。
- **覆盖和拉取值的键**：`modelOverrides`、`discoveredModels` 按用户或上游给的原始 id 存键。查找时把存的键和要查的 id 都过一遍 `normalizeModelId` 再比较，所以代理拿到去掉 `[1m]` 后缀的 id（`client.ts:91`）也能找到。两个键规范化后相同时，取在 map 里先出现的那个，并在保存时由 API 拒绝这种重复。
- **前缀要在边界上结束**：前缀命中后，名字里紧接着的下一个字符必须是结尾或分隔符（`-`、`:`、`/`、`@`、`_`），前缀本身以分隔符结尾时（例如 `glm-`）除外。没有这条，`glm-4.5v` 会命中 `glm-4.5`（视觉模型被当成不收图片），加上点号换连字符后，`gpt-5-2025-08-07`（GPT-5 的快照 id）还会命中 `gpt-5.2`、`gpt-4-1106-preview` 会命中 `gpt-4.1`。有边界之后：`glm-4.5v` 里 `glm-4-5` 后面是 `v`，不命中，落到兜底；`gpt-5-2025-08-07` 里 `gpt-5-2` 后面是 `0`，不命中，改为命中 `gpt-5`；`gpt-4-1106-preview` 里 `gpt-4-1` 后面是 `1`，不命中，落到兜底。
- **模型层**：在 `models` 里找 `modelPrefix` 是规范化名前缀且满足边界的条目，取前缀最长的一条。没有命中时，如果名字是 `vendor/rest` 形式，就用 `rest` 再找一次（只剥一层，例如 `deepseek/deepseek-v4-pro` 命中 `deepseek-v4-pro`）。
- **站点层**：取 base URL 的 host（小写，去端口），和提供方的 apiFormat 一起匹配。
  - 第一步：在不带 `modelPrefix` 的条目里找 apiFormat 相同、host 相等或是其后缀（例如 `.maas.aliyuncs.com`）的条目，取 host 最长的一条。
  - 第二步：在带 `modelPrefix` 的条目里找 host 和 apiFormat 都与第一步相同、`modelPrefix` 命中规范化名的条目（同样允许剥一层 `vendor/`），取前缀最长的一条，叠在第一步之上。
  - 例：智谱 chat 提供方选 `glm-5.1`，第一步取 `open.bigmodel.cn` 的 host 条目（写法 `thinking_type`、`max_tokens`），第二步叠 `glm-` 前缀条目（`extraBody`），两者都生效。
- **前缀的坑**：`gpt-5` 会命中 `gpt-5-4`（`-` 是分隔符），所以窗口不同的版本各写一条，靠最长前缀选中。站点 host 的后缀匹配以 `.` 为界，`evilopenrouter.ai` 不命中 `openrouter.ai`。

### 用户覆盖和拉取值的存储

两个新字段都放在 `SavedProvider` 顶层、按模型 id 建 map，和现有的 `modelContextWindows` 同形：

```ts
modelOverrides?: Record<string, {
  contextWindow?: number
  maxOutputTokens?: number
  reasoningLevels?: EffortLevel[] | 'off'
  image?: boolean
  pdf?: boolean
  reasoningDialect?: ReasoningDialect
  extraBody?: Record<string, unknown>
}>
discoveredModels?: Record<string, {
  contextWindow?: number
  maxOutputTokens?: number
  image?: boolean
  pdf?: boolean
  reasoning?: { control: ReasoningControl; levels?: EffortLevel[] }
  reasoningDialect?: ReasoningDialect
}>
discoveredAt?: string
```

放在顶层不放在模型条目上，原因是模型条目会被 `normalizeProviderModels`（`providerRuntimeEnv.ts:73-84`）和每次启动都跑的迁移 `dedupeModels`（`src/server/services/persistentStorageMigrations.ts:177-186`）裁成 `{id, name}`，新字段下次启动就会从磁盘上消失。顶层字段经 `...provider` 保留（`providerRuntimeEnv.ts:104-116`，`persistentStorageMigrations.ts:136-144`）。

- `modelOverrides` 由用户提交，加进 `SavedProviderSchema`、`CreateProviderSchema`、`UpdateProviderSchema`（`src/server/types/provider.ts:49-101`），以及 `addProvider`/`updateProvider` 的逐字段拷贝（`providerService.ts:120-135, 150-166`），否则 API 入口的 zod 会把它剥掉（`src/server/api/providers.ts:123,135`）。
- `discoveredModels` 和 `discoveredAt` 只由 server 写，只加进 `SavedProviderSchema`，不加进 Create/Update schema。`updateProvider` 先展开 `existing`（`providerService.ts:150-151`），普通更新不会丢掉它们。
- `discoveredModels` 只存提供方模型列表里的模型，不存上游列出的全部模型（OpenRouter 有数百个）。新加模型后保存会再拉一次，所以新模型也会有值。
- 更新时 `baseUrl` 或 `apiFormat` 变了，清空 `discoveredModels`，再按保存流程重新拉取。

`reasoningLevels` 和模型条目的 `reasoning` 这样合成：

| 用户的 `reasoningLevels` | 下层的 `control` | 结果 |
|---|---|---|
| 未设 | 任意 | 不变 |
| `'off'` | 任意 | `control: 'none'`，`levels: []` |
| 非空数组 | `none` 或 `toggle` | `control: 'toggle_effort'`，`levels` 取用户值 |
| 非空数组 | `effort`、`toggle_effort`、`always` | `control` 不变，`levels` 取用户值 |
| 空数组 `[]` | `none` 或 `toggle` | `control: 'toggle'`，`levels: []` |
| 空数组 `[]` | `toggle_effort` | `control: 'toggle'`，`levels: []` |
| 空数组 `[]` | `effort` | `control: 'always'`，`levels: []`（`effort` 本来就不能关，去掉档位后仍不能关） |
| 空数组 `[]` | `always` | `control: 'always'`，`levels: []` |

也就是说，用户选了档位就表示模型能思考并认这些档位；只勾「能思考」不选档位就是 `toggle`；选「不支持思考」就是 `none`。兜底的 `none` 加上用户的档位会变成 `toggle_effort`。`reasoningDialect` 和 `extraBody` 不在界面上出现，只能手写在 `providers.json` 里。

现有的 `modelContextWindows` 由迁移转成 `modelOverrides[id].contextWindow`，然后删除。转换时，等于旧数值的窗口不迁移：这些值大多是表单从预设或「拉取模型」预填进去的（`ProviderFormModal.tsx:124, 589-597, 616`），不是用户的选择，迁过去会把旧数字永久固定住。比较基准是迁移代码里冻结的一份旧值：当前预设的 `modelContextWindows` 和当前 CLI 内置表 `modelContextWindows.ts:5-48`。不和新表比较，因为新表改了一些数值（例如 DeepSeek 从 1,000,000 改为 1,048,576），比新表会让旧的预填值变成用户覆盖。「拉取模型」预填进去的值和用户手填的值无法区分，迁移后都算用户覆盖；表单上每个字段都有「恢复默认」，可以清掉。

### 解析结果

```ts
type FieldSource = 'fallback' | 'format' | 'model' | 'site' | 'discovered' | 'user'

type ResolvedModelRules = Required<Omit<ModelRuleFields, 'reasoning' | 'input'>> & {
  reasoning: { control: ReasoningControl; levels: EffortLevel[] }
  input: { image: boolean; pdf: boolean }
  usedFallback: boolean
  sources: Record<'contextWindow' | 'maxOutputTokens' | 'reasoning' | 'image' | 'pdf' | 'structuredOutput', FieldSource>
}
```

- `sources` 记录每个能力字段最终取自哪一层，用于界面提示、发不发输出上限和排查。
- `usedFallback` 为 `sources.reasoning === 'fallback'`，也就是没有任何一层说过这个模型怎么思考。命中只带端点字段的前缀条目（例如 `glm-` 站点条目只有 `extraBody`）不改变 `sources.reasoning`，所以表里没有的 GLM 型号仍然显示兜底标记。
- 拉取值的位置：窗口和输出上限在第 5 层，覆盖内置表。图片和 PDF 的拉取值只在 `sources.image` 或 `sources.pdf` 仍是 `fallback` 时使用，来源记为 `discovered`。原因是列表接口给的数字是端点的事实，通常比内置表新；模态字段各家写法不一，误读的代价比数字大。
- 思考的拉取值（目前只有 OpenRouter 给）和图片、PDF 一样，只在 `sources.reasoning` 仍是 `fallback` 时使用，来源记为 `discovered`，表里已有的模型不受影响。它带的 `reasoningDialect` 同样要和提供方的 apiFormat 配套才生效（`dialectFitsFormat`），所以只在 anthropic 格式上起作用；OpenRouter chat 仍用站点层的 `openrouter` 写法。

## 思考的写法

`reasoningDialect` 是封闭枚举。每种写法规定三件事：关闭思考时写什么，带档位 L 时写什么，模型没有档位（`control` 是 `toggle`，或 `always` 且 `levels` 为空）时开启写什么。

| 写法 | 关闭 | 档位 L | 开启（模型没有档位） | 适用 |
|---|---|---|---|---|
| `anthropic_adaptive` | `thinking:{type:'disabled'}` | `thinking:{type:'adaptive'}` + `output_config.effort:L` | `thinking:{type:'adaptive'}` | anthropic 格式：DeepSeek、MiniMax |
| `anthropic_budget` | `thinking:{type:'disabled'}` | `thinking:{type:'enabled', budget_tokens}`，不发 effort | 同左 | anthropic 格式默认 |
| `anthropic_disable_only` | `thinking:{type:'disabled'}` | 不发（上游默认开） | 不发 | anthropic 格式：Kimi Code、智谱，保持现在的行为 |
| `reasoning_effort` | `control` 为 `toggle` 或 `toggle_effort` 时 `reasoning_effort:'none'`，否则不发 | `reasoning_effort:L` | 不发（上游默认） | openai_chat 默认；OpenAI、Gemini、Kimi K3 |
| `responses_reasoning` | 同上，写 `reasoning:{effort:'none'}` | `reasoning:{effort:L}` | 不发（上游默认） | openai_responses 默认 |
| `thinking_type` | `thinking:{type:'disabled'}` | `thinking:{type:'enabled'}`，`reasoning_effort:L` 仅当 `levels` 非空 | `thinking:{type:'enabled'}` | DeepSeek、智谱、Kimi K2 的 chat 接口 |
| `thinking_adaptive` | `thinking:{type:'disabled'}` | `thinking:{type:'adaptive'}` + `reasoning_effort:L` | `thinking:{type:'adaptive'}` | MiniMax 的 chat 接口 |
| `enable_thinking` | `enable_thinking:false` | `enable_thinking:true`，`reasoning_effort:L` 仅当 `levels` 非空 | `enable_thinking:true` | 百炼 Qwen |
| `openrouter` | `reasoning:{effort:'none'}` | `reasoning:{effort:L}` | `reasoning:{enabled:true}` | OpenRouter |

模型有档位时，请求里总是带一个明确的档位（维护者决定，做法和 ZCode 一样），不会出现「开着思考、没有档位」。档位从哪里来见下一节。「开启（模型没有档位）」这一列只用于没有档位可选的模型，例如 Kimi K2（`toggle`）。

规则：

- `control: 'none'` 时不论写法都不发任何思考字段，`anthropic_disable_only` 除外：它在关思考时仍发 disabled，见「从解析结果推导 CLI 字段」。兜底条目就是 `none`。
- `control` 是 `effort` 或 `always` 时不发关闭字段：用户关了思考，请求照常思考，带上档位。界面上思考开关对这个模型显示为不可关闭。
- 档位不在 `levels` 里时，取比它高的最低一档；没有更高的档位时取最高的一档（维护者决定）。例：DeepSeek（low、high、max）上 medium 换成 high，low 不变；gpt-5（low、medium、high）上 max 换成 high。会话选的档位和全局默认 effort 都按这条换算。CLI 现有的「`max` 不支持就降为 `high`」（`src/utils/effort.ts:162-165`）改为这条规则。代理收到不在 `levels` 里的档位时也这样换算。辅助调用不走这条，直接取最弱一档。
- 代理收到的请求按下表归到一种输入，再按写法生成字段：

| 请求里的 `thinking` | `output_config.effort` | 归为 |
|---|---|---|
| `disabled` | 任意 | 关闭 |
| `adaptive` 或 `enabled` | L | 档位 L |
| 没有 | L | 档位 L |
| `adaptive` 或 `enabled` | 没有 | 模型没有档位：开启。模型有档位：档位取全局 effort 换算（见下一节「没有规则变量的请求」） |
| 没有 | 没有 | 未指定：不发任何思考字段 |

  在有规则变量的 CLI 和 server 自己发的请求里，后两行只出现在这些情况：模型没有档位（开启）；`control: 'none'`，包括 CLI 用 `fallback` 的 id（未指定）。例：OpenAI chat 上的 gpt-5（`control: 'effort'`），用户关思考、选 high，CLI 发「没有 thinking、effort=high」，归为档位 high，代理写 `reasoning_effort:'high'`。
- 写法和 apiFormat 要配套：`anthropic_adaptive`、`anthropic_budget`、`anthropic_disable_only` 只用于 anthropic；`responses_reasoning` 只用于 openai_responses；其余五种只用于 openai_chat。站点条目和 apiFormat 层由数据测试保证配套。用户在 `modelOverrides` 里手写的不配套写法，读取时丢弃这个字段并记日志（同「失败与错误处理」里不合法覆盖的处理），解析结果继续用下层的写法；API 入口直接拒绝。
- `extraBody` 里写法所属的键（`thinking`、`reasoning`、`reasoning_effort`、`enable_thinking`、`output_config`）只在写法这次生成了思考字段时才合并。例：智谱 chat 上表里没有的 `glm-4-plus` 走兜底的 `none`，不生成思考字段，`glm-` 前缀条目的 `thinking.clear_thinking` 也就不合并，不会发出一个没有 `type` 的 `thinking` 对象。
- anthropic 格式提供方的会话请求不经过代理，CLI 发出的请求就是上游收到的请求，CLI 怎样按写法发请求见「CLI」一节。server 自己发给 anthropic 格式提供方的请求（标题生成、连接测试）走代理的 anthropic 透传分支（`src/server/upstream/client.ts:291-299`）。这条分支不改写请求，原样转发：`sendToUpstream` 只有三个调用方，代理 handler（请求来自 CLI，CLI 已按规则组装）、标题生成和连接测试，后两者在发出前自己按「辅助调用」的规则算好最终的 `thinking` 和 `output_config.effort`，见下一节。这样「没有 `thinking` 字段」在透传分支里不需要再归类。

### 档位从哪里来

**主对话。** 用户为这个会话选了档位就用它，没选就用桌面端的全局 effort，再按上面的规则换算到模型支持的档位。现在全局 effort 有两处没传到 CLI：

- 会话：server 传 `--effort` 的值是「会话选的档位 ?? 用户设置里的 `effort`」（`src/server/ws/handler.ts:1175-1179, 1201-1205`，`conversationService.ts:976-978`）。用户从没改过全局 effort 时，设置里没有这个键，就不传 `--effort`。而桌面端这时显示 medium：store 默认 `medium`（`desktop/src/stores/settingsStore.ts:169`），`GET /api/effort` 对缺省值也返回 `DEFAULT_EFFORT`，即 medium（`src/server/api/models.ts:31, 72-76, 190-193`）。界面和实际请求不一致。
- 定时任务：`getRuntimeArgs` 只传 `--model` 和权限模式（`src/server/services/cronScheduler.ts:568-574`），从不传 effort。

补法：sidecar 生成 `DREAMCODER_MODEL_RULES` 时，在顶层写 `defaultEffort`，取值是 `normalizeEffortLevel(用户设置的 effort)`，也就是 `GET /api/effort` 用的同一个函数，缺省为 medium。CLI 的 `getDefaultEffortForModel`（`src/utils/effort.ts:279-329`）在有规则时返回它。

`resolveAppliedEffort` 的优先级是环境变量 `CLAUDE_CODE_EFFORT_LEVEL` > 会话状态里的 `effortValue` > 模型默认（`effort.ts:152-167`）。`effortValue` 的初值是 `parseEffortValue(--effort) ?? getInitialEffortSetting()`（`src/main.tsx:2598`、`:3026`），后者读合并后 settings 的 `effortLevel`（`effort.ts:107-111`），用户、项目、policy 各层都算，终端里的 `/effort` 会写进用户 settings（`src/commands/effort/effort.tsx:19, 77`）。sidecar 读的是自己设置里的 `effort` 键，不是这个 `effortLevel`。所以有规则时 settings 的 `effortLevel` 不参与：`effort.ts` 的 `effortFromSettings` 在有规则时返回 undefined，两处共用。`getInitialEffortSetting` 用它算初值；`applySettingsChange`（`src/utils/settings/applySettingsChange.ts:73-88`）用它决定 settings 变化时要不要改写 `effortValue`。只改初值不够：会话中途 settings 里的 `effortLevel` 变了（例如在终端里 `/effort low`），`applySettingsChange` 仍会把它写进 `effortValue`，盖掉 `--effort`。改后的优先级：

1. 环境变量 `CLAUDE_CODE_EFFORT_LEVEL`；
2. `--effort`（会话选的档位 ?? sidecar 设置里的 `effort`）；
3. 规则变量的 `defaultEffort`。

不跳过的话：桌面端全局 effort 从没改过，项目 `.claude/settings.json` 写了 `"effortLevel": "low"`，桌面端显示 medium，DeepSeek 实际收到 low，而不是 medium 换算后的 high。没有规则变量时（官方地址、终端路径）`getInitialEffortSetting` 不变。

所以会话选了档位就用会话的，没选就用全局的，定时任务也拿到全局的。放在规则变量里，而不是改成总传 `--effort`，有两个原因：
- 官方 Anthropic 地址不生成这个变量，原逻辑的默认 effort 不受影响；
- 不新增按模型的默认档位字段。

`defaultEffort` 和规则变量一样只在 CLI 启动时读一次，改全局 effort 后对已运行的会话在下次启动 CLI 时生效，和现在 `--effort` 的行为相同。

**辅助调用。** 不带用户档位的内部请求：CLI 的 `queryHaiku`（`src/services/api/claude.ts:3342-3388`，会话标题、WebFetch 摘要、工具摘要等都走它）和 `sideQuery`（`src/utils/sideQuery.ts`），server 的标题生成和连接测试。规则参照 ZCode 的辅助调用（`apps/zcode-cli/packages/core/src/model/auxiliary-model-options.ts:5-13`，它取模型档位列表的第一项，而它的档位列表把「关闭」排在最前）：

按下面的顺序判断，命中一条就停，输入是 CLI 字段（`CliModelRules`）：

1. 调用方明确要思考（`sideQuery` 传了数字 `thinking`）：开启（按 `thinkingWhenOn`），并带 `effortLevels` 里最弱的一档；`effortLevels` 为空时不带档位。
2. `thinkingWhenOff` 是 `disabled`：发 `thinking:{type:'disabled'}`，不带档位。和主对话「关思考就按 `thinkingWhenOff` 发 disabled」一致，所以 `anthropic_disable_only` 写法下的 `none` 模型（例如 Kimi 预设上表里没有的 `kimi-for-coding`）也发 disabled。
3. `effortLevels` 非空且 `thinkingWhenOff` 是 `omit`（`effort`、`always` 模型）：不发 thinking，带最弱的一档。
4. 其余（`none` 模型，以及 `levels` 为空的 `always` 模型）：不发思考字段。

CLI 怎样识别辅助调用：`queryHaiku` 在传给 `queryModel` 的选项里加 `auxiliary: true`，`claude.ts:1603-1686` 看到它就按上面的规则组装思考字段，不再用 `resolveAppliedEffort` 的结果；`sideQuery` 在 `resolveSideQueryThinkingConfig`（`sideQuery.ts:220-236`）里按同样的规则组装，并补上 `output_config.effort`（现在 sideQuery 不发 effort）。sideQuery 的 effort 和 `sideQuery.ts:184` 的 `format` 写进同一个 `output_config` 对象，分两次展开会互相覆盖。server 的标题和连接测试先由解析结果推导出这个模型的 `CliModelRules`，再调同一个函数。

**公共函数放在哪里。** 下面三个函数 CLI 和 server 都要用，放在 `src/utils`，server 从那里 import（server import `src/utils` 是允许的方向；服务层 import 路由文件不允许）：

| 函数 | 位置 | 输入 | 使用方 |
|---|---|---|---|
| `normalizeEffortLevel(value)` | `src/utils/effort.ts`，从 `src/server/api/models.ts:72-76` 移过来，缺省 medium | 任意值 | `GET /api/effort`、`getProviderRuntimeEnv`、代理（「没有规则变量的请求」） |
| `resolveEffortForLevels(level, levels)`：取比它高的最低一档，没有就取最高一档；`levels` 为空返回 undefined | `src/utils/model/modelRules.ts` | 档位、`CliModelRules.effortLevels` | CLI 的 `resolveAppliedEffort`、代理、界面视图 |
| `auxiliaryThinking(rules, explicitThinking?)`：按上面四条返回 `{ thinking?, effort? }` | `src/utils/model/modelRules.ts` | `CliModelRules` | `claude.ts`、sideQuery、标题生成、连接测试 |

`src/server/api/models.ts:28` 的 `EFFORT_LEVELS` 副本删掉，路由文件改为 import `src/utils/effort.ts` 的 `EFFORT_LEVELS` 和 `normalizeEffortLevel`。

行为变化：
- 现在只有 Kimi、智谱的 sideQuery 在没传 thinking 参数时发 disabled（靠 `DREAMCODER_SEND_DISABLED_THINKING`），改后所有能关思考的模型都发；
- `effort` 和 `always` 模型的辅助调用带最弱一档；
- 标题请求不再只在用户关了思考时才关（`titleService.ts:83-90`），能关的模型总是关。

**没有规则变量的请求。** 终端里直接运行的 CLI 没有规则变量，按原逻辑发请求。它经代理时仍可能发出「开着思考、没有 effort」：例如 OpenRouter 上的 `anthropic/claude-sonnet-4.6`，原逻辑按名字判断能思考，非官方地址上不用 adaptive，发 `enabled` 加 budget（`src/utils/thinking.ts:115-116`、`:135-137`）。代理对这种请求按模型是否有档位处理：模型没有档位时按「开启」；有档位时用全局 effort（代理在 sidecar 里，直接读用户设置，`normalizeEffortLevel`）按规则换算成档位 L。这样终端路径的主对话也带明确档位。

新增一种写法需要改代理代码，这是有意的取舍，见「考虑过的其他方案」。

## 读者

### sidecar

- 新目录 `src/server/services/modelRules/`：`builtinModelRules.ts`（读取和校验 JSON）、`resolveModelRules.ts`（叠加和匹配）、`cliModelRulesEnv.ts`（推导 CLI 字段、生成 CLI 的环境变量、界面视图）、`officialAnthropicProvider.ts`（`isOfficialAnthropicProvider`）、`auxiliaryRequest.ts`（标题和连接测试的思考字段）。
- 类型和 schema：覆盖、拉取值、解析结果、视图在 `src/server/types/modelRules.ts`；表文件的条目 schema 在 `src/server/types/modelRulesTable.ts`。分成两个文件是因为 `provider.ts` 要引用覆盖的 schema，而表文件 schema 要引用 `provider.ts` 的 `ApiFormatSchema`，放在一起会循环导入。
- `resolveModelRules(provider: SavedProvider, modelId: string): ResolvedModelRules` 是纯函数，输入里已经带着提供方的覆盖和拉取值，方便测试。

### 代理

- `getProviderForProxy` 返回 `{ target, provider }`。`sendToUpstream` 在 `stripContextSuffix` 之后（`client.ts:91`）解析一次，把结果传给 `buildUpstreamRequest`（`client.ts:268`）、两个请求转换函数、四个响应转换函数（`client.ts:370-388`）。
- `AnthropicRequest` 类型加上 `output_config?: { effort?: EffortLevel; format?: unknown }`。运行时这个字段一直都在请求体里，只是类型不认（`src/server/proxy/handler.ts:66`）。代理类型里的 `reasoning_effort` 扩成 CLI 的全部档位加 `none`（`types.ts:45,132`）。
- 删除 `shouldUseDeepSeekReasoningCompat` 和 `passThinkingToggle`、`roundTripReasoningContent` 两个选项（`client.ts:271-275, 339-344`）。
- 标题生成（`src/server/services/titleService.ts:75-90`）和连接测试（`providerService.ts:353-365`）也走解析。连接测试有两个入口，都先构造一个临时 `SavedProvider`，再用它解析规则、做官方判断：
  - `testProviderConfig`（`providerService.ts:344-351`）：新建提供方时用表单里的值，没有保存过的提供方，临时 `SavedProvider` 全部取自表单。
  - `testProvider(id, overrides)`（`providerService.ts:298-310`）：编辑提供方时 API Key 留空，表单调它（`desktop/src/components/settings/ProviderFormModal.tsx:705-711`），现在是用表单的 `baseUrl`、`apiFormat`、`authStrategy` 覆盖已保存的 target。改为「已保存的提供方展开后再叠表单的覆盖值」构造临时 `SavedProvider`。只按已保存的提供方解析会出错：已保存的 Kimi 预设（anthropic，`api.kimi.com`）在表单里改成 openai_chat + `api.moonshot.ai` 后点测试，会套用 `anthropic_disable_only`，正是上面写法和 apiFormat 配套规则禁止的组合；反过来，把第三方地址改成官方地址时，官方判断也会错。

### server 自己读窗口的地方

`src/server/services/sessionService.ts` 的会话统计用 `getContextWindowForModel` 和 `getModelMaxOutputTokens`（`:825-831`，调用在 `:897, 1016-1017`）。server 进程里没有 CLI 的环境变量，所以改为：

1. 从 transcript 里最后一条 `runtime-config` 记录取 `providerId`（`runtimeSelectionFromTranscriptEntries`，`src/server/services/runtimeSelection.ts:17-26`）。
2. `providerId` 为 null 或者没有这条记录时，用活动提供方。null 的意思是「用默认提供方」，不是官方：只改了 effort 的选择 `providerId` 就是 null（`runtimeSelection.ts:13`），handler 遇到 null 走 `getDefaultRuntimeSettings`（`handler.ts:1185-1186`）。定时任务会话（`cronScheduler.ts:422`）和从设计、Artifact 新建的会话（`desktop/src/lib/designStart.ts:28`、`desktop/src/lib/continueArtifactInSession.ts:28`）根本没有这条记录。
3. 找得到提供方、而且 `isOfficialAnthropicProvider` 为 false 时，窗口用 `resolveModelRules(provider, model)` 的值；输出上限和 CLI 的 `getModelMaxOutputTokens` 的默认值一致，取 min(32,000, 有出处的上限)，上限来自兜底时取 32,000。不直接用模型上限：原来这里用的就是 CLI 的默认值，DeepSeek 的上限 393,216 不是实际请求的输出预算。
4. 完全没有提供方、提供方已删除、或者是官方地址时，沿用现在的 `getContextWindowForModel`，也就是原逻辑。`MODEL_CONTEXT_WINDOW_DEFAULT`（200,000）只在这条原逻辑里使用，和第三方兜底的 131,072 各管各的。

这里有一个已知误差：会话中途换过提供方时，统计用的是最后一次的提供方，早先的轮次也按它算。

### CLI

**生成位置。** `DREAMCODER_MODEL_RULES` 只在 `providerService.getProviderRuntimeEnv(id, modelId)` 里生成（`providerService.ts:221-227`），不放进 `buildProviderManagedEnv`。

- `getProviderRuntimeEnv` 只有两个调用方：桌面端会话的 `buildChildEnv`（`src/server/services/conversationService.ts:1033-1036`）和定时任务（`src/server/services/cronScheduler.ts:592-594`）。有活动提供方时，会话的运行时选择会带上 `providerId`（`src/server/ws/handler.ts:1212, 1253`），所以桌面端会话都走这条路径。
- 定时任务现在只在 `task.providerId` 是字符串时才调 `getProviderRuntimeEnv`（`cronScheduler.ts:592-594`）。新建任务时 `providerId` 默认为空（`desktop/src/components/tasks/NewTaskModal.tsx:88`），只有选了模型才有值，而这种任务按活动提供方运行（`cronScheduler.ts:650-659`）。改为用 `task.providerId ?? 活动提供方的 id` 调用，用哪个提供方不变，这类任务也就拿到了规则。附带一个变化：有了显式的提供方环境后，子进程会多设 `CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST`（`cronScheduler.ts:610-615`），用户 settings 里的提供方变量会被剥掉（`src/utils/managedEnv.ts:49-63`），和桌面端会话一致。
- 不放进 `buildProviderManagedEnv`，因为它还被 `syncToSettings` 用来写 `dreamcoder/settings.json`（`providerService.ts:229-249`），也被 CLI 进程内的 `mergeActiveProviderManagedEnv` 调用（`src/utils/managedEnv.ts:4, 103-113`）。放进去会让变量写进 settings.json，还会让 CLI 进程自己执行 `resolveModelRules`。
- 这个键加进 `PROVIDER_MANAGED_ENV_VARS`（`src/utils/managedEnvConstants.ts:16`）和 server 的清理列表，使继承来的旧值被清掉。不加进 `SAFE_ENV_VARS`（`managedEnvConstants.ts:121`），避免项目级 settings 注入。
- 提供方是官方 Anthropic 地址时不生成。判断用 `isOfficialAnthropicProvider(provider)`，定义为「`apiFormat` 是 anthropic，并且 base URL 的 host 命中官方列表」。只看 host 不够：custom 提供方的 base URL 写成 `api.anthropic.com`、apiFormat 选 openai_chat 时，CLI 的 `ANTHROPIC_BASE_URL` 指向本地代理，`isFirstPartyAnthropicBaseUrl()` 为 false，CLI 按第三方处理，server 也要按第三方生成规则。
- 官方 host 列表现在只在 CLI 的 `isFirstPartyAnthropicBaseUrl` 里（`src/utils/model/providers.ts:32-47`），读的是环境变量。从中抽出纯函数 `isFirstPartyAnthropicHost(url: string): boolean` 放在同一个文件，`isFirstPartyAnthropicBaseUrl` 改为调用它；server 的 `isOfficialAnthropicProvider` 也调用它（server import `src/utils` 是允许的方向）。`getProviderRuntimeEnv`、会话统计、界面视图、标题生成、连接测试都用 `isOfficialAnthropicProvider`；是官方地址时，标题和连接测试按现在的写法发请求。
- 用户在终端里直接运行 CLI 时，CLI 从 `dreamcoder/settings.json` 和活动提供方读环境变量（`managedEnv.ts:101-113`），没有这个变量，CLI 按原逻辑运行。旧的能力变量和第三方窗口条目删掉之后，原逻辑对第三方模型是：`modelSupportsThinking` 为 false，不发思考；`modelSupportsEffort` 对未知名字为 true（`effort.ts:48`），照发 effort；窗口 200K。例：活动提供方是 DeepSeek 预设时，改前发 adaptive 加 effort、窗口 1M，改后只发 effort、窗口 200K；Kimi、智谱不再在关思考时发 disabled。DreamCoder 以桌面端为主，这条路径本轮不处理。

**内容。**

```ts
type CliModelRules = {
  contextWindow: number
  maxOutputTokens?: number
  thinkingWhenOn: 'omit' | 'adaptive' | 'budget'
  thinkingWhenOff: 'omit' | 'disabled'
  effortLevels: EffortLevel[]
  pdf: boolean
  image: boolean
  nativeWebSearch: boolean
  structuredOutput: boolean
}
type CliModelRulesEnv = { models: Record<string, CliModelRules>; fallback: CliModelRules; defaultEffort: EffortLevel }
```

- `models` 包含 CLI 在这个进程里可能调用的所有模型：主模型、快速模型和 small-fast 模型、三档映射到的模型，再加上提供方列表里的全部模型，按规范化后的 id 去重。加上全部模型，是因为 agent 定义、skill、plugin 命令、hook 的 `model:` 可以写提供方的任意模型 id。
- `fallback` 是兜底条目经过 apiFormat 层和站点层第一步后的结果。CLI 遇到不在 `models` 里的 id（agent teams 硬编码的 Claude id、用户手写的其他 id）就用它。
- `maxOutputTokens` 只在 `sources.maxOutputTokens` 不是 `fallback` 时写入。
- `defaultEffort` 是全局 effort，见「档位从哪里来」。

**从解析结果推导 CLI 字段。** 「经代理」指提供方 apiFormat 不是 anthropic。

| CLI 字段 | 推导 |
|---|---|
| `thinkingWhenOn` | `control: 'none'` → `omit`。经代理 → `adaptive`（代理再按写法翻译）。anthropic 格式：写法 `anthropic_adaptive` → `adaptive`，`anthropic_budget` → `budget`，`anthropic_disable_only` → `omit` |
| `thinkingWhenOff` | `control` 是 `effort` 或 `always` → `omit`。否则：`control` 是 `toggle` 或 `toggle_effort` → `disabled`；写法是 `anthropic_disable_only` 时，`none`（包括兜底）也 → `disabled`，保持 Kimi Code 和智谱 anthropic 端点现在「关思考一律发 disabled」的行为（例如 Kimi 预设改用表里没有的 `kimi-for-coding` 时）；其余 → `omit` |
| `effortLevels` | `control` 是 `effort`、`toggle_effort`、`always` → `levels`；`none`、`toggle` → `[]`。anthropic 格式且写法是 `anthropic_budget` 或 `anthropic_disable_only` → `[]`（否则 `configureEffortParams` 仍会发 effort，`claude.ts:446-462`） |

**CLI 改读的位置。** `src/utils/model/modelRules.ts` 放 `normalizeModelId`、`CliModelRules` 的类型和 zod schema、窗口范围常量（见下）、读取这个变量的函数，以及 `resolveEffortForLevels` 和 `auxiliaryThinking`（见「公共函数放在哪里」）。server 的 `cliModelRulesEnv.ts` 从这里 import 类型和 schema 来生成变量，CLI 用同一个 schema 解析，进程内解析一次，查找时用 `normalizeModelId`。变量不存在时，所有函数走原逻辑；变量存在但解析失败时，记日志，全部模型按 `fallback` 处理；`fallback` 本身也解析失败时，按兜底条目的固定值处理。`src/utils` 只读这个变量，不 import server 代码。

| 位置 | 改法 |
|---|---|
| `src/services/api/claude.ts:1603-1686`（组装 `thinking` 和 effort） | 有规则时：思考开启 → 按 `thinkingWhenOn` 发 adaptive、budget 或不发；思考关闭 → `thinkingWhenOff` 为 `disabled` 时发 disabled 并删 effort，为 `omit` 时什么都不发、effort 照常配置。现在的 `sendsExplicitDisabledThinking = !hasThinking && (modelCanThink \|\| shouldSendExplicitDisabledThinking())`（`:1606-1608`）会让 `always` 模型在用户关思考时发出 disabled，改后不会。选项带 `auxiliary: true` 时按「辅助调用」的规则组装，不用 `resolveAppliedEffort` 的结果 |
| `queryHaiku`（`claude.ts:3342-3388`） | 传给 `queryModel` 的选项加 `auxiliary: true` |
| `getDefaultEffortForModel`（`src/utils/effort.ts:279-329`） | 有规则时返回规则变量顶层的 `defaultEffort` |
| `modelSupportsThinking`（`src/utils/thinking.ts:91-117`） | 第三方分支（`:92-95`、`:112-116`）改为 `thinkingWhenOn !== 'omit'`；删掉 MiniMax 的 base URL 判断（`:112-122`）；官方 Anthropic 分支不变 |
| `modelSupportsAdaptiveThinking`（`thinking.ts:125-163`） | `:126-137` 改为 `thinkingWhenOn === 'adaptive'` |
| `shouldSendExplicitDisabledThinking`（`thinking.ts:183-185`） | 改为接收 model，返回 `thinkingWhenOff === 'disabled'`；调用方 `claude.ts:1608` |
| `resolveSideQueryThinkingConfig`（`src/utils/sideQuery.ts:220-236`） | 有规则时按「辅助调用」的规则组装 `thinking`，并补上 `output_config.effort`；要补 model 参数。行为变化见「档位从哪里来」 |
| `modelSupportsEffort` / `modelSupportsMaxEffort`（`src/utils/effort.ts:23-65`） | 改为 `effortLevels` 非空 / 含 `max` |
| `resolveAppliedEffort`（`effort.ts:152-167`） | 有规则时用 `resolveEffortForLevels`（取比它高的最低一档，没有就取最高一档）换算到 `effortLevels` |
| `getInitialEffortSetting`（`effort.ts:107-111`，调用方 `src/main.tsx:2598, 3026`）、`applySettingsChange`（`src/utils/settings/applySettingsChange.ts:73-88`） | 都经 `effortFromSettings` 读 settings 的 `effortLevel`，有规则时得到 undefined：初值不取它，会话中途它变了也不改写 `effortValue`，见「档位从哪里来」 |
| `modelSupportsISP`（`src/utils/betas.ts:92-112`） | 删掉 `interleaved_thinking` 覆盖分支；有规则时返回 false。主循环不受影响：它用 `getMergedBetas`，对 firstParty 非官方地址直接返回空列表（`betas.ts:402-404`），本来就不带这个头。受影响的是直接调 `getModelBetas` 的 sideQuery（`src/utils/sideQuery.ts:132`）：删掉覆盖而不加这一条的话，firstParty 非官方地址一律返回 true（`betas.ts:106-108`），DeepSeek 预设和 custom anthropic 提供方（原来覆盖为 false）的 sideQuery 会开始带 `interleaved-thinking-2025-05-14`。加这一条后，Kimi、智谱的 sideQuery 原来没有覆盖、带着这个头，改后不再带 |
| `getContextWindowForModel`（`src/utils/context.ts:53-116`） | `:76-85` 改为有规则时读 `contextWindow` |
| `getModelMaxOutputTokens`（`context.ts:203-264`） | 在 Claude 名字分支（`:219-251`）之前读规则：有 `maxOutputTokens` 时 upperLimit 取它，default 取 min(32,000, 它)；没有时 32,000/64,000。插在名字分支之前，是为了不让名字里含 `sonnet-4`、`opus-4-6` 的第三方 id 绕开规则 |
| `isPDFSupported`（`src/utils/pdfUtils.ts:59-61`） | 改为接收调用方的模型，读 `pdf`。现在它不带参数，用主循环模型，子 agent 或 skill 换了模型时会不准 |
| Read 读 PDF（`src/tools/FileReadTool/FileReadTool.ts:893-983`） | 见下面「Read 工具和 PDF」 |
| 网页搜索后端（`src/tools/WebSearchTool/backend.ts:178-181`） | 「像 Claude」改为 `nativeWebSearch` |
| `output_config.format`（`claude.ts:1632-1643`） | 有规则且 `structuredOutput` 为 false 时不写 `format`。现在无条件写入，只有 beta 头受 `modelSupportsStructuredOutputs`（`betas.ts:142-157`）控制，anthropic 格式上游会收到它 |
| sideQuery 的 `output_config.format`（`src/utils/sideQuery.ts:184`） | 规则同上。现在无条件写入，记忆检索（`src/memdir/findRelevantMemories.ts:109`）走这条路径 |

**Read 工具和 PDF。** 现在模型不支持 PDF 时，Read 读整个 PDF 会直接报错（`FileReadTool.ts:977-983`）；前面 `:958` 的 `extractPDFPages` 只把页面渲染成 JPEG（`src/utils/pdf.ts:172`）并记日志，结果不返回。只有带 `pages` 参数时（`:893-943`）才返回内容，返回的是页面图片。工具描述在不支持 PDF 时会去掉 PDF 那一句（`src/tools/FileReadTool/prompt.ts:40-43`）。所以：

- `pdf: false` 时，读整个 PDF 报错，提示用 `pages` 参数，这是现有行为，保留。
- `pages` 路径把 PDF 转成图片发出，依赖图片能力。`image: false` 时这条路径也关掉：`pdf` 也是 false 时报错说明这个模型不能读 PDF；`pdf` 为 true 时报错提示去掉 `pages`，直接读整个 PDF。
- 兜底模型 `pdf: false`、`image: true`，所以读 PDF 要用 `pages`，以图片形式发出。

**Read 工具的图片说明。** 描述里的图片说明按 `image` 决定，不看是否经代理：`image: false` 时说图片会换成一段文字、不要描述没看到的图片，不要求读截图；否则用原来的图片说明和截图那句。改前经代理时一律说图片和 PDF 都到不了模型，本 PR 起代理会把它们交给支持的模型，这句话就错了。

**删除。**

- `src/utils/model/modelSupportOverrides.ts` 整个文件。
- `modelContextWindows.ts` 的环境变量常量和解析（`:1-3, 58-110`），第三方条目（`:9-32` 和 `:35-48` 的模式表，OpenRouter 的 `anthropic/claude-*` 模式也删，有提供方时由规则表接管）。保留 `:5-8` 的官方 Claude 条目和查找函数（`:112-132`，`context.ts:76` 在用）；查找函数里遍历模式表的循环（`:119-123`）随模式表一起删，只剩精确查找，规范化改用 `normalizeModelId`（`normalizeModelContextKey` 并入它）。
- 窗口范围常量（16,000 到 10,000,000）现在有三份：`modelContextWindows.ts:2-3`、`src/server/types/provider.ts:41-45`、`desktop/src/components/settings/ProviderFormModal.tsx:44-45`。改后 `MODEL_CONTEXT_WINDOW_MIN/MAX` 和对应的 zod schema 放在 `src/utils/model/modelRules.ts`，server 的 `modelOverrides` schema 和 `src/server/upstream/contextWindows/index.ts:62` 的校验从那里 import，`provider.ts:41-45` 删掉。桌面端是独立的包，表单保留自己的一份用于输入提示，以 server 的 400 为准。
- `src/utils/providerManagedEnvCompat.ts` 和它的调用方 `managedEnv.ts:12, 108`、`persistentStorageMigrations.ts:4, 194`。
- 旧键从各清理列表里删除，完整清单见「附录：删除和修改清单」。

**已退役键的清理。** 旧键删掉之后就不在 `getManagedEnvKeys()`（`providerRuntimeEnv.ts:198-206`）的清理范围里了，会永久留在 `dreamcoder/settings.json`。所以在 `migrateManagedSettings`（`persistentStorageMigrations.ts:188-198`）里加一份已退役键列表，删掉三个 `*_SUPPORTED_CAPABILITIES`、`CLAUDE_CODE_MODEL_CONTEXT_WINDOWS` 和 `DREAMCODER_SEND_DISABLED_THINKING`。这一步替代原来的 `normalizeLegacyDeepSeekManagedEnv` 调用。迁移每次启动都跑，只有内容变了才写文件（`persistentStorageMigrations.ts:211`）。

### 已运行会话何时生效

代理每个请求实时解析，用户保存覆盖或保存时拉取完成后，下一个经代理的请求就用新规则。CLI 只在启动时读一次规则，编辑提供方不会重启 CLI（`restartSession` 只在 `handler.ts:689, 722, 798, 810` 调用），所以 CLI 侧的规则在下次启动 CLI 时生效，例如切换模型、effort 或提供方。

两边在这段时间里可能不一致。例如用户把某个模型的档位改成「不支持思考」，CLI 仍会发 effort；代理按新规则 `control: 'none'` 不写思考字段，上游收到的是新规则。anthropic 格式提供方不经过代理，在 CLI 重启前仍按旧规则发请求。表单保存后提示「已打开的会话在下次切换模型或重新开始后生效」。

### 桌面端和 H5

- `GET /api/providers` 的每个提供方带上 `resolvedModels: Record<modelId, ResolvedModelRulesView>`。这个视图只含界面要用的字段：窗口、输出上限、`reasoning.control`、CLI 推导出的 `effortLevels`、`appliedEffort`、图片、PDF、`usedFallback`、`sources`。`appliedEffort` 是 `Record<EffortLevel, EffortLevel>`，对 `low/medium/high/max` 每一档给出 `resolveEffortForLevels` 换算后的档位，`effortLevels` 为空时不给。视图还带 `inherited`：去掉这个模型的用户覆盖后解析出的同一组字段和来源，表单用它显示每个字段的「默认值」。表单的思考摘要：没有覆盖时显示 `inherited`；草稿和已保存的覆盖相同时显示视图的结果（例如 gpt-5 选「能思考但没有档位」后是「始终开启」）；草稿还没保存时按选项原样显示。合成规则只在 server 算，桌面端不再写一份。思考怎么显示看 `control`：`none` 显示为不能思考，`effort` 和 `always` 显示为始终思考，`toggle` 和 `toggle_effort` 可以开关。界面上唯一的思考开关是常规设置里的全局开关，不跟着当前模型，所以这个显示只出现在提供方表单的模型摘要里，全局开关不变。不用 `thinkingWhenOff` 判断：它对 `none` 模型（兜底、`qwen-max`）也是 `omit`，会把不思考的模型显示成始终思考。档位用 CLI 推导函数的结果，不直接用 `reasoning.levels`：写法是 `anthropic_budget` 或 `anthropic_disable_only` 时 CLI 不发 effort，界面也就不该显示档位（例如 `api.kimi.com` 上的 kimi-k3）。桌面端不自己算规则。
- 提供方是官方 Anthropic 地址时，视图不给 `resolvedModels`，界面按原来的固定档位显示，和 CLI 走原逻辑一致。「是不是官方地址」由 server 的同一个函数判断（见「CLI」一节）。
- `ModelSelector` 的 effort 选项改为当前模型视图里的 `effortLevels`；为空时不显示 effort 选择。触发器显示的档位是 `appliedEffort[activeRuntimeSelection.effort ?? effortLevel]`。现在显示的是未换算的值（`ModelSelector.tsx:139`），全局缺省是 medium，换模型时保留原档位（`:150-158`）：DeepSeek 的选项是 low、high、max，触发器会显示 Medium，请求实际发 high。按换算表显示后，两边用的是 server 的同一个函数，会话选的档位和全局 effort 都覆盖到，改全局 effort 也不用重新拉视图。桌面端是独立的包，正式代码不 import 根目录 `src`，所以换算由 server 算好放进视图，不在桌面端再写一份。
- 「使用通用默认值」标记放在模型下拉项上（`ModelSelector.tsx:192` 的 `SelectItem`），不放在触发器上，因为触发器宽度有限（`ModelSelector.tsx:178`）。不在每一轮提示。
- 档位列表在根目录只有一份：定义在 `src/utils/model/modelRules.ts`（叶子模块，`EffortLevelSchema` 由它生成），`src/utils/effort.ts` 转出，server 改为 import `src/utils/effort.ts`。桌面端是独立包，只在 `desktop/src/types/settings.ts` 保留一份，`sessionRuntimeStore` 和组件都从那里取。
- 已保存、server 不给 `resolvedModels` 的提供方（官方 Anthropic 地址），表单不显示按模型覆盖：覆盖对它们不生效。
- H5 用同一套 React 组件，设置页的提供方标签对 H5 可见（`desktop/src/pages/Settings.tsx:146`），所以改动对 H5 同样生效，要在手机宽度下检查。

## 提供方表单

### 按模型覆盖

每个模型现在是一张卡片（`ProviderFormModal.tsx:896-964`），只有一个窗口输入框（`:919-935`）。改为：

- 卡片上显示一行摘要：窗口、输出上限、思考（关闭、档位列表或始终开启）、图片、PDF。用到兜底时在「默认模型」小字的位置（`ProviderFormModal.tsx:912-914`）加「使用通用默认值」。
- 摘要后面一个展开按钮。展开后在同一张卡片里占整行，显示五个字段：
  - 窗口、输出上限：数字输入，占位文字是继承来的值和它的来源（内置、提供方接口、兜底）。
  - 思考：`low/medium/high/max` 多选，外加「能思考但没有档位」和「不支持思考」两个选项，合成规则见上文。
  - 图片、PDF：三态，分别是继承、支持、不支持，用 `desktop/src/components/shared/SegmentedControl`（`shared/ui/switch.tsx` 的 `Switch` 只有两态）。
  - 每个字段旁边有「恢复默认」，清掉这个字段的覆盖。
- 窗口框现有的校验（`ProviderFormModal.tsx:102-109`）挪进新编辑器。点击「拉取模型」后预填窗口的逻辑（`:589-597, 616`）删除：拉取值由 server 存到 `discoveredModels`，表单只显示，不再写进覆盖。
- 其余组件用现有组件：数字框用 `shared/ui/input` 的 `Input`，档位多选用 `shared/ui/toggle-group` 的 `ToggleGroup`，三态用 `shared/SegmentedControl`。新增文案走 i18n，`en.ts` 和 `zh.ts` 同时加；`settings.providers.modelContextWindowsDesc`（`en.ts:524`、`zh.ts:526`）改写或删除。

### 和 #267 的请求头、查询参数表单共存

- #267 的请求头和查询参数属于连接设置，放在 API Key 之后、模型区之前（`ProviderFormModal.tsx:811-844` 之间），只在 `apiFormat !== 'anthropic'` 时显示，和 server 端的校验一致（`providerService.ts:330-336`）。
- 按模型覆盖在模型区的卡片里。两者一个是提供方级，一个是模型级，位置和数据都不重叠。按模型的请求头不做（ZCode 和 Codex 也没有）。
- 依赖关系：保存时拉取用已保存的完整 target，包含 `extraHeaders` 和 `queryParams`。所以 #267 补上表单后，Azure 这类需要 `api-version` 的端点也能拉取成功。现在「拉取模型」的入参不带这两项（`src/server/types/provider.ts:111-117`），点击拉取对这类端点会失败（推断）；这次一起补上。
- 提供方表单原来的 Settings JSON 编辑区整个删除（维护者决定，2026-11-19）。它在保存任何提供方时都把该提供方的 env 写进 `dreamcoder/settings.json`，不管是不是默认提供方；写入失败的 `catch` 是空的。提供方相关的 env 只由 server 写：`syncToSettings`（切换默认提供方、保存默认提供方时）。`DREAMCODER_MODEL_RULES` 只在启动 CLI 时生成，不写进 settings.json。已经被写脏的 settings.json 不迁移，下次切换或保存默认提供方时会被改回来。

## 关键流程

### 保存提供方

1. 表单提交 create 或 update，server 写 `providers.json`（`providerService.ts:117-184`）。`baseUrl` 或 `apiFormat` 变了时清空 `discoveredModels`。
2. server 用保存后的提供方构造 target，调用现有的拉取函数（`providerService.ts:321-328`）。拉取函数扩展为返回每个模型的窗口、输出上限、图片、PDF，见下一节。
3. 重新读取 index，只写入这个提供方的 `discoveredModels` 和 `discoveredAt`，再写回。先读再写，是因为现有的读改写没有锁，拉取期间可能有别的修改；这样缩小了覆盖别人修改的窗口，但没有消除。
4. 拉取失败不影响保存。失败原因记录日志，并在保存的响应里带一个警告，表单显示「没能从提供方读取模型信息」。已有的 `discoveredModels` 保留不清空。
5. 拉取在保存请求里同步完成。列表请求本身走 `fetchUpstreamModels`（`src/server/upstream/client.ts`），保存时给它 10 秒总超时（anthropic 格式最多翻 10 页，所有页共用这 10 秒）；之后补元数据那一步沿用现有的 10 秒总超时（`src/server/upstream/contextWindows/index.ts:19, 30`）。保存最多慢约 20 秒，在桌面端请求的 30 秒超时（`desktop/src/api/client.ts:85`）之内，上游卡住时保存照常成功并带「没能读取模型信息」的警告。表单的「拉取模型」按钮不传总超时，仍用网络设置里的 AI 请求超时（默认 120 秒，`networkSettings.ts:14`）。拉取由路由在保存成功后调 `refreshDiscoveredModels`，`addProvider`、`updateProvider` 本身不发网络请求。
6. 表单里的「刷新模型信息」按钮重复第 2 到 4 步。「拉取模型」按钮仍然用来列出可添加的模型 id。

### 拉取能读到什么

现有来源（`src/server/upstream/contextWindows/*`）的返回值从「窗口」改为「模型元数据」。各家接口实际返回的字段（核对日期 2026-11-18，来源见「内置表的初始条目」）：

| 来源 | 窗口 | 输出上限 | 模态 |
|---|---|---|---|
| DeepSeek `GET /models` | `context_window` | `max_output_tokens` | `input_modalities` |
| 百炼原生 `GET /api/v1/models` | `model_info.context_window` | `model_info.max_output_tokens` | `inference_metadata.request_modality` |
| Moonshot `GET /v1/models` | `context_length` | 无 | `supports_image_in` |
| OpenRouter `GET /api/v1/models` | `context_length` | `top_provider.max_completion_tokens` | `architecture.input_modalities` |
| Anthropic 格式 `GET /v1/models` | `max_input_tokens` | `max_tokens` | `capabilities` |
| MiniMax `GET /v1/models` | 无 | 无 | 无 |
| 智谱 | 未找到官方的列表接口 | | |
| Ollama `POST /api/show`、LM Studio | 现有代码已读窗口 | 推断：无 | 推断：`capabilities` 含 vision |

思考只从 OpenRouter 读（`src/server/upstream/contextWindows/openrouter.ts`），其他上游的列表没有这类字段，不猜。

- 读哪份列表：不管提供方是 chat 格式还是 anthropic 格式，都另外请求一次公开的 `GET https://openrouter.ai/api/v1/models`（OpenAI 格式，不带 Anthropic 请求头），不用保存时已经拉到的列表。原因是 anthropic 格式的拉取带 `anthropic-version` 请求头，OpenRouter 对它返回 Anthropic 格式的列表，只有 `max_input_tokens`、`max_tokens`，没有思考相关的字段（2026-11-19 核对：386 条，都没有）。两种格式走同一条路径，代价是 chat 格式保存时多一次 GET。
- ID 换算：anthropic 端点列出的 ID 是 OpenAI 列表里的 ID 加上 `anthropic/` 前缀和 `[1m]` 后缀，例如 `anthropic/nvidia/nemotron-3-ultra-550b-a55b:free[1m]` 对应 `nvidia/nemotron-3-ultra-550b-a55b:free`。Claude 型号不加前缀，只加后缀：`anthropic/claude-opus-4.7[1m]` 对应 `anthropic/claude-opus-4.7`。所以换算时先去掉 `[1m]`、`[2m]` 后缀；去掉 `anthropic/` 之后如果还剩一个 `/`，才去掉这个前缀。2026-11-19 核对时，anthropic 端点的 386 个 ID 按这条规则全部能在 OpenAI 列表里找到；OpenAI 列表的 479 个 ID 里没有带两个 `/` 的，所以 chat 格式的 ID 换算后不变。

按 [models API](https://openrouter.ai/docs/api/api-reference/models/get-models) 和 [reasoning tokens](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens)：

- 能不能思考：`supported_parameters` 含 `reasoning`，或者有 `reasoning` 对象（官方说非推理模型和路由模型不带这个对象）。两者都没有的，不记拉取值，仍走兜底。
- 能不能关：`reasoning.mandatory` 为 `true` 时官方说 effort `none` 会被拒绝，记为不能关（`effort`，没有档位时 `always`）；否则能关（`toggle_effort`，没有档位时 `toggle`）。
- 档位：`reasoning.supported_efforts` 和 CLI 的四档（low、medium、high、max）取交集，按从低到高排。`minimal`、`xhigh`、`none` 不在 CLI 档位里，不收。`supported_efforts` 为空或没有时，官方说是不限制，记为四档都可选：只支持 `max_tokens` 的模型，OpenRouter 会把 effort 换算成预算。
- 关思考时发什么：chat 格式用站点层的 `openrouter` 写法，发 `reasoning: { effort: 'none' }`（官方：none 完全关闭推理）。anthropic 格式（OpenRouter 的 Messages 接口）用拉取值带的 `anthropic_adaptive`：开启时发 `thinking: { type: 'adaptive' }` 加 `output_config.effort`，OpenRouter 换成各家的 effort；关闭时发 `thinking: { type: 'disabled' }`，换成 `reasoning: { enabled: false }`。没有给 anthropic 格式的 OpenRouter 加站点条目，因为站点层会盖过模型层，表里只支持 budget 的 Claude 型号（例如 `claude-opus-4-5`）会被改成 adaptive，而 OpenRouter 会把 Claude 的思考字段原样转给 Anthropic。
- 2026-11-19 核对时，OpenRouter 列表里有 358 个模型带 `reasoning` 对象，6 个只在 `supported_parameters` 里声明。

### 启动会话

1. server 按会话的提供方和选中模型调 `getProviderRuntimeEnv`（`conversationService.ts:1033-1036`）。
2. `getProviderRuntimeEnv` 在 `buildManagedEnv` 的结果之外，对选中模型、快速模型和提供方的全部模型调 `resolveModelRules`，再算出兜底的解析结果，按「从解析结果推导 CLI 字段」生成 `DREAMCODER_MODEL_RULES`。
3. CLI 的能力判断、窗口、输出上限都从这个变量取。

### 一次代理请求：DeepSeek V4 Pro 经 OpenRouter

用户在 custom 提供方（`openrouter.ai`，openai_chat）选了 `deepseek/deepseek-v4-pro`，effort 选 `max`。

1. 兜底给出完整字段。apiFormat 层只设端点字段：`reasoningDialect: reasoning_effort`、`maxTokensField: max_tokens`。
2. 模型层：`deepseek/deepseek-v4-pro` 不命中，剥一层后命中 `deepseek-v4-pro`：窗口 1,048,576，输出 393,216，`control: toggle_effort`，`levels: [low, high, max]`。模型层不设写法。
3. 站点层：第一步命中 `openrouter.ai` + openai_chat，`reasoningDialect: openrouter`，覆盖 apiFormat 层的 `reasoning_effort`；第二步没有前缀条目。同一个模型在 `api.deepseek.com` 上则命中那里的站点条目，用 `thinking_type`。
4. 拉取层：保存时从 OpenRouter 读到窗口 1,048,576、输出 393,216，和内置一致。
5. CLI 的规则是 `thinkingWhenOn: adaptive`、`effortLevels: [low, high, max]`，发 `thinking:{type:'adaptive'}`、`output_config.effort:'max'`、`max_tokens: 32000`。
6. 代理按 `openrouter` 写法发 `reasoning:{effort:'max'}`。`sources.maxOutputTokens` 是 `model`，所以发 `max_tokens: 32000`（不超过 393,216）。

同一个提供方上换成表里没有的模型时：能力字段都来自兜底，`control: 'none'` 所以不发思考字段，`sources.maxOutputTokens` 是 `fallback` 所以不发 `max_tokens`。

改前：代理不读 `output_config`，`adaptive` 也不产生字段，所以上游用自己的默认思考设置，也不发 `max_tokens`。如果是 DeepSeek 官方地址，代理还会原样透传 `thinking:{type:'adaptive'}`（`anthropicToOpenaiChat.ts:75-77`）。

### 推理回传

`reasoningReplay: same_as_received` 时：

1. **响应方向**：代理生成思考块时，把来源字段编码进 `signature`，格式是 `dc1:<source>:<payload>`。
   - `reasoning_content` 和 `reasoning`：载荷为空，推理文本就是思考块的 `thinking`。
   - OpenRouter 的 `reasoning_details`：载荷是数组的 JSON。
   - Responses 的 `encrypted_content`：载荷是加密串。
   - 上游自带的签名（`thinking_blocks[].signature`）放在载荷里。
2. **签名只发一次**：CLI 的 `signature_delta` 是覆盖赋值，不是追加（`src/services/api/claude.ts:2209`），`content_block_start` 时还会先置为空串（`:2093-2100`）。所以代理在思考块结束时只发一次 `signature_delta`；分片流来的 `reasoning_details` 和签名先在代理里缓冲。现在代理每个分片都发一次（`src/server/proxy/streaming/openaiChatStreamToAnthropic.ts:325-327`），要改。
3. **CLI 保存**：`signature` 在内存、transcript 和下一轮请求体里原样保留。请求里非 tool_use 的块原样传递（`src/utils/messages.ts:2250`，`claude.ts:659-679`）。会删掉思考块的只有：末尾思考块的过滤（`messages.ts:4878`）、只有思考的孤立消息的过滤（`messages.ts:5088`）、内部用户的降级路径（`src/query.ts:928-931`）。工具调用前的思考块后面跟着 tool_use，不在末尾，不会被删。
4. **请求方向**：代理读到带 `dc1:` 前缀的思考块，按来源写回：chat 消息的 `reasoning_content` 或 `reasoning_details`，Responses 的 reasoning item。来源字段要被当前端点接受：`reasoning_details` 只在写法是 `openrouter` 时写回，`encrypted_content` 只在 openai_responses 上写回，`reasoning_content` 和 `reasoning` 在 openai_chat 上写回。来源不被当前端点接受的块（会话中途换了提供方，例如从 OpenRouter 换到 DeepSeek 官方 chat）按没有前缀处理。没有前缀的思考块（升级前的旧会话、会话中途换了提供方）默认不写回；站点条目可以用 `unmarkedReasoningReplay: 'reasoning_content'` 让它们按 `reasoning_content` 写回。`api.deepseek.com` 的站点条目这样设，保持现在对旧会话的行为（`client.ts:271-275` 现在对 DeepSeek 一律写回）。
5. `reasoningReplay: 'off'` 只管有来源标记的块；没有标记的块仍按 `unmarkedReasoningReplay` 处理。上游自带的 `thinking_blocks[].signature` 会编码进载荷，但目前没有接受它的端点，写回时按没有标记处理。
6. Responses 请求在写回开着、模型能思考时带 `include: ['reasoning.encrypted_content']`，否则上游不返回 `encrypted_content`（P-REQ-08）。不请求推理摘要。
7. 写回时不再看 host。DeepSeek 带 tools 时要求之前所有轮次的 `reasoning_content` 都回传，否则返回 400（DeepSeek thinking_mode 文档）；按来源写回正好满足这一点。

**Gemini 的 `thought_signature` 不在本轮。** 它挂在工具调用上（`tool_calls[].extra_content.google.thought_signature`），不在推理字段里；这个位置只在第三方 issue 和论坛里见过，官方文档没写（未核实）。CLI 也带不回 tool_use 块上的额外字段：代理模式下工具搜索一定关闭（`src/utils/toolSearch.ts:299-311`，provider 是 firstParty、base URL 不是官方、server 不设 `ENABLE_TOOL_SEARCH`），此时 `normalizeMessagesForAPI` 把 tool_use 重建为只有 `{type, id, name, input}` 的对象（`messages.ts:2215-2247`），`claude.ts:1336-1349` 还会再剥一次。可行的载体是同一条消息里一个思考块的 `signature`（例如 `dc1:gemini_tool:<toolCallId>:<sig>`），但 Gemini 不返回推理文本时要造一个空思考块，空思考块在 CLI 里的去留没核实。所以本轮不做：Gemini 原生 OpenAI 兼容端点上多轮工具调用可能被拒（推断），作为已知限制。经 OpenRouter 用 Gemini 时，签名如果在 `reasoning_details` 里，会随 `reasoning_details` 一起写回（未核实）。

### 正文里的 `<think>` 标签

`thinkTagsInText: true` 时，代理的 chat 流转换和非流式转换在正文里识别 `<think>`…`</think>`（标签跨分片也能识别；Responses 没有做），把其中内容作为思考块发出（维护者决定：显示成思考块）。标题生成也就不会再把标签内容当成标题。

已知会这样输出的只有 MiniMax 在 `reasoning_split: false` 时（MiniMax chat 接口文档）。MiniMax 的站点条目用 `extraBody: { reasoning_split: true }` 让推理走 `reasoning_content`，所以这个开关主要留给没收录的端点由用户覆盖时用。

## 兜底条目

| 字段 | 值 | 理由 |
|---|---|---|
| `contextWindow` | 131,072（128K） | 维护者决定。高估窗口会撞上限：#263 之后能识别溢出并压缩，但会多一次失败的请求。低估只是压缩得早一点 |
| `maxOutputTokens` | 32,000 | 只用于 CLI 的预算；来源是兜底时代理不发输出上限字段，交给提供方默认（见「只发有出处的上限」） |
| `maxTokensField` | `max_tokens` | 只是字段名，apiFormat 层和站点层会改写 |
| `reasoningDialect` | `reasoning_effort` | 只为让兜底完整；apiFormat 层总会改写，`control: 'none'` 时也不生效 |
| `reasoning` | `control: 'none'` | 不发会被拒的字段；effort 选择器对这个模型不显示 |
| `input.image` | true | 维护者决定。纯文本模型收到图片会报错，用户能看到错误并在覆盖里关掉；反过来，关掉之后用户不知道模型其实看不到图片 |
| `input.pdf` | false | Read 读整个 PDF 报错并提示用 `pages`；`pages` 把页面转成图片发出（见「Read 工具和 PDF」） |
| `structuredOutput` | false | CLI 不写 `output_config.format`，代理不发 `response_format` |
| `nativeWebSearch` | false | 有 Tavily 或 Brave 就用它们，否则不提供搜索工具 |
| `reasoningReplay` | `same_as_received` | 收到什么写回什么；没收到就不写 |
| `unmarkedReasoningReplay` | `none` | 没有来源标记的思考块不写回 |
| `thinkTagsInText` | false | |
| `extraBody` | `{}` | |

## 内置表的初始条目

数值按厂商公开文档核对，核对日期 2026-11-18。核对用的是网页抓取的摘要，不是原文，实现时写进 JSON 前，再人工打开来源页核对每个数字。

- 状态 `verified`：官方页面上有这个值。
- `unverified`：只在第三方或搜索摘要里见到。
- `conflict`：官方页面之间说法不一，取较保守的值。

退役的模型不收录，走兜底，包括 DeepSeek 的 `deepseek-chat` 和 `deepseek-reasoner`（2026-07-24 停用），以及 MiniMax M2 系列（2026-11-18 退役）。例外是 `claude-opus-4-1`、`claude-opus-4`、`claude-sonnet-4`：Anthropic API 上已退役，Bedrock 和 Google Cloud 仍在提供，中转可能转发到那里。前缀写成规范化之前的样子，匹配时两边都做规范化。

### 模型层

| 前缀 | 窗口 | 输出 | 思考 | 图片 / PDF | 结构化 | 状态 | 来源 |
|---|---|---|---|---|---|---|---|
| `deepseek-v4-pro` | 1,048,576 | 393,216 | toggle_effort：low, high, max | 否 / 否 | 否（只有 json_object） | verified | [pricing](https://api-docs.deepseek.com/quick_start/pricing)、[list-models](https://api-docs.deepseek.com/api/list-models) |
| `deepseek-flash`、`deepseek-v4-flash` | 1,048,576 | 393,216 | 同上 | 是 / 否 | 否 | verified（v4-flash 已成为 deepseek-flash 的别名） | 同上、[updates](https://api-docs.deepseek.com/updates) |
| `qwen3.5-plus`、`qwen3.5-flash` | 1,000,000 | 65,536 | toggle，默认开 | 是 / 未写 | 是 | verified | [qwen3-5-plus](https://www.alibabacloud.com/help/en/model-studio/qwen3-5-plus)、[qwen3-5-flash](https://www.alibabacloud.com/help/en/model-studio/qwen3-5-flash) |
| `qwen-plus` | 1,000,000 | 32,768 | toggle，默认关 | 否 / 否 | 是 | verified | [qwen-plus](https://www.alibabacloud.com/help/en/model-studio/qwen-plus) |
| `qwen-max` | 32,768 | 8,192 | none | 否 / 否 | 是 | conflict：模型页 32,768，总览页 128K | [qwen-max](https://www.alibabacloud.com/help/en/model-studio/qwen-max) |
| `qwen3-max` | 262,144 | 32,768 | toggle | 未核实 | 未核实 | unverified：官方页 404 | 搜索摘要 |
| `qwen4-max` | 1,000,000 | 131,072 | toggle_effort：low, high（官方档位 low、high、xhigh，默认 high；xhigh 没有对应的 CLI 档位） | 是 / 未写 | 是 | verified（2026-11-19 按 qwen4-max 页核对） | [qwen4-max](https://www.alibabacloud.com/help/en/model-studio/qwen4-max) |
| `qwen-long` | 1,000,000 | 8,192 | none | 否 / 否 | 否 | verified；官方写 10,000,000，但 HTTP 请求最多 1M，我们按 1M | [qwen-long](https://www.alibabacloud.com/help/en/model-studio/qwen-long) |
| `kimi-k2.7-code` | 262,144 | 未写 | always（`thinking.type` 只收 enabled，传 disabled 报错；不支持 `reasoning_effort`） | 未核实 | 是 | verified（2026-11-19 按 chat 页核对）；已弃用，2026 年 12 月底下线 | [chat](https://platform.kimi.ai/docs/api/chat.md) |
| `kimi-k2` | 262,144 | 未写 | toggle | 未核实 | 是 | verified 窗口；输出未核实；K2 全系 2026 年 12 月下旬下线 | [models-overview](https://platform.kimi.ai/docs/api/models-overview.md) |
| `kimi-k3` | 1,048,576 | 131,072 | always：low, high, max | 是 / 未写 | 是 | verified；输出取默认值 131,072（最大 1,048,576） | [chat](https://platform.kimi.ai/docs/api/chat.md) |
| `glm-5.1`、`glm-5`、`glm-5-turbo`、`glm-4.7`、`glm-4.6` | 200,000 | 128,000 | toggle_effort：low, medium, high, max | 否 / 否 | 否 | verified「200K/128K」；精确值未核实（OpenRouter 报 204,800） | [glm-5.1](https://docs.z.ai/guides/llm/glm-5.1) 等 |
| `glm-4.5`（含 `glm-4.5-air`） | 128,000 | 96,000 | toggle | 否 / 否 | 否 | 同上 | [glm-4.5](https://docs.z.ai/guides/llm/glm-4.5) |
| `glm-5.3` | 1,000,000 | 128,000 | always：low, high, max | 否 / 否（只收文本） | 否（只有 json_object） | verified（2026-11-19 按 glm-5.3 页核对） | [glm-5.3](https://docs.z.ai/guides/llm/glm-5.3) |
| `glm-5.2` | 1,000,000 | 128,000 | toggle_effort：high, max（官方说 low、medium 按 high 处理，xhigh 按 max 处理） | 否 / 否（只收文本） | 否（文档只写 json_object） | verified（2026-11-19 按 glm-5.2 页和 chat-completion 参考核对） | [glm-5.2](https://docs.z.ai/guides/llm/glm-5.2)、[chat-completion](https://docs.z.ai/api-reference/llm/chat-completion) |
| `minimax-m3.1-flash` | 1,000,000 | 524,288 | always：low, medium, high, max | 是 / 未写 | 未写 | verified | [text-chat-openai](https://platform.minimax.io/docs/api-reference/text-chat-openai.md) |
| `minimax-m3` | 1,000,000 | 524,288 | toggle（adaptive/disabled） | 是 / 未写 | 未写 | verified | 同上 |
| `gpt-5`、`gpt-5.1`、`gpt-5.2` | 400,000 | 128,000 | gpt-5：effort（low, medium, high）；5.1、5.2：toggle_effort（low, medium, high） | 是 / 是 | 是 | verified | [gpt-5](https://developers.openai.com/api/docs/models/gpt-5) 等 |
| `gpt-5.4`、`gpt-5.5` | 1,050,000 | 128,000 | toggle_effort：low, medium, high | 是 / 是 | 是 | verified | [gpt-5.4](https://developers.openai.com/api/docs/models/gpt-5.4)、[gpt-5.5](https://developers.openai.com/api/docs/models/gpt-5.5) |
| `gpt-6-luna`、`gpt-6.1-terra` | 1,050,000 | 128,000 | toggle_effort：low, medium, high, max（官方 none 到 max，none 即关思考） | 是 / 是 | 是 | verified | [gpt-6-luna](https://developers.openai.com/api/docs/models/gpt-6-luna)、[gpt-6.1-terra](https://developers.openai.com/api/docs/models/gpt-6.1-terra) |
| `gpt-6.1-sol`、`gpt-6.2-sol`、`gpt-6.2-astra` | 1,050,000 | 128,000 | effort：low, medium, high, max（官方拒绝 none，不能关思考） | 是 / 是 | 是 | verified | [gpt-6.1-sol](https://developers.openai.com/api/docs/models/gpt-6.1-sol)、[gpt-6.2-sol](https://developers.openai.com/api/docs/models/gpt-6.2-sol)、[gpt-6.2-astra](https://developers.openai.com/api/docs/models/gpt-6.2-astra) |
| `gpt-4.1` | 1,047,576 | 32,768 | none | 是 / 是 | 是 | verified | [gpt-4.1](https://developers.openai.com/api/docs/models/gpt-4.1) |
| `gemini-2.5-pro` | 1,048,576 | 65,536 | always：low, medium, high | 是 / 是 | 是 | verified | [2.5-pro](https://aistudio.google.com/docs/models/gemini-2.5-pro) |
| `gemini-2.5-flash` | 1,048,576 | 65,536 | toggle_effort：low, medium, high | 是 / 未写 | 是 | verified | [2.5-flash](https://aistudio.google.com/docs/models/gemini-2.5-flash) |
| `gemini-3` | 1,048,576 | 65,536 | always：low, medium, high | 是 / 是 | 是 | verified（3.1-pro-preview、3.8-flash） | [thinking](https://aistudio.google.com/docs/thinking) |
| `claude-fable-5`、`claude-mythos-5`、`claude-opus-5-5`、`claude-sonnet-5-5` | 1,000,000 | 128,000 | effort：low, medium, high, max；写法 `anthropic_adaptive`（Fable、Mythos、Opus 5.5 始终思考，`disabled` 返回 400；Sonnet 5.5 也拒绝 `disabled`，它要的 `between_tools` 不在写法里） | 是 / 是 | 是 | verified | [models overview](https://platform.claude.com/docs/en/about-claude/models/overview)、[thinking 排错页](https://platform.claude.com/docs/en/build-with-claude/thinking-troubleshooting)、[effort](https://platform.claude.com/docs/en/build-with-claude/effort)、[structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs)、[web search](https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool) |
| `claude-opus-5`、`claude-sonnet-5`、`claude-haiku-5-5`、`claude-opus-4-8`、`claude-opus-4-7`、`claude-opus-4-6`、`claude-sonnet-4-6` | 1,000,000 | 128,000 | toggle_effort：low, medium, high, max；写法 `anthropic_adaptive` | 是 / 是 | 是 | verified | 同上 |
| `claude-opus-4-5`、`claude-sonnet-4-5`、`claude-haiku-4-5` | 200,000 | 64,000 | toggle（只支持 budget；Opus 4.5 虽认 effort，budget 写法不发 effort） | 是 / 是 | 是 | verified | 同上 |
| `claude-opus-4-1`、`claude-opus-4` | 200,000 | 32,000 | toggle | 是 / 是 | 否 | verified；Anthropic API 已退役 | 同上 |
| `claude-sonnet-4` | 200,000 | 64,000 | toggle | 是 / 是 | 否 | verified；Anthropic API 已退役 | 同上 |

说明：

- 表中写「未写」的，是官方页面没有提到，解析时不填，由下层或兜底决定。`kimi-k2` 的输出上限没找到出处，所以不填，来源是兜底，代理不发输出上限字段。
- Gemini 4、Kimi Code 专用 id（`k3.1-pro`、`kimi-for-coding`）这次没收录。Gemini 4 的规格页面信息不全；Kimi Code 的窗口按会员档位不同（[Kimi Code docs](https://www.kimi.com/code/docs/en/)）。收录哪些新模型是表的日常维护，不影响设计。
- GPT-6 系列按 [models](https://developers.openai.com/api/docs/models) 页和各型号页收录。`xhigh` 不在 CLI 的档位里，不收（同 Claude）。PDF 按 [file inputs](https://developers.openai.com/api/docs/guides/file-inputs) 的说法记为支持：收图片的模型都能读 PDF 的文字和页面图。`gpt-6-cyber` 只出现在专用模型列表里，没有规格，不收录。
- GPT-6 的「推理 + 工具」有限制，代码不做特殊处理，用户按格式选：Chat Completions 下 `gpt-6-luna` 只在 effort 为 none（关思考）时能调函数；`gpt-6.1-sol`、`gpt-6.1-terra` 调工具必须走 Responses。所以接这几个型号时用 `openai_responses` 格式；用 `openai_chat` 并开着思考时，带工具的请求会被上游拒绝。
- Claude 条目只在有提供方时生效，例如 OpenRouter 的 `anthropic/claude-opus-4.7`（规范化后命中 `claude-opus-4-7`）。没有提供方时 CLI 走原逻辑。
- Claude 条目除最后两行（Anthropic 的 web search 支持列表里没有它们）都设 `nativeWebSearch: true`，只在 anthropic 格式提供方生效。
- 1M 窗口对表里的 1M 型号是默认值，不需要 beta 头（[context windows](https://platform.claude.com/docs/en/build-with-claude/context-windows)）。CLI 官方路径的内置表（`modelContextWindows.ts:5`）把 `claude-sonnet-4-6` 写成 200,000，比官方页小；那是没有提供方时的原逻辑，本 PR 不改。

### 站点层

第一步的 host 条目：

| host | apiFormat | 写法 | 输出上限字段 | 其他 | 来源 |
|---|---|---|---|---|---|
| `api.deepseek.com` | openai_chat | `thinking_type` | `max_tokens` | `unmarkedReasoningReplay: 'reasoning_content'` | [thinking_mode](https://api-docs.deepseek.com/guides/thinking_mode) |
| `api.deepseek.com` | anthropic | `anthropic_adaptive` | `max_tokens` | adaptive 按 enabled 处理，effort 取 low/high/max | [anthropic_api](https://api-docs.deepseek.com/guides/anthropic_api) |
| `dashscope.aliyuncs.com`、`dashscope-intl.aliyuncs.com`（新加坡）、`maas.aliyuncs.com` 后缀 | openai_chat | `enable_thinking` | `max_completion_tokens` | | [chat API](https://www.alibabacloud.com/help/en/model-studio/qwen-api-via-openai-chat-completions) |
| `api.moonshot.ai`、`api.moonshot.cn` | openai_chat | `thinking_type` | `max_completion_tokens` | | [chat](https://platform.kimi.ai/docs/api/chat.md) |
| `api.kimi.com`、`api.kimi.ai`（海外） | anthropic | `anthropic_disable_only` | `max_tokens` | Kimi Code 端点，Kimi 预设用它；保持现在的行为，端点对 adaptive、budget、effort 的处理未核实 | [Kimi Code docs](https://www.kimi.com/code/docs/en/) |
| `open.bigmodel.cn`、`api.z.ai` | openai_chat | `thinking_type` | `max_tokens` | | [chat-completion](https://docs.z.ai/api-reference/llm/chat-completion) |
| `open.bigmodel.cn`、`api.z.ai` | anthropic | `anthropic_disable_only` | `max_tokens` | 智谱预设用它；端点对思考字段的处理文档未写，保持现在的行为 | [bigmodel claude](https://docs.bigmodel.cn/cn/guide/develop/claude/introduction) |
| `api.minimax.io` | openai_chat | `thinking_adaptive` | `max_completion_tokens` | `extraBody: { reasoning_split: true }` | [text-chat-openai](https://platform.minimax.io/docs/api-reference/text-chat-openai.md) |
| `api.minimax.io` | anthropic | `anthropic_adaptive` | `max_tokens` | | [text-chat-anthropic](https://platform.minimax.io/docs/api-reference/text-chat-anthropic.md) |
| `openrouter.ai` | openai_chat | `openrouter` | `max_tokens` | | [reasoning-tokens](https://openrouter.ai/docs/use-cases/reasoning-tokens) |
| `api.openai.com` | openai_chat | `reasoning_effort` | `max_completion_tokens` | | [chat create](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create) |
| `api.openai.com` | openai_responses | `responses_reasoning` | `max_output_tokens` | | [reasoning guide](https://developers.openai.com/api/docs/guides/reasoning) |
| `generativelanguage.googleapis.com` | openai_chat | `reasoning_effort` | `max_tokens`（未核实） | | [openai compat](https://aistudio.google.com/docs/openai) |

anthropic 格式那几行的「输出上限字段」是从 apiFormat 层继承来的，站点条目本身不设 `maxTokensField`：它对 anthropic 格式不起作用，数据测试禁止在这类条目上设。

第二步的前缀条目：

| host | apiFormat | 前缀 | 内容 | 来源 |
|---|---|---|---|---|
| `api.moonshot.ai`、`api.moonshot.cn` | openai_chat | `kimi-k2` | `extraBody: { thinking: { keep: 'all' } }`，K2 要这样才读历史推理 | [chat](https://platform.kimi.ai/docs/api/chat.md) |
| `api.moonshot.ai`、`api.moonshot.cn` | openai_chat | `kimi-k3` | `reasoningDialect: reasoning_effort`（K3 不认 `thinking`） | 同上 |
| `open.bigmodel.cn`、`api.z.ai` | openai_chat | `glm-` | `extraBody: { thinking: { clear_thinking: false } }`，要这样才保留历史推理 | [thinking-mode](https://docs.z.ai/guides/capabilities/thinking-mode) |

关于 apiFormat 层的默认值：openai_chat 的输出上限字段默认 `max_tokens`。几家把它标为「将被弃用」但仍然接受，而 `max_completion_tokens` 在一些兼容端点上不被识别（推断）。OpenAI 官方地址在站点层改成 `max_completion_tokens`，因为它的推理模型不接受 `max_tokens`。

### 发现的问题，作为后续处理

- 预设里引用的模型有的已经弃用或成了别名：Kimi 预设只有 `kimi-k2.6`；Qwen 预设的快速模型 `qwen-turbo` 在官方页面上已经找不到；DeepSeek 的 `deepseek-v4-flash` 成了别名。更新预设是另一件事，这次不改，另开 issue 跟踪。
- 我们现在的窗口数字有几处和官方不一致：DeepSeek 是 1,048,576 不是 1,000,000；`gpt-5.4` 和 `gpt-5.5` 是 1,050,000；MiniMax M2 的 204,800 没核实到。并进新表时一起改，另开 issue 跟踪。

## #264 各项怎样落到表上

| 条目 | 用到的字段 | 改动 |
|---|---|---|
| P-REQ-02 effort 和思考开关传不到上游 | `reasoning`、`reasoningDialect`、`defaultEffort` | 主对话总是带明确档位（会话选的或全局的）；代理读 `output_config.effort` 和 `thinking.type`，按写法生成字段；DeepSeek 和 opencode.ai 不再收到 `adaptive` |
| P-NET-09、P-NET-14 能力按提供方声明 | 模型层 `reasoning`，CLI 的 `thinkingWhenOn`、`thinkingWhenOff`、`effortLevels` | custom 不再一律全开；Kimi、GLM 不再收到它们不认的 effort |
| P-RES-02、P-REQ-07、P-REQ-08 推理不回传 | `reasoningReplay`、`unmarkedReasoningReplay`，签名里的来源字段 | 响应方向记录来源，请求方向原样写回；删除按 host 的判断。Gemini 工具调用签名不在本轮 |
| P-REQ-03、P-REQ-04、P-REQ-11 PDF 和图片 | `input.image`、`input.pdf` | 支持时按各格式的方式携带（chat 的 `file`、Responses 的 `input_file`，工具结果里的图片同理）；不支持时换成说明文字；CLI 的 Read 按模型判断 |
| P-NET-10 未列出模型的窗口 | `contextWindow`，取值顺序为用户覆盖、拉取值、表、兜底 | 保存时拉取并存下 |
| P-REQ-05 输出上限 | `maxOutputTokens`、`maxTokensField`、`sources` | 上限有出处时发 min(CLI 请求值, 上限)，来自兜底时不发；CLI 的升级重试不超过上限 |
| P-REQ-09 原生搜索变成空函数 | `nativeWebSearch` | CLI 按它选搜索后端，不支持时不提供原生工具 |
| P-REQ-14 标题生成 | 同一套写法和输出上限 | 标题请求按辅助调用处理：能关的模型关掉思考，不能关的带最弱一档；能限制输出 |
| P-REQ-15 结构化输出 | `structuredOutput` | 不支持时 CLI 不写 `output_config.format`；代理在 chat 写 `response_format`，Responses 写 `text.format` |
| P-RES-10 正文里的 `<think>` | `thinkTagsInText` | 拆成思考块 |
| P-REQ-16 按模型的额外请求体字段 | `extraBody` | 取代按 host 写的临时判断 |

## 失败与错误处理

- 内置表 JSON 不合法：sidecar 启动时 zod 校验失败，直接报错退出。这是打包错误，测试会拦住。
- `providers.json` 里的覆盖不合法：API 入口拒绝，返回 400，带错误码（`MODEL_OVERRIDE_DUPLICATE`、`MODEL_OVERRIDE_EXTRA_BODY_ANTHROPIC`、`MODEL_OVERRIDE_DIALECT_MISMATCH`），表单和 #267 拒绝请求头时一样显示 server 返回的说明。表单本身只编辑窗口、输出上限、档位、图片、PDF，只有手写进文件的 `extraBody` 和写法会触发这几种拒绝。手写进文件的不合法覆盖，在读取时丢弃这一个字段，并记日志写明提供方、模型和字段。
- 保存时拉取失败：保存照常完成，响应带警告；已有的 `discoveredModels` 保留不清空。
- CLI 没有 `DREAMCODER_MODEL_RULES`：按原逻辑运行。变量存在但解析失败：记日志，全部模型按 `fallback`；`fallback` 也解析失败时按兜底条目的固定值。CLI 不会因此不能启动。
- 写法和档位不匹配（例如用户把档位覆盖成上游不认的值）：上游返回 400，按 #263 的错误分类显示给用户，不重试。

## 测试策略

- `resolveModelRules` 的单元测试：
  - 六层叠加的每一层都能覆盖下一层；
  - 最长前缀；剥一层 `vendor/`；去掉 `[1m]` 后缀；点号和连字符等价；
  - 前缀边界：`gpt-5-2025-08-07` 命中 `gpt-5` 不命中 `gpt-5.2`，`gpt-4-1106-preview` 不命中 `gpt-4.1`，`glm-4.5v`、`glm-4.6v`、`glm-5v-turbo` 不命中 `glm-4.5`、`glm-4.6`、`glm-5`；
  - 站点层两步：前缀条目叠在 host 条目之上，host 条目的写法保留（例如智谱 `glm-5.1` 仍用 `thinking_type`）；
  - 同一 host 按 apiFormat 取不同条目；
  - `usedFallback` 和 `sources`，包括命中只带端点字段的前缀条目时仍为兜底；
  - 用户 `reasoningLevels` 和下层 `control` 的每种组合；
  - 图片、PDF 和思考的拉取值只在下层为兜底时生效；思考拉取值带的写法要和 apiFormat 配套。
- 内置表的数据测试：
  - 每条有 `source.url` 和 `checkedAt`；
  - `models` 的 `modelPrefix` 唯一，`sites` 的 (host, apiFormat, modelPrefix) 唯一；
  - 窗口在合法范围内；`levels` 都在 `EFFORT_LEVELS` 里；`control` 为 `effort` 或 `toggle_effort` 的条目 `levels` 非空；
  - 模型条目里没有端点字段，只有 Claude 条目可以设 anthropic 写法和 `nativeWebSearch`；`extraBody` 没有保留键；anthropic 格式的站点条目不设对它们不起作用的字段；
  - 每条前缀站点条目都有对应的 host 条目。
- 代理的写法测试：每种写法在这些输入下生成的请求体：关闭、开启带档位、没有 thinking 带 effort、模型没有档位时开启、什么都没有；模型有档位却收到「开启、没有 effort」时用全局 effort 换算。chat 和 Responses 各一组；档位不在 `levels` 里时的换算；`maxTokensField` 和 `extraBody` 的深合并；`control: 'none'` 时 `extraBody` 里写法所属的键不合并。
- `auxiliaryThinking` 的单元测试按四条规则的顺序各一例，另加 `anthropic_disable_only` 下的 `none` 模型（`kimi-for-coding` 在 Kimi 预设上）发 disabled。
- server 的标题、连接测试：能关思考的模型发 disabled，`always` 模型不发 disabled、带最弱一档，`thinkingWhenOff` 为 `omit` 的 `none` 模型不发思考字段；代理的 anthropic 透传分支原样转发请求体。
- 连接测试：编辑已保存的 Kimi 预设，表单改成 openai_chat + `api.moonshot.ai` 后测试，按覆盖后的提供方解析，不用 `anthropic_disable_only`；第三方地址改成官方地址后测试，按官方地址处理。
- 兜底不被上层改掉：表里查不到的模型经 openai_chat、openai_responses 和各站点条目解析后，请求里没有输出上限字段，也没有思考字段；同一个模型加上用户覆盖的输出上限后，才发输出上限字段。
- 推理回传的往返测试要经过 CLI 的真实路径：代理的流输出 → CLI 的流累积（`claude.ts` 的 `content_block_*` 处理）→ transcript → `normalizeMessagesForAPI`（非官方地址、工具搜索关闭）→ 下一轮代理请求。只测代理两头的转换函数测不出 CLI 会丢掉什么。覆盖 `reasoning_content`、分片的 `reasoning_details`（只发一次签名）、`encrypted_content`；DeepSeek 带工具的多轮请求里每一轮都带着 `reasoning_content`；没有前缀的旧思考块在 DeepSeek 上写回、在其他 host 上不写回；会话中途从 OpenRouter 换到 DeepSeek 官方 chat 时，标成 `reasoning_details` 的块按 `reasoning_content` 写回。
- CLI 请求体测试：给定 `DREAMCODER_MODEL_RULES`，对 anthropic 格式提供方断言 `claude.ts` 实际发出的 `thinking`、`output_config.effort`、`output_config.format`、`max_tokens`：
  - `always` 模型关思考时不发 disabled，effort 照发；
  - `anthropic_budget` 不发 effort；
  - `anthropic_disable_only` 开思考时什么都不发、关思考时发 disabled，模型落到兜底时也发；
  - 主对话：会话没选档位、用户设置里也没有 `effort` 时，请求带 medium 换算后的档位（DeepSeek 上是 high，gpt-5 上是 medium）；会话选 max 时 gpt-5 上换成 high，DeepSeek 上选 low 不变；定时任务带全局 effort；`CLAUDE_CODE_EFFORT_LEVEL` 仍然优先；有规则时 settings 里的 `effortLevel` 不生效，没有规则时照旧生效；
  - 辅助调用：`queryHaiku` 和 sideQuery 对 `thinkingWhenOff` 为 `disabled` 的模型发 disabled（含 `anthropic_disable_only` 下的 `none` 模型），对 `effort`/`always` 模型带最弱一档，对其余 `none` 模型不发；sideQuery 传数字 `thinking` 时开启并带最弱一档；sideQuery 同时带 effort 和 format 时两者都在 `output_config` 里；
  - 有规则时，sideQuery 的 betas 里没有 `interleaved-thinking-2025-05-14`（DeepSeek 预设和 Kimi 预设各一例）；
  - sideQuery 在 `structuredOutput: false` 时不写 `output_config.format`；
  - `structuredOutput: false` 时不发 format；
  - 升级重试不超过上限（测试要强制打开 `tengu_otk_slot_v1`，它默认关闭，`src/query.ts:1184-1187`）。
- CLI 函数测试：变量缺失时各函数的结果和改前一致（官方 Claude 不受影响）；变量不合法时走 `fallback`。测试要还原环境变量和 memoize 缓存。
- server 测试：
  - 没指定提供方的定时任务，子进程环境里有 `DREAMCODER_MODEL_RULES`；
  - 会话统计在 `providerId` 为 null、没有 `runtime-config` 记录、提供方是官方地址三种情况下分别用活动提供方、活动提供方、原逻辑；
  - 界面视图的 `effortLevels` 和 CLI 推导一致，`appliedEffort` 和 `resolveEffortForLevels` 一致（DeepSeek 上 medium 对应 high），官方地址的提供方不给 `resolvedModels`。
- 迁移测试：
  - 旧的 `modelContextWindows` 转进 `modelOverrides`，等于冻结的旧预设值或旧 CLI 表值的不迁；
  - settings.json 里的已退役键被删掉；
  - 旧的 DeepSeek 兼容配置能正常加载；
  - 重复启动不改写文件。
- 桌面端测试：effort 选择器按模型过滤档位，触发器显示换算后的档位（DeepSeek 上全局缺省显示 High）；兜底标记；覆盖表单的继承值、恢复默认、提交内容。浅色和深色主题、中英文、H5 手机宽度都要手动看一遍。

## 迁移与发布

磁盘上的数据：

- `providers.json` 的 `modelContextWindows` 由启动迁移转成 `modelOverrides`，规则见上文。转换是幂等的，不会每次启动都改写文件。
- `dreamcoder/settings.json` 里的已退役键由 `migrateManagedSettings` 删除，见「已退役键的清理」。

在同一个 PR 里完成，按下面的顺序实现，后面的步骤依赖第一步：

1. 内置表、解析函数、`DREAMCODER_MODEL_RULES` 的生成、CLI 各处改读、旧变量删除、存储字段和迁移。代理暂时不改，行为变化只在 CLI 侧：effort 和思考按模型判断，窗口和输出上限按表。
2. 代理的思考写法、输出上限、结构化输出（P-REQ-02、P-REQ-05、P-REQ-15、P-REQ-14）。
3. 推理回传（P-RES-02、P-REQ-07、P-REQ-08）和 `<think>` 拆分（P-RES-10）。
4. 图片和 PDF（P-REQ-03、P-REQ-04、P-REQ-11）、原生搜索（P-REQ-09）、`extraBody`（P-REQ-16）。
5. 保存时拉取和存储（P-NET-10），以及表单的按模型覆盖界面、兜底标记、effort 选择器。和 #267 的表单改动协调先后。

## 考虑过的其他方案

- **照搬 Codex：已知条目加一条兜底，没有端点层。** Codex 只支持 Responses 一种格式，条目里不需要描述字段写法（Codex `codex-rs/model-provider-info/src/lib.rs:102-138`）。我们的问题大多出在写法上：同一个 DeepSeek 模型，在官方 chat 接口要发 `thinking` 加 `reasoning_effort`，在 OpenRouter 要发 `reasoning.effort`。没有端点层就只能回到按 host 写代码。
- **照搬 ZCode：所有命中的规则依次叠加，写法用表达式语言。** 叠加没有「最具体优先」，宽松正则容易误命中，维护要靠「通用的写在前面」这种约定（ZCode `packages/provider/src/config/model-config.ts:387-423`）。表达式语言（受限 CEL）的灵活性我们用不上：我们自己做协议翻译，写法的种类有限，写成代码更容易测试。ZCode 的 chat 默认写法一次发四个思考字段，对严格的端点可能报 400（推断）。
- **用 opencode 的外部目录（models.dev）。** 中国厂商的细节整理得最全，但依赖网络，随包快照约 8MB，目录格式还是实验版，而且目录一变应用行为就变。推理字段的写法仍然靠约 50 个按 SDK 包和模型名写的函数（opencode `packages/core/src/variant.ts:606-690`）。可以作为写条目时核对事实的参考资料。
- **写法用数据描述（字段路径加取值），不用枚举。** 灵活，但等于半个表达式语言，测试要覆盖任意组合。维护者确认用封闭枚举。
- **CLI 环境变量只放选中模型和快速模型。** agent 定义、skill、plugin 命令、hook 可以写任意模型 id，所以要带上提供方的全部模型和兜底。
- **把 `DREAMCODER_MODEL_RULES` 放进 `buildProviderManagedEnv`。** 会写进 settings.json、出现在编辑器里，并让 CLI 进程执行 server 的解析代码，见「CLI」一节。

## 未决问题与风险

下面几条是复核时记下、这一版不处理的：

- 升级重试受开关 `tengu_otk_slot_v1` 控制，默认关闭（`src/query.ts:1184-1187`），所以「升级值不超过上限」这条改动大多数时候不会触发。
- `yoloClassifier` 经 `sideQuery` 传 `thinking: false`（`src/utils/permissions/yoloClassifier.ts:670-674` 的说明）。按辅助调用的规则，`always` 模型改为带最弱一档，不再发 disabled。auto mode 只对部分 Claude 模型开放，第三方基本走不到。
- `src/cli/print.ts:1250-1262` 的 `supportedEffortLevels` 仍按「支不支持 max」推算，server 和桌面端都没读它。
- 档位名按原样写到线上，没有按端点映射。OpenRouter 的 `reasoning.effort` 认不认 `max` 未核实。
- `anthropic_budget` 写法下 `budget_tokens` 等于 `max_tokens` 减 1，即 31,999 对 32,000（`src/services/api/claude.ts:1669-1676`），思考可能用掉全部输出额度。
- opencode.ai 上的旧会话不再写回推理（`client.ts:339-344` 的特判删掉后，opencode.ai 没有站点条目）。
- 档位换算会升档：按「取比它高的最低一档」，DeepSeek（low、high、max）上全局 effort 为缺省的 medium 时发 high。改前 DeepSeek 预设只在用户设了全局 effort 时才发 effort（`getDefaultEffortForModel` 对 DeepSeek 返回 undefined，`src/utils/effort.ts:279-329`），没设时由上游默认（DeepSeek chat 接口文档写默认 high；anthropic 接口的默认未核实）。改后默认总发 high，和 chat 接口的默认一致；推理更长，花费可能比改前略高（推断）。
- 前缀边界挡不住同一系列里的非推理模型：`gpt-5-chat-latest` 会命中 `gpt-5`，被当成 `effort` 模型。需要时为它单独加条目。
- CLI 的 Codex 登录路径（`src/services/openaiAuth/fetch.ts`）本来就 import 代理的 Responses 转换函数。转换函数现在必须带规则，这条路径用 `resolveModelRules({ baseUrl: Codex 端点, apiFormat: 'openai_responses' }, 模型)` 取内置表的规则，于是多 import 了一个 server 模块。思考档位按请求里的 `output_config.effort` 写进 `reasoning.effort`，不再按 thinking budget 换算。这条路径去掉 `max_output_tokens`：main 上它从不发这个字段，ChatGPT 的 Codex 后端是否接受没有核实。和下一条属于同一类已有的分层问题。
- `src/utils/managedEnv.ts:4` 现在就 import 了 server 代码（`mergeActiveProviderManagedEnv`），这是已有的分层问题，不是本设计引入的；本设计删掉的是同文件 `:12, 108` 对 `providerManagedEnvCompat` 的引用。
- 一批关思考的内部调用不走 `auxiliary`：`compact.ts:1301`、`awaySummary.ts:44`、`execPromptHook.ts:71`、`execAgentHook.ts:134`、`apiQueryHookHelper.ts:88`、`skillImprovement.ts:236`、`generateAgent.ts:152`、insights 的 `queryWithModel`。toggle 类模型照样发 disabled；`effort`/`always` 模型带 `defaultEffort` 换算后的档位，不是最弱一档。不在维护者列的辅助调用范围内，接受。
- 官方地址不生成规则变量：会话和全局都没选档位时仍不发 effort（API 默认 high），界面显示 medium，和「档位从哪里来」里不改原逻辑的取舍一致。
- 「没有规则变量的请求」里「终端路径的主对话也带明确档位」只对名字像 Claude 的模型成立；终端里用 `deepseek-v4-pro` 时 CLI 不发 thinking 也不发 effort，代理归为未指定。
- `none` 模型在 `anthropic_disable_only` 写法下（例如 Kimi Code 上的 `kimi-for-coding`）按模型摘要显示「不能思考」，但上游默认开着思考。思考开关是全局的，只影响显示。


- 表里的数值会过期。这次核对时，多数中国厂商已经出了下一代，K2 和 MiniMax M2 系列已经或即将下线。拉取值和用户覆盖可以兜住大部分情况；表的维护要跟着版本发布走。
- 这次核对用的是网页摘要，写进 JSON 前要人工打开来源页再核对一遍。
- Gemini 原生 OpenAI 兼容端点上多轮工具调用缺 `thought_signature` 可能被拒，本轮不处理，见「推理回传」。
- 签名里编码来源字段后，会话中途从 OpenAI 格式提供方换到 anthropic 格式提供方时，历史里的 `dc1:` 签名会被原样发给 anthropic 兼容端点，可能被拒（推断）。这和 CLI 换 key 后签名失效属于同一类问题（`src/utils/messages.ts:5157-5163`）。这一版不处理，出现时再修。
- agent teams 队友在第三方提供方下用硬编码的 Claude id（`src/utils/swarm/teammateModel.ts:8-10`），这一版按兜底处理。正确的做法是让它默认继承主模型，留给 agent teams 的工作处理。
- GLM-4.7 在 API 参考里写「始终思考」，指南里写「可以关」，两处矛盾。这一版按 `toggle_effort` 收录，以实测为准。
- anthropic 格式提供方不经过代理，CLI 直接发请求，而 Anthropic 格式要求必带 `max_tokens`。表里查不到的模型因此仍会收到 32,000，和现在一样。输出上限更低的模型需要用户在覆盖里填上限。
- 例子里经代理的请求现在会发 `max_tokens: 32000`，以前不发。推理 token 计入输出上限的端点（OpenAI 的 `max_completion_tokens` 就是这样）上，长推理可能被截断（推断）。实现后用基准任务观察，必要时让 CLI 对经代理的请求用更高的默认值。
- Kimi Code 和智谱 anthropic 端点用 `anthropic_disable_only` 保持现在的行为：开思考时不发任何字段，靠上游默认。这两个端点是否认 adaptive 和 effort 没有核实，核实后可以改成 `anthropic_adaptive`。
- 终端里直接运行 CLI 时没有规则，Kimi、智谱不再在关思考时发 disabled。
- 保存时拉取是同步的，上游卡住时保存最多慢约 20 秒；读改写之间仍有一段没有锁的窗口。
- 手写进 `providers.json` 的不合法覆盖在每次读取提供方时都会丢弃并记一次日志，包括每个代理请求，没有去重。
- 表单原样保留手写的 `reasoningDialect` 和 `extraBody`。在表单里把 apiFormat 改成和它们不配套的格式后保存，会收到 400，界面上没有清掉这两个字段的入口，要去改文件。
- 覆盖的键只是写法和模型 id 不同（例如手写 `DeepSeek-V4-Pro`、模型 id 是 `deepseek-v4-pro`）时，解析能命中，但表单按原始 id 取草稿，看不到这条覆盖，下次在表单里保存时它会被删掉。只影响手写的键。

## 附录：删除和修改清单

`*_SUPPORTED_CAPABILITIES`：

- 定义和读者：`src/utils/model/modelSupportOverrides.ts`；`src/utils/thinking.ts:6, 92, 126`；`src/utils/effort.ts:7, 28, 54`；`src/utils/betas.ts:29, 93`。
- server：`src/server/services/providerRuntimeEnv.ts:27, 29, 31`（`MANAGED_PROVIDER_ENV_KEYS`）、`:40`、`:231-238`、`:242`；`src/server/config/providerPresets.json` 里 DeepSeek 的 `defaultEnv`。
- 清理列表：`src/server/services/conversationService.ts:1001-1005, 1135-1139`；`src/utils/managedEnvConstants.ts:54, 58, 62, 129, 133, 137`；`desktop/src/lib/providerSettingsJson.ts:13, 17, 21`。
- 测试：`src/utils/__tests__/thinking.test.ts`、`src/server/__tests__/conversation-service.test.ts:453`、`providers.test.ts:201-233`、`provider-presets.test.ts:84`、`persistence-upgrade.test.ts:318-324`。

`CLAUDE_CODE_MODEL_CONTEXT_WINDOWS` 和 `modelContextWindows`：

- CLI：`src/utils/model/modelContextWindows.ts:1-3, 9-32, 35-48, 58-110`；`:112-132` 保留，只去掉对环境变量的查找；`src/utils/context.ts:76-85` 改为有规则时读规则。
- server：`providerRuntimeEnv.ts:4, 34, 159-161, 225-228, 243-245`；`src/server/types/provider.ts:41-45, 60, 82, 97`；`providerService.ts:131, 160, 165-166`；`src/server/config/providerPresets.ts:22`；`src/server/upstream/contextWindows/index.ts:3, 62`（校验改用 `src/utils/model/modelRules.ts` 的范围 schema）。
- 清理列表：`conversationService.ts:1009, 1143`；`managedEnvConstants.ts:68, 157`；`desktop/src/lib/providerSettingsJson.ts:25`。
- 桌面端：`desktop/src/types/provider.ts:19, 32, 48, 63`；`desktop/src/types/providerPreset.ts:15`；`ProviderFormModal.tsx:43-45, 102-150, 176-196, 253, 455, 466-468, 503-506, 525-527, 564, 646-682, 897, 925, 967, 1049-1051`；i18n 的 `settings.providers.modelContextWindowsDesc`（`en.ts:524`、`zh.ts:526`）。
- 测试：`src/services/compact/autoCompact.test.ts:9-52`、`providers.test.ts:258-264, 404-428, 613-621`、`provider-presets.test.ts:117-123`、`desktop/src/components/settings/ProviderFormModal.test.tsx`、`desktop/src/lib/__tests__/providerSettingsJson.test.ts:54`。

`DREAMCODER_SEND_DISABLED_THINKING`：

- 读者：`src/utils/thinking.ts:183-185`；`src/services/api/claude.ts:184, 1608`；`src/utils/sideQuery.ts:22, 226`。
- 写入：`providerPresets.json` 里 Kimi、智谱的 `defaultEnv`。
- 清理列表：`conversationService.ts:1006, 1140`。
- 测试：`thinking.test.ts:26-107`、`providers.test.ts:226, 611, 619`、`provider-presets.test.ts:83, 97, 119`、`persistence-upgrade.test.ts:302, 317`、`providerSettingsJson.test.ts:57-60`。

`providerManagedEnvCompat.ts`：文件本身、`src/utils/__tests__/providerManagedEnvCompat.test.ts`，调用方 `src/utils/managedEnv.ts:12, 108`、`persistentStorageMigrations.ts:4, 194`。

提供方表单的 Settings JSON 编辑区：

- 桌面端：`ProviderFormModal.tsx` 里的读取、合并、反填、保存时写入和它们的状态；`desktop/src/lib/providerSettingsJson.ts` 和它的测试；`desktop/src/api/providers.ts` 的 `getSettings`、`updateSettings`；i18n 的 `settings.providers.settingsLoadFailed`、`settingsJson`、`settingsJsonModelsGenerated`、`settingsJsonDesc`、`jsonError`。
- server：`GET/PUT /api/providers/settings` 路由和 `ProviderService.updateManagedSettings`。`getManagedSettings` 保留，`/api/models` 和 WebSocket 处理取默认模型时还在读。

其他：

- `isMiniMaxAnthropicEndpoint`（`thinking.ts:112-122`）。
- `shouldUseDeepSeekReasoningCompat` 及两个选项（`client.ts:271-275, 339-344`；`anthropicToOpenaiChat.ts:14-17, 75-77, 86, 139, 148`），测试 `src/server/__tests__/proxy-transform.test.ts:152, 195`。
- effort 档位的副本：`src/server/api/models.ts:28`、`desktop/src/stores/sessionRuntimeStore.ts:9-10`、`ModelSelector.tsx:98-103`、`GeneralSettings.tsx:126-131`。

文档：`docs/features/harness/comparison/model-adaptation.md`、`docs/features/harness/proxy/transport.md`、`docs/features/harness/proxy/request.md` 提到这些环境变量；`docs/tutorial/07-provider-presets.en.md` 和 `07-provider-presets.zh.md` 讲预设的 `modelContextWindows` 字段。实现时同步。
