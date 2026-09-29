[English](./02-code-tools.en.md) | 简体中文

# 代码工具系统

模型响应里的 `tool_use` 只是一段数据：工具名称、一组 JSON 参数和一个调用 ID。要让它变成“读取 `/example/src/app.ts`”或“把 `value = 1` 改成 `value = 2`”，程序需要按名称找到本地实现，拒绝不合法的参数，在写文件前取得权限，执行后再把结果写成模型能读的 `tool_result`。一次响应包含多个调用时，程序还要决定哪些调用可以同时执行。

本篇先列出最小的工具执行步骤，再沿一次 `Read → Edit` 修改，把每一步对应到 DreamCoder 的 `runToolUse()` 和具体工具实现，然后看多个调用怎样分批执行。本篇从[第一篇](./01-execution-loop.zh.md)执行循环的第 3 步“执行工具”接着读。

## 最小的工具执行

去掉 Hook、流式执行和各工具的特殊分支，执行一个工具调用分六步：

1. 每个工具提供名称、说明和输入结构。它们作为工具定义随请求发给模型，模型据此提出 `tool_use`。
2. 按 `tool_use.name` 找到工具实现；找不到就返回错误结果。
3. 检查参数：先检查结构（字段是否齐全、类型是否正确），再检查与当前状态有关的条件（例如文件是否已经读过）。
4. 取得权限决定；未获允许就返回错误结果。
5. 执行工具。
6. 把工具返回的数据转换成 `tool_result`。

第 2 到第 6 步写成伪代码大致如下。**这段是为说明结构写的简化代码，不是 DreamCoder 源码**：

```ts
async function runTool(use, tools, context) {
  const tool = tools.find(t => t.name === use.name)               // 第 2 步
  if (!tool) return errorResult(use.id, `No such tool: ${use.name}`)
  const parsed = tool.inputSchema.safeParse(use.input)            // 第 3 步：结构
  if (!parsed.success) return errorResult(use.id, parsed.error)
  const check = await tool.validateInput(parsed.data, context)    // 第 3 步：状态
  if (!check.ok) return errorResult(use.id, check.message)
  if (!(await isAllowed(tool, parsed.data))) {                    // 第 4 步
    return errorResult(use.id, 'Permission denied')
  }
  const data = await tool.call(parsed.data, context)              // 第 5 步
  return tool.toToolResult(data, use.id)                          // 第 6 步
}
```

每个出口都用同一个 `use.id` 构造结果，模型据此知道是哪次调用成功或失败，这组对应关系见[第一篇](./01-execution-loop.zh.md#从-tool_use-到-tool_result)。

### 示例：把 `value` 改成 2

执行前，`/example/src/app.ts` 只有一行 `export const value = 1`。模型先请求读取这个文件：

```json
{
  "type": "tool_use",
  "id": "toolu_read_1",
  "name": "Read",
  "input": { "file_path": "/example/src/app.ts" }
}
```

`Read` 返回带行号的文本。默认格式是行号、制表符、正文，由 [`addLineNumbers()`](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/utils/file.ts#L290) 生成：

```json
{
  "type": "tool_result",
  "tool_use_id": "toolu_read_1",
  "content": "1\texport const value = 1"
}
```

模型在下一次响应里提出修改。`old_string` 是文件中的原文，不带行号前缀：

```json
{
  "type": "tool_use",
  "id": "toolu_edit_2",
  "name": "Edit",
  "input": {
    "file_path": "/example/src/app.ts",
    "old_string": "export const value = 1",
    "new_string": "export const value = 2"
  }
}
```

`Edit` 写入文件后返回 `The file /example/src/app.ts has been updated successfully.`，文件内容变为 `export const value = 2`。两次调用分属两次模型响应：模型先看到 `Read` 的结果，才能写出与文件一致的 `old_string`。

## 对应到 DreamCoder 源码

第一篇的 `queryLoop()` 在 [`src/query.ts`](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/query.ts#L1381) 把本轮的 `tool_use` 交给 `runTools()`；启用流式工具执行时交给 [`StreamingToolExecutor`](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/services/tools/StreamingToolExecutor.ts#L40)。两条路径最终都调用 [`runToolUse()`](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/services/tools/toolExecution.ts#L337)，本篇沿普通路径往下读。

| 代码位置 | 对应步骤 | 职责 |
| --- | --- | --- |
| [`src/Tool.ts`](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/Tool.ts#L362)、[`src/utils/api.ts`](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/utils/api.ts#L119) | 第 1、2 步 | 工具接口、按名称查找、`buildTool()` 默认行为，以及发给模型的工具定义。 |
| [`toolOrchestration.ts`](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/services/tools/toolOrchestration.ts#L19) | 多个调用 | 按并发安全性分批，将请求送入 `runToolUse()`。 |
| [`toolExecution.ts`](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/services/tools/toolExecution.ts#L337) | 第 2–6 步 | 查找工具，校验输入，处理 Hook 和权限，调用工具并组织结果。 |
| [`FileReadTool.ts`](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/tools/FileReadTool/FileReadTool.ts#L337)、[`FileEditTool.ts`](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/tools/FileEditTool/FileEditTool.ts#L86) | 第 3、5、6 步 | 读文件和修改文件的校验、执行与结果映射。 |

### 第 1、2 步：工具定义与查找

DreamCoder 的 [`Tool` 类型](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/Tool.ts#L362)规定了 `name`、`prompt()`、`inputSchema`、`validateInput()`、`checkPermissions()`、`call()` 和 `mapToolResultToToolResultBlockParam()` 等成员。发给模型的定义由 [`toolToAPISchema()`](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/utils/api.ts#L169) 组装：`description` 取 `tool.prompt()` 返回的说明文字，`input_schema` 由 zod 写成的 `inputSchema` 转换为 JSON Schema。本篇的四个工具都通过 `buildTool()` 创建，未声明的方法取默认值：`isConcurrencySafe()` 和 `isReadOnly()` 返回 `false`，`checkPermissions()` 返回 `allow`。[`TOOL_DEFAULTS`](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/Tool.ts#L757)

[`runToolUse()`](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/services/tools/toolExecution.ts#L345) 在本轮发给模型的工具中查找，[`findToolByName()`](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/Tool.ts#L358) 同时匹配主名称和 `aliases`。找不到时再到全部内置工具中查找，但只接受通过已弃用别名匹配到的工具；两次都找不到，就构造内容为 `No such tool available: <名称>` 的错误结果，不进入后续步骤。[未知工具分支](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/services/tools/toolExecution.ts#L368)

### 第 3 步：两层参数检查

模型生成的参数可能缺字段、类型不对，也可能结构正确却与文件的实际状态不符。前一类只看参数本身就能判断，后一类要读取文件或会话状态才能判断。[`checkPermissionsAndCallTool()`](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/services/tools/toolExecution.ts#L599) 因此先后做两次检查：

```ts
const parsedInput = tool.inputSchema.safeParse(input)
if (!parsedInput.success) {
  // 返回带 tool_use_id 的 InputValidationError
}
const isValidCall = await tool.validateInput?.(
  parsedInput.data,
  toolUseContext,
)
if (isValidCall?.result === false) {
  // 返回工具给出的具体错误
}
```

两个失败分支都在权限和 `call()` 之前返回。示例中的两次调用在这一步检查的内容不同：

- [`Read.validateInput()`](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/tools/FileReadTool/FileReadTool.ts#L418) 检查页码格式、路径和文件类型等条件。
- `Edit` 的[输入结构](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/tools/FileEditTool/types.ts#L5)要求 `file_path`、`old_string` 和 `new_string`。它的 [`validateInput()`](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/tools/FileEditTool/FileEditTool.ts#L137) 利用 `Read` 留下的 `readFileState`（工具上下文中按文件路径保存的读取记录）：目标文件需要先读过，修改时间不能表明文件已变化，`old_string` 要在文件中出现；有多个匹配而 `replace_all` 为 `false` 时也返回错误。[读取状态与匹配检查](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/tools/FileEditTool/FileEditTool.ts#L275)

如果模型跳过 `Read`，直接提出 `toolu_edit_2`，得到的结果是：

```json
{
  "type": "tool_result",
  "tool_use_id": "toolu_edit_2",
  "content": "<tool_use_error>File has not been read yet. Read it first before writing to it.</tool_use_error>",
  "is_error": true
}
```

`old_string` 带上了行号前缀（例如 `1\texport const value = 1`）时，文件中找不到这段文本，也会在这一步返回错误。

### 第 4 步：权限决定

参数通过检查后，执行层运行 `PreToolUse` Hook，再由 [`resolveHookPermissionDecision()`](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/services/tools/toolExecution.ts#L921) 合并 Hook 结果与常规权限决定，得到 `allow`、`deny` 或 `ask`。工具自己的 `checkPermissions()` 只在 `validateInput()` 通过后调用，`Edit` 把判断交给 `checkWritePermissionForTool()`。[`Tool.checkPermissions()`](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/Tool.ts#L495)、[`Edit.checkPermissions()`](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/tools/FileEditTool/FileEditTool.ts#L125) 只有 `allow` 会到达 `tool.call()`，规则、模式和桌面确认流程见[第三篇](./03-permissions.zh.md)。

### 第 5 步：执行工具

[`Read.call()`](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/tools/FileReadTool/FileReadTool.ts#L496) 读取文件后更新 `readFileState`；`Edit.call()` 写入成功后也更新同一条记录：

| 时点 | 文件内容 | `readFileState` 中的记录 |
| --- | --- | --- |
| `Read` 之前 | `export const value = 1` | 无记录；此时提出 `Edit` 会在第 3 步失败 |
| `Read` 之后 | `export const value = 1` | `content` 为读到的文本，`timestamp` 为文件修改时间，`offset` 为 1 |
| `Edit` 之后 | `export const value = 2` | `content` 为写入后的全文，`timestamp` 为写入后的修改时间，`offset` 和 `limit` 为空 |

对应源码见 [`Read` 的文本读取分支](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/tools/FileReadTool/FileReadTool.ts#L1032)和 [`Edit` 的状态更新](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/tools/FileEditTool/FileEditTool.ts#L520)。

#### `Edit.call()` 为什么重新检查文件

`Edit.validateInput()` 完成后，权限确认可能让执行暂停。文件在这段时间也可能被用户或其他程序修改。因此 [`Edit.call()`](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/tools/FileEditTool/FileEditTool.ts#L387) 写入前重新读取当前内容和修改时间。源码先检查上次读取状态，再计算补丁并写入：

```ts
const lastRead = readFileState.get(absoluteFilePath)
if (!lastRead || lastWriteTime > lastRead.timestamp) {
  // 对完整读取可再比较内容；确有变化则停止
}
const { patch, updatedFile } = getPatchForEdit({
  filePath: absoluteFilePath,
  fileContents: originalFileContents,
  oldString: actualOldString,
  newString: actualNewString,
  replaceAll: replace_all,
})
writeTextContent(absoluteFilePath, updatedFile, encoding, endings)
```

以上摘自 [`Edit.call()` 的检查与写入段](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/tools/FileEditTool/FileEditTool.ts#L442)。检查不通过时，`call()` 抛出 `File has been unexpectedly modified` 错误，[`runToolUse()` 的异常分支](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/services/tools/toolExecution.ts#L1589)把它写成 `is_error: true` 的 `tool_result`。检查与写入之间没有 `await`，同一进程中的其他异步任务不会插在两者之间执行；需要等待的建目录和文件历史备份都放在检查之前。

### 第 6 步：转换结果

`tool.call()` 返回内部 `ToolResult` 后，执行层调用工具的 [`mapToolResultToToolResultBlockParam()`](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/services/tools/toolExecution.ts#L1292)，得到发给模型的 `tool_result`。内部数据和模型收到的内容可以差别很大：

| 工具 | `call()` 返回的内部数据 | 模型收到的 `tool_result` 内容 |
| --- | --- | --- |
| `Read`（文本） | 文件路径、内容、起始行号、行数和总行数 | 加行号的文本；[`text` 分支](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/tools/FileReadTool/FileReadTool.ts#L692)还可能在前后附加提示文本 |
| `Edit` | 文件路径、原文件内容、`structuredPatch` 补丁、`userModified` 等 | “文件已更新”的文字说明；用户在确认时改过修改内容，说明中会注明。[成功分支](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/tools/FileEditTool/FileEditTool.ts#L589) |

## 四种代码操作

搜索和命令执行也走同样的六步，下表供查阅。

| 工具 | 主要输入 | 用途 |
| --- | --- | --- |
| [`Read`](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/tools/FileReadTool/FileReadTool.ts#L227) | `file_path`，可选 `offset`、`limit`、`pages` | 读取文本、图片、PDF 等文件 |
| [`Grep`](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/tools/GrepTool/GrepTool.ts#L160) | `pattern`，可选 `path`、`glob`、`output_mode` | 用 ripgrep 搜索，返回匹配文件、匹配行或计数 |
| [`Edit`](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/tools/FileEditTool/types.ts#L5) | `file_path`、`old_string`、`new_string`，可选 `replace_all` | 按原文替换文件内容 |
| [`Bash`](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/tools/BashTool/BashTool.tsx#L420) | `command`，可选 `timeout`、后台执行开关 | 执行命令，返回输出；路径检查见第三篇 |

## 并发由输入决定

一次响应可能同时要求读取多个文件。逐个执行会让读取互相等待；而写文件的调用与其他调用同时执行时，谁先完成会影响读到的内容。所以 DreamCoder 只让可并发的调用同时执行，并按每次调用的输入判断能否并发。

[`partitionToolCalls()`](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/services/tools/toolOrchestration.ts#L91) 先解析每个请求的输入，再调用工具的 `isConcurrencySafe(parsedInput)`。找不到工具、输入解析失败或该方法抛错，都按不可并发处理。连续的可并发调用组成一批，批内同时执行，上限由 `CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY` 设置，默认 10；不可并发的调用单独成批。[并发上限](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/services/tools/toolOrchestration.ts#L8)

| 工具 | `isConcurrencySafe()` |
| --- | --- |
| [`Read`](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/tools/FileReadTool/FileReadTool.ts#L373)、[`Grep`](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/tools/GrepTool/GrepTool.ts#L183) | 始终返回 `true`。 |
| [`Edit`](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/tools/FileEditTool/FileEditTool.ts#L86) | 取 `buildTool()` 的默认值 `false`。 |
| [`Bash`](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/tools/BashTool/BashTool.tsx#L434) | 交给 `isReadOnly(input)`：只读命令可能进入并发批次，其他命令不会。 |

这个判断只用于安排执行顺序，每次执行仍走输入校验和权限流程。

例如同一次响应里依次有 `Read A`、`Grep B`、`Edit C`、`Read D`，会分为 `[Read A, Grep B] → [Edit C] → [Read D]`。批次之间保持顺序；并发批次中的结果可在执行期间陆续产出，工具产生的上下文修改则在批次结束后按原调用顺序应用。[`runTools()`](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/services/tools/toolOrchestration.ts#L26)、[上下文修改的应用](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/services/tools/toolOrchestration.ts#L54)

## 设计分析

以下是对这段实现效果的分析。

### 为什么参数检查分成结构、状态和权限三层

`inputSchema` 只看参数本身，不访问文件；`validateInput()` 由各工具按自己的状态检查；权限逻辑只处理已通过校验的输入。三层各自产生不同的错误内容，模型可以区分“参数写错了”“文件状态不对”和“没有得到允许”。代价是 `validateInput()` 与 `call()` 之间隔着权限决定，前者检查过的状态到执行时可能已经过期，`Edit` 因此要在 `call()` 里再检查一次。三层的边界也不完全分开：[`Edit.validateInput()`](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/tools/FileEditTool/FileEditTool.ts#L160) 自己也检查编辑的拒绝规则。

### 为什么只合并相邻的可并发调用

分批按原顺序扫描，遇到不可并发的调用就切开。这样模型写下的先后顺序在写操作前后得到保留：`Read A → Edit A → Read A` 中，后一次 `Read` 一定在 `Edit` 完成之后执行，读到的是修改后的内容；如果把两次 `Read` 合成一批提前执行，第二次读取就可能拿到旧内容。代价是并行度受限，被写操作隔开的只读调用不会合并，即使它们读的是互不相关的文件，`Read A → Edit C → Read D` 中的 `Read A` 和 `Read D` 也要分两批执行。

## 伪代码之外的分支

> 首次阅读可以先跳过本节，读完第三篇再回来看。

**同一响应里的 `Read` 和 `Edit`。** 模型在同一响应里依次请求 `Read` 和 `Edit` 时，`runTools()` 按分批顺序先完成 `Read` 再执行 `Edit`；但模型提出 `Edit` 时还没有看到这次读取的内容，参数可能不符合文件实际状态。

**重复读取。** 对同一文本范围再次读取时，若文件修改时间未变，`Read` 返回 `file_unchanged`，结果映射函数把它转成简短提示，不再放入全文。图片、PDF 等类型不参与这项检查。[重复读取检查](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/tools/FileReadTool/FileReadTool.ts#L540)、[结果映射](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/tools/FileReadTool/FileReadTool.ts#L686)

**结果大小与 Hook 顺序。** 结果按工具的 `maxResultSizeChars` 处理过大的内容：`Grep` 为 20,000 字符，`Read` 为 `Infinity`，由自己的 token 上限控制。[`GrepTool`](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/tools/GrepTool/GrepTool.ts#L164)、[`FileReadTool`](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/tools/FileReadTool/FileReadTool.ts#L342) 内置工具的结果在 `PostToolUse` Hook 之前组装；MCP 工具的结果在 Hook 运行之后才组装，Hook 可以先修改输出。[结果与 Hook 的顺序](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/services/tools/toolExecution.ts#L1476)

**流式工具执行。** `StreamingToolExecutor` 用同样的方式调用 `isConcurrencySafe()`，但按自己的队列安排执行，不经过 `partitionToolCalls()`，见[第五篇](./05-streaming-recovery.zh.md)。[`StreamingToolExecutor`](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/services/tools/StreamingToolExecutor.ts#L104)

## 小结

- 一次工具调用经过六步：工具定义、按名称查找、两层参数检查、权限决定、执行、结果映射；每个失败出口都生成带原 ID 的错误 `tool_result`。
- `Edit` 依赖 `Read` 留下的 `readFileState`，并在写入前再检查一次，防止权限等待期间文件被改动。
- 多个调用按 `isConcurrencySafe(parsedInput)` 分批：相邻的可并发调用同时执行，写操作前后保持原顺序。

第 4 步中，`Edit` 的参数通过校验后还要得到 `allow` 才能写文件。下一篇[《工具权限控制与执行边界》](./03-permissions.zh.md)沿 `toolu_edit_2` 继续，追踪权限决定从 CLI 到桌面、再返回执行层的过程。
