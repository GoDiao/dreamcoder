[English](./07-provider-presets.en.md) | 简体中文

# 添加 Provider 预设

本指南介绍如何把一个服务商加入 DreamCoder 的内置 Provider 列表，并说明预设 JSON、设置表单和连接测试之间的关系。本指南不涉及新增 API 协议，也不改变 Provider 运行机制。

以下源码链接固定在 commit [`75d9b3b`](https://github.com/GoDiao/dreamcoder/tree/75d9b3bf7572c5feb7b44e4421a7dcb81bb7a21f)。后续修改前请先检查当前源码。

## 了解预设的数据结构

内置预设保存在 [`src/server/config/providerPresets.json`](https://github.com/GoDiao/dreamcoder/blob/75d9b3bf7572c5feb7b44e4421a7dcb81bb7a21f/src/server/config/providerPresets.json)。服务端通过 [`providerPresets.ts`](https://github.com/GoDiao/dreamcoder/blob/75d9b3bf7572c5feb7b44e4421a7dcb81bb7a21f/src/server/config/providerPresets.ts) 中的 Zod Schema 解析 JSON。模块加载时会校验每个预设；字段无效会导致预设列表无法加载。

每个条目描述服务商的端点和模型默认值：

| 字段 | 必填 | 含义 |
| --- | --- | --- |
| `id` | 是 | 稳定标识符，用于将已保存的 Provider 关联到预设。 |
| `name` | 是 | 设置表单中显示的名称。 |
| `baseUrl` | 是 | Provider API 端点。 |
| `apiFormat` | 是 | `anthropic`、`openai_chat` 或 `openai_responses` 之一。 |
| `defaultModels` | 是 | 初始模型 ID，可附带显示名称。ID 不能为空且必须唯一。 |
| `defaultFastModel` | 否 | 初始快速模型；应使用 `defaultModels` 中已有的 ID。 |
| `needsApiKey` | 是 | 保存或测试前，表单是否要求用户填写密钥。 |
| `websiteUrl` | 是 | 服务商网站。 |
| `apiKeyUrl` | 否 | 服务商管理 API 密钥的页面链接。 |
| `authStrategy` | 否 | API 密钥的发送方式。它与 `apiFormat` 分开设置，可选值见下文。 |
| `defaultEnv` | 否 | Provider 配置使用的非机密环境变量默认值。不要在此填写真实 API 密钥或其他秘密。 |
| `modelContextWindows` | 否 | 按模型 ID 记录的已知上下文窗口大小。值必须是 16,000 至 10,000,000 之间的整数。 |

[`src/server/types/provider.ts`](https://github.com/GoDiao/dreamcoder/blob/75d9b3bf7572c5feb7b44e4421a7dcb81bb7a21f/src/server/types/provider.ts) 定义了可用的 API 格式和认证方式。普通预设只能选择已有行为；新增格式或认证流程属于独立的运行时改动。

## 添加预设

编辑前，请从服务商官方文档确认基础 URL、API 格式、认证要求、模型 ID 和上下文窗口。只添加有可靠来源且稳定的默认值，不要根据产品宣传名称猜测模型 ID 或上下文大小。

将条目加入 `providerPresets.json`。以下缩略结构只展示必填字段；请用经过核实的服务商信息替换示例值：

```json
{
  "id": "example-provider",
  "name": "Example Provider",
  "baseUrl": "https://api.example.invalid/v1",
  "apiFormat": "openai_chat",
  "defaultModels": [{ "id": "example-model" }],
  "needsApiKey": true,
  "websiteUrl": "https://example.invalid",
  "apiKeyUrl": "https://example.invalid/api-keys",
  "authStrategy": "api_key"
}
```

上面的 `.invalid` 域名和模型 ID 都是占位符，不代表真实服务商配置。请把新条目插入到 `lmstudio` 之前。最后三个预设必须依次保持为 `lmstudio`、`ollama` 和 `custom`：预设测试会检查这一顺序，而且添加服务商时，表单会把最后一个预设作为后备预设。

如果服务商需要表单默认认证方式以外的行为，请明确设置 `authStrategy`。它决定密钥怎样发送，与 `apiFormat` 是两个独立的设置。对于 Anthropic 格式的请求，它决定请求头（[`upstream/client.ts`](https://github.com/GoDiao/dreamcoder/blob/75d9b3bf7572c5feb7b44e4421a7dcb81bb7a21f/src/server/upstream/client.ts)）以及传给 CLI 的环境变量（[`providerRuntimeEnv.ts`](https://github.com/GoDiao/dreamcoder/blob/75d9b3bf7572c5feb7b44e4421a7dcb81bb7a21f/src/server/services/providerRuntimeEnv.ts)）：

| 取值 | 密钥的发送方式 |
| --- | --- |
| `api_key` | 放在 `x-api-key` 请求头中（`ANTHROPIC_API_KEY`）。 |
| `auth_token` | 作为 `Authorization` 中的 Bearer 令牌（`ANTHROPIC_AUTH_TOKEN`），同时 `ANTHROPIC_API_KEY` 为空。 |
| `auth_token_empty_api_key` | 与 `auth_token` 相同。 |
| `dual_same_token` | 以上两处同时发送同一个密钥。 |
| `dual_dummy` | 两处都发送占位值 `dummy`，适用于不校验密钥的本地服务。 |

`openai_chat` 和 `openai_responses` 格式的请求始终以 Bearer 令牌发送密钥。

`defaultEnv` 只适用于非机密兼容性设置，不用于存放凭证。用户应在表单中输入自己的密钥。不要把真实密钥放入预设、示例、截图或测试夹具。

## 更新预设测试

在 [`src/server/__tests__/provider-presets.test.ts`](https://github.com/GoDiao/dreamcoder/blob/75d9b3bf7572c5feb7b44e4421a7dcb81bb7a21f/src/server/__tests__/provider-presets.test.ts) 中增加断言，按新增 ID 查找预设，并验证官方文档支持的 URL、API 格式、初始模型及新增的可选默认值。该测试文件已经覆盖 `GET /api/providers/presets` 返回配置列表，也会校验部分预设与服务商发布的信息一致。保留关于 `lmstudio`、`ollama` 和 `custom` 顺序的断言。

设置表单从同一个 `GET /api/providers/presets` 接口读取列表。选择预设时，表单会填入 URL、API 格式、认证方式、初始模型、快速模型和已知上下文窗口。相关界面逻辑位于 [`ProviderFormModal.tsx`](https://github.com/GoDiao/dreamcoder/blob/75d9b3bf7572c5feb7b44e4421a7dcb81bb7a21f/desktop/src/components/settings/ProviderFormModal.tsx)。普通预设不需要再添加一份独立 UI 注册表。

在仓库根目录运行服务端定向测试：

```bash
bun test ./src/server/__tests__/provider-presets.test.ts
```

如果改动影响服务商选择或认证方式，也应更新 `desktop/src/components/settings/ProviderFormModal.test.tsx` 中相关桌面测试，并在 `desktop` 目录运行：

```bash
bun run test -- --run src/components/settings/ProviderFormModal.test.tsx
```

## 在应用中测试连接

启动 DreamCoder，打开**设置**，选择**服务商**，然后点击**添加服务商**。选择新增预设；若需要密钥，请输入有效密钥，并确认表单中的第一个模型已在该账户中启用。保存之前点击**测试连接**。基础 URL 或第一个模型为空时，该按钮不可用；如果预设需要密钥而没有填写，点击后不会有任何反应，也不会显示提示。

表单会把当前尚未保存的 URL、API 格式、认证方式、密钥和第一个模型发送到 `POST /api/providers/test`。服务端校验请求后调用 `ProviderService`，向该模型发送简短的流式请求并读取响应。成功表示当前配置可以访问所选模型；它不代表列表中所有模型都可用，也不代表完整的编程智能体会话已经验证。如果该端点支持模型发现，**获取模型**是独立操作，可用于填充模型列表。

不要把真实 API 密钥粘贴到 issue 评论、拉取请求、截图或日志中。只在本机设置表单中使用个人密钥；如果密钥已泄露，请删除或轮换。

## 提交前检查

- 端点和模型默认值有服务商文档作为依据。
- 可选认证、环境变量和上下文窗口字段符合现有 Schema，并有依据。
- 预设测试覆盖新条目，同时保留必要的顺序断言。
- 服务端定向测试通过；若修改表单行为，相关桌面检查也通过。
- 本机连接测试成功；如果无法运行，应在 PR 中说明原因。
- 改动中没有凭证或其他秘密信息。
