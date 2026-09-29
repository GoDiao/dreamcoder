[English](./05-streaming-recovery.en.md) | 简体中文

# 流式响应与故障恢复

模型还在输出，界面已经显示了文字；模型提出 `tool_use` 后，本地工具可能在整轮响应结束前就开始运行，甚至已经改写了文件。这时如果用户取消或连接中断，执行循环要弄清几件事：界面已经显示了什么，哪些工具真的执行过，模型接下来会收到什么，重新请求模型会不会让同一个修改再做一次。

本篇先用五步说明流式工具执行的最小结构，再对应到 DreamCoder 的 `queryLoop()` 和 `StreamingToolExecutor`，然后沿一个带时间点的失败案例，分别看用户取消和流式请求回退为非流式请求时发生什么。阅读前需要读过[第一篇](./01-execution-loop.zh.md)的执行循环。

## 最小的流式工具执行

第一篇的执行循环等模型响应完整返回后才执行工具。流式工具执行把第 3 步提前到模型流进行期间，一轮内部变成五步：

1. 模型流逐块到达，文字增量立即交给界面。
2. 一个 `tool_use` 块结束，就把它加入工具队列。
3. 队列按并发规则启动工具：可并发的调用可以同时运行，不可并发的调用单独运行，并保持先后顺序。
4. 每收到一条新的流消息，取出已经完成的工具结果，交给界面，同时收集起来准备交给模型。
5. 模型流结束后，等待剩余工具完成，把全部结果交给下一次模型请求。

写成伪代码大致如下。**这段是为说明结构写的简化代码，不是 DreamCoder 源码**：

```ts
async function* streamTurn(stream, queue) {
  const results = []
  for await (const event of stream) {
    yield event                                     // 第 1 步：界面先显示
    if (event.type === 'tool_use_done') {
      queue.add(event.toolUse)                      // 第 2、3 步：入队，条件允许就启动
    }
    for (const result of queue.takeCompleted()) {   // 第 4 步：交出已完成结果
      yield result
      results.push(result)
    }
  }
  for await (const result of queue.waitRemaining()) { // 第 5 步：等待剩余工具
    yield result
    results.push(result)
  }
  return results                                    // 交给下一次模型请求
}
```

从第 2 步开始，工具已经可能产生副作用，而模型响应还没有结束。后面讨论的取消和回退问题都来自这一点：失败可以发生在任意两步之间，发生时有些工具已经执行完，有些正在执行，有些还在排队。

## 对应到 DreamCoder 源码

[`queryLoop()`](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/query.ts#L660) 调用 `deps.callModel()`，生产依赖把它接到 [`queryModelWithStreaming()`](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/query/deps.ts#L35)。启用流式工具执行时，`tool_use` 进入 [`StreamingToolExecutor`](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/services/tools/StreamingToolExecutor.ts#L40)；否则等模型响应结束，由 [`runTools()`](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/services/tools/toolOrchestration.ts#L19) 执行。是否启用由 [`queryLoop()`](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/query.ts#L562) 中的 `config.gates.streamingToolExecution` 决定。

一轮中会出现四类内容：`stream_event` 是给界面显示的底层增量；`assistant` 消息中的 `tool_use` 是程序据此运行工具的调用请求；`progress` 消息是工具执行中的进度，只给界面用；用户消息中的 `tool_result` 是最终结果，进入下一轮模型上下文。

### 第 1、2 步：模型流怎样变成消息

`queryModelWithStreaming()` 把每个底层事件都作为 `stream_event` 产出；一个内容块结束（`content_block_stop`）时，再产出一条只含这个块的 `assistant` 消息。所以每个 `tool_use` 块一结束就能交给执行器，不必等整条响应。[`content_block_stop`](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/services/api/claude.ts#L2236)

`queryLoop()` 先把允许展示的消息 `yield` 给上层，再收集 `assistant` 消息中的 `tool_use`，交给执行器：

```ts
for (const toolBlock of msgToolUseBlocks) {
  streamingToolExecutor.addTool(toolBlock, message)
}
for (const result of streamingToolExecutor.getCompletedResults()) {
  if (result.message) {
    yield result.message
    toolResults.push(
      ...normalizeMessagesForAPI([result.message], toolUseContext.options.tools)
        .filter(_ => _.type === 'user'),
    )
  }
}
```

节选来自 [`queryLoop()`](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/query.ts#L838)，省略了中断条件。`yield` 使界面看到消息，`toolResults.push()` 收集模型下一轮应看到的用户消息；进度消息可以被 `yield`，但不会进入 `toolResults`。

### 第 3 步：工具队列怎样启动工具

[`StreamingToolExecutor.addTool()`](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/services/tools/StreamingToolExecutor.ts#L76) 按名称查找工具、解析输入，再调用该工具的 `isConcurrencySafe()`，给每个请求记录 `queued`、`executing`、`completed`、`yielded` 四种状态。能否启动由 [`canExecuteTool()`](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/services/tools/StreamingToolExecutor.ts#L129) 判断：

```ts
private canExecuteTool(isConcurrencySafe: boolean): boolean {
  const executingTools = this.tools.filter(t => t.status === 'executing')
  return (
    executingTools.length === 0 ||
    (isConcurrencySafe && executingTools.every(t => t.isConcurrencySafe))
  )
}
```

当前没有工具在执行，新的调用可以启动；已有工具在执行时，新调用和所有执行中的调用都必须声明可并发。[`processQueue()`](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/services/tools/StreamingToolExecutor.ts#L140) 遇到暂不能启动的不可并发调用时停止扫描，后面的调用不会越过它；每个工具结束时会再调用一次 `processQueue()`。并发声明的规则见[第二篇](./02-code-tools.zh.md#并发由输入决定)。

### 第 4、5 步：结果何时交给界面和模型

[`getCompletedResults()`](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/services/tools/StreamingToolExecutor.ts#L412) 先产出进度，再按接收顺序产出已完成结果；遇到尚在执行且不可并发的工具，后续结果暂不交付。模型流结束后，`queryLoop()` 用 `getRemainingResults()` 等待未完成工具。[`queryLoop()`](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/query.ts#L1381)

与伪代码相比，实际代码有两处不同：

- 已完成结果只在处理下一条流消息时取出。工具在两条流消息之间完成，结果要等下一条消息到达才交给界面。
- 取消信号已经触发时，`addTool()` 和 `getCompletedResults()` 这两段都会跳过（条件 `!toolUseContext.abortController.signal.aborted`），新的工具块不再入队。

## 一次失败的时间线

沿用系列的例子：用户要求把 `/example/src/app.ts` 中的 `export const value = 1` 改成 `export const value = 2`。

- 流式工具执行已开启，当前权限设置允许这次 `Edit`。
- 模型在一次响应里依次输出一段文字、`Read`（`toolu_read_1`）、`Edit`（`toolu_edit_2`），然后开始输出第三个调用 `Bash`（`npm test`）。这里假设模型已从用户消息得知要替换的原文。
- `Read` 声明可并发；`Edit` 不可并发。

| 时点 | 事件 | 界面已显示 | 已执行的工具与副作用 | 准备交给模型的结果 |
| --- | --- | --- | --- | --- |
| t0 | 模型开始输出文字 | 文字增量 | 无 | 无 |
| t1 | `Read` 块结束，立即启动 | `Read` 调用 | `Read` 运行中，只读 | 无 |
| t2 | `Edit` 块结束；`Read` 仍在执行，`Edit` 保持 `queued` | `Edit` 调用 | 仍只有 `Read` | 无 |
| t3 | `Read` 完成，`Edit` 启动 | `Read` 的结果 | `Read` 已完成；`Edit` 运行中 | `toolu_read_1` 的结果 |
| t4 | `Edit` 写入文件 | `Edit` 的结果 | 文件内容已是 `value = 2` | 加入 `toolu_edit_2` 的结果 |
| t5 | `Bash` 块的参数还在输出 | `Bash` 的参数增量 | 同 t4；`Bash` 块没有结束，没有入队 | 同 t4 |

下面两种情况都发生在 t5。

### 情况 A：t5 用户取消

用户在终端按 ESC，或者 print 模式收到 `interrupt` 控制请求。[`REPL.tsx`](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/screens/REPL.tsx#L2151)、[`print.ts`](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/cli/print.ts#L2836)

1. 模型流停止。对用户取消，外层处理不生成错误消息，`queryLoop()` 的 `for await` 随之结束。[`claude.ts`](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/services/api/claude.ts#L2499)
2. `queryLoop()` 检查到信号已中止，消费 `getRemainingResults()`：`Read` 的结果已交付，跳过；`Edit` 已在 t4 完成，结果若尚未交付，此时交出真实结果；`Bash` 块没有形成 `tool_use`，不需要配对结果。
3. 以 `aborted_streaming` 结束，本轮不再请求模型。已产出的消息作为历史，留给下一次用户输入。[`queryLoop()`](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/query.ts#L1012)、[`QueryEngine.ts`](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/QueryEngine.ts#L782)

**收到取消信号时，哪些副作用可能已经发生？** 信号到达之前已经开始的工具都可能已经产生副作用。本例中 `Read` 没有副作用，`Edit` 已经写入文件，取消不会撤销这次写入。取消信号只能阻止两类操作：一是尚未开始的工具，排队中的工具启动时发现已取消，直接得到合成的错误结果；二是会主动检查信号的操作。[`executeTool()`](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/services/tools/StreamingToolExecutor.ts#L278)、[`runToolUse()`](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/services/tools/toolExecution.ts#L415) 已经进入 `call()` 的工具是否停下，取决于工具自己是否检查信号；`FileEditTool.call()` 在写入前没有检查取消信号，写入会照常完成。[`FileEditTool.call()`](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/tools/FileEditTool/FileEditTool.ts#L425)

### 情况 B：t5 流中断，改用非流式请求

t5 时连接中断，流读取抛出普通错误。没有禁用回退时，处理如下：

1. `claude.ts` 调用 `onStreamingFallback()`，再用同一组消息发起非流式请求。[`claude.ts`](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/services/api/claude.ts#L2574) `queryLoop()` 传入的回调只把 `streamingFallbackOccured` 设为 `true`。[`queryLoop()`](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/query.ts#L679)
2. 等待非流式响应期间，旧执行器照常运行。如果 t5 时 `Edit` 还在排队，`Read` 一结束它仍会启动。
3. 回退后 `queryLoop()` 收到第一条消息时，为旧的助手消息产出 tombstone（撤回标记），清空 `assistantMessages`、`toolResults`、`toolUseBlocks`，对旧执行器调用 `discard()`，再新建一个执行器。[`queryLoop()`](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/query.ts#L713)
4. 非流式响应是一条包含全部内容块的助手消息，模型可能再次提出 `Read`、`Edit` 和 `Bash`，这些调用带有新的 ID（示意为 `toolu_read_3`、`toolu_edit_4`）。[`claude.ts`](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/services/api/claude.ts#L2636)
5. 新执行器执行这些调用。`Read` 读到 `value = 2`；`Edit` 的输入校验找不到 `export const value = 1`，返回错误，文件没有被写第二次。[`FileEditTool`](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/tools/FileEditTool/FileEditTool.ts#L316) `Bash` 照常运行测试。

**为什么重发模型请求可能重复产生文件修改？** 非流式请求与失败的流式请求使用同一组消息，其中没有旧流里的 `tool_use` 和工具结果，模型不知道 `Read` 和 `Edit` 已经执行过，很可能再次提出同样的调用。`discard()` 只设置一个标记：之后排队的工具不再启动，旧执行器的结果不再交付；已经发生的写入不会撤销。[`discard()`](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/services/tools/StreamingToolExecutor.ts#L69) 本例的 `Edit` 因为前提不再成立而失败；没有这类前提检查的操作，例如 `Bash` 中向文件追加内容或执行 `git commit`，第二次执行会再产生一次效果。

`claude.ts` 的源码注释也指出了这一点。设置 `CLAUDE_CODE_DISABLE_NONSTREAMING_FALLBACK`，或开启 `tengu_disable_streaming_to_non_streaming_fallback` 开关，可以跳过这种回退。[`claude.ts`](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/services/api/claude.ts#L2529)

| 项目 | 情况 A：用户取消 | 情况 B：改用非流式请求 |
| --- | --- | --- |
| 已发生的副作用 | `Edit` 已写入，不撤销 | `Edit` 已写入，不撤销；新响应的调用会再执行 |
| 本轮交给模型的结果 | 不再请求模型；结果作为历史留给下一次输入 | 只有新执行器产生的结果 |
| 需要注意 | 模型下一轮要确认文件状态，只能再读一次 | 没有前提检查的操作会重复产生效果 |

## 设计分析

以下是对这段实现效果的分析。

### 为什么在模型流结束前就启动工具

本例中 `Read` 在 t1 就开始执行，不用等整条响应结束；一次响应包含多个工具调用或较长的输出时，工具执行与模型输出在时间上重叠，结果也能更早显示在界面上。代价是工具在响应确定之前就产生了副作用。流中断后的非流式回退会重新请求模型，新响应中的同一调用会再执行一次，`discard()` 无法撤销已经发生的效果。禁用回退可以避免重复执行，这时流错误不再触发非流式请求，由外层错误处理转成错误消息。[`claude.ts`](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/services/api/claude.ts#L2566)

### 为什么被取消的工具也要有结果

每个 `tool_use` 都要有带原 ID 的 `tool_result`（见[第一篇](./01-execution-loop.zh.md#从-tool_use-到-tool_result)）。执行器为被取消的工具生成错误结果，`queryLoop()` 在没有执行器或模型调用出错时用 `yieldMissingToolResultBlocks()` 补齐，消息链因此保持完整，模型也能知道哪次调用没有正常结束。代价是补齐的结果只修复消息结构，不撤销副作用，也不一定反映磁盘上的实际状态，下一节有一个例子。

## 当前版本的实现限制

> 本节列出源码基线 `dba5b24` 中与上面机制有关的具体问题，均来自静态阅读源码，没有实际运行验证。首次阅读可以跳过。

**合成的拒绝结果可能与文件状态不一致。** 在情况 A 的基础上，假设取消提前到 t3 与 t4 之间，这时 `Edit` 已经进入 `call()`：写入照常完成；执行器在工具产出下一项时检查取消状态，发现已取消后丢弃真实结果，换成合成的拒绝结果。[`executeTool()`](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/services/tools/StreamingToolExecutor.ts#L335) 这个结果基于 `REJECT_MESSAGE`，其中写明文件编辑的 `new_string` 没有写入文件。[`REJECT_MESSAGE`](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/utils/messages.ts#L212) 此时磁盘上的文件已经是 `value = 2`，模型读到的结果与文件实际状态不一致。

**桌面路径不处理 tombstone。** 情况 B 中产出的 tombstone 由消费者决定怎样处理：终端 REPL 收到后，从界面和 transcript 中删除对应的助手消息，见 [`REPL.tsx`](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/screens/REPL.tsx#L2647)；桌面使用的 `QueryEngine` 对这类消息不做处理，见 [`QueryEngine.ts`](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/QueryEngine.ts#L779)。被撤回的旧助手消息在桌面路径中怎样影响后续请求，本篇没有继续追踪。

**已交付的旧工具结果。** tombstone 只针对 `assistantMessages` 中的消息，情况 B 中 t3、t4 已经交出的工具结果消息不在其中。这些消息在后续请求中怎样处理，本篇没有继续追踪。

## 其他失败分支

> 首次阅读可以先跳过本节，需要排查具体失败时再回来看。

**取消原因。** 执行器按固定顺序判断工具为什么被取消：先看是否已被 `discard()`（`streaming_fallback`），再看是否有 Bash 兄弟工具出错（`sibling_error`），最后看取消信号（`user_interrupted`）。[`getAbortReason()`](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/services/tools/StreamingToolExecutor.ts#L210) 以 `'interrupt'` 为原因的取消发生在执行期间有新输入要插入时，只取消 `interruptBehavior()` 返回 `cancel` 的工具；工具未声明该行为时默认是 `block`。合成结果由 [`createSyntheticErrorMessage()`](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/services/tools/StreamingToolExecutor.ts#L153) 生成。

**兄弟工具取消。** Bash 工具产生错误结果时，执行器会中止并行中的兄弟工具，排在后面的工具启动时直接得到 `sibling_error` 结果；`Read` 等其他工具失败不会触发这条规则。例如 `Bash(mkdir …)` 之后跟着 `Edit`，`mkdir` 失败后 `Edit` 不会执行。兄弟取消使用执行器自己的子 `AbortController`，不会中止上层的取消信号。[`executeTool()`](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/services/tools/StreamingToolExecutor.ts#L354)、[`siblingAbortController`](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/services/tools/StreamingToolExecutor.ts#L45)

**工具阶段的取消。** 工具结果处理完成后返回 `aborted_tools`，不再进入下一轮模型请求。[`queryLoop()`](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/query.ts#L1485)

**重试与回退。** 模型请求层和执行循环都有恢复分支，触发条件不同：

| 触发情况 | 处理位置 | 实际行为与边界 |
| --- | --- | --- |
| 可重试的 API 错误 | [`withRetry()`](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/services/api/withRetry.ts#L170) | 按错误类型、请求来源和预算决定是否等待再试；预算耗尽仍返回错误。 |
| 触发 `FallbackTriggeredError` 且有 `fallbackModel` | [`queryLoop()`](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/query.ts#L895) | 为已输出的工具请求补齐错误结果，切换模型并重发请求。 |
| 流式请求失败且允许改用非流式 | [`claude.ts`](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/services/api/claude.ts#L2529)、[`queryLoop()`](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/query.ts#L713) | 即情况 B。 |
| 上下文超过限制 | [`queryLoop()`](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/query.ts#L1066) | 相关功能启用时尝试 context collapse 或 reactive compact，再重发请求。 |
| 响应达到输出 token 上限 | [`queryLoop()`](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/query.ts#L1190) | 按配置提高上限或有限次数续写；耗尽后输出错误。 |

**流空闲检测。** 设置 `CLAUDE_ENABLE_STREAM_WATCHDOG` 后，模型流在设定时间内没有新 chunk 就会被中止，随后进入相应的错误或回退路径；它只检测模型流，不给单个工具调用计时。[`claude.ts`](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/services/api/claude.ts#L1933)

**兜底异常。** 模型或运行时异常在 `tool_use` 已经输出后抛出时，`queryLoop()` 调用 `yieldMissingToolResultBlocks()` 为本轮工具请求生成错误结果，再报告实际错误，以 `model_error` 结束。[`queryLoop()`](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/query.ts#L956)

## 小结

- 流式工具执行在 `tool_use` 块结束时就启动工具，结果在处理下一条流消息时交给界面，同时收集进 `toolResults`。
- 取消信号只能阻止尚未开始的工具和会主动检查信号的操作，已经开始的写入照常完成，取消不会撤销副作用。
- 流式请求回退为非流式请求时，新响应中的同一调用会再执行一次；是否重复产生修改，取决于工具自身有没有前提检查。

流、队列和恢复分支都位于 CLI 内。下一篇[《模型接入与桌面端集成》](./06-desktop-integration.zh.md)沿 Provider 配置与桌面会话通道往外看：模型服务怎样选定，CLI 产生的这些消息又怎样到达桌面和手机。
