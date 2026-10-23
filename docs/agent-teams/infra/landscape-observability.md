# 可观测性全景

核实日期：2026-10-23。范围：为同一项目并行运行多个编码 agent 时，按成员的追踪、成本与统一活动流：数据怎么产生（标准与 agent 自带的遥测）、怎么存和看（后端平台）、能否本机离线运行、多 agent 的父子关系怎么建模。上层产品见 [README](../README.md) 与 [research/](../research/)，同级的网关层见 [landscape-gateway.md](landscape-gateway.md)。背景讨论见 [#162](https://github.com/GoDiao/dreamcoder/issues/162)（「a combined activity stream of all members」「Cost per member」）。

## 0. 读法与核实约定

- 本次只读：没有安装、构建或运行任何被调研的工具；GitHub 只用 `gh` 读接口，网页只读。
- 「许可证」「仓库创建」「最新 release 与日期」除特别标注外，均来自对应仓库的 GitHub API（`gh api repos/<owner>/<repo>` 与 `.../releases/latest`，2026-10-23 读取）。表格里的名称链接即该仓库或文档，不在每格重复。
- GitHub 判定为 NOASSERTION 的仓库，在许可证格里写明读到的实际文本或「未核实」。
- 「未查到」表示查过但没有证据；「不适用」表示问题本身不适用。
- 表中「使用方」写集成或使用的 agent 产品，没有出处的不写；「平台与前提」里同时写能否本机离线运行。
- 判断与建议只出现在每节的「适配」列和文末两节里。
- 几条会反复引用的前提：
  1. DreamCoder 的 CLI 是 `--print` 模式，团队在一个进程内以 AsyncLocalStorage 区分队友（[#162](https://github.com/GoDiao/dreamcoder/issues/162)）。fork 里已有 `src/utils/telemetry/`（含 `instrumentation.ts`、`sessionTracing.ts`、`betaSessionTracing.ts`、`perfettoTracing.ts`）。`sessionTracing.ts` 中增强遥测写在 `feature('ENHANCED_TELEMETRY_BETA')` 之后，再由环境变量 `CLAUDE_CODE_ENHANCED_TELEMETRY_BETA` 或 `ENABLE_ENHANCED_TELEMETRY_BETA` 打开；该编译开关在发布构建里是否开启：未核。同文件中搜索 `agent_id`、`agentId` 无结果。
  2. 成本数字是估算：Claude Code 本地按 token 数乘列表价；订阅用户的会话成本数字与计费无关（[costs](https://code.claude.com/docs/en/costs.md)）。详见 [landscape-gateway.md](landscape-gateway.md) 第 5 节。

---

## 1. 标准、schema 与 agent 自带遥测

### 1.1 总表

| 名称 | 许可证 | 一句话 | 平台与前提 | 成熟度 | 使用方 | 适配 |
| --- | --- | --- | --- | --- | --- | --- |
| [OpenTelemetry GenAI 语义约定](https://github.com/open-telemetry/semantic-conventions-genai)（已从 `open-telemetry/semantic-conventions` 迁出，旧页只剩跳转，[旧页](https://opentelemetry.io/docs/specs/semconv/gen-ai/)） | Apache-2.0 | agent 与框架 span 的约定，状态为 Development：`create_agent`（CLIENT）、`invoke_agent`（远程服务为 CLIENT，同进程为 INTERNAL，例子有 LangChain、CrewAI agents）、`invoke_workflow`、`plan`、`execute_tool`；属性含 `gen_ai.agent.id`、`gen_ai.agent.name`、`gen_ai.agent.version`、`gen_ai.conversation.id`、`gen_ai.workflow.name`（[gen-ai-agent-spans.md](https://github.com/open-telemetry/semantic-conventions-genai/blob/main/docs/gen-ai/gen-ai-agent-spans.md)） | 纯规范，三平台无关。多 agent 的父子关系：没有专门的「父 agent」属性，靠普通 span 嵌套表达；文档写明 agent 或工具在内部起 runner 去委派子 agent 时不应再报 `invoke_workflow`；`gen_ai.agent.id` 不建议填内存中的实例 ID，因为它是瞬时的（同页） | 仓库创建 2026-05-05；最近提交 2026-10-21；未打 release | 使用方：未查到逐个清单；OpenLLMetry README 称其语义约定已并入 OpenTelemetry | 是唯一的跨后端标准；Development 状态意味着属性名仍可能变 |
| [OpenInference](https://github.com/Arize-ai/openinference) | Apache-2.0 | Arize 的追踪约定与各框架插桩；每个 span 必带 `openinference.span.kind`，取值含 `AGENT`、`TOOL`、`CHAIN`、`LLM`、`EVALUATOR`、`DECISION` 等；agent 图用 `graph.node.id`、`graph.node.parent_id`、`graph.node.name`，`parent_id` 为空即根节点；`AGENT` span 有 `agent.name`（[semantic_conventions.md](https://github.com/Arize-ai/openinference/blob/main/spec/semantic_conventions.md)） | Python 与 JS 插桩包，本机运行 | 创建 2023-12；最近提交 2026-10-23 | Phoenix（见 2.1）；Langfuse 的 OTLP 端点会映射 `llm.*`、`input.value`、`output.value`（[Langfuse OTel 文档](https://langfuse.com/integrations/native/opentelemetry)） | 多 agent 的显式图结构只有它有标准属性（`graph.node.*`），与 OTel 的纯嵌套方案不同 |
| [OpenLLMetry](https://github.com/traceloop/openllmetry)（Traceloop） | Apache-2.0 | 一组基于 OpenTelemetry 的 LLM、向量库插桩，输出标准 OTel 数据，可接任何 OTel 后端（README） | Python；JS 版 [openllmetry-js](https://github.com/traceloop/openllmetry-js)（Apache-2.0，最近提交 2026-06-18） | 创建 2023-09；0.62.4（2026-09-29）。Traceloop 在 2026-03 宣布加入 ServiceNow，称 OpenLLMetry 保持开源（[官方博客](https://traceloop.com/blog/traceloop-is-joining-servicenow)） | README 列出 LiteLLM、AWS Strands 等框架 | 是对「调用 SDK 的代码」插桩，不覆盖被包装的 CLI 进程 |
| Claude Code 自带 OpenTelemetry | 闭源 | `CLAUDE_CODE_ENABLE_TELEMETRY=1` 后导出指标与事件（`OTEL_METRICS_EXPORTER` 取 `otlp`、`prometheus`、`console`、`none`；`OTEL_LOGS_EXPORTER` 取 `otlp`、`console`、`none`；协议 grpc、http/json、http/protobuf）；指标含 `claude_code.session.count`、`claude_code.cost.usage`（美元）、`claude_code.token.usage`、`claude_code.lines_of_code.count` 等；事件含 `claude_code.api_request`（带 `cost_usd`、`cost_usd_micros`）、`claude_code.tool_result`、`claude_code.tool_decision` 等；追踪为 beta，需再设 `CLAUDE_CODE_ENHANCED_TELEMETRY_BETA=1` 与 `OTEL_TRACES_EXPORTER`，span 为 `claude_code.interaction`（每个用户提示一个根）、`claude_code.llm_request`、`claude_code.tool`、`claude_code.tool.blocked_on_user`、`claude_code.tool.execution`；Agent 工具派生的子 agent 的 span 嵌套在父的 `claude_code.tool` span 之下；提示与工具内容默认脱敏（[monitoring-usage](https://code.claude.com/docs/en/monitoring-usage.md)） | 随 Claude Code，导出到本机 `localhost` 的 OTLP 端点即可离线使用（同页示例）。成员标识：`llm_request` 与 `tool` span 上有 `agent_id`（发请求的子 agent 或队友）与 `parent_agent_id`，主会话上缺省；`agent.name`（子 agent 类型）在成本与 token 计数器和 `api_request` 等事件上，用户自定义名默认替换为 `custom`，`OTEL_LOG_TOOL_DETAILS=1` 才显示；`query_source` 取 `main`、`subagent`、`auxiliary`；`agent_id` 是否出现在指标与事件上：页面可读部分未列出，未查到。订阅用户的 `cost_usd` 取值：未查到 | 上游 v2.1.309（2026-10-22，[anthropics/claude-code](https://github.com/anthropics/claude-code)）；追踪标 beta。fork 兼容 2.1.92，见 0 节前提 1 | Claude Code | 在同进程队友场景下，按成员的追踪标识只在 span 上；指标侧只有 `agent.name`。fork 的 span 代码里没有 `agent_id`，需要对照补 |

### 1.2 小结

- 标准有两套并存：OTel 是嵌套加 `gen_ai.*` 属性、没有专门的父 agent 字段；OpenInference 是 span 种类加显式图属性。Langfuse 同时能映射两者。
- Claude Code 的遥测给出的「成员」粒度：追踪上有 `agent_id` 与 `parent_agent_id`，计数器上只有子 agent 类型。teammate 的稳定 ID 规则见 [landscape-gateway.md](landscape-gateway.md) 第 4 节。

---

## 2. 后端平台

### 2.1 总表

| 名称 | 许可证 | 一句话 | 平台与前提 | 成熟度 | 使用方 | 适配 |
| --- | --- | --- | --- | --- | --- | --- |
| [Langfuse](https://github.com/langfuse/langfuse) | `LICENSE`：`ee/`、`web/src/ee/`、`worker/src/ee/` 目录以外为 MIT Expat，该三处另有许可；版权人 ClickHouse（GitHub 判定 NOASSERTION） | 追踪、会话、评测；2026-01 被 ClickHouse 收购，双方称核心功能仍为 MIT、无计划改许可（[ClickHouse 公告](https://clickhouse.com/blog/clickhouse-acquires-langfuse-open-source-llm-observability)）；agent 图：trace 内出现 `span`、`event`、`generation` 以外的观察类型时，按时间与嵌套自动推出图，有聚合与展开两种视图，没有专门的多 agent 模型（[agent-graphs](https://langfuse.com/docs/observability/features/agent-graphs)） | 自托管需要 Postgres、Redis 或 Valkey、ClickHouse、S3 或 blob 存储，加 web 与 worker 两个容器；Docker Compose 仅供本机与测试，为单机无高可用（[self-hosting](https://langfuse.com/self-hosting)）。OTLP 端点 `/api/public/otel`，只支持 HTTP（JSON 与 protobuf），不支持 gRPC，本机自托管需 v3.22.0 及以上，Basic Auth（[OTel 文档](https://langfuse.com/integrations/native/opentelemetry)） | v4.68.0（2026-10-22），创建 2023-05 | Claude Code：官方集成走 Stop hook，读转录再转成 trace，Claude Code 本身不发 OTel；每个提示一个 turn trace，每条助手消息一个 generation，工具 span 嵌在其下，会话按 `session_id` 聚合；该页没有提子 agent（[claude-code 集成](https://langfuse.com/integrations/other/claude-code)） | 功能面最全的开源选项，但本机离线要起四个存储，对桌面应用偏重；hook 方案对「同进程队友」只能从转录里还原 |
| [Arize Phoenix](https://github.com/Arize-ai/phoenix) | `LICENSE` 文件为 Elastic License 2.0（GitHub 判定 NOASSERTION） | 开源、自托管的追踪、评测、数据集、实验、提示管理，建立在 OpenTelemetry 与 OpenInference 之上；README 称可用远程 MCP 端点让 Claude Code 等客户端直接查询 trace（README） | 可在本机、容器或云上运行，部署方式含 CLI 终端、Docker Compose、K8s；文档称自托管无功能限制、数据留在自己的基础设施内、可完全隔离网络（[self-hosting](https://arize.com/docs/phoenix/self-hosting)）。默认存储（SQLite 还是 Postgres）：该页未说明，未查到 | arize-phoenix-v20.25.0（2026-10-23），创建 2022-11 | README 列出 Claude Agent SDK、OpenAI Agents SDK 等框架插桩；Claude Code CLI 的官方集成页：未查到（试读的 Claude Agent SDK 集成页返回 404） | ELv2 禁止把软件作为托管服务提供，是否影响随桌面应用分发需法务确认；本机单进程运行的描述最轻 |
| [LangSmith](https://docs.langchain.com/langsmith/trace-claude-code) | 闭源服务；SDK 仓库 `langsmith-sdk` 于 2026-10-16 归档，拆为 [langsmith-python](https://github.com/langchain-ai/langsmith-python) 与 [langsmith-javascript](https://github.com/langchain-ai/langsmith-javascript)（新仓库许可证：未读；旧仓库 MIT） | Claude Code 插件 `langsmith-tracing` 用 hooks（不是 OTel），每条消息一个 trace，同会话共用 `thread_id`；子 agent 的运行嵌套在派生它的 turn 之下，但只在子 agent 完成后才上送，中途打断则其子运行不被追踪，系统提示不包含在内（同页） | 云服务。自托管：LangChain 自己的页面称有托管、BYOC、自托管三种形态（[页面](https://www.langchain.com/langsmith/observability)），比较类网站称自托管仅限 Enterprise 套餐，价格未公开，一手来源未核；插件文档的示例只出现托管端点；可接收 OTel 数据（LangChain 页面称，未读原文） | 不适用（服务）；SDK 最新 v0.14.9（2026-10-15） | Claude Code | 离线不可用（除非购买企业自托管）；子 agent 只在完成后上送这一限制对「观察运行中的队友」不利 |
| [Opik](https://github.com/comet-ml/opik)（Comet） | Apache-2.0 | 开源的 LLM 可观测与评测平台；README 称服务端、前端、追踪、数据集、实验均开源并可自托管 | 可本机或自有基础设施部署（README，部署细节未读）。README 另有让 Claude Code 等通过 MCP 读取 trace 的命令 | 2.2.117（2026-10-22），创建 2023-05 | Claude Code 的追踪集成：未查到（只有 MCP 读取） | README 里的对比表由厂商自写，其中关于竞品「仅企业版自托管」的说法未独立核实 |
| [Laminar](https://github.com/lmnr-ai/lmnr) | Apache-2.0（GitHub API；根目录未找到 `LICENSE` 文件，未逐字核） | OTel 原生追踪 SDK、评测、transcript 视图；对 Claude Agent SDK，用 `Laminar.wrapClaudeAgentQuery` 包装查询函数，需 `@lmnr-ai/lmnr` 0.7.10 以上；通过 Agent 工具派生的子 agent 显示为父 turn 之下的嵌套 span，再嵌套的子 agent 在派生它的调用之下（[claude-agent-sdk 集成](https://laminar.sh/docs/tracing/integrations/claude-agent-sdk)，经搜索摘要，未读全文） | Docker Compose 自托管，UI 在 `localhost:5667`；自托管默认收集匿名使用遥测，可用 `LAMINAR_TELEMETRY_DISABLED=true` 关闭（README）。Claude Code CLI 的集成：未查到 | v0.3.2（2026-10-16），创建 2024-08 | Claude Agent SDK 用户 | 子 agent 嵌套与 transcript 视图的做法值得对照；面向 SDK 而非 CLI |
| [OpenLIT](https://github.com/openlit/openlit) | Apache-2.0 | OTel 原生的 agent 与 LLM 可观测、评测、guardrails 平台，README 称含面向编码 agent 会话的视图（README） | 自托管免费（README）；部署细节未读 | 创建 2024-01；release 标签 `otel-gpu-collector-1.0.0`（2026-10-13），平台本体版本：未查到 | 使用方：未查到 | 本次只读了 README 概述 |
| [MLflow Tracing](https://github.com/mlflow/mlflow) | Apache-2.0 | `mlflow autolog claude` 在项目的 `.claude/settings.json` 里写入 hooks，之后在该目录运行 `claude` 即被追踪；可用 `-u sqlite:///mlflow.db` 指定本机 SQLite；需要 MLflow 3.4 及以上；捕获用户提示与回复、工具使用、耗时、工具结果与会话元数据（[Databricks 转载的 MLflow 文档](https://docs.databricks.com/aws/en/mlflow3/genai/tracing/integrations/claude-code)，经搜索摘要） | Python；本机 SQLite 即可，无需外部服务 | v3.17.2（2026-10-21），创建 2018-06 | Claude Code | 子 agent 如何建模：未查到；本机离线门槛最低的一个 |
| [Braintrust](https://www.braintrust.dev/docs/integrations/developer-tools/claude-code.md) | 闭源服务；JS SDK [braintrust-sdk-javascript](https://github.com/braintrustdata/braintrust-sdk-javascript) Apache-2.0 | 两条路径：`trace-claude-code` 插件（hooks，经 `bt trace enable claude`）记录 session、turn、模型调用、工具、skill、子 agent、compaction 等 span，子 agent span 嵌在启动它的 turn 之下，`metadata.turn_span_id` 回指；或 Claude Code 原生 OTLP 导出到 `/otel`，用 `x-bt-parent` 头指定项目，文档没有描述该路径下的子 agent span（同页） | 云服务；hybrid 自托管支持 OTel 与 MCP 路径，插件路径是否支持自托管：文档未说 | JS SDK braintrust@3.39.0（2026-10-21） | Claude Code | 离线不可用；插件的 span 种类清单可作为「应该记什么」的参照 |
| [W&B Weave](https://github.com/wandb/weave) | Apache-2.0 | `weave-claude-plugin` 记录每个对话 turn、工具调用与子 agent 交互；会包含提示、回复、文件内容与 shell 输出，没有实现 PII 清理（[文档](https://docs.wandb.ai/weave/guides/integrations/claude_code)，经搜索摘要） | 云服务；用 `WANDB_BASE_URL` 或 `wandb login --host` 指向 Dedicated Cloud 或自管部署；Weave 本体能否脱离 W&B 服务器本机运行：未查到。Weave for Agents 标为公开预览 | v0.53.13（2026-10-22），创建 2023-06 | Claude Code、Codex、Claude Agent SDK、OpenAI Agents SDK、Google ADK（README 与文档页） | 隐私提示明确；本机离线：未查到 |
| [AgentOps](https://github.com/AgentOps-AI/agentops) | MIT（README 称其应用部分亦为 MIT） | Python SDK 加平台；README 称支持自托管并给出 OpenAI Agents SDK 与 CrewAI 等集成 | Python；自托管细节未读 | 0.4.21（2025-08-29），最近提交 2026-06-25，release 一年多没动 | Claude Code 集成：未查到 | 活跃度低于同类 |
| [Helicone](https://github.com/Helicone/helicone) | Apache-2.0 | 开源可观测与网关；2026-03 被 Mintlify 收购，进入维护模式（[官方博客](https://www.helicone.ai/blog/joining-mintlify)） | docker-compose 自托管（README） | 最后 release v2025.08.21-1；最近提交 2026-10-20 | 使用方：未查到 | 维护模式，同 [landscape-gateway.md](landscape-gateway.md) 2.1 |
| [Pydantic Logfire](https://github.com/pydantic/logfire) | SDK MIT；平台（UI 与后端）闭源，自托管需购买企业许可（README） | 基于 OpenTelemetry 的观测平台，SDK 可把数据导到任意 OTel 后端 | Python，另有 TS 与 Rust SDK | v5.2.0（2026-10-13） | 使用方：未查到 | 离线需企业许可，不适用 |

### 2.2 小结

- 对 Claude Code 的集成方式分两派：hooks 读转录再转成 trace（Langfuse、LangSmith、Braintrust 插件、MLflow、Weave），或 Claude Code 自己发 OTLP（Braintrust 另一条路径，以及任何 OTel 后端）。hooks 路径的子 agent 处理各不相同：LangSmith 完成后才上送，Braintrust 插件有 `turn_span_id` 回指，Langfuse 与 MLflow 的页面没说。
- 本机离线门槛：MLflow（SQLite）与 Phoenix（单进程，存储未查到）最低；Langfuse 需四个存储；LangSmith、Braintrust、Weave、Logfire 都是云服务或企业自托管。
- 许可证：Langfuse 的 MIT 在 `ee/` 之外；Phoenix 是 ELv2；LangSmith、Braintrust 平台闭源；Opik、OpenLIT、Laminar、Weave、MLflow 为 Apache-2.0；AgentOps 为 MIT。
- 并购带来的状态变化集中在一年内：Langfuse（ClickHouse，2026-01）、Helicone（Mintlify，2026-03）、Traceloop（ServiceNow，2026-03）、LangSmith SDK 仓库拆分（2026-10）。

---

## 3. 本机轻量查看器与日志读取

| 名称 | 许可证 | 一句话 | 平台与前提 | 成熟度 | 使用方 | 适配 |
| --- | --- | --- | --- | --- | --- | --- |
| [otel-tui](https://github.com/ymtdzzz/otel-tui) | Apache-2.0 | 终端里的 OTel 查看器，收 traces、metrics、logs，也收 Zipkin、Prometheus、Datadog 数据（README） | Go；Homebrew、`go install`、Docker、Nix、预编译二进制；macOS 与 Windows 剪贴板无需额外工具（README） | v0.7.5（2026-09-12），创建 2024-03 | README 未提 Claude Code 或 GenAI | 通用 OTel 查看，没有 GenAI 专用视图；可用来直接看 Claude Code 的 OTLP 输出 |
| [Jaeger](https://github.com/jaegertracing/jaeger) | Apache-2.0 | 分布式追踪后端，Go | 本机运行方式与 GenAI 属性展示：未读 | v2.22.0（2026-10-06） | 使用方：未查到 | 通用追踪后端 |
| [SigNoz](https://github.com/SigNoz/signoz) | GitHub 判定 NOASSERTION，未读 | 开源 OTel 观测平台 | 自托管；GenAI 与 Claude Code 能力：未读 | v0.147.0（2026-10-22） | 使用方：未查到 | 仅列出 |
| [ccusage](https://github.com/ryoppippi/ccusage) | GitHub 判定 NOASSERTION，未核 | 读取编码 agent CLI 的本地用量数据，生成日、周、月、会话级的 token 与成本报表，可隐藏成本列（README） | Rust；`bunx ccusage` 即可运行；读本机数据，不需要上传 | v20.0.41（2026-10-22）；仓库现位于 `ccusage/ccusage` | 使用方：未查到 | 是订阅用户场景下常见的「按 token 估美元」做法；是否区分子 agent：未查到 |
| [claude-code-hooks-multi-agent-observability](https://github.com/disler/claude-code-hooks-multi-agent-observability) | 未设许可证（GitHub 显示 none） | Claude Code hook 事件经 HTTP POST 送到 Bun 服务，存 SQLite，WebSocket 推给 Vue 前端，实时展示多个并发 agent（README） | 需要 Claude Code、`uv`、Bun；本机运行 | 创建 2025-07；最近提交 2026-02-08；无 release | Claude Code | 与 DreamCoder 栈（Bun）相近，是「统一活动流」最直接的社区实现；无许可证，只能借思路 |

小结：不依赖任何后端、直接从本机日志或 hook 得到活动流与用量的做法有两种：读转录算 token（ccusage），以及 hook 事件流加本机 SQLite（disler 项目）。两者都没有标注具体队友。

---

## 4. 值得深拆的候选

下面只写意见，按推荐顺序，均按 [_template.md](_template.md) 的格式做完整拆解。

1. fork 的遥测代码（`src/utils/telemetry/`）与上游 Claude Code 的 OTel 追踪。同进程队友要有可区分的成员标识，最省事的是把 `agent_id`、`parent_agent_id` 带进 span。要查：增强遥测的编译开关在发布构建里是否开启、队友在 fork 里有无稳定 ID、补这两个属性的改动量。
2. OTel GenAI 的 agent span 约定（`invoke_agent` 的 INTERNAL 形态、`gen_ai.conversation.id`、`gen_ai.workflow.name`）。若我们自己产生团队级 trace，应当遵循的标准只有它；要查：哪些属性已稳定、成员与团队如何映射到 `invoke_agent` 与 `invoke_workflow`。
3. Arize Phoenix。本机单进程、自带 OpenInference 的显式 agent 图、有 MCP 端点供 agent 回查；要先过许可证（ELv2）与默认存储两个问题。
4. Langfuse。功能最全、OTLP 与 hooks 两条路径、有 MIT 核心；要查：能否把四个存储降到本机可接受的程度，或仅作为用户可选的外部后端。
5. 转录转 trace 的 hooks 实现（Langfuse、LangSmith、Braintrust 插件、MLflow）合并拆一份，对照「子 agent 如何嵌套、中断时丢什么、`turn_span_id` 这类回指」。这是我们若不依赖 Claude Code 的 OTel 时的参考实现。
6. disler 的 hooks 多 agent 观测项目。栈与我们接近，可看它怎么把并发 agent 的事件流做成统一视图；无许可证，只借思路。

没有列入的：Helicone（维护模式）、AgentOps（release 停滞，Claude Code 集成未查到）、Logfire 与 LangSmith 与 Braintrust 的托管版（离线不可用，与本地优先定位不合，只在 hooks 对照里涉及）、Opik 与 OpenLIT 与 Laminar 与 Weave（Claude Code CLI 集成未查到或本次读得浅，列在表里作观察）。

## 5. 空白

按我们的需求逐项列出，目前没有找到做得好的现成方案：

1. 同进程队友的指标级归因：Claude Code 文档里 `agent_id` 只出现在追踪 span 上，计数器只有子 agent 类型 `agent.name`，用户自定义名默认被替换为 `custom`；没有找到按队友名拆分成本计数器的说明。
2. fork 缺 agent 级标识：fork 的 `sessionTracing.ts` 没有 `agent_id`，网关头也只有会话头（见 [landscape-gateway.md](landscape-gateway.md)）。上游新版有这些能力，fork 与之的差距清单没有查。
3. 订阅用户的成本：Claude Code 文档称会话成本数字与计费无关；OTel 的 `cost_usd` 在订阅下取何值，文档可读部分未说明。没有找到任何后端对「订阅」与「API 计费」分开展示。
4. 混用 provider 时的成本：Claude Code 的价格表按 Claude 模型；经 DreamCoder 代理走其他 provider 时成本如何计算，fork 的 `cost-tracker.ts` 未读，各后端对非 Claude 模型的价格库覆盖情况未查。
5. 跨进程成员的 trace 关联：进程成员（独立 CLI 进程）与进程内成员要在同一个团队 trace 里出现，需要在进程间传递 trace 上下文；Claude Code 文档的可读部分没有找到相关说明，未查到。
6. 本机离线且开源、带 agent 图、许可证宽松的单体后端：Langfuse 要四个存储，Phoenix 是 ELv2，MLflow 的 agent 视图能力未读，Opik 与 Laminar 的本机部署形态未读；没有找到一个已确认满足全部条件的。
7. GenAI 语义约定仍在 Development 状态，且没有专门的「agent 之间委派」属性；不同后端对嵌套的解读（Langfuse 按观察类型推图，Phoenix 靠 `graph.node.*`）不一致，同一份 trace 在两处展示会不同。
8. 隐私默认值：Claude Code 的 OTel 默认脱敏；Weave 插件明确不做 PII 清理；LangSmith 插件不含系统提示。统一活动流若要给用户看完整对话，需要自己决定采集深度，没有找到可复用的分级方案。
