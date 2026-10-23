# 多 agent 基础设施

agent team 底下的各层能力，按层调研，每层一份全景文件。产品层的拆解见 [../README.md](../README.md)。

## 目录

| 路径 | 内容 |
| --- | --- |
| [_template.md](_template.md) | 基础设施拆解的固定格式与写作规则（12 节） |
| [landscape-workspace.md](landscape-workspace.md) | 工作区与执行环境：工作区隔离、合并与冲突、沙箱执行、检查点与历史、agent 间通信 |
| [landscape-runtime.md](landscape-runtime.md) | agent 运行时与框架 |
| [landscape-orchestration.md](landscape-orchestration.md) | 持久化编排与调度 |
| [landscape-task-state.md](landscape-task-state.md) | 共享任务与状态 |
| [landscape-permissions.md](landscape-permissions.md) | 权限与人工审批 |
| [landscape-memory.md](landscape-memory.md) | 共享记忆与上下文交接 |
| [landscape-gateway.md](landscape-gateway.md) | 模型网关：多 provider、用量、预算 |
| [landscape-observability.md](landscape-observability.md) | 可观测性 |
| [landscape-evaluation.md](landscape-evaluation.md) | 评测 |
| <项目>.md | 每个项目一份拆解 |
| [workspace-isolation.md](workspace-isolation.md) | 成员工作区隔离：统一接口、各实现对照、macOS 实测 |
| [workspace-isolation-log.md](workspace-isolation-log.md) | 成员工作区隔离的探索记录：讨论结论、读代码发现、实验 |
| [experiments/](experiments/) | 实验脚本，每个实验一个目录 |

## 已完成的拆解

| 项目 | 文档 | 核实版本 | 许可证 | 类别 |
| --- | --- | --- | --- | --- |
| LayerFS | [layerfs.md](layerfs.md) | `1aa56ec`（v1.0.0 之后，2026-10-23） | MIT | 工作区隔离、合并与冲突、状态与历史 |

## 深拆候选

来自各层全景文件的「值得深拆的候选」一节，尚未拆解。

| 层 | 候选 |
| --- | --- |
| 工作区与执行环境 | Worktrunk、Jujutsu、Weave（对照 Mergiraf）、Microsoft MXC、Codex 的 Windows 沙箱、Entire CLI、GitButler、Docker Sandboxes |
| 运行时与框架 | Vercel AI SDK Harness、Mastra、Claude Agent SDK、ACP、OpenAI Agents SDK（JS）、LangGraph.js |
| 持久化编排 | OpenWorkflow、reflow-ts、Inngest 单二进制、Temporal（语义参照）、Mastra 挂起与存储、Vercel Workflow |
| 共享任务与状态 | Beads、Claude Code `claimTask`（对照 #163）、OpenAI Symphony 规格、mcp_agent_mail（只看设计）、LiveStore、Backlog.md |
| 权限与人工审批 | Claude Code 审批通道（`canUseTool`、`PermissionRequest`）、HumanLayer、OpenAI Agents SDK 审批、Codex guardian、Cedar |
| 共享记忆与交接 | fork 内的记忆模块、Codex 压缩与记忆管线、MCP memory 服务、Letta 记忆块、Amp handoff 与 Cline `/newtask`、Cognee |
| 模型网关 | Claude Code 网关请求头（agent id）、DreamCoder 本机代理 `src/server/proxy`、LiteLLM、Bifrost、claude-code-router、Vercel AI SDK provider 实例 |
| 可观测性 | fork 遥测 `src/utils/telemetry/`、OpenTelemetry GenAI agent span、Phoenix、Langfuse、hooks 转 trace 方案、disler 的 hooks 多 agent 观测 |
| 评测 | Harbor、Scaling Agent Systems 与 CooperBench 方法、Inspect AI、promptfoo、自建小评测、MAST 失败分类 |

## 对比矩阵

每格取自对应拆解文档该节的「要点」。拆解文档更新后，同步更新这里。

| 维度 | LayerFS |
| --- | --- |
| 1. 定位 | 多 agent 共享的版本化工作树底座，Linux FUSE + 单文件 SQLite Store，只管文件与历史，不管 agent 调度。 |
| 2. 核心模型 | Store（SQLite）→ Layer / Branch / Commit 的不可变历史 → 每次挂载一个临时 Workspace，只有 Commit 才改写历史。 |
| 3. 隔离 | 每个 Workspace 是整棵项目树（含 `.git` 与依赖）的写时复制视图，隔离粒度是文件系统，不是进程或网络。 |
| 4. 合并与冲突 | 文本按行做三方合并，同文件不同区域自动合并；Workspace Commit 冲突时在 Workspace 写标记、`branch.merge` 冲突时什么都不建；`publish` 不合并、只覆盖，合并要先自己做。 |
| 5. 历史与回退 | 每次写与每次 Commit 都是可 fork 的不可变检查点，历史只增不删，没有重置，也没有 GC。 |
| 6. 平台与前提 | 只有 Linux 是原生的；macOS 与 Windows 都是在 Docker 容器或 WSL2 里的 Linux 上跑，没有原生 FUSE 层，也没有人在做。 |
| 7. 性能与资源 | 挂载约 10 ms、小 Commit 数十毫秒、依赖随挂载复用且全局去重，但元数据密集操作（git status、find、pnpm）比原生慢 1.3 到 39 倍，数据为 v1.0.0 之前的 Docker Desktop 单样本。 |
| 8. 接入方式 | 公开接入面只有 JS SDK；dsh 集成靠提示词、环境变量和 agent 自写的 Node 脚本，不替换也不拦截任何内置工具。 |
| 9. 与 git 的关系 | 与 git 并行的独立版本系统；能导入含 `.git` 的目录，没有导出或写回，成果取出路径未查到。 |
| 10. 可靠性与安全 | 只有 Disposable 档位，无崩溃持久性与恢复；写入串行经发布通道，调用不重放；对 agent 命令的约束完全来自外层沙箱。 |
