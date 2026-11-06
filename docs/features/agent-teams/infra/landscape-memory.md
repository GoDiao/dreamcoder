# 共享记忆与上下文交接

核实日期：2026-10-23。范围：团队成员之间不重读全部历史就能接上工作的那一层：记忆层产品与库、编码 agent 自带的记忆与指令文件、交接摘要与压缩、相关研究与实践文章。上层产品见 [README](../README.md) 与 [research/](../research/)，同层其他调研见 [landscape-workspace.md](landscape-workspace.md)。背景讨论见 [#162](https://github.com/GoDiao/dreamcoder/issues/162)。

## 0. 读法与核实约定

- 本次只读：没有安装、构建或运行任何被调研的工具；GitHub 只用 `gh` 读接口，网页只做抓取与搜索。
- 「许可证」「仓库创建」「最新 release 与日期」除特别标注外，均来自对应仓库的 GitHub API（`gh api repos/<owner>/<repo>` 与 `.../releases/latest`，2026-10-23 读取）。表格里的名称链接即该仓库，不在每格重复。仓库创建日不等于首次发布，只作成熟度的下限参考。
- GitHub 判定为 NOASSERTION 的仓库，在许可证格里写明读到的实际文本或「未核实」。
- 「未查到」表示查过但没有证据；「不适用」表示问题本身不适用。
- 表中「使用方」只写能给出出处的集成；没有出处的不写。
- 判断与建议只出现在每节表中的「适配」列和文末两节里。
- 「本地」指不需要托管服务即可运行（嵌入式数据库、本地嵌入模型）；「需要 key」指默认配置要求某个模型提供方的 API key。这两项分开列，因为一个库可以本地存储却仍要外部模型来抽取记忆。
- DreamCoder 自己的 fork 源码引用写成 `路径@7a9c743`（本工作树 HEAD）。上游 Claude Code 闭源，只引官方文档。
- 本文讨论的「记忆」有两种写入方式，表中分别标注：模型驱动（模型自己调用工具决定写什么）与运行时驱动（运行时按规则或后台任务抽取）。

---

## 1. 记忆层产品与库

### 1.1 总表

| 名称 | 许可证 | 一句话 | 平台与前提 | 成熟度 | 使用方 | 对 macOS + Windows 桌面应用的适配 |
| --- | --- | --- | --- | --- | --- | --- |
| [Letta](https://github.com/letta-ai/letta)（原 MemGPT）与 [Letta Code](https://github.com/letta-ai/letta-code) | Apache-2.0（两个仓库均是） | 有状态 agent：记忆块（label、description、value、limit）常驻上下文，agent 用内置工具读写，开发者也可经 API 改；一个块可挂到多个 agent，各自上下文里看到同一份数据（[文档](https://docs.letta.com/guides/core-concepts/memory/memory-blocks)，页面称「更新一次，处处可见」）。该页还写明设置 `value` 是整块替换，并发写会互相覆盖 | letta 主仓库 README 已说明当前源码在 letta-code，旧 V1 API 服务端退役、留在 `archive` 分支。Letta Code：TypeScript，`npm install -g @letta-ai/letta-code`；默认用 Letta Cloud，可用 `letta backend local` 切本地；需要 `/connect` 配自己的模型 key；README 另一段写明 wheel 支持 Windows x64（该段属于哪个组件未核），原生 Windows 上自动「dreaming」默认关闭（[letta-code README](https://github.com/letta-ai/letta-code)）。letta-code 的 MemFS：所有上下文（含记忆块）用 git 跟踪，可同步到自建 GitHub 仓库（同 README） | letta 创建 2023-10；最新 release 0.16.8（2026-05-14，旧服务端）。letta-code 创建 2025-10，v0.34.21（2026-10-22） | 使用方：未查到 | 记忆块跨 agent 共享是现成语义，且 Letta Code 是 TypeScript。但它是一整套 agent 运行时，不是可嵌入的记忆库；本地后端的数据存放与并发写行为：未查到 |
| [mem0](https://github.com/mem0ai/mem0) | Apache-2.0 | 记忆层：从对话里抽取事实并检索，按 `user_id`、`agent_id`、`run_id` 作用域区分（[文档](https://docs.mem0.ai/core-concepts/memory-types)；多个 agent 能否共享同一份记忆，该页未直接说明） | 三种形态：库（`pip install mem0ai` 或 `npm install mem0ai`）、自托管服务（docker compose，鉴权默认开启）、托管平台（[README](https://github.com/mem0ai/mem0)）。库模式需要 LLM（默认 OpenAI `gpt-5-mini`）与嵌入模型（默认 `text-embedding-3-small`）（README）。TS 库默认配置：内存向量库 `memory`、历史库 SQLite 文件 `memory.db`、LLM 与嵌入均为 OpenAI（`mem0-ts/src/oss/src/config/defaults.ts@2c81af3`）；Python 库默认本地 Qdrant `/tmp/qdrant` 加 SQLite `~/.mem0/history.db`（[文档](https://docs.mem0.ai/open-source/overview)）。支持的操作系统：未查到 | 创建 2023-06；ts-v3.3.1（2026-09-25）。README 的 LoCoMo 等成绩来自托管平台，称其含开源 SDK 没有的专有优化（README） | README 列出 LangGraph、CrewAI 集成与面向 Claude Code、Codex 等的 skills | 有 TS 库、可本地存储、许可宽松，是同类里最容易嵌入的一个。写入由运行时驱动：每次 `add` 调一次 LLM 抽取，不是 agent 自己决定。要换成本地模型，需把 LLM 与嵌入都改配置 |
| [Zep](https://github.com/getzep/zep) | 仓库 Apache-2.0，但该仓库不是产品：只含示例、集成与已弃用的社区版（`legacy/`） | 托管的 agent 记忆平台；开源社区版已停止支持（[README](https://github.com/getzep/zep)，附 [官方说明](https://blog.getzep.com/announcing-a-new-direction-for-zeps-open-source-strategy/)） | 需注册 Zep Cloud。SDK：Python `zep-cloud`、TypeScript `@getzep/zep-cloud`、Go（README） | zep-ingest-v0.4.0（2026-10-14） | README 的集成列表：Google ADK、Microsoft Agent Framework、AutoGen、CrewAI、LangGraph、Mastra、Vercel AI SDK 等 | 要求托管服务，与本地优先冲突。只作对照 |
| [Graphiti](https://github.com/getzep/graphiti) | Apache-2.0 | 时序知识图谱框架：实体、带有效期的事实边、原始 episode；用 `group_id` 区分图（README） | Python，需自备图数据库：Neo4j 5.26、FalkorDB、Neptune，Kuzu 已标弃用；有嵌入式 `falkordblite`（要求 Python 3.12+）。默认用 OpenAI 做 LLM 与嵌入，需 `OPENAI_API_KEY`，可换 Anthropic、Gemini、Groq 等。自带参考 MCP 与 REST 服务，但 README 明说这两个服务不鉴权，任何调用方可读写删任何 `group_id`（[README](https://github.com/getzep/graphiti)）。Windows：未查到 | 创建 2024-08；v0.31.2（2026-10-20）。论文 [arXiv 2501.13956](https://arxiv.org/abs/2501.13956) | 使用方：未查到（README 称其是 Zep 内部的图构建框架） | 无 TS 客户端（语言：Python）；嵌入式模式要求 Python 3.12+。要么在 sidecar 里跑 Python，要么只借数据模型：事实带有效期、episode 保留出处 |
| [LangMem](https://github.com/langchain-ai/langmem) | MIT | 为 LangGraph 提供的记忆工具与后台记忆管理器：模型在对话中用 `create_manage_memory_tool` 与 `create_search_memory_tool` 读写（模型驱动），另有后台抽取与整合（README） | Python（`pip install langmem`），需要 LLM key；存储用 LangGraph 的 `BaseStore`，README 的示例用内存 store（重启即丢），生产建议 Postgres 类 store；命名空间 `namespace=("memories",)` 区分作用域（[README](https://github.com/langchain-ai/langmem)）。TS 客户端：未查到 | 创建 2025-01；GitHub 没有 release（API 404）；最近提交 2026-10-02 | README：与 LangGraph 平台部署原生集成 | 与 LangGraph 绑定，对我们的 TS 栈价值只在接口设计：模型驱动写入加后台整合两条路径并存 |
| [Cognee](https://github.com/topoteretes/cognee) | Apache-2.0 | 记忆引擎：`remember`、`recall`、`forget`；把文档抽成图加向量，按 dataset 组织（[README](https://github.com/topoteretes/cognee)） | Python 3.10–3.14。v1.6.0 起可「无 LLM key」本地运行：用本地 GLiNER 模型抽取、本地嵌入模型，首次使用下载模型（README）。默认存储都是嵌入式：图库 `ladybug`、向量库 `lancedb`、关系库 `sqlite`（`cognee/infrastructure/databases/{graph,vector,relational}/config.py@37f788b`）。多用户时 API 默认走多租户鉴权，单用户本地需设 `ENABLE_BACKEND_ACCESS_CONTROL=false`（README）。官方有 Claude Code 插件、MCP 服务（`cognee-mcp`，README）。Windows：未查到 | 创建 2023-08；v1.6.5（2026-10-16） | README：Claude Code 插件与 MCP；其他：未查到 | 本地、无需 key、嵌入式存储这三点在本表里最贴近本地优先，但是 Python 栈，要作为 sidecar；首次下载模型的体积与时间：未查到 |
| MCP 官方 [memory 服务](https://github.com/modelcontextprotocol/servers/tree/main/src/memory) | GitHub 判定 NOASSERTION；仓库 LICENSE 说明项目正从 MIT 过渡到 Apache-2.0，新代码为 Apache-2.0，未取得再授权的旧贡献仍为 MIT；该包 `package.json` 写「SEE LICENSE IN LICENSE」 | 本地知识图谱：实体、关系、观察，存成一个 JSONL 文件；模型驱动写入（[README](https://github.com/modelcontextprotocol/servers/blob/main/src/memory/README.md)） | npm 包 `@modelcontextprotocol/server-memory`，Node.js 24 及以上；Windows 用 `cmd /c npx` 启动；`MEMORY_FILE_PATH` 指定文件。README 专门写了多个客户端共用一个文件：每次写入取独占锁文件 `<memory file>.lock`，持锁者每 15 秒刷新，30 秒无刷新视为陈旧，60 秒拿不到锁则该写入报错；依赖本地文件系统的独占创建，网络文件系统不保证（同 README） | 仓库创建 2024-11；v2.0.0（2026-10-19）；包版本 2.0.0 | 使用方：未查到（README 给出 Claude Desktop、VS Code 的配置） | 没有嵌入、没有语义检索，只有图加文本检索；但「多进程共用一个文件加锁」的做法正好是我们的场景，且是 TS |
| [basic-memory](https://github.com/basicmachines-co/basic-memory) | AGPL-3.0 | 本地优先：记忆就是磁盘上的 Markdown 文件，人和 AI 都能读写；经 MCP 暴露（README） | Python；README 称 Claude Desktop 在 macOS、Windows、Linux 可用；另有可选的托管云（README 的 Cloud vs. local 表）。是否需要嵌入与模型 key：未核 | 创建 2024-12；v0.24.0（2026-10-23） | README 的客户端表：Claude Desktop、Codex、Cursor、Obsidian 等 | AGPL 对分发桌面应用有传染风险，只能作为用户自装的外部 MCP 服务；Markdown 文件作为存储形态值得借鉴 |
| [claude-mem](https://github.com/thedotmack/claude-mem) | Apache-2.0 | Claude Code 插件：用生命周期 hook（SessionStart、PostToolUse、Stop 等）捕获会话，压缩成观察与摘要，存 SQLite，加 Chroma 做混合检索；本地 Bun worker 提供 HTTP API 与查看界面；由运行时 hook 驱动写入（[README](https://github.com/thedotmack/claude-mem)） | Bun、SQLite、Chroma；README 有 Windows 安装说明（`%LOCALAPPDATA%\claude-mem\bin\claude-mem.exe`）；可选云同步到 cmem.ai（README）。抽取是否需要模型 key：未核 | 创建 2025-08；v15.0.1（2026-10-20） | 自身面向 Claude Code，README 另提到 Cursor、Grok Bot 的适配 | 栈与 DreamCoder 同为 Bun 加 TS，运行在 CLI 之外，通过 hook 工作，可对照其 hook 事件设计；hook 在 DreamCoder 的 `--print` 模式下是否同样触发：未查到 |
| [mcp-memory-service](https://github.com/doobidoo/mcp-memory-service) | Apache-2.0 | 自托管记忆服务：REST、MCP、OAuth；请求头 `X-Agent-ID` 把记忆自动标上 `agent:<id>` 标签，按标签检索；SSE 推送事件；嵌入用本地 ONNX（README） | Python 服务；存储后端：未核；Windows：README 只给了 Claude Desktop 配置路径 | 创建 2024-12；v12.2.1（2026-10-21） | README：LangGraph、CrewAI、AutoGen、Codex hook | 「按 agent 打标签加事件推送」是最接近多成员共享的做法；单人维护项目，质量未评估 |

### 1.2 小结

- 多 agent 共享的模型有三种：共享记忆块（Letta：同一块挂到多个 agent）、作用域标识加过滤（mem0 的 `user_id`/`agent_id`/`run_id`，LangMem 的命名空间，Graphiti 的 `group_id`，mcp-memory-service 的 `agent:<id>` 标签）、共享文件（MCP memory 的 JSONL，basic-memory 的 Markdown）。
- 写入由谁决定分两类：模型自己调用工具（Letta、LangMem 的热路径、MCP memory）与运行时在后台抽取（mem0 的 `add`、Cognee、claude-mem 的 hook、LangMem 的后台管理器）。mem0 README 说明新算法改为「只加不改」的单次抽取，记忆累积而不覆盖。
- 本地可跑且不需要托管服务的：Cognee（可无 key）、MCP memory、basic-memory、claude-mem、mcp-memory-service；mem0 与 Graphiti 默认都要 OpenAI key；Zep 只有托管。
- 有 TS 客户端或本身是 TS 的：mem0、Letta Code、MCP memory、claude-mem、Zep 的云 SDK。Graphiti、LangMem、Cognee、basic-memory 是 Python。
- 并发写的处理：Letta 文档承认整块替换会覆盖；Graphiti 的参考服务不鉴权；只有 MCP memory 的 README 明确给出多进程加锁规则。

---

## 2. 编码 agent 自带的记忆与指令文件

### 2.1 总表

| 名称 | 许可证 | 一句话 | 平台与前提 | 成熟度 | 使用方 | 适配 |
| --- | --- | --- | --- | --- | --- | --- |
| Claude Code 的 CLAUDE.md 与规则文件（[文档](https://code.claude.com/docs/en/memory.md)） | 闭源 | 人写的指令，会话开始时整份载入：项目、用户、本地、托管策略四个位置，`@path` 导入，`.claude/rules/` 可按路径作用域加载；子目录的 CLAUDE.md 在 Claude 读写该目录文件后才加载；AGENTS.md 在没有 CLAUDE.md 时直接读取（需 v2.1.277 及以上） | 官方文档给出 Windows 托管策略路径 `C:\Program Files\ClaudeCode\CLAUDE.md`；在 Windows 上用符号链接共享 AGENTS.md 需要管理员权限或开发者模式，文档建议改用 `@AGENTS.md` 导入 | 上游 v2.1.309（2026-10-22，[anthropics/claude-code](https://github.com/anthropics/claude-code)）；DreamCoder fork 兼容 2.1.92，上述各项在 fork 中是否都存在：未查到 | Claude Code | 所有成员天然读同一份项目指令，是目前零成本的共享上下文。文档同时说明 CLAUDE.md 是上下文而非强制配置 |
| Claude Code 的 auto memory（同上文档「Auto memory」节） | 闭源 | Claude 自己写笔记，分 user、feedback、project、reference 四类；每个项目一个目录 `~/.claude/projects/<project>/memory/`，`MEMORY.md` 是索引，开头 200 行或 25KB 在每次会话载入，主题文件按需读取 | 本地文件；目录按 git 仓库推导，同仓库的所有 worktree 与子目录共用一个目录；文档称「不跨机器共享」；`autoMemoryEnabled`、`autoMemoryDirectory`、环境变量 `CLAUDE_CODE_DISABLE_AUTO_MEMORY` 控制；非交互的后台会话与由另一个 Claude 会话启动的会话里，开关不能再打开（同页） | 同上 | 模型驱动写入 | 同仓库多个 worktree 共用一份，这正好是「每成员一个 worktree」的共享记忆现成载体；并发写入同一目录的冲突规则：未查到 |
| Claude Code 的子 agent 记忆（[sub-agents 文档](https://code.claude.com/docs/en/sub-agents.md)） | 闭源 | frontmatter 的 `memory` 字段给子 agent 一个持久目录，范围 `user`、`project`（`.claude/agent-memory/<name>/`，可入版本控制）、`local`；`MEMORY.md` 前 200 行或 25KB 进系统提示；自动开启读写编辑工具。主会话的 auto memory 不会载入非 fork 的子 agent，二者是不同目录 | 受 auto memory 总开关控制 | 同上 | Claude Code | 这是「按角色存经验」的现成做法，按 agent 名而不是按个体实例区分 |
| Claude Code 子 agent 与队友的起始上下文（同上，另见 [agent-teams 文档](https://code.claude.com/docs/en/agent-teams.md)「Context and communication」） | 闭源 | 非 fork 子 agent 不继承父对话，只得到自己的系统提示、委派任务消息、CLAUDE.md 全套、git 状态快照；fork 才继承整个对话。队友载入与普通会话相同的项目上下文（CLAUDE.md、MCP、skills），再加 lead 的 spawn 提示，lead 的对话历史不带过来 | 子 agent 转录存 `~/.claude/projects/{project}/{sessionId}/subagents/agent-{agentId}.jsonl`，不受主会话压缩影响，可用 `SendMessage` 恢复；队友文档同样写明 `/resume` 不恢复同进程队友 | 同上 | Claude Code | 事实上成员间的「交接」只有两样：spawn 提示与消息。issue [#23669](https://github.com/anthropics/claude-code/issues/23669) 请求每队友独立 CLAUDE.md（见 [research/claude-code.md](../research/claude-code.md)） |
| DreamCoder fork 里的记忆代码 | 闭源衍生，仓库内源码 | fork 保留了 `src/memdir/`（自动记忆目录、团队记忆路径）、`src/services/extractMemories/`（回合结束后台抽取）、`src/services/SessionMemory/`（用分叉的子 agent 维护本会话笔记）、`src/services/teamMemorySync/`、`src/tools/AgentTool/agentMemory.ts`（子 agent 记忆三种作用域）（均 `@7a9c743`） | 自动记忆开关逻辑见 `src/memdir/paths.ts:30-55@7a9c743`，默认开启。后台抽取、SessionMemory、团队记忆分别受 GrowthBook 开关 `tengu_passport_quail`、`tengu_session_memory`、`tengu_herring_clock` 控制，默认值均为 false（`paths.ts:70`、`SessionMemory/sessionMemory.ts:81`、`teamMemPaths.ts:77@7a9c743`）；而 [research/claude-code.md](../research/claude-code.md) 已确认 fork 的 GrowthBook 整体关闭，所以这三项取默认值，即不运行（推断，未实际运行验证）。团队记忆同步走 Anthropic 的 `/api/claude_code/team_memory` 并要求 Claude.ai OAuth 登录（`teamMemorySync/index.ts:1-25@7a9c743`），第三方 provider 用户用不了 | 同 fork | DreamCoder | 已有一套未启用的实现可读：抽取在后台由分叉的子 agent 做，写入受限工具集（`extractMemories.ts` 的 `createAutoMemCanUseTool`）。团队记忆依赖 Anthropic 服务，不能直接用 |
| Codex 的 AGENTS.md（[源码](https://github.com/openai/codex/blob/f3a90545aed3188ee1e5c119ec89a742de399cdc/codex-rs/core/src/agents_md.rs)） | Apache-2.0 | 从项目根（默认以 `.git` 为标记）到当前目录，逐层收集每个 `AGENTS.md` 并按顺序拼接，不越过项目根；`AGENTS.override.md` 为本地覆盖；用户级与项目级以 `--- project-doc ---` 分隔拼接；总大小上限 `project_doc_max_bytes`，默认 32 KiB（`codex-rs/core/src/config/mod.rs:257`，均 `@f3a9054`） | 随 Codex，三平台 | openai/codex 创建 2025-04；rust-v0.163.0（2026-10-15） | Codex；Claude Code 也读 AGENTS.md（见上） | AGENTS.md 已是跨产品事实标准，我们不必另立项目指令格式 |
| Codex memories（[文档](https://learn.chatgpt.com/docs/customization/memories?surface=app)，源码 `codex-rs/memories/README.md@f3a9054`） | Apache-2.0 | 默认关闭，在设置或 `config.toml` 的 `[features]` 里 `memories = true` 开启。后台两阶段：阶段一从空闲的历史会话各抽出一份结构化记忆（详细 `raw_memory`、简短 `rollout_summary`），写入状态库并脱敏；阶段二在全局锁下把选中的阶段一结果合并成文件（`raw_memories.md`、`rollout_summaries/`），放在 `~/.codex/memories/`（该目录自带 git 基线），再启动一个内部整合子 agent，无审批、无网络、只有本地写权限 | 触发条件含：根会话启动、非临时会话、非子 agent 会话、状态库可用（README）。开关按机器，另有每个对话的 `/memories` 控制；用了 MCP 或网页搜索的对话可设为不参与生成；文档称秘密会被脱敏但不是整体排除。IDE 扩展用所连接主机的存储。协议层有 `ThreadMemoryMode`（enabled、disabled）（`app-server-protocol/schema/typescript/ThreadMemoryMode.ts`）。Windows：文档只写了「Computer History」仅 macOS，其他平台限制未提 | 同上 | Codex | 运行时驱动写入，且明确跳过子 agent 会话，所以它不是多 agent 共享机制，而是跨会话的个人经验。两阶段加全局锁加 git 基线的整合做法值得拆 |
| Anthropic API 的 memory tool（[文档](https://platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool)） | 服务条款，不适用开源许可 | 客户端实现的文件式记忆：模型发出 view、create、str_replace、insert、delete、rename，应用自己执行并决定存储位置，`/memories` 只是前缀；API 自动在系统提示里加上「先查看记忆目录」的协议；Python 与 TS 的 SDK 自带本地文件系统实现 `BetaLocalFilesystemMemoryTool` | 需要 Claude API；文档要求实现者自己做路径穿越防护、体积上限、过期清理 | 工具类型 `memory_20250818`；文档称不需要 beta 头，SDK 辅助放在 beta 命名空间 | 官方 SDK 示例 | 模型驱动写入；DreamCoder 使用第三方 provider 时能否用：未查到。文档给出的「多会话开发」模式（初始化会话建进度日志与功能清单，后续会话先读它们，结束前更新）可直接作为成员交接约定 |
| Cline 的 Memory Bank（源文件 `docs/best-practices/memory-bank.mdx@1619168`） | Apache-2.0（[cline/cline](https://github.com/cline/cline)） | 纯约定：在项目里放 `memory-bank/` 目录（projectbrief、productContext、activeContext、systemPatterns、techContext、progress 六个 Markdown），靠 `.clinerules` 里的自定义指令让模型每次先读、结束时更新 | 不依赖任何服务；任何能读写文件的 agent 都能照做 | cline desktop-v0.0.48（2026-10-17） | Cline 用户 | 纯文件加提示词的做法，零基础设施；没有并发控制，多成员同时写 `activeContext.md` 会冲突 |

### 2.2 小结

- 三家（Claude Code、Codex、Cline）的共同点：项目级指令是人写的 Markdown，会话开始时整份载入；跨会话经验是模型或后台任务写的 Markdown 文件，只在开头载入索引，细节按需读取。没有一家在默认配置里提供「多个并发成员共享同一份可写记忆并带并发控制」。
- Claude Code 的 auto memory 按 git 仓库而不是按目录划分，所以同仓库的所有 worktree 共用同一目录；这一点决定了「每成员一个 worktree」不会自动带来记忆隔离。
- 成员的起始上下文：Claude Code 子 agent 与队友不带 lead 历史；Codex 的 `spawn_agent` 有 `fork_turns` 参数，取 `all`（默认，继承父历史）或 `none`（[research/codex.md](../research/codex.md) 引 `codex-rs/core/src/tools/handlers/multi_agents_v2/spawn.rs:203-239@2f3fb11`）。两家都提供「继承全部」与「只给任务描述」两个极端，没有中间的「按需裁剪」。
- DreamCoder fork 里与记忆相关的服务端同步部分依赖 Anthropic 账号，其余本地部分默认大多没有启用。

---

## 3. 交接摘要与压缩

### 3.1 总表

| 名称 | 许可证 | 一句话 | 平台与前提 | 成熟度 | 使用方 | 适配 |
| --- | --- | --- | --- | --- | --- | --- |
| Claude Code 压缩（[how-claude-code-works](https://code.claude.com/docs/en/how-claude-code-works.md)「When context fills up」） | 闭源 | 接近上限时先清旧工具输出，再必要时总结对话；用户请求与关键代码片段保留，早期的详细指令可能丢失；可在 CLAUDE.md 加「Compact Instructions」节或 `/compact <焦点>` 控制保留内容；反复触发时停止并报错而不死循环 | 子 agent 按自身窗口自动压缩，`autoCompactWindow` frontmatter 可提前触发（需 v2.1.296 及以上，sub-agents 文档） | 上游 v2.1.309 | Claude Code | fork 有 `src/services/compact/`（含 `sessionMemoryCompact.ts`、`autoCompact.ts`，`@7a9c743`）。队友在同进程内自行压缩（[research/claude-code.md](../research/claude-code.md) 第 12 节），lead 被压缩后团队丢失见 [#23620](https://github.com/anthropics/claude-code/issues/23620) |
| Anthropic API 服务端压缩（[compaction 概览](https://platform.claude.com/docs/en/build-with-claude/compaction)） | 服务条款 | 服务端写摘要替换旧轮次，分三种：按需（beta 头 `compact-2026-09-04`）、按 token 阈值、自写摘要器；按需模式可保留最近几轮原文、可在后台进行、可自定义摘要提示词 | 需要 Claude API | 概览页标明两种内置模式均为 beta | 官方 SDK | 与 memory tool 配合：文档建议压缩管上下文大小，记忆保存必须跨摘要存活的信息 |
| Codex 压缩（`codex-rs/core/src/compact.rs`、`codex-rs/prompts/templates/compact/*.md`@`f3a9054`） | Apache-2.0 | 摘要提示词明确写成「为将要接手的另一个模型写交接摘要」：当前进展与关键决定、约束与用户偏好、剩余工作与下一步、继续所需的关键数据；压缩后历史由用户消息加摘要拼成，摘要前缀声明「另一个模型开始了这个问题并产出了摘要」；用户消息保留上限 20,000 token（`COMPACT_USER_MESSAGE_MAX_TOKENS`）。另有远程压缩（`compact_remote_v2*.rs`）与异步压缩（`session/async_compaction.rs`） | 随 Codex | 同 Codex | Codex | 提示词很短，可直接作为我们的成员交接摘要模板的起点；「摘要即交接」的措辞与我们的需求一致 |
| Codex 根会话到子 agent 的交接（`codex-rs/core/src/agent/control/root_handoff.rs@f3a9054`） | Apache-2.0 | 为审查（guardian）选取根会话里与 `spawn_agent`、`send_message`、`followup_task` 派发相对应的窗口，加最近 3 条根上下文；用户输入不过滤，只收窄助手内容；文件头注释称不保存交接状态 | 同上 | 同上 | Codex 的 guardian | 「按派发点裁剪上下文」是目前找到的唯一一例有源码的中间态做法，但它服务于审批审查，不是成员交接 |
| [Amp handoff](https://ampcode.com/news/handoff)（2025-10-23） | 闭源（[sourcegraph/amp](https://github.com/sourcegraph/amp) 返回 404，仓库未找到） | 取代压缩：用户说出新线程的目标，Amp 分析当前线程，生成起始提示与相关文件列表，作为草稿放进新线程，用户可审阅编辑后发送；Amp 称压缩会鼓励冗长线程、摘要叠摘要 | CLI 用 `/handoff`，编辑器扩展从用量悬浮处进入（同页） | 公告日期 2025-10-23；之后是否变化：未查到 | Amp | 唯一一例把「交接」做成人可审阅草稿的产品；按目标生成而不是按历史生成，与「成员只需要与自己任务相关的上下文」同向 |
| OpenCode 压缩（[文档源文件](https://github.com/anomalyco/opencode/blob/ff836323b77bff2bfe57b12b28117b2ea2a25ef5/services/www/src/docs/content/compaction.mdx)） | MIT | 接近上限时总结整个对话，并把最近约 15,000 token 原文放在摘要旁（`compaction.keep.tokens`）；发送全量对话以复用提示缓存；后续压缩基于上一个检查点更新摘要；文档自述压缩有损；有 HTTP 接口 `POST /api/session/<id>/compact` | 随 OpenCode；桌面端有 Windows 安装包（见 [landscape-workspace.md](landscape-workspace.md) 第 4 节） | v1.19.4（2026-10-22） | OpenCode | 「摘要加最近原文」的混合做法与 Anthropic 的按需压缩保留最近轮次一致 |
| Cline `/newtask` 与 `/smol`（[文档](https://docs.cline.bot/features/slash-commands/new-task)） | Apache-2.0 | `/newtask`：开一个干净上下文的新任务，把总体计划、已完成工作、相关文件、下一步带过去，不带工具调用与实现细节；`/smol`（别名 `/compact`）：在原任务里压成摘要 | 随 Cline | 同 Cline | Cline | 与 Amp handoff 同一思路，且是用户触发 |
| 子 agent 的「返回摘要」模式 | 不适用 | 子 agent 在独立窗口工作，只把简短摘要返回给调用方；Anthropic 的文章称子 agent 可能用掉数万 token 探索，返回约 1,000–2,000 token 的摘要（[Effective context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)，2025-09-29） | 同上 | 不适用 | Claude Code 子 agent（[文档](https://code.claude.com/docs/en/how-claude-code-works.md)「Manage context with skills and subagents」） | 这是现有「成员完成后向 lead 汇报」的通用做法；Claude Code 队友的空闲通知已带最终回答（[research/claude-code.md](../research/claude-code.md)） |

### 3.2 小结

- 两种交接哲学：压缩（自动、就地、摘要替换历史：Claude Code、Codex、OpenCode、Anthropic API）与交接（用户或 agent 按下一步目标生成新起点：Amp handoff、Cline `/newtask`）。Amp 公告把后者描述为对前者的替代。
- 所有压缩实现都承认有损：OpenCode 文档、Amp 公告、Claude Code 文档（早期详细指令可能丢失）。保留最近内容的做法：OpenCode 默认保留最近 15,000 token 原文；Anthropic API 的按需压缩有保留最近轮次的选项；Anthropic 的 context engineering 文章称 Claude Code 的压缩另保留最近访问的五个文件（见第 4 节）。
- 没有找到「摘要由接收方成员而不是发送方定制」的做法：Amp handoff 与 `/newtask` 的目标由人给出，Codex 的压缩提示词没有接收方参数。

---

## 4. 研究与实践文章

### 4.1 总表

| 名称 | 类型与日期 | 一句话 | 与成员间上下文相关的可核实内容 | 适配 |
| --- | --- | --- | --- | --- |
| Anthropic，[How we built our multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system) | 工程文章 | 一个 lead 加并行子 agent 的研究系统 | lead 把计划存进记忆，因为上下文超过 200,000 token 会被截断；子 agent 把工作写入外部存储，只向 lead 返回轻量引用，以避免信息在转述中退化；委派要给目标、输出格式、工具指引、任务边界，含糊的委派导致重复劳动；多 agent 用的 token 约为聊天的 15 倍，token 用量解释了 BrowseComp 评测约 80% 的性能差异；文章称编码任务可并行的子任务较少、依赖较多，不如研究任务适合；lead 同步等待子 agent，子 agent 之间不能协调（均出自该文各节） | 「写文件、传引用」与我们的文件系统工作区一致；「编码任务不太适合」是该文的原话方向，需要在 RFC 里面对 |
| Cognition，[Don't Build Multi-Agents](https://cognition.com/blog/dont-build-multi-agents)（Walden Yan，2025-06-12，原 cognition.ai 域名重定向） | 观点文章 | 反对并行多 agent | 两条原则：共享完整上下文（含完整 agent 轨迹，而不只是单条消息）；行动包含隐含决定，并行子 agent 若各自带着未说明且冲突的假设会产出不一致结果。主张单线程的线性 agent；上下文超限时用专门模型把历史压成关键事实，作者称这很难做好 | 这是对我们方向的最直接反方意见。文章讲的是并行子 agent 同时决策的场景，对「各自改不同文件的成员」是否同样适用，文章未区分 |
| Anthropic，[Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)（2025-09-29） | 工程文章 | 上下文管理的三种手段 | 压缩（Claude Code 的摘要保留架构决定、未解决的 bug、实现细节，丢弃冗余工具输出，另保留最近访问的五个文件；先追求召回，再提高精度）；结构化笔记（把笔记写到上下文之外，如待办清单与 NOTES.md）；子 agent 架构 | 为第 3 节提供厂商侧的设计依据 |
| Anthropic，[Effective harnesses for long-running agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)（2025-11-26） | 工程文章 | 跨多个会话的交接靠工件而非记忆 | 初始化 agent 写 `init.sh`、进度日志、首个 git 提交、功能清单（JSON，每项带 `passes` 标志，只能在端到端验证后翻转；作者选 JSON 因为模型较少改坏它）；每个后续会话开头读工作目录、近期 git 日志与进度文件、功能清单，再跑 `init.sh` 做一次基本检查 | 与 memory tool 文档的「多会话开发模式」一致；这是不依赖任何记忆库的最小交接方案 |
| Yu 等，[Multi-Agent Memory from a Computer Architecture Perspective](https://arxiv.org/abs/2603.10062)（2026-03-09 提交，3-30 修订） | 立场论文 | 把多 agent 记忆当作计算机体系结构问题 | 比较共享与分布式记忆，提出 I/O、缓存、主存三层，指出两个协议缺口（跨 agent 缓存共享、结构化记忆访问控制），称多 agent 记忆一致性是最紧迫的开放问题。立场论文，没有实验 | 提供词汇，没有可用实现 |
| [Always-On Agents: A Survey of Persistent Memory, State, and Governance in LLM Agents](https://arxiv.org/abs/2606.30306)（2026-06-29） | 综述 | 持久状态的治理 | 综述 435 篇工作，称研究多集中在存与取，较少涉及治理、恢复与删除；提出试评协议 AOEP-v0（摘要所述）。摘要未提共享记忆细节，正文共享记忆一节：搜索摘要称其论及共享读写的访问控制与脏状态扩散，本次未读全文 | 与我们对「写入前先问、先快照」的关切同向，需读全文再引用 |
| [Exploring Advanced LLM Multi-Agent Systems Based on Blackboard Architecture](https://arxiv.org/abs/2507.01701)（2025-07-02） | 论文 | 黑板架构的多 agent | 各角色 agent 能看到黑板上的全部信息与彼此消息，按黑板内容选择下一个行动的 agent，循环到达成共识；在常识、推理、数学数据集上平均优于静态与动态多 agent 基线且 token 更少（摘要）。没有编码任务评测 | 对应「共享一块可读写区」的最简模型，证据来自非编码任务 |
| [Mem0: Building Production-Ready AI Agents with Scalable Long-Term Memory](https://arxiv.org/abs/2504.19413)（2025-04-28） | 论文（厂商） | mem0 的算法与评测 | 摘要称在 LOCOMO 上相对 OpenAI 记忆有 26% 的相对提升（LLM-as-judge），p95 延迟降 91%，token 成本比全上下文降 90% 以上。均为作者自测 | 评测对象是对话问答，不是编码协作 |
| [Zep: A Temporal Knowledge Graph Architecture for Agent Memory](https://arxiv.org/abs/2501.13956) | 论文（厂商） | Graphiti 的时序图设计 | 由 Graphiti README 链接；摘要与作者本次未抓取，不引具体数字 | 同上 |
| [MemGPT](https://arxiv.org/abs/2310.08560)；Letta 的 [sleep-time compute](https://arxiv.org/abs/2504.13171) | 论文 | Letta 的理论来源 | 两篇均由 letta-code README 链接，本次未读摘要 | 仅作出处 |

### 4.2 小结

- 实践文章与论文给出的证据偏向同一个方向：交接靠外部工件（文件、进度日志、清单、引用）比靠对话转述更稳（Anthropic 两篇），同时 Cognition 认为并行 agent 的主要风险是隐含决定不一致，不是上下文量。两种说法并不矛盾，但没有一篇给出编码场景下的对照数据。
- 本次没有找到测量「子 agent 摘要损失了多少信息」的论文。搜索只给出实践博客与少数相关论文（CodeDelegator 的 IJCAI 2026 论文称每个子任务用干净上下文的新 Coder 并分离调试轨迹；SearchSwarm），均未读原文，故不列入上表。
- 论文里关于共享记忆一致性的内容，目前只有立场与综述，没有可复现实现。

---

## 5. 值得深拆的候选

下面只写意见，按推荐顺序，均按 [_template.md](_template.md) 的格式做完整拆解。

1. Claude Code 的 auto memory 与子 agent 记忆，连同 DreamCoder fork 里的 `memdir`、`extractMemories`、`SessionMemory`、`agentMemory`。这是我们已有的、与 CLI 同进程的记忆机制，按仓库共享、跨 worktree 共用，文档与源码都能读。要回答：默认开启的写入在多成员并发时会不会互相覆盖，后台抽取为什么被关、重新打开要什么条件。
2. Codex 的压缩提示词与记忆管线（`compact.rs`、`prompts/templates/compact`、`memories/`）。Apache-2.0，源码可读；压缩提示词本身就是「写给接手者的交接摘要」，两阶段记忆整合带全局锁与 git 基线，可借。
3. MCP 官方 memory 服务的多进程加锁方案。TS，文件级，README 里给出了锁的规则与失败模式，正好对应「多个 CLI 进程共用一份记忆」。拆解要看实现是否与 README 一致，以及 README 所述每次写入都「读、改、存」整个图，在记忆变大时的代价。
4. Letta 的记忆块共享。唯一把「同一块记忆挂给多个 agent」做成一等概念的产品，且新主线是 TS。要看块的并发写规则、Letta Code 本地后端的实际存储，以及能否只借数据模型。
5. Amp handoff 与 Cline `/newtask`。「按目标生成交接草稿、人可审阅」是我们 RFC 中「成员之间不重读全部历史」最直接的参照；Amp 闭源，只能拆文档与行为。
6. Cognee。唯一同时满足本地、可无 key、嵌入式存储的图加向量记忆，Apache-2.0；代价是 Python 栈与首次模型下载。可作为「要不要引入语义记忆」的参照物，而不是首选依赖。

没有列入的：Zep（只有托管）、Graphiti（要图数据库与 OpenAI key，参考服务不鉴权）、LangMem（绑 LangGraph）、basic-memory（AGPL）、mem0（可嵌入但抽取靠外部 LLM，功能重心是个性化对话记忆而非多成员协作，列为对照即可）、论文类（没有可复现实现）。

## 6. 空白

按我们的需求逐项列出，目前没有找到做得好的现成方案：

1. 多个并发成员共享同一份可写记忆并带并发控制：Letta 文档自承整块替换会覆盖，Claude Code 的 auto memory 没有说明并发规则，只有 MCP memory 服务的 README 明确写了多进程加锁，但它没有语义检索。
2. 按接收方任务裁剪的上下文交接：现有产品只有两个极端（只给任务描述，或继承全部历史，如 Claude Code 的 fork 与 Codex 的 `fork_turns`），Codex 的 guardian 交接只服务于审批审查；Amp handoff 的目标由人写。没有找到「lead 派活时由运行时自动生成与该任务相关的摘要」的实现。
3. 摘要损失的度量：压缩与交接的有损性都被厂商承认，但没有找到编码场景下「摘要后成员是否重复劳动、是否违背已定决定」的量化结果。
4. 本地、跨语言可嵌入的记忆层：能本地跑且无需 key 的（Cognee、claude-mem、MCP memory）里，只有后两者是 JS 或 TS 生态，而它们或绑定特定 agent，或没有语义检索；mem0 的 TS 库默认要 OpenAI key。换成本地嵌入与本地 LLM 的实际效果：未查到。
5. 记忆写入的权限与审计：Always-On Agents 综述指出研究偏重存取、轻治理；Graphiti 参考服务不鉴权；Codex 记忆只做脱敏。成员写进共享记忆的内容，是否需要 lead 或用户确认、能否回滚，没有找到现成做法。
6. 第三方 provider 下的官方记忆能力：Claude Code 的团队记忆同步要求 Claude.ai 登录；Anthropic 的 memory tool 与服务端压缩是否能在非 Anthropic provider 上使用，未查到。
7. 记忆在 `--print` 驱动模式下的行为：auto memory 的读写、hook 与后台抽取在 `--print` 下是否照常工作，本次未做运行验证，只读了源码里的开关。
8. Windows 上的验证：Graphiti、mem0（官方 OSS 文档）、Cognee、basic-memory 的原生 Windows 支持，本次均未查到明确说明；只有 Letta Code、MCP memory、claude-mem 在文档里给出了 Windows 的具体说明。
