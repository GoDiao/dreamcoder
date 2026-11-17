# A 维度：工具面（Codex CLI / ZCode / DreamCoder）

测量方法：三家的描述文本都从源码字符串字面量静态拼出（不运行任何项目代码），按本场景解析每个插值和条件分支后数字符。schema 大小只统计了 describe 文本并据此估算 JSON 总量，标为推断。

范围说明：Codex rust-v0.164.0 已删除 `wire_api = "chat"`（`codex:model-provider-info/src/lib.rs:102` 的报错文案；`codex:model-provider-info/src/lib.rs:109-113` 的 `WireApi` 只剩 `Responses`）。所以 Codex 在本场景只能接「OpenAI 兼容的 `/v1/responses` 端点」，不能接 chat-completions。下文 Codex 一列按「自定义 provider + Responses 端点 + 目录外模型（fallback 元数据）」描述。

---

## 1. 结论

1. **工具数量和描述体量差一个数量级。** DreamCoder 发 34 个工具，描述 63,692 字符，加 schema 约 82–86K 字符；ZCode 24 个，描述 21,544 字符，总量约 28–31K；Codex 12 个 function 工具加 1 个托管 `web_search`，描述约 7.4K 字符（另加 `spawn_agent` 里的模型列表），总量约 12–15K（推断）。
2. **DreamCoder 的长描述大部分是行为规程，不是参数说明。** 最大的 Bash（10,003）里 6,253 字符是 git 提交和 PR 的完整流程；Agent（6,992）里 1,815 是内联的 agent 列表；EnterPlanMode（4,022）是「主动进入计划模式」的规则和例子。ZCode 的 Bash 只有 1,121，Codex 的 `exec_command` 只有 82，shell 规则放在系统提示词里（`codex:models-manager/prompt.md:258-265`）。
3. **DreamCoder 有 13 个产品功能类工具（ShowUI、Kanban×4、会话×3、SendMessage、Artifact×2、Design×2），合计 21,265 字符（占描述的 33%），每个请求都发。** 它们由服务器对每个会话无条件打开的环境变量控制（`src/server/services/conversationService.ts:1052-1058`），4 个 artifact/design 工具根本没有开关。除 SendMessage 外都没有 `shouldDefer`，即使打开 ToolSearch 也不会被延迟。
4. **ZCode 的产品工具（8 个会话控制 + ListModels，6,434 字符）全部标了 `shouldDefer`，但 CLI 默认 `--toolsearch-mode off`，所以本场景照样全量发送。** Codex 的同类工具（goal、多 agent、图片生成、历史笔记、插件推荐）按 feature、模型目录、provider 能力和登录方式逐项决定是否注册。
5. **三家都有延迟加载机制，但只有 ZCode 的 local 模式能在普通 chat-completions 端点上用。** ZCode local 模式用 `LocalToolSearch` 返回 schema 文本，再经固定的 `DeferredToolCall` 调用，工具数组不变。DreamCoder 的 ToolSearch 依赖 Anthropic 的 `defer_loading` 和 `tool_reference`，非 Anthropic base URL 时直接关闭。Codex 的 `tool_search` 是 Responses API 的原生工具类型，并且只在模型目录标了 `supports_search_tool` 时启用，fallback 模型为 false。
6. **搜索：两家并入 shell，DreamCoder 单列工具。** Codex 没有读、搜索、写文件的工具，靠 `exec_command`，提示词要求用 `rg`；ZCode 默认走 embedded search 分支，不注册 Glob/Grep，搜索用 Bash 里的 `find`/`grep`；DreamCoder 有 Glob、Grep、Read、Write、Edit、NotebookEdit，Bash 描述再用 990 字符要求模型不要在 shell 里用这些命令。
7. **DreamCoder 把 Claude 专属文本发给非 Claude 模型。** 例如 Read 说「Claude Code is a multimodal LLM」；Bash 要求提交署名 `Co-Authored-By: Claude Opus 4.7`（非公开模型名回落值，`src/utils/attribution.ts:73-80`）；Agent 的 `model` 参数是 `sonnet/opus/haiku` 枚举；agent 列表里有「configure the user's Claude Code status line」。ZCode 的描述按模型能力改写（Read 只在模型支持 PDF 时加 PDF 句）；Codex 的工具集按模型目录字段决定。
8. **排序：三家的工具顺序都是确定的。** DreamCoder 按名字排序，并按会话缓存 schema；ZCode 对名单内工具按 en-US 排序，名单外按注册顺序，MCP 排最后；Codex 按代码里的注册顺序（`IndexMap`），托管工具排最后，再合并成 namespace。会话内会变的是 MCP 连接带来的增减；ZCode 的 native 模式和 DreamCoder 的 ToolSearch 在发现新工具后也会往数组里加工具。

---

## 2. 逐项对比

### Q1 完整清单

#### 1a 汇总

| | Codex | ZCode | DreamCoder |
|---|---|---|---|
| 发送的工具数 | 12 function + 1 托管 `web_search` | 24 | 34 |
| 描述字符合计 | 约 7.4K + 模型列表 | 21,544 | 63,692 |
| schema 估计（推断） | 5–7K | 6–9K | 18–22K |
| 工具块总量（推断） | 12–15K | 28–31K | 82–86K |
| 最长描述 | `spawn_agent` 约 4.2K | EnterPlanMode 4,011 | Bash 10,003 |
| 产品功能类工具 | 无（goal 工具 1.9K 算通用） | 9 个，6,434 | 13 个，21,265 |

按约 4 字符/token 粗算（推断），每个请求的工具块：DreamCoder 约 21K token，ZCode 约 7K，Codex 约 3–4K。

#### 1b DreamCoder（`--print`，服务器启动，本场景）

门控（逐项核对 `getAllBaseTools` 的候选和各工具的 `isEnabled`）：
- 流程：`src/tools.ts:203-272` `getAllBaseTools()` 产出候选 → `getTools()`（`src/tools.ts:292-348`）去掉 ListMcpResources/ReadMcpResource/SyntheticOutput，过滤 deny 规则和 `isEnabled()` → print 模式在 `src/cli/print.ts:1521-1549` 调 `assembleToolPool`（`src/tools.ts:366-388`）和 `mergeAndFilterTools`（`src/utils/toolPool.ts:55-79`）。
- 描述就是 `tool.prompt()`（`src/utils/api.ts:169-177`），代理原样转成 `function.description`/`parameters`（`src/server/proxy/transform/anthropicToOpenaiChat.ts:47-58`），不截断。
- 服务器给子进程设 `CLAUDE_CODE_ENABLE_TASKS=1`、ShowUI、SessionLinks、ArtifactEditLocks 开关（`src/server/services/conversationService.ts:1052-1058`）→ TodoWrite 关，TaskCreate/Get/Update/List 开（`src/utils/tasks.ts:133-139`）；ShowUI、StartSession、ListSessions、RenameSession、Kanban×4 开；SendMessage 开（`src/tools/SendMessageTool/SendMessageTool.ts:594-596`）。
- Glob/Grep：`hasEmbeddedSearchTools()` 要求 `EMBEDDED_SEARCH_TOOLS` 且入口不是 sdk-*（`src/utils/embeddedTools.ts:15-21`）；本场景入口被设成 `sdk-cli`（`src/main.tsx:510-533`），为假 → 两者都发。
- EnterWorktree/ExitWorktree：`isWorktreeModeEnabled()` 恒真（`src/utils/worktreeModeEnabled.ts:9-11`）。
- ArtifactCheck/ArtifactCopy/ChooseDesignTemplate/UseDesignSystem：没有自定义 `isEnabled`，用 `buildTool` 默认 true（`src/Tool.ts:758`）。
- 不发：TeamCreate/TeamDelete（只在设置里开 Agent teams 时注入环境变量，`src/server/services/agentTeamsEnv.ts:9-15`）；Brief（`feature('KAIROS')` 假，`src/tools/BriefTool/BriefTool.ts:126-131`）；WebSearch（非 Claude 模型名只有配 Tavily/Brave key 才开，`src/tools/WebSearchTool/backend.ts:65-110`）；ToolSearch（见 Q5）；所有 `USER_TYPE==='ant'` 和 `feature()` 工具。
- 条件附加：桌面端浏览器宿主已连接时，CLI 多一个 MCP 服务器 `dreamcoder-browser`（`src/server/browserHost/childEnv.ts:29-37`、`src/utils/browserControl/setup.ts:14-33`、`src/main.tsx:1598-1605`），15 个工具（`src/server/browserHost/names.ts:9-25`），描述未测；用户 MCP 和自定义 agent 也会增加。

| 工具 | 定义 | 描述字符 | 参数 | schema |
|---|---|---|---|---|
| Agent | `src/tools/AgentTool/prompt.ts:66-300` | 6,992 | 6 | 中（describe 约 550） |
| ArtifactCheck | `src/tools/ArtifactCheckTool/prompt.ts:3` | 871 | 1 | 小 |
| ArtifactCopy | `src/tools/ArtifactCopyTool/prompt.ts:3` | 608 | 1 | 小 |
| AskUserQuestion | `src/tools/AskUserQuestionTool/prompt.ts`（`ASK_USER_QUESTION_TOOL_PROMPT`） | 1,074 | 4 | 大（嵌套，describe 1,860） |
| Bash | `src/tools/BashTool/prompt.ts:275-369`，git 段 `:42-165` | 10,003 | 5 | 中（describe 1,012） |
| ChooseDesignTemplate | `src/tools/ChooseDesignTemplateTool/prompt.ts:5` | 914 | 4 | 中 |
| Edit | `src/tools/FileEditTool/prompt.ts` | 1,095 | 4 | 小 |
| EnterPlanMode | `src/tools/EnterPlanModeTool/prompt.ts:16-99` | 4,022 | 0 | 空 |
| EnterWorktree | `src/tools/EnterWorktreeTool/prompt.ts:1` | 1,335 | 1 | 小 |
| ExitPlanMode | `src/tools/ExitPlanModeTool/prompt.ts:6` | 1,849 | 1 | 小 |
| ExitWorktree | `src/tools/ExitWorktreeTool/prompt.ts:31` | 1,923 | 2 | 小 |
| Glob | `src/tools/GlobTool/prompt.ts:3` | 371 | 2 | 小 |
| Grep | `src/tools/GrepTool/prompt.ts:6` | 866 | 9 | 大（describe 1,622） |
| KanbanCreate | `src/tools/KanbanCreateTool/prompt.ts:6` | 1,334 | 7 | 中 |
| KanbanGet | `src/tools/KanbanGetTool/prompt.ts:5` | 685 | 2 | 小 |
| KanbanList | `src/tools/KanbanListTool/prompt.ts:5` | 592 | 2 | 小 |
| KanbanUpdate | `src/tools/KanbanUpdateTool/prompt.ts:8` | 4,774 | 1 | 大（`command` 是 15 个分支的 discriminated union，`src/entrypoints/sdk/controlSchemas.ts:768-846`；推断 JSON 4–5K） |
| ListSessions | `src/tools/ListSessionsTool/prompt.ts:6` | 471 | 1 | 小 |
| NotebookEdit | `src/tools/NotebookEditTool/prompt.ts:3` | 513 | 5 | 小 |
| Read | `src/tools/FileReadTool/prompt.ts:28-50` | 1,680 | 4 | 小 |
| RenameSession | `src/tools/RenameSessionTool/prompt.ts:3` | 259 | 1 | 小 |
| SendMessage | `src/tools/SendMessageTool/prompt.ts`（`getPrompt`） | 1,551 | 4 | 小 |
| ShowUI | `src/tools/ShowUITool/prompt.ts:6` | 6,505 | 7 | 中 |
| Skill | `src/tools/SkillTool/prompt.ts:173-196` | 1,272 | 2 | 小 |
| StartSession | `src/tools/StartSessionTool/prompt.ts:6` | 1,880 | 6 | 中 |
| TaskCreate | `src/tools/TaskCreateTool/prompt.ts`（`getPrompt`） | 2,146 | 4 | 小 |
| TaskGet | `src/tools/TaskGetTool/prompt.ts:3` | 732 | 1 | 小 |
| TaskList | `src/tools/TaskListTool/prompt.ts`（`getPrompt`） | 998 | 0 | 空 |
| TaskOutput | `src/tools/TaskOutputTool/TaskOutputTool.tsx:172-182` | 701 | 3 | 小 |
| TaskStop | `src/tools/TaskStopTool/prompt.ts:3` | 511 | 2 | 小 |
| TaskUpdate | `src/tools/TaskUpdateTool/prompt.ts:3` | 2,243 | 9 | 中 |
| UseDesignSystem | `src/tools/UseDesignSystemTool/prompt.ts:3` | 821 | 2 | 小 |
| WebFetch | `src/tools/WebFetchTool/WebFetchTool.ts:181-190` + `prompt.ts:3` | 1,479 | 2 | 小 |
| Write | `src/tools/FileWriteTool/prompt.ts:10` | 622 | 2 | 小 |

解析时用到的本场景取值：
- Bash：超时默认 120000、上限 600000（`src/utils/timeouts.ts:2-3`）；沙箱未启用，沙箱段为空（`src/tools/BashTool/prompt.ts:172-175`）；git 段默认包含（`src/utils/gitSettings.ts:13-18`）。
- Agent：fork 关（`src/tools/AgentTool/forkSubagent.ts:32-39`）；入口 sdk-cli 时内置 agent 是 general-purpose、statusline-setup、Explore、Plan、verification（`src/tools/AgentTool/builtInAgents.ts`）；列表内联（`tengu_agent_list_attach` 默认 false，`src/tools/AgentTool/prompt.ts:59-64`）；订阅类型不是 pro，所以带并发提示（`src/tools/AgentTool/prompt.ts:254-258`）。
- AskUserQuestion：入口 sdk-cli 时不设预览格式（`src/main.tsx:828-836`），不带 preview 段。
- EnterPlanMode：interview phase 关（`src/utils/planModeV2.ts:50-62`），带「What Happens in Plan Mode」段。
- Read：`includeMaxSizeInPrompt`/`targetedRangeNudge` 默认 undefined（`src/tools/FileReadTool/limits.ts:76-84`）；PDF 句只对 `claude-3-haiku` 关闭（`src/utils/pdfUtils.ts:59-61`），所以对 GLM 等模型也写着能读 PDF。
- Edit：compact 行号前缀开（`src/utils/file.ts:278-285`）。
- TaskCreate/TaskList：swarm 关，不带 teammate 段。
- Agent schema：`name/team_name/mode` 在 swarm 关时被删（`src/utils/api.ts:87-90`、`:163-167`），剩 6 个参数。

#### 1c ZCode（headless `--prompt`，`openai-chat-completions`，默认 `--toolsearch-mode off`）

门控：
- 注册入口 `zcode:core/src/tool/handlers/index.ts:232-345`（`registerBuiltInTools`），选项来自 `zcode:core/src/runtime/helpers/runtime-tools.ts:47-101`；`--prompt` 的 app 选项在 `zcode:cli/src/prompt-command.ts:243-275`：`standaloneSessionControl: true`，不传 automation、offPeak、pluginDiscovery、topicResource 端口，ToolSearch 模式默认 `"off"`（`zcode:cli/src/prompt-command.ts:82`）。
- 会话控制：独立 CLI 只注册共有的 8 个（`zcode:core/src/tool/handlers/index.ts:247-258`，定义 `zcode:core/src/tool/session-control/index.ts:80-170`）。
- Glob/Grep：embedded search 分支默认开（`zcode:core/src/embedded-search/capability.ts:4`），Bash 可用时不注册 Glob/Grep（`zcode:core/src/tool/handlers/index.ts:259-264`）。
- 动态工作流：独立 CLI 默认 `disabled`（`zcode:cli/src/workflow-mode.ts:10`），10 个工作流工具不注册；ListModels 因会话控制在场仍注册（`zcode:core/src/tool/handlers/index.ts:318-329`）。Agent 描述里的「必须用 CreateWorkflow」一行也随之删掉（`zcode:core/src/tool/handlers/index.ts:362-373`）。
- Task 是 Agent 的别名，`providerVisible: false`（`zcode:core/src/tool/handlers/agent.ts:331-345`），不发。
- SendMessage：默认 subagent 端口带 `sendMessage`（`zcode:core/src/subagent/runner.ts:718-746`），发。
- WebSearch：只在 `model.properties.supportsNativeWebSearch` 为真时发（`zcode:core/src/runtime/methods/config.ts:293-298`），而且只能编码成 Anthropic 原生工具，其他 provider 直接报错（`zcode:adapters/src/model/tool-transform.ts:250-280`）。本场景不发（推断：自定义模型该属性为 false；即使为 true 也无法编码）。
- 描述 = `metadata.description`，有 `modelInstructions` 时追加 `Usage:` 列表（`zcode:core/src/tool/registry.ts:104-142`）；个别工具按模型改写（`resolveModelContract`，`zcode:core/src/tool/model-contract.ts:20-33`）。

| 工具 | 定义 | 描述字符 | 参数 | schema | shouldDefer |
|---|---|---|---|---|---|
| Agent | `zcode:core/src/tool/handlers/agent.ts:92-122` | 1,371 | 约 5 | 小 | 否 |
| AskUserQuestion | `zcode:core/src/tool/handlers/ask-user-question.ts:20-45` | 1,785 | 1 | 中 | 否 |
| Bash | `zcode:core/src/tool/handlers/bash-prompt.ts:1-25` | 1,121 | 4 | 小 | 否 |
| Edit | `zcode:core/src/tool/handlers/edit.ts:53-59` | 360 | 4 | 小 | 否 |
| EnterPlanMode | `zcode:core/src/tool/handlers/plan-mode-prompts.ts:5-98` | 4,011 | 0 | 空 | 是 |
| ExitPlanMode | `zcode:core/src/tool/handlers/plan-mode-prompts.ts:102-` | 1,917 | 1 | 小 | 是 |
| Read | `zcode:core/src/tool/handlers/read.ts:68-79` | 736 | 3–4 | 小 | 否 |
| SendMessage | `zcode:core/src/tool/handlers/send-message.ts:17-28` | 509 | 3 | 小 | 是 |
| Skill | `zcode:core/src/tool/handlers/skill.ts:103-116` | 935 | 2 | 小 | 否 |
| TaskOutput | `zcode:contracts/src/tools/task-output.ts:12-24` | 1,049 | 3 | 小 | 是 |
| TaskStop | `zcode:core/src/tool/handlers/task-stop.ts:20-27` | 203 | 2 | 小 | 是 |
| TodoRead | `zcode:core/src/tool/handlers/todo.ts:74-79` | 34 | 0 | 空 | 是 |
| TodoWrite | `zcode:core/src/tool/handlers/todo.ts:130-141` | 370 | 1 | 小 | 否 |
| WebFetch | `zcode:core/src/tool/handlers/webfetch.ts:39-47` | 469 | 2 | 小 | 否 |
| Write | `zcode:core/src/tool/handlers/write.ts:37-41` | 240 | 2 | 小 | 否 |
| CreateSession / ForkSession / SendToSession / InterruptSession / RenameSession | `zcode:core/src/tool/session-control/index.ts:80-170`，Usage 指令 `:58-77` | 799 / 835 / 786 / 770 / 729 | 2–4 | 小 | 是 |
| ListSessions / ReadSession / WaitSessions | 同上 | 481 / 569 / 659 | 1–4 | 小 | 是 |
| ListModels | `zcode:core/src/tool/handlers/list-models.ts:38-45` | 806 | 0 | 空 | 是 |

合计 24 个、21,544 字符（确认早前「24 个」）。contracts 里 describe 文本合计约 2K（`zcode:contracts/src/tools/*.ts`），推断 JSON 6–9K。ListModels 描述提到 CreateWorkflow/AmendWorkflow，而这两个工具本场景不存在（`zcode:core/src/tool/handlers/list-models.ts:42`）。

#### 1d Codex（`codex exec`，自定义 provider，Responses 端点，fallback 元数据）

门控：
- fallback 元数据：`shell_type: UnifiedExec`、`apply_patch_tool_type: None`、`supports_search_tool: false`、`experimental_supported_tools` 为空、`multi_agent_version: None`、`tool_mode: None`（`codex:models-manager/src/model_info.rs:98-150`）。
- feature 默认值（`codex:features/src/lib.rs`）：ShellTool、UnifiedExec、ViewImage、Collab、Goals 开；MultiAgentV2、CodeMode、RequestPermissionsTool、DeferredExecutor、TokenBudget 关。
- 注册流程：`codex:core/src/tools/spec_plan.rs:121-188`（`build_tool_router`）→ `add_shell_tools`（`:1235-1266`）、`add_mcp_resource_tools`（`:1269-1284`，无 MCP 服务器时不加）、`add_core_utility_tools`（`:1287-1436`）、`add_collaboration_tools`（`:1439-1572`），再加扩展工具和托管工具。
- `update_plan`：要配置 `tools.update_plan.enabled` 才注册（`codex:core/src/config/mod.rs:2791-2797`），默认不发。但 fallback 提示词有整节说明这个工具（`codex:models-manager/prompt.md:52-121`、`:267-273`）。
- `apply_patch`：fallback 模型不声明（`codex:core/src/tools/spec_plan.rs:1409-1412`），但 `exec_command` 会拦截 shell 里的 `apply_patch` 调用（`codex:core/src/tools/handlers/unified_exec/exec_command.rs:358`、`codex:core/src/tools/handlers/apply_patch.rs:435-448`）；提示词要求用 `apply_patch` 改文件（`codex:models-manager/prompt.md:132`）。
- 多 agent：Collab 开、V2 关 → V1（`codex:core/src/config/mod.rs:1668-1676`），5 个工具放在 namespace `multi_agent_v1` 里（`codex:core/src/tools/handlers/multi_agents_spec.rs:14-15`）。fallback 模型 `supports_search_tool` 为 false，所以是 Direct 暴露（`codex:core/src/tools/spec_plan.rs:1538-1542`）。
- `request_user_input`：配置默认开（`codex:core/src/config/mod.rs:2783-2789`），但描述写明只在 Plan 模式可用（`codex:tools/src/tool_config.rs:6-15`、`codex:core/src/tools/handlers/request_user_input_spec.rs:123-128`）。
- goal：Goals 开，app-server 有 state_db 时安装扩展（`codex:app-server/src/extensions.rs:87-99`）。
- 托管 `web_search`：provider 能力默认 `web_search: true`（`codex:model-provider/src/capabilities.rs:19-27`），模式默认 Cached（`codex:core/src/config/mod.rs:3928-3929`），追加到列表末尾（`codex:core/src/tools/spec_plan.rs:687-716`）。
- 不发：图片生成（要 OpenAI 鉴权，`codex:core/src/tools/spec_plan.rs:783-818`）；history/notes 工具（要 Codex 后端登录，`codex:ext/history-notes/src/extension.rs:52`）；skills 扩展工具（要云端 skill 或选定能力根，`codex:ext/skills/src/preparation.rs:48-57`，推断默认不发）。
- `output_schema` 不序列化（`codex:tools/src/responses_api.rs:43-44`），只发 parameters。

| 工具 | 定义 | 描述字符 | 参数 | schema |
|---|---|---|---|---|
| exec_command | `codex:core/src/tools/handlers/shell_spec.rs:22-107` | 82 | 10 | 中（每个参数一句 describe） |
| write_stdin | `codex:core/src/tools/handlers/shell_spec.rs:110-150` | 80 | 4 | 小 |
| view_image | `codex:core/src/tools/handlers/view_image_spec.rs:16-50` | 124 | 1 | 小 |
| multi_agent_v1（namespace 描述） | `codex:core/src/tools/handlers/multi_agents_spec.rs:15` | 43 | — | — |
| spawn_agent | `codex:core/src/tools/handlers/multi_agents_spec.rs:70-106`、`:686-770` | 约 4,200 + 模型列表 | 约 5 | 中 |
| send_input / resume_agent / wait_agent / close_agent | `codex:core/src/tools/handlers/multi_agents_spec.rs:166-360` | 215 / 89 / 252 / 298 | 1–3 | 小 |
| request_user_input | `codex:core/src/tools/handlers/request_user_input_spec.rs:16-128` | 120 | 1 | 中（嵌套） |
| get_goal / create_goal / update_goal | `codex:ext/goal/src/spec.rs:15-100` | 122 / 265 / 1,541 | 0 / 2 / 1 | 小 |
| web_search（托管） | `codex:tools/src/tool_spec.rs:37-52` | 无描述 | — | — |

合计 12 个 function 工具 + 托管 `web_search`，描述约 7.4K 字符加 `spawn_agent` 的模型列表（列表长度取决于目录里 picker 可见的模型，未核实）。

### Q2 能力与工具对照

| 能力 | Codex | ZCode | DreamCoder |
|---|---|---|---|
| 执行命令 | `exec_command` + `write_stdin`（PTY 会话） | Bash | Bash |
| 读文件 | 并入 shell | Read | Read |
| 搜索 | 并入 shell，提示词要求 `rg`（`codex:models-manager/prompt.md:264`） | 并入 Bash 的 `find`/`grep`（Glob/Grep 不注册） | Glob、Grep |
| 编辑 | shell 里的 `apply_patch`，被拦截执行 | Edit（ApplyPatch 注释掉了，`zcode:core/src/tool/handlers/index.ts:96`） | Edit |
| 写文件 | 同上 | Write | Write |
| Notebook | 并入 shell | 无 | NotebookEdit |
| 网页抓取 | 无工具，靠 shell | WebFetch | WebFetch |
| 网页搜索 | 托管 `web_search`（provider 能力） | 只有 Anthropic 原生，本场景无 | 只有配 Tavily/Brave key 才有，本场景无 |
| 问用户 | `request_user_input`（仅 Plan 模式） | AskUserQuestion | AskUserQuestion |
| 计划模式 | 协作模式，由用户切换，无工具 | EnterPlanMode/ExitPlanMode（deferred） | EnterPlanMode/ExitPlanMode |
| 任务清单 | `update_plan`（默认不注册） | TodoWrite、TodoRead | TaskCreate/Get/Update/List |
| 目标 | get/create/update_goal | 无 | 无 |
| 子代理 | `multi_agent_v1` 下 5 个工具 | Agent + SendMessage | Agent + SendMessage |
| 后台进程 | `exec_command` 返回 session_id，`write_stdin` 轮询 | Bash `run_in_background` + TaskOutput/TaskStop | Bash `run_in_background` + TaskOutput/TaskStop |
| Skills | 无工具；列表在提示词里，用 shell 读（推断） | Skill | Skill |
| 会话控制 | 无 | 8 个会话工具 + ListModels | StartSession、ListSessions、RenameSession、SendMessage |
| Worktree | 无 | 无 | EnterWorktree、ExitWorktree |
| MCP | 有服务器时加资源工具和 MCP 工具；模型支持时可 deferred | MCP 工具，ToolSearch 开时 deferred | MCP 工具，ToolSearch 开时 deferred（本场景关） |
| 图片 | `view_image` | Read（也读视频） | Read |
| 产品专属 | 无 | 会话控制、ListModels | ShowUI、Kanban×4、Artifact×2、Design×2、会话×3 |

### Q3 DreamCoder 的长描述拆解，以及另两家对应写在哪

**Bash（10,003）**

| 内容 | DreamCoder | ZCode Bash（1,121） | Codex |
|---|---|---|---|
| 开头 + 「别在 shell 里用 find/grep/cat…，用专用工具」列表 | 990 | 一句「Avoid using this tool to run …」（不含 find/grep） | 无；提示词反过来要求用 `rg`（`prompt.md:264`） |
| 指令（mkdir 前 ls、引号、cwd、超时、后台、多命令、git 三条、sleep 七条） | 2,756 | 五条短句（cwd、超时、后台、输出不一定给用户看） | `exec_command` 参数 describe；提示词 Shell 节 |
| git 提交完整流程（安全协议、四步并行、HEREDOC 示例、署名） | 4,216 | 「# Git」三行：交互 flag 不支持、用 gh、用户要求才提交 | 提示词两行：用 git log/blame、不提交不建分支（`prompt.md:141-144`） |
| PR 完整流程 | 2,037 | 无 | 无 |

**Agent（6,992）**

| 内容 | DreamCoder | ZCode Agent（1,371） | Codex `spawn_agent`（约 4.2K） |
|---|---|---|---|
| 介绍 | 约 380 | 约 260 | 一行 |
| agent 列表 | 1,815（内联） | 不在描述里，放 system-reminder 消息（`agent.ts:99`） | 放 `agent_type` 参数 describe |
| 何时不用 | 520 | 一段「何时用」约 400 | 「没有明确要求不要派生」两段 |
| 使用说明（并发、后台、SendMessage 续接、worktree 隔离…） | 约 2,250 | 4 条约 600 | 「委派 vs 自己做」「设计子任务」「委派后」「并行模式」四节约 3.4K |
| 怎么写 prompt | 1,028 | 无 | 并入上面 |
| 示例 | 1,002 | 无 | 无 |

**EnterPlanMode（4,022）**：开头 326（要求「proactively」使用）、何时用 1,750、何时不用 343、计划模式里做什么 369、例子 927、注意事项 302。ZCode 是几乎相同的 4,011 字符（`plan-mode-prompts.ts:5-98`），区别是标了 `shouldDefer`。Codex 没有这个工具：计划模式是用户切换的协作模式，模型侧只有 `request_user_input` 写着「只在 Plan 模式可用」。

**ExitPlanMode（1,849）**：工作方式 401、何时用 308、使用前 443、例子 567。ZCode 1,917，内容相近。Codex 无。

**ShowUI（6,505）**：何时用 708、调用协议（同一个工具的不同输入）886、强制步骤 609、组件清单和选择规则 1,431、operations 775、revision 规则 447、布局尺寸 348、中文目录说明 241、其他约 1,060。另两家没有对应工具（ZCode 有 visualize 插件，headless 默认未加载，未核实）。

**Kanban（合计 7,385）**：KanbanUpdate 4,774 里，按角色（owner / owner 或 creator / reviewer / creator）写的权限和流程约 3,200，其余是通用规则和文本长度约束；Create 1,334、Get 685、List 592。另两家没有。

**Task×4（合计 6,119）**：TaskCreate 2,146（何时用 807、何时不用 430、字段 401、技巧 228）；TaskUpdate 2,243（何时用 961、字段 583、例子 431）；TaskList 998；TaskGet 732。ZCode 是 TodoWrite 370 + TodoRead 34。Codex 的 `update_plan` 默认不注册，计划规则写在提示词 Planning 节（`prompt.md:52-121`，3,061 字符）。

**AskUserQuestion（1,074 描述 + 1,860 schema describe）**：用途 282、使用说明 292、计划模式说明 496。ZCode 1,785，多了「只在被一个必须由用户决定的问题卡住时才用」一段和 preview 说明。Codex `request_user_input` 描述 120，选项规则写在 schema describe 里（2–3 个选项、推荐项放第一个）。

**Read（1,680）**：开头 290；用法 1,388，其中有图片（「Claude Code is a multimodal LLM」）、PDF、notebook、截图、目录、空文件各一条。ZCode 736，PDF 句只在模型支持 PDF 时加（`read-pdf.ts:69-80`）。Codex 没有读文件工具，图片用 `view_image`（124）。

### Q4 产品功能类工具

DreamCoder：

| 工具 | 字符 | 开关 | 不用该功能的会话里会不会用到 |
|---|---|---|---|
| ShowUI | 6,505 | `DREAMCODER_SHOW_UI`，服务器总设 | 用户随口要求「画个图」时会用 |
| KanbanUpdate / Create / Get / List | 4,774 / 1,334 / 685 / 592 | `isSessionLinksEnabled()`，服务器总设 | 只在会话关联了卡片或用户问看板时 |
| StartSession | 1,880 | 同上 | 用户要求另开会话时 |
| SendMessage | 1,551 | 同上（或 agent teams） | 回复其他会话发来的 `<cross-session-message>`、续接子 agent 时要用 |
| ListSessions / RenameSession | 471 / 259 | 同上 | 用户要求改名时 |
| ArtifactCheck / ArtifactCopy | 871 / 608 | 无开关 | 只在 artifact 流程里 |
| ChooseDesignTemplate / UseDesignSystem | 914 / 821 | 无开关 | 只在 design/slides skill 里（描述自己写着「Use this in the design or slides skill」） |

合计 21,265 字符，每个请求都发。开关位置：`src/server/services/conversationService.ts:1052-1058` 对每个会话无条件设置；ArtifactCheck 等 4 个工具用 `buildTool` 默认 `isEnabled: true`。除 SendMessage 外，这些工具都没有 `shouldDefer`（全仓 `shouldDefer: true` 只出现在 Ask/Plan/Worktree/Notebook/Task*/SendMessage/WebFetch/WebSearch/Team*/MCP 资源等工具上），所以即使 ToolSearch 打开也照样全量发送。

ZCode 的决定方式：
- 会话控制：只有可信启动绑定给了 `sessionControlKind` 才注册，并按 cli/app 选不同变体（`zcode:core/src/tool/handlers/index.ts:240-258`）。
- Cron、OffPeak、插件发现、话题资源：以宿主注入的端口是否存在为门（`zcode:core/src/tool/handlers/index.ts:288-317`、`zcode:core/src/runtime/helpers/runtime-tools.ts:73-90`）。
- 动态工作流：灰度门或 `--workflow-mode`，同时管工具和描述里的引用（`zcode:core/src/tool/handlers/index.ts:308-329`、`:362-373`）。
- node_repl：由 browser-use 插件推导的 runtime feature 决定（`zcode:core/src/tool/handlers/index.ts:330-332`）。
- 这些工具都标 `shouldDefer`；ToolSearch 打开时只留名字。

Codex 的决定方式：feature 开关（Goals、Collab、ToolSuggest+Apps+Plugins）、模型目录字段（`experimental_supported_tools`、`supports_search_tool`、`apply_patch_tool_type`）、provider 能力（`web_search`、`image_generation`）、登录方式（图片生成、history/notes 要 OpenAI/Codex 后端鉴权）、配置（`tools.update_plan`）。见 `codex:core/src/tools/spec_plan.rs:718-818`、`:1287-1436`。

### Q5 延迟加载机制

| | Codex | ZCode | DreamCoder |
|---|---|---|---|
| 机制 | `tool_search`（Responses 原生工具类型）+ `defer_loading` + `tool_search_output` 条目带回工具定义 | native：`ToolSearch` + `defer_loading`；local：`LocalToolSearch` 返回 schema 文本 + `DeferredToolCall({name,input})` | `ToolSearch` + `defer_loading` + `tool_result` 里的 `tool_reference` 块 |
| 启用条件 | 模型目录 `supports_search_tool` 且有 deferred 工具（`spec_plan.rs:393-417`） | `--toolsearch-mode auto/native/local`，默认 off（`zcode:core/src/tool/search/exposure.ts:18-35`） | `ENABLE_TOOL_SEARCH` 未设时默认 tst，但 base URL 不是 Anthropic 就关（`src/utils/toolSearch.ts:270-312`） |
| 本场景 | 关（fallback `supports_search_tool: false`） | 关（默认 off） | 关 |
| 需要 provider 支持吗 | 需要 Responses API 支持 `tool_search` 类型和 `tool_search_output` 条目（`codex:tools/src/tool_spec.rs:27-32`） | native 需要 Anthropic Messages（`exposure.ts:24-27`）；local 只要求模型支持 tool call（`exposure.ts:31-33`） | 需要 Anthropic 的 tool search beta：接受 `defer_loading` 字段，并在服务端展开 `tool_reference` |
| 任意 chat-completions 端点能否用 | 不能（整个 Codex 都不能接 chat） | local 能 | 不能 |
| 发现后工具数组 | 不变（定义通过对话条目送入） | local 不变（`exposure.ts:107-116`，deferred 工具始终不进数组，压缩后才提升）；native 会加 | 会加：已发现的工具下一请求加入数组（`src/services/api/claude.ts:1196-1212`） |

DreamCoder 关闭的确切原因：`isToolSearchEnabledOptimistic()` 在 `ENABLE_TOOL_SEARCH` 未设、`getAPIProvider()==='firstParty'`、`!isFirstPartyAnthropicBaseUrl()` 时返回 false（`src/utils/toolSearch.ts:297-310`），注释说明第三方网关通常不接受 `tool_reference` 块会 400。本场景 base URL 是本地代理，服务器不设 `ENABLE_TOOL_SEARCH`。

如果强行设 `ENABLE_TOOL_SEARCH=true` 走代理（推断，基于代码路径）：CLI 端会只发未延迟的工具和已发现的工具（`src/services/api/claude.ts:1174-1212`），这部分逻辑在客户端；但代理把 `tool_result` 里的 `tool_reference` 块转成 `[omitted content: tool_reference]`（`src/server/proxy/transform/toolArguments.ts:29-48`），`defer_loading` 字段被丢掉（`anthropicToOpenaiChat.ts:47-58` 只取 name/description/input_schema）。模型看不到搜索结果里的 schema，只能等下一请求工具出现在数组里；每次发现都改变工具数组，影响前缀缓存。另外 DreamCoder 的 deferred 集合在本场景里约 21.1K 字符（Ask、Plan×2、Worktree×2、Notebook、SendMessage、Task×6、WebFetch），12 个产品工具（约 19.7K）不在其中。

Codex 的 namespace（`multi_agent_v1`）和 code mode：namespace 是 Responses API 的 `type: "namespace"` 工具（`codex:tools/src/tool_spec.rs:25-26`），由 `merge_into_namespaces` 合并（`spec_plan.rs:1104-1130`），第三方 Responses 端点是否接受未核实。code mode（把工具包进一个 JS 执行工具）由 `Feature::CodeMode`（默认关）或模型目录 `tool_mode` 打开，fallback 为 None，本场景关。

### Q6 工具顺序和会话内稳定性

| | Codex | ZCode | DreamCoder |
|---|---|---|---|
| 排序规则 | 注册顺序（`IndexMap`，`codex:core/src/tools/registry.rs:330-331`），托管工具追加在后，再合并 namespace（`spec_plan.rs:628-656`） | 固定名单内按名字排（固定 en-US locale），名单外按注册顺序，MCP 按名字排在最后（`zcode:core/src/tool/provider-visible-order.ts:41-66`） | 内置按名字 `localeCompare`，MCP 按名字排在后（`src/tools.ts:383-387`、`src/utils/toolPool.ts:65-70`） |
| 重建频率 | 每轮重建 router（`codex:core/src/session/turn.rs:1977`），输入相同则结果相同 | 缓存到工具集变化（`config.ts:140-163`） | 每请求组装；描述和 schema 按会话缓存（`src/utils/api.ts:136-152`） |
| 会话内会变的情况 | MCP 增减 | MCP 增减；native 模式发现工具 | MCP 增减；ToolSearch 发现工具（本场景关）；Agent 描述依赖 agent 列表，但被会话缓存固定 |
| 描述是否随会话状态变化 | 否（推断） | 否；按模型能力投影一次 | 否（会话缓存）；DreamCoder 的 locale 未固定（`localeCompare` 不带 locale），ZCode 修过这个问题（`provider-visible-order.ts:60-62`） |

---

## 3. 对 DreamCoder 的含义

### DreamCoder 有、另两家都没有的

事实：
- **工具描述里的 git 提交和 PR 流程**，6,253 字符，每个请求都发。ZCode 的 Bash 只写三行 git 规则；Codex 在提示词里写两行。
- **13 个产品功能类工具**，21,265 字符，由服务器无条件打开，4 个无开关；除 SendMessage 外都不在 deferred 集合里。
- **agent 列表内联在 Agent 描述里**，1,815 字符；ZCode 放 system-reminder 消息，Codex 放参数 describe。
- **Glob、Grep、NotebookEdit、Task×4、Worktree×2 这些细分工具**，加上 Bash 里约 1K 字符告诉模型别用 shell 做这些事。两家都把搜索并入 shell。
- **发给非 Claude 模型的 Claude 专属文本**：Read 的「Claude Code is a multimodal LLM」和 PDF 说明、Bash 的 `Co-Authored-By: Claude Opus 4.7`、Agent 的 `sonnet/opus/haiku` 枚举、statusline-setup agent。
- **KanbanUpdate 的 15 分支 union schema**（约 4–5K 字符）。

后果：
- token（事实 + 推断）：工具块约 82–86K 字符，约 21K token（4 字符/token 推断），是 ZCode 的 3 倍左右、Codex 的 6 倍左右。按每个任务几十个请求算，仅工具定义就是几十万到上百万 input token（推断）。缓存命中时按缓存价计；C 维度报告的计费头问题如果让前缀缓存失效，这部分每次按全价计。
- 轮数（推断）：EnterPlanMode 和 TaskCreate 的描述都要求「proactively」使用，headless 编码任务里可能多出进入/退出计划模式和逐步更新任务的调用；Codex 默认不给计划工具，ZCode 在 ToolSearch 开时把计划工具延迟。
- 可靠性（推断）：工具多、名字相近（TaskCreate/TaskUpdate 与 TaskOutput/TaskStop，SendMessage 与 StartSession）、union schema 大，非原生模型选错工具或构造错参数的机会更多；Claude 专属文本可能让模型写出错误的署名或误判自己能读图和 PDF。

### 另两家都有、DreamCoder 没有的

事实：
- **按运行时能力决定工具集。** Codex 按模型目录字段、provider 能力、鉴权；ZCode 按宿主注入的端口、可信绑定和模型属性。DreamCoder 的开关是服务器对每个会话都打开的环境变量，与本会话是否用到这些功能无关；模型相关的判断只有 WebSearch（看模型名像不像 Claude）和 PDF（只排除 `claude-3-haiku`）。
- **搜索并入 shell。** Codex 用 `rg`，ZCode 用 embedded `find`/`grep`。
- **短的 shell 工具描述**：82 和 1,121 字符，对比 10,003。
- **长的行为规程不放在工具描述里，或放在可以延迟的工具上。** Codex 放在系统提示词；ZCode 把计划模式、会话控制、TaskOutput/TaskStop 等标为 `shouldDefer`。

后果：
- token（事实）：同类能力，DreamCoder 在工具定义上花的字符明显更多，而且没有一种在本场景下可用的手段把不用的工具移出请求。
- 在非原生模型上（推断）：只有 ZCode 的 local 模式证明了延迟加载可以在普通 chat-completions 端点上工作，并保持工具数组不变（对前缀缓存友好）。DreamCoder 已有客户端侧的过滤逻辑，缺的是代理对 `tool_reference` 的转换，以及把产品工具纳入 deferred 集合。这里只陈述差异，不提方案。

---

## 4. 没有核实的地方

- DreamCoder 浏览器 MCP（`dreamcoder-browser`，15 个工具）的描述长度未测；它只在桌面端浏览器宿主已连接时出现（`src/server/browserHost/childEnv.ts:14-27`）。
- DreamCoder 自定义 agent、插件 agent 会让 Agent 描述变长，未计入。
- 三家的 schema JSON 大小都是根据 describe 文本和字段数推断的，没有生成真实 JSON。
- ZCode：自定义模型的 `supportsNativeWebSearch` 默认值未核实（只确认了就算为真也无法在 chat-completions 上编码）；headless 下随 CLI 加载的内置插件是否带工具或 MCP 未核实；Agent 参数个数是估计。
- Codex：`spawn_agent` 描述里的模型列表长度未核实（取决于目录中 picker 可见的模型）；goal 工具依赖 app-server 有 state_db，`codex exec` 路径下是否总有 state_db 未逐行核实；skills 扩展工具默认不发是推断；第三方 Responses 端点是否接受 `namespace` 类型工具和托管 `web_search` 未核实。
- 「每个任务几十个请求」与 token 换算（4 字符/token）是推断，没有实测。
