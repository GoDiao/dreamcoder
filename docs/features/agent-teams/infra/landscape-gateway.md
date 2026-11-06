# 模型网关全景

核实日期：2026-10-23。范围：为同一项目并行运行多个编码 agent 时，位于模型调用路径上的一层：多 provider 路由、按调用方发放凭据、按成员或团队归因用量、预算、限流与硬停。上层产品见 [README](../README.md) 与 [research/](../research/)，同级的工作区层见 [landscape-workspace.md](landscape-workspace.md)。背景讨论见 [#162](https://github.com/GoDiao/dreamcoder/issues/162)（Open questions 末条「成员使用不同 provider 时适用什么预算与成本模型」）。模型路由（System 1 决策模型）另有 [#124](https://github.com/GoDiao/dreamcoder/issues/124)，本文不重复。

## 0. 读法与核实约定

- 本次只读：没有安装、构建或运行任何被调研的工具；GitHub 只用 `gh` 读接口，网页只读。
- 「许可证」「仓库创建」「最新 release 与日期」除特别标注外，均来自对应仓库的 GitHub API（`gh api repos/<owner>/<repo>` 与 `.../releases/latest`，2026-10-23 读取）。表格里的名称链接即该仓库或文档，不在每格重复。仓库创建日不等于首次发布。
- GitHub 判定为 NOASSERTION 的仓库，在许可证格里写明读到的实际文本或「未核实」。
- 「未查到」表示查过但没有证据；「不适用」表示问题本身不适用。
- 表中「使用方」只写能给出出处的集成；没有出处的不写。
- 判断与建议只出现在每节的「适配」列和文末两节里。
- 本层有三条前提事实，下文多处引用，先在此给出出处：
  1. DreamCoder 现状：凭据来自进程环境，同进程队友共用一个 API 客户端（[#162](https://github.com/GoDiao/dreamcoder/issues/162)「What DreamCoder has today」）。仓库内已有本机代理 `POST /proxy/providers/:providerId/v1/messages`，把 Anthropic 格式请求转成 OpenAI Chat 或 Responses 格式，代码派生自 cc-switch（MIT）（`src/server/proxy/handler.ts`、`src/server/proxy/LICENSE-cc-switch.md`）。fork 发出的请求只带 `X-Claude-Code-Session-Id` 头，没有 agent 级的头（`src/services/api/client.ts:158`；在 `src` 与 `desktop/src` 中搜索 `x-claude-code-agent-id` 无结果）。
  2. 上游 Claude Code（以官方文档为准）会向网关发 `x-claude-code-session-id`、`x-claude-code-agent-id`、`x-claude-code-parent-agent-id` 三个头，子 agent 的 ID 每次新生成，agent team 队友使用稳定的、基于名字的 ID（[llm-gateway-protocol](https://code.claude.com/docs/en/llm-gateway-protocol.md) 的 Request headers 节）。fork 兼容 2.1.92，本次在 `src` 中只搜到上一条所述的会话头，没有搜到 agent 级的头。
  3. Anthropic 的账号条款：OAuth 认证面向订阅购买者本人的 Claude Code 与原生应用；开发者做产品应使用 API key；不允许第三方开发者代用户路由 Free、Pro、Max 凭据，也不允许收集、存储或中转 Claude.ai 凭据（[legal-and-compliance](https://code.claude.com/docs/en/legal-and-compliance.md)「Authentication and credential use」）。同页另一条：在自家产品里预装或运行 Claude Code 的客户，须使用未经修改的二进制、不得代最终用户付费或转售（同页「Can customers offer Claude Code in their products?」）。

---

## 1. 可自托管的网关与代理

### 1.1 总表

| 名称 | 许可证 | 一句话 | 平台与前提 | 成熟度 | 使用方 | 适配 |
| --- | --- | --- | --- | --- | --- | --- |
| [LiteLLM](https://github.com/BerriAI/litellm)（proxy 加 SDK） | `LICENSE`：`enterprise/` 目录以外为 MIT，`enterprise/` 另有许可（GitHub 判定 NOASSERTION） | 虚拟 key、预算、限流；预算可设在全局、key、内部用户、团队、团队成员，另有按 `budget_limits` 的多窗口；每模型预算标为 Enterprise（[预算文档](https://docs.litellm.ai/docs/proxy/users)） | Python。预算以数据库中的花费为准，无数据库时 `max_budget` 放行，key、团队、用户预算无法解析（同页）；虚拟 key 页要求 Postgres，`DATABASE_URL`（[virtual_keys](https://docs.litellm.ai/docs/proxy/virtual_keys)）。超额返回认证类错误 `ExceededTokenBudget` 等；默认开启预算预留，关闭后并发请求可超支（同页） | 创建 2023-07；v1.106.2（2026-10-21） | Claude Code 官方成本文档称多家大型企业用它按 key 追踪花费，并注明与 Anthropic 无关联、未经安全审计（[costs](https://code.claude.com/docs/en/costs.md)「Cloud providers」） | 成员、团队、预算层级与我们的需求最贴近；代价是 Python 进程加 Postgres，作为桌面应用的依赖偏重 |
| LiteLLM 的订阅直通模式 | 同上 | 用户的 Claude 订阅 OAuth token 在 `Authorization` 头里原样转发给 Anthropic，LiteLLM 另用 `x-litellm-api-key` 做归因、预算与限流；成本按 Anthropic API 列表价计算并计入 key、用户、团队预算；花费日志有 `used_client_oauth_token` 字段区分座位计费与 key 计费（[教程](https://docs.litellm.ai/docs/tutorials/claude_code_max_subscription)） | 需 v1.81.14 及以上，该字段需 v1.105.0 及以上；需要 Postgres（同页） | 同上 | 同页写明 Anthropic 条款限制「代他人使用订阅凭据」，应各人登录自己的账号，不要把订阅 token 放进部署的 `api_key` 共享 | 是唯一找到的、把订阅流量折算成 API 等价美元并纳入预算的现成做法；是否合规取决于上文前提 3 |
| [Bifrost](https://github.com/maximhq/bifrost) | Apache-2.0 | Go 编写的网关，README 称统一 23 个以上 provider，OpenAI 兼容 API；虚拟 key 各带预算（`max_limit` 加 `reset_duration`，周期 1m 到 1Y，可对齐日历）与 token、请求限流；层级为 customer、team、key（[virtual-keys 文档](https://docs.getbifrost.ai/features/governance/virtual-keys)） | `npx -y @maximhq/bifrost` 或 Docker，另有 Go SDK 直接集成（README）。文档页没有标明哪些治理功能属 Enterprise，完整的开源与企业划分：未查到；Claude Code 兼容：文档页未提 | 创建 2025-03；最新 release 标签为 `ent-v2.3.2-base`（2026-10-21），开源版本号：未查到 | 使用方：未查到 | 单二进制、本机 `npx` 即可起，是自托管里部署最轻的；开源版是否含预算与虚拟 key 需要实测或读源码确认 |
| [Portkey 开源网关](https://github.com/Portkey-AI/gateway) | MIT | TypeScript 网关，README 称路由到 1600 以上模型，含重试、回退、负载均衡、guardrails；预算与限流在产品文档中描述（[文档](https://portkey.ai/docs/product/ai-gateway)），但该页没有说明哪些属开源版 | `npx @portkey-ai/gateway` 本机运行，需要 Node（README）。README 提示 Gateway 2.0 预发布分支，称把企业版核心网关并入开源 | 创建 2023-08；v1.15.2（2026-01-12），最近提交 2026-05-25 | 使用方：未查到 | TypeScript，与 Bun 服务同语言栈；开源版是否自带预算与虚拟 key 未核实，2.0 尚未发布 |
| [claude-code-router](https://github.com/musistudio/claude-code-router) | MIT | 本机模型网关与控制台，给 Claude Code、Codex 等多个 agent 提供一个本地端点，做路由、重试、凭据池、回退，并记录请求日志、token 与成本估算（README） | TypeScript；有桌面应用下载入口（README）；平台清单：未读 | 创建 2025-02；v3.1.3（2026-10-09） | README 列出的 agent：Claude Code、Codex、Grok CLI、Kimi CLI、OpenCode 等 | 与 DreamCoder 的场景同形（桌面、本机、Claude Code 经它换 provider），但它是独立产品，不是库；预算与按成员归因：README 未提 |
| [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI) | MIT | 把 Codex、Claude Code、Grok 等 CLI 的 OAuth 登录包装成 OpenAI、Gemini、Claude 兼容的 API，多账号轮询，附 Go SDK 可嵌入（README） | Go；有 Dockerfile 与 PowerShell 构建脚本；平台清单：未读。自 v6.10.0 起不再内置用量统计，转由外部工具提供（README） | 创建 2025-07；v8.0.40（2026-10-23） | 第三方管理工具若干（README） | README 没有任何关于订阅凭据使用条款的说明；其做法正落在上文前提 3 所述的限制范围内 |
| [Helicone AI Gateway](https://github.com/Helicone/ai-gateway) | GPL-3.0 | Rust 编写的网关 | 最近提交 2025-11-21，无 release | 创建 2025-04 | 使用方：未查到 | 停滞，且 GPL-3.0 与闭源分发不兼容；Helicone 本体见 2.2 |
| [TensorZero](https://github.com/tensorzero/tensorzero) | Apache-2.0 | 网关、可观测、评测、优化、实验合一的 LLMOps 平台（README） | Rust。**仓库已归档**（GitHub API `archived: true`，最近提交 2026-06-11） | 创建 2024-07；最后 release 2026.6.0（2026-06-04） | 使用方：未查到 | 归档原因没有一手公告；二手报道称团队有序关停（[future-stack-reviews](https://future-stack-reviews.com/tensorzero-shut-down/)，未核）。不能再当活跃依赖 |
| [any-llm](https://github.com/mozilla-ai/any-llm) | Apache-2.0 | Mozilla.ai 的统一 provider 调用库，README 面向从 LiteLLM 迁移的用户 | Python 3.11 及以上 | 创建 2025-07；1.39.0（2026-10-21） | 使用方：未查到 | 库，不含预算与虚拟 key（README 首页未提）；其网关形态 otari：未读 |
| [Agent Router](https://github.com/theagentrouter/agent-router)（原 Envoy AI Gateway，`envoyproxy/ai-gateway` 已重定向到此） | Apache-2.0 | 基于 Envoy 的 AI 与 agent 流量控制面；README 称由平台团队集中管理凭据、路由、配额、故障转移与用量归因 | Go；以 Kubernetes CRD 部署（`AIGatewayRoute` 等），另有 `aigw` CLI；单机运行方式：未读 | v1.2.0（2026-10-07）；README 称现为 Agentic AI Foundation 项目 | 使用方：未查到 | 面向平台团队的 K8s 方案，桌面应用不适用 |
| [agentgateway](https://github.com/agentgateway/agentgateway) | Apache-2.0 | Rust 代理，覆盖 LLM、MCP、A2A 三类流量；README 称 LLM 网关带预算与花费控制（README） | Linux Foundation 项目（README）；本机运行方式：未读 | 创建 2025-03；v1.6.0（2026-10-02） | 使用方：未查到 | 预算的具体模型（作用域、周期、超额行为）本次未读；其 A2A 与 MCP 能力与 [landscape-workspace.md](landscape-workspace.md) 第 5 节相关 |
| [Kong Gateway](https://github.com/Kong/kong) 的 AI 插件 | Kong 仓库 Apache-2.0；`ai-rate-limiting-advanced` 插件页写明仅属 AI Gateway Enterprise 版 | AI Proxy 把请求转到 OpenAI、Azure、Bedrock、Anthropic、Gemini、Vertex、DeepSeek、Ollama、vLLM 等；`config.llm_format: anthropic`（v3.10 起）可直通 Anthropic 原生格式；token 限流支持按总量、提示、补全或成本（v3.8 起）计，可按 consumer、consumer group、模型、provider 等维度（[ai-proxy](https://developer.konghq.com/plugins/ai-proxy/)、[ai-rate-limiting-advanced](https://developer.konghq.com/plugins/ai-rate-limiting-advanced/)） | Lua，需要 Kong 部署；AI Proxy 是否在开源版可用：页面未说明，未查到 | v3.9.4（2026-10-12） | 使用方：未查到 | 企业 API 网关，限流与成本维度最全但在企业版；桌面应用不适用 |
| [RouteLLM](https://github.com/lm-sys/RouteLLM) | Apache-2.0 | 按问题难度在强弱模型间路由的框架 | Python | 最近提交 2024-08-10，无 release | 使用方：未查到 | 停滞；与 [#124](https://github.com/GoDiao/dreamcoder/issues/124) 的路由问题相关，不在本层展开 |

### 1.2 小结

- 自托管里，按成员与团队发放预算的完整模型在 LiteLLM（key、用户、团队、团队成员四级，另有全局）和 Bifrost（customer、team、key 三级）；Kong 的成本限流维度最全但在企业版；agentgateway 与 Portkey 开源版的预算细节本次没读到。
- LiteLLM 的预算依赖数据库，文档明说无数据库时预算放行。Bifrost 与 Portkey 是否需要外部存储：未查到。
- TensorZero 已归档，Helicone 网关停滞，这两个常被并列的名字不能算活跃选项。
- 能看到的两种「订阅计费」做法分歧很大：LiteLLM 把订阅流量按 API 列表价折算成美元、保留标记字段；CLIProxyAPI 只做凭据转换，不做用量。

---

## 2. 托管网关与聚合服务

### 2.1 总表

| 名称 | 许可证 | 一句话 | 平台与前提 | 成熟度 | 使用方 | 适配 |
| --- | --- | --- | --- | --- | --- | --- |
| [OpenRouter](https://openrouter.ai/docs) | 闭源服务；SDK 见 3 节 | 每个响应的 `usage` 含 token 数、缓存读写数和 `cost`（计入账户的积分），无需额外参数；经 `/generation` 取到的 `upstream_inference_cost` 仅对 BYOK 请求有值（[usage accounting](https://openrouter.ai/docs/use-cases/usage-accounting)）。管理密钥可程序化建 key，带 `limit`（美元）、`limit_reset`（日、周、月，UTC 零点）、`expires_at`（[create-api-key](https://openrouter.ai/docs/api-reference/api-keys/create-api-key)）。OAuth PKCE 流程让用户授权后拿到由用户控制的 key，请求计入用户自己的积分（[oauth](https://openrouter.ai/docs/guides/overview/auth/oauth)） | 云服务。Claude Code 接入方式为 `ANTHROPIC_BASE_URL` 加 `ANTHROPIC_AUTH_TOKEN`，文档只保证 Anthropic 第一方 provider 可用（[claude-code-integration](https://openrouter.ai/docs/guides/guides/claude-code-integration)） | 不适用（服务） | Claude Code（同上文档页） | 多 provider 与按 key 限额现成；请求字段里的终端用户标识只有用于防滥用的 `user`（[api-reference](https://openrouter.ai/docs/api-reference/overview)），按成员的报表需要每成员一个 key；订阅计费：不适用，只走积分 |
| [Cloudflare AI Gateway](https://developers.cloudflare.com/ai-gateway/) | 闭源服务；provider 包见 3 节 | 概览页列出限流、缓存、动态路由（重试与回退）、分析、日志，所有套餐可用，但概览页没有提预算（[概览](https://developers.cloudflare.com/ai-gateway/)）。Unified Billing 页写明可在单个网关上设置花费上限规则，作用域为模型、provider 或自定义元数据（如用户、团队），不是按 API key；余额可为负，之后向绑定的付款方式扣费（[unified-billing](https://developers.cloudflare.com/ai-gateway/features/unified-billing/)） | 云服务，需 Cloudflare 账号 | 不适用 | 使用方：未查到 | 元数据维度的上限规则可对应「成员」，但需每次请求带元数据；日志保留期与定价：未查到 |
| [Vercel AI Gateway](https://vercel.com/docs/ai-gateway) | 闭源服务；AI SDK 见 3 节 | 预算有四个作用域：团队、项目、API key、团队成员，须同时通过所有适用预算；超额返回 HTTP 402，`type` 为 `quota_for_entity_exceeded`；预算是软上限，跨线的那一个请求仍会完成；BYOK 的花费不计入预算；对系统凭据零加价（[budgets](https://vercel.com/docs/ai-gateway/observability-and-spend/budgets)、[概览](https://vercel.com/docs/ai-gateway)） | 云服务；可在任意环境用 AI Gateway API key 调用，也支持 Anthropic Messages API 与「受支持的编码 agent」（概览页） | 概览页更新日 2026-09-14 | 使用方：文档列出 coding agents 集成页，具体清单未读 | 每成员一个带预算的 key 是现成的；软上限与 BYOK 不计费两点意味着用户自带 key 时预算不起作用 |
| [Portkey 托管网关](https://portkey.ai/docs/product/ai-gateway) | 闭源服务 | 预算（按成本或 token）与限流（每小时、日、分钟，按请求或 token）见产品文档；虚拟 key、工作区、元数据归因：该页未覆盖 | 云服务或自托管后接入 Portkey（同页） | 不适用 | 使用方：未查到 | 与 1.1 的开源网关同厂，托管版与开源版的功能划分未查到 |
| [Helicone 托管服务](https://www.helicone.ai/blog/joining-mintlify) | 平台仓库 [Helicone/helicone](https://github.com/Helicone/helicone) Apache-2.0 | 2026-03 被 Mintlify 收购，官方博客称服务继续运行但进入维护模式，仍发安全更新、新模型与缺陷修复（博客）；PostHog 称路线图冻结并停止注册，未在一手来源核到（[PostHog](https://posthog.com/blog/best-helicone-alternatives)） | 云服务或 docker-compose 自托管（仓库 README） | 仓库最近提交 2026-10-20；最后 release v2025.08.21-1 | 使用方：未查到 | 维护模式，不作新依赖；可观测侧见 [landscape-observability.md](landscape-observability.md) |
| [Tailscale Aperture](https://tailscale.com/docs/aperture/how-to/use-passthrough-mode/claude-subscriptions) | 未查到 | 网关按 Tailscale 身份认证推理请求；直通模式下把每个客户端自己的凭据原样转给上游，Claude Code 用订阅 OAuth token 时同样原样转发，仅 `/v1/messages` 经过网关，登录与刷新 token 仍直连 Anthropic（同页） | 需要 Tailscale 网络；产品阶段：该页未说明 | 未查到 | Claude Code（同页） | 页面写明各用户以自己的身份登录 Anthropic，并给出身份与日志，没有说明按用户的花费统计或配额，也没有条款讨论 |

### 2.2 小结

- 托管网关对「按成员预算」的支持差异：Vercel 有成员作用域，OpenRouter 靠每成员一个带上限的 key，Cloudflare 靠请求元数据加规则。三者都假定每个成员持有不同的凭据或元数据，同进程队友共用一个客户端时，要靠请求头区分，见 4 节。
- 托管网关把「订阅」排除在外：OpenRouter 与 Vercel 都按积分或额度计费；唯一处理订阅直通的是 Aperture 与 LiteLLM，二者都是「转发用户自己的 token」，不是代用户提供订阅。

---

## 3. 可嵌入进程的 TypeScript 库

| 名称 | 许可证 | 一句话 | 平台与前提 | 成熟度 | 使用方 | 适配 |
| --- | --- | --- | --- | --- | --- | --- |
| [Vercel AI SDK](https://github.com/vercel/ai) | Apache-2.0（`LICENSE` 文件，GitHub 判定 NOASSERTION） | provider 实例用 `createAnthropic({ apiKey, authToken, baseURL, headers, fetch })` 显式构造，未传时才读 `ANTHROPIC_API_KEY`、`ANTHROPIC_AUTH_TOKEN`；用量对象含缓存读写 token（[anthropic provider](https://ai-sdk.dev/providers/ai-sdk-providers/anthropic)） | TypeScript，进程内库 | 最近发布 2026-10-22（`@ai-sdk/zai@3.0.39`） | Vercel AI Gateway 提供 AI SDK 接入（见 2.1） | 同一进程可按成员各建一个 provider 实例，不依赖环境变量；只覆盖「自己发起模型调用」的代码，不覆盖被包装的 Claude Code 进程 |
| [@openrouter/ai-sdk-provider](https://github.com/OpenRouterTeam/ai-sdk-provider) 与 [@openrouter/typescript-sdk](https://github.com/OpenRouterTeam/typescript-sdk) | Apache-2.0 | OpenRouter 的 AI SDK provider 与官方 TS SDK | TypeScript | 3.1.0（2026-09-19）；v1.5.5（2026-10-22） | 使用方：未查到 | 与 OpenRouter 的 key 限额配合 |
| [cloudflare/ai](https://github.com/cloudflare/ai) 的 `ai-gateway-provider` | MIT | 经 Cloudflare AI Gateway 调用的 AI SDK provider | TypeScript | `ai-gateway-provider@4.0.2`（2026-10-20） | 使用方：未查到 | 同上 |
| Bifrost Go SDK、CLIProxyAPI Go SDK | Apache-2.0；MIT | 把网关作为 Go 库嵌入（见 1.1） | Go | 见 1.1 | 见 1.1 | Bun 进程内无法直接链接 Go 库，只能作为子进程运行 |
| DreamCoder 自带本机代理（`src/server/proxy`） | MIT 派生部分见 `LICENSE-cc-switch.md` | 路径里带 provider ID，把 Anthropic 格式转成 OpenAI Chat 或 Responses，provider 配置来自 `ProviderService`（`src/server/proxy/handler.ts`） | Bun 服务内 | 仓库内 | DreamCoder | 已按 provider 分路；有无用量记录与限额：本次未读 |

小结：真正「嵌进 Bun 进程、不起外部服务、带预算」的 TypeScript 库没有找到。AI SDK 与各家 provider 包解决「按成员选 provider 与凭据」，不含预算；预算、虚拟 key、限流都在需要独立进程的网关里。

---

## 4. Anthropic 官方一侧的网关能力与成员归因

| 名称 | 许可证 | 一句话 | 平台与前提 | 成熟度 | 使用方 | 适配 |
| --- | --- | --- | --- | --- | --- | --- |
| Claude apps gateway（含在 `claude` 二进制内） | 闭源 | 自托管；开发者经公司 IdP 单点登录；按用户、IdP 组、组织设日、周、月花费上限，超额返回 429 `billing_error`；花费为网关自己的估算，按请求用列表价或自定义覆盖价，未识别的模型按 5/25 美元每百万 token 兜底；客户端中止的流也计费；Postgres 不可用时默认放行，可配置为拒绝（[spend-limits](https://code.claude.com/docs/en/claude-apps-gateway-spend-limits.md)） | 上游可为 Bedrock、Claude Platform on AWS、Google Cloud、Foundry 或 Anthropic API；登录是浏览器 SSO，没有服务令牌流程，CI 无法经它认证（[gateways](https://code.claude.com/docs/en/gateways.md)） | 文档中各功能的版本要求在 v2.1.218 到 v2.1.293 之间；fork 兼容 2.1.92 | Claude Code | 官方文档称不支持经任何网关把 Claude Code 路由到非 Claude 模型（见下一行），与「成员各用不同 provider」方向不同 |
| 其他网关与 Claude Code 的约定 | 不适用 | Anthropic 不背书、不维护、不审计其他网关，也不支持经任何网关把 Claude Code 路由到非 Claude 模型（[llm-gateway](https://code.claude.com/docs/en/llm-gateway.md)）。网关必须逐字转发 `anthropic-beta` 与 `anthropic-version` 头，不要白名单；转发 `system` 数组不得改写，否则归因块与提示缓存受影响（[llm-gateway-protocol](https://code.claude.com/docs/en/llm-gateway-protocol.md)） | 与网关配合的是 `ANTHROPIC_BASE_URL` 加网关凭据 | 同上 | 同上 | 这些要求解释了为什么通用网关在 Claude Code 新版上会出现功能降级 |
| 成员归因头 | 不适用 | `x-claude-code-session-id`（会话唯一标识）、`x-claude-code-agent-id`（发请求的子 agent，仅出现在 Claude Code 内部派生的 agent 的请求上）、`x-claude-code-parent-agent-id`（嵌套时的父 agent）；文档明说二者结合用于把成本归到并行 agent；teammate 的 ID 稳定且基于名字，子 agent 的 ID 每次新生成，且 ID 标识的是 agent 不是人。另有可选「提示头」（`CLAUDE_CODE_GATEWAY_HINT_HEADERS=1`，v2.1.273 起）：`x-claude-code-request-class`、`x-claude-code-agent-type`（取值含 `teammate`，表示在 lead 进程内运行的队友）、`x-claude-code-prompt-id` 等（[llm-gateway-protocol](https://code.claude.com/docs/en/llm-gateway-protocol.md)） | 上游新版；fork 只发 `X-Claude-Code-Session-Id`（`src/services/api/client.ts:158`） | 文档版本 | Claude Code | 这是同进程队友在网关侧可被区分的唯一一手机制；fork 缺这两个头 |
| 网关凭据与订阅的关系 | 不适用 | 设置了网关凭据变量或 `apiKeyHelper` 时，请求带的是该凭据而不是订阅登录，订阅额度不适用，流量按持有该凭据的账户按 token 计费；只设 `ANTHROPIC_BASE_URL` 而不设凭据时，保存的 claude.ai 登录仍是有效凭据，订阅额度与计费照旧，此时网关必须转发 `anthropic-beta` 中的 OAuth 能力值，否则 401（[llm-gateway](https://code.claude.com/docs/en/llm-gateway.md)「Subscriptions and gateways」、[gateways](https://code.claude.com/docs/en/gateways.md)） | 同上 | 同上 | Claude Code | 说明经网关换 provider 与保留订阅计费是互斥的两条路 |

小结：

- 同进程队友在网关侧的归因，官方给出的路径是 `x-claude-code-agent-id` 加会话 ID。fork 现状没有这两个头，进程内所有成员的请求在网关看来是同一个会话、同一个凭据。
- 官方文档把「经网关路由到非 Claude 模型」排除在支持范围外；DreamCoder 的多 provider 能力走的是自己的转换代理，不在官方支持边界内。

---

## 5. 订阅与 OAuth 套餐的成本口径

问题：订阅套餐（Claude Pro、Max，ChatGPT）下，每次请求没有按 token 的账单，成本从哪里来。

| 来源 | 口径 | 出处 |
| --- | --- | --- |
| Claude Code 自身 | 本地按 token 数乘列表价算出美元数，除非管理员设了 `modelPricing`；文档注明订阅用户的会话成本数字「与计费无关」，订阅用户另看计划用量条；该数字是估算，权威账单看 Console | [costs](https://code.claude.com/docs/en/costs.md) |
| Claude Code OTel | `claude_code.cost.usage` 与 `api_request` 事件的 `cost_usd` 为估算美元；监控文档可读部分未说明订阅用户是否上报：未查到 | [monitoring-usage](https://code.claude.com/docs/en/monitoring-usage.md) |
| fork 的会话成本 | `src/cost-tracker.ts` 累计 `costUSD`；其算法与订阅用户下的取值：未读 | `src/cost-tracker.ts` |
| LiteLLM | 订阅直通下按 Anthropic API 列表价计算，计入各级预算，另标 `used_client_oauth_token` | [教程](https://docs.litellm.ai/docs/tutorials/claude_code_max_subscription) |
| Claude apps gateway | 网关自己的估算，列表价或覆盖价 | [spend-limits](https://code.claude.com/docs/en/claude-apps-gateway-spend-limits.md) |
| Paperclip | 订阅计费下成本记为 0，预算不生效 | [../README.md](../README.md) 对比矩阵第 13 行 |
| OpenAI ChatGPT 套餐 | OpenAI 官方帮助页只写明登录 Codex 时 ChatGPT 条款适用于数据共享（[help](https://help.openai.com/en/articles/11369540)）；有二手报道称 2026-09 起 OpenAI 开放「Sign in with ChatGPT」给部分合作应用，用量计入用户套餐并可按应用设周上限，合作方含 Amp、Devin、Lovable、OpenClaw；未找到 OpenAI 原始公告（来源为搜索结果中最相关的一条 [thenewstack](https://thenewstack.io/sign-in-with-chatgpt/)，具体归属未逐条核） | 同左 |
| Anthropic 条款 | 见 0 节前提 3；二手报道称 2026-01 起服务端对第三方客户端封锁 Max OAuth（[gigazine](https://gigazine.net/gsc_news/en/20260220-anthropic-third-party-block)，未核原文） | [legal-and-compliance](https://code.claude.com/docs/en/legal-and-compliance.md) |

小结：订阅套餐下没有任何一方给出「真实花费」；能得到的只有 token 数，各家美元数都是按列表价的 API 等价估算。把预算建在这个估算上，等于限制「用量」而不是「钱」；LiteLLM 是唯一把两者在日志里分开标记的。

---

## 6. 值得深拆的候选

下面只写意见，按推荐顺序，均按 [_template.md](_template.md) 的格式做完整拆解。

1. Claude Code 的网关协议页与归因头（`x-claude-code-agent-id`、`x-claude-code-parent-agent-id`、提示头）。它是同进程队友唯一的一手归因机制，决定「按成员记账」能不能放在网关而不是改 fork。要查：这两个头在 fork 兼容的 2.1.92 之后哪个版本加入、移植到 fork 的成本、teammate 稳定 ID 的生成规则。
2. DreamCoder 自带的本机代理（`src/server/proxy`）。路径里已带 provider ID，是现成的按 provider 分路点；若用量记录、按成员限额放在这里，不引入外部服务。要查：是否记录用量、能否按请求头区分成员、流式中途断开时的计费口径。
3. LiteLLM，聚焦「订阅直通」与预算层级。成员、团队、预算、超额错误的模型最完整，且已有把订阅流量折算成 API 等价美元并打标记的做法。要查：无 Postgres 时能否在本机运行、预算预留的精度、与 `x-claude-code-agent-id` 的结合方式（本次没找到文档）。
4. Bifrost。Go 单二进制、本机 `npx` 可起、虚拟 key 与预算层级与 LiteLLM 相当。要查：开源版与企业版的功能划分、是否需要外部数据库、Claude Code 兼容性。
5. claude-code-router。与 DreamCoder 场景同形，MIT，TypeScript，已有 provider 凭据池、回退与成本估算，可作对照实现。要查：它如何在不改 Claude Code 的情况下做路由、有无按 agent 的归因。
6. Vercel AI SDK 的 provider 实例模型（显式 `apiKey`、`baseURL`、`headers`、`fetch`）。用于回答「同进程不同成员不同 provider」在不动环境变量时怎么做；要查：对被包装的 CLI 进程是否有对应物（没有则需要每成员一个代理端点）。

没有列入的：TensorZero（归档）、Helicone 网关（停滞）、Kong 与 Agent Router 与 agentgateway（面向 K8s 或企业网关，桌面应用不适用，agentgateway 的预算模型可在 4 节之外另读）、CLIProxyAPI（其做法落在 Anthropic 条款限制内，只作为现象记录）、OpenRouter 与 Cloudflare 与 Vercel 的托管网关（与本地优先定位不合，可作为用户自选的上游）。

## 7. 空白

按我们的需求逐项列出，目前没有找到做得好的现成方案：

1. 同进程队友各用不同 provider：官方网关与协议只支持 Claude 模型，通用网关靠凭据或模型别名区分。上游 Claude Code 在同进程里共用一个客户端，网关侧唯一能区分成员的是 `x-claude-code-agent-id`；fork 没有该头。没有找到按此头做归因或预算的网关文档（LiteLLM、Bifrost 均未提）。
2. 订阅套餐下的「预算」：所有口径都是 token 乘列表价的估算，没有一方报告真实花费；Paperclip 记 0 的做法等于预算失效。「该限制 token 还是限制等价美元」没有现成约定。
3. 订阅凭据的合规边界：Anthropic 条款禁止第三方代用户路由订阅凭据，并要求在产品中运行 Claude Code 的客户使用未经修改的二进制；DreamCoder 使用 fork，条款是否适用以及适用到什么程度本次没有判断，需要法务意见。OpenAI 一侧只有二手报道。
4. 嵌进 Bun 进程的预算库：没有找到不起外部进程、不依赖数据库、带按成员预算与硬停的 TypeScript 库；LiteLLM 预算依赖 Postgres，其余多为独立服务。
5. 硬停的语义：Vercel 明说是软上限；LiteLLM 默认预留预算但可超支；Claude apps gateway 在存储不可用时默认放行；没有找到「请求中途超额时终止流并给队友一个可恢复状态」的做法。
6. 团队级总预算与成员预算的联动：LiteLLM、Vercel、Bifrost 都有层级预算，但没有找到把「团队运行中途暂停、等用户批准加额」做成流程的实现；与 [#162](https://github.com/GoDiao/dreamcoder/issues/162) 里 Paperclip 的「预算超额开审批」类似的机制，网关层没有现成的。
7. fork 与上游网关协议的版本差：网关文档描述的头、提示头、`anthropic-beta` 透传要求都是新版行为，fork 兼容 2.1.92，差距的完整清单没有查。
