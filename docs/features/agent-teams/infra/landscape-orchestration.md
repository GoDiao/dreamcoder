# 持久化编排与调度全景

核实日期：2026-10-23。范围：为多 agent 团队提供「唤醒规则、重试、崩溃恢复、定时器、队列、去重、把人工等待做成可恢复的步骤」的一层。重点是能否嵌进单用户桌面应用、不依赖外部服务器、用 SQLite。成员如何被启动与承载见 [landscape-runtime.md](landscape-runtime.md)，工作区与沙箱见 [landscape-workspace.md](landscape-workspace.md)，上层产品见 [README](../README.md)。背景讨论见 [#162](https://github.com/GoDiao/dreamcoder/issues/162)。

## 0. 读法与核实约定

- 本次只读：没有安装、构建或运行任何被调研的工具；GitHub 只用 `gh api` 读接口，网页只读。
- 「许可证」「仓库创建」「最新 release 与日期」除特别标注外，均来自对应仓库的 GitHub API（`gh api repos/<owner>/<repo>` 与 `.../releases/latest`，2026-10-23 读取）。表格里的名称链接即该仓库或文档入口，不在每格重复。仓库创建日不等于首次发布，只作成熟度的下限参考。
- GitHub 判定为 NOASSERTION 或「Other」的许可证，写明读到的实际文本。
- 「未查到」表示查过但没有证据；「不适用」表示问题本身不适用。
- 「嵌入」指编排逻辑在应用进程内、或随应用起一个本机子进程，不要求用户另装或另配数据库、Redis 与消息服务。「SQLite」指官方文档或源码明确支持把状态存进 SQLite 文件。
- 每个工具回答同样几个问题：能否嵌进桌面应用；存储是什么；定时、延时与事件唤醒怎么做；重试与崩溃恢复怎么做；去重；人工等待。没有证据的写「未查到」，不凭印象补。
- 自述的性能数字与「对比表」只在注明「自述」时引用，没有复现。
- 表中「使用方」只写能给出出处的集成，包括别的框架对它的包装；没有出处的不写。
- 判断与建议只出现在「适配」列和文末两节里。
- 需求参照：#162 描述的现状是成员都在同一个 CLI 进程内，任务自动认领读错目录（#163），权限请求无人应答（#164）；Multica 与 Paperclip 自己写了调度（#162 Landscape 节）。本文件不评价这些产品的实现。

---

## 1. 嵌入应用进程、用 SQLite 的 TS 库

### 1.1 总表

| 名称 | 许可证 | 一句话 | 平台与语言 | 成熟度 | 使用方 | 适配 |
| --- | --- | --- | --- | --- | --- | --- |
| [OpenWorkflow](https://github.com/openworkflowdev/openworkflow) | Apache-2.0 | 工作进程直接轮询数据库，没有中心编排服务，状态全在 PostgreSQL 或 SQLite；步骤结果缓存，支持睡眠（`sleeping` 页）、`step.waitForSignal`（可带超时，用于人工审批与回调）、cron 调度、重试、子工作流、取消、版本、仪表盘（文档目录各有一页）（[production](https://github.com/openworkflowdev/openworkflow/blob/main/apps/docs/docs/production.mdx)、[signals](https://github.com/openworkflowdev/openworkflow/blob/main/apps/docs/docs/signals.mdx)、[schedules](https://github.com/openworkflowdev/openworkflow/blob/main/apps/docs/docs/schedules.mdx)） | TS。SQLite 后端在 Bun 用 `bun:sqlite`，在 Node 用 `node:sqlite`（需 Node 22.5 及以上）；文档称适合本地开发、测试与单机部署，多 worker 生产建议 Postgres（[sqlite](https://github.com/openworkflowdev/openworkflow/blob/main/apps/docs/docs/sqlite.mdx)）。Windows 未查到明说 | 最新 release `openworkflow@0.11.0`（2026-10-12），仓库创建 2025-10-25，版本号仍为 0.x | 未查到 | 同类里文档最完整地同时覆盖 SQLite、信号等待、cron 与 Bun。去重与幂等键未在已读页面里出现，需拆解时确认；0.x 版本的 API 稳定性也要看 changelog |
| [reflow-ts](https://github.com/danfry1/reflow-ts) | MIT | 类型化的多步工作流，每步输出存 SQLite；进程崩溃后，别的引擎实例在租约过期后接管并从未完成的步骤继续；支持 `.sleep()` 与 `.waitForEvent()`，进程可以不在；`enqueue` 可带幂等键，重复提交返回已有运行（[README](https://github.com/danfry1/reflow-ts)） | TS；Bun 用内置 `bun:sqlite`，Node 需 `better-sqlite3` 或 `node:sqlite` 适配器，Node 18.18 及以上（同页）。不适合多机分布式（同页自述） | v0.7.0（2026-08-10），仓库创建 2026-03-11，约 40 星；自述的 Bun 加 SQLite 吞吐：1 步约 4,600 次运行每秒（同页，未复现） | 未查到 | 语义与我们的「唤醒、重试、崩溃接管、幂等」最贴近，但项目很新、规模很小。cron 式定时在已读 README 里未出现 |
| [bunqueue](https://github.com/egeominotti/bunqueue) | MIT | Bun 原生任务队列：内存或单个 SQLite 文件，cron、死信队列、退避重试、去重、优先级、速率限制；另有 Workflow 模块，含 saga 补偿、分支、并行与人工介入信号（`.waitFor()`），执行状态存 SQLite（[README](https://github.com/egeominotti/bunqueue)） | 嵌入与服务端模式仅限 Bun 1.4 及以上（预编译的服务端发布物自带 Bun 运行时）；Node 只能经 `bunqueue-client` 连独立服务端（同页）。发布物含 Windows x64 与 arm64 的 zip（同页） | v2.9.17（2026-10-22），仓库创建 2026-01-28，约 590 星 | 未查到 | 是 Redis-free 队列里功能最全的一个；只在 Bun 进程内嵌入这一点与我们的 Bun 服务端吻合。README 中与 Temporal、Inngest 的对比表是项目自述，其中称 Inngest「仅云」，与 Inngest 自己的自托管文档不符（见 2.1） |
| [liteque](https://github.com/karakeep-app/liteque) | MIT | 基于 SQLite 的类型化任务队列：`numRetries`、并发数、轮询间隔、超时（[README](https://github.com/karakeep-app/liteque)） | Node；Bun 未查到 | 0.10.0，创建 2024-10-27，约 80 星 | 来自 Karakeep（原 Hoarder）团队（仓库归属 `karakeep-app`） | 只是队列，没有步骤持久化、定时、人工等待，需要自己叠加 |
| [DBOS（Python）](https://github.com/dbos-inc/dbos-transact-py) | MIT | 系统库默认是 SQLite（`sqlite:///{name}`），可换 Postgres；README 描述的队列、通知（恰好一次）、调度、可恢复的 `sleep` 都以 Postgres 为例（[`dbos/_dbos_config.py`](https://github.com/dbos-inc/dbos-transact-py/blob/main/dbos/_dbos_config.py)、[README](https://github.com/dbos-inc/dbos-transact-py)） | Python | 3.3.0（2026-10-15），仓库创建 2024-07-19 | OpenAI Agents SDK（Python）的 DBOS 集成「只需 SQLite 或 Postgres」（[running_agents](https://github.com/openai/openai-agents-python/blob/main/docs/running_agents.md)）；Pydantic AI 的持久执行引擎之一（[README](https://github.com/pydantic/pydantic-ai)） | 语义成熟但语言不匹配，只在需要 Python 侧车时才相关 |

### 1.2 小结

- 真正能「嵌进 Bun 或 Node 进程、用单个 SQLite 文件、带步骤持久化与人工等待」的，本次只找到 OpenWorkflow 和 reflow-ts 两个，且都是 2025 年下半年以后的新项目，版本号在 0.x。bunqueue 偏队列，附带的 Workflow 模块更新。liteque 只是队列。
- SQLite 用的是各运行时的内置模块（`bun:sqlite`、`node:sqlite`），OpenWorkflow 与 reflow-ts 都因此有 Node 与 Bun 两条路径；reflow-ts 在 Node 上另有 `better-sqlite3` 原生模块的选项。
- OpenWorkflow 的 worker 轮询数据库、没有中心服务；reflow-ts 是轮询加租约，自述不面向多机分布式。多机并发都不是目标；单个服务端进程独占写库的前提需要在拆解时确认。

---

## 2. 需要独立服务进程、但可在本机单进程运行的引擎

### 2.1 总表

| 名称 | 许可证 | 一句话 | 平台与语言 | 成熟度 | 使用方 | 适配 |
| --- | --- | --- | --- | --- | --- | --- |
| [Temporal](https://github.com/temporalio/temporal)（[TS SDK](https://github.com/temporalio/sdk-typescript)、[CLI](https://github.com/temporalio/cli)） | MIT（server、SDK、CLI 均为 MIT） | 工作流历史可重放，崩溃后重建先前状态，定时器记为事件、重放时不再等待（[文档](https://docs.temporal.io/workflows)）。`temporal server start-dev` 起本地开发服务器；`--db-filename` 指定持久化文件，不指定则进程退出即丢；文档称不用于生产（[CLI 文档](https://docs.temporal.io/cli/server)）。CLI 源码里的开发服务器使用 Temporal 的 SQLite 插件（`internal/devserver/server.go`@`5730c955d`） | Server 与 CLI 是 Go；CLI 发布物含 darwin、linux、windows（amd64、arm64）。TS SDK 官方支持 Node 20、22、24；README 写明依赖 Node-API 原生模块、`worker_threads`、`vm`、`AsyncLocalStorage`，并「强烈不建议」在非正版 Node 里跑 worker，Bun 在此列（[README](https://github.com/temporalio/sdk-typescript)） | server v1.32.1（2026-10-08）；TS SDK v1.24.0（2026-09-15）；CLI v1.9.1 | OpenAI Agents SDK（Python）与 Pydantic AI 的持久执行集成（[running_agents](https://github.com/openai/openai-agents-python/blob/main/docs/running_agents.md)、[README](https://github.com/pydantic/pydantic-ai)）；Mastra 的 `@mastra/temporal` 把 Mastra 工作流跑在 Temporal 上，README 自标「实验性、尚不可用于生产」（[`workflows/temporal`](https://github.com/mastra-ai/mastra/tree/main/workflows/temporal)） | 语义最完整，但嵌入有三处障碍：开发服务器官方不用于生产；TS worker 需要 authentic Node，Bun 宿主不被支持；要随应用分发并管理一个 Go 子进程。适合当「语义标杆」而不是嵌入候选 |
| [Inngest](https://github.com/inngest/inngest)（[AgentKit](https://github.com/inngest/agent-kit) 见 4） | 「Server Side Public License v1 加 Apache 2.0 Future License」（`LICENSE.md`；GitHub 标 Other）；变更日期条款本次未读 | 单个二进制含全部服务；`inngest start` 默认把状态存到 `./.inngest/main.db`（SQLite），队列与状态存储用内置的内存 Redis 实现，并周期性地、以及关闭前把快照写进 SQLite（[自托管文档](https://www.inngest.com/docs-markdown/self-hosting)）。同页列出的流控有并发、节流、优先级、去抖、限速与批处理，另有 `waitForEvent` 与按事件取消 `cancelOn` | 二进制发布物含 darwin、linux、windows（amd64、arm64）；也可 `npm install -g inngest-cli`（同页）。函数由应用经 HTTP 或 `connect` 工作者连接暴露（同页端口 8288 与 8289）。TS SDK | v1.48.0（2026-10-22），仓库创建 2021-06-07。文档写明官方不保证对自托管实例的直接支持（同页） | Mastra 的 `@mastra/inngest` 把工作流跑在 Inngest 上（[`workflows/inngest`](https://github.com/mastra-ai/mastra/tree/main/workflows)）；AgentKit 见 4 | 是唯一找到的「单二进制、默认 SQLite、三平台都有」的服务型引擎。需要查：快照间隔之间崩溃会丢多少（文档没写）；SSPL 对随桌面应用分发的限制；应用需要暴露一个本机 HTTP 端点或 connect 通道 |
| [Restate](https://github.com/restatedev/restate)（[TS SDK](https://github.com/restatedev/sdk-typescript)） | server：BUSL-1.1（附加使用许可禁止作为面向第三方的公开 Restate 平台服务；`LICENSE`）；TS SDK：MIT | 「分布式的持久化 async/await」：服务作为 HTTP 端点注册到 Restate 服务器，由它持久化每一步并重试；持久化睡眠在服务重启后只补睡剩余时间（[quickstart](https://docs.restate.dev/get_started/quickstart)） | 服务器是单个自包含二进制（同页）；最新 release 的发布物只有 macOS 与 Linux（aarch64、x86_64），没有 Windows 二进制；quickstart 也没有 Windows 步骤。SDK 为 Node.js 或 TS，可作为长驻进程或 AWS Lambda（SDK README） | server v1.8.1（2026-10-21）；TS SDK v1.17.4（2026-10-20） | OpenAI Agents SDK 的 Restate 集成（文档称需要 Restate 的单二进制运行时）与 Pydantic AI 的持久执行引擎之一（[running_agents](https://github.com/openai/openai-agents-python/blob/main/docs/running_agents.md)、[README](https://github.com/pydantic/pydantic-ai)） | 单二进制符合嵌入形态；没有 Windows 二进制是硬障碍，除非走 Docker 或自行编译。存储细节本次未取到（quickstart 外的文档 404） |
| [Hatchet](https://github.com/hatchet-dev/hatchet) | MIT | 面向后台任务、AI agent 与持久工作流：重试与退避、cron 与定时运行、事件触发、持久任务、持久睡眠与事件等待、速率限制、按键并发（[README](https://github.com/hatchet-dev/hatchet)） | 以 Postgres 作为任务运行时与可观测性的持久层；RabbitMQ 可选；`hatchet-lite` 是单个 Docker 镜像，文档面向开发、测试与低吞吐生产；文档另提到不需要 Docker 的本地开发嵌入模式，细节未读（[self-hosting](https://docs.hatchet.run/self-hosting)）。SDK：Python、TS、Go、Ruby | v0.110.5（2026-10-06），仓库创建 2023-12-15 | 未查到 | 要 Postgres，不满足「SQLite」；嵌入模式的限制没读到 |
| [Trigger.dev](https://github.com/triggerdotdev/trigger.dev) | Apache-2.0 | 任务、等待、waitpoint（人工介入）、cron、并发与队列、自动重试、检查点（[README](https://github.com/triggerdotdev/trigger.dev)） | 自托管用 Docker Compose 或 Kubernetes，需要 Redis 与 Postgres；自托管版没有检查点、预热与自动扩缩（[自托管概览](https://trigger.dev/docs/self-hosting/overview)） | v4.7.7（2026-10-22），仓库创建 2022-11-30 | 未查到 | 自托管形态偏服务器，且检查点只在云端，不适合嵌入 |

### 2.2 小结

- 唯一同时满足「单二进制、默认 SQLite、macOS 与 Windows 均有发布物」的是 Inngest；Temporal 的 CLI 也三平台都有、开发服务器可写 SQLite，但官方不用于生产，TS worker 又不支持 Bun；Restate 是单二进制，但最新发布物没有 Windows。
- 许可证各不相同且都有条件：Temporal 与 Hatchet 为 MIT，Trigger.dev 为 Apache-2.0，Inngest 为 SSPL 加未来 Apache 条款，Restate 服务器为 BUSL-1.1。随桌面应用再分发时，后两者的条款需要逐条读。
- 这一类的共同形态是「应用 + 一个常驻本机服务进程」，应用侧要暴露 HTTP 端点或建立连接。#162 里已有一个 CLI 子进程约 150 到 220 MB 常驻内存，这里再加一个服务进程的资源与生命周期管理，本次没有任何一项给出内存占用数据（未查到）。

---

## 3. 以 Postgres 或 Redis 为后端的库、队列与云运行时

### 3.1 总表

| 名称 | 许可证 | 一句话 | 平台与语言 | 成熟度 | 使用方 | 适配 |
| --- | --- | --- | --- | --- | --- | --- |
| [DBOS（TS）](https://github.com/dbos-inc/dbos-transact-ts) | MIT | 以库形式嵌入、把工作流与步骤检查点写入 Postgres；持久队列、通知、调度、事件处理都是 Postgres 原语，不要单独的消息服务（[README](https://github.com/dbos-inc/dbos-transact-ts)） | TS，Node 20 及以上；README 只写 Postgres，本次在仓库里没有搜到 SQLite 支持 | v5.3（2026-10-15），仓库创建 2023-07-12 | 未查到 | Python 版有 SQLite、TS 版没有，是最可惜的错位；不满足「SQLite」 |
| [pg-boss](https://github.com/timgit/pg-boss) | MIT | Node 用的 Postgres 队列（仓库简介） | TS 与 Node | 12.38.0（2026-10-13），仓库创建 2016-02-27 | 未查到 | 要 Postgres；是否能跑在嵌入式 Postgres（如 PGlite）上，本次未查到 |
| [graphile-worker](https://github.com/graphile/worker) | MIT | Node 与 Postgres 的任务队列，可由 Postgres 触发器产生任务（仓库简介） | Node | v0.18.0（2026-09-08），仓库创建 2019-03-01 | 未查到 | 同上 |
| [Absurd](https://github.com/earendil-works/absurd) | Apache-2.0 | 「只依赖 Postgres」的持久执行系统，处理调度与重试，作者自称实验（[README](https://github.com/earendil-works/absurd)） | 未读语言细节 | 创建 2025-10-20 | Pydantic AI 的持久执行引擎之一（[README](https://github.com/pydantic/pydantic-ai)） | 同上 |
| [BullMQ](https://github.com/taskforcesh/bullmq) | MIT | 基于 Redis 的队列，README 首行为「Redis-based」；仓库简介另写「Redis or PostgreSQL」，Postgres 后端的细节本次未查到 | Node 为主，另有 Python、Elixir、.NET、Rust、PHP | v6.4.0（2026-10-21），仓库创建 2018-12-19 | 未查到 | 要 Redis，不嵌入 |
| [Workflow SDK（Vercel）](https://github.com/vercel/workflow) | Apache-2.0 | TS 函数持久化，进度落盘、失败步骤重试、等待时不占算力；「World」是可替换的后端：Local World 存在 `.workflow-data/` 目录（只用于开发与测试），Vercel World，第三方 Postgres World（[部署文档](https://workflow-sdk.dev/docs/deploying)） | TS；需要框架集成（README 以 Next.js 为例） | `workflow@5.2.3`（2026-10-20），仓库创建 2025-10-23 | `@ai-sdk/workflow-harness` 用它把编码 agent 跑成持久工作流（见 landscape-runtime.md） | 本机文件后端明确只作开发用；自托管路线是 Postgres |
| [TanStack Workflow](https://github.com/TanStack/workflow) | MIT | 持久执行：可恢复的运行、追加式历史、可补偿步骤；信号、审批、持久睡眠是一等原语；存储可换：内存、Drizzle 加 Postgres、Cloudflare D1，运行时与适配器标注「实验性」（[文档](https://tanstack.com/workflow/latest/docs/overview)） | TS，宿主适配器含 Node、Cloudflare、Railway、Netlify、Vercel；没有 SQLite 存储 | 创建 2026-05-20，最新 release `@tanstack/workflow-cloudflare@0.0.3`（2026-07-21） | 文档称其位于 `@tanstack/ai-orchestration` 等 agent 框架之下 | 概念贴合，但没有 SQLite 存储，且处于实验阶段 |
| [Cloudflare Agents](https://github.com/cloudflare/agents) | MIT | 每个 agent 是一个 Durable Object，自带状态、存储与调度，SQL 为 Durable Object 内的 SQLite（[README](https://github.com/cloudflare/agents)） | 只在 Cloudflare 平台运行 | `agents@0.30.0`（2026-10-22），仓库创建 2025-01-29 | 未查到 | 云运行时，与本地优先定位不合，仅作对照 |

### 3.2 小结

- 这一类里没有能直接用于「无外部服务、SQLite」的：DBOS TS、pg-boss、graphile-worker、Absurd 要 Postgres，BullMQ 要 Redis，Workflow SDK 的本机后端只用于开发，TanStack Workflow 没有 SQLite 存储，Cloudflare Agents 只在云上。
- DBOS 的 Python 版与 TS 版能力不对称：Python 有 SQLite 系统库，TS 版的 README 与依赖只有 Postgres（`package.json` 依赖 `pg`）。
- 「Postgres 运行在应用进程内」这条路（例如 PGlite）本次只在搜索中见到 PGlite 本身的介绍，没有查到任何工作流库声明支持它；未验证。

---

## 4. agent 框架与产品内置的持久化、挂起与调度

### 4.1 总表

| 名称 | 许可证 | 一句话 | 平台与语言 | 成熟度 | 使用方 | 适配 |
| --- | --- | --- | --- | --- | --- | --- |
| [LangGraph 检查点与 `interrupt()`](https://docs.langchain.com/oss/javascript/langgraph/persistence) | MIT | 每个 `thread_id` 保存图状态快照；`interrupt()` 挂起、返回载荷，凭同一 `thread_id` 与 `Command({resume})` 恢复，恢复时节点从头重跑；检查点实现有内存、SQLite（文档标为开发用）、Postgres，`libs/` 下另有 mongodb、redis（[persistence](https://docs.langchain.com/oss/javascript/langgraph/persistence)、[interrupts](https://docs.langchain.com/oss/javascript/langgraph/interrupts)） | TS；SQLite 实现依赖 `better-sqlite3`，Node 18 及以上（`libs/checkpoint-sqlite/package.json`） | `checkpoint-sqlite` 1.1.0 | 见 landscape-runtime.md | 恢复语义清晰；它不负责定时与队列，只负责「暂停点」 |
| [Mastra 挂起与恢复、工作流引擎](https://github.com/mastra-ai/mastra) | 见 landscape-runtime.md | 工作流快照存入存储，挂起后重启可恢复；libSQL 可用本地文件；存储域里另列了后台任务与调度（[storage](https://mastra.ai/docs/server-db/storage)）。工作流还能跑在 Inngest（`workflows/inngest`）与 Temporal（`workflows/temporal`，实验性）上 | TS | `@mastra/core@1.79.0` | 见 landscape-runtime.md | 是少数把「挂起、SQLite 存储、可换成外部引擎」放在同一框架里的；定时与调度的具体能力本次没读 |
| [Inngest AgentKit](https://github.com/inngest/agent-kit) | Apache-2.0 | 多 agent「网络」：共享状态、交接、可编程路由，配合 Inngest 的持久执行（[README](https://github.com/inngest/agent-kit)） | TS | `@inngest/agent-kit@0.13.2`（2025-11-13），仓库最近推送 2026-04-29，创建 2024-11-18 | 未查到 | 近一年没有新 release；依赖 Inngest 服务 |
| [OpenAI Agents SDK 的持久执行集成](https://github.com/openai/openai-agents-python/blob/main/docs/running_agents.md) | MIT | Python 文档列出 Dapr、Temporal、Restate、DBOS 四种集成，用于跨长时间等待、重试与进程重启的 agent；JS 侧的同类集成未查到 | Python | 见 landscape-runtime.md | 见 landscape-runtime.md | 说明主流 agent 框架的做法是「把循环交给外部引擎」，而不是自带调度 |
| [Pydantic AI 的持久执行](https://pydantic.dev/docs/ai/capabilities/durable_execution/overview/) | MIT | 在 Temporal、DBOS、Prefect、Restate、AWS Lambda、Airflow、Absurd、pgtask 八种引擎上运行同一个 agent，前五种与厂商共同维护（[README](https://github.com/pydantic/pydantic-ai)） | Python | v2.59.0 | 同左 | 这份清单可以当作「外部引擎都有谁」的索引 |
| [Vercel `@ai-sdk/workflow-harness`](https://github.com/vercel/ai/tree/main/packages/workflow-harness) | Apache-2.0 | 把一个 `HarnessAgent`（Claude Code、Codex、Pi）跑成 Workflow DevKit 的持久步骤，按时间片或语义步骤冻结，序列化状态作为步骤返回值（[README](https://github.com/vercel/ai/tree/main/packages/workflow-harness)） | TS | 1.0.161；`@ai-sdk/harness` 标「experimental」 | 同左 | 是本次唯一见到的「把外部编码 CLI 成员接到持久工作流」的现成包；依赖的 Workflow SDK 本机后端只用于开发，见 3.1 |
| [Claude Code 自带的定时能力](https://code.claude.com/docs/en/scheduled-tasks.md) | 闭源 | 会话级：`/loop` 与 `CronCreate`、`CronList`、`CronDelete`，5 字段 cron，一个会话最多 50 个任务，周期任务 7 天后过期，任务只在 Claude Code 运行且空闲时触发，不补发错过的触发，并有抖动；`--resume` 恢复未过期任务。独立于会话的持久定时是云端的 routines、桌面的 Desktop 定时任务与 GitHub Actions（同页）。环境变量 `CLAUDE_CODE_DISABLE_CRON=1` 可整体关闭 | 随 Claude Code | 上游 v2.1.309；fork 是否带这些工具未查到 | Claude Code 自身 | 属于「提醒与轮询」，不是团队成员的唤醒机制；定时点落在轮次之间，且依赖进程存活 |

### 4.2 小结

- agent 框架的主流分工是：框架负责「一轮之内」与「暂停点」，持久化、定时与队列交给外部引擎（OpenAI Agents SDK、Pydantic AI 都列出多个可选引擎）。
- 只有 Mastra 同时给出了自带的 SQLite 级存储和外部引擎两条路；LangGraph 只给暂停点和检查点，不管定时。
- Claude Code 自己的定时器是进程内、轮次间触发、会过期的，自定节奏的 `/loop` 在后台会话进程崩溃后不再触发（同页 Limitations）；这与 #162 里「成员常驻在 CLI 进程内」的现状属于同一类生命周期约束。

---

## 5. 值得深拆的候选

下面只写意见，按推荐顺序，均按 [_template.md](_template.md) 的格式做完整拆解。

1. OpenWorkflow。TS、Bun 与 Node 都支持、SQLite 后端、无中心服务，且同时有信号等待、cron、睡眠、重试，几乎逐条对应「人工等待做成可恢复步骤」「唤醒规则」「崩溃恢复」。要查：幂等与去重、租约与崩溃接管的实现、`node:sqlite` 在打包后的 Tauri sidecar 里的可用性、0.x 的 API 稳定性、Windows。
2. reflow-ts。与 OpenWorkflow 同类、体量更小，租约接管与幂等键写得最具体。适合与 OpenWorkflow 并排拆解，比较「库该多重」。项目约 40 星、创建不到一年，维护风险要单独评估。
3. Inngest（单二进制模式）。唯一找到的服务型引擎同时满足三平台发布物与默认 SQLite，流控词汇（并发、去抖、批处理、按事件取消）也最接近多 agent 唤醒需求。要查：内存 Redis 加定期快照的崩溃窗口、SSPL 与未来 Apache 条款对随应用分发的影响、本机 HTTP 端点的生命周期、资源占用。
4. Temporal（开发服务器 + TS SDK）。作为语义标杆：历史重放、定时器、信号、调度。拆解目的是确认三个阻碍是否可绕开：开发服务器不用于生产、TS worker 不支持 Bun、分发 Go 子进程。结论大概率是「借语义不嵌入」，但需要一份证据。
5. Mastra 的挂起、存储与工作流引擎层（与 landscape-runtime.md 的 Mastra 候选合并拆）。要查它的工作流快照表结构、调度能力的实际范围，以及与 Inngest、Temporal 适配器之间的接口，看能否只取「快照加恢复」的设计。
6. Vercel `workflow-harness` 加 Workflow SDK。唯一把外部编码 CLI 接进持久工作流的组合；要查冻结与恢复发生在什么边界、序列化状态大小，以及换掉 Vercel 专属沙箱与 World 后的可行性。

没有列入的：DBOS TS、pg-boss、graphile-worker、Absurd、Hatchet、Trigger.dev、BullMQ（都要外部数据库或 Redis，且无嵌入形态）；Restate（没有 Windows 二进制，存储文档本次没取到，可在 Windows 支持改变后重评）；TanStack Workflow（没有 SQLite 存储，实验阶段）；Cloudflare Agents（只在云上）；liteque（只是队列）；bunqueue 的队列部分（按需要可作为 Bun 内的队列补充，不单独拆解）。

## 6. 空白

按我们的需求逐项列出，目前没有找到做得好的现成方案：

1. 经过验证、可在桌面应用里长期运行的 SQLite 持久工作流：OpenWorkflow 与 reflow-ts 的文档与功能齐全，但都是新项目，没有找到它们在桌面应用或 Tauri sidecar 里的使用案例。
2. 「团队成员唤醒」这一层的专用库：唤醒规则（任务拥有者与依赖、事件、心跳）只在 Multica、Paperclip、cc-haha 的各自实现里（#162）。通用引擎提供的是定时器、信号与队列原语，没有找到面向「多 agent 成员、任务依赖、失败后重新唤醒负责人」的现成规则层。
3. Windows 上的服务型引擎：Restate 最新发布物没有 Windows，Hatchet 与 Trigger.dev 要 Docker 与外部数据库，Inngest 与 Temporal CLI 有 Windows 发布物，但 Temporal 的 TS worker 不支持 Bun。
4. 崩溃窗口的明确保证：Inngest 单二进制模式把内存 Redis 的快照周期性写入 SQLite，文档没有说明两次快照之间崩溃会发生什么；OpenWorkflow 与 reflow-ts 的 SQLite 写入语义也没有读到明确的耐久性声明（reflow-ts 的 README 自称 fsync 加 WAL）。
5. 与 CLI 进程生命周期的衔接：Claude Code 的定时器依赖进程存活且不补发，通用引擎也不管「被包装的 CLI 进程是否还在、会话能否恢复」。把「引擎的重试」与「CLI 会话的 resume」接起来，只在 Vercel `workflow-harness` 里见到一个设计，且依赖托管沙箱。
6. 人工等待的跨进程入口：引擎层的信号与 waitpoint 只解决「暂停与恢复」，对应到桌面界面里「谁来回复、多个客户端谁先答」的是 #150 的首答为准语义，这一层没有找到可复用的实现。
7. 本次未覆盖：Dapr Workflow、Cadence、Conductor、Windmill、Kestra、Effect 的集群与工作流包、Prefect 与 Airflow 的细节、Cloudflare Workflows。PGlite 上运行 Postgres 系队列的可行性未验证。
