<div align="right">

[English](./ISSUE_120_IMPLEMENTATION_REPORT_en.md) | 简体中文

</div>

# Issue #120 实现报告

> 允许每个 Provider 配置任意数量的模型，并可选设置一个快速模型

- Issue：[GoDiao/dreamcoder#120](https://github.com/GoDiao/dreamcoder/issues/120)
- 开发状态：本地实现完成
- 人工验证状态：仅本地 Ollama 验证通过
- 真实 API 验证：OpenAI/OpenAI 兼容云 API 待验证；Anthropic API 待验证
- 验证平台：Windows x64
- 报告日期：2026 年 10 月 22 日

## 1. 概述

Issue #120 移除了 DreamCoder 应用层对“每个 Provider 最多四个模型”的限制。Provider 现在保存有序的 `{ id, name? }` 模型列表，并且可以选择其中一个模型作为 `fastModel`。Claude 内部仍然需要 `main`、`haiku`、`sonnet`、`opus` 等角色变量，但 DreamCoder 会根据会话所选模型和 Provider 快速模型自动填充，用户不再需要理解或手工配置这些角色。

本次改动覆盖 Provider schema、持久化迁移、预设、服务端模型发现、桌面模型编辑、跨 Provider 会话模型选择器、运行时环境变量映射、标题生成、定时任务、上下文窗口索引、测试和 fixture。

## 2. 对照 Issue #120 逐条说明实现

下表将 Issue #120 中的每项要求逐条对应到实现内容和当前验证状态。

| # | Issue 要求 | 实现内容 | 验证状态 |
| ---: | --- | --- | --- |
| 1 | 一个 Provider 可以包含任意数量的模型。 | 在 `src/server/types/provider.ts` 和桌面对应类型中，用有序 `ProviderModel[]` 取代四个角色字段。 | 自动化测试通过；本地 Ollama 使用三个模型人工验证通过。 |
| 2 | 同一个 Provider 内的模型 ID 必须唯一。 | `ProviderModelsSchema` 对重复 ID 产生校验错误；创建和更新服务使用归一化后的列表。 | schema/service 测试通过；Ollama 配置中人工检查了重复 ID 行为。 |
| 3 | 增加服务端“获取模型”功能。 | 新增未保存配置使用的 `POST /api/providers/models`，以及已保存 Provider 使用的 `POST /api/providers/:id/models`；均调用 `src/server/upstream/client.ts` 中的 `fetchUpstreamModels`。 | mock 集成测试通过；本地 Ollama `/v1/models` 人工验证通过。 |
| 4 | OpenAI 兼容与 Anthropic 格式都要由服务端鉴权，避免把 Key 暴露给浏览器或受 CORS 限制。 | 模型发现运行在 sidecar；OpenAI 兼容请求使用 Bearer，Anthropic 请求使用配置的 Anthropic 鉴权策略和 `anthropic-version`。 | 单元/mock 集成覆盖通过；真实远程 OpenAI 和 Anthropic API 尚未人工验证。 |
| 5 | 发现结果只是候选项，不能自动持久化。 | 桌面 store 将发现结果保存在临时表单状态中；只有用户明确保存 Provider 时才写入选择后的模型列表。 | 组件/store 测试通过；本地 Ollama 的取消后重开流程通过。 |
| 6 | 可以从发现结果中选择，也可以手工输入 ID，然后点击“添加”。 | `ProviderFormModal.tsx` 使用带发现建议的可编辑输入框；发现不可用时仍保留手工输入。 | 组件测试通过；Ollama 发现流程通过；手工回退由测试覆盖。 |
| 7 | 已添加模型可以删除和排序。 | 模型编辑器提供删除、上移、下移；列表第一项标记为默认模型。 | 组件测试通过；本地 Ollama 人工验证通过。 |
| 8 | 模型可配置可选显示名称，并支持建议、编辑、ID 回退和显示真实 ID。 | 每项保存 `{ id, name? }`；发现时读取 `display_name` 或 `name` 作为建议；设置页显示可编辑名称和不可变 ID；选择器无名称时显示 ID。 | 解析与 UI 测试通过；Ollama 显示名称人工编辑并持久化成功。 |
| 9 | 同一 Provider 内显示名称重复时只警告，不报错。 | 表单检测重复的非空名称并显示警告；是否合法仍由唯一 ID 决定。 | 组件测试通过；Ollama Provider 表单人工检查通过。 |
| 10 | Provider 可以从自身模型中选择一个可选快速模型。 | 新增 `fastModel?: string`；服务校验其必须引用当前 Provider 模型；删除该模型时自动清除。 | runtime/service/component 测试通过；本地 Ollama 使用 `qwen3.5:4b` 作为快速模型验证通过。 |
| 11 | 会话模型选择器列出所有 Provider 的所有模型，显示名称但传递 ID。 | `ModelSelector.tsx` 展开所有 Provider 模型，显示名称及 ID 上下文，并在运行时选择中保存 Provider ID 和模型 ID。 | 选择器测试通过；本地 Ollama 会话切换通过；跨 Provider 行为由测试覆盖。 |
| 12 | 所选模型填充主模型、Sonnet 和 Opus 角色。 | `buildProviderManagedEnv` 将所选模型映射到 `ANTHROPIC_MODEL`、`ANTHROPIC_DEFAULT_SONNET_MODEL`、`ANTHROPIC_DEFAULT_OPUS_MODEL`。 | runtime 和 conversation 集成测试通过；Ollama 所选模型请求通过。 |
| 13 | 快速模型填充 Haiku 和 Small Fast；未配置时回退到所选模型。 | 同一运行时构建器将 `fastModel ?? selectedModel` 映射到 `ANTHROPIC_DEFAULT_HAIKU_MODEL` 和 `ANTHROPIC_SMALL_FAST_MODEL`。 | 已覆盖配置和回退场景；本地 Ollama 快速模型流程通过。 |
| 14 | 显示名称绝不能发送给上游。 | runtime 配置、proxy 请求、会话覆盖和定时任务始终使用 `model.id`；`name` 仅是 UI 元数据。 | 单元/集成测试通过；Ollama `/status` 和本地请求使用真实 ID。 |
| 15 | 会话标题使用快速模型；未配置时使用所选模型。 | `titleService.ts` 优先解析 Provider 快速模型，否则使用所选/第一个模型；WebSocket handler 传入当前运行时模型。 | 标题测试通过；本地 Ollama 标题流程人工通过；远程 Provider 待验证。 |
| 16 | 定时任务使用任务所选模型，未选时使用 Provider 第一个模型，并采用相同快速模型规则。 | `cronScheduler.ts` 将任务模型传给 Provider runtime；Provider 默认模型为列表第一项。 | scheduler launcher 测试通过；尚未单独进行远程 Provider 人工运行。 |
| 17 | 旧四角色 Provider 必须无损迁移。 | schema version 2 按 `main`、`sonnet`、`opus`、`haiku` 顺序转换，删除空值和重复项；与 `main` 不同的旧 `haiku` 成为快速模型。 | 包括重复输入的迁移测试通过；本次人工验证使用新建 Ollama Provider，未单独执行真实旧用户配置迁移。 |
| 18 | 预设改用新列表结构。 | `providerPresets.json` 改用 `defaultModels: { id, name? }[]` 和可选 `defaultFastModel`。 | 预设测试通过。 |
| 19 | 所有旧 `models.main`/`haiku`/`sonnet`/`opus` 读取点迁移到列表和快速模型。 | 更新了服务端服务、桌面 store/组件、测试和并行 Provider E2E fixture；只有迁移测试刻意保留旧对象作为输入。 | 已完成源码扫描；受影响定向测试通过。 |
| 20 | `modelContextWindows` 继续按模型 ID 索引。 | Provider 表单上下文输入和 runtime 查找使用每个条目的 `id`，不使用显示名称。 | 组件/runtime 测试通过；本地元数据确认三个 Ollama 测试模型的上下文长度均为 262144。 |
| 21 | 从 `/models` 自动获取上下文窗口不属于本 Issue。 | 没有增加上下文长度推断；继续使用手工值和现有内置回退。 | 按要求留给 Issue #105。 |

## 3. Schema 设计说明

### 3.1 Provider 模型

```ts
const ProviderModelSchema = z.object({
  id: z.string().trim().min(1),
  name: z.string().trim().min(1).optional(),
})
```

- `id` 是准确的上游模型标识，必填并自动 trim；它会被持久化、传给 CLI 并发送到上游。
- `name` 是可选的 UI 元数据，不参与路由，也不会发送给上游。
- 空显示名称会被归一化掉，此时 UI 回退显示模型 ID。

### 3.2 有序模型列表

```ts
const ProviderModelsSchema = z.array(ProviderModelSchema).superRefine(...唯一 ID...)
```

- 数组顺序具有业务含义。
- 第一项是 Provider 默认模型。
- 已保存和新建的 Provider 至少需要一个模型。
- 同一 Provider 内 ID 必须唯一；不同 Provider 可以包含相同 ID。

### 3.3 快速模型

```ts
fastModel?: string
```

- 值是模型 ID，不是显示名称，也不是嵌套模型对象。
- service 校验它必须匹配同一 Provider 中的某个模型。
- 更新请求中的 `null` 表示明确清除。
- 未配置时，快速/后台工作使用当前所选模型。

### 3.4 上下文窗口映射

```ts
modelContextWindows?: Record<string, number>
```

Key 继续使用上游模型 ID。因此修改显示名称不会使上下文窗口配置失联。

### 3.5 模型发现请求与响应

未保存 Provider 的发现请求结构：

```ts
{
  baseUrl: string
  apiKey: string
  authStrategy?: ProviderAuthStrategy
  apiFormat: 'anthropic' | 'openai_chat' | 'openai_responses'
}
```

服务端返回临时 `ProviderModel[]` 候选项。已保存 Provider 可以通过 ID 发起发现，不需要把已保存 API Key 返回 UI。

### 3.6 存储版本与迁移

Provider 存储升级为 schema version 2。例如旧结构：

```json
{
  "main": "model-a",
  "sonnet": "model-b",
  "opus": "model-a",
  "haiku": "model-fast"
}
```

迁移后变为：

```json
{
  "models": [
    { "id": "model-a" },
    { "id": "model-b" },
    { "id": "model-fast" }
  ],
  "fastModel": "model-fast"
}
```

迁移保留首次出现顺序，并通过现有持久化升级机制生成迁移前备份。

## 4. 运行时映射

| 用途 | 模型来源 | 环境变量 |
| --- | --- | --- |
| 会话/任务主工作 | 所选模型；未选时为 Provider 第一个模型 | `ANTHROPIC_MODEL`、`ANTHROPIC_DEFAULT_SONNET_MODEL`、`ANTHROPIC_DEFAULT_OPUS_MODEL` |
| 快速/后台工作 | Provider 快速模型；未配置时为所选模型 | `ANTHROPIC_DEFAULT_HAIKU_MODEL`、`ANTHROPIC_SMALL_FAST_MODEL` |

明确使用该映射的应用行为包括会话启动/重启、标题生成和定时任务启动。Claude CLI 的 Explore 等轻量内部工作也可以读取 Haiku/Small Fast 环境变量。

## 5. 主要实现位置

- `src/server/types/provider.ts`：Provider 模型与发现 schema
- `src/server/config/providerPresets.ts` 和 `.json`：列表结构预设
- `src/server/services/persistentStorageMigrations.ts`：schema version 2 迁移
- `src/server/services/providerRuntimeEnv.ts`：所选/快速模型角色映射
- `src/server/services/providerService.ts`：归一化、引用校验和发现编排
- `src/server/upstream/client.ts`：带鉴权的 `/v1/models` 获取与解析
- `src/server/api/providers.ts`：模型发现 API
- `src/server/api/models.ts`：全部 Provider 模型信息
- `src/server/services/titleService.ts`：快速模型标题生成
- `src/server/services/cronScheduler.ts`：定时任务模型选择
- `src/server/services/conversationService.ts` 和 `src/server/ws/handler.ts`：会话级运行时模型
- `desktop/src/components/settings/ProviderFormModal.tsx`：模型列表编辑器
- `desktop/src/components/controls/ModelSelector.tsx`：跨 Provider 模型选择器
- `desktop/src/stores/providerStore.ts` 和 `desktop/src/api/providers.ts`：发现状态/API
- `desktop/scripts/e2e-parallel-providers-agent-browser.sh`：schema version 2 fixture

## 6. 验证记录

### 6.1 自动化验证

| 检查项 | 结果 |
| --- | --- |
| PR 分支桌面端 TypeScript 检查 | 通过 |
| PR 分支桌面端定向测试 | 139 个通过、4 个跳过、0 个失败 |
| PR 分支服务端定向测试 | Provider、runtime、迁移、预设、标题、调度器、settings、upstream、proxy 共 170 个通过、3 个跳过、0 个失败 |
| 所选模型 conversation 环境变量测试 | 1/1 通过 |
| 之前在已安装源码工作区运行的 WebSocket conversation 集成测试 | 63/63 通过 |
| PR 分支 Vite 生产构建 | 通过，共转换 4419 个模块 |
| 已安装源码工作区 Windows sidecar 编译 | 通过，共打包 3947 个模块 |
| 更新后的 E2E Provider fixture JavaScript 语法 | 通过 |

当前环境下，完整桌面 Vitest 套件不能作为全绿门禁，因为 MCP、session、chat、workspace、terminal 等无关测试广泛出现模块 mock 失效。完整 WebSocket 文件还要求其 mock CLI 子进程能从全局 `PATH` 找到 Bun，而临时 PR worktree 使用的 Bun runner 对这些子进程不可见。Issue #120 的组件/store/服务端定向测试可以独立通过。不能把这些环境限制描述为“全仓测试全部通过”。

### 6.2 已成功的人工验证：仅本地 Ollama

测试人员已确认 Issue #120 的人工流程在本地 Ollama 部署上成功。

| 项目 | 验证值 |
| --- | --- |
| 平台 | Windows x64 |
| Ollama 版本 | 0.34.2 |
| Base URL | `http://127.0.0.1:11434` |
| 模型发现接口 | `GET /v1/models` |
| 主/默认模型 | `qwen3.8:latest`（27.3B，Q4_K_M） |
| 其他模型 | `qwen3.5:9b`（9.7B，Q4_K_M） |
| 快速模型 | `qwen3.5:4b`（4.7B，Q4_K_M） |
| 模型报告上下文长度 | 三个模型均为 262144 |
| 结果 | Provider 配置、模型发现/列表编辑、本地模型选择、持久化和快速模型使用通过 |

Ollama 预设默认的 `qwen3.6:27b` 未安装，因此人工配置时将其删除。以上三个 ID 来自运行中的 Ollama `/v1/models` 接口。

Ollama 提供兼容接口，但本地 Ollama 验证**不能**视为真实 OpenAI/OpenAI 兼容云服务或真实 Anthropic API 的人工验证。

### 6.3 仍待人工验证

| Provider/API | 状态 | 后续要求 |
| --- | --- | --- |
| 真实 OpenAI 或 OpenAI 兼容云 API | 待验证 | 使用真实账号获取模型、添加/重命名/切换模型，确认上游请求 ID、标题模型和错误处理。 |
| 真实 Anthropic API | 待验证 | 使用 Anthropic 鉴权头获取模型、切换模型，确认所选/快速模型请求 ID、标题生成和错误处理。 |
| 现有用户配置的旧 Provider 迁移 | 待人工验证 | 自动迁移测试已经通过；如发布前要求，可对备份后的真实用户配置执行升级。 |

Mock 测试已覆盖 OpenAI 兼容和 Anthropic 的发现/鉴权路径，但 mock 不能替代真实远程 API 验收。

## 7. Pull Request 准备状态

建议 PR 标题：

```text
feat(providers): support arbitrary model lists and optional fast models
```

合并前建议 reviewer：

- 重点审查 schema version 2 迁移和备份行为。
- 确认所有上游路径使用模型 ID，而不是显示名称。
- 决定真实 OpenAI 和 Anthropic 人工验证是合并前要求，还是可以在合并后补充。
- 明确保持 Issue #105 的上下文窗口自动发现不在本 PR 范围内。
- 将全量 Vitest mock 环境问题与 Issue #120 定向结果分开记录。

本报告会随 Issue #120 功能分支一并提交，并作为 Pull Request 的配套记录。commit 与 PR 标识保留在 Git/GitHub 元数据中，不写死在报告正文里。
