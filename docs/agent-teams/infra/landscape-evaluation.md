# 评测全景

核实日期：2026-10-23。范围：为同一项目并行运行多个编码 agent 时，如何证明团队比单 agent 好，以及如何对团队行为做回归测试：多 agent 是否对编码有帮助的研究证据（含负面结果）、可直接使用的基准、评测框架。上层产品见 [README](../README.md) 与 [research/](../research/)，同级的可观测性层见 [landscape-observability.md](landscape-observability.md)。背景讨论见 [#162](https://github.com/GoDiao/dreamcoder/issues/162)。

## 0. 读法与核实约定

- 本次只读：没有安装、构建或运行任何被调研的工具与基准；GitHub 只用 `gh` 读接口，网页只读。
- 「许可证」「仓库创建」「最新 release 与日期」除特别标注外，均来自对应仓库的 GitHub API（2026-10-23 读取）。论文的日期与数字来自 arXiv 摘要页或 HTML 全文的对应段落，在格内标出版本；只读到搜索摘要的，标「搜索摘要，未读原文」。
- GitHub 判定为 NOASSERTION 或 none 的仓库，在许可证格里写明读到的实际文本或「未核实」。
- 「未查到」表示查过但没有证据；「不适用」表示问题本身不适用。
- 表中「使用方」写采用或引用它的基准、框架或产品，没有出处的不写。
- 判断与建议只出现在每节的「适配」列和文末两节里。
- 本层的前提事实：DreamCoder 团队模式在 `--print` 进程内以 AsyncLocalStorage 区分队友，队友共用 lead 的目录，没有 worktree 隔离，没有合并（[#162](https://github.com/GoDiao/dreamcoder/issues/162)；[research/claude-code.md](../research/claude-code.md)）。Claude Code 官方成本文档称 agent teams 在队友用 plan 模式时约用普通会话 7 倍的 token（[costs](https://code.claude.com/docs/en/costs.md)「Manage agent team costs」）。

---

## 1. 研究证据：多 agent 对编码是否有帮助

### 1.1 总表

| 名称 | 许可证（代码与数据） | 一句话 | 平台与前提（规模与运行方式） | 成熟度 | 使用方 | 适配 |
| --- | --- | --- | --- | --- | --- | --- |
| [Towards a Science of Scaling Agent Systems](https://arxiv.org/abs/2512.08296)（Google Research、DeepMind、MIT） | 论文；代码与数据：未查到 | 260 个配置、六个基准、五种架构（单 agent 加独立、集中、去中心、混合四种多 agent）、三个模型家族，相对单 agent 的变化从可分解的金融推理 +80.8% 到顺序规划 -70.0%；单 agent 基线已超过约 45% 的任务，加 agent 反而收益为负（[v3 摘要](https://arxiv.org/abs/2512.08296)、[HTML](https://arxiv.org/html/2512.08296v3)） | 含 SWE-bench Verified 与 Terminal-Bench：SWE-bench Verified 上所有多 agent 架构都低于单 agent（均值 0.522）：混合 -2.1%、集中 -3.1%、去中心 -5.4%、独立 -14.9%；Terminal-Bench 上独立 +1.7%、集中 -19.2%，其余两种未报告；八个模型，每基准 20 个实例的子集（HTML 全文）。跨基准的错误放大倍数：独立 17.2、去中心 7.8、混合 5.1、集中 4.4（同页，非单独对编码） | v1 2025-12-09；v3 2026-04-08 | 使用方：未查到 | 直接针对编码基准的负面证据，但样本是 20 实例的子集；论文称工具多的任务协调开销更大（同页，β = -0.096） |
| [Why Do Multi-Agent LLM Systems Fail?（MAST）](https://arxiv.org/abs/2503.13657) | 论文；仓库 [MAST](https://github.com/multi-agent-systems-failure-taxonomy/MAST) 未设许可证 | 摘要称多 agent 系统在流行基准上的收益常常很小；提出 14 种失败模式、三类（系统设计、agent 间错位、任务验证），由 150 条 trace 建立，标注一致性 kappa 0.88；MAST-Data 含 1600 条以上标注 trace，来自 7 个框架，任务含编码、数学与通用 agent（摘要） | 模型含 GPT-4、Claude 3、Qwen2.5、CodeLlama（摘要）；七个框架具体名单：摘要页未列，未查到 | v1 2025-03-17；v3 2025-10-26；仓库最近提交 2025-07-23 | 使用方：未查到 | 给出失败模式分类与 LLM 标注流水线，可直接用来给我们的 trace 打标签；数据是 2025 年的老模型 |
| [CooperBench: Why Coding Agents Cannot be Your Teammates Yet](https://arxiv.org/abs/2601.13295) | 仓库 [cooperbench/CooperBench](https://github.com/cooperbench/CooperBench)：GitHub 判定无许可证，README 徽章标 MIT；数据集在 [HuggingFace](https://huggingface.co/datasets/CodeConflict/cooperbench-dataset) | 两个 agent 各做一个互相兼容但改动重叠的特性，两个补丁都要能干净合并并通过各自测试才算成功；摘要称协作时成功率平均比各自单独做低 30%，失败模式为沟通通道被含糊或不准确的消息堵塞、agent 偏离自己的承诺、agent 对他人计划有错误预期（摘要） | 600 多个任务、12 个库、4 种语言；README 要求 Python 3.12、Redis（agent 间通信）、执行后端三选一：Modal（默认）、GCP、本机 Docker（README） | v1 2026-01-19；v2 2026-01-26；仓库 v0.0.29（2026-08-15），最近提交 2026-10-18 | Harbor 有适配器（见 3.1） | 唯一专门度量「同仓库并行协作」的基准；它的协作通道是 Redis 消息，不是文件邮箱 |
| [Passes Alone, Fails Together（stale 基准）](https://arxiv.org/abs/2609.25396) | 论文；摘要页没有给出代码或数据位置，未查到 | 同样的测试分别跑在每个补丁上与合并后的补丁上，只计合并引入的失败；构造任务上 97% 的运行出现干扰；在 417 对真实 Django PR（834 次运行）里校正评分后只有一对出现干扰；一条描述并发改动的消息让 82% 的运行恢复；作者声明构造任务的失败率不代表实际频率（摘要） | 三档：合成、合并的真实 PR 对、基于 12 个 Django 辅助函数的构造任务；六页短文 | 2026-09-21 提交，EXPRESS 2026 接收 | 使用方：未查到 | 度量「文本合并成功但语义冲突」，与 [landscape-workspace.md](landscape-workspace.md) 第 2 节「合并后语义冲突」的空白对应 |
| [Effective Strategies for Asynchronous Software Engineering Agents（CAID）](https://arxiv.org/abs/2603.21489)（Geng、Neubig） | 论文；代码：未查到 | 提出集中式异步隔离委派：中心 manager 做依赖感知的任务计划，子任务在隔离工作区并发执行，用测试验证后汇总；相对单 agent 基线，PaperBench 绝对提升 25.6%，Commit0 提升 14.7%；称分支与合并是核心协调机制，git worktree、commit、merge 可可靠实现（摘要） | 基准为 PaperBench（论文复现）与 Commit0（Python 库开发），不含 SWE-bench | v1 2026-03-23；v2 2026-07-08 | 使用方：未查到 | 与我们的形态最近（worktree 隔离加 lead 合并），是少数报告正收益的编码方向的论文；任务类型是长程、可分解 |
| [Anthropic：How we built our multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system) | 不适用（工程博客） | 多 agent 系统（Opus 4 做 lead、Sonnet 4 做子 agent）在内部研究评测上比单 agent Opus 4 高 90.2%；agent 约用对话 4 倍 token，多 agent 约 15 倍；文中称多数编码任务可并行的部分比研究任务少；起初用约 20 个查询，评分用单次 LLM 调用输出 0.0 到 1.0 分与通过判定（博客） | 内部评测，非公开基准 | 未标日期 | Anthropic 自家研究功能 | 正面结果来自研究任务而非编码；作者自己说明编码适合度较低 |
| [Cognition：Don't Build Multi-Agents](https://cognition.com/blog/dont-build-multi-agents) | 不适用（博客） | 两条原则：共享完整上下文、动作即决策；子 agent 各自带着不同假设、看不到彼此决定，输出会冲突；在 agent 间通信更可靠之前，单线程 agent 更稳（博客） | 无实验数据，为观点文章 | 2025-06-12 | 使用方：未查到 | 与 CooperBench 的失败模式（承诺偏离、错误预期）方向一致，但本身没有数据 |
| [Anthropic：Building a C compiler with a team of parallel Claudes](https://www.anthropic.com/engineering/building-c-compiler) | 不适用（工程博客） | 搜索摘要称 16 个 agent、近 2000 个 Claude Code 会话、约 2 万美元 API 费用，产出约 10 万行的编译器，可构建 Linux 6.9（x86、ARM、RISC-V）；强调测试与 harness 的设计（搜索摘要，未读原文；[The Register 报道](https://www.theregister.com/2026/02/09/claude_opus_46_compiler/)称有观察者持怀疑态度） | 无对照组（没有同预算的单 agent 基线），未读原文，是否有则未查到 | 2026-02 | Anthropic agent teams 的演示 | 只能证明团队模式能做长任务，不能证明比单 agent 好，也给出了成本量级 |
| [MultiAgentBench / MARBLE](https://arxiv.org/abs/2503.01935) | 论文；代码 [MARBLE](https://github.com/MultiagentBench/MARBLE) MIT（另有 [ulab-uiuc/MARBLE](https://github.com/ulab-uiuc/MARBLE) 同为 MIT） | 评估多 agent 的协作与竞争；六个场景：Research、Minecraft、Database、Coding、Bargaining、WereWolf；摘要比较了星、链、树、图四种协调拓扑与小组讨论、认知规划，认知规划使里程碑达成率提升约 3%；编码场景按规则型指标评分（[v1 HTML](https://arxiv.org/html/2503.01935v1)） | 任务完成与基于里程碑的 KPI；编码场景的附录细节与结果未读 | 2025-03-03；仓库较新提交 2025-10-27（ulab-uiuc）与 2025-06-21（MultiagentBench） | 使用方：未查到 | 是唯一明确含「编码」场景的多 agent 基准，但编码场景的规模与模型成绩未读 |
| 真实仓库中的 agent PR 冲突：[AgenticFlict](https://arxiv.org/abs/2604.03551) 与 [AI Agent Pull Requests on GitHub](https://arxiv.org/abs/2607.04697) | 数据集在 Zenodo（DOI 10.5281/zenodo.19396917，许可证未读） | AgenticFlict：14.2 万以上的 agent PR，对 10.7 万以上做确定性合并模拟，约 2.9 万出现冲突，冲突率 27.67%，只捕获文本冲突（搜索摘要）；后一篇称 33,596 个 PR 中跨 agent 的 PR 对冲突率 41.7%，同 agent 对 19.8%（搜索摘要，未读原文） | 观察性数据，不是受控实验 | 2026-04 与 2026-07 | 使用方：未查到 | 给出「并行 agent 在真实仓库里多常冲突」的基线，不是评测工具 |

### 1.2 小结

- 唯一直接在编码基准上比较单 agent 与多种多 agent 架构的论文（Google 等）给出的结果是：SWE-bench Verified 上所有多 agent 变体都低于单 agent；Terminal-Bench 上只有无通信的独立架构略高。
- 报告正收益的几项，任务类型是可分解的长程任务（金融推理、论文复现、库开发、研究），或没有同预算对照。
- 度量并行协作本身的基准（CooperBench、stale）一致报告协作使成功率下降，原因集中在沟通质量、承诺与预期、合并后的语义冲突，而不是单个 agent 的能力。
- 论文用的是 2025 年的模型与框架；用到的模型（Sonnet 4、GPT-5 系列、Gemini 2.5）早于现在的 Sonnet 5.5 一代，结论能否外推：未查到。

---

## 2. 基准

### 2.1 总表

| 名称 | 许可证 | 一句话 | 平台与前提 | 成熟度 | 使用方 | 适配 |
| --- | --- | --- | --- | --- | --- | --- |
| [SWE-bench](https://github.com/SWE-bench/SWE-bench)（含 Verified；`princeton-nlp/SWE-bench` 已重定向） | MIT | 真实 GitHub issue 的单 agent 修复基准 | Python | 创建 2023-10；最近提交 2026-09-18。OpenAI 在 2026-02-23 的文章里称不再评测 Verified，理由是测试用例有缺陷（至少 59.4% 的审计样本拒绝了功能正确的答案）与训练数据污染，转而推荐 SWE-bench Pro（二手：搜索结果中的 OpenAI 页面摘要，原文本次读取返回 403） | Harbor 有适配器（`swebench`、`swebench_multilingual`）；Google 那篇论文用 Verified 的 20 实例子集 | 单 agent 基准，没有多 agent 轨道；Verified 的污染问题使其作为「团队是否更好」的基准可信度存疑 |
| [SWE-bench Pro](https://github.com/scaleapi/SWE-bench_Pro-os)（Scale AI） | 仓库 MIT；Harbor 适配器自述基准与数据集为 Apache-2.0，两处不一致 | 长程软件工程任务；V2 含 642 个验证过的任务，Harbor 格式，另有 HARD-51 子集与带离线 agent 阶段、全新沙箱重评分的锁定协议（README，2026-09-22） | Python、JavaScript、TypeScript、Go；Harbor 适配器称测试集 731 个实例（适配器 README） | 创建 2025-09；v2.0.0（2026-09-22）；README 称 2026-05-18 发现排行榜存在问题 | Harbor 适配器 `swebenchpro` | 单 agent 基准；任务规模与语言最接近真实工程 |
| [Multi-SWE-bench](https://github.com/multi-swe-bench/multi-swe-bench)（ByteDance Seed） | Apache-2.0 | README 署名为字节 Seed 团队；任务与语言范围：未读 | Python | 创建 2025-02；v1.0.0（2025-06-05）；最近提交 2025-12-18 | Harbor 适配器 `multi-swe-bench` | 只列出 |
| [SWE-bench-Live](https://github.com/microsoft/SWE-bench-Live)（Microsoft） | MIT | 自动策展、持续更新的 SWE-bench 类数据集，论文 [arXiv 2505.23419](https://arxiv.org/abs/2505.23419)（README） | Python | v1.0 多语言多 OS 基准发布 2026-03-08；最近提交 2026-09-25 | 使用方：未查到 | 持续更新可缓解污染；本次未读任务规模 |
| [Terminal-Bench 2.0](https://github.com/harbor-framework/terminal-bench-2) | Apache-2.0 | 命令行任务基准，每个任务经过大量人工与语言模型辅助验证（[官方公告](https://www.tbench.ai/news/announcement-2-0)）；任务数 89 来自二手报道（[VentureBeat](https://venturebeat.com/ai/terminal-bench-2-0-launches-alongside-harbor-a-new-framework-for-testing)，搜索摘要，未核） | 经 Harbor 运行，容器内；Harbor README 的示例命令为 `harbor run --dataset terminal-bench@2.0 --agent claude-code` | 创建 2025-09；最近提交 2026-04-30；2.0 与 Harbor 同时发布，日期 2025-11-07（搜索摘要） | Harbor 官方示例；Google 论文用的是 Terminal-Bench（版本未核） | 直接支持 Claude Code 作为被测 agent；单 agent 基准 |
| [CooperBench](https://github.com/cooperbench/CooperBench) | 见 1.1 | 两个 agent 同仓库并行协作 | Docker、Modal 或 GCP，加 Redis | 见 1.1 | Harbor 适配器 `cooperbench` | 见 3.1，有 flash 子集（50 对） |
| [MARBLE](https://github.com/MultiagentBench/MARBLE) | MIT | 见 1.1 | Python | 见 1.1 | 使用方：未查到 | 含编码场景，其余场景与编码无关 |
| [Commit0](https://github.com/commit-0/commit0) | MIT | 重建 57 个核心 Python 库并通过其单元测试（README） | Python | 最近提交 2026-02-24 | CAID 论文使用（见 1.1） | 长程、可分解的库开发，CAID 在其上报告正收益 |
| [SWE-Lancer](https://github.com/openai/SWELancer-Benchmark) | GitHub 显示无许可证 | OpenAI 的自由职业任务基准 | 仓库已归档，最近提交 2025-07-18 | 创建 2025-02 | Harbor 适配器 `swelancer` | 归档，只作观察 |
| [TheAgentCompany](https://github.com/TheAgentCompany/TheAgentCompany) | MIT | 仓库名所示的模拟公司环境；具体任务与是否含多 agent：未读 | Python | v1.0.0（2024-12-20）；最近提交 2025-11-17 | Harbor 适配器 `theagentcompany` | 只列出 |

### 2.2 小结

- 主流编码基准（SWE-bench 系、Terminal-Bench、Commit0）都是单 agent 任务，没有多 agent 轨道；唯一把「两个以上 agent 同仓库协作」当作评分对象的是 CooperBench 与 stale。
- SWE-bench Verified 已被其出题相关方之一公开弃用，替代品 SWE-bench Pro 自述存在排行榜问题；基准本身的可信度处在变动中。
- Harbor 为上述大多数基准提供适配器，是目前找到的最集中的入口（见 3.1）。

---

## 3. 评测框架

### 3.1 总表

| 名称 | 许可证 | 一句话 | 平台与前提 | 成熟度 | 使用方 | 适配 |
| --- | --- | --- | --- | --- | --- | --- |
| [Harbor](https://github.com/harbor-framework/harbor)（`laude-institute/harbor` 已迁移） | Apache-2.0 | Terminal-Bench 作者的 agent 评测框架；README 称可评测 Claude Code、OpenHands、Codex CLI 等任意 agent，在 Docker 或 Daytona、Modal、LangSmith 等云沙箱里并行运行；`harbor datasets list` 列出第三方基准；仓库含 `claude_code.py`、`codex.py`、`gemini_cli.py`、`opencode.py`、`openhands.py`、`mini_swe_agent.py`、`acp.py` 等已安装 agent 适配与大量基准适配（`adapters/`：`swebench`、`swebenchpro`、`multi-swe-bench`、`cooperbench`、`swelancer`、`theagentcompany` 等） | Python，`uv tool install harbor`（搜索摘要）；本机跑要 Docker。适配器自带 ATIF-v1.2 轨迹格式；`acp.py` 的用法：未读 | 创建 2025-08；v0.24.0（2026-10-05） | Terminal-Bench 2.0 官方 harness | 现成的「被测 agent 加基准」矩阵；DreamCoder 团队模式作为被测 agent 需要自写适配，现有 `claude_code.py` 是否支持 agent teams：未读 |
| Harbor 的 CooperBench 适配器 | 同 Harbor | 199 个特性、30 个任务、12 个仓库、652 个特性对，子集 flash（50 对）与 lite；用 OpenHands agent-server 在 sidecar 容器里跑两个 agent，每个 agent 独立卷，只能经 Redis 消息协调；含 oracle 校验（适配器 README） | Docker Compose 多容器 | 同 Harbor | 使用方：未查到 | 是现成的「两个 agent 同仓库」评测，但 agent 是 OpenHands，不是 Claude Code 团队 |
| [Inspect AI](https://github.com/UKGovernmentBEIS/inspect_ai)（英国 AISI） | MIT | 评测框架，README 称含 200 多个预置评测；`sandbox_agent_bridge()` 可在沙箱里运行 Claude Code、Codex CLI 等 CLI agent，沙箱内起代理把它们的 API 调用转发到评测当前的模型 provider，调用进入 Inspect 的 transcript 与日志查看器（[agent-bridge](https://inspect.aisi.org.uk/agent-bridge.html)） | Python；沙箱经 Dockerfile 配置，Kubernetes 支持该页未提；多 agent 能力（handoff 等）：该页未覆盖 | v0.3.283（2026-10-21），创建 2023-11 | [inspect_swe](https://github.com/meridianlabs-ai/inspect_swe)（MIT，Meridian Labs，0.2.72，2026-10-20）提供 Claude Code 与 Codex CLI 等编码 agent；[inspect_evals](https://github.com/UKGovernmentBEIS/inspect_evals)（MIT）收录评测 | 桥接的做法把「被测 agent 的模型请求」收拢到评测一侧，与 DreamCoder 本机代理的位置类似 |
| [promptfoo](https://github.com/promptfoo/promptfoo) | MIT | 声明式评测与红队测试；Claude Agent SDK provider（`anthropic:claude-agent-sdk`，别名 `anthropic:claude-code`）可在评测里运行 agent：`working_dir` 默认只读、`permission_mode` 可选、`max_budget_usd` 超额即停、可定义子 agent 并限制并发与嵌套深度、默认只把子 agent 的 `tool_use` 与 `tool_result` 放进 `metadata.toolCalls`、响应默认缓存（[provider 文档](https://www.promptfoo.dev/docs/providers/claude-agent-sdk/)） | TypeScript；`ANTHROPIC_API_KEY`，或 `apiKeyRequired: false` 使用本机 Claude Code 会话（同页） | 创建 2023-04；最近提交 2026-10-23。OpenAI 2026-03-09 宣布收购，称将保持开源，二手来源未核许可证是否不变（[SecurityBoulevard](https://securityboulevard.com/2026/03/openai-acquires-security-startup-promptfoo-to-fortify-ai-agents)，搜索摘要） | 使用方：未查到 | 与 DreamCoder 同为 TypeScript；断言与成本上限适合做轻量回归，但它跑的是 SDK 里的子 agent，不是 DreamCoder 的团队模式 |
| [OpenAI evals](https://github.com/openai/evals) | GitHub 判定 NOASSERTION，未核 | 早期的评测框架与基准注册表 | Python | 无 release；最近提交 2026-04-14 | 使用方：未查到 | 活跃度低，只列出 |
| 通用评分库：[DeepEval](https://github.com/confident-ai/deepeval)（Apache-2.0，python-v4.2.4，2026-09-22）、[openevals](https://github.com/langchain-ai/openevals)（MIT，0.2.2，2026-10-22）、[autoevals](https://github.com/braintrustdata/autoevals)（MIT，py-0.4.1，2026-10-21）、[lm-evaluation-harness](https://github.com/EleutherAI/lm-evaluation-harness)（MIT，v0.4.13，2026-08-31） | 见各项 | 基于 LLM 或规则的评分与模型评测库；各项对 agent 轨迹评测的支持：未读 | Python | 见各项 | 使用方：未查到 | 仅列出 |
| 参考 agent：[mini-swe-agent](https://github.com/SWE-agent/mini-swe-agent)（MIT，v2.4.6，2026-07-23）、[SWE-agent](https://github.com/SWE-agent/SWE-agent)（MIT，v1.1.0，2025-05-22，最近提交 2026-10-19）、[OpenHands](https://github.com/OpenHands/OpenHands)（MIT，v1.31.0，2026-10-22） | MIT | mini-swe-agent README 自述比 SWE-agent 简单约 100 倍，并称在 DeepSWE 上超过 Claude Code 与 Codex（自述，未独立核实）；OpenHands 的 SDK 被 CooperBench 的 Harbor 适配器采用 | Python；OpenHands 为 TypeScript 主体（GitHub 语言栏） | 见各项 | Ramp SWE-Bench 使用 mini-swe-agent（README） | 作为「简单单 agent 基线」的候选 |

### 3.2 小结

- 现有框架里，能把 Claude Code 当作被测对象跑的有三个：Harbor（`claude-code` 内置 agent）、Inspect（`sandbox_agent_bridge` 与 `inspect_swe`）、promptfoo（Claude Agent SDK provider）。三者都在被测 agent 外面再包一层，都不特别处理 agent teams。
- 只有 Harbor 同时带有 CooperBench 的适配器，但其 agent 是 OpenHands；用 Claude Code 团队模式去跑 CooperBench，需要自写适配，本次没有找到现成实现。
- 运行成本：CooperBench、SWE-bench Pro、Terminal-Bench 每个任务的 token 与美元成本，本次没有找到公开的统一数字。可参照的量级只有 Anthropic 的 15 倍 token（研究系统）、Claude Code 文档的约 7 倍（agent teams）、以及 C 编译器项目的约 2 万美元（搜索摘要）。

---

## 4. 值得深拆的候选

下面只写意见，按推荐顺序，均按 [_template.md](_template.md) 的格式做完整拆解。

1. Harbor（含 `claude_code.py`、`acp.py` 与 CooperBench 适配器）。它是同时覆盖 Terminal-Bench 2.0、SWE-bench Pro、CooperBench 的最集中入口，Apache-2.0，Claude Code 是内置 agent。要查：自写一个「DreamCoder 团队模式」agent 适配需要多少工作、`acp.py` 能否直接驱动 DreamCoder 服务端、适配器如何传递 provider 凭据。
2. 「Towards a Science of Scaling Agent Systems」与 CooperBench 的方法拆解。前者给出任务类型与是否值得用团队的预测框架（45% 阈值、可分解性），后者给出协调失败的度量。我们若要宣称「团队比单 agent 好」，应先按它们的口径选择任务，否则结果大概率为负。要查：论文的任务选择规则、模型换代后的复现情况。
3. Inspect AI 的 `sandbox_agent_bridge`。把被测 agent 的模型请求收拢到评测侧，对应我们的本机代理；可作为「回归测试团队行为」的框架，因为它的日志含完整 transcript。要查：多 agent 或并发 agent 在 transcript 中如何区分。
4. promptfoo 的 Claude Agent SDK provider。TypeScript、断言与成本上限现成，适合作为开发者每次提交都能跑的低成本回归；要查：被收购后的许可证与维护、能否改为驱动 DreamCoder 的 HTTP 会话接口。
5. 一套自己的小评测（先设计再拆解）：用 DreamCoder 已有的 mock SDK 夹具（`src/server/__tests__/fixtures/mock-sdk-cli.ts`）加脚本化 provider（本机代理可指向它）做不花模型费用的团队行为回归，断言认领、投递、冲突、合并这些确定性行为；再用 10 到 20 个自选的可分解任务对比单 agent 与团队的通过率、token、耗时，每项重复多次。成本数据先自己测，不套用他人数字。
6. MAST 的标注流水线。把团队运行的 trace 按 14 种失败模式自动打标签，用来发现回归，而不是只看通过率；要查：标注器能否脱离 2025 年的模型与框架使用。

没有列入的：SWE-bench Verified（官方相关方已弃用）、SWE-Lancer（仓库归档）、TheAgentCompany 与 Multi-SWE-bench（本次读得浅，列在表里作观察）、OpenAI evals（活跃度低）、各通用评分库（对 agent 轨迹的支持未读）。

## 5. 空白

按我们的需求逐项列出，目前没有找到做得好的现成方案：

1. 以「团队模式」为被测对象的评测：Harbor、Inspect、promptfoo 都在被测 agent 外面包一层，没有找到任何一个把 Claude Code agent teams（队友、共享任务、mailbox）当作一等对象评测的做法，也没有找到公开的 agent teams 对单 agent 的对照数据。
2. 编码上的正面证据：本次找到的、直接在编码基准上比较的论文报告负或近零的结果；正面结果来自研究任务、论文复现、库开发，且部分没有同预算对照。没有找到「同一个编码团队产品在同预算下稳定优于单 agent」的公开评测。
3. 并行编码的标准基准：CooperBench 是两个 agent 的一次性任务；多个 agent 长时间并行、依赖随时间变化的基准没有找到。
4. 成本与预算的对齐：比较团队与单 agent 时，应按同样的 token 或美元预算比较；没有找到公认的预算归一化做法。订阅计费下美元成本本身只是估算（见 [landscape-gateway.md](landscape-gateway.md) 第 5 节）。
5. 非确定性的度量：多数基准按单次运行报告；对重复次数、置信区间的约定本次没有读到。Google 论文每基准只用 20 个实例的子集。
6. 基准与评测框架的稳定性：Verified 已被弃用，Pro 自述排行榜有问题，Harbor 迁了组织，promptfoo 被收购，这一层的依赖变动很快，固定到具体版本与提交的做法是必要的。
7. 合并后语义冲突的度量：stale 是目前找到的唯一一项，没有代码位置，真实仓库里的发生率据其作者说远低于构造任务。
8. 模型代差：CooperBench、Google 论文、MAST 用的是 2025 年到 2026 年初的模型；对当前模型的复现结果没有找到。
