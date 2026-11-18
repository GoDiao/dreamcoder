# 维度 B：system prompt 及其他以文字告知模型的内容

场景：第三方模型（GLM-5.3、DeepSeek-V4.1、Kimi-K3 一类）经 OpenAI 兼容端点，headless 运行一个编码任务。字符数为字符（非字节）。路径约定（见 [README](../README.md#对比的场景)）：`codex:` 相对 `refs/coding-agents/codex/codex-rs`，`zcode:` 相对 `refs/coding-agents/zcode/apps/zcode-cli/packages`，`zcode-cfg:` 相对 `refs/coding-agents/zcode/config/provider`，DreamCoder 相对仓库根。

测量方法：DreamCoder 的各段按本场景分支把 `src/constants/prompts.ts`、`src/memdir/*` 的字符串重建后计数，其中 intro / System / Doing tasks / Actions / Tools / Tone / Output efficiency / Session guidance 八段做过独立复算，相差不超过 1。Codex 的 `prompt.md` 全文 20 751 字符、剔除 Planning 与 update_plan 两节后 16 979 字符，复算一致。ZCode 各段从源码字面量重建复算，Identity 1 171、Dynamic Behavior 975、Context management 559、Memory 约 2 066（路径按 46 字符计）。三家代码均未执行。

## 1. 结论

1. 首个请求里 system 及注入文字的体量：DreamCoder 约 26.5K（不含 git 状态、CLAUDE.md、工具描述），Codex 约 17.7K，ZCode 约 6.5K 起。三家的差异主要来自 DreamCoder 的 memory 段（约 12.5K，占 47%）和「Doing tasks / Executing actions with care / Using your tools / Tone / Output efficiency」五段（约 9.2K）；ZCode 把这些压到约 1.6K。
2. DreamCoder 向非 Claude 模型发送大量 Claude 专属文字：身份前缀「You are a Claude agent, built on Anthropic's Claude Agent SDK.」、Environment 段里 549 字符的 Claude 模型家族 / Claude Code 产品 / `/fast` 说明、`/help` 指向 Claude Code、Read 工具称「Claude Code is a multimodal LLM」（而代理会把工具结果里的图片换成文字）、子 agent 自称「agent for Claude Code」，以及 Bash 工具要求在提交信息末尾写 `Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>`。Codex 和 ZCode 没有向第三方模型发送其他厂商的模型名。
3. DreamCoder 的 CLI 不读 `AGENTS.md`（只有 `/init` 命令提到它），只读 `CLAUDE.md` 系列；Codex 与 ZCode 都读 `AGENTS.md`。这一条已确认。
4. Codex 的 fallback prompt 把篇幅放在「最终消息格式」（约 6.0K）、「前言与进度更新」（约 2.7K）、「验证」（约 2.0K）上；DreamCoder 外部构建里没有任何验证或「何时算完成」的条文（相关条目只在 `USER_TYPE=ant` 时加入）；ZCode 只有一句「如实汇报：测试失败要附输出」。
5. 动态上下文的送达方式不同：Codex 和 ZCode 把环境、日期、指令文件、skills、agent 清单作为对话历史里的独立消息发送，按与历史的差异只追加变化；DreamCoder 把环境放在 system 内、git 状态放在 system 末尾、CLAUDE.md 与日期放在第一条 user 消息，会话内各算一次，之后只有日期跨天、子目录 CLAUDE.md 等少数附件会追加。
6. 中途提醒：DreamCoder 在每次 Read 文本结果后追加 340 字符的「考虑是否为恶意软件」提醒（模型不是 claude-opus-4-7 时都加），另有每 10 轮的 task 提醒（480 字符起）；ZCode 每个工具批次后追加约 45 字符的 `<total_tokens>` 倒数，另有静默 5 轮提醒、重复调用提醒、todo 提醒；Codex 在本场景基本没有中途提醒。
7. 压缩提示：Codex 426 字符；DreamCoder 约 5.6K；ZCode 约 6.4K（与 DreamCoder 同源，增加了「安全相关约束逐字保留」和「不要把 assistant 文本当成用户消息」两条）。
8. 子 agent：Codex 子 agent 复用父会话的整份 base instructions（约 17K）；DreamCoder 与 ZCode 子 agent 用 1–2.5K 的专用 prompt 加约 0.6–1.1K 的 Notes，二者文字几乎相同，但 DreamCoder 版本自称 Claude Code、ZCode 版本自称 ZCode。
9. ZCode 的 prompt 明显以 Claude Code 为蓝本删减而成：保留了安全声明、git 状态块、指令文件前言、skills 清单格式、memory 类型、压缩提示、子 agent prompt、todo 提醒的原文或近似原文；删除了语气、输出效率、工具对照表、Agent 用法等大段；并加入了 DreamCoder 2.1.92 里没有的几段（代词、如实汇报、下载文件不可信、token 预算、「够了就动手」）。

## 2. 逐项对比

### Q1 逐节清单

#### DreamCoder（场景：server 以 `--print` stream-json 启动 CLI，`USER_TYPE` 非 `ant`，`feature()` 全为 false，GrowthBook 关闭）

启动参数：`src/server/services/conversationService.ts:141-157` 只传 `--print --verbose --sdk-url ... --input-format/--output-format stream-json --include-partial-messages --session-id|--resume --replay-user-messages` 加 `--model/--effort/--thinking` 和权限参数（`src/server/services/conversationService.ts:969-985`）；没有 `--system-prompt`、`--append-system-prompt`。所以走 `getSystemPrompt` 默认路径（`src/utils/queryContext.ts:56-66`）。

子进程环境（`src/server/services/conversationService.ts:1048-1061`）：`CLAUDE_CODE_ENABLE_TASKS=1`（`src/utils/tasks.ts:133-139`，用 TaskCreate 系而非 TodoWrite）、`CLAUDE_COWORK_MEMORY_PATH_OVERRIDE`（auto memory 目录定到 `<config>/projects/<项目>/memory/`，`:1060`）、`DREAMCODER_SHOW_UI`、`DREAMCODER_SESSION_LINKS`；`CLAUDE_CODE_ATTRIBUTION_HEADER` 对非 `claude*` 模型置 `0`（`src/server/services/attributionHeaderPolicy.ts:11-20`）。`CLAUDE_CODE_ENTRYPOINT` 非交互时为 `sdk-cli`（`src/main.tsx:532`）。`MACRO.ISSUES_EXPLAINER` 在 `preload.ts:19` 是空串。

发给模型的 system 内容，按顺序（`src/services/api/claude.ts:1394-1403`，`src/query.ts:451`）：

| # | 段 | 字符 | 内容 |
|---|---|---|---|
| 0 | 计费头 `x-anthropic-billing-header: ...; cch=00000;` | 约 90 | CLI 不加；代理在 `src/server/proxy/handler.ts:64` → `src/server/proxy/claudeCodeAttribution.ts:29-47` 补为 system 第一块；`cch` 由 `src/server/upstream/client.ts:211-224` 换成请求体哈希（详见维度 C） |
| 1 | 身份前缀 `src/constants/system.ts:12,29-43` | 63 | 非交互且无 append →「You are a Claude agent, built on Anthropic's Claude Agent SDK.」 |
| 2 | intro `src/constants/prompts.ts:175-184` | 834 | 角色一句；`CYBER_RISK_INSTRUCTION`（459）；禁止猜 URL |
| 3 | `# System` `:186-197` | 1 625 | 输出显示给用户；权限模式；system-reminder 标签；提示注入要告知用户；hooks；自动压缩 |
| 4 | `# Doing tasks` `:199-253` | 3 267 | 任务范围；不加范围外功能/多余错误处理/一次性抽象；先读后改；不给时间估计；失败先诊断；OWASP；`/help` 与反馈 |
| 5 | `# Executing actions with care` `:255-267` | 2 832 | 可逆性与影响范围；需确认的动作清单；遇障碍不走破坏性捷径 |
| 6 | `# Using your tools` `:269-314` | 1 622 | 专用工具代替 Bash 的对照；TaskCreate 用法；并行调用 |
| 7 | `# Tone and style` `:430-442` | 706 | 不用 emoji；简短；`file_path:line_number`；`owner/repo#123` |
| 8 | `# Output efficiency` `:403-428` | 730 | 直奔主题、少说 |
| — | `SYSTEM_PROMPT_DYNAMIC_BOUNDARY` | 0 | 插入数组但拼块时跳过（`src/utils/api.ts:338,374`） |
| 9 | `# Session-specific guidance` `:352-400` | 1 286 | AskUserQuestion、Agent、Explore、`/<skill>` 四条 |
| 10 | memory `src/memdir/memdir.ts:199-266, 419-490` | 约 12 550 | 见 Q5 |
| 11 | `# Environment` `src/constants/prompts.ts:651-710` | 约 810 | cwd、git、平台、shell、OS、模型名，加 549 字符 Claude 专属三行（见 Q4） |
| 12 | `summarize_tool_results` `:841` | 130 | 工具结果可能被清除，重要信息要记下 |
| 13 | git 状态 `src/context.ts:72-103`，`src/utils/api.ts:437-447` | 数百至约 3 000 | status 截断 2 000 字符 + 5 条 log |

本场景不进入：`language`、`output_style`、`mcp_instructions`（有带 instructions 的 MCP server 时才有）、`scratchpad`、`frc`、token_budget / brief / proactive。

合计（不含 git 状态、MCP instructions）约 **26 450 字符**，memory 一段占约 47%。另有：

- 第一条 user 消息是 `<system-reminder>` 包着的 userContext：CLAUDE.md 系列、MEMORY.md、`Today's date is ...`（`src/utils/api.ts:449-472`），固定包装约 250 字符。
- 代理把所有 system 块用 `\n` 拼成一条 role=system 消息（`src/server/proxy/transform/anthropicToOpenaiChat.ts:19-25`）。
- 工具描述约 80K（维度 A），ToolSearch 在非 Anthropic base URL 下关闭（`src/utils/toolSearch.ts:270-312`），每次请求全量发送。

#### Codex（场景：`codex exec`，自定义 provider，slug 不在内置目录）

- 内置目录 `models-manager/models.json` 11 个 OpenAI slug；最长前缀匹配与「一级命名空间/后缀」匹配（codex:models-manager/src/manager.rs:888-930），GLM/DeepSeek/Kimi 不会命中，走 `model_info_from_slug`，`instructions_template` 为 `prompt.md` 全文（codex:models-manager/src/model_info.rs:16,98-156）。
- 前提：rust-v0.164.0 的 `WireApi` 只剩 `Responses`（codex:model-provider-info/src/lib.rs:102,109-113），chat-completions 端点需要外部转换层；prompt 分析与 wire 格式无关。
- `update_plan` 默认关闭（codex:core/src/config/mod.rs:2791-2796），请求前剔除 `## Planning`（含示例）与 `## update_plan` 两节（codex:core/src/session/mod.rs:1608-1627 → codex:prompts/src/update_plan_instructions.rs:4-30）：20 751 → 16 979 字符。

| # | 段 | 字符 | 内容 |
|---|---|---|---|
| 1 | 开头身份与能力 `prompt.md:1-9` | 797 | 「Codex CLI 里的 coding agent」；能力三条 |
| 2 | `## Personality` | 404 | 简洁、直接、友好 |
| 3 | `# AGENTS.md spec` | 1 288 | 作用域与优先级；根到 cwd 的内容已随消息给出 |
| 4 | `### Preamble messages` | 1 593 | 工具调用前发 1–2 句前言，8 条示例 |
| 5 | `## Task execution` | 2 414 | 做到解决为止；`apply_patch` 编辑；根因修复；不加行内注释；不 `git commit` |
| 6 | `## Validating your work` | 2 020 | 先窄后宽地跑测试；格式化最多 3 次；按审批模式决定是否主动跑测试 |
| 7 | `## Ambition vs. precision` | 936 | 新项目可发挥，既有代码要精确 |
| 8 | `## Sharing progress updates` | 1 128 | 长任务定期发 8–10 词进度 |
| 9 | `## Presenting your work...` + `### Final answer structure...` | 5 973 | 最终消息长度、标题、列表、等宽、文件引用、语气 |
| 10 | `## Shell commands` | 363 | 优先 `rg`；不用 python 输出大段文件 |
| 11 | 小计：base instructions | **16 979** | 作为 input 首项发送（维度 D：codex:core/src/client.rs:1017-1030） |
| 12 | permissions（developer） | 约 300–500 | `never.md` 120（codex:prompts/templates/permissions/approval_policy/never.md）+ sandbox 模板 177–281 |
| 13 | `<environment_context>`（user） | 约 300 起 | `<cwd>`、`<shell>`、`<current_date>`、`<timezone>`，可含 network/filesystem/subagents（codex:core/src/context/world_state/environment.rs:263-330） |
| 14 | AGENTS.md（user） | 视文件，合计上限 32 KiB | 见 Q6 |
| 15 | skills 清单（developer） | 视已装 skill | 回退元数据不带「How to use skills」（codex:ext/skills/src/fragments.rs:20-32） |

本场景不发：collaboration mode 默认文本（推断，codex:core/src/context/world_state/collaboration_mode.rs:34-66）、multi-agent V2 用法提示（V1 下 `usage_hint_text` 为 None，codex:core/src/session/multi_agents.rs:14-18）、persistent mode（3 376）、memories（6 593，`MemoryTool` 缺省关，codex:features/src/lib.rs:1317-1322）、token budget / context-window guidance（`TokenBudget` 缺省关，codex:core/src/session/world_state.rs:177-201）、model catalog（`ModelCatalogInContext` 缺省关，codex:features/src/lib.rs:1520-1524）。

合计约 **17.7K 字符**，加 AGENTS.md 与 skills 条目。

#### ZCode（场景：CLI `--prompt`，`openai-chat-completions`，非 GLM 模型）

`ContextBuilder.build()`（zcode:core/src/context/builder.ts:83-231）产生三类内容：三条 system 消息（CLI 前缀 / 稳定段带缓存标记 / 动态段带缓存标记，`:238-284`）、meta_user 附件（skills、指令文件、git，`:295-321`）、运行时公告（环境、模型、日期，`:287-293` 列为「由运行时宣告」，实际在 zcode:core/src/runtime/methods/context-refresh.ts 里作为 `<system-reminder>` 附件写入历史）。只有一套 prompt，不按模型分支；`zcode-cfg:zcode-builtin.json` 的模型规则里没有任何 prompt 文字字段（我遍历了所有含 prompt/instruction/system 的键，只有 `supportsMidConversationSystem`）。

`midConversationSystem` 由 `shouldUseMidConversationSystem` 决定（zcode:core/src/runtime/helpers/runtime-provider-request-messages.ts:13-20）；缺省模型规则为 false（`zcode-cfg:zcode-builtin.json` 的 `modelRules[0]`），本场景为 false，所以 Harness 第三条用「`<system-reminder>` 由 harness 注入」措辞（zcode:core/src/context/sections/identity.ts:27-41）。

| # | 段 | 位置 | 字符 | 内容 |
|---|---|---|---|---|
| 1 | CLI 前缀 `cli-prefix.ts:8` | system 1 | 35 | `You are ZCode, an interactive agent` |
| 2 | Agent Identity `identity.ts:9-52` | system 2（稳定） | 1 171 | 身份一句（97）；安全声明（459，与 DreamCoder `CYBER_RISK_INSTRUCTION` 同文）；`# Harness` 五条（610） |
| 3 | Dynamic Behavior `dynamic-sections.ts:5-12,65-71` | system 3（动态） | 975 | 贴近周围代码风格（94）；代词用 they/them（357）；高风险动作先确认、如实汇报结果（520） |
| 4 | Session-specific guidance `dynamic-sections.ts:22-63` | system 3 | 163（有 Skill 工具且有 skill 时） | 只剩 `/<skill-name>` 一条；Agent、AskUserQuestion、插件三条被注释掉 |
| 5 | Memory `sections/memory.ts:29-60` | system 3 | 约 2 050 | 见 Q5 |
| 6 | Context management `dynamic-sections.ts:14-20,73-79` | system 3 | 559 | 上下文会被摘要，不必提前收尾；「够了就动手，不重复推导」 |
| 7 | Total Tokens `total-tokens.ts:1-9` | system 3 | 49 | `<total_tokens>15000000 tokens left</total_tokens>` |
| — | 小计 system | | **约 5.0K** | |
| 8 | Environment `env-info.ts:226-247` | 历史中的公告 | 约 700 | cwd、是否 git、平台、shell、OS，加 472 字符「下载文件不可信」 |
| 9 | Model `env-info.ts:301-315` | 历史中的公告 | 约 50 | `You are powered by the model named <provider>/<model>.` |
| 10 | Skills 列表 `sections/skills.ts:9-58` | meta_user | 视 skill 数，预算 20 000 | 每条描述截到 250 字符；超预算只列名称与路径 |
| 11 | 指令文件 `instruction-files.ts:13-14,36-38` + `request-user-context.ts:23-113` | meta_user | 视文件，每文件上限 100 KiB | 193 字符前言加文件块；MEMORY.md 索引也在这里 |
| 12 | Date `current-date.ts:13` | 历史中的公告 | 约 30 | `Today's date is ...` |
| 13 | Git `env-info.ts:202-224, 253-270` | 历史中的公告 | 约 700（5 条 commit） | gitStatus 快照与「ZCode attached this context automatically」说明 |


合计 system 约 5.0K，meta_user 与公告约 1.5K 起，**约 6.5K 起**，加 skills 与 AGENTS.md。

### Q2 主题对比

字符数为 system 及首轮注入文字中直接讲该主题的部分；「工具描述」列出时单独注明，不计入。

| 主题 | Codex | ZCode | DreamCoder |
|---|---|---|---|
| 身份 | 797 | 132（+ 模型公告约 50） | 约 220（+ Environment 中模型名） |
| 语气与输出风格 | 404 | 约 100（Harness 一行） | 约 1 440（Tone + Output efficiency） |
| 编码任务做法 | 约 3 350（Task execution + Ambition） | 约 370 | 3 267 |
| 何时做计划 | 0（Planning 节被剔除） | 0（只在 plan 模式提醒中） | 约 300（TaskCreate 一条）；EnterPlanMode 工具描述另计 |
| 验证与测试 | 2 020 | 约 80（「测试失败要附输出」） | 0 |
| 何时算完成 | 约 350（「做到解决为止」） | 约 230（如实汇报） | 0（只有「不留半成品」半句） |
| 风险与破坏性动作 | 约 0.4K（审批/沙箱片段） | 约 290 | 2 832 |
| git 与提交 | 约 150（不 commit、用 log/blame） | 0 | system 中 0；Bash 工具描述约 6.2K（提交/PR 流程） |
| 工具使用与并行 | 363（无并行说明） | 约 140 | 1 622 |
| 子 agent 使用 | 0；spawn_agent 描述含角色说明约 1.9K | 约 130（清单后并发说明）+ 清单 | 约 900（Session guidance 中两条）+ Agent 工具描述 |
| 安全政策 | 0 | 459 + 472（下载不可信） | 约 1 100（安全声明、URL、提示注入、OWASP） |
| memory | 0（功能缺省关） | 约 2 050 + MEMORY.md | 约 12 550 + MEMORY.md |
| 环境信息 | 约 300 | 约 750 | 约 810（含 549 Claude 文字）+ git 状态 |
| 最终消息格式 | 5 973 | 0 | 0（只有 Tone/Output efficiency 的一般要求） |
| 进度更新 | 约 2 720（前言 + 进度） | 0（中途静默提醒 139） | 约 100（Output efficiency 一句） |

各家重点：

- Codex 独有的大段：最终消息格式（约 6.0K）、前言与进度（约 2.7K）、验证（约 2.0K）、AGENTS.md 规范（1.3K）。另两家在这些主题上为 0 或一两句。
- DreamCoder 独有的大段：memory（12.5K）、风险动作（2.8K）、工具对照（1.6K）、语气与输出效率（1.4K）、安全政策（1.1K）、Bash 工具里的 git 流程（6.2K）。
- ZCode 在所有主题上都很短；它独有的是 token 预算行与倒数、代词规则、「不必提前收尾 / 够了就动手」。
- 三家都很少写「何时做计划」：Codex 在 `update_plan` 关闭时整节删除，ZCode 只在 plan 模式里有，DreamCoder 只有一条 TaskCreate 指引。

### Q3 ZCode 相对 DreamCoder：保留、缩短、删除

ZCode 的结构与措辞来自 Claude Code 系的 prompt。以下比较以 DreamCoder 2.1.92 为参照。

保留（原文或几乎原文）：

| 内容 | ZCode | DreamCoder |
|---|---|---|
| 安全声明 459 字符 | zcode:core/src/context/sections/identity.ts:15-16 | `src/constants/cyberRiskInstruction.ts` |
| 指令文件前言「Codebase and user instructions are shown below...」 | zcode:core/src/context/sections/instruction-files.ts:13-14 | `src/utils/claudemd.ts:93-94` |
| git 状态块（「This is the git status at the start of the conversation...」、`Main branch (you will usually use this for PRs)`） | zcode:core/src/context/sections/env-info.ts:27-30 | `src/context.ts:72-103` |
| Environment 标签（`You have been invoked in the following environment`、`Primary working directory` 等） | env-info.ts:10-20,226-247 | `src/constants/prompts.ts:651-710` |
| skills 清单头与每条 250 字符截断 | zcode:core/src/context/sections/skills.ts:10,41 | `src/tools/SkillTool/prompt.ts:29`，`src/utils/messages.ts:3822-3831` |
| MEMORY.md 200 行 / 25 000 字符截断 | zcode:core/src/memory/index-content.ts:6-7 | `src/memdir/memdir.ts:35,38` |
| memory 四种类型 user/feedback/project/reference | zcode:core/src/context/sections/memory.ts:51 | `src/memdir/memoryTypes.ts` |
| 压缩提示（`NO_TOOLS_PREAMBLE` 379 字符同文、九节摘要结构） | zcode:core/src/compact/prompt.ts:1-110 | `src/services/compact/prompt.ts:19-272` |
| 子 agent general-purpose 正文与 Notes | zcode:core/src/subagent/general-purpose.ts:7-23，system-prompt.ts:6-14 | `src/tools/AgentTool/built-in/generalPurposeAgent.ts:3-24`，`src/constants/prompts.ts:766-770` |
| Explore 子 agent 正文 | zcode:core/src/subagent/explore.ts:20-68 | `src/tools/AgentTool/built-in/exploreAgent.ts:24-` |
| todo 提醒（10 轮/10 轮阈值与措辞） | zcode:core/src/runtime/helpers/runtime-reminders.ts:100-103,260-270 | `src/utils/attachments.ts:251-254`，`src/utils/messages.ts:3774-3793` |
| plan 模式五阶段流程 | runtime-reminders.ts:27-79 | DreamCoder plan_mode 附件（未逐字核对） |

缩短：

| DreamCoder 段 | 字符 | ZCode 对应 | 字符 |
|---|---|---|---|
| `# System` | 1 625 | `# Harness` 五条（markdown 输出、权限拒绝、system-reminder 与 hooks、专用工具与并行、`file_path:line_number`） | 610 |
| `# Executing actions with care` | 2 832 | `ACTION_CAUTION_PROMPT` 的前半（先确认、外发即发布、删除前先看） | 约 290 |
| `# Doing tasks` | 3 267 | 「贴近周围代码」94 + 「够了就动手」277 | 约 370 |
| `# Session-specific guidance` | 1 286 | 只剩 `/<skill-name>` | 163 |
| memory 段 | 约 12 550 | memory 段 | 约 2 050 |
| Environment | 约 810 | Environment（去掉 Claude 三行，加下载不可信说明） | 约 700 |

删除：`# Tone and style`、`# Output efficiency`、`# Using your tools` 的工具对照、Agent / Explore / AskUserQuestion 用法（在 zcode:core/src/context/dynamic-sections.ts:28-55 中被注释掉）、OWASP 条、「不加范围外功能 / 不做一次性抽象」等编码风格条、时间估计、`/help` 与反馈、禁止猜 URL、`summarize_tool_results`、知识截止日期、Claude 模型家族与产品三行、「You are a Claude agent」前缀、Read 工具的恶意软件提醒（zcode 中该字符串只出现在 `core/tests/read-file-state-hydrator.test.ts`）、Bash 工具里的 git 提交 / PR 流程（ZCode 的 core 里只有 Explore 的「不要 git commit」）。

ZCode 新增（DreamCoder 的 prompt 文本里没有，`grep` `src/constants`、`src/utils` 无结果）：代词 they/them（357）；「Report outcomes faithfully」（DreamCoder 中同类条目只在 `USER_TYPE=ant` 时加入，`src/constants/prompts.ts:239-243`）；下载文件不可信说明（472）；`<total_tokens>` 预算行与倒数；「不必提前收尾」「不重复推导、不重议已定决定」；静默轮次提醒；重复调用提醒；`provider/model` 形式的模型公告；指令文件增量公告；memory 文件之间的 `[[name]]` 链接。推断：这些新增段落与较新版本的 Claude Code 文字相近，ZCode 跟随的蓝本比 2.1.92 新；未逐字核对来源。

### Q4 发给「错误模型 / 错误产品」的文字

#### DreamCoder → 非 Claude 模型

system prompt：

| 位置 | 引文 | 问题 |
|---|---|---|
| `src/constants/system.ts:12` | 「You are a Claude agent, built on Anthropic's Claude Agent SDK.」 | 身份是 Claude |
| `src/constants/prompts.ts:217-218` | 「/help: Get help with using Claude Code」「To give feedback, users should 」 | 指向 Claude Code；`ISSUES_EXPLAINER` 为空串（`preload.ts:19`），句子不完整 |
| `src/constants/prompts.ts:437` | 「use the owner/repo#123 format (e.g. anthropics/claude-code#100)」 | 示例仓库是 Anthropic 的（影响小） |
| `src/constants/prompts.ts:696` | 「The most recent Claude model family is Claude 4.5/4.6. Model IDs — Opus 4.7: 'claude-opus-4-7'...」 | 244 字符，告诉 GLM 等模型 Claude 的模型 ID，并要求构建 AI 应用时默认用 Claude |
| `src/constants/prompts.ts:699` | 「Claude Code is available as a CLI in the terminal, desktop app (Mac/Windows), web app (claude.ai/code)...」 | 144 字符，描述的是 Claude Code 的产品形态 |
| `src/constants/prompts.ts:702` | 「Fast mode for Claude Code uses the same Claude Opus 4.7 model... toggled with /fast.」 | 152 字符，DreamCoder 没有 `/fast`（推断：server 未暴露此命令，未逐一核对） |

工具描述（本场景发送的工具）：

| 位置 | 引文 | 问题 |
|---|---|---|
| `src/tools/BashTool/prompt.ts:79,107,122,150` + `src/utils/attribution.ts:73-80` | 提交信息末尾写「Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>」，PR 末尾写「🤖 Generated with [Claude Code](https://claude.com/claude-code)」 | 非 Claude 模型名查不到时固定回退为「Claude Opus 4.7」（`getPublicModelDisplayName` 只认 Claude 与少数 GPT 名，`src/utils/model/model.ts:377-402`，`src/services/openaiAuth/models.ts:93-108`）；server 没有设置 `attribution`/`includeCoAuthoredBy`（`grep src/server` 无结果）。模型会把错误的署名写进用户仓库 |
| `src/tools/FileReadTool/prompt.ts:40` | 「This tool allows Claude Code to read images... as Claude Code is a multimodal LLM.」 | 自称 Claude Code；且代理把工具结果里的图片替换成 `[image omitted: <mime>]`（`src/server/proxy/transform/toolArguments.ts:37-42`），模型实际看不到图 |
| `src/tools/EnterWorktreeTool/prompt.ts:21` | 「creates a new git worktree inside `.claude/worktrees/`」 | 目录名带 Claude（该工具是否在本场景工具集中 未核实） |
| `src/tools/AgentTool/built-in/statuslineSetup.ts:136-137`（经 Agent 工具描述的清单发出，`src/tools/AgentTool/prompt.ts:196-199`） | 「Use this agent to configure the user's Claude Code status line setting.」 | DreamCoder 没有 status line（`src/server/services/claudeCodeImportService.ts:49` 明确不导入 `statusLine`）；清单默认在工具描述中，因为 `tengu_agent_list_attach` 默认 false（`src/tools/AgentTool/prompt.ts:59-64`） |

子 agent prompt（本场景可用的内置 agent：general-purpose、statusline-setup、Explore、Plan、verification；`sdk-cli` 入口下不含 claude-code-guide，`src/tools/AgentTool/builtInAgents.ts:58-79`）：

| 位置 | 引文 |
|---|---|
| `src/tools/AgentTool/built-in/generalPurposeAgent.ts:3` | 「You are an agent for Claude Code, Anthropic's official CLI for Claude.」 |
| `src/tools/AgentTool/built-in/exploreAgent.ts:24` | 「You are a file search specialist for Claude Code, Anthropic's official CLI for Claude.」 |
| `src/tools/AgentTool/built-in/planAgent.ts:21` | 「You are a software architect and planning specialist for Claude Code.」 |
| `src/tools/AgentTool/built-in/statuslineSetup.ts:3` | 「You are a status line setup agent for Claude Code... the user's Claude Code settings.」 |

中途注入：Read 结果后的恶意软件提醒对所有非 `claude-opus-4-7` 模型都追加（`src/tools/FileReadTool/FileReadTool.ts:697-699,727-736`）。它本身不提 Claude，但豁免名单只按 Claude 模型名设计。

其他：`CLAUDE.md` 名称在 memory 段与 userContext 中出现，这是 DreamCoder 实际读取的文件，不算错误产品。

#### Codex → 非 OpenAI 模型

| 位置 | 引文 | 问题 |
|---|---|---|
| codex:models-manager/prompt.md:1 | 「Codex CLI is an open source project led by OpenAI.」 | 产品身份，不涉及模型身份；影响小 |
| codex:models-manager/prompt.md:9 | 「not the old Codex language model built by OpenAI」 | 同上 |
| codex:models-manager/prompt.md:132,143（剔除后仍在） | 「Use the `apply_patch` tool to edit files... {"command":["apply_patch",...]}」 | 回退元数据 `apply_patch_tool_type=None`，不声明 apply_patch 工具；文中给的是 shell 命令形式，靠对 shell 调用的拦截生效（见 [loop-execution.md](loop-execution.md)） |
| codex:models-manager/prompt.md:7 | 「More on this in the "Sandbox and approvals" section.」 | `prompt.md` 中没有这一节（`grep -c` 只有这一处引用）；审批与沙箱信息由 permissions 片段提供（推断） |
| codex:core/src/tools/handlers/multi_agents_spec.rs:71-75,822-870 | spawn_agent 描述列出「picker 可见」的模型及其 reasoning effort | 自定义 provider 下 `available_models` 来自哪份目录 未核实；若用内置目录（codex:models-manager/src/manager.rs:864-866），会向 GLM 列出 6 个 `visibility: list` 的 gpt-* 名称 |

没有找到向非 OpenAI 模型声称「你是 GPT」或列出 OpenAI 模型 ID 的 system 文字。

#### ZCode → 非 GLM 模型

- 没有 GLM、智谱、Z.ai 字样；模型公告用真实的 `provider/model`（zcode:core/src/context/sections/env-info.ts:301-315）。
- zcode:core/src/context/sections/memory.ts:59：「Don't save what the repo already records (code structure, past fixes, git history, CLAUDE.md)」。ZCode 读的是 `AGENTS.md`（zcode:adapters/src/context/index.ts:26），这里写错了文件名。
- `Task` 别名工具描述写着「Claude Code-compatible alias for the Agent tool」（zcode:core/src/tool/handlers/agent.ts:332-346），但 `providerVisible: false`，不发给模型。

### Q5 memory 段

| | Codex | ZCode | DreamCoder |
|---|---|---|---|
| 本场景是否发送 | 否（`MemoryTool` 缺省关） | 是（`features.memory` 缺省 true） | 是 |
| 大小 | 读路径 6 593（关闭时不发） | 约 2 050 | 约 12 550 |
| 位置 | — | system 动态段 | system（边界之后） |
| 目录为空时 | — | 仍发送 | 仍发送（先 `ensureMemoryDirExists`） |
| MEMORY.md 索引 | — | 指令文件公告内，200 行 / 25 000 字符 | userContext 内，200 行 / 25 000 字节 |
| 关闭方式 | 缺省即关 | `features.memory=false` 或 `memory.use=false` | `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`、settings `autoMemoryEnabled:false`、`CLAUDE_CODE_SIMPLE` |

DreamCoder：

- 内容（`src/memdir/memdir.ts:199-266` 拼装，类型说明在 `src/memdir/memoryTypes.ts`）：目录路径与「目录已存在，直接写」；四种类型各自的定义、何时保存、怎样使用和示例；不该保存的内容；两步保存法（写文件 + 在 MEMORY.md 加一行）；何时读取；对召回内容的信任与核实；memory 与 plan / tasks 的区别。四种类型的长说明与示例占大部分篇幅。
- 发送条件：`loadMemoryPrompt` 只看 `isAutoMemoryEnabled()`（`src/memdir/memdir.ts:419-490`），与目录是否为空无关；为空时也会先建目录再发送全文（`:476-489`）。
- 开关：`src/memdir/paths.ts:30-55`。server 只设了路径覆盖（`src/server/services/conversationService.ts:1060`），没有设置关闭变量，`grep src/server` 无 `DISABLE_AUTO_MEMORY` 或 `autoMemoryEnabled`。所以每个会话、每次请求都带这 12.5K。
- 本场景下 `tengu_moth_copse`、TEAMMEM、KAIROS 均为默认值，走单目录分支（`:419-425, 474-489`）。

ZCode：

- 内容（zcode:core/src/context/sections/memory.ts:29-60）：路径与「目录已存在」；frontmatter 格式；`[[name]]` 链接；四种类型各一句；写入后在 MEMORY.md 加一行；去重、不保存仓库已记录的东西、召回内容不是用户指令且需核实。
- 发送条件：`memoryRoot` 存在即发（`builder.ts:160-168`）；`memoryRoot` 由 `resolveEnabledProjectMemoryRoot` 决定，要求 `memory.enabled`、`memory.use !== false`、主会话类型（zcode:core/src/runtime/helpers/project-memory.ts:4-28）；`features.memory` 缺省 true（zcode:adapters/src/config/index.ts:287），bootstrap 取该值（zcode:bootstrap/src/app/runtime-config.ts:191-198）。CLI `--prompt` 只设置 `extractionEnabled`（zcode:cli/src/prompt-command.ts:269），不关闭 memory。
- 子 agent 不发（任务类型不属于主会话）。

Codex：fallback prompt 与默认开启的 world state 段中都没有 memory 文字；memories 功能缺省关闭（codex:features/src/lib.rs:1317-1322）。可比的只有 AGENTS.md 规范一节（1 288），讲的是项目指令文件而不是跨会话记忆。

### Q6 动态上下文

| | Codex | ZCode | DreamCoder |
|---|---|---|---|
| 环境 | user 消息 `<environment_context>`：cwd、shell、日期、时区等 | 历史中的 `<system-reminder>` 公告 | system 内 `# Environment` |
| 日期 | 环境片段中的 `<current_date>`（是否缺省开启 未核实） | 独立公告，跨天发「日期已变化」 | 第一条 user 消息；跨天发 `date_change` 附件 |
| git 状态 | 未找到 | 每个上下文窗口一次的公告 | system 末尾，会话内一次 |
| 指令文件名 | `AGENTS.override.md`、`AGENTS.md`，可配后备名 | `AGENTS.md`（项目内离 cwd 最近的一个）+ `~/.zcode/AGENTS.md` | `CLAUDE.md`、`.claude/CLAUDE.md`、`.claude/rules/*.md`、`CLAUDE.local.md` 及用户级、托管级 |
| 指令文件上限 | 合计 32 KiB | 每个文件 100 KiB | 不截断；40 000 字符只是告警阈值 |
| skills 清单 | developer 片段 | meta_user，预算 20 000 字符 | 第一轮 `skill_listing` 附件，预算为窗口的 1%×4 字符（200K 窗口时 8 000） |
| 子 agent 清单 | spawn_agent 工具描述 | 历史中的增量公告 | Agent 工具描述 |
| MCP instructions | 未核实 | 未核实 | system 内，每轮重算 |
| 送达方式 | 每步按 world state 与上次快照的差异追加 | 写入历史，只追加变化 | 会话内各算一次 |

DreamCoder：

- 指令文件：`src/utils/claudemd.ts:6-16, 835-990` 列出读取的文件，全部是 `CLAUDE.md` 系列。整个 `src` 下只有 `src/commands/init.ts` 提到 `AGENTS.md`。**确认 CLI 不读 `AGENTS.md`。** `MAX_MEMORY_CHARACTER_COUNT = 40000`（`src/utils/claudemd.ts:96`）只用于 doctor 与状态提示（`src/utils/doctorContextWarnings.ts:57-66`），不截断内容。
- 送达：gitStatus 与 userContext 都 `memoize`，会话内只算一次（`src/context.ts:116,155`）。gitStatus 拼在 system 末尾（`src/utils/api.ts:437-447`），userContext 作为第一条 user 消息（`src/utils/api.ts:449-472`）。system 动态段按名字缓存，`/compact` 时清除（维度 C，`src/constants/systemPromptSections.ts:20-62`）。会话中途修改根目录 CLAUDE.md 不会送达，直到压缩；读取子目录文件时可能通过 `nested_memory` 附件补发该目录的 CLAUDE.md（`src/utils/attachments.ts` 中的 `nested_memory`）。
- skills 清单：`src/tools/SkillTool/prompt.ts:21-40`；渲染见 `src/utils/messages.ts:3822-3831`。

Codex：

- `AGENTS.md`：从项目根（向上找 `.git`）到 cwd 逐层收集并拼接，每层优先 `AGENTS.override.md`（codex:core/src/agents_md.rs:1-18, 43-45, 272-290）；合计上限 `project_doc_max_bytes`，缺省 32 KiB（codex:core/src/config/mod.rs:255,4528）；以 user 消息 `# AGENTS.md instructions for <dir>` + `<INSTRUCTIONS>` 发送（codex:core/src/context/user_instructions.rs:31-41）。
- 送达：每个采样步骤重建 world state，各段与历史中的上一份快照比较，只把差异作为新片段追加（codex:core/src/session/world_state.rs:163-400；差异接口 codex:core/src/context/world_state/mod.rs 中的 `render_diff`）。AGENTS.md 也是一个 world state 段（world_state.rs:218）。

ZCode：

- 指令文件：在 cwd 到项目根之间找离 cwd 最近的 `AGENTS.md`，加用户级 `~/.zcode/AGENTS.md`；每个文件上限 100 KiB（zcode:adapters/src/context/index.ts:26-27, 123-157, 236-271）。完整公告只发一次；启动时或压缩后重读，内容变化时追加增量公告「Instruction files were re-read...」（zcode:core/src/runtime/methods/context-refresh.ts:362-474，zcode:core/src/context/sections/instruction-files.ts:44-55）。
- 环境、模型、output style：每次输入附件收集时与历史中最近一次公告比较，只发变化的行（context-refresh.ts:96-158；env-info.ts:125-175）。
- git：每个窗口（会话开始或压缩后）决定一次（context-refresh.ts:570-634）。
- skills：只发一次；冷恢复时原位更新（context-refresh.ts:296-336）。

### Q7 中途提醒

DreamCoder（附件列表 `src/utils/attachments.ts:740-985`；渲染在 `src/utils/messages.ts`）：

| 种类 | 触发 | 大小 | 本场景 |
|---|---|---|---|
| Read 恶意软件提醒 | 每次 Read 返回文本内容，模型不是 `claude-opus-4-7`（`src/tools/FileReadTool/FileReadTool.ts:697-699,727-736`） | 340 | 是，每次 Read |
| `task_reminder` | 距上次 TaskCreate/TaskUpdate ≥10 个 assistant 轮，且距上次提醒 ≥10 轮（`src/utils/attachments.ts:251-254, 3359-3412`） | 480 + 任务列表 | 是 |
| `edited_text_file`（changed_files） | 读过的文件被 Edit/Write 以外的方式改动（如 Bash、格式化器） | 302 + diff 片段 | 是，视任务 |
| `nested_memory` | 读到含 CLAUDE.md 的子目录中的文件 | 视文件 | 视仓库 |
| `skill_listing` | 第一轮，及新增 skill 时 | 视 skill 数，预算约 8 000 | 第一轮 |
| `queued_command` / 任务通知 | 后台 agent 或后台命令结束 | 视内容 | 用后台任务时 |
| `date_change` | 跨天 | 约 100 | 很少 |
| 空文件 / offset 越界提示 | Read 结果为空或越界（FileReadTool.ts:700-705） | 约 100 | 偶发 |
| 不触发 | `token_usage`（需环境变量，:3791-3796）、`output_token_usage`（需 `feature('TOKEN_BUDGET')`）、`verify_plan_reminder`（仅 ant）、`deferred_tools_delta`（ToolSearch 关）、`agent_listing_delta`（GrowthBook 默认 false）、`compaction_reminder` / `context_efficiency` / `auto_mode`（feature）、`budget_usd`（未设置预算）、teammate 系列（需 agent teams 开关，`src/utils/agentSwarmsEnabled.ts:24-36`） | — | 否 |

ZCode（输入附件收集：回合首个请求、每个完整工具批之后、文本回复后续的 guide；zcode:core/src/runtime/methods/turn-loop.ts:284-411）：

| 种类 | 触发 | 大小 | 本场景 |
|---|---|---|---|
| `total_tokens_reminder` | 每个工具批之后；用户输入时重新起算（zcode:core/src/runtime/helpers/total-tokens-budget.ts:53-67；turn-loop.ts:416-447） | 约 45 | 是，每批 |
| 静默轮次提醒 | 连续 ≥5 次模型回应没有可见文字，每段最多 3 次（runtime-reminders.ts:105-161；turn-loop.ts:363-375） | 139 | 是 |
| 重复调用提醒 | 连续 3 次相同工具名与输入，每回合最多 3 次（zcode:core/src/runtime/helpers/model-anomaly.ts:28-29；维度 E） | 约 150 | 是，异常时 |
| todo 提醒 | 有 TodoWrite，距上次 TodoWrite 与上次提醒各 ≥10 轮（runtime-reminders.ts:100-103, 252-270） | 384 + 列表 | 是 |
| 环境 / 模型 / output style / 日期公告 | 内容变化时 | 每条数十至数百 | 首轮各一次，之后很少 |
| 指令文件增量 | 压缩后重读且有变化 | 视文件 | 压缩后 |
| skills / agent 清单 | 首轮一次，之后只发增量 | 视数量 | 首轮 |
| output style 提醒 | 每次收集都发（turn-loop.ts:379-397） | 约 80 | 仅设置了 output style 时 |
| plan 模式提醒 | plan 模式，每 5 个用户轮一次，每第 5 次为完整版 | 完整约 4 000，简版约 300 | 否 |
| Dream memory 更新、UserPromptSubmit hook 上下文、上次运行中断的后台 agent 通知 | 各自事件 | 视内容 | 一般否 |
| 不触发 | ToolSearch 公告（`--toolsearch-mode` 缺省 `off`，zcode:cli/src/run.ts:446；zcode:core/src/tool/search/exposure.ts:18-35） | — | 否 |

Codex：

| 种类 | 触发 | 本场景 |
|---|---|---|
| world state 差异（环境、AGENTS.md、权限等） | 每步比较，变化时追加 | 一般只有首轮 |
| `<subagent_notification>` | V1 子 agent 状态变为最终状态（codex:core/src/context/subagent_notification.rs） | 用子 agent 时 |
| `<turn_aborted>`、`<model_switch>` | 中断、换模型 | 否 |
| token budget、context-window guidance、current time | 需 `TokenBudget` 等开发中特性（codex:core/src/session/world_state.rs:177-201） | 否 |

未找到 Codex 在本场景对重复调用、静默、todo 一类的提醒。各片段字符数 未核实（都很短）。

### Q8 子 agent 与压缩提示

子 agent：

| | Codex | ZCode | DreamCoder |
|---|---|---|---|
| system 正文 | 复用父会话 base instructions（约 17K）（codex:core/src/agent/child_config.rs:59,111-120） | CLI 前缀 35 + agent 正文 + 启动方消息说明 353 + Notes 约 770 + token 行 49 | agent 正文 + Notes 630 + `<env>` 段约 400（`src/constants/prompts.ts:760-791`） |
| 内置类型与正文大小 | default、explorer、worker；`explorer.toml` 为空文件，角色差异只写在 spawn_agent 描述里（约 1.9K，codex:core/src/agent/role.rs:344-401） | general-purpose 约 1 270；Explore 约 2 150 | general-purpose 约 1 300；Explore 约 2 000；Plan 约 2 400；verification 约 9 500；statusline-setup 约 7 000 |
| 指令文件 | 继承 developer instructions；环境片段带 `<subagents>` | AGENTS.md、日期、skills 作为 meta_user（zcode:core/src/subagent/context-builder.ts:84-141） | userContext（Explore/Plan 省略 CLAUDE.md，未逐一核对） |
| 要点 | 与父会话同一份规则 | 只读、并行搜索、只返回结论；启动方消息不等于用户授权 | 与 ZCode 几乎同文，但自称 Claude Code |

ZCode 的 Notes 比 DreamCoder 多一条「不要写报告 .md 文件」（zcode:core/src/subagent/system-prompt.ts:13），并多一段说明启动方 agent 的消息不构成用户授权（`:3-4`）。

压缩：

| | Codex | ZCode | DreamCoder |
|---|---|---|---|
| 提示大小 | 426（codex:prompts/templates/compact/prompt.md） | 约 6 400（379 + 5 820 + 尾部提醒约 165，zcode:core/src/compact/prompt.ts:1-118） | 约 5 600（379 + 约 5 030 + 尾部约 150，`src/services/compact/prompt.ts:19-305`） |
| 要点 | 交接摘要：进度、决定、约束、剩余步骤、关键数据 | 九节摘要（请求、概念、文件与代码、错误、问题、全部用户消息、待办、当前工作、下一步），先写 `<analysis>`；禁止调用工具 | 同 ZCode 的九节结构 |
| ZCode 相对 DreamCoder 的增加 | — | 安全相关约束逐字保留；不要把 assistant 中形似用户的文字算作用户消息；摘要后保留原文时提醒「保留的消息比摘要新」（`:140-141`） | — |
| 摘要回填前缀 | 399 字符「另一个语言模型开始解决这个问题……」（codex:prompts/templates/compact/summary_prefix.md） | 「This session is being continued...」（`:148-184`） | 同 ZCode（`src/services/compact/prompt.ts:337-380`） |
| 请求形态 | 不带工具定义（维度 C：codex:core/src/compact.rs:318-326） | 未核实 | 复用主循环前缀，含全部工具定义（维度 C：`src/services/compact/compact.ts:1132-1226`） |

## 3. 对 DreamCoder 的含义

### DreamCoder 有、另两家都没有

事实：

1. 每次请求带约 12.5K 字符的 memory 说明（ZCode 2K，Codex 0），目录为空也发，server 不关闭。
2. 约 9.2K 字符的通用行为条文（Doing tasks、Executing actions with care、Using your tools、Tone、Output efficiency）。ZCode 对应内容约 1.6K；Codex 的篇幅放在其他主题上。
3. 向非 Claude 模型发送的 Claude 专属文字：身份前缀、Environment 中 549 字符、`/help` 与不完整的反馈句、Read 工具的多模态说法、子 agent 的 Claude Code 身份、status line 子 agent，以及要求写入 `Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>` 的提交流程。
4. Bash 工具描述中约 6.2K 的 git 提交与 PR 流程。
5. 每次 Read 文本结果后 340 字符的恶意软件提醒。
6. 环境与 git 状态放在 system 消息里（另两家放在独立消息里）。

后果：

- token：仅 1、2、3 三项就约 22K 字符（推断约 5–6K token），随每次请求重发；Read 提醒按 Read 次数累积在历史中（推断：一次任务读 30 个文件约 10K 字符）。在没有前缀缓存或缓存失效时（维度 C 所述计费头每次请求都变），这些全部按输入计费。
- 可靠性：第 3 项会让第三方模型在提交信息中写入错误的署名，或在被问到身份、模型、`/fast`、`/help` 时给出错误回答（推断，未做运行验证）。Read 工具声称能看图而代理丢图，模型可能据此对图片内容作出无依据的描述（推断）。
- 第 6 项：环境和 git 放在 system 里本身不增加轮数；代价在于它们与 memory 等动态段相邻，任何一段变化都会使其后的缓存前缀失效（推断，细节见维度 C）。

### 另两家都有、DreamCoder 没有

事实：

1. 读取 `AGENTS.md`（Codex 与 ZCode 都读；DreamCoder 只读 `CLAUDE.md` 系列）。
2. 动态上下文以独立消息写入历史，变化时只追加差异（Codex world state、ZCode 公告）。DreamCoder 会话内各算一次，只有日期跨天、子目录 CLAUDE.md 等少数附件会补发。
3. 关于「结果如实 / 验证」的明文：Codex 有 2K 的验证一节和「做到解决为止」；ZCode 有「测试失败要附输出、跳过的步骤要说明」。DreamCoder 外部构建中这类条目只在 `USER_TYPE=ant` 时加入（`src/constants/prompts.ts:205-213, 239-243`）。
4. 没有向第三方模型发送其他厂商的模型身份或模型 ID。

后果：

- 第 1 项：仓库里只有 `AGENTS.md` 时（benchmark 与很多开源仓库属于这种情况，DreamCoder 自己的仓库也是），DreamCoder 的模型看不到项目指令，可能多走探索轮次或违反项目约定（推断）。
- 第 2 项：本场景是单次 headless 任务，环境基本不变，对 token 影响小；差异主要在压缩和会话恢复之后（推断）。
- 第 3 项：在以通过测试为标准的任务上，缺少「完成前先验证」的明文，可能使模型更早结束回合（推断；benchmark 中 DreamCoder 的通过率差距在噪声范围内，无法据此确认）。

## 4. 没有核实的地方

- DreamCoder 传给 CLI 的 `--model` 值是否就是上游模型 ID（决定 Environment 中「You are powered by the model ...」一行的内容）：未核实。
- DreamCoder 本场景实际发送的工具里是否有 EnterWorktree：未核实（以维度 A 为准）。
- DreamCoder `/fast` 在 DreamCoder 中不可用：推断，未逐一核对命令表。
- Codex 自定义 provider 下 `available_models` 来自内置目录还是 provider 的 `/models`，以及 spawn_agent 描述是否因此列出 gpt-* 名称：未核实。
- Codex `<current_date>` 是否缺省发送（`include_environment_context_time` 的缺省值）：未核实。
- Codex MCP 服务器 instructions 的送达方式、ZCode MCP instructions 的送达方式：未核实。
- Codex skills 清单的预算与条目格式：未核实。
- Codex 各中途片段的字符数：未核实。
- ZCode 压缩请求是否带工具定义：未核实。
- ZCode 的 TodoWrite 是否在本场景 24 个默认工具中（决定 todo 提醒是否会触发）：未核实（以维度 A 为准）。
- ZCode 新增段落与较新版本 Claude Code 文字的对应关系：推断，未逐字核对。
- DreamCoder plan 模式附件与 ZCode 五阶段流程是否逐字相同：未逐字核对。
- DreamCoder Explore/Plan 子 agent 是否省略 CLAUDE.md：未逐一核对。
