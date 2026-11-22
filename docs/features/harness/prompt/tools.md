# 文字层评审：工具描述（T-TOOL）

范围：发给模型的工具定义（description、input schema 里的参数描述、枚举、示例），工具执行后自己返回的固定文字（成功结果、错误、截断、空结果、工具代码里的权限文字），延迟加载和 ToolSearch 相关文字，MCP 工具描述的处理。系统提示词各段、上下文加载、harness 在工具结果之外追加的提醒不在本报告范围，见末尾「交给其他维度」。

场景：桌面端服务器以 `--print` stream-json 启动 CLI（`src/server/services/conversationService.ts:142-157`），默认权限模式 `--permission-mode default`（`src/server/services/permissionModes.ts:16-22`）；子进程环境由 `buildChildEnv` 设置 `CLAUDE_CODE_ENABLE_TASKS=1`、`DREAMCODER_SHOW_UI=1`、`DREAMCODER_SESSION_LINKS=1`、`DREAMCODER_ARTIFACT_EDIT_LOCKS=1`（`conversationService.ts:1052-1058`），浏览器宿主已连接时加浏览器 MCP 的地址和令牌（`conversationService.ts:1068`；`src/server/browserHost/childEnv.ts:15-37`）。模型是经 OpenAI 兼容端点接入的第三方模型，CLI 的 `ANTHROPIC_BASE_URL` 指向本地代理（`src/server/services/providerRuntimeEnv.ts:213-216`），代理格式 `openai_chat`。`USER_TYPE` 不是 `ant`，`feature()` 全为 false，GrowthBook 关闭，agent teams 设置关（`src/server/services/agentTeamsEnv.ts:13-14`）。另看了「Claude 模型名、Anthropic 直连」这条路径，只在文字应当随模型不同时写出。

路径约定：DreamCoder 路径相对仓库根，读的是 `main` 干净检出（`ce209f69`）；`codex:` 相对 `refs/coding-agents/codex/codex-rs`（`rust-v0.164.0`）；`zcode:` 相对 ZCode 仓库根（`fec97590`）。

测量方法：
- 用 bun 1.4.2 在 scratchpad 写脚本 `measure.ts`，从 `main` 检出导入 `getTools`（`src/tools.ts:292-345`）、`toolToAPISchema`（`src/utils/api.ts:119-200`）、`getBuiltInAgents` 和代理的 `cleanToolSchema`（`src/server/proxy/transform/toolSchema.ts:1-23`），按上面的环境变量运行（`CLAUDE_CONFIG_DIR`、`DREAMCODER_CONFIG_DIR` 指向空目录，`CLAUDE_CODE_ENTRYPOINT=sdk-cli`，`ANTHROPIC_BASE_URL=http://127.0.0.1:3456/proxy`，`ANTHROPIC_MODEL=glm-4.6`）。描述字符 = `description.length`；schema 字符 = 代理清理后的 `parameters` 做 `JSON.stringify` 的长度；工具数组 = 代理发出的 `tools` 数组（`{type:'function', function:{name, description, parameters}}`，`src/server/proxy/transform/anthropicToOpenaiChat.ts:47-58`）整体 `JSON.stringify` 的长度。
- 同一脚本以 `plan` 权限模式再跑一次（工具集和文字完全相同），以 `claude-sonnet-4-5` + `https://api.anthropic.com` 跑一次看直连路径。
- 浏览器 MCP 的 15 个工具：导入 `src/server/browserHost/tools.ts` 的定义，用仓库 zod 的 `toJSONSchema(io:'input')` 生成 schema 再过 `cleanToolSchema`。MCP SDK 实际生成的 schema 可能有字段顺序或少量关键字差异（推断，差别在百字符量级）。
- ShowUI 的 catalog 和 describe 结果：导入 `src/utils/uiPages.ts` 的 `listUiPageComponents`、`describeUiPageKinds` 取输出计数。
- 字符换 token 一律按约 4 字符/token 粗算，标为推断。Codex、ZCode 的体量沿用 `comparison/tools.md` 的静态计数，本次只抽查了引用到的段落，没有重测总量。

## 本场景发送的工具与逐个结论

服务器场景共 34 个内置工具，描述 63,689 字符，schema 25,582 字符，代理发出的工具数组 93,221 字符（约 23K token，推断），每个请求都发。桌面端浏览器宿主连上时再加 15 个浏览器 MCP 工具（描述 7,544，schema 7,948），合计约 108.7K 字符。ToolSearch 在本场景关闭（`src/utils/toolSearch.ts:297-310`），标 D 的工具也照样全量发送。

| 工具 | 描述 | schema | D | 结论 |
|---|---|---|---|---|
| Agent | 6,992 | 945 | | T-TOOL-01、08、10、17 |
| ArtifactCheck | 871 | 200 | | 文字本身无问题；常驻发送见 T-TOOL-02 |
| ArtifactCopy | 608 | 191 | | 同上，T-TOOL-02 |
| AskUserQuestion | 1,074 | 2,966 | D | T-TOOL-11、19 |
| Bash | 10,004 | 1,371 | | T-TOOL-03、07、14、20 |
| ChooseDesignTemplate | 914 | 784 | | T-TOOL-02 |
| Edit | 1,095 | 495 | | T-TOOL-14、21 |
| EnterPlanMode | 4,022 | 62 | D | T-TOOL-08、09 |
| EnterWorktree | 1,335 | 292 | D | T-TOOL-13 |
| ExitPlanMode | 1,849 | 543 | D | T-TOOL-09、20 |
| ExitWorktree | 1,923 | 424 | D | T-TOOL-13 |
| Glob | 371 | 482 | | 无问题（见第 4 节） |
| Grep | 866 | 2,385 | | T-TOOL-14（重复规则）；其余无问题 |
| KanbanCreate | 1,334 | 463 | | T-TOOL-02 |
| KanbanGet | 685 | 302 | | T-TOOL-02 |
| KanbanList | 592 | 405 | | T-TOOL-02 |
| KanbanUpdate | 4,774 | 4,357 | | T-TOOL-02；schema 兼容性见第 5 节 |
| ListSessions | 471 | 173 | | T-TOOL-02 |
| NotebookEdit | 513 | 883 | D | 无问题 |
| Read | 1,680 | 629 | | T-TOOL-04、12 |
| RenameSession | 259 | 169 | | T-TOOL-02 |
| SendMessage | 1,551 | 1,418 | D | T-TOOL-01、15 |
| ShowUI | 6,505 | 1,224 | | T-TOOL-02、06 |
| Skill | 1,272 | 258 | | T-TOOL-18 |
| StartSession | 1,880 | 954 | | T-TOOL-02、19 |
| TaskCreate | 2,146 | 516 | D | T-TOOL-08、16 |
| TaskGet | 732 | 157 | D | T-TOOL-16 |
| TaskList | 998 | 62 | D | T-TOOL-16 |
| TaskOutput | 701 | 375 | D | T-TOOL-16、19 |
| TaskStop | 511 | 220 | D | T-TOOL-16 |
| TaskUpdate | 2,243 | 1,038 | D | T-TOOL-16 |
| UseDesignSystem | 821 | 290 | | T-TOOL-02 |
| WebFetch | 1,479 | 258 | D | 描述无问题；权限询问文字交给 T-INJ |
| Write | 618 | 291 | | T-TOOL-14 |
| `mcp__dreamcoder-browser__*`（15 个） | 7,544 | 7,948 | | T-TOOL-05、22 |

不在本场景发送的：TodoWrite（Task V2 打开后关闭，`src/utils/tasks.ts:133-139`）、WebSearch（非 Claude 模型名且未配 Tavily/Brave，`src/tools/WebSearchTool/backend.ts:65-110`）、ToolSearch、TeamCreate/TeamDelete（agent teams 关）、Brief（`feature('KAIROS')`）、PowerShell（只在 Windows 且显式开启，`src/utils/shell/shellToolUtils.ts:17-22`）、LSP（`ENABLE_LSP_TOOL` 未设）、所有 `USER_TYPE==='ant'` 和 `feature()` 工具、ListMcpResources/ReadMcpResource（`getTools` 去掉，`src/tools.ts:322-328`）。Claude 直连路径多出 ToolSearch（962 + 349）和 WebSearch（1,321 + 411），14 个 D 工具改为按需加载。

---

## 1. 发现清单

### T-TOOL-01 Agent 的描述和每次结果都让模型用 SendMessage 续接子 agent，但 SendMessage 在本场景只接受 `session:<id>`，这类调用必然被拒

- 状态：已修复（#298）：SendMessage 在 agent teams 关闭时接受格式合法的子 agent id 和已登记的后台 agent 名字；结构化消息、teammate 名字和 `*` 仍要求打开 agent teams。
- 类型：问题
- 严重程度：高
- 体量：Agent 描述里一句约 190 字符（每个请求）；Agent 结果尾注约 70 字符加 agentId（每次非 Explore/Plan 的同步完成和每次后台启动都出现）；被拒后多一轮。
- 现状（按执行顺序）：
  1. agent teams 设置默认关，服务器不设 `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS`（`src/server/services/agentTeamsEnv.ts:13-14`），`isAgentSwarmsEnabled()` 返回 false（`src/utils/agentSwarmsEnabled.ts:32-36`）。
  2. Agent 描述写着「To continue a previously spawned agent, use SendMessage with the agent's ID or name as the `to` field. The agent resumes with its full context preserved.」（`src/tools/AgentTool/prompt.ts:267`），没有按 agent teams 开关裁剪。
  3. 后台启动的结果写「Use SendMessage with to: '<agentId>' to continue this agent.」（`src/tools/AgentTool/AgentTool.tsx:1336`）；同步完成的结果尾注写「use SendMessage with to: '<agentId>' to continue this agent」（`AgentTool.tsx:1379`），只有 Explore、Plan 两种一次性 agent 省略（`AgentTool.tsx:1362-1370`；`src/tools/AgentTool/constants.ts:9`）。
  4. SendMessage 因 Session Links 打开而注册（`src/tools/SendMessageTool/SendMessageTool.ts:594-596`），它自己的描述只讲会话地址（`src/tools/SendMessageTool/prompt.ts:46-50`），`to` 参数描述是「"session:<id>" for another session」（`SendMessageTool.ts:56-58`）。
  5. `validateInput` 在 agent teams 关闭时拒绝一切非 `session:` 地址，返回「to must be a session address: "session:<id>"」（`SendMessageTool.ts:656-662`）。按 agentId 续接子 agent 的路由在 `call()` 里（`SendMessageTool.ts:779-850`），永远走不到。
- 场景：用户让 general-purpose agent 调研一个模块，读完结果后说「让它再查一下错误处理」。模型照 Agent 结果尾注调用 `SendMessage({to:"a1b2c3", message:"..."})`，收到 `<tool_use_error>to must be a session address...`。模型要么重新起一个 Agent（前一个 agent 的上下文全部丢失，重复读文件），要么用 `session:a1b2c3` 再试一次（同样失败或发到不存在的会话）。至少多一轮，续接功能实际不可用。
- 参考：Codex 用专门的 `send_input`/`resume_agent`，不复用会话消息工具（`codex:core/src/tools/handlers/multi_agents_spec.rs:166-360`）。ZCode 的 SendMessage 描述明确接受 `agentId` 并说明会在后台续接（`zcode:apps/zcode-cli/packages/core/src/tool/handlers/send-message.ts:17-27`），Agent 描述也这样写（`zcode:apps/zcode-cli/packages/core/src/tool/handlers/agent.ts:109`），两边一致。
- 改法方向：二选一，并让三处文字一致：要么让 SendMessage 在 agent teams 关闭时也接受本会话子 agent 的 id（放宽 `validateInput`，`to` 描述和 SendMessage 描述补一句子 agent 续接）；要么在 agent teams 关闭时删掉 Agent 描述里的这句和两处结果尾注里的 SendMessage 提示。
- 确定程度：代码确认（未实际运行一次续接调用）

### T-TOOL-02 13 个产品功能工具（约 32K 字符）每个请求都发，同步子 agent 的请求也带其中 9 个

- 类型：优化
- 严重程度：高
- 体量：描述 21,265 + schema 10,930 = 32,195 字符，占主请求工具数组的 35%，每个请求都发；Explore 和 general-purpose 子 agent 的每个请求另带 ShowUI、Kanban×4、ListSessions、SendMessage、ArtifactCheck、ArtifactCopy，约 26.6K 字符。
- 现状（按执行顺序）：
  1. 服务器对每个会话无条件设 ShowUI、Session Links、Artifact 编辑锁的环境变量（`conversationService.ts:1052-1058`）。
  2. ShowUI 看 `DREAMCODER_SHOW_UI`（`src/tools/ShowUITool/ShowUITool.ts:153-155`）；StartSession、ListSessions、RenameSession、Kanban×4、SendMessage 看 `isSessionLinksEnabled()`（`src/tools/StartSessionTool/constants.ts:7-9`；`src/tools/KanbanListTool/KanbanListTool.ts:50-52`）；ArtifactCheck、ArtifactCopy、ChooseDesignTemplate、UseDesignSystem 没有 `isEnabled`，用 `buildTool` 默认值 true（`src/Tool.ts:758`）。
  3. 这些工具除 SendMessage 外都没有 `shouldDefer`，即使 ToolSearch 打开也不会延迟（实测 `isDeferredTool` 结果见上表）。
  4. 子 agent 的工具集由 `filterToolsForAgent` 从主会话工具里去掉 `ALL_AGENT_DISALLOWED_TOOLS`（`src/tools/AgentTool/agentToolUtils.ts:83-108`；`src/constants/tools.ts:41-55`）。这个集合去掉了 StartSession、RenameSession、ChooseDesignTemplate、UseDesignSystem，但没去掉 ShowUI、Kanban×4、ListSessions、SendMessage、ArtifactCheck、ArtifactCopy；general-purpose 是 `tools: ['*']`（`src/tools/AgentTool/built-in/generalPurposeAgent.ts:29`），Explore 只额外去掉编辑类（`src/tools/AgentTool/built-in/exploreAgent.ts:67`）。
  5. 每段描述本身写得清楚，问题在于发送条件与本会话是否用到这些功能无关。ChooseDesignTemplate、UseDesignSystem 的描述自己写着「Use this in the design or slides skill」「Use this in design mode」，即只在加载了对应 skill 后才有用。
- 场景：用户在一个普通仓库里让模型修一个空指针。每个请求都带 ShowUI 的 6.5K 组件清单和使用规程、KanbanUpdate 的 4.8K 角色流程和 4.4K 的 15 分支 schema。模型派 Explore 查调用点时，Explore 的每个请求也带 ShowUI 和 Kanban×4。一次 30 个请求的会话里仅这部分就是约 1M 字符（约 250K token，推断）的输入，命中前缀缓存时按缓存价计，代理计费头问题未修前（P-REQ-01）按全价计。
- 参考：ZCode 的会话控制、ListModels、Cron、工作流等产品工具都标 `shouldDefer: true`（`zcode:apps/zcode-cli/packages/core/src/tool/handlers/send-message.ts:80`、`cron.ts:226`、`create-workflow.ts:371` 等），并按宿主注入的端口决定是否注册（`zcode:apps/zcode-cli/packages/core/src/tool/handlers/index.ts:240-317`）；但它的 CLI 默认 `--toolsearch-mode off`，headless 下同样全量发送（见 comparison/tools.md Q4）。Codex 按 feature、模型目录、鉴权逐项注册，没有常驻的产品工具（`codex:core/src/tools/spec_plan.rs:718-818`）。
- 改法方向：按用途分三组处理。ChooseDesignTemplate、UseDesignSystem、ArtifactCopy 只在对应 skill 被加载、或项目里已有 `dc_artifacts/` 时注册；Kanban×4 只在项目有看板或本会话关联了卡片时注册；ShowUI 保留，但把组件清单和布局细则移到 catalog 结果里（见 T-TOOL-06）。子 agent 的禁用集合加入 ShowUI、Kanban×4、ListSessions、ArtifactCopy（子 agent 不面向用户，也不该替主会话改看板）。代理侧支持延迟加载之后，再把这些工具标为 D。
- 确定程度：代码确认（体量为实测；累计 token 为推断）

### T-TOOL-03 Bash 描述要求非 Claude 模型在提交里署名 `Co-Authored-By: Claude Opus 4.7`、在 PR 正文里写「Generated with Claude Code」

- 状态：维护者已定（2026-11-18）：所有模型的提交和 PR 都写「Generated with DreamCoder」，不加 `Co-Authored-By`；桌面端设置可以打开或关闭。
- 类型：问题
- 严重程度：高
- 体量：两处署名约 130 字符，每个请求都发；影响是写进用户的 git 历史和 PR。
- 现状（按执行顺序）：
  1. `getAttributionTexts()` 对不认识的模型名（GLM、Kimi、Qwen 等）回落到写死的 `Claude Opus 4.7`，commit 署名为 `Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>`，PR 署名为 `🤖 Generated with [Claude Code](https://claude.com/claude-code)`（`src/utils/attribution.ts:70-80`）。
  2. Bash 描述在提交步骤和 HEREDOC 示例里各写一次 commit 署名（`src/tools/BashTool/prompt.ts:107`、`:122`），在 PR 示例里写 PR 署名（`prompt.ts:150`）。
  3. 工具描述按会话缓存（`src/utils/api.ts:136-160`），会话中途切换模型时署名也不会更新。
- 场景：用户用 GLM-4.6，说「提交一下」。模型按描述生成 `fix: ...\n\nCo-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>` 并提交；再让它开 PR，正文末尾是「Generated with Claude Code」和 claude.com 链接。用户仓库里留下了与实际模型、实际产品都不符的署名，需要手动改历史。
- 参考：Codex 的提交署名用产品名 `Co-authored-by: Codex <noreply@openai.com>`，不写模型名（`codex:ext/git-attribution/src/world_state.rs:12,20`；是否默认启用未核实）。ZCode 的 Bash 描述没有署名要求，只有三行 git 规则（`zcode:apps/zcode-cli/packages/core/src/tool/handlers/bash-prompt.ts:20-23`）。
- 改法方向：非 Claude 模型时不写模型署名；commit 和 PR 的默认署名改为 DreamCoder 自己的产品名和链接（或默认不署名，由设置里的 `attribution` 决定）。Claude 直连路径的模型名署名是准确的，可保留。
- 确定程度：代码确认

### T-TOOL-04 Read 描述说模型能看图、能读 PDF，并称「Claude Code is a multimodal LLM」；经代理时图片和 PDF 都到不了模型

- 状态：已修复（#270）：经代理时描述写明图片和 PDF 内容到不了模型；直连时保留图片说明，去掉「Claude Code」。代理侧见 P-REQ-03/04。
- 类型：问题
- 严重程度：中
- 体量：图片句 165 字符、PDF 句 253 字符、截图句 323 字符，每个请求都发。
- 现状（按执行顺序）：
  1. 描述无条件写「This tool allows Claude Code to read images ... as Claude Code is a multimodal LLM」（`src/tools/FileReadTool/prompt.ts:40`），PDF 句只对 `claude-3-haiku` 关闭（`prompt.ts:41-45`；`src/utils/pdfUtils.ts:59-61`），截图句要求「ALWAYS use this tool to view the file」（`prompt.ts:48`）。`pages` 参数也一直在 schema 里。
  2. 代理把 tool_result 里的图片换成 `[image omitted: <mime>]`（P-REQ-04），把 PDF 的 document 块静默丢掉（P-REQ-03）。
- 场景：用户贴一张报错截图的路径，说「看看这个报错」。模型按描述调用 Read，收到 `[image omitted: image/png]`；描述告诉它自己能看图，模型可能据文件名编造截图内容，或反复读同一文件。PDF 同理，模型只收到「PDF file read: ...」。
- 参考：ZCode 的图片、视频、PDF 各句都按模型的 `inputFormat` 能力决定是否写入，PDF 不支持时 schema 也不带 `pages`（`zcode:apps/zcode-cli/packages/core/src/tool/handlers/read.ts:68-79`；`zcode:apps/zcode-cli/packages/core/src/tool/handlers/read-pdf.ts:57-80`）。Codex 用单独的 `view_image` 工具（`codex:core/src/tools/spec_plan.rs:1423-1425`）。
- 改法方向：描述去掉「Claude Code」字样（改为「the model」或直接写「presents images visually」）；图片、PDF、截图句和 `pages` 参数按当前模型的输入能力决定是否写入（能力来源与 P-REQ-11 共用一处）；代理侧修复以 P-REQ-03/04 为准。Claude 直连路径保持现文。
- 确定程度：代码确认

### T-TOOL-05 浏览器 MCP 的 15 个工具在桌面端几乎每个会话都发，约 15.5K 字符，两个公共参数的描述重复 18 次

- 类型：优化
- 严重程度：中
- 体量：描述 7,544 + schema 7,948 = 15,492 字符，每个请求都发（主会话和所有子 agent，MCP 工具对子 agent 一律放行，`agentToolUtils.ts:85-87`）；其中 `tabId` 描述 131 字符出现 14 次、`elementId` 描述 214 字符出现 4 次，重复约 2.7K。
- 现状（按执行顺序）：
  1. Electron 主进程在 sidecar 启动后立刻连接浏览器宿主通道（`desktop/electron/main.ts:286-296,681`）。
  2. 服务器启动 CLI 时只要通道已连接就注入地址和令牌（`src/server/browserHost/childEnv.ts:22-26`），CLI 据此加一个 `dreamcoder-browser` MCP 服务器（`src/utils/browserControl/setup.ts:14-33`；`src/main.tsx:1597-1599`）。
  3. 15 个工具的描述和参数在 `src/server/browserHost/tools.ts:41-240`；`tabId`、`elementId` 是共享的 zod 字段（`tools.ts:5-9`），每个工具的 schema 各展开一份。
  4. 描述质量较好（写明页面内容不可信、何时需要权限），问题是发送条件：用户没提浏览器、也没打开浏览器面板时同样发送。
- 场景：同 T-TOOL-02 的修 bug 会话，主会话和每个 Explore 请求都多带 15.5K 字符的浏览器工具。
- 参考：ZCode 的浏览器能力（node_repl）由 browser-use 插件推导的 runtime feature 决定是否注册（`zcode:apps/zcode-cli/packages/core/src/tool/handlers/index.ts:330-332`）。Codex 无对应。
- 改法方向：在用户打开浏览器面板、引用了页面元素、或会话涉及本地页面或 artifact 预览时才连接这个 MCP 服务器（或在代理支持延迟加载后整组延迟）；把 `tabId` 的长说明写进 `navigate`/`snapshot` 的描述一次，其他工具的参数描述只留一句。
- 确定程度：代码确认（「几乎每个会话」依赖宿主在会话启动前已连上，推断）

### T-TOOL-06 ShowUI 强制先调 catalog 再调 describe 才能建页，catalog 结果一次约 24K 字符

- 类型：优化
- 严重程度：中
- 体量：catalog 结果 24,214 字符（76 个组件，其中中文 2,439 字），describe 单个组件 2K–16K（`chart` 2,024，`table` 3,006，`g2-bar` 3,261，`flowchart` 16,313）；每个会话第一次画图至少 3 次调用。
- 现状（按执行顺序）：
  1. 描述的「Steps, enforced by the tool」要求第一页之前先 `catalog`，再 `describe` 每种要用的组件（`src/tools/ShowUITool/prompt.ts`，实测 611 字符）。
  2. `validateInput` 强制执行：没调过 catalog 就建页返回「Before creating a page, list the components ...」，没 describe 过的组件返回「Read the data format of ... first」（`ShowUITool.ts:84-90`）。
  3. catalog 和 describe 的结果都是 `JSON.stringify` 的组件文档（`ShowUITool.ts:173-180,190-196`），之后一直留在上下文里。
  4. 描述里另有 1,433 字符的组件清单和选择规则，与 catalog 结果内容重叠。
- 场景：用户说「把这组数据画成柱状图」。模型先 catalog（24K 进上下文），再 describe `chart`（2K），再建页，共 3 轮；之后每个请求都带着这 26K 的历史。
- 参考：Codex、ZCode 本场景无对应工具。
- 改法方向：描述只留调用协议和「先 describe 再用」一条；组件清单不进描述，由 catalog 返回；catalog 只返回名字和一行签名（目前每条带描述和签名），把「什么场景用哪个组件」的规则也放进 catalog 结果；`text` 和 `chart` 这类最常用组件允许不 describe 直接用（`text` 已经免 describe），把一次简单画图压到 1–2 轮。
- 确定程度：代码确认（结果大小为实测）

### T-TOOL-07 Bash 描述里 6.2K 字符的 git 提交和 PR 规程，内部规则写了两遍，还禁止使用本场景不存在的 TodoWrite

- 类型：优化
- 严重程度：中
- 体量：Bash 描述 10,004 字符，其中「Committing changes with git」4,216、「Creating pull requests」1,941、「Other common operations」97，每个请求都发。
- 现状（按执行顺序）：
  1. git 段默认包含（`src/utils/gitSettings.ts:13-18`），内容在 `src/tools/BashTool/prompt.ts:42-165`。
  2. 「Instructions」里已有一组 git 规则（优先新提交、不跳过 hook、破坏性操作前先考虑，`prompt.ts:339` 起，543 字符），「Git Safety Protocol」再写一遍同样三条，措辞不同（`prompt.ts:87` 起）。
  3. 提交和 PR 两段都写「NEVER use the TodoWrite or Agent tools」（`prompt.ts:114`、`:156`），本场景 TodoWrite 不发送（Task V2 打开），模型看到的是一个不存在的工具名，而真正存在的 TaskCreate/TaskUpdate 没被提到。
  4. 提交段开头「You can call multiple tools in a single response...」与系统提示词的并行调用条文重复（见 T-TOOL-14）。
- 场景：普通修 bug 会话不提交，这 6.2K 每个请求照发。用户说「提交」时，模型按规程并行跑 status/diff/log，规程本身有用，但只在提交时用到。
- 参考：ZCode 的 Bash 描述共 1.6K 字符，git 只有三行（交互参数不支持、用 gh、用户要求才提交）（`zcode:apps/zcode-cli/packages/core/src/tool/handlers/bash-prompt.ts:20-23`）。Codex 的 `exec_command` 描述 82 字符，git 规则在系统提示词里两行（`codex:models-manager/prompt.md:141,144`）。
- 改法方向：Bash 描述只留 ZCode 那样的三条 git 规则；完整的提交、PR 流程改为一个按需加载的内置 skill（`/commit`、`/pr`，用户说「提交」「开 PR」时由 Skill 加载）；删掉「Instructions」与「Git Safety Protocol」的重复项；「NEVER use the TodoWrite」按实际启用的任务工具名生成，或删掉。
- 确定程度：代码确认

### T-TOOL-08 多处「主动使用」条文针对 Claude 的习性写成，对第三方模型会多出计划和任务调用

- 类型：优化
- 严重程度：中
- 体量：EnterPlanMode 4,022（何时用 1,751、例子 928），TaskCreate 2,146（何时用 808），Agent 里的并发和 proactive 条文约 600，都每个请求发。
- 现状（按执行顺序）：
  1. EnterPlanMode 开头「Use this tool proactively when you're about to start a non-trivial implementation task」，列了 7 种「应使用」情形（包括「Code Modifications」「Multi-File Changes」），结尾「If unsure whether to use it, err on the side of planning」（`src/tools/EnterPlanModeTool/prompt.ts:23,96`）。
  2. TaskCreate「Use this tool proactively in these scenarios」，理由里有「demonstrate thoroughness to the user」（`src/tools/TaskCreateTool/prompt.ts:16,21`）。
  3. Agent「Launch multiple agents concurrently whenever possible, to maximize performance」和「If the agent description mentions that it should be used proactively ... try your best to use it」（`src/tools/AgentTool/prompt.ts:245-248,270`）；verification agent 的描述写「Invoke after non-trivial tasks (3+ file edits ...)」。
  4. 这些条文原本用来纠正 Claude「不爱进计划模式、不建任务」的倾向。第三方模型按字面执行时，「修改现有行为」几乎覆盖所有编码任务。
- 场景：用户说「把 utils/date.ts 里的时区默认值改成 UTC」。按 EnterPlanMode 第 3 条（Code Modifications），模型先请求进入计划模式（一次用户审批），写计划文件，调 ExitPlanMode（第二次审批），再建 2–3 个任务并逐个更新，一个两行改动变成 6–8 次工具调用和两次打断用户。
- 参考：Codex 没有进入计划模式的工具，计划模式由用户切换；子 agent 描述写「Do not spawn sub-agents unless the user or applicable AGENTS.md/skill instructions explicitly ask」（`codex:core/src/tools/handlers/multi_agents_spec.rs:738`）。ZCode 的 EnterPlanMode 文字与 DreamCoder 相同（`zcode:apps/zcode-cli/packages/core/src/tool/handlers/plan-mode-prompts.ts:12,95`），但标了 `shouldDefer`（`zcode:apps/zcode-cli/packages/core/src/tool/handlers/plan-mode.ts:110`）；ZCode 的 TodoWrite 描述只说明格式，不要求主动使用（`zcode:apps/zcode-cli/packages/core/src/tool/handlers/todo.ts:137-141`）。
- 改法方向：EnterPlanMode 改为「用户要求先出方案，或改动涉及多个模块且做法有明显分歧时使用」，删掉 7 条清单里的「Code Modifications」「Multi-File Changes」和「err on the side of planning」，例子减到正反各一；TaskCreate 删掉「demonstrate thoroughness」和「proactively」，改为 3 步以上的任务才用；Agent 删掉「whenever possible」的并发鼓励，改为「独立的调研可以并行」。这一条和 loop-execution 的 2.7 节说的是同一件事的文字一侧。
- 确定程度：代码确认（多出的调用次数为推断）

### T-TOOL-09 计划模式有三份流程说明，EnterPlanMode 的结果说「不要写任何文件」，计划模式提醒又要求写计划文件

- 状态：已修复（#270）：只保留计划模式提醒里的 interview 流程；EnterPlanMode 描述删掉「What Happens」，结果只允许写计划文件。
- 类型：问题
- 严重程度：中
- 体量：EnterPlanMode 描述「What Happens in Plan Mode」370 字符（每个请求）；EnterPlanMode 结果 472 字符（每次进入）；计划模式提醒（T-INJ 范围）。
- 现状（按执行顺序）：
  1. EnterPlanMode 描述列 6 步：探索、理解模式、设计、向用户展示、用 AskUserQuestion、用 ExitPlanMode 退出（`src/tools/EnterPlanModeTool/prompt.ts:4-12`）。
  2. 调用后结果另列 6 步，结尾「Remember: DO NOT write or edit any files yet. This is a read-only exploration and planning phase.」（`src/tools/EnterPlanModeTool/EnterPlanModeTool.ts:108-118`，interview phase 关闭时，`src/utils/planModeV2.ts:50-62`）。
  3. 随后的计划模式提醒说「you MUST NOT make any edits (with the exception of the plan file mentioned below)」「You should create your plan at <path> using the Write tool」，并给出五阶段流程（`src/utils/messages.ts:3317-3325`）。
  4. ExitPlanMode 描述说「You should have already written your plan to the plan file」（`src/tools/ExitPlanModeTool/prompt.ts`）。
- 场景：模型进入计划模式，工具结果的最后一句是「不要写任何文件」。如果模型在同一批工具调用里读到结果时提醒还没到（提醒随下一条用户消息附件到达），或者更看重工具结果，它就不写计划文件，直接调 ExitPlanMode，用户审批时看到空计划；ExitPlanMode 对空计划返回「User has approved exiting plan mode」（`src/tools/ExitPlanModeTool/ExitPlanModeV2Tool.ts:462-468`），计划没有落到文件。
- 参考：ZCode 的 EnterPlanMode 文字相同，同样存在（`zcode:apps/zcode-cli/packages/core/src/tool/handlers/plan-mode-prompts.ts:5-98`）。Codex 无此工具。
- 改法方向：EnterPlanMode 的结果只写一句「已进入计划模式，计划文件路径和规则见随后的提醒」，或直接在结果里给出计划文件路径并写「只允许写这个文件」；删掉描述里的「What Happens in Plan Mode」段，流程只在提醒里写一份。
- 确定程度：代码确认（模型是否因此不写计划文件为推断）

### T-TOOL-10 Agent 的 `model` 参数是 `sonnet/opus/haiku` 枚举，第三方提供方下其中两个指向同一个模型，模型无从知道

- 类型：问题
- 严重程度：中
- 体量：参数 246 字符，每个请求都发。
- 现状（按执行顺序）：
  1. schema 固定为 `z.enum(['sonnet','opus','haiku'])`，描述「Optional model override for this agent」（`src/tools/AgentTool/AgentTool.tsx:87`）。
  2. 自定义提供方下服务器把 sonnet 和 opus 都映射到所选主模型，haiku 映射到 fastModel（`src/server/services/providerRuntimeEnv.ts:249-252`）。
  3. 描述和参数都没说别名对应哪个模型；模型只能按 Claude 家族的常识理解（opus 最强、haiku 最快）。
- 场景：用户用 Kimi K2 并把 fastModel 设成一个小模型。模型想要「更强的模型做难题」而传 `model:"opus"`，实际还是主模型；想省钱传 `haiku`，实际换成了用户设的小模型，结果质量下降而模型不知道原因。
- 参考：Codex 的 `model` 参数是自由字符串，描述写「Do not set the `model` field unless the user explicitly asks for a different model」（`codex:core/src/tools/handlers/multi_agents_spec.rs:18,736`），且在不暴露覆盖时整个参数删除（`multi_agents_spec.rs:130-131`）。ZCode 的 Agent schema 没有 `model` 参数，模型由 agent 定义决定（`zcode:apps/zcode-cli/packages/contracts/src/tools/agent.ts:18-35`）。
- 改法方向：第三方提供方下删除 `model` 参数（agent 定义自带模型即可）；或把枚举改成两个有意义的值（主模型、快速模型）并在描述里写出对应的实际模型名，加上「用户没要求时不要设」。Claude 直连路径保持现状。
- 确定程度：代码确认

### T-TOOL-11 AskUserQuestion 的 schema 暴露三个内部字段，以及桌面端不渲染的 `preview`；`preview` 的描述指向描述里不存在的段落

- 状态：已修复（#270）：发给模型的 schema 去掉 `answers`、`annotations`、`metadata` 和选项的 `preview`，内部 schema 不变。
- 类型：问题
- 严重程度：中
- 体量：schema 2,966 字符，其中 `answers`/`annotations`/`metadata` 955 字符、`preview` 241 字符；工具标 D，本场景每个请求都发。
- 现状（按执行顺序）：
  1. 输入 schema 包含 `answers`（「User answers collected by the permission component」）、`annotations`、`metadata`（「e.g., "remember" for /remember command ... analytics」）（`src/tools/AskUserQuestionTool/AskUserQuestionTool.tsx:56-60`），这三个字段由权限组件填写，模型不该填。
  2. 选项的 `preview` 字段描述是「See the tool description for the expected content format」（`AskUserQuestionTool.tsx:17`）。本场景入口是 `sdk-cli`，`setQuestionPreviewFormat` 不被调用（`src/main.tsx:828-836`），描述不追加 preview 段（`AskUserQuestionTool.tsx:117-125`），模型找不到它说的格式。
  3. 桌面端问题卡片只读 `question`、`header`、`options` 的 label/description（`desktop/src/components/chat/AskUserQuestion.tsx:16-47`），不渲染 `preview`。
- 场景：模型想让用户在两种布局之间选，把 ASCII 草图写进 `preview`；用户在桌面端只看到两个标签，看不到草图，回答「随便」。或者模型自己填了 `answers`，`call()` 直接把它当作用户答案返回（`AskUserQuestionTool.tsx:209-221`），问题没问就有了「回答」（权限组件是否覆盖模型填写的 `answers` 未核实）。
- 参考：ZCode 的 schema 同样带这三个字段和 `preview`（`zcode:apps/zcode-cli/packages/contracts/src/tools/ask-user-question.ts:29-33,123-134`）。Codex 的 `request_user_input` 只有问题和选项，选项规则写在参数描述里（`codex:core/src/tools/handlers/request_user_input_spec.rs:16-79`）。
- 改法方向：发给模型的 schema 去掉 `answers`、`annotations`、`metadata`（内部仍可用完整 schema 校验）；桌面端不渲染 preview 时 schema 也去掉 `preview`，渲染后再按格式加回描述段。
- 确定程度：代码确认（模型自填 `answers` 的后果未核实）

### T-TOOL-12 Read 描述说「默认最多读 2000 行」，实际默认读整个文件，256KB 和 25,000 token 的上限描述里没写

- 类型：问题
- 严重程度：中
- 体量：描述 1 句；后果是超限时多一轮。
- 现状（按执行顺序）：
  1. 描述写「By default, it reads up to 2000 lines」并建议「read the whole file by not providing these parameters」（`src/tools/FileReadTool/prompt.ts:37-38`）。
  2. `call()` 的 `limit` 默认 `undefined`（`src/tools/FileReadTool/FileReadTool.ts:495`），2000 只用于描述和附件（`src/utils/attachments.ts:3133-3137`）。
  3. 超过 256KB 或 25,000 token 时报错「File content (N tokens) exceeds maximum allowed tokens (25000). Use offset and limit ...」（`FileReadTool.ts:176-183`）；描述里的大小说明受 GrowthBook 开关控制，本场景不出现（`FileReadTool.ts:346-349`）。
- 场景：模型读一个 4,000 行的生成文件，按描述以为最多拿到前 2000 行，不带参数调用，收到超限错误，再带 offset/limit 重读，多一轮。
- 参考：ZCode 描述同样写 2000 行（`zcode:apps/zcode-cli/packages/core/src/tool/handlers/read.ts:72`），但首次整读超限时返回部分内容而不是报错（见 loop-execution 2.4）。Codex 无读文件工具。
- 改法方向：描述改为与实现一致：「默认读整个文件；超过约 25,000 token 时报错，大文件请用 offset/limit 或先 Grep」，删掉「建议读整个文件」；执行侧的部分视图见 loop-execution 2.4。
- 确定程度：代码确认

### T-TOOL-13 EnterWorktree/ExitWorktree 与桌面端自己的 worktree 流程重复，文字里有 hook、tmux、退出时提示等桌面端没有的行为

- 状态：已修复（#270）：描述去掉 hook、tmux 和退出提示，写明桌面端面板仍显示原目录。核实结果：会话中途进入 worktree 后桌面端面板不跟随（CLI 只在 init 时报告 cwd），未修。
- 状态：维护者已定（2026-11-18）：保留这两个工具；按桌面端的实际行为改描述，并核实桌面端面板是否跟随 CLI 进入 worktree。
- 类型：问题
- 严重程度：中
- 体量：描述 3,258 + schema 716 = 3,974 字符；两者标 D，本场景每个请求都发，子 agent 也带。
- 现状（按执行顺序）：
  1. `isWorktreeModeEnabled()` 恒真（`src/utils/worktreeModeEnabled.ts:9-11`）。
  2. 描述写「Must be in a git repository, OR have WorktreeCreate/WorktreeRemove hooks configured in settings.json」「On session exit, if still in the worktree, the user will be prompted to keep or remove it」（`src/tools/EnterWorktreeTool/prompt.ts:16-24`），ExitWorktree 写「If a tmux session was attached to the worktree」（`src/tools/ExitWorktreeTool/prompt.ts:29`）；EnterWorktree 的结果写「or exit the session to be prompted」（`src/tools/EnterWorktreeTool/EnterWorktreeTool.ts:116`）。
  3. 桌面端用自己的方式建 worktree：新会话可选 worktree，服务器以 `--worktree` 启动 CLI（`conversationService.ts:132-140`），StartSession 有 `worktree: true`。服务器和桌面端代码里没有任何地方处理 EnterWorktree/ExitWorktree（在 `src/server`、`desktop/src` 中搜索不到）。
- 场景：用户说「开个 worktree 试一下」。模型调 EnterWorktree，CLI 的工作目录切到 `.claude/worktrees/<名字>`；桌面端的文件面板、diff 和会话的项目目录仍指向原目录（推断），用户看不到改动出现在哪里。会话关闭时也不会有描述里说的「keep or remove」提示。
- 参考：Codex、ZCode 都没有会话内切换 worktree 的工具。
- 改法方向：桌面端场景不注册这两个工具，worktree 统一走 StartSession 的 `worktree: true` 或新会话选项；如果保留，删掉 hook、tmux、退出提示等句子，并让服务器跟踪 CLI 的工作目录变化。
- 确定程度：代码确认（桌面端面板不跟随为推断）

### T-TOOL-14 同一条规则在系统提示词和多个工具描述里重复，说法不一

- 类型：优化
- 严重程度：低
- 体量：合计约 2.5K 字符，每个请求都发。
- 现状：
  - 「用专用工具，不要在 Bash 里 find/grep/cat」：系统提示词「Using your tools」（`src/constants/prompts.ts:290-305`）；Bash 描述 784 字符的列表（`src/tools/BashTool/prompt.ts:280-291,359`）；Grep「NEVER invoke `grep` or `rg` as a Bash command」（`src/tools/GrepTool/prompt.ts:10`）。Read 又让模型「To read a directory, use an ls command via the Bash tool」（`src/tools/FileReadTool/prompt.ts:46`），而 Bash 的列表写「File search: Use Glob (NOT find or ls)」。
  - 「并行调用」：系统提示词 514 字符（`prompts.ts:310`）、Bash「When issuing multiple commands」、Bash 提交段开头、Agent 的「concurrently」和「in parallel ... MUST」，共四处。
  - 「不用 emoji」：系统提示词（`prompts.ts:432`）、Edit（`src/tools/FileEditTool/prompt.ts:25`）、Write（`src/tools/FileWriteTool/prompt.ts:17`）。
  - 「用任务工具拆分工作」：系统提示词（`prompts.ts:306-309`）和 TaskCreate 描述。
- 场景：同一意思出现三四次，每次措辞和例外不同（Read 让用 ls，Bash 说不要 ls），模型需要自己判断哪条优先。
- 参考：Codex 的 shell 规则只在系统提示词里写一次（`codex:models-manager/prompt.md:258-265`）；ZCode 的 Bash 描述只一句「Avoid using this tool to run ...」（`zcode:apps/zcode-cli/packages/core/src/tool/handlers/bash-prompt.ts:14`）。
- 改法方向：通用规则只留在系统提示词；Bash 只留一句指向专用工具；Edit/Write 删掉 emoji 句；Read 的目录说明改成「列目录用 Glob」或保留 ls 但让 Bash 的列表写明列目录可以用 ls。
- 确定程度：代码确认

### T-TOOL-15 SendMessage 的 schema 带 agent teams 的结构化消息，标题仍是「发给另一个 agent」

- 类型：优化
- 严重程度：低
- 体量：结构化消息 669 字符，每个请求都发。
- 现状：`message` 是「字符串 | shutdown_request | shutdown_response | plan_approval_response」的联合（`src/tools/SendMessageTool/SendMessageTool.ts:65-83,96-99`），不随 agent teams 开关裁剪；本场景发给会话的结构化消息一律被拒（`SendMessageTool.ts:685-693`）。描述标题「Send a message to another agent.」（`src/tools/SendMessageTool/prompt.ts:47`）与正文只讲会话不一致；`summary` 描述「required when message is a string, except for a session address」在本场景等于「不需要」。
- 场景：模型看到 `shutdown_request` 选项，回复跨会话消息时偶尔选错类型，被拒一次。
- 参考：ZCode 的 SendMessage 只发纯文本 schema（`zcode:apps/zcode-cli/packages/core/src/tool/handlers/send-message.ts:17-27`）。
- 改法方向：agent teams 关闭时 `message` 只保留字符串，删掉 `summary` 参数；标题改为「Send a message to another DreamCoder session」（若 T-TOOL-01 选择支持子 agent，则写成「session or subagent」）。
- 确定程度：代码确认

### T-TOOL-16 Task 系列工具里有 agent teams 的残留和已弃用的说明

- 类型：优化
- 严重程度：低
- 体量：约 1.5K 字符，每个请求都发。
- 现状：
  - TaskList 写「no owner」「claim the next available task」「owner: Agent ID if assigned」（`src/tools/TaskListTool/prompt.ts:30-44`），只有「Teammate Workflow」段按开关裁剪（`prompt.ts:15-26`）；TaskUpdate 有 `owner` 字段和「Claim a task by setting owner」例子（`src/tools/TaskUpdateTool/prompt.ts:36,68-70`），本场景没有其他 agent 认领任务。
  - TaskOutput 描述以「DEPRECATED: Prefer using the Read tool on the task's output file path」开头，却仍注册并发送（`src/tools/TaskOutputTool/TaskOutputTool.tsx:163-165,173`），还写「Task IDs can be found using the /tasks command」（`TaskOutputTool.tsx:180`），`/tasks` 是终端界面命令（`src/commands/tasks/index.ts:3-8`，`local-jsx`），桌面端没有。
  - TaskStop 的 schema 带「Deprecated: use task_id instead」的 `shell_id`（`src/tools/TaskStopTool/TaskStopTool.ts:16-17`）。
  - ExitPlanMode 的批准结果写「Start with updating your todo list if applicable」（`src/tools/ExitPlanModeTool/ExitPlanModeV2Tool.ts:483`），本场景的工具叫 Task*。
- 场景：模型完成一个任务后照 TaskList 描述「claim the next available task」去设置 `owner`，多一次无意义的更新。
- 参考：ZCode 只有 TodoWrite/TodoRead，没有 owner（`zcode:apps/zcode-cli/packages/core/src/tool/handlers/todo.ts:130-141`）；Codex 默认不注册计划工具。
- 改法方向：agent teams 关闭时去掉 owner 相关的句子、字段和例子；不再发送 TaskOutput（结果里已给输出文件路径，`src/tools/BashTool/BashTool.tsx:614`），或至少删掉 `/tasks` 一句；去掉 `shell_id`；「todo list」改成实际的任务工具名。
- 确定程度：代码确认

### T-TOOL-17 Agent 描述里约 1.2K 字符的示例和 agent 条目对本场景无用：示例 agent 不存在，statusline-setup 配置的是桌面端没有的界面

- 状态：部分修复（#270）：statusline-setup 已从内置列表删除（同 T-SYS-12）；示例段和 build-validator 句未改。
- 类型：优化
- 严重程度：低
- 体量：示例段 1,002 字符、statusline-setup 一行约 110 字符、「build-validator / test-runner」一句约 150 字符，每个请求都发。
- 现状：示例是 `test-runner`、`greeting-responder` 两个虚构 agent（`src/tools/AgentTool/prompt.ts:159-186`），并行例子提到 `build-validator`（`prompt.ts:271`），都不在可用列表里；可用列表含「statusline-setup: Use this agent to configure the user's Claude Code status line setting」（定义 `src/tools/AgentTool/built-in/statuslineSetup.ts:135-136`），桌面端没有状态栏（`desktop/src` 中的 StatusLine 只是 Computer Use 设置页的组件名）。
- 场景：用户说「设置一下状态栏」。模型派 statusline-setup 去改 settings.json 和 `~/.dreamcoder/statusline-command.sh`，桌面端没有任何显示。
- 参考：ZCode 的 Agent 描述没有示例，agent 列表放在提醒消息里（`zcode:apps/zcode-cli/packages/core/src/tool/handlers/agent.ts:97-101`）。Codex 的 `spawn_agent` 没有虚构示例。
- 改法方向：删掉示例段和 build-validator 句；桌面端场景不注册 statusline-setup（或从内置列表移除）。
- 确定程度：代码确认

### T-TOOL-18 Skill 描述的示例技能 pdf、commit、review-pr、ms-office-suite:pdf 在 DreamCoder 里都不存在

- 类型：问题
- 严重程度：低
- 体量：约 350 字符，每个请求都发。
- 现状：示例写 `/commit`、`/review-pr`、`skill: "pdf"`、`"ms-office-suite:pdf"`（`src/tools/SkillTool/prompt.ts:178-186`）；内置技能是 artifacts、design、slides、browser、verify、simplify、remember 等（`src/skills/bundled/*.ts` 中 `registerBundledSkill` 的 `name`），没有这几个。
- 场景：用户输入「/commit」。模型按例子调用 `Skill({skill:"commit"})`，收到「Unknown skill: commit」（`src/tools/SkillTool/SkillTool.ts:406`），再改用 Bash 提交，多一轮。
- 参考：ZCode 的 Skill 描述同样泛化（`zcode:apps/zcode-cli/packages/core/src/tool/handlers/skill.ts:103-116`，未逐句对比）；Codex 无 Skill 工具。
- 改法方向：示例改用 DreamCoder 实际存在的技能名（如 `design`、`slides`），或不举具体名字只写格式。
- 确定程度：代码确认

### T-TOOL-19 有默认值的参数在 schema 里被标为必填

- 类型：问题
- 严重程度：低
- 体量：涉及 4 个字段；模型每次调用都要多写这些字段。
- 现状：`zodToJsonSchema` 直接调用 zod v4 的 `toJSONSchema`，默认按输出类型生成（`src/utils/zodToJsonSchema.ts`），带 `.default()` 的字段进入 `required`。实测：TaskOutput 的 `block`、`timeout`（描述写「Use block=true (default)」），AskUserQuestion 的 `multiSelect`，StartSession 的 `worktree`（描述写「Defaults to false」）都是 required。
- 场景：描述说可省略，schema 说必填，严格按 schema 生成参数的模型每次都填，偶尔填错类型（如 `timeout: "30s"`）被校验拒绝。
- 参考：ZCode 的 TaskOutput 用同样的 zod 写法（`zcode:apps/zcode-cli/packages/contracts/src/tools/task-output.ts:27-29`），是否也进入 required 未核实。Codex 的 schema 手写，可选字段不进 required（`codex:core/src/tools/handlers/shell_spec.rs:20-107`）。
- 改法方向：生成发给模型的 schema 时用 `io: 'input'`，让有默认值的字段保持可选。
- 确定程度：代码确认（实测 schema）

### T-TOOL-20 本场景无效的参数仍在 schema 里：Bash 的 `dangerouslyDisableSandbox`、ExitPlanMode 的 `allowedPrompts`

- 类型：优化
- 严重程度：低
- 体量：125 + 467 字符，每个请求都发。
- 现状：Bash 的 `dangerouslyDisableSandbox` 总在 schema 里（`src/tools/BashTool/BashTool.tsx:242`），本场景沙箱关闭，描述里也没有沙箱段。ExitPlanMode 的 `allowedPrompts` 只在 `isClassifierPermissionsEnabled()` 为真时生效（`src/components/permissions/ExitPlanModePermissionRequest/ExitPlanModePermissionRequest.tsx:64`），而这个函数在本构建里恒为 false（`src/utils/permissions/bashClassifier.ts:24-26`），桌面端也不读这个字段；它的 schema 还用 `.passthrough()`（`src/tools/ExitPlanModeTool/ExitPlanModeV2Tool.ts:79-89`），生成 `"additionalProperties": {}`，与描述「This tool does NOT take the plan content as a parameter」并存。
- 场景：模型在 ExitPlanMode 里填了几条 `allowedPrompts`，以为后续 Bash 命令会被预先批准，结果每条命令仍弹审批。
- 参考：Codex 的 `exec_command` 只在需要时加提权参数（`codex:core/src/tools/handlers/shell_spec.rs:22-107`）；ZCode 无对应。
- 改法方向：沙箱关闭时 omit `dangerouslyDisableSandbox`（与 `run_in_background` 的 omit 同一处，`BashTool.tsx:254-258`）；classifier 关闭时 omit `allowedPrompts` 并去掉 `passthrough`。
- 确定程度：代码确认

### T-TOOL-21 缺少「编辑后不必重读验证」的说明；Edit 的「最小 old_string」提示只给 ant

- 状态：部分修复（#270）：ant 专用的「最小 old_string」提示已删除；「编辑后不必重读」未定。
- 状态：维护者已定（2026-11-18）：「最小 old_string」这条 ant 专用提示随 ant 分支一起删除；「编辑后不必重读」未定。
- 类型：缺失
- 严重程度：低
- 体量：两句共约 300 字符。
- 现状：Edit 的成功结果只有「The file X has been updated successfully.」（`src/tools/FileEditTool/FileEditTool.ts:595`），Read/Edit/Write 描述和系统提示词都没说编辑成功后不需要再读（在这几处搜索 re-read 只命中重复读取的去重文案）。Edit 描述里「Use the smallest old_string that's clearly unique — usually 2-4 adjacent lines」只在 `USER_TYPE==='ant'` 时写入（`src/tools/FileEditTool/prompt.ts:16-19`）。
- 场景：第三方模型改完文件后习惯再 Read 一遍确认，每次编辑多一轮；`old_string` 带十几行上下文，输出 token 和匹配失败率都上升（失败率影响为推断）。
- 参考：ZCode 的 Read 描述写「Do NOT re-read a file you just edited to verify — Edit/Write would have errored if the change failed」（`zcode:apps/zcode-cli/packages/core/src/tool/handlers/read.ts:78`）；Codex 写「Do not waste tokens by re-reading files after calling `apply_patch` on them」（`codex:models-manager/prompt.md:143`）。
- 改法方向：Read 或 Edit 描述加 ZCode 那一句；最小 `old_string` 提示对外部构建也写入。
- 确定程度：代码确认

### T-TOOL-22 MCP 工具名只做字符替换，不检查长度

- 类型：问题
- 严重程度：低
- 体量：无额外字符；影响是名字过长时整个请求可能被拒。
- 现状：MCP 工具名为 `mcp__<服务器名>__<工具名>`，`normalizeNameForMCP` 只把非 `[a-zA-Z0-9_-]` 换成下划线（`src/services/mcp/normalization.ts:17-23`；`src/services/mcp/mcpStringUtils.ts:50-52`），注释写的目标格式是 `^[a-zA-Z0-9_-]{1,64}$`（`normalization.ts:10`），但没有截断或哈希。描述超过 2,048 字符截断并加「… [truncated]」（`src/services/mcp/client.ts:218,1705-1710`），这部分处理正常。
- 场景：用户接一个名字较长的 MCP 服务器（如 `company-internal-knowledge-base`），其中有 `search_documents_by_semantic_similarity` 工具，全名超过 64 字符。OpenAI 兼容端点按 64 字符上限校验函数名时，每个请求都 400（各提供方的上限未核实）。
- 参考：Codex 对 MCP 工具名做清理，超过上限时截断并加 SHA-1 后缀（`codex:codex-mcp/src/tools.rs:108,193,226`，上限 128）。ZCode 未核实。
- 改法方向：生成全名时超过 64 字符就截断并加短哈希后缀，保留反查表用于调用。
- 确定程度：代码确认（提供方的长度上限未核实）

---

## 2. 汇总表

| 编号 | 标题 | 类型 | 严重程度 | 体量 |
|---|---|---|---|---|
| T-TOOL-01 | SendMessage 续接子 agent 的说法与校验矛盾 | 问题 | 高 | ~260 字符/请求+结果；每次续接多一轮 |
| T-TOOL-02 | 13 个产品工具常驻，子 agent 也带 | 优化 | 高 | 32,195/请求；子 agent ~26.6K/请求 |
| T-TOOL-03 | Bash 要求写 Claude 署名 | 问题 | 高 | ~130/请求；写进 git 历史 |
| T-TOOL-04 | Read 承诺能看图读 PDF | 问题 | 中 | ~740/请求 |
| T-TOOL-05 | 浏览器 MCP 15 工具常驻 | 优化 | 中 | 15,492/请求，重复 2.7K |
| T-TOOL-06 | ShowUI 强制 catalog/describe | 优化 | 中 | catalog 结果 24,214/次；≥3 轮 |
| T-TOOL-07 | Bash 的 git/PR 规程 | 优化 | 中 | 6,254/请求 |
| T-TOOL-08 | 「主动使用」条文 | 优化 | 中 | ~6.8K/请求 |
| T-TOOL-09 | 计划模式说明互相矛盾 | 问题 | 中 | 370/请求 + 472/次 |
| T-TOOL-10 | Agent `model` 枚举 | 问题 | 中 | 246/请求 |
| T-TOOL-11 | AskUserQuestion 内部字段与 preview | 问题 | 中 | 1,196/请求 |
| T-TOOL-12 | Read 默认 2000 行不符 | 问题 | 中 | 1 句；超限多一轮 |
| T-TOOL-13 | Worktree 工具与桌面流程重复 | 问题 | 中 | 3,974/请求 |
| T-TOOL-14 | 规则在多处重复 | 优化 | 低 | ~2.5K/请求 |
| T-TOOL-15 | SendMessage 结构化消息 | 优化 | 低 | 669/请求 |
| T-TOOL-16 | Task 工具的残留与弃用说明 | 优化 | 低 | ~1.5K/请求 |
| T-TOOL-17 | Agent 示例与 statusline-setup | 优化 | 低 | ~1.2K/请求 |
| T-TOOL-18 | Skill 示例技能不存在 | 问题 | 低 | ~350/请求 |
| T-TOOL-19 | 默认值参数被标必填 | 问题 | 低 | 4 个字段 |
| T-TOOL-20 | 无效参数 | 优化 | 低 | 592/请求 |
| T-TOOL-21 | 缺「不必重读」与最小 old_string | 缺失 | 低 | ~300 |
| T-TOOL-22 | MCP 工具名不检查长度 | 问题 | 低 | — |

按严重程度：高 3、中 10、低 9，共 22 条。

---

## 3. 与已有结论的出入

对照 `comparison/tools.md`：

- 证实：内置工具 34 个，描述 63,689 字符（原报告 63,692，差别在 Bash 10,004 / Write 618 两项）；13 个产品工具描述 21,265；D 集合 14 个、描述 21,077、产品工具除 SendMessage 外不在其中（19,714）；Bash 的 git+PR 段 6,254（原 6,253）；Agent 的 agent 列表 1,817、示例 1,002；工具按名字 `localeCompare` 排序且不带 locale（`src/tools.ts:383-387`）；ToolSearch 在本场景关闭的原因。
- 推翻：
  - Q1a 的 schema「18–22K」和工具块「82–86K」偏低。实测代理清理后 schema 25,582 字符，代理发出的工具数组 93,221 字符（约 23K token，推断）。AskUserQuestion（2,966）、Grep（2,385）、KanbanUpdate（4,357）、SendMessage（1,418）的 schema 都比原估计大。
  - Q4 表说 SendMessage「续接子 agent 时要用」。本场景 agent teams 关闭，SendMessage 拒绝非会话地址，续接子 agent 不可用（T-TOOL-01）。
  - Q1b 把浏览器 MCP 写成「条件附加、描述未测」。Electron 主进程在 sidecar 启动后即连接浏览器宿主（`desktop/electron/main.ts:681`），桌面端会话基本都带这 15 个工具，实测 15,492 字符（T-TOOL-05）。
- 需要补充：
  - 子 agent 的工具集包含 ShowUI、Kanban×4 等 9 个产品工具和全部 MCP 工具（T-TOOL-02、05）。
  - ShowUI 的体量不只在描述：catalog 结果 24K、强制 3 轮（T-TOOL-06）。
  - Claude 专属文本还有 Bash 的「Generated with Claude Code」PR 署名（T-TOOL-03）；Read 的问题不只是措辞，代理侧本来就送不到图片和 PDF（T-TOOL-04）。
  - 原报告没覆盖 schema 层面的问题：内部字段暴露（T-TOOL-11）、默认值字段被标必填（T-TOOL-19）、无效参数（T-TOOL-20）、MCP 名字长度（T-TOOL-22）。

对照 `comparison/loop-execution.md`：2.6 节的「结果返回：最终文本 + agentId/usage 尾注」需补充：尾注里的 SendMessage 提示在本场景会失败（T-TOOL-01）。2.4 节关于 Read 2000 行的结论证实，文字一侧单列为 T-TOOL-12。2.7 节关于 Task 工具「主动使用」的结论证实，计划模式一侧补在 T-TOOL-08。

---

## 4. 已查无问题

- 缓存稳定性：工具描述和 schema 按会话缓存（`src/utils/api.ts:136-160`），只在登出时清空（`src/utils/auth.ts:1266`），没有逐请求变化的文字；会话内变化只来自 MCP 服务器晚连接，MCP 工具排在内置工具之后（`src/utils/toolPool.ts:65-70`），只改变数组尾部。`plan` 权限模式下工具集和文字与 `default` 完全相同。
- 按条件出现的文字：本场景生效的分支与原报告一致（Bash 无沙箱段、Agent 无 fork 段、AskUserQuestion 无 preview 段、EnterPlanMode 带「What Happens」段、TaskCreate/TaskList 无 teammate 段、Agent schema 去掉 `name/team_name/mode`）。被关掉的 ant/feature 文字里，对外部构建有用的只有 Edit 的最小 `old_string` 提示（已列入 T-TOOL-21）；TaskUpdate 的「关掉 3 个任务后派 verification agent」提醒受 `feature('VERIFICATION_AGENT')` 关闭（`src/tools/TaskUpdateTool/TaskUpdateTool.ts:333-347,396-398`），它依赖系统提示词的验证段一起才成立，归 T-SYS 一并判断。
- Glob：描述 371 字符；100 个结果截断时提示「Results are truncated. Consider using a more specific path or pattern.」（`src/tools/GlobTool/GlobTool.ts:157,190-194`），与 ZCode 逐字相同（`zcode:apps/zcode-cli/packages/core/src/tool/handlers/glob.ts:151-152`）。
- Grep 结果：空结果「No matches found」/「No files found」，分页说明 `[Showing results with pagination = ...]`，计数模式给出总数（`src/tools/GrepTool/GrepTool.ts:267-307`），格式清楚。
- Edit、Write 的成功与失败文案（`src/tools/FileEditTool/FileEditTool.ts:193-337,588-595`；`src/tools/FileWriteTool/FileWriteTool.ts:426-432`）：错误原因和下一步写得清楚；Edit 描述的行号前缀格式与 Read 实际输出一致（`src/tools/FileEditTool/prompt.ts:13-15`；`src/utils/file.ts:278-285`）。
- 空结果统一替换为「(<工具名> completed with no output)」（`src/utils/toolResultStorage.ts:286-294`），大结果写盘后给路径和 2KB 预览（`toolResultStorage.ts:189-199`）。
- Bash 结果：失败附「Exit code N」，中断附 `<error>Command was aborted before completion</error>`，后台给任务 id 和输出路径（`src/tools/BashTool/BashTool.tsx:597-622,695-700`）。
- NotebookEdit：描述 513 字符，只讲参数，无问题。
- WebFetch 描述：内容与本场景相符；二次处理提示词（`src/tools/WebFetchTool/prompt.ts:23-47`）发给 fastModel，内容通用，无 Claude 专属。
- Kanban×4、StartSession、ListSessions、RenameSession、ArtifactCheck、ArtifactCopy、ChooseDesignTemplate、UseDesignSystem 的文字本身：与桌面端功能一致，没有发现提到不存在的功能或前后矛盾；问题只在发送条件（T-TOOL-02）。
- 浏览器 MCP 工具的描述：写明页面内容不可信、哪些操作要权限、结果截断位置，质量好；问题只在发送条件和重复参数（T-TOOL-05）。
- MCP 描述截断：超过 2,048 字符截断并标「… [truncated]」（`src/services/mcp/client.ts:218,1705-1710`），服务器 instructions 同样处理（`client.ts:1096-1102`）。
- 语言与格式：所有工具文字为英文；ShowUI 写明组件文档是中文、回复要跟随用户语言（`src/tools/ShowUITool/prompt.ts`），没有发现语言冲突。
- Claude 直连路径：Bash 署名按真实模型名生成，Read 的多模态说法成立，ToolSearch（962 字符）和 WebSearch 按预期出现、D 工具按需加载；这条路径上未发现应改的工具文字（Agent 的 `model` 枚举在这条路径上有意义）。

## 5. 没有核实的地方

- 浏览器 MCP 的 schema 是用仓库 zod 按 `io:'input'` 生成的近似值，MCP SDK 实际生成的 JSON 可能有小差异；「桌面端会话基本都带」依赖浏览器宿主在会话启动前已连上，未实测连接时序。
- KanbanUpdate 的 `oneOf` + `const`、AskUserQuestion/ShowUI/TaskCreate 的 `propertyNames`、ExitPlanMode 的 `additionalProperties: {}`：各 OpenAI 兼容提供方是否接受这些关键字未核实（schema 清理归 P-REQ-13）。
- T-TOOL-11 中模型自填 `answers` 时，权限组件是否覆盖为用户真实回答，未逐行核实。
- T-TOOL-13 中 EnterWorktree 切换目录后桌面端文件面板、diff 的表现未实测。
- T-TOOL-19：ZCode 的同类字段是否也进入 `required` 未核实。
- T-TOOL-22：各提供方函数名长度上限未核实。
- 自定义 agent、插件 agent、用户 MCP 会让 Agent 描述和工具数组更长，未计入。
- token 换算（4 字符/token）和「一次会话 30 个请求」是推断。
- Codex、ZCode 的总量沿用 `comparison/tools.md`，本次只核对了引用到的段落。

## 交给其他维度

- T-SYS：系统提示词「Using your tools」与工具描述的重复（T-TOOL-14 的系统提示词一侧）；verification agent 在 Agent 列表里出现、但系统提示词验证段和 TaskUpdate 提醒被 `feature()` 关闭，是否对外部构建打开。
- T-INJ：计划模式提醒与 EnterPlanMode 结果的矛盾（T-TOOL-09 的提醒一侧）；权限询问和拒绝文字里的「Claude requested permissions to use X」（`src/utils/permissions/permissions.ts:211`、`src/tools/WebFetchTool/WebFetchTool.ts:150,177`）和「because Claude Code is running in don't ask mode」（`src/utils/messages.ts:242-244`）在什么路径下进入 tool_result；Read 结果后追加的恶意软件提醒。
- T-CTX：Skill 列表、agent 列表放在描述里还是提醒里的取舍（T-TOOL-17 的列表一侧）。
- 代理层：P-REQ-03/04（PDF、图片送不到，T-TOOL-04 的根因）；P-REQ-13（schema 关键字）；延迟加载需要代理转换 `tool_reference`（comparison/tools.md Q5）。
