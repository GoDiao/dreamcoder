# Harness 调整

状态：长期进行，跟踪见 [RFC: Harness evolution](https://github.com/GoDiao/dreamcoder/issues/261)。本文是总览；五个维度的详细对比在 [comparison/](comparison) 下，代理层的专项评审在 [proxy/](proxy) 下，文字层的专项评审在 [prompt/](prompt) 下。

## 背景

DreamCoder 的 CLI 派生自 Claude Code 2.1.92（`src/constants/claudeCodeCompatibility.ts:7`）。用户大多接第三方模型（GLM、DeepSeek、Kimi 等），请求经本地代理（`src/server/proxy`）从 Anthropic Messages 格式转成 OpenAI 格式。

[FrontierHarness Eval](https://frontierharness.org/live/)（2026-11）用 62 个终端任务、22 个 harness、5 个开放权重模型（经 Baseten 的 OpenAI 兼容端点）做了对比。结果：

- 通过率在 50.6% 到 61.9% 之间，两两差距大多在 95% 置信区间内，排名参考价值有限。
- 成本和耗时差距大。Claude Code（2.1.308）每任务约 421 万输入 token、7.1 万输出 token、41 分钟；Codex CLI 约 296 万、3.6 万、27 分钟。
- 按通过率和成本，帕累托前沿是 Codex CLI、Pi、ZCode。Codex 和 ZCode 在 5 个模型上都稳定在前 4 名。

所以本次对比选了 Codex CLI 和 ZCode，目标是找出 DreamCoder 在非 Claude 模型上多花 token 和轮数的原因。

## 对比的场景

一次 headless 编码任务，模型是经 OpenAI 兼容端点接入的第三方模型。

- Codex CLI：`codex exec`，自定义 `model_providers`，模型不在内置目录里（走回退元数据）。注意这个版本已删除 chat-completions 协议，只能接 `/v1/responses` 端点。
- ZCode：CLI `--prompt`，`openai-chat-completions` 协议。
- DreamCoder：服务器以 `--print` 启动 CLI，`ANTHROPIC_BASE_URL` 指向本地代理，上游格式 `openai_chat`；`USER_TYPE` 不是 `ant`，构建期 `feature()` 全部为 false，GrowthBook 关闭。

全部是静态读源码，没有运行任何项目。字符数是从源码字符串按场景分支拼出后计数的；标「推断」的是没有直接测到的结论。

参考代码是本地浅克隆，放在 `refs/coding-agents/`（不进 git）。报告里的路径前缀：

| 前缀 | 仓库与版本 | 相对目录 |
|---|---|---|
| `codex:` | [openai/codex](https://github.com/openai/codex) 标签 `rust-v0.164.0`（与 benchmark 同版本） | `codex-rs/` |
| `zcode:` | [zai-org/ZCode](https://github.com/zai-org/ZCode) 提交 `fec97590`，CLI 0.17.1（benchmark 用 0.17.0） | `apps/zcode-cli/packages/` |
| 无前缀 | DreamCoder，`main` 上的 `75d9b3bf` | 仓库根 |

## 总表

| | Codex | ZCode | DreamCoder |
|---|---|---|---|
| 工具数 | 12，另加托管搜索 | 24 | 34 |
| 工具描述 | 约 7.4K 字符 | 21.5K | 63.7K |
| 工具定义（含 schema） | 12–15K | 28–31K | 82–86K |
| 系统提示词（首个请求） | 17.7K | 6.5K 起 | 26.5K，其中记忆说明 12.5K |
| 每个请求的固定部分 | 约 4.6 万字符 | 约 2.7 万 | 约 12 万（约 3 万 token） |
| 前缀缓存 | 前缀逐请求不变，带 `prompt_cache_key` | 前缀不变，带会话 id | system 第 79 个字符起每个请求都变 |
| 推理强度传到上游 | 传 | 按模型映射 | 不传 |
| 输出上限传到上游 | 不发 | 发 | CLI 发，代理丢弃 |
| 编辑匹配不上时 | 4 遍逐级放宽 | 7 种回退 | 只处理弯引号 |
| 读超大文件 | 用 shell 读 | 返回前一部分 | 报错 |
| 读 `AGENTS.md` | 读 | 读 | 不读 |
| 示例任务的模型往返（推断） | 约 4 次 | 5 次 | 5–7 次 |

示例任务：找到函数 `foo` 的定义，改一行，跑测试文件。

## DreamCoder 的主要问题

### 1. 提供方的前缀缓存失效

- 代理给每个请求的 system 开头补一行计费标识（`src/server/proxy/handler.ts:64`，`src/server/proxy/claudeCodeAttribution.ts:29`），修复前这一步不看模型名。
- 发出前，这一行里的 `cch=00000` 被替换成整个请求体的哈希（`src/server/upstream/client.ts:211-224`，`src/utils/claudeCodeCch.ts:57-59`）。请求体每轮都不同，所以这一行每轮都变，位置在 system 的第 79–83 个字符。
- 除这一行外，DreamCoder 的前缀本来是稳定的：system 各段会话内缓存，日期和 git 状态只算一次，工具按名字排序。
- 代理还丢掉了 `cache_control`，也不发会话亲和信息。
- 后果：固定部分约 3 万 token 加全部历史，每个请求都按全价计。详见 [request-cache.md](comparison/request-cache.md)。
- 实测（#262，OpenRouter 测试 key）：OpenAI 和 GLM 把工具定义排在 system 之前，带计费行时每轮只命中工具定义那一段，system 和历史全部未命中；去掉计费行后同一会话后续轮次命中约 99%。DeepSeek 经 DeepInfra 这条路上，这一行在到达模型前被去掉了，不受影响。已在 #262 修复：代理只对 Claude 模型加这一行。

### 2. 代理翻译丢信息

- 推理强度：CLI 对自定义提供方发 `thinking:{type:'adaptive'}`，代理只在带预算或类型为 `enabled` 时写 `reasoning_effort`（`src/server/proxy/transform/anthropicToOpenaiChat.ts:64-72`），桌面上选的 Effort 不起作用。
- 输出上限：`max_tokens` 不转发，实际用上游默认值。
- 错误：上游错误统一包成 `api_error`，`retry-after` 丢失；CLI 针对 Anthropic 的错误识别（上下文过长、过载）对翻译后的错误不命中。已在 #263 修复：代理解析上游错误并透传 `retry-after`，代理和 CLI 按同一张表分类（见 proxy/transport.md 的 P-NET-03、P-NET-04）。
- 推理内容：只对 DeepSeek 一类上游写回历史里的 `reasoning_content`，Kimi、GLM 的会丢。
- 图片：工具结果里的图片被换成 `[image omitted]`（`src/server/proxy/transform/toolArguments.ts:31`）。
- 工具调用：chat 流里没有 id 的工具调用整个被丢掉。

详见 [model-adaptation.md](comparison/model-adaptation.md)。

### 3. 每个请求的固定部分太大

- Bash 描述 10,003 字符，其中 6,253 是 git 提交和 PR 流程。
- 13 个产品工具（ShowUI、看板、会话、产物、设计）共 21,265 字符，每个请求都带。服务器无条件打开它们（`src/server/services/conversationService.ts:1052-1058`），大多没有标记可延迟。
- ToolSearch 依赖 Anthropic 的 `defer_loading` 和 `tool_reference`，非 Anthropic 地址下关闭（`src/utils/toolSearch.ts:299-303`）。ZCode 的本地模式（ToolSearch 加固定的 DeferredToolCall）在任何 chat 端点都能用。
- 记忆说明 12.5K，记忆目录为空时也发。通用行为条文 9.2K，ZCode 同类内容约 1.6K。
- EnterPlanMode（4,022 字符）和 4 个 Task 工具要求模型主动使用。

详见 [tools.md](comparison/tools.md) 和 [prompt.md](comparison/prompt.md)。

### 4. 对非 Claude 模型发送 Claude 专属文字

- 身份前缀 "You are a Claude agent…"；环境段列出 Claude 模型 ID、Claude Code 产品形态和 `/fast`。
- Read 工具自称能看图和 PDF，但图片会被代理换成文字。
- 每次 Read 后追加约 340 字符的恶意软件提醒，只有 `claude-opus-4-7` 豁免（`src/tools/FileReadTool/FileReadTool.ts:727-735`）。
- 确定的 bug：模型名不在公开列表时，提交署名固定为 `Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>`（`src/utils/attribution.ts:73-80`），会写进用户仓库。

详见 [prompt.md](comparison/prompt.md)。

### 5. 执行层

- 编辑只处理弯引号，缩进、行尾空白、行号前缀、转义的偏差都会直接失败。ZCode 有 7 种回退，Codex 有 4 遍逐级放宽。已在 #299 修复：精确和弯引号之后，依次尝试行号前缀、行尾空白、缩进、转义四种匹配，每种都要求只有一个候选；缩进匹配上时按同一关系调整 `new_string`，找不到统一的对应关系就不匹配（`src/tools/FileEditTool/matchEdit.ts`）。执行时按当时的文件匹配，确认框和 hook 拿到的是按匹配结果改写后的输入，用户确认的就是要写入的文本；会话记录和对话里的工具卡片仍是模型给的原文。Edit 和 Write 成功的结果里加了一句不需要读回；Edit 实际写入的文本和模型给的 `new_string` 不同，或者用户在确认时改过内容，就不加。
- Read 超过 25,000 token 直接报错，模型要多一轮按段重读；ZCode 返回前一部分。已在 #299 修复：超过 token 上限或字节上限时按行返回能放下的前一部分，并说明返回的行范围、总行数和继续读的方法；一行都放不下时仍然报错。被裁过的读之后 Edit 可以继续，Write 会被拒绝，直到有一次没被裁的读；CLI 重启后从会话记录恢复时，这个限制仍然保留。用 `@` 附上的文件也按同一规则返回前一部分。
- 不读 `AGENTS.md`，`src` 里只有 `/init` 提到它。DreamCoder 自己的仓库就只有 `AGENTS.md`。
- 外部构建里没有「完成前先验证」的条文。
- 没有空响应重试和重复调用提醒（ZCode 有）。
- 不在内置表里的模型（如 GLM-5.3、Kimi-K3），上下文窗口按 200K 计。
- 工具在一次模型回复读完之后才执行：`tengu_streaming_tool_execution2` 在 DreamCoder 里打不开（见 loop-execution.md）。

详见 [loop-execution.md](comparison/loop-execution.md)。

## 建议的顺序

1. 代理层：对非 Claude 模型去掉计费行；转发推理强度和输出上限；保留错误类型和 `retry-after`；通用回传推理内容。改之前和改之后各用测试 key 测一次缓存命中，作为基准。
2. 去掉发给非 Claude 模型的 Claude 专属文字，修署名 bug；读 `AGENTS.md`。
3. 缩小固定部分：产品工具按需发送（参照 ZCode 的本地延迟加载）；git 流程从 Bash 描述移到 skill；缩短记忆说明。
4. 执行层：编辑容错、Read 超限时返回前一部分、空响应重试。
5. 每个改动在能直接量的地方报告数字，例如固定部分减少的字符数、同一会话改前改后的缓存命中、示例任务的往返次数。不建固定的基准任务集（维护者 2026-11-21 决定）。

## 待定

以下是产品决定，需要维护者确定：

- Task 工具和计划模式对非 Claude 模型是否降级或改为按需。
- 记忆说明保留多少。
- 产品工具按什么条件发送（会话是否用到该功能，或一律延迟加载）。

## 代理层专项评审

第一个落地的区域是 CLI 和第三方提供方之间的代理层（`src/server/proxy`、`src/server/upstream`，以及相关的提供方配置）。三份评审逐项对照了 Codex 和 ZCode，共 45 条发现，每条写了现状、场景、两家做法、改法方向和确定程度：

| 文件 | 范围 | 编号 |
|---|---|---|
| [proxy/request.md](proxy/request.md) | 请求方向：从 CLI 的请求到发往上游的字节 | P-REQ-01 到 16 |
| [proxy/response.md](proxy/response.md) | 响应方向：从上游的流到 CLI 收到的 Anthropic 格式 | P-RES-01 到 15 |
| [proxy/transport.md](proxy/transport.md) | 传输、容错和提供方配置 | P-NET-01 到 14 |

按三批处理，每批一个 issue，挂在 RFC 下面：

1. 请求通路的基础问题：计费行、60 秒空闲断开和流空闲超时、base URL、取消传到上游、`NO_PROXY`、缓存键和缓存命中统计，以及请求头配置、日志、`count_tokens` 等小项。
2. 上下文、错误和流的健壮性：上下文溢出识别、用量为 0、错误结构化和 `retry-after`、重试分类、结束原因映射、流提前结束和流中错误。
3. 按模型的能力：先设计一张按模型的规则表，再接上推理强度和思考开关、能力声明、推理数据回传、图片和 PDF、上下文窗口和输出上限。规则表的设计见 [model-rules.md](model-rules.md)。

## 文字层专项评审

第二个专项区域是模型读到的、对话以外的全部文字：系统提示词、工具描述、会话开始时加载的上下文、会话中途注入的文字。四份评审逐项对照了 Codex 和 ZCode，共 79 条发现。写法和代理层评审相同：每条都有现状、场景、两家的做法、改法方向和确定程度。

| 文件 | 范围 | 编号 |
|---|---|---|
| [prompt/system.md](prompt/system.md) | 系统提示词：主会话各段、子 agent、压缩和标题等辅助请求 | T-SYS-01 到 18 |
| [prompt/tools.md](prompt/tools.md) | 工具描述和 schema，以及工具自己返回的固定文字 | T-TOOL-01 到 22 |
| [prompt/context.md](prompt/context.md) | 上下文加载：指令文件、记忆、环境、清单类上下文、压缩和子 agent | T-CTX-01 到 16 |
| [prompt/reminders.md](prompt/reminders.md) | 会话中途注入：提醒、附件、合成消息、服务器对用户输入的包装 | T-INJ-01 到 23 |

维护者已定的条目在报告里有状态行。主要结论：

- 指令文件按 `DREAMCODER.md` > `AGENTS.md` > `CLAUDE.md` 的优先级读取，每个目录读一个。
- CLI 重启（用户停止后、切换 effort、模型或提供方时）会丢掉中途注入的上下文，并让前缀缓存失效。
- 提交署名、读文件后的恶意软件条款、环境段等文字是写给 Claude Code 的；身份行保持不变。
- 只在 Anthropic 内部构建生效的条文不打开，直接删除。

正确性部分由一个总 issue 跟踪，其中范围清楚的条目拆成子 issue。缩小固定部分和补充缺失的指引会改变模型行为，单独开 issue 处理，每个改动报告它能直接量到的数字。

## 详细报告

| 维度 | 文件 | 内容 |
|---|---|---|
| A | [tools.md](comparison/tools.md) | 工具清单和大小、能力对照、长描述的内容、产品工具、延迟加载机制、工具顺序 |
| B | [prompt.md](comparison/prompt.md) | 系统提示词逐段对比、话题覆盖、ZCode 相对 Claude Code 的删改、Claude 专属文字、记忆、动态上下文、中途提醒、子 agent 和压缩提示词 |
| C | [request-cache.md](comparison/request-cache.md) | 请求布局、逐轮变化、缓存控制、上下文增长、压缩、额外请求、每个请求的固定开销 |
| D | [model-adaptation.md](comparison/model-adaptation.md) | 到提供方的路径、代理逐字段翻译、推理强度、每个模型的参数来源、输出上限、对非原生模型的容错、错误和重试、辅助请求用的模型 |
| E | [loop-execution.md](comparison/loop-execution.md) | 循环结束条件、工具执行、文件编辑、读取和搜索、shell、子 agent、规划工具、示例任务推演 |
