# 文字层评审：系统提示词（T-SYS）

范围：发给模型的 system 内容本身。包括主会话 `getSystemPrompt` 在本场景生成的每一段、CLI 在每个请求前加的身份行、服务端追加或替换的提示词、段落顺序与缓存性、内置子 agent 的 system、以及本场景会发给用户所选模型的辅助请求（压缩、服务端标题、WebFetch 二次处理等）的提示词。记忆说明、环境段、git 状态段的加载机制归 T-CTX，工具描述归 T-TOOL，中途提醒归 T-INJ；这些文字只要直接写在 system 里，其措辞和体量在这里评。

场景：桌面端服务器以 `--print --input-format stream-json --output-format stream-json` 启动 CLI（`src/server/services/conversationService.ts:142-158`），模型经 OpenAI 兼容端点接入（GLM、DeepSeek、Kimi、Qwen 一类），请求经本地代理（`openai_chat`），`USER_TYPE` 不是 `ant`，`feature()` 全为 false，GrowthBook 关闭。服务器设的环境变量见 `conversationService.ts:1053-1083`，其中影响 system 的有 `CLAUDE_CODE_ENABLE_TASKS=1`、`CLAUDE_COWORK_MEMORY_PATH_OVERRIDE`、`DREAMCODER_SHOW_UI`、`DREAMCODER_SESSION_LINKS`、`DREAMCODER_ARTIFACT_EDIT_LOCKS`，以及对非 `claude*` 模型置 `CLAUDE_CODE_ATTRIBUTION_HEADER=0`（`src/server/services/attributionHeaderPolicy.ts:3-15`）。`--model` 是上游模型 ID 本身（`src/server/services/providerRuntimeEnv.ts:221,248`）。另看了「模型名是 Claude、走 Anthropic 格式直连」路径，只在文字对两种模型应当不同时写。

路径约定：DreamCoder 相对仓库根，读的是 `main` 干净检出（`ce209f69`）；`codex:` 相对 `refs/coding-agents/codex/codex-rs`（`rust-v0.164.0`）；`zcode:` 相对 ZCode 仓库根（`fec97590`）。

测量方法：

- 在 scratchpad 下写了两个 bun 脚本，从 `main` 检出直接导入 DreamCoder 的函数取字符串计数，`CLAUDE_CONFIG_DIR` 与 `DREAMCODER_CONFIG_DIR` 指向空目录，环境变量按上面服务器的设置给，模型名 `glm-5.1`，cwd 是一个空 git 仓库。
  - `sys.ts`：`setIsInteractive(false)`、`initBundledSkills()`，用真实的 `getTools(getEmptyToolPermissionContext())` 取工具集（34 个，含 Agent、AskUserQuestion、Skill、TaskCreate 系、EnterPlanMode、EnterWorktree、ShowUI、Kanban 系），调用 `getSystemPrompt`、`getCLISyspromptPrefix`、`splitSysPromptPrefix`、`getSystemContext`，按代理的拼法（块之间 `\n`，`src/server/proxy/transform/anthropicToOpenaiChat.ts:22-25`）拼成发出去的 system 文本。
  - `sub.ts`：`getBuiltInAgents()` 的每个 agent 走 `enhanceSystemPromptWithEnvDetails`；另取 `getCompactPrompt`、`getPartialCompactPrompt`、`getCompactUserSummaryMessage`、`makeSecondaryModelPrompt` 的长度。
  - 服务端标题提示词用 Python 从源码字面量计数。
- 字符数为 JS 字符串长度（UTF-16 码元，本文涉及的文字全是 ASCII 与少量 `—`，等于字符数）。测量用的 cwd 和 memory 路径都是 135 字符；表中「典型」一列按 `/Users/alice/Projects/app`（25 字符）与 `~/.dreamcoder/projects/-Users-alice-Projects-app/memory/` 展开后（67 字符）折算。
- 没有对任何模型发请求，没有跑 DreamCoder 测试。Codex、ZCode 只读源码。

## 0. 本场景发出的 system，逐段

### 0.1 主会话

顺序按发出顺序（`src/services/api/claude.ts:1394-1403` 先放计费行与身份行，再放 `getSystemPrompt` 的数组；`src/query.ts:451` 在末尾追加 git 状态）。代理把所有块用 `\n` 拼成一条 role=system 消息，`cache_control` 不进入上游请求。

| # | 段 | 位置 | 实测 | 典型 | 会话中途是否变 | 结论 |
|---|---|---|---|---|---|---|
| — | 计费行 | `src/constants/system.ts:52-57`，`claude.ts:1396` | 0 | 0 | — | 非 `claude*` 模型不加；代理也只对 `claude*` 模型补（`src/server/proxy/handler.ts:69`）。已查无问题 |
| 0 | 身份行 | `src/constants/system.ts:12,30-46` | 62 | 62 | 进程内固定 | T-SYS-01 |
| 1 | intro | `src/constants/prompts.ts:175-184` | 834 | 834 | 静态 | 第二个身份句见 T-SYS-01；安全声明与 URL 条见第 4 节 |
| 2 | `# System` | `prompts.ts:186-197` | 1 625 | 1 625 | 静态 | T-SYS-08、T-SYS-11 |
| 3 | `# Doing tasks` | `prompts.ts:199-253` | 3 267 | 3 267 | 静态 | T-SYS-03、T-SYS-06、T-SYS-10 |
| 4 | `# Executing actions with care` | `prompts.ts:255-267` | 2 832 | 2 832 | 静态 | T-SYS-06、T-SYS-14 |
| 5 | `# Using your tools` | `prompts.ts:269-314` | 1 622 | 1 622 | 静态（随 TaskCreate/TodoWrite 是否在工具集） | T-SYS-06、T-SYS-18 |
| 6 | `# Tone and style` | `prompts.ts:430-442` | 706 | 706 | 静态 | T-SYS-06、T-SYS-11 |
| 7 | `# Output efficiency` | `prompts.ts:403-428` | 730 | 730 | 静态 | T-SYS-06、T-SYS-16 |
| — | `__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__` | `prompts.ts:573` | 34 | 0 | — | 拼块时跳过（`src/utils/api.ts:374`），不发出 |
| 8 | `# Session-specific guidance` | `prompts.ts:352-400` | 1 286 | 1 286 | 按名缓存，`/compact`、进出 worktree 时重算 | AskUserQuestion、Agent、Explore、`/<skill>` 四条；T-SYS-06、T-SYS-18 |
| 9 | `# auto memory` | `src/memdir/memdir.ts:199-266` | 12 633 | 约 12 565 | 按名缓存 | T-SYS-02、T-SYS-05、T-SYS-14 |
| 10 | `# Environment` | `prompts.ts:651-710` | 918 | 约 808 | 按名缓存；进出 worktree 时重算 | T-SYS-04、T-SYS-18 |
| 11 | `# Language` | `prompts.ts:142-149,502-504` | 0 | 0 或约 250 | 按名缓存 | 只在桌面设置了回复语言时出现；T-SYS-15 |
| 12 | `# Output Style` | `prompts.ts:151-158,505-507` | 0 | 0 | — | 桌面端不设输出样式；见第 4 节 |
| 13 | `# MCP Server Instructions` | `prompts.ts:513-520,579-604` | 0 | 视 MCP | **每轮重算** | T-SYS-17 |
| 14 | `summarize_tool_results` | `prompts.ts:523-526,841` | 157 | 157 | 静态文字 | T-SYS-08 |
| 15 | `gitStatus: …` | `src/context.ts:96-103`，`src/utils/api.ts:437-447` | 258（空仓库） | 数百至约 2 400 | 进程内 memoize，压缩后不刷新 | 措辞见 T-SYS-18；加载归 T-CTX |
| | **合计（不含 git 状态）** | | **26 692** | **约 26 510** | | |

其中 `splitSysPromptPrefix` 走「global cache + 找到边界」分支（`src/utils/api.ts:362-409`；`shouldUseGlobalCacheScope` 只看是否 firstParty，`src/utils/betas.ts:228-233`），切成身份行 62、静态块 11 628（第 1–7 段，块内 `\n\n` 相连）、动态块 15 000 三块。经代理时这三块合成一条消息，分块只对 Anthropic 格式直连有意义（见第 7 节交给 C 维度的一行）。

本场景不进入的段（逐个核对过条件）：`ant_model_override`（`prompts.ts:136-140`）、`scratchpad`（GrowthBook `tengu_scratch`，`src/utils/permissions/filesystem.ts:434-436`）、`frc`（`feature('CACHED_MICROCOMPACT')`，`prompts.ts:821-824`）、`numeric_length_anchors`（ant，`:529-537`）、`token_budget`（`feature('TOKEN_BUDGET')`，`:538-551`）、`brief`（`:552-554`）、proactive 整套（`:466-489`）、`CLAUDE_CODE_SIMPLE` 分支（`:450-454`）、fork 子 agent 指引（`feature('FORK_SUBAGENT')`，`src/tools/AgentTool/forkSubagent.ts:32-39`）、verification 合同（`feature('VERIFICATION_AGENT')`，`prompts.ts:390-395`）、DiscoverSkills（`feature`）、`!` 命令提示（非交互时去掉，`:368-370`）、advisor 说明（`src/utils/advisor.ts:60-69`）。

服务端追加或替换：没有。服务端不传 `--system-prompt`、`--append-system-prompt`（`conversationService.ts:142-158,970-985`），也不发带 `systemPrompt`/`appendSystemPrompt` 的 `initialize` 控制请求（服务端发出的控制请求只有 `set_permission_mode`、`set_max_thinking_tokens`、`interrupt` 和 `requestControl` 的几种查询，`conversationService.ts:576-615`，`src/server/api/sessions.ts:533-552`），所以走 `buildEffectiveSystemPrompt` 的默认分支（`src/utils/systemPrompt.ts:115-122`），`QueryEngine` 的 memory-mechanics 追加也不触发（`src/QueryEngine.ts:333-336` 要求有自定义 system）。设计、幻灯片、产物、看板、侧聊这些模式不改 system：`/design`、`/slides` 是 bundled skill（`src/skills/bundled/index.ts:25-27`），由用户消息展开；看板、会话链接、产物是工具（T-TOOL）；侧聊与派生会话的说明是写进新会话的一条 note（`src/server/services/sessionLinksService.ts:30-35`，T-INJ）。

### 0.2 内置子 agent

`sdk-cli` 入口下的内置 agent 是 general-purpose、statusline-setup、Explore、Plan、verification（`src/tools/AgentTool/builtInAgents.ts:58-81`；外部构建 verification 默认开，`:24-27`）。每个子 agent 的 system = 身份行 62 + agent 正文 + Notes 630 + `<env>` 段（`src/constants/prompts.ts:760-791`，`src/tools/AgentTool/runAgent.ts:931-955`），身份行同样由 `claude.ts:1397` 加上。

| agent | 正文位置 | 正文 | 合计（典型路径） | 模型 | 结论 |
|---|---|---|---|---|---|
| general-purpose | `src/tools/AgentTool/built-in/generalPurposeAgent.ts:3-24` | 1 288 | 约 2 230 | 主模型 | T-SYS-01、T-SYS-13 |
| Explore | `exploreAgent.ts:13-57` | 1 949 | 约 2 890 | `haiku` → 提供方的 fastModel | T-SYS-01 |
| Plan | `planAgent.ts:14-71` | 2 274 | 约 3 210 | inherit | T-SYS-01 |
| verification | `verificationAgent.ts` | 9 497 | 约 10 440 | inherit | T-SYS-14；见 T-SYS-03 |
| statusline-setup | `statuslineSetup.ts:3-132` | 6 993 | 约 7 930 | `sonnet` → 主模型 | T-SYS-12 |
| 回退（`getSystemPrompt` 抛错时） | `prompts.ts:758` | 402 | — | — | T-SYS-01 |

### 0.3 辅助请求

| 请求 | 本场景是否发 | system | 其他提示文字 | 结论 |
|---|---|---|---|---|
| 自动/手动压缩（fork 路径） | 是 | 与主会话相同（共享前缀，`src/services/compact/compact.ts:1175-1190`） | 用户消息 5 581（`src/services/compact/prompt.ts:293-303`）；部分压缩 3 695 / 3 687 | T-SYS-07 |
| 压缩回退路径 | fork 失败时 | 身份行 + 「You are a helpful AI assistant tasked with summarizing conversations.」（`compact.ts:1298-1300`） | 同上 | T-SYS-01 |
| 压缩后的续接消息 | 是 | — | 约 600 字符包装（`prompt.ts:337-374`），是用户消息 | 交给 T-INJ |
| 服务端标题 | 是，第 1、3 条用户消息后（`src/server/ws/handler.ts:902-926`） | 700（`src/server/services/titleService.ts:11-25`），不经 CLI，无身份行 | 用户消息为对话原文前 2 000 字符 | T-SYS-09 |
| WebFetch 二次处理 | 用 WebFetch 时 | 只有身份行 62（`src/tools/WebFetchTool/utils.ts:516-518` 传空数组） | 模板 527（非预批准域名）/ 165（`src/tools/WebFetchTool/prompt.ts:23-46`）+ 页面内容 | T-SYS-01；模板见第 4 节 |
| 工具摘要 | 否 | — | 需 `CLAUDE_CODE_EMIT_TOOL_USE_SUMMARIES`（`src/query/config.ts:36-38`） | — |
| 提示建议 | 否 | — | SDK 路径要 `initialize` 带 `promptSuggestions`（`src/cli/print.ts:2324-2327`），服务端不发 | — |
| 会话记忆 / 提取记忆 / autoDream / 相关记忆召回 | 否 | — | `tengu_session_memory`（`src/services/SessionMemory/sessionMemory.ts:80-82`）、`feature('EXTRACT_MEMORIES')`、`tengu_onyx_plover`（`src/services/autoDream/config.ts:13-20`）、`tengu_moth_copse`（`src/utils/attachments.ts:2349-2353`） | — |
| 子 agent 进度摘要 | 否 | — | `getSdkAgentProgressSummariesEnabled()`（`src/tools/AgentTool/AgentTool.tsx:863,946`） | — |
| Bash 前缀 Haiku 调用 | 否 | — | 只在测试注入时调用（`src/tools/BashTool/bashPermissions.ts:2393`） | — |
| CLI 侧标题 / 侧问 | 否 | — | 服务端不发 `generate_session_title`、`side_question`（`git grep` 服务端与桌面端无结果）；侧聊是派生出的新会话 | — |

## 1. 发现清单

### T-SYS-01 每个请求的 system 首行把第三方模型说成 Claude，子 agent 再叠一层「Claude Code」身份

- 状态：维护者已定（2026-11-18）：不改，所有模型保留现有身份行。
- 类型：问题
- 严重程度：高
- 体量：身份行 62 字符，每个请求（主会话、子 agent、压缩、WebFetch 二次处理）都发；子 agent 正文开头的 Claude Code 身份 70–90 字符，每次启动子 agent 发；压缩回退路径另有 70 字符。
- 现状（按执行顺序）：
  1. 所有经 `queryModel` 的请求都在 system 最前面放 `getCLISyspromptPrefix(...)`（`src/services/api/claude.ts:1394-1403`；`queryModelWithoutStreaming` 也走这里，`claude.ts:708-735`）。
  2. 非 Vertex、非交互、没有 append 时返回 `You are a Claude agent, built on Anthropic's Claude Agent SDK.`（`src/constants/system.ts:12,39-44`）。服务端从不传 append（见 0.1），所以桌面端每个会话都是这一句。
  3. 主会话紧接着是 intro 的第二个身份句 `You are an interactive agent that helps users with software engineering tasks.`（`prompts.ts:180`），之后 Environment 段写 `You are powered by the model glm-5.1.`（`prompts.ts:663-666`）。同一条 system 里三处说法：Claude agent、interactive agent、glm-5.1。
  4. 子 agent：general-purpose 正文首句 `You are an agent for Claude Code, Anthropic's official CLI for Claude.`（`generalPurposeAgent.ts:3`），Explore `You are a file search specialist for Claude Code, Anthropic's official CLI for Claude.`（`exploreAgent.ts:24`），Plan `...planning specialist for Claude Code.`（`planAgent.ts:21`），statusline-setup（`statuslineSetup.ts:3`），回退 `DEFAULT_AGENT_PROMPT`（`prompts.ts:758`）。它们前面还有第 2 步的身份行，所以子 agent 的 system 前两句是两个不同的 Claude 身份。
  5. WebFetch 二次处理传空 system（`src/tools/WebFetchTool/utils.ts:516-518`），发出的 system 只有这一行 Claude 身份；压缩回退路径是身份行加「You are a helpful AI assistant tasked with summarizing conversations.」（`compact.ts:1298-1300`）。
  6. 代理把这一行放在 role=system 消息的第一行（`anthropicToOpenaiChat.ts:22-25`）。
- 场景：用户在 GLM-5.1 会话里问「你是哪个模型、谁做的」。system 第一行说 Claude agent、Anthropic SDK，Environment 说 glm-5.1，模型可能回答「我是 Claude」或两者混说；模型自报身份还会进入它写的文字（例如提交信息署名，T-TOOL 已有 `Co-Authored-By: Claude` 的问题，身份行会强化这一倾向，推断）。子 agent 的回答里自称「Claude Code」的概率同理更高（推断）。
- 参考：Codex 只给产品身份「You are a coding agent running in the Codex CLI…」（`codex:models-manager/prompt.md:1`），不声明模型身份；子 agent 复用父会话同一份 base instructions（`codex:core/src/agent/child_config.rs:59,119`）。ZCode 首行 `You are ZCode, an interactive agent`（`zcode:apps/zcode-cli/packages/core/src/context/sections/cli-prefix.ts:8`），身份句只讲角色（`zcode:apps/zcode-cli/packages/core/src/context/sections/identity.ts:9-10`），模型公告用真实的 `provider/model`（`zcode:apps/zcode-cli/packages/core/src/context/sections/env-info.ts:304`），子 agent 写「You are an agent for ZCode CLI」（`zcode:apps/zcode-cli/packages/core/src/subagent/general-purpose.ts:9`）。
- 改法方向：身份行按模型名分支，复用 `isClaudeModelName`（`src/server/services/attributionHeaderPolicy.ts:3-5` 已有同样判断）：非 Claude 模型用一行 DreamCoder 产品身份，并把它加入 `CLI_SYSPROMPT_PREFIXES`（`system.ts:14-28`，`splitSysPromptPrefix` 靠这个集合识别身份块，`api.ts:341,378,420`）；Claude 模型保持现状（中转站是否依赖这一行文字未核实）。子 agent 正文与 `DEFAULT_AGENT_PROMPT` 去掉「for Claude Code, Anthropic's official CLI for Claude」，只留角色句；压缩回退路径的第二个身份句删掉，或与身份行合并。
- 确定程度：代码确认（模型实际怎么回答为推断，未运行）

### T-SYS-02 memory 说明约 12.6K 字符，每个请求都发，占主会话 system 的 47%

- 类型：优化
- 严重程度：高
- 体量：典型路径约 12 565 字符，每个主会话请求都发（子 agent 不发）；memory 目录为空也发。
- 现状：
  1. `systemPromptSection('memory', () => loadMemoryPrompt())`（`prompts.ts:495`）。
  2. `loadMemoryPrompt` 只看 `isAutoMemoryEnabled()`（`src/memdir/memdir.ts:419-490`；开关链 `src/memdir/paths.ts:30-55`），服务端只设路径覆盖、不设关闭变量（`conversationService.ts:1062`），所以总是走单目录分支，先建目录再返回 `buildMemoryLines` 全文（`memdir.ts:474-489`）。
  3. 各小节实测：标题与开场 759；`## Types of memory` 7 217（其中 `<types>` XML 块 7 109，四种类型的 `<examples>` 共 2 529，`src/memdir/memoryTypes.ts:113-178`）；What NOT to save 719；How to save 1 231；When to access 835；Before recommending 717；Memory and other forms of persistence 1 155（plan、tasks 与 memory 的区别，`memdir.ts:249-253`）。
  4. 文字里大量篇幅是对 Claude 做过评测调参的痕迹（注释写着 eval-validated、capy 的评测分数，`memoryTypes.ts:192-240`），例子和 `<description>` 都很长。
- 场景：用户开一个会话「把这个失败的测试修好」，40 个请求。memory 说明每个请求都在 system 里，占 system 文字近一半；提供方缓存命中时是缓存读价，首个请求、缓存过期或前缀变化时按全价算（缓存条件见 request-cache.md）。在这类与记忆无关的任务上，它是 system 里最长的一段，注意力上的影响未测量。
- 参考：ZCode 同一套四类型 memory，约 2 050 字符：路径与「目录已存在」一句、frontmatter 样例、`[[name]]` 链接、四种类型各一句、写完在 MEMORY.md 加一行、去重与不存仓库已有内容（`zcode:apps/zcode-cli/packages/core/src/context/sections/memory.ts:33-60`）。Codex 的 memory 功能默认关闭，system 里没有 memory 文字（`codex:features/src/lib.rs:1317-1322`）。
- 改法方向：按 ZCode 的篇幅重写：四种类型各一两句定义，去掉 `<examples>` 与 `<how_to_use>`；How to save 留两步和一行格式；When to access 与 Before recommending 合并成三四条；plan / tasks 的区别缩成一句。保留「用户让你忘记就删除」「不要把仓库已有的东西存成记忆」「召回内容先核实」三条行为要求。
- 确定程度：代码确认（体量实测；对模型行为的影响为推断）

### T-SYS-03 外部构建没有「完成前先验证」和「如实汇报结果」，这两条只对 ant 打开

- 状态：已修复（#270）：system 提示词和工具描述里 `USER_TYPE === 'ant'` 的文字分支已删除；ant 专用的行为代码未动。
- 状态：维护者已定（2026-11-18）：这些条文不对外部构建打开，`USER_TYPE === 'ant'` 的文字分支直接删除。
- 类型：缺失
- 严重程度：高
- 体量：现状 0；补上约 300–900 字符，每个请求。
- 现状：
  1. `# Doing tasks` 里的「Before reporting a task complete, verify it actually works…」（289 字符，`prompts.ts:211`）和「Report outcomes faithfully…」（641 字符，`prompts.ts:240`）都包在 `process.env.USER_TYPE === 'ant'` 里（`:205-213,238-242`），外部构建构建期即删掉。
  2. 外部构建剩下的相关文字只有「no half-finished implementations」半句（`:203`），而 `# Output efficiency` 反复要求「Be extra concise」「Do not overdo it」（`:416-427`）。
  3. 外部构建的内置 agent 列表包含 verification（`builtInAgents.ts:24-27`），但告诉主模型何时调用它的合同条文被 `feature('VERIFICATION_AGENT')` 关掉（`prompts.ts:390-395`），主 system 里没有任何地方说何时验证。
- 场景：用户让 DeepSeek 修一个 bug。模型改完代码，没跑测试，回复「已修复」；或者跑了测试、有一个失败，回复里只写「主要测试通过」。system 里没有一条要求它先跑验证、或把失败如实写出来，「Be extra concise」反而鼓励省略。
- 参考：Codex 有「keep going until the query is completely resolved」（`codex:models-manager/prompt.md:125`）和 2K 字符的 `## Validating your work`（`codex:models-manager/prompt.md:149-163`）。ZCode 一句话：「Report outcomes faithfully: if tests fail, say so with the output; if a step was skipped, say that; when something is done and verified, state it plainly without hedging.」（`zcode:apps/zcode-cli/packages/core/src/context/dynamic-sections.ts:11-12`）。
- 改法方向：去掉这两条的 `USER_TYPE` 条件，对所有构建生效；篇幅可压到 ZCode 的长度（验证一句 + 如实汇报一句）。同一处的 ant 专用「默认不写注释」三条（`:207-209`）与 DreamCoder 自己的代码规范一致，是否一并放开属于产品决定。
- 确定程度：代码确认（对完成率的影响为推断）

### T-SYS-04 Environment 段带三行 Claude 专属文字（540 字符），其中两行在任何模型下都与 DreamCoder 不符，且自相矛盾

- 状态：已修复（#270）：三行 Claude 文字对所有模型删除；由桌面服务器启动时（`DREAMCODER_DESKTOP_HOST=1`）加一行 DreamCoder 宿主说明。
- 类型：问题
- 严重程度：中
- 体量：正文 540 字符，含列表符与换行 552，每个请求。
- 现状：`computeSimpleEnvInfo` 在非 undercover 时无条件加三行（`prompts.ts:694-702`）：
  1. 「The most recent Claude model family is Claude 4.5/4.6. Model IDs — Opus 4.7: 'claude-opus-4-7', …」（244）。同一句里「最新是 4.5/4.6」与「Opus 4.7」矛盾（常量 `prompts.ts:118,121-125`）；结尾「When building AI applications, default to the latest and most capable Claude models.」让模型在用户写 AI 应用时默认选 Claude。
  2. 「Claude Code is available as a CLI in the terminal, desktop app (Mac/Windows), web app (claude.ai/code), and IDE extensions…」（144）：描述的是 Claude Code 的产品形态，不是 DreamCoder。
  3. 「Fast mode for Claude Code uses the same Claude Opus 4.7 model… toggled with /fast.」（152）：本场景 fast mode 不可用（非交互且第三方认证时返回「not available in the Agent SDK」，非 firstParty 时也不可用，`src/utils/fastMode.ts:98-115`）。
  4. 对比：同一函数的知识截止行对非 Claude 模型返回 null、不发（`prompts.ts:669-672,713-730`），模型行对非 Claude 模型只写 ID（`:663-666`），这两行的条件处理是对的。
- 场景：用户让 Kimi 给自己的应用接一个 LLM，模型按 system 默认推荐 `claude-opus-4-7`；用户问「怎么开快速模式」，模型回答「输入 /fast」。走 Claude 直连时第 2、3 行同样不对（DreamCoder 不是 Claude Code）。
- 参考：ZCode 的环境与模型公告不含任何模型家族说明（`zcode:apps/zcode-cli/packages/core/src/context/sections/env-info.ts:226-247,304`）；Codex 的 `<environment_context>` 只有 cwd、shell、日期等（`codex:core/src/context/world_state/environment.rs:36-58`）。
- 改法方向：删掉第 2、3 行；第 1 行只在模型名是 `claude*` 时发，并改正「4.5/4.6」与 Opus 4.7 的矛盾（或整行删除）。
- 确定程度：代码确认

### T-SYS-05 memory 说明让模型「直接用 Write 写」，但桌面端 memory 目录在配置目录里，每次写都要用户批准，bypass 模式也一样

- 状态：已修复（#270）：记忆写入豁免覆盖服务器指定的记忆路径（`src/utils/permissions/filesystem.ts`）。
- 状态：维护者已定（2026-11-18）：扩展 CLI 的记忆写入豁免，让它也覆盖服务器指定的记忆路径（同 T-CTX-02）。
- 类型：问题
- 严重程度：中
- 体量：涉及 memory 段里「This directory already exists — write to it directly with the Write tool」（123 字符，`memdir.ts:116-117,226`）和「save it immediately」（`memdir.ts:230`）；每次保存记忆触发 1–2 次权限弹窗。
- 现状：
  1. 服务端把 memory 目录定在 `<配置目录>/projects/<项目>/memory/`（`conversationService.ts:1062,1086-1098`），配置目录就是 CLI 的 `getClaudeConfigHomeDir()`（同一函数，`src/utils/envUtils.ts:27-34`）。
  2. Write 的权限检查先看内部路径豁免：设置了 `CLAUDE_COWORK_MEMORY_PATH_OVERRIDE` 时，memory 目录的写入豁免被明确跳过（`src/utils/permissions/filesystem.ts:1732-1747`，注释写着「writes go through normal permission flow」）。
  3. 接着是只看会话级规则的配置目录放行（`filesystem.ts:1422-1462`），然后 `checkPathSafetyForAutoEdit`（`:1464`）：路径在配置目录内，`isInConfigFolder` 为真（`:218-227`），`isDangerousFilePathToAutoEdit` 返回真（`:584`），结果是 `safetyCheck`。
  4. `safetyCheck` 在 bypassPermissions 模式下也要询问（`src/utils/permissions/permissions.ts:1256-1260`）。
- 场景：用户说「记住：这个项目用 bun，不用 npm」。模型按 memory 说明写 `feedback_bun.md`，桌面端弹权限确认；再改 `MEMORY.md`，再弹一次。用户若拒绝，`# System` 段又要求「do not re-attempt the exact same tool call」（`prompts.ts:189`），这条记忆就没存上。用户开了 bypass 也一样弹。
- 参考：ZCode 对 memory 根目录下的 `.md` 写入直接放行（`zcode:apps/zcode-cli/packages/core/src/tool/executor/memory-file-permission.ts:19-45`）。Codex 无对应（memory 默认关）。
- 改法方向：改权限侧而不是文字：memory 目录由服务端指定且就在 DreamCoder 自己的配置目录下，`filesystem.ts:1739` 的豁免对它应当生效（例如判断覆盖路径在配置目录的 `projects/*/memory/` 下时仍走豁免），或由服务端启动时带一条只覆盖该目录的 allow 规则。改完后 memory 说明的文字不用动。属跨层改动（服务端 + CLI 权限）。
- 确定程度：代码确认（权限判定路径逐步读过；桌面端实际弹窗未运行验证）

### T-SYS-06 约 9.2K 字符的通用行为条文，与工具描述、与自身多处重复

- 类型：优化
- 严重程度：中
- 体量：`# Doing tasks` 3 267 + `# Executing actions with care` 2 832 + `# Using your tools` 1 622 + `# Tone and style` 706 + `# Output efficiency` 730 = 9 157，另 `# Session-specific guidance` 1 286；每个请求。
- 现状（重复处，按出现顺序）：
  1. 简短：Tone「Your responses should be short and concise.」（`prompts.ts:435`）与整段 `# Output efficiency`（`:416-427`）说同一件事。
  2. 专用工具代替 Bash、并行调用：`# Using your tools`（`:291-310`）与 Bash 工具描述（`src/tools/BashTool/prompt.ts:298,359`）各说一遍。
  3. 子 agent 用法：Session guidance 的 Agent 与 Explore 两条（`:319,378-379`）与 Agent 工具描述（`src/tools/AgentTool/prompt.ts:264-271`）重叠。
  4. 冒号规则与 emoji 规则：Tone 里各一条（`:432,438`），子 agent Notes 又各一条（`:769-770`）。这两条针对的是 Claude 的输出习惯；桌面端把文字和工具调用分开渲染（`desktop/src/components/chat/ToolCallGroup.tsx`），冒号规则在这里没有作用。
  5. 有风险动作先确认：`# Executing actions with care`（`:258-266`）与 Bash 工具描述里的 git 安全规程（T-TOOL）重叠。
  6. plan / tasks 与 memory 的区别（`memdir.ts:249-253`）与 EnterPlanMode、TaskCreate 的工具描述重叠。
- 场景：每个请求多发约 7K 字符可以合并或删除的文字；同一规则多处措辞不同时，模型要自己调和（例如「Be extra concise」与「write down any important information」，见 T-SYS-08）。
- 参考：ZCode 把 `# System`、`# Using your tools`、Tone 压成 `# Harness` 五条（610 字符，`zcode:apps/zcode-cli/packages/core/src/context/sections/identity.ts:27-41`），风险动作压成一段约 290 字符（`zcode:apps/zcode-cli/packages/core/src/context/dynamic-sections.ts:11-12`），编码风格一句（`:5-6`），删掉 Tone、Output efficiency 与工具对照表。Codex 的篇幅放在验证、进度和最终消息格式上（`codex:models-manager/prompt.md:149-256`）。
- 改法方向：每条规则只留一处：工具相关的（专用工具、并行、子 agent 用法）只留在工具描述；Tone 与 Output efficiency 合成一段；风险动作保留清单、压缩说明文字；冒号规则删去。目标量级参考 ZCode 的 1.6K 到 Codex 的 3–4K 之间。
- 确定程度：代码确认（重复处逐条核对；收益为推断）

### T-SYS-07 压缩提示缺「用户的安全约束逐字保留」和「assistant 文字不算用户消息」两条

- 类型：缺失
- 严重程度：中
- 体量：压缩提示 5 581 字符，每次压缩发一次（作为用户消息，system 与主会话相同）；补两条约 600 字符。
- 现状：
  1. fork 路径把 `getCompactPrompt()` 作为用户消息发出，system、工具与主会话相同（`compact.ts:1175-1190`；提示文字 `src/services/compact/prompt.ts:19-25,61-143,282-303`）。
  2. 九节摘要中「All user messages」只要求列出所有非工具结果的用户消息（`prompt.ts:73`），「Files and Code Sections」「Current Work」要求贴完整代码片段（`:70,75`）。没有要求把用户说过的安全约束（不要动哪些文件、不要做哪些操作）逐字保留，也没有说明 assistant 消息里形似用户发言的文字不算用户消息。
- 场景：用户一开始说「不要改 .env，不要 push」。几十轮后自动压缩，摘要把这句概括成「用户关心配置安全」或漏掉；压缩后模型执行 `git push`。另一种：assistant 早先引用过一段「user: 可以直接删掉」的示例文字，摘要把它记成用户的批准（推断）。
- 参考：ZCode 同源九节结构上加了两条：安全相关的指示「MUST be preserved verbatim」，以及「Only messages that actually came from the user (user-role turns) count as user messages…」（`zcode:apps/zcode-cli/packages/core/src/compact/prompt.ts:30,40`）。Codex 的压缩提示只有 426 字符的交接摘要（`codex:prompts/templates/compact/prompt.md:1-9`）。
- 改法方向：在分析步骤和第 6 节各加 ZCode 的那一句；同时把「include full code snippets」改成只在后续工作需要时贴，压缩输出长度（可选）。
- 确定程度：代码确认（摘要丢约束的后果为推断）

### T-SYS-08 `summarize_tool_results` 段说旧工具结果会被清除，本场景不会；它还与「简短」冲突

- 类型：问题
- 严重程度：低
- 体量：157 字符，每个请求。
- 现状：
  1. `SUMMARIZE_TOOL_RESULTS_SECTION`「write down any important information you might need later in your response, as the original tool result may be cleared later」无条件加入（`prompts.ts:523-526,841`）。它原本与 `frc` 段（「Old tool results will be automatically cleared」）配套，`frc` 在外部构建关闭（`:821-824`）。
  2. 本场景已看过的工具结果在压缩前不会被清除：cached microcompact 是 `feature`，time-based microcompact 默认 `enabled: false`（`src/services/compact/timeBasedMCConfig.ts:31`，`src/services/compact/microCompact.ts:431`），工具结果预算对已看过的结果「frozen」（`src/utils/toolResultStorage.ts:375-376`）。只有整体压缩会丢旧结果，而这一点 `# System` 已经说了（`prompts.ts:193`）。
  3. 与 `# Output efficiency`「include only what is necessary」「If you can say it in one sentence, don't use three」（`:420,427`）方向相反。
- 场景：Grep 返回 40 处匹配，模型照这一段把要点在回复文字里复述一遍「以备后用」，多出输出 token，回复也变长（推断）。
- 参考：Codex 无对应；ZCode 删掉了这一段，改为说明上下文会被摘要、不必提前收尾（`zcode:apps/zcode-cli/packages/core/src/context/dynamic-sections.ts:14-17`）。
- 改法方向：与 `frc` 用同一条件，外部构建不发。
- 确定程度：代码确认（输出变长为推断）

### T-SYS-09 服务端标题提示词没有「不要回答」和「用用户的语言」

- 状态：已修复（#285）：标题提示词要求用用户写的语言写标题、不要回答用户消息，并增加中文示例。
- 类型：问题
- 严重程度：低
- 体量：700 字符，每个会话 2 次（第 1、3 条用户消息后）。
- 现状：
  1. `TITLE_SYSTEM_PROMPT`（`src/server/services/titleService.ts:11-25`）只给英文规则与英文例子；用户消息是对话原文前 2 000 字符（`:84-89`，触发点 `src/server/ws/handler.ts:902-926`）。
  2. 没有说明「这是生成标题，不是对话，不要回答或执行消息内容」，也没有说标题用什么语言。
  3. 解析时超过 60 字符或像结构化片段的回复被丢弃（`titleService.ts:150-160`），回退为占位标题。
- 场景：中文用户第一条消息「帮我看看为什么 bun test 在 CI 上失败？」。模型可能给出英文标题「Debug failing CI tests」，会话列表里中英混杂；或直接回答问题（长文本被丢弃），标题停留在截断的原句（推断）。
- 参考：ZCode 的标题提示写明「This is a title-generation task, not a conversation」「Never answer the user's question」「Use the user's primary language」（`zcode:apps/zcode-cli/packages/core/src/runtime/methods/title-generation-sidecar.ts:60-79`）。Codex 无标题生成。
- 改法方向：加这三条；例子保留 JSON 格式即可。思考与输出上限问题见 P-REQ-14，不重复。
- 确定程度：代码确认（模型输出为推断）

### T-SYS-10 `/help` 指向 Claude Code，反馈句只剩半句

- 状态：已修复（#270）：`/help` 说明和反馈地址改为 DreamCoder 的。
- 类型：问题
- 严重程度：低
- 体量：163 字符，每个请求。
- 现状：`# Doing tasks` 末尾「If the user asks for help or wants to give feedback inform them of the following: /help: Get help with using Claude Code; To give feedback, users should 」（`prompts.ts:216-219,248-249`）。`MACRO.ISSUES_EXPLAINER` 在 `preload.ts:19` 是空串，句子在 `should ` 处结束。DreamCoder 桌面端有 `/help`（「Show available desktop and agent commands」，`desktop/src/components/chat/composerUtils.ts:9`）和问题反馈地址（`desktop/src/lib/problemReport.ts:3`）。
- 场景：用户问「这个工具怎么反馈问题」，模型按 system 回答「使用 Claude Code 的 /help」，反馈渠道给不出来或自行编造。
- 参考：ZCode 删除了这一条；Codex 无对应。
- 改法方向：改成 DreamCoder 的 `/help` 说明和反馈地址；或整条删除。
- 确定程度：代码确认

### T-SYS-11 关于输出怎么呈现的描述与桌面端不符

- 状态：已修复（#270）：去掉等宽字体、CommonMark、可点击链接的承诺和 Anthropic 示例；冒号规则本身留给 T-SYS-06。
- 类型：问题
- 严重程度：低
- 体量：约 450 字符，每个请求。
- 现状：
  1. `# System`：「will be rendered in a monospace font using the CommonMark specification」（`prompts.ts:188`）。桌面端用 `marked` 渲染 GFM（含表格、数学公式懒加载）到普通字体（`desktop/src/components/markdown/MarkdownRenderer.tsx`，`desktop/package.json:48`）。
  2. Tone：「use the owner/repo#123 format (e.g. anthropics/claude-code#100) so they render as clickable links」与「include the pattern file_path:line_number to allow the user to easily navigate」（`prompts.ts:436-437`）。在桌面端 Markdown 渲染器里没有找到把 `owner/repo#123` 或 `path:line` 变成链接的处理（只处理已有的 `<a href>`，`MarkdownRenderer.tsx:298-300,502-529`）。示例仓库是 Anthropic 的。
  3. Tone：「Your tool calls may not be shown directly in the output」（`:438`），而桌面端会把工具调用渲染成卡片。
- 场景：模型因「等宽字体」而避免用表格或用空格对齐；写出 `anthropics/claude-code#100` 风格的引用以为可点击（推断）。
- 参考：ZCode 同样写「displayed… in a terminal」「it's clickable」（`zcode:apps/zcode-cli/packages/core/src/context/sections/identity.ts:35,39`），这一点 ZCode 也没改；Codex 写「plain text that will later be styled by the CLI」（`codex:models-manager/prompt.md:195`）。
- 改法方向：按桌面端实际渲染改写一句（GFM 会被渲染，表格可用）；去掉 Anthropic 示例；冒号规则随 T-SYS-06 删除。是否给 `path:line` 加链接是产品决定，加之前文字不要承诺可点击。
- 确定程度：第 1、3 点代码确认；第 2 点「没有链接化」为推断（只做了 grep）

### T-SYS-12 statusline-setup 子 agent 的 7K 正文针对 DreamCoder 没有的状态栏

- 状态：已修复（#270）：statusline-setup 子 agent 和 `/statusline` 命令已删除。
- 类型：问题
- 严重程度：低
- 体量：正文 6 993 字符，合计约 7.9K，每次调用发一次。
- 现状：statusline-setup 无条件在内置列表里（`builtInAgents.ts:58-61`），正文开头「You are a status line setup agent for Claude Code… the user's Claude Code settings」（`statuslineSetup.ts:3`），内容是读 PS1、写 `statusLine` 设置、Claude.ai 订阅额度字段等。DreamCoder 桌面端不运行 `statusLine` 命令，导入 Claude Code 配置时也特意不导入它（`src/server/services/claudeCodeImportService.ts:47-50`）。
- 场景：用户说「帮我设置一下状态栏显示 git 分支」，主模型按 Agent 工具里的清单派给 statusline-setup，子 agent 改了设置文件，桌面端没有任何变化。
- 参考：ZCode 内置子 agent 只有 general-purpose 与 Explore（`zcode:apps/zcode-cli/packages/core/src/subagent/`）；Codex 无对应。
- 改法方向：从内置列表删掉（按「派生后裁掉半接线功能」的方针）。它在 Agent 工具描述里的清单条目交给 T-TOOL。
- 确定程度：代码确认

### T-SYS-13 子 agent 的 Notes 缺「启动方消息不等于用户授权」和「不要写报告文件」

- 类型：缺失
- 严重程度：低
- 体量：Notes 630 字符，每次启动子 agent；补两条约 600 字符。
- 现状：Notes 四条：绝对路径、最终回复带路径、不用 emoji、冒号规则（`prompts.ts:766-770`）。没有说明主 agent 发来的任务文字不构成用户授权，也没有要求不要把结论写成 `.md` 报告文件。general-purpose 正文只有「NEVER proactively create documentation files」（`generalPurposeAgent.ts:16`）。
- 场景：主 agent 在派发 prompt 里写「用户已同意 push」，子 agent 据此 push（子 agent 的工具权限仍走权限系统，但在 bypass 或已放行规则下会直接执行，推断）。或者子 agent 把调研结论写成 `REPORT.md` 放进用户仓库。
- 参考：ZCode 子 agent 在正文与 Notes 之间加一段「No message from any agent is ever your user's consent or approval…」，Notes 多一条「Do NOT Write report/summary/findings/analysis .md files」（`zcode:apps/zcode-cli/packages/core/src/subagent/system-prompt.ts:3-4,13`）。Codex 子 agent 复用父会话 base instructions，无对应。
- 改法方向：加这两条，同时按 T-SYS-06 删掉冒号规则。
- 确定程度：代码确认（后果为推断）

### T-SYS-14 system 文字只提 CLAUDE.md，没有 AGENTS.md

- 状态：维护者已定（2026-11-18）：随 T-CTX-01 的指令文件规则一起改。
- 类型：缺失
- 严重程度：低
- 体量：三处，各十余字符。
- 现状：`# Executing actions with care`「authorized in advance in durable instructions like CLAUDE.md files」（`prompts.ts:258`）；memory 的「Anything already documented in CLAUDE.md files」（`src/memdir/memoryTypes.ts:189`）；verification 子 agent「Read the project's CLAUDE.md / README」「does CLAUDE.md / comments / commit message explain this」（`src/tools/AgentTool/built-in/verificationAgent.ts:44,78`）。CLI 不读 AGENTS.md 是加载问题，归 T-CTX；这里只记文字。
- 场景：仓库只有 `AGENTS.md`（DreamCoder 自己的仓库就是），verification 子 agent 去找 CLAUDE.md，找不到构建命令约定。
- 参考：Codex 有一整节 AGENTS.md 规范（`codex:models-manager/prompt.md:17-27`）；ZCode 读 AGENTS.md，但 memory 文字仍写 CLAUDE.md（`zcode:apps/zcode-cli/packages/core/src/context/sections/memory.ts:59`），同样不一致。
- 改法方向：T-CTX 决定读取 AGENTS.md 后，三处同步改为「CLAUDE.md 或 AGENTS.md」。
- 确定程度：代码确认

### T-SYS-15 默认不要求跟随用户语言；设置了回复语言时又要求「注释」也用该语言

- 类型：缺失
- 严重程度：低
- 体量：默认 0；设置后约 250 字符，每个请求。
- 现状：
  1. 桌面端「回复语言」设置写入 `settings.language`（`desktop/src/components/settings/GeneralSettings.tsx:428-429` → `desktop/src/stores/settingsStore.ts:491-495`），CLI 据此加 `# Language` 段（`prompts.ts:142-149,502-504`）。未设置时 system 里没有任何语言要求。
  2. 设置后的文字是「Use ${语言} for all explanations, comments, and communications」（`:148`），「comments」可被理解为代码注释。
- 场景：一个英文代码库，用户把回复语言设为中文，模型在新写的代码里加中文注释（推断）。未设置时，第三方模型偶尔用英文回复中文提问（推断，未测）。
- 参考：Codex 没有语言条文。ZCode 主 system 也没有，但标题与工具 `title` 参数都写「in the user's language」（`zcode:apps/zcode-cli/packages/core/src/mcp/index.ts:55`，`title-generation-sidecar.ts:72`）。
- 改法方向：默认加一句「用用户提问所用的语言回复」；设置语言后的句子把「comments」改成「代码注释遵循仓库现有约定」。
- 确定程度：代码确认（模型行为为推断）

### T-SYS-16 外部构建的沟通条文只要求简短，没有「开工前一句说明」和「最终汇报写什么」

- 类型：缺失
- 严重程度：低
- 体量：现状 Output efficiency 730；ant 版 `# Communicating with the user` 约 2 300（`prompts.ts:405-414`）。
- 现状：外部构建的 `# Output efficiency`（`:416-427`）讲直奔主题、只在里程碑报告；ant 版要求第一次调用工具前简短说明要做什么、在关键发现和改方向时更新、假设读者离开过所以写完整句子。最终汇报应包含什么（改了什么、验证了什么、没做到什么）两版都没有。
- 场景：桌面端用户看着一个长任务跑，前十几个工具调用之间没有任何文字；结束时模型只写「完成」。
- 参考：Codex 有前言（`codex:models-manager/prompt.md:29-50`）、进度更新（`:173-179`）、最终消息（`:181-192`）三节；ZCode 用中途「静默轮次」提醒补这一点（属 T-INJ 对比）。
- 改法方向：与 T-SYS-03 一起，在合并后的语气段里加两句：第一次调用工具前一句话说明计划；最终回复写清改了什么、怎么验证的、哪些没做。
- 确定程度：代码确认（效果为推断）

### T-SYS-17 MCP 服务器说明在 system 中部每轮重算

- 类型：优化
- 严重程度：低
- 体量：视用户 MCP 服务器的 instructions 长度；没有带 instructions 的服务器时为 0。
- 现状：`mcp_instructions` 是 `DANGEROUS_uncachedSystemPromptSection`，每轮重算（`prompts.ts:513-520`）；改用附件送达的 delta 模式在外部构建默认关（`src/utils/mcpInstructionsDelta.ts:26-33`）。它位于 memory 和 Environment 之后、`summarize_tool_results` 与 git 状态之前。桌面端启动 CLI 时最多等 MCP 连接 5 秒（`conversationService.ts:1070-1075`）。
- 场景：用户配置了一个带 instructions 的 MCP 服务器，连接晚于首个请求；第二个请求起 system 中部多出一段，该位置之后的 system 尾部和全部历史在提供方前缀缓存里失配一次（推断，晚连接在实际中多常见未核实）。
- 参考：Codex 与 ZCode 的 MCP instructions 送达方式在已有对比中未核实。
- 改法方向：服务端启动 CLI 时设 `CLAUDE_CODE_MCP_INSTR_DELTA=1`，让说明以附件形式追加到历史，system 不再随 MCP 连接变化。
- 确定程度：代码确认（缓存影响为推断）

### T-SYS-18 措辞与格式小错

- 类型：问题
- 严重程度：低
- 体量：各处十余到数十字符。
- 现状：
  1. Environment 里 `[`Is a git repository: ${isGit}`]` 被包成数组，渲染成上一行的子条目「  - Is a git repository: true」（`prompts.ts:682`）；表头行末尾多一个空格（`:707`）。
  2. 「use the AskUserQuestion to ask them」「use the Glob or Grep directly」少了「tool」（`prompts.ts:362,366,378-379`）。
  3. 「Break down and manage your work with the TaskCreate tool… Mark each task as completed」（`:308`），标记完成用的是 TaskUpdate。
  4. git 状态截断提示「run "git status" using BashTool」（`src/context.ts:88`），工具名是 Bash。
  5. 主会话环境段（`# Environment` 列表，「Is a git repository: true」）与子 agent 环境段（`<env>` 标签，「Is directory a git repo: Yes」，`prompts.ts:640-648`）是同一信息的两种格式；子 agent 段也没有 worktree 那一行（`:679-681`）。
- 场景：影响小；第 3 点可能让模型用 TaskCreate 去「完成」任务（推断）。
- 参考：无对应。
- 改法方向：逐条改正；两个环境段合成一个函数。
- 确定程度：代码确认

## 2. 汇总表

| 编号 | 标题 | 类型 | 严重程度 | 体量 |
|---|---|---|---|---|
| T-SYS-01 | system 首行说 Claude，子 agent 再叠 Claude Code 身份 | 问题 | 高 | 62/请求（所有请求）+ 子 agent 70–90 |
| T-SYS-02 | memory 说明 12.6K，占 system 47% | 优化 | 高 | 约 12 565/请求 |
| T-SYS-03 | 无「完成前验证」「如实汇报」，只对 ant 打开 | 缺失 | 高 | 补 300–900/请求 |
| T-SYS-04 | Environment 三行 Claude 文字，自相矛盾 | 问题 | 中 | 540/请求 |
| T-SYS-05 | memory 写入每次要批准，与「直接写」矛盾 | 问题 | 中 | 每次保存 1–2 次弹窗 |
| T-SYS-06 | 9.2K 通用行为条文，多处重复 | 优化 | 中 | 9 157 + 1 286/请求 |
| T-SYS-07 | 压缩提示缺安全约束保留与用户消息判定 | 缺失 | 中 | 5 581/次压缩 |
| T-SYS-08 | `summarize_tool_results` 本场景不成立且与简短冲突 | 问题 | 低 | 157/请求 |
| T-SYS-09 | 标题提示词无「不要回答」「用用户语言」 | 问题 | 低 | 700 × 2/会话 |
| T-SYS-10 | `/help` 指向 Claude Code，反馈句残缺 | 问题 | 低 | 163/请求 |
| T-SYS-11 | 呈现描述与桌面端不符 | 问题 | 低 | 约 450/请求 |
| T-SYS-12 | statusline-setup 子 agent 无用 | 问题 | 低 | 约 7.9K/次调用 |
| T-SYS-13 | 子 agent Notes 缺授权与报告文件两条 | 缺失 | 低 | 630/子 agent |
| T-SYS-14 | 只提 CLAUDE.md | 缺失 | 低 | 三处 |
| T-SYS-15 | 无默认语言跟随；语言段要求注释用该语言 | 缺失 | 低 | 0 / 约 250 |
| T-SYS-16 | 无开工说明与最终汇报要求 | 缺失 | 低 | 730/请求 |
| T-SYS-17 | MCP 说明在 system 中部每轮重算 | 优化 | 低 | 视 MCP |
| T-SYS-18 | 措辞与格式小错 | 问题 | 低 | 十余到数十 |

合计 18 条：高 3，中 4，低 11。

## 3. 与已有结论的出入

对照 `docs/features/harness/comparison/prompt.md`：

- Q1 第 0 行「计费头约 90 字符，代理补为 system 第一块」：**已过时**。#262/#266 之后代理只对 `claude*` 模型补计费行（`src/server/proxy/handler.ts:69`），CLI 对非 Claude 模型也不加（环境变量为 0），本场景 system 第一行是身份行。
- Q1 各段字符数：**证实**。intro 834、System 1 625、Doing tasks 3 267、Actions 2 832、Tools 1 622、Tone 706、Output efficiency 730、Session guidance 1 286 与实测一致；memory「约 12 550」与实测（典型路径约 12 565）一致；合计「约 26 450」与实测折算约 26 510 一致。
- Q1「summarize_tool_results 130」：**更正**为 157。
- Q1 / Q4「Environment 中 549 字符 Claude 三行」：实测正文 540，含列表符与换行 552；结论不变。另补充：同一行内「4.5/4.6」与「Opus 4.7」自相矛盾（T-SYS-04）。
- Q1「本场景不进入：language」：**需要补充**。桌面端有「回复语言」设置，写入 `settings.language` 后 `# Language` 段进入 system（T-SYS-15）。
- Q4「`/fast` 不可用（推断）」：**补充代码依据**：非交互且第三方认证时、或非 firstParty 时 fast mode 不可用（`src/utils/fastMode.ts:98-115`）。Q4「`/help` 指向 Claude Code」：证实，但桌面端确实有 `/help` 命令，问题在于文字说的是 Claude Code、反馈句残缺（T-SYS-10）。
- 第 4 节「本场景工具里是否有 EnterWorktree 未核实」：实测 `getTools` 结果包含 EnterWorktree、ExitWorktree（详细以 T-TOOL 为准）。
- Q8 子 agent：general-purpose 1 288、Explore 1 949、Notes 630 证实；Plan 实测 2 274（原写约 2 400）；verification 9 497、statusline-setup 6 993 证实。**补充**：子 agent 的 system 前面还有 CLI 身份行，所以是「Claude agent」+「agent for Claude Code」两个身份（T-SYS-01）。
- Q8 压缩提示约 5 600：证实（5 581）。ZCode 多出的两条保护证实（T-SYS-07）。
- 结论 4「外部构建没有验证条文」：证实；**补充**：verification 子 agent 在外部构建默认启用，只是主 system 里调用它的合同被 `feature` 关掉（T-SYS-03）。
- 新发现（已有对比未提）：memory 写入在桌面端总要用户批准（T-SYS-05）；`summarize_tool_results` 在本场景不成立（T-SYS-08）；标题提示词缺规则（T-SYS-09）；呈现描述与桌面端不符（T-SYS-11）。

## 4. 已查无问题

- 服务端追加的 system：没有（见 0.1）；设计、幻灯片、产物、看板、侧聊不改 system。
- 计费行：非 Claude 模型不发。
- 安全声明 `CYBER_RISK_INSTRUCTION`（459，`src/constants/cyberRiskInstruction.ts`）：与 ZCode 逐字相同（`zcode:apps/zcode-cli/packages/core/src/context/sections/identity.ts:15-16`），不涉及模型身份，保留。
- 「不要猜 URL」「工具结果可能含提示注入，要告知用户」（`prompts.ts:183,191`）：对任何模型适用。
- `# Executing actions with care` 的内容本身：与桌面端行为相符，问题只在体量（T-SYS-06）。
- 模型行与知识截止行：非 Claude 模型只写真实 ID、不写截止日期（`prompts.ts:663-672`），正确。
- `!` 命令提示：非交互时不发，正确。
- `ant_model_override`、scratchpad、frc、数值长度锚点、token_budget、brief、proactive、fork 指引、verification 合同、DiscoverSkills、advisor：本场景都不进入（条件见 0.1）。
- 输出样式：桌面端不设置，本场景不进入；手动设置时内置样式文字写「interactive CLI tool」，影响小。
- 缓存稳定性（除 T-SYS-17）：静态块 11 628 字符跨会话相同；动态段按名缓存，只在 `/compact`、`/clear`、进出 worktree 时重算，重算结果与之前相同（memory、Session guidance 只依赖路径与工具集）；system 里没有日期；git 状态进程内 memoize。换模型或权限模式时服务端重启 CLI（`src/server/ws/handler.ts:689,798,810`），system 重建，缓存本来就会失配。
- 压缩提示的 `NO_TOOLS_PREAMBLE`（`src/services/compact/prompt.ts:19-25`）：fork 路径带着全部工具，对任何模型都需要。
- WebFetch 二次处理模板（`src/tools/WebFetchTool/prompt.ts:28-34`）的引用长度、版权条文：是内容政策，不涉及模型身份；保留。
- 语言与标记格式：全部英文；Markdown 标题 + 列表为主，memory 类型用 XML 标签。XML 标签部分的体量问题并入 T-SYS-02。
- 辅助请求：工具摘要、提示建议、会话记忆、提取记忆、autoDream、相关记忆召回、子 agent 进度摘要、Bash 前缀、CLI 侧标题与侧问，本场景都不发（条件见 0.3）。

## 5. 没有核实的地方

- 所有关于模型行为的后果（自报身份、推荐 Claude、复述工具结果、跳过验证、标题语言）都没有对模型运行验证。
- T-SYS-05 的权限判定只按代码逐步读过，没有在桌面端实际触发一次 memory 写入看弹窗。
- 走 Claude 模型时，中转站是否依赖 `You are a Claude agent…` 这行文字来识别客户端：未核实，所以 T-SYS-01 建议 Claude 模型保持现状。
- 桌面端是否在别处（非 `MarkdownRenderer`）把 `path:line`、`owner/repo#123` 变成链接：只做了 grep。
- 用户 MCP 服务器晚于首个请求连接的频率：未核实。
- 会话中途修改「回复语言」何时生效（`settings` 读取与段缓存的交互）：未核实。
- 「典型」一列的路径长度是假设的用户目录，实际随用户名与项目路径变化。

## 6. 交给其他维度

- T-CTX：CLI 不读 AGENTS.md（T-SYS-14 只改文字）；memory 路径覆盖时 MEMORY.md 是否仍进入 userContext；git 状态里的 `Git user:` 姓名发给第三方模型；git 状态压缩后不刷新。
- T-TOOL：Agent 工具描述里列出 statusline-setup 与 verification；Bash 工具的 `Co-Authored-By: Claude` 署名；`# Using your tools` 与 Bash、Agent 工具描述的重复由哪一侧保留。
- T-INJ：压缩后续接消息（含 transcript 路径）的文字；侧聊与派生会话的 note；看板卡片的 instructions；`/design`、`/slides` 等 skill 展开的文字。
- 请求与缓存（C）：`shouldUseGlobalCacheScope` 只看 firstParty，Anthropic 格式的第三方端点（如 GLM、Kimi 的 Anthropic 兼容端点）会收到 `scope: 'global'` 的 `cache_control`（`src/utils/betas.ts:228-233`，`src/utils/api.ts:362-409`）。
- 代理层：标题请求的思考开关与输出上限见 P-REQ-14。
