# 文字层评审：上下文加载（T-CTX）

范围：会话开始时（以及压缩之后重建时）装进上下文的项目和环境信息：指令文件（CLAUDE.md 系列、`.claude/rules`、`@` 引用、读子目录文件时附带的嵌套 CLAUDE.md、`AGENTS.md`）、自动记忆（目录、`MEMORY.md` 索引、为空时的行为、相关记忆召回）、环境信息（工作目录、平台、日期、git 状态、模型信息）、清单类上下文（技能清单、agent 清单、MCP 服务器 instructions、SessionStart 钩子、输出风格）、压缩后重新注入与丢失的内容、子 agent 继承的内容。重点是加载机制、放置位置和会话中是否变化。system 各段措辞与体量归 T-SYS，工具描述归 T-TOOL，中途追加的提醒（日期跨天、文件变更等）归 T-INJ。

场景：桌面端服务器以 `--print` stream-json 启动 CLI（`src/server/services/conversationService.ts:124-159`），模型为经 OpenAI 兼容端点接入的第三方模型，请求经本地代理（`openai_chat`）；`USER_TYPE` 不是 `ant`，`feature()` 全为 false，GrowthBook 关闭（所有 `getFeatureValue_CACHED_MAY_BE_STALE` 取默认值）。服务器给 CLI 设的、与本维度有关的环境变量：`CLAUDE_COWORK_MEMORY_PATH_OVERRIDE`（`conversationService.ts:1062,1086-1097`）、`CALLER_DIR`/`PWD`（`:1063-1064`）；没有设 `CLAUDE_CODE_DISABLE_CLAUDE_MDS`、`CLAUDE_CODE_DISABLE_AUTO_MEMORY`、`CLAUDE_CODE_SIMPLE`、`CLAUDE_CODE_REMOTE`，没有传 `--add-dir`、`--append-system-prompt`、`--bare`。代理的计费行问题（P-REQ-01）已在 `main` 修复（`src/server/proxy/handler.ts:73` 只对 `claude` 开头的模型名加），所以本报告里的前缀稳定性问题在 `main` 上是实际生效的。

路径约定：DreamCoder 读 `main` 干净检出（提交 `ce209f69`），路径相对仓库根；`codex:` 相对 `refs/coding-agents/codex/codex-rs`（`rust-v0.164.0`）；`zcode:` 相对 ZCode 仓库根 `refs/coding-agents/zcode`（`fec97590`）。

测量方法：在 scratchpad 的 `text-review/T-CTX/` 下写 bun 脚本，从 `main` 检出导入函数取字符串计数，`CLAUDE_CONFIG_DIR`、`DREAMCODER_CONFIG_DIR` 指向空目录：

- `skills.ts`：`initBundledSkills()` 后按 `isEnabled`、`disableModelInvocation` 过滤，再用 `formatCommandsWithinBudget(…, 200000)` 渲染技能清单。
- `wrap.ts`：用 `prependUserContext`、`getClaudeMds`、`appendSystemContext` 取包装文字。
- `mem.ts`：`buildMemoryLines('auto memory', <51 字符路径>)` 的长度；`getCharBudget(200000)`。
- `env.ts`：`computeSimpleEnvInfo('glm-5.3', [])` 与子 agent 用的 `computeEnvInfo('glm-5.3', [])`。

字符数为 JavaScript 字符串长度（UTF-16 码元）。其余为静态阅读。没有运行测试，没有发网络请求。

### 加载总览（DreamCoder，本场景）

| 内容 | 位置 | 计算时机 | 会话中会不会变 |
|---|---|---|---|
| memory 使用说明（12 549 字符） | system 动态段 `memory`（`src/constants/prompts.ts:495`） | 每个 CLI 进程一次，压缩后重算 | 不变 |
| `# Environment`（823 字符，其中 552 为 Claude 专属三行） | system 动态段 `env_info_simple`（`src/constants/prompts.ts:499-501,651-711`） | 同上；进出 worktree 时重算（`src/tools/EnterWorktreeTool/EnterWorktreeTool.ts:99`） | 基本不变 |
| MCP 服务器 instructions | system 动态段，`DANGEROUS_uncachedSystemPromptSection`（`src/constants/prompts.ts:513-520`） | 每轮重算 | MCP 连上或断开时变 |
| git 状态（约 300 + status ≤2 000 + 5 条 log） | system 最后一块，`gitStatus: ` 前缀（`src/utils/api.ts:437-447`，`src/query.ts:451`） | 每个 CLI 进程一次（`src/context.ts:36,116` memoize），压缩不重算 | 进程内不变，重启后重算 |
| CLAUDE.md 系列 + `MEMORY.md` + 日期 | 第一条 user 消息，`<system-reminder>` 包装（`src/utils/api.ts:449-472`，`src/query.ts:661`），不写入 transcript，每次请求现拼 | 每个进程一次（`src/context.ts:155`），压缩后重算（`src/services/compact/postCompactCleanup.ts:59-60`） | 进程内不变 |
| 技能清单 | 第一轮的 `skill_listing` 附件（`src/utils/attachments.ts:866,2645-2735`，渲染 `src/utils/messages.ts:3822-3831`），写入历史 | 进程内首次；新增技能按增量 | 只追加 |
| 嵌套 CLAUDE.md、`.claude/rules` 条件规则 | `nested_memory` 附件（`src/utils/attachments.ts:863,1694-1720`，渲染 `src/utils/messages.ts:3794-3801`） | 读到该目录下文件时 | 只追加 |
| agent 清单 | Agent 工具描述（`agent_listing_delta` 关闭：`src/tools/AgentTool/prompt.ts:59-64`），工具 schema 按名字缓存（`src/utils/api.ts:136-142`） | 每个进程一次 | 进程内不变 |
| SessionStart 钩子输出 | `hook_additional_context` 附件（`src/utils/messages.ts:4211-4222`） | 新会话 `startup`、恢复 `resume`、压缩 `compact` | 每次触发都追加 |
| 输出风格、语言 | system 动态段（`src/constants/prompts.ts:502-507`） | 桌面端不设置，本场景为空 | — |

## 1. 发现清单

### T-CTX-01 CLI 完全不读 `AGENTS.md`，用 Codex、ZCode 等工具维护的项目指令在 DreamCoder 里不生效

- 状态：维护者已定（2026-11-18）：文件名按优先级 `DREAMCODER.md` > `AGENTS.md` > `CLAUDE.md` > `.claude/CLAUDE.md`，每个目录只读存在的最高一个；从项目根到工作目录每层一个，与现在逐层读取一致；读子目录文件时附带的那份按同一规则；用户级目录按同一优先级；每个文件上限 100 KiB；`CLAUDE.local.md` 和 `.claude/rules/` 不变。
- 类型：缺失
- 严重程度：高
- 体量：视文件，每个请求都发（缺失的那部分）
- 现状（按执行顺序）：
  1. `getMemoryFiles` 依次读：托管 `CLAUDE.md` 与 `.claude/rules`（`src/utils/claudemd.ts:826-845`）；用户级 `CLAUDE.md` 与 `rules/`，DreamCoder 自己的目录没有时退回 Claude Code 的 `~/.claude`（`:798-810,848-871`）；从根到 cwd 每一层的 `CLAUDE.md`、`.claude/CLAUDE.md`、`.claude/rules/*.md`、`CLAUDE.local.md`（`:874-955`）；`--add-dir` 目录（`:960-999`，本场景不触发）；最后 `MEMORY.md`（`:1002-1013`）。
  2. 读子目录文件时的嵌套加载同样只找 `CLAUDE.md`、`.claude/CLAUDE.md`、`CLAUDE.local.md`、`.claude/rules`（`src/utils/claudemd.ts:1271-1349`）。
  3. 整个 `src` 与 `desktop/src` 中只有 `/init` 的提示词提到 `AGENTS.md`（`src/commands/init.ts:46,108`），让模型在生成 CLAUDE.md 时参考它。
- 场景：用 DreamCoder 打开 DreamCoder 自己的仓库。仓库根只有 `AGENTS.md`（10 877 字节），没有 `CLAUDE.md`（`git show ce209f69:CLAUDE.md` 不存在）。模型拿不到「新代码不写注释」「i18n 两种语言」「用语义主题色」等规则，第一条 user 消息里只有用户级 CLAUDE.md 和日期。同样，从 Codex 或 ZCode 迁移过来的用户，项目里的 `AGENTS.md` 全部失效，而且桌面端没有任何提示。
- 参考：
  - Codex（读取规则）：
    - 查找范围：从 cwd 向上找项目根标记（缺省 `.git`，可配 `project_root_markers`；找不到标记只看 cwd），然后从项目根到 cwd 每一层取第一个存在的文件，候选顺序为 `AGENTS.override.md`、`AGENTS.md`、再是 `project_doc_fallback_filenames`（`codex:core/src/agents_md.rs:1-18,192-268,272-293`）。不受信任的项目跳过项目文档（`:64-66`）。
    - 用户级：`~/.codex/` 下 `AGENTS.override.md`、`AGENTS.md` 取第一个非空的（`codex:codex-home/src/instructions/mod.rs:41-75`）。
    - 合并顺序：用户级在前，项目文档按根到 cwd 顺序在后，用户级与项目之间插 `--- project-doc ---` 分隔（`codex:core/src/agents_md.rs:49,386-418`）。
    - 大小：项目文档合计 `project_doc_max_bytes`，缺省 32 KiB（`codex:config/src/config_toml.rs:75`），超出按字节截断，不给模型截断标记（`codex:core/src/agents_md.rs:155-163`）；用户级不计入。
    - 包装：user 角色消息，`# AGENTS.md instructions for <cwd>` 加 `<INSTRUCTIONS>…</INSTRUCTIONS>`（`codex:core/src/context/user_instructions.rs:22-41`）。基础指令里有一节 AGENTS.md 规范：作用域是所在目录树、深层文件优先、直接指令优先于 AGENTS.md、在子目录工作时自己去找适用的 AGENTS.md（`codex:models-manager/prompt.md:17-27`）。
  - ZCode（读取规则）：
    - 查找范围：只认 `AGENTS.md`（`zcode:apps/zcode-cli/packages/adapters/src/context/index.ts:26`）；从 cwd 向上到 git 根，取离 cwd 最近的一个（`:236-259,354-356`）；用户级 `~/.zcode/AGENTS.md`（`:261-275`）。
    - 合并顺序：用户级在前、工作区在后，同一路径去重（`:123-158,171-186`），每个文件单独一个块。
    - 大小：每个文件 100 KiB（`:27`），超出时块尾加 `[File truncated: AGENTS.md]`（`zcode:apps/zcode-cli/packages/core/src/context/sections/request-user-context.ts:99-112`）。
    - 包装：与 DreamCoder 相同的 193 字符前言和 `Contents of <path> (<类型>):` 块头（`zcode:apps/zcode-cli/packages/core/src/context/sections/instruction-files.ts:13-38`），作为 meta user 附件写入历史；启动和压缩后重读，变化时追加增量公告（`:44-55`，`zcode:apps/zcode-cli/packages/core/src/runtime/methods/context-refresh.ts:362-474`）。
- 改法方向：在 `getMemoryFiles` 与嵌套加载的每一层，`CLAUDE.md` 之外也读 `AGENTS.md`（类型同 Project，块头写明文件名）；两者都存在时都加载，按真实路径去重（处理 `CLAUDE.md -> AGENTS.md` 的软链接）。用户级可同时认 `~/.dreamcoder/AGENTS.md`。是否加 `AGENTS.override.md` 和可配置的后备文件名是产品决定。
- 确定程度：代码确认

### T-CTX-02 桌面端设了记忆路径覆盖变量，写记忆文件因此每次都要用户批准，与记忆说明里的「直接写」矛盾

- 状态：维护者已定（2026-11-18）：扩展 CLI 的记忆写入豁免，让它也覆盖服务器指定的记忆路径。
- 类型：问题
- 严重程度：中
- 体量：不涉及文字量；影响每次保存记忆的轮数和打断
- 现状（按执行顺序）：
  1. 服务器给 CLI 设 `CLAUDE_COWORK_MEMORY_PATH_OVERRIDE = <配置目录>/projects/<规范化的项目根>/memory/`（`src/server/services/conversationService.ts:1062,1086-1097`），目的是让 CLI 与服务器的记忆 API 用同一个目录（测试 `src/server/__tests__/conversation-service.test.ts:160-171`）。这个值与 CLI 自己算出的缺省路径（`src/memdir/paths.ts` 中 `getAutoMemPath`）形状相同。
  2. 有了这个覆盖，`hasAutoMemPathOverride()` 为真（`src/memdir/paths.ts` 中 `hasAutoMemPathOverride`）。写权限检查里，记忆目录的放行分支要求没有覆盖（`src/utils/permissions/filesystem.ts:1732-1747`，注释写明覆盖路径「gets NO special permission treatment」）。
  3. 于是写入走到安全检查：路径在 DreamCoder 配置目录里、且含 `.dreamcoder` 段（`src/utils/permissions/filesystem.ts:101-107,571-615`），返回 `ask`（`:1464-1490`）。
  4. 与此同时，system 里的记忆说明告诉模型「This directory already exists — write to it directly with the Write tool」（`src/memdir/memdir.ts:116,239`），并要求用户说「记住」时立即保存。
- 场景：用户说「记住我们用 bun 不用 npm」。模型按说明写 `<memory>/feedback_bun.md`，桌面端弹出权限请求；用户批准后模型再写 `MEMORY.md` 索引，又弹一次。用户若拒绝，模型会按工具被拒处理，记忆不完整。安全检查类的 `ask` 在 `bypassPermissions` 下是否也弹，未核实。
- 参考：Codex 记忆功能缺省关（`codex:features/src/lib.rs:1317-1322`，见 comparison/prompt.md Q5）。ZCode 的记忆说明同样写「directly with the Write tool」（`zcode:apps/zcode-cli/packages/core/src/context/sections/memory.ts:36`），其权限是否放行未核实。
- 改法方向：服务器不再设覆盖变量，改为与 CLI 共用同一个路径计算函数（两边已是同一形状）；或者保留覆盖，但让放行分支对「服务器指定的记忆目录」同样生效。前者更直接，也去掉了一个 Cowork 遗留变量。
- 确定程度：代码确认（权限流程）；桌面端弹窗的实际表现为推断

### T-CTX-03 压缩后技能清单不再发送，模型不知道有哪些技能

- 类型：问题
- 严重程度：中
- 体量：技能清单首轮约 1 500 字符起（6 个内置技能 1 410 + 头 65 + 包装），上限 8 000（200K 窗口）；压缩后这部分缺失
- 现状（按执行顺序）：
  1. 首轮 `getSkillListingAttachments` 发送全部技能，并把名字记进进程级的 `sentSkillNames`（`src/utils/attachments.ts:2591,2683-2735`）。
  2. 压缩时，首轮的 `skill_listing` 附件在压缩边界之前，被摘要替换。
  3. 压缩流程明确不重置 `sentSkillNames`（`src/services/compact/compact.ts:524-529,920`；`src/services/compact/postCompactCleanup.ts:65`），注释的理由是「重发约 4K token 只会产生缓存写入」，并说 ant 有 `EXPERIMENTAL_SKILL_SEARCH` 兜底；外部构建没有这个兜底。
  4. 之后每轮 `newSkills` 为空，不再发清单（`src/utils/attachments.ts:2703-2706`）。Skill 工具描述只说「Available skills are listed in system-reminder messages」（`src/tools/SkillTool/prompt.ts:189`），此时历史里已经没有这样的消息。
- 场景：长会话自动压缩之后，用户说「把这个做成幻灯片」。压缩前模型能看到 `slides`、`artifacts`、`design` 技能，压缩后看不到，可能直接手写 HTML，不走 slides 技能的 1920×1080 固定画布流程。CLI 重启（见 T-CTX-06）后会重新发送，压缩边界之前的清单不在恢复的历史里（推断）。
- 参考：ZCode 压缩后对比保留段，没有技能清单就重新公告，注释写明「否则 compact 后第一次请求没有 skill 名单」（`zcode:apps/zcode-cli/packages/core/src/runtime/methods/context-refresh.ts:294-304`）。Codex 压缩后把完整初始上下文重新插回（`codex:core/src/compact.rs:87-106`），技能片段属于初始上下文（推断）。
- 改法方向：压缩后（主线程）重置 `sentSkillNames`，或在 `compact.ts` 的压缩后附件里直接加一份完整技能清单，与 agent 清单、MCP 说明的重新公告（`compact.ts:567-583`）放在一起。
- 确定程度：代码确认

### T-CTX-04 第一条 user 消息的外层包装说「可能无关、不要回应」，内层说「必须严格遵守」，记忆索引也被归为「必须遵守的指令」

- 类型：问题
- 严重程度：中
- 体量：固定包装 290 字符 + 内层前言 193 字符 + 每个文件块头约 65 字符加路径，每个请求都发
- 现状（按执行顺序）：
  1. `getClaudeMds` 把所有文件（含 `MEMORY.md`）放在一段前言之后：「IMPORTANT: These instructions OVERRIDE any default behavior and you MUST follow them exactly as written.」（`src/utils/claudemd.ts:93-94,1175-1214`）。
  2. `prependUserContext` 再包一层：开头「As you answer the user's questions, you can use the following context:」，结尾「IMPORTANT: this context may or may not be relevant to your tasks. You should not respond to this context unless it is highly relevant to your task.」（`src/utils/api.ts:449-472`）。
  3. 同一段里，`MEMORY.md` 以「user's auto-memory」块出现（`src/utils/claudemd.ts:1197`），因此也在「MUST follow exactly」之下；而 system 的记忆说明说记忆可能过时、使用前要核实、用户说忽略时当作空（`src/memdir/memoryTypes.ts:202,220`）。
- 场景：项目 CLAUDE.md 写「提交信息用英文」。外层说这段上下文「可能无关、除非高度相关不要回应」，第三方模型可能据此不把它当约束，提交时用了中文。另一个方向：`MEMORY.md` 里一条过时的「项目用 npm」索引被前言标成「必须严格遵守」，与记忆说明的「先核实」冲突。
- 参考：Codex 的 AGENTS.md 块没有降级措辞，优先级在基础指令里说明（直接指令 > AGENTS.md，深层 > 浅层，`codex:models-manager/prompt.md:21-27`）；记忆功能缺省关。ZCode 指令文件用同一句前言，但没有「may or may not be relevant」这句（全仓 grep 无匹配），git 上下文另起一块并写明「isn't part of the user's message…don't need it reported back」（`zcode:apps/zcode-cli/packages/core/src/context/sections/env-info.ts:202-224`）。ZCode 同样把 `MEMORY.md` 放在指令前言之下（`zcode:apps/zcode-cli/packages/core/src/context/sections/request-user-context.ts:47-77`）。
- 改法方向：外层包装去掉「may or may not be relevant / should not respond」，改为说明这是自动附上的上下文、不是用户的话；`MEMORY.md` 移出「MUST follow」前言，单独标为「记忆索引，按记忆说明使用」。优先级（用户当前消息 > 指令文件）写一句即可。措辞细节与 T-SYS 协调。
- 确定程度：代码确认（对模型行为的影响为推断）

### T-CTX-05 环境段对非 Claude 模型发 552 字符的 Claude 产品与模型信息，宿主写成 Claude Code，没有 DreamCoder 桌面端的说明

- 类型：问题
- 严重程度：中
- 体量：环境段 823 字符（本仓库路径下实测），其中 3 行 552 字符为 Claude 专属；每个请求都发
- 现状（按执行顺序）：
  1. `computeSimpleEnvInfo` 在非 `ant` 构建下无条件加三行：最新 Claude 模型家族与 ID、「Claude Code is available as a CLI in the terminal, desktop app (Mac/Windows), web app (claude.ai/code)…」、「Fast mode … toggled with /fast」（`src/constants/prompts.ts:693-703`）。第一行自身矛盾：「Claude 4.5/4.6」后面列的是「Opus 4.7」。
  2. 模型行为第三方模型时为 `You are powered by the model glm-5.3.`，知识截止只对 Claude 有（`:657-672,713-731`）。
  3. 工作区条目有一处格式错：`Is a git repository` 写成嵌套数组（`:682`），渲染成缩进两格的子条目「  - Is a git repository: true」。
  4. 没有任何一行说明宿主是 DreamCoder 桌面端（回复在桌面渲染、文件链接如何写等）。
- 场景：GLM 被问「你是什么模型、能用 /fast 吗」，环境段给了一套 Claude 的答案；被要求「写个调用大模型的脚本」，环境段要求默认用最新 Claude 模型。
- 参考：Codex 的 `<environment_context>` 只有 cwd、shell、日期、时区等（`codex:core/src/context/world_state/environment.rs:263-330`）。ZCode 环境公告是 cwd、git、平台、shell、OS 加「下载文件不可信」一行（`zcode:apps/zcode-cli/packages/core/src/context/sections/env-info.ts:226-247`），桌面端另有「ZCode Desktop Context」段，说明本地 URL 和文件引用写成 Markdown 链接等（`zcode:apps/zcode-cli/packages/core/src/context/sections/desktop.ts:15-40`）。
- 改法方向：三行 Claude 文字只在模型名为 Claude 时发（「Claude 模型、Anthropic 直连」路径保留）；修正嵌套数组；桌面端是否加一段宿主说明（链接格式、渲染位置）由 T-SYS 一并决定。已见 comparison/prompt.md Q4，本条补实测数与格式错。
- 确定程度：代码确认（实测字符数）

### T-CTX-06 「会话内只算一次」的上下文实际是每个 CLI 进程算一次；桌面端切换 effort、模型或进出 bypass 模式都会重启 CLI，git 状态、指令文件、日期全部重算，前缀缓存失配，钩子输出和嵌套 CLAUDE.md 重复追加

- 类型：问题
- 严重程度：中
- 体量：重启后第一个请求的整段 system 与历史全部按未命中计费（system 约 2.6 万字符加历史，体量见 comparison/request-cache.md Q7）；钩子输出视钩子而定，每次重启追加一份
- 现状（按执行顺序）：
  1. 服务器在运行时选择（提供方、模型、effort）变化时重启 CLI（`src/server/ws/handler.ts:742,780-811`），进出 `bypassPermissions` 时也重启（`:684-692`）；重启用 `--resume`（`src/server/services/conversationService.ts:153`）。
  2. 新进程里，`getSystemContext`（git 状态）、`getUserContext`（CLAUDE.md、`MEMORY.md`、日期）的 memoize 都是空的（`src/context.ts:116,155`），重新读取。git 状态的说明仍是「the git status at the start of the conversation」（`src/context.ts:97`），实际是本次重启时的快照。
  3. git 状态放在 system 的最后一块（`src/utils/api.ts:437-447`）。会话中模型改过文件，`git status --short` 一定不同，于是 system 末尾变化，其后全部历史失配。指令文件或日期变化时，第一条 user 消息变化，效果相同。
  4. 恢复时 `processSessionStartHooks('resume')` 的输出追加到历史（`src/utils/conversationRecovery.ts:541-545`），每次重启一份。
  5. 嵌套 CLAUDE.md 的去重集合 `loadedNestedMemoryPaths` 是进程内的（`src/QueryEngine.ts:210`），重启后再读同目录文件会再附一次。
  6. 技能清单在恢复时会根据历史中已有的 `skill_listing` 抑制重发（`src/utils/conversationRecovery.ts:395-401`），这一项处理过。
- 场景：会话进行到第 30 轮、模型改过若干文件，用户把 effort 从 medium 调到 high（同一模型）。CLI 重启，git 状态快照变了，下一个请求从 system 末尾起全部不命中，DeepSeek、Kimi 等按前缀缓存的提供方按全价计费。若用户配了一个打印项目状态的 SessionStart 钩子，每切换一次，历史里多一份。
- 参考：ZCode 把指令文件、git 会话上下文、日期作为公告写进历史，恢复时以历史为准、只追加变化；git 上下文「每个窗口只决定一次，只看历史」（`zcode:apps/zcode-cli/packages/core/src/runtime/methods/context-refresh.ts:348-410,588-610`）。Codex 每步把 world state 与历史中上一份快照比较，只追加差异（`codex:core/src/session/world_state.rs:163-400`）。
- 改法方向：git 状态与指令文件改为写入历史的附件（首次进程写一次，恢复时从历史里认出已发送就不重算，变化时追加增量），不再放在每次请求现拼的 system 末尾和首条消息里；SessionStart 的 `resume` 输出与历史中上一份相同时不再追加。是否保留「effort 变化要重启 CLI」属于服务器侧，可另议（effort 可以走 control request）。
- 确定程度：代码确认（重启与重算）；钩子输出写入 transcript 为推断

### T-CTX-07 桌面端没有批准外部 `@` 引用的入口，项目 CLAUDE.md 里引用工作目录以外文件的 `@~/…` 被静默丢弃

- 状态：维护者已定（2026-11-18）：直接加载，不需要批准，与用户级文件相同。
- 类型：问题
- 严重程度：中
- 体量：视被引用文件，缺失的部分
- 现状（按执行顺序）：
  1. 项目级文件处理 `@` 引用时，工作目录外的路径只有在 `includeExternal` 为真时才读（`src/utils/claudemd.ts:670-684`）。
  2. `includeExternal` 取项目配置的 `hasClaudeMdExternalIncludesApproved`（`:820-823`）；这个值只有终端界面的对话框会写（`src/components/ClaudeMdExternalIncludesDialog.tsx:123-130`）。
  3. 桌面端和服务器都没有对应入口（`src/server`、`desktop/src` grep 无匹配），`--print` 模式也不弹对话框。用户级 CLAUDE.md 不受此限（`:855`）。
- 场景：项目 `CLAUDE.md` 写 `@~/.dreamcoder/my-project-notes.md`（个人对该项目的补充说明，常见用法）。桌面端会话里这份文件从不加载，没有任何提示；同一项目在终端版里批准后能加载。
- 参考：Codex、ZCode 都没有 `@` 引用机制，无对应。
- 改法方向：由桌面端提供批准入口（会话开始时检测到外部引用就提示，写入同一个配置项）；或者在桌面端按用户级的规则直接允许。哪种取决于安全取舍（外部引用可读任意文本文件进上下文）。
- 确定程度：代码确认

### T-CTX-08 指令文件没有大小上限，超大时桌面端也看不到提醒

- 状态：维护者已定（2026-11-18）：每个文件上限 100 KiB（见 T-CTX-01）。
- 类型：缺失
- 严重程度：低
- 体量：视文件，每个请求都发
- 现状（按执行顺序）：
  1. `processMemoryFile` 与 `getClaudeMds` 不截断内容（`src/utils/claudemd.ts:622-688,1175-1214`），`@` 引用最多 5 层（`:541`），每层也不截断。
  2. `MAX_MEMORY_CHARACTER_COUNT = 40000` 只用于 `/doctor`、`/status` 和终端状态提示（`src/utils/doctorContextWarnings.ts:44-66`，`src/utils/status.tsx:118-122`，`src/utils/statusNoticeDefinitions.tsx:34-45`），桌面端与服务器都不读它（grep 无匹配）。
- 场景：项目 CLAUDE.md 用 `@docs/architecture.md` 引入一份 15 万字符的设计文档，每个请求都带上，桌面端用户不知道上下文被占掉多少。
- 参考：Codex 项目文档合计 32 KiB（`codex:config/src/config_toml.rs:75`）；ZCode 每文件 100 KiB 并标注截断（`zcode:apps/zcode-cli/packages/adapters/src/context/index.ts:27`，`zcode:apps/zcode-cli/packages/core/src/context/sections/request-user-context.ts:101`）。
- 改法方向：给单个文件或合计加上限并在块尾写截断说明（与 `MEMORY.md` 的截断提示同一写法）；超限时在桌面端的会话诊断里显示。
- 确定程度：代码确认

### T-CTX-09 `update-config` 技能在清单里写「Claude Code harness」「not Claude」，并让模型用本场景不存在的 Config 工具

- 类型：问题
- 严重程度：低
- 体量：清单条目截到 250 字符；6 个内置技能清单共 1 410 字符，首轮一次
- 现状（按执行顺序）：
  1. 本场景可见的内置技能为 `update-config`、`simplify`、`browser`、`artifacts`、`design`、`slides`（实测；`keybindings-help` 的 `isEnabled` 为假，`debug`、`batch` 禁止模型调用）。
  2. `update-config` 的描述以「Use this skill to configure the Claude Code harness via settings.json」开头，含「the harness executes these, not Claude」，结尾「For simple settings like theme/model, use Config tool」（`src/skills/bundled/updateConfig.ts:449`）。清单截到 250 字符，后半段在清单里被截掉，但调用技能后完整出现；技能正文也写「Claude Code's lifecycle」「Modify Claude Code configuration」（`:112,309`）。
  3. Config 工具只在 `ant` 构建里（`src/tools.ts:224`）。
- 场景：用户说「把主题改成深色」，模型调 `update-config`，被告知用 Config 工具，工具列表里没有。
- 参考：无对应（两家没有同类内置技能）。
- 改法方向：描述改为 DreamCoder 与「模型」的中性说法，删掉 Config 工具那句；正文里的产品名一并替换。
- 确定程度：代码确认

### T-CTX-10 `MEMORY.md` 不存在或为空时什么也不发，记忆说明却写「MEMORY.md 总会载入上下文」

- 类型：问题
- 严重程度：低
- 体量：缺一句约 80 字符的说明；每个请求
- 现状（按执行顺序）：
  1. `MEMORY.md` 不存在时读取返回空（`src/utils/claudemd.ts:428-444`），为空字符串时 `getClaudeMds` 跳过（`:1189`），第一条 user 消息里没有记忆块。
  2. system 的记忆说明仍然完整发送（`src/memdir/memdir.ts:474-489`），并写「`MEMORY.md` is always loaded into your conversation context」（`:229`）。
  3. 同一文件里的 agent 记忆版本在为空时会写「Your MEMORY.md is currently empty」（`:307-312`），主会话版本没有这句。
- 场景：新项目第一次会话，模型找不到 `MEMORY.md` 块，可能去 Read 或 Glob 记忆目录确认，多一两轮工具调用。
- 参考：ZCode 同样为空时不发索引、无说明（`zcode:apps/zcode-cli/packages/core/src/context/sections/request-user-context.ts:64-77`）。Codex 记忆功能缺省关。
- 改法方向：主会话也在索引缺失或为空时发一行「MEMORY.md 当前为空」，与 agent 记忆版本一致。
- 确定程度：代码确认（多出工具调用为推断）

### T-CTX-11 托管级 CLAUDE.md 被标成「user's private global instructions」

- 类型：问题
- 严重程度：低
- 体量：块头一处，约 54 字符
- 现状：`getClaudeMds` 的标签三元表达式没有 `Managed` 分支，落到最后的默认值「user's private global instructions for all projects」（`src/utils/claudemd.ts:1190-1199`，实测 `/etc/claude-code/CLAUDE.md` 得到该标签）。托管路径是 Claude Code 的（macOS `/Library/Application Support/ClaudeCode`，`src/utils/settings/managedPath.ts:17-24`）。
- 场景：企业下发的托管策略文件被模型当成用户个人偏好，与项目指令冲突时优先级判断错位。
- 参考：Codex、ZCode 无托管级指令文件。
- 改法方向：给 `Managed` 一个独立标签（如「organization-managed instructions」）。
- 确定程度：代码确认

### T-CTX-12 上下文里露出内部变量名，包装有多余缩进

- 类型：问题
- 严重程度：低
- 体量：约 50 字符，每个请求
- 现状：
  1. 第一条 user 消息用对象键名作标题：`# claudeMd`、`# currentDate`（`src/utils/api.ts:460-465`）。
  2. git 状态在 system 里以 `gitStatus: ` 开头（`src/utils/api.ts:437-447` 把键名和值用冒号拼起来）。
  3. 外层包装的结尾一行带 6 个空格缩进（`src/utils/api.ts:467-469` 的模板字符串换行）。
- 场景：模型偶尔在回复里引用「claudeMd 里说……」，用户不明白。
- 参考：ZCode 用自然语言标题和独立块（`zcode:apps/zcode-cli/packages/core/src/context/sections/env-info.ts:202-224`）；Codex 用 `# AGENTS.md instructions for <dir>` 与 `<environment_context>`。
- 改法方向：标题换成「Instruction files」「Current date」，git 块用自己的说明句，去掉缩进。与 T-CTX-04、T-CTX-06 一起改。
- 确定程度：代码确认

### T-CTX-13 压缩后指令文件、日期、环境都重算，git 状态不重算

- 类型：问题
- 严重程度：低
- 体量：git 块约 300–2 500 字符
- 现状：压缩后的清理清掉 `getUserContext` 和 system 段缓存（`src/services/compact/postCompactCleanup.ts:58-62`），没有清 `getSystemContext`（`src/context.ts:116`）。压缩后 system 末尾仍是会话开始（或上次重启）时的 git 快照，而这时历史已经被摘要替换，模型对之后改过哪些文件只能从摘要里看。
- 场景：两小时的会话压缩后，git 块仍显示最初「(clean)」，摘要里写了改过 6 个文件，两者不一致。
- 参考：ZCode 压缩后为新窗口重新决定 git 上下文（`zcode:apps/zcode-cli/packages/core/src/runtime/methods/context-refresh.ts:588-610`）；Codex 不发 git 状态（未找到注入）。
- 改法方向：随 T-CTX-06 一起处理：git 改为历史中的附件，压缩后作为压缩后附件重发一次当前状态。
- 确定程度：代码确认

### T-CTX-14 `MEMORY.md` 的「25 000 字节」上限实际按 UTF-16 字符数算，模型只被告知 200 行上限

- 类型：问题
- 严重程度：低
- 体量：中文索引最多约 25 000 字（UTF-8 约 75 KB），每个请求
- 现状：`MAX_ENTRYPOINT_BYTES = 25_000`，但比较的是 `trimmed.length`（`src/memdir/memdir.ts:38,61`），截断提示用 `formatFileSize` 把字符数显示成「KB」（`:88-92`）。记忆说明只提「lines after 200 will be truncated」（`:229`）。
- 场景：中文用户的索引每行 120 字、200 行，共 2.4 万字，不触发截断，每个请求带约 2 万 token 以上的索引（按中文 token 化估算，推断）。
- 参考：ZCode 同样 200 行 / 25 000 字符，常量名写作 `CHARACTER_LIMIT`（`zcode:apps/zcode-cli/packages/core/src/memory/index-content.ts:6-7`）。
- 改法方向：常量与提示改称「字符」，或真按字节计；记忆说明里补上字符上限。
- 确定程度：代码确认

### T-CTX-15 嵌套 CLAUDE.md 只有一行「Contents of <path>:」，没有类型标签和作用域；模型不知道子目录可能有自己的指令文件

- 类型：缺失
- 严重程度：低
- 体量：每个嵌套文件块头约 15 字符加路径，读到时一次
- 现状：
  1. 读文件时，路径与 cwd 之间各层的 CLAUDE.md 与匹配的条件规则作为 `nested_memory` 附件追加（`src/utils/attachments.ts:1694-1720`；只有 Read 工具登记触发路径，`src/tools/FileReadTool/FileReadTool.ts:846,868,1036`）。
  2. 渲染只有「Contents of <path>:」（`src/utils/messages.ts:3794-3801`），没有首条消息里的前言和「project instructions」标签。
  3. system 与首条消息都没有说明「子目录可能有 CLAUDE.md、其作用域是该目录、与根目录冲突时谁优先」。用 Grep/Bash 查看文件不会触发附件。
- 场景：模型只用 Grep 定位并直接 Edit `desktop/src/foo.tsx`（Edit 要求先 Read，但 Grep 结果之后的 Read 才触发），在此之前看不到 `desktop/CLAUDE.md` 的规则；看到之后也不知道它只管 `desktop/`。
- 参考：Codex 基础指令写明作用域、深层优先、在子目录工作时自己检查适用的 AGENTS.md（`codex:models-manager/prompt.md:17-27`）。ZCode 只读离 cwd 最近的一个，无嵌套机制。
- 改法方向：嵌套块头加类型与「applies to files under <dir>」；首条消息的前言加一句作用域和优先级规则。
- 确定程度：代码确认

### T-CTX-16 子 agent 继承的上下文不成套：拿到 `MEMORY.md` 索引但没有记忆说明，每个子 agent 再收一份技能清单

- 类型：优化
- 严重程度：低
- 体量：general-purpose 子 agent 每次启动多约 1 500 字符起的技能清单；`MEMORY.md` 视索引
- 现状（按执行顺序）：
  1. 子 agent 取同一份 `getUserContext()` 与 `getSystemContext()`（`src/tools/AgentTool/runAgent.ts:388-391`）。Explore、Plan 去掉 `claudeMd`（连带 `MEMORY.md`）和 git 状态（`:398-419`）；其他子 agent 全部保留。
  2. 子 agent 的 system 是 agent 自身提示 + Notes + `computeEnvInfo`（实测 262 字符，没有 Claude 三行）（`src/constants/prompts.ts:760-791`），不含记忆说明段。所以 general-purpose 子 agent 看到「user's auto-memory」索引块，却不知道记忆目录与使用规则。
  3. 技能清单的已发送集合按 `agentId` 分开（`src/utils/attachments.ts:2683-2688`），每个有 Skill 工具的子 agent 首轮都收一份完整清单。
  4. `runAgent.ts:409` 的注释称 git 状态「up to 40KB」，实际 status 截到 2 000 字符（`src/context.ts:20,85-89`），只是注释过时。
- 场景：主会话派 3 个 general-purpose 子 agent 查资料，各自多收约 1.5K 字符技能清单和整份记忆索引，记忆索引对子 agent 的任务基本无用。
- 参考：ZCode 的记忆段只给主会话类型（`zcode:apps/zcode-cli/packages/core/src/runtime/helpers/project-memory.ts:4-28`，见 comparison/prompt.md Q5）。Codex 子 agent 继承情况未核实。
- 改法方向：子 agent 的 userContext 去掉 `MEMORY.md` 块（保留 CLAUDE.md）；技能清单对子 agent 只发名字或不发（子 agent 很少调用技能，属推断，需要数据）。
- 确定程度：代码确认（子 agent 是否用得到为推断）

## 2. 汇总表

| 编号 | 标题 | 类型 | 严重程度 | 体量 |
|---|---|---|---|---|
| T-CTX-01 | CLI 不读 `AGENTS.md` | 缺失 | 高 | 视文件，每请求 |
| T-CTX-02 | 记忆路径覆盖使写记忆每次要批准 | 问题 | 中 | 每次保存记忆多 1–2 次批准 |
| T-CTX-03 | 压缩后技能清单丢失 | 问题 | 中 | 约 1.5K–8K 字符缺失 |
| T-CTX-04 | 首条消息内外层措辞矛盾，记忆索引被标为必须遵守 | 问题 | 中 | 290 + 193 + 块头，每请求 |
| T-CTX-05 | 环境段 552 字符 Claude 专属文字，无宿主说明 | 问题 | 中 | 552/823，每请求 |
| T-CTX-06 | 上下文按进程计算，CLI 重启导致重算、失配、重复追加 | 问题 | 中 | 重启后整段前缀未命中 |
| T-CTX-07 | 桌面端外部 `@` 引用被静默丢弃 | 问题 | 中 | 视被引用文件 |
| T-CTX-08 | 指令文件无大小上限、桌面端无提醒 | 缺失 | 低 | 视文件，每请求 |
| T-CTX-09 | `update-config` 清单写 Claude Code、引用 Config 工具 | 问题 | 低 | 250 字符，一次 |
| T-CTX-10 | `MEMORY.md` 为空时无说明 | 问题 | 低 | 约 80 字符 |
| T-CTX-11 | 托管级 CLAUDE.md 标签错误 | 问题 | 低 | 约 54 字符 |
| T-CTX-12 | 内部变量名外露、多余缩进 | 问题 | 低 | 约 50 字符，每请求 |
| T-CTX-13 | 压缩后 git 状态不重算 | 问题 | 低 | 300–2 500 字符 |
| T-CTX-14 | `MEMORY.md` 字节上限按字符算 | 问题 | 低 | 视索引 |
| T-CTX-15 | 嵌套 CLAUDE.md 无类型与作用域说明 | 缺失 | 低 | 每文件约 15 字符加路径 |
| T-CTX-16 | 子 agent 继承记忆索引与技能清单 | 优化 | 低 | 每个子 agent 约 1.5K 起 |

## 3. 与已有结论的出入

证实：

- comparison/prompt.md Q6「确认 CLI 不读 `AGENTS.md`」：重新核实成立，嵌套加载路径同样不读（T-CTX-01）。
- prompt.md Q6「40 000 字符只是告警阈值，不截断」：成立；补充：这个告警只在终端版的 `/doctor`、`/status` 和状态提示里，桌面端看不到（T-CTX-08）。
- prompt.md Q5「memory 段约 12 550 字符，目录为空也先建目录再发送」：实测 12 549（51 字符路径），发送条件成立（`src/memdir/memdir.ts:474-489`）。
- prompt.md Q1「`# Environment` 约 810，其中 Claude 三行 549」：本仓库路径下实测 823 / 552，差别来自路径长度与计数方法，结论不变（T-CTX-05）。
- prompt.md Q6 / request-cache.md Q2「skills 清单为第一轮附件，预算为窗口 1%×4 字符（200K 时 8 000）」：成立（`getCharBudget(200000)` 实测 8 000）。补充：预算按显示宽度算（`stringWidth`，中日韩字符算 2），内置技能永不截短（`src/tools/SkillTool/prompt.ts:69-160`）。
- request-cache.md Q2「MCP 说明段每轮重算」：成立（`src/constants/prompts.ts:513-520`，增量开关非 ant 默认关，`src/utils/mcpInstructionsDelta.ts:26-33`）。
- prompt.md Q6 中 Codex 的「从项目根到 cwd 逐层收集、每层优先 `AGENTS.override.md`、合计 32 KiB、`# AGENTS.md instructions for <dir>` + `<INSTRUCTIONS>`」与 ZCode 的「离 cwd 最近的一个 + `~/.zcode/AGENTS.md`、每文件 100 KiB」：都成立，细节补在 T-CTX-01。

需要修正：

- prompt.md Q6 与 request-cache.md Q2「gitStatus 与 userContext 会话内只算一次」「会话中途修改 CLAUDE.md 直到压缩才送达」：准确说法是「每个 CLI 进程算一次」。桌面端在运行时选择（含 effort）变化和进出 bypass 模式时重启 CLI，重启后全部重算（T-CTX-06）；另外压缩后 userContext 重算，git 状态不重算（T-CTX-13）。
- prompt.md Q5 表「MEMORY.md 索引 200 行 / 25 000 字节」：DreamCoder 实际按 UTF-16 字符数比较（`src/memdir/memdir.ts:61`），与 ZCode 一样是字符（T-CTX-14）。
- prompt.md Q1「第一条 user 消息固定包装约 250 字符」：实测外层包装 290 字符（不含 CLAUDE.md 内容与日期），CLAUDE.md 前言另有 193 字符。
- prompt.md Q6「读取子目录文件时可能通过 `nested_memory` 附件补发该目录的 CLAUDE.md」：成立，但只由 Read 工具触发（`src/tools/FileReadTool/FileReadTool.ts:846,868,1036`），且进程内去重，CLI 重启后会重发。

需要补充：

- 压缩后哪些上下文重建：CLAUDE.md、`MEMORY.md`、日期（userContext 缓存清除，下次请求现拼）、system 各段（段缓存清除）、嵌套 CLAUDE.md 去重集合清空、计划与已调用技能、agent 清单与 MCP 增量公告（后两者在本场景关闭）、SessionStart(`compact`) 钩子（`src/services/compact/compact.ts:521-595`，`src/services/compact/postCompactCleanup.ts:42-74`）。丢失：技能清单（T-CTX-03）。不刷新：git 状态（T-CTX-13）。
- prompt.md Q6 表中 Codex 与 ZCode 的「MCP instructions：未核实」：Codex 把服务器 instructions 传给工具目录的列举函数（`codex:codex-mcp/src/connection_manager.rs:226-236`，`codex:codex-mcp/src/connection_manager/tool_catalog.rs:735`），最终呈现位置未核实；ZCode 在 `core/src/mcp` 与 `adapters/src` 中未找到读取服务器 instructions 的代码。

## 4. 已查无问题

- 指令文件的发现顺序与优先级（托管 → 用户 → 根到 cwd 各层 → `CLAUDE.local.md`，越近越后）与文件头注释一致（`src/utils/claudemd.ts:1-26,812-1013`）。
- 嵌套 worktree（`.claude/worktrees/<slug>`）不会把主仓库与 worktree 的同名项目文件读两遍（`src/utils/claudemd.ts:883-907`）。
- 用户级 CLAUDE.md、`rules/`、技能目录在 DreamCoder 目录不存在时继承 `~/.claude`（`src/utils/claudemd.ts:798-810`，`src/skills/loadSkillsDir.ts:648-652`），是有意的迁移设计。
- HTML 注释与 frontmatter 在注入前去掉（`src/utils/claudemd.ts:347-404`）；`@` 引用只接受文本扩展名、最多 5 层、防循环（`:100-230,541,622-635`）。
- 相关记忆召回（`relevant_memories`）在本场景关闭（`src/utils/attachments.ts:2347-2353`，`tengu_moth_copse` 默认 false），走索引模式，与记忆说明的写法一致。
- 「Searching past context」段受 `tengu_coral_fern` 控制，本场景不发（`src/memdir/memdir.ts:376`）。
- agent 清单在 Agent 工具描述里，工具 schema 按名字缓存，进程内不变（`src/utils/api.ts:136-142`），不会造成中途前缀变化。
- 输出风格与语言段：桌面端不设置，本场景为空（`src/constants/prompts.ts:502-507`）。
- 日期只在首条消息出现一次，跨天由 `date_change` 附件追加（归 T-INJ）。
- 技能清单在 `--resume` 时根据历史抑制重发（`src/utils/conversationRecovery.ts:395-401`），没有重复。
- 「Claude 模型名、Anthropic 直连」路径：本维度的加载机制与模型无关；只有 T-CTX-05 的三行文字应按模型区分。

## 5. 没有核实的地方

- T-CTX-02：安全检查返回的 `ask` 在 `bypassPermissions` 模式下是否仍弹窗；桌面端对这类请求的实际界面。
- T-CTX-03：CLI 重启后，压缩边界之前的 `skill_listing` 是否出现在恢复的消息里（决定重启后是否重发清单）。
- T-CTX-06：恢复时追加的 SessionStart 钩子消息是否写入 transcript（按 QueryEngine 的记录方式推断会写入）；重启导致的未命中没有实测计费数据。
- T-CTX-14：中文索引的 token 数为估算。
- Codex 子 agent 继承哪些上下文、Codex 的技能片段在压缩后是否随初始上下文重插（按 `codex:core/src/compact.rs:87-106` 推断是）。
- ZCode 的记忆写入在其权限系统下是否放行。
- 服务器传给 CLI 的 `--model` 是提供方真实模型 ID 还是别名（影响环境段的模型行），按 `conversationService.ts:974` 推断为真实 ID。

## 交给其他维度

- T-SYS：memory 说明段 12.5K 每个请求都发（加载条件已在本报告核实），其体量与措辞；`# Language` 段与「语言跟随用户」；桌面端宿主说明是否加入 system；身份句「You are a Claude agent」与环境段模型行的矛盾。
- T-TOOL：Skill 工具描述「Available skills are listed in system-reminder messages」在清单缺失时失效（与 T-CTX-03 相关）；`update-config` 技能正文中的 Claude Code 说法若按工具/技能正文处理。
- T-INJ：技能文件变化时 `resetSentSkillNames()` 清空已发送集合，下一轮重发完整清单而不是增量（`src/utils/skills/skillChangeDetector.ts:291`）；`date_change` 与 MCP instructions 中途变化的追加方式。
