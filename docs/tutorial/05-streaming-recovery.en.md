English | [简体中文](./05-streaming-recovery.zh.md)

# Streaming responses and failure recovery

The model is still producing output, and the UI already shows text. After the model emits a `tool_use`, a local tool may start running before the whole response has finished, and may even have already modified a file. If the user cancels or the connection drops at this point, the execution loop has to work out several things: what the UI has already shown, which tools actually ran, what the model will receive next, and whether requesting the model again will make the same change a second time.

This chapter starts with five steps that show the minimal structure of streaming tool execution and maps them to DreamCoder's `queryLoop()` and `StreamingToolExecutor`. It then walks through a failure case point by point in time to see what happens when the user cancels and when a streaming request falls back to a non-streaming request. You need to have read the execution loop in [Part 1](./01-execution-loop.en.md) first.

## Minimal streaming tool execution

The execution loop in Part 1 runs tools only after the full model response has returned. Streaming tool execution moves step 3 earlier, into the time while the model stream is still arriving, so one turn internally becomes five steps:

1. The model stream arrives chunk by chunk, and text deltas are passed to the UI immediately.
2. As soon as a `tool_use` block ends, it is added to the tool queue.
3. The queue starts tools according to concurrency rules: concurrency-safe calls can run at the same time, and calls that are not concurrency-safe run alone and keep their order.
4. Each time a new stream message arrives, the results of tools that have already completed are taken out and passed to the UI, and also collected for the model.
5. After the model stream ends, wait for the remaining tools to complete, and pass all results to the next model request.

In pseudocode it looks roughly like this. **This is simplified code written to explain the structure. It is not DreamCoder source code.**

```ts
async function* streamTurn(stream, queue) {
  const results = []
  for await (const event of stream) {
    yield event                                     // Step 1: the UI shows it first
    if (event.type === 'tool_use_done') {
      queue.add(event.toolUse)                      // Steps 2 and 3: enqueue, start when allowed
    }
    for (const result of queue.takeCompleted()) {   // Step 4: hand over completed results
      yield result
      results.push(result)
    }
  }
  for await (const result of queue.waitRemaining()) { // Step 5: wait for remaining tools
    yield result
    results.push(result)
  }
  return results                                    // passed to the next model request
}
```

From step 2 onward, tools may produce side effects before the model response has ended. The cancellation and fallback problems discussed later all come from this: a failure can occur between any two steps, and when it does, some tools have already finished, some are running, and some are still queued.

## Mapping to the DreamCoder source

[`queryLoop()`](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/query.ts#L660) calls `deps.callModel()`, and the production dependencies connect it to [`queryModelWithStreaming()`](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/query/deps.ts#L35). When streaming tool execution is enabled, `tool_use` goes into [`StreamingToolExecutor`](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/services/tools/StreamingToolExecutor.ts#L40); otherwise it waits until the model response ends and is then executed by [`runTools()`](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/services/tools/toolOrchestration.ts#L19). Whether it is enabled is decided by `config.gates.streamingToolExecution` in [`queryLoop()`](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/query.ts#L562).

Four kinds of content appear in one turn: `stream_event` is the low-level delta for the UI to display; a `tool_use` in an `assistant` message is the call request the program uses to run a tool; a `progress` message is progress during tool execution and is used only by the UI; a `tool_result` in a user message is the final result and enters the next turn's model context.

### Steps 1 and 2: how the model stream becomes messages

`queryModelWithStreaming()` yields each low-level event as a `stream_event`. When a content block ends (`content_block_stop`), it also yields an `assistant` message containing only that block. So each `tool_use` block can be handed to the executor as soon as it ends, without waiting for the whole response. [`content_block_stop`](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/services/api/claude.ts#L2236)

`queryLoop()` first `yield`s the messages that are allowed to be displayed to the upper layer, then collects the `tool_use` blocks in `assistant` messages and hands them to the executor:

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

The excerpt is from [`queryLoop()`](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/query.ts#L838), with the abort conditions omitted. `yield` lets the UI see the message, and `toolResults.push()` collects the user messages the model should see in the next turn. Progress messages can be `yield`ed, but they do not enter `toolResults`.

### Step 3: how the tool queue starts tools

[`StreamingToolExecutor.addTool()`](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/services/tools/StreamingToolExecutor.ts#L76) looks up the tool by name, parses the input, then calls the tool's `isConcurrencySafe()`, and tracks four states for each request: `queued`, `executing`, `completed` and `yielded`. Whether a tool can start is decided by [`canExecuteTool()`](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/services/tools/StreamingToolExecutor.ts#L129):

```ts
private canExecuteTool(isConcurrencySafe: boolean): boolean {
  const executingTools = this.tools.filter(t => t.status === 'executing')
  return (
    executingTools.length === 0 ||
    (isConcurrencySafe && executingTools.every(t => t.isConcurrencySafe))
  )
}
```

When no tool is currently executing, a new call can start. When tools are already executing, the new call and all executing calls must be declared concurrency-safe. [`processQueue()`](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/services/tools/StreamingToolExecutor.ts#L140) stops scanning when it reaches a non-concurrency-safe call that cannot start yet, so later calls do not skip ahead of it. `processQueue()` is called again each time a tool finishes. The rules for declaring concurrency are in [Part 2](./02-code-tools.en.md#concurrency-is-decided-by-input).

### Steps 4 and 5: when results are handed to the UI and the model

[`getCompletedResults()`](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/services/tools/StreamingToolExecutor.ts#L412) first yields progress, then yields completed results in the order they were received. When it reaches a tool that is still executing and is not concurrency-safe, later results are held back. After the model stream ends, `queryLoop()` uses `getRemainingResults()` to wait for unfinished tools. [`queryLoop()`](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/query.ts#L1381)

Compared with the pseudocode, the actual code differs in two places:

- Completed results are taken out only while processing the next stream message. If a tool completes between two stream messages, its result is handed to the UI only when the next message arrives.
- Once the abort signal has fired, both the `addTool()` and the `getCompletedResults()` sections are skipped (condition `!toolUseContext.abortController.signal.aborted`), and new tool blocks are no longer enqueued.

## A failure timeline

The example is the one used throughout the series: the user asks to change `export const value = 1` to `export const value = 2` in `/example/src/app.ts`.

- Streaming tool execution is enabled, and the current permission settings allow this `Edit`.
- In one response the model outputs, in order, a piece of text, `Read` (`toolu_read_1`) and `Edit` (`toolu_edit_2`), and then starts outputting a third call, `Bash` (`npm test`). The example assumes the model already knows the original text to replace from the user message.
- `Read` is declared concurrency-safe; `Edit` is not.

| Time | Event | Shown in the UI | Tools executed and side effects | Results prepared for the model |
| --- | --- | --- | --- | --- |
| t0 | The model starts outputting text | Text deltas | None | None |
| t1 | The `Read` block ends and starts immediately | The `Read` call | `Read` running, read-only | None |
| t2 | The `Edit` block ends; `Read` is still executing, `Edit` stays `queued` | The `Edit` call | Still only `Read` | None |
| t3 | `Read` completes, `Edit` starts | The `Read` result | `Read` completed; `Edit` running | The `toolu_read_1` result |
| t4 | `Edit` writes the file | The `Edit` result | File content is now `value = 2` | Adds the `toolu_edit_2` result |
| t5 | The `Bash` block's arguments are still being output | `Bash` argument deltas | Same as t4; the `Bash` block has not ended and is not enqueued | Same as t4 |

Both of the following cases occur at t5.

### Case A: the user cancels at t5

The user presses ESC in the terminal, or print mode receives an `interrupt` control request. [`REPL.tsx`](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/screens/REPL.tsx#L2151), [`print.ts`](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/cli/print.ts#L2836)

1. The model stream stops. For a user cancellation, the outer handling does not generate an error message, and the `for await` in `queryLoop()` ends as a result. [`claude.ts`](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/services/api/claude.ts#L2499)
2. `queryLoop()` sees that the signal has been aborted and consumes `getRemainingResults()`: the `Read` result has already been delivered and is skipped; `Edit` completed at t4, and if its result has not yet been delivered, the real result is yielded now; the `Bash` block did not form a `tool_use`, so no paired result is needed.
3. The turn ends with `aborted_streaming`, and the model is not requested again in this turn. The messages already produced remain as history for the next user input. [`queryLoop()`](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/query.ts#L1012), [`QueryEngine.ts`](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/QueryEngine.ts#L782)

**When the abort signal is received, which side effects may already have happened?** Any tool that started before the signal arrived may already have produced side effects. In this example, `Read` has no side effects, `Edit` has already written the file, and cancellation does not undo that write. The abort signal can prevent only two kinds of operations. The first is tools that have not started yet: a queued tool that finds the abort when it starts gets a synthetic error result directly. The second is operations that actively check the signal. [`executeTool()`](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/services/tools/StreamingToolExecutor.ts#L278), [`runToolUse()`](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/services/tools/toolExecution.ts#L415) Whether a tool that has already entered `call()` stops depends on whether the tool itself checks the signal. `FileEditTool.call()` does not check the abort signal before writing, so the write completes as usual. [`FileEditTool.call()`](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/tools/FileEditTool/FileEditTool.ts#L425)

### Case B: the stream breaks at t5 and falls back to a non-streaming request

At t5 the connection drops, and reading the stream throws an ordinary error. When fallback is not disabled, the handling is as follows:

1. `claude.ts` calls `onStreamingFallback()`, then issues a non-streaming request with the same set of messages. [`claude.ts`](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/services/api/claude.ts#L2574) The callback passed in by `queryLoop()` only sets `streamingFallbackOccured` to `true`. [`queryLoop()`](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/query.ts#L679)
2. While waiting for the non-streaming response, the old executor keeps running as usual. If `Edit` was still queued at t5, it still starts as soon as `Read` finishes.
3. When `queryLoop()` receives the first message after the fallback, it yields a tombstone (retraction marker) for the old assistant messages, clears `assistantMessages`, `toolResults` and `toolUseBlocks`, calls `discard()` on the old executor, and creates a new executor. [`queryLoop()`](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/query.ts#L713)
4. The non-streaming response is one assistant message containing all content blocks. The model may propose `Read`, `Edit` and `Bash` again, and these calls have new IDs (illustrated as `toolu_read_3`, `toolu_edit_4`). [`claude.ts`](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/services/api/claude.ts#L2636)
5. The new executor runs these calls. `Read` reads `value = 2`; `Edit`'s input validation cannot find `export const value = 1` and returns an error, so the file is not written a second time. [`FileEditTool`](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/tools/FileEditTool/FileEditTool.ts#L316) `Bash` runs the tests as usual.

**Why can resending the model request produce a file change twice?** The non-streaming request uses the same set of messages as the failed streaming request, and that set contains neither the `tool_use` blocks nor the tool results from the old stream. The model does not know that `Read` and `Edit` have already run, and is likely to propose the same calls again. `discard()` only sets a flag: tools queued after that no longer start, and the old executor's results are no longer delivered; writes that have already happened are not undone. [`discard()`](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/services/tools/StreamingToolExecutor.ts#L69) In this example `Edit` fails because its precondition no longer holds. Operations without such a precondition check, for example appending to a file in `Bash` or running `git commit`, produce their effect again when executed a second time.

A source comment in `claude.ts` also points this out. Setting `CLAUDE_CODE_DISABLE_NONSTREAMING_FALLBACK`, or turning on the `tengu_disable_streaming_to_non_streaming_fallback` flag, skips this fallback. [`claude.ts`](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/services/api/claude.ts#L2529)

| Item | Case A: user cancels | Case B: fall back to a non-streaming request |
| --- | --- | --- |
| Side effects already produced | `Edit` has written the file, not undone | `Edit` has written the file, not undone; calls in the new response run again |
| Results handed to the model in this turn | The model is not requested again; results remain as history for the next input | Only the results produced by the new executor |
| What to watch for | To confirm the file state, the model has to read it again in the next turn | Operations without a precondition check produce their effect again |

## Design analysis

The following is an analysis of what this implementation does.

### Why tools start before the model stream ends

In this example `Read` starts executing at t1 without waiting for the whole response to end. When one response contains several tool calls or long output, tool execution overlaps in time with model output, and results can also appear in the UI earlier. The downside is that tools produce side effects before the response is final. After a stream break, the non-streaming fallback requests the model again, the same call in the new response runs a second time, and `discard()` cannot undo effects that have already happened. Disabling fallback avoids the repeated execution. A stream error then no longer triggers a non-streaming request, and the outer error handling turns it into an error message. [`claude.ts`](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/services/api/claude.ts#L2566)

### Why cancelled tools also need results

Every `tool_use` needs a `tool_result` with the original ID (see [Part 1](./01-execution-loop.en.md#from-tool_use-to-tool_result)). The executor generates error results for cancelled tools, and when there is no executor or the model call fails, `queryLoop()` fills in the missing ones with `yieldMissingToolResultBlocks()`. This keeps the message chain complete and lets the model know which calls did not finish normally. The downside is that the filled-in results only repair the message structure. They do not undo side effects and do not necessarily reflect the actual state on disk; the next section has an example.

## Limitations of the current version

> This section lists specific issues in the source baseline `dba5b24` related to the mechanisms above. All of them come from static reading of the source and have not been verified by running the code. You can skip this section on a first read.

**A synthetic rejection result may be inconsistent with the file state.** Starting from Case A, suppose the cancellation comes earlier, between t3 and t4, when `Edit` has already entered `call()`. The write completes as usual. The executor checks the abort state when the tool yields its next item, and on finding it aborted, it discards the real result and replaces it with a synthetic rejection result. [`executeTool()`](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/services/tools/StreamingToolExecutor.ts#L335) This result is based on `REJECT_MESSAGE`, which states that the file edit's `new_string` was not written to the file. [`REJECT_MESSAGE`](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/utils/messages.ts#L212) At this point the file on disk is already `value = 2`, so the result the model reads is inconsistent with the actual state of the file.

**The desktop path does not handle tombstones.** The consumer of the tombstone produced in Case B decides how to handle it. When the terminal REPL receives one, it removes the corresponding assistant message from the UI and the transcript; see [`REPL.tsx`](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/screens/REPL.tsx#L2647). The `QueryEngine` used by the desktop app does nothing with these messages; see [`QueryEngine.ts`](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/QueryEngine.ts#L779). This chapter does not trace further how the retracted old assistant messages affect later requests on the desktop path.

**Old tool results already delivered.** The tombstone targets only messages in `assistantMessages`. The tool result messages already yielded at t3 and t4 in Case B are not among them. This chapter does not trace further how these messages are handled in later requests.

## Other failure branches

> You can skip this section on a first read and come back to it when you need to investigate a specific failure.

**Abort reasons.** The executor determines why a tool was cancelled in a fixed order: first whether it has been `discard()`ed (`streaming_fallback`), then whether a sibling Bash tool errored (`sibling_error`), and finally the abort signal (`user_interrupted`). [`getAbortReason()`](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/services/tools/StreamingToolExecutor.ts#L210) An abort with the reason `'interrupt'` happens when new input needs to be inserted during execution, and it cancels only tools whose `interruptBehavior()` returns `cancel`. When a tool does not declare this behavior, the default is `block`. Synthetic results are generated by [`createSyntheticErrorMessage()`](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/services/tools/StreamingToolExecutor.ts#L153).

**Sibling tool cancellation.** When a Bash tool produces an error result, the executor aborts the sibling tools running in parallel, and tools queued after it get a `sibling_error` result directly when they start. Failures of other tools such as `Read` do not trigger this rule. For example, if `Bash(mkdir …)` is followed by `Edit`, `Edit` does not run after `mkdir` fails. Sibling cancellation uses the executor's own child `AbortController` and does not abort the upper-level abort signal. [`executeTool()`](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/services/tools/StreamingToolExecutor.ts#L354), [`siblingAbortController`](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/services/tools/StreamingToolExecutor.ts#L45)

**Cancellation during the tool phase.** After tool results are processed, the loop returns `aborted_tools` and does not proceed to the next model request. [`queryLoop()`](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/query.ts#L1485)

**Retry and fallback.** Both the model request layer and the execution loop have recovery branches, with different trigger conditions:

| Trigger | Handled in | Actual behavior and limits |
| --- | --- | --- |
| Retryable API error | [`withRetry()`](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/services/api/withRetry.ts#L170) | Decides whether to wait and retry based on error type, request source and budget; still returns an error when the budget is exhausted. |
| `FallbackTriggeredError` raised and a `fallbackModel` is set | [`queryLoop()`](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/query.ts#L895) | Fills in error results for tool requests already output, switches the model and resends the request. |
| Streaming request fails and falling back to non-streaming is allowed | [`claude.ts`](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/services/api/claude.ts#L2529), [`queryLoop()`](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/query.ts#L713) | This is Case B. |
| Context exceeds the limit | [`queryLoop()`](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/query.ts#L1066) | When the relevant features are enabled, tries context collapse or reactive compact, then resends the request. |
| Response reaches the output token limit | [`queryLoop()`](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/query.ts#L1190) | Raises the limit according to configuration or continues the output a limited number of times; outputs an error when exhausted. |

**Stream idle detection.** When `CLAUDE_ENABLE_STREAM_WATCHDOG` is set, the model stream is aborted if no new chunk arrives within the configured time, and the request then goes down the corresponding error or fallback path. It only monitors the model stream and does not time individual tool calls. [`claude.ts`](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/services/api/claude.ts#L1933)

**Catch-all exceptions.** When a model or runtime exception is thrown after a `tool_use` has already been output, `queryLoop()` calls `yieldMissingToolResultBlocks()` to generate error results for this turn's tool requests, then reports the actual error and ends with `model_error`. [`queryLoop()`](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/query.ts#L956)

## Summary

- Streaming tool execution starts a tool as soon as its `tool_use` block ends. Results are handed to the UI while the next stream message is processed, and are collected into `toolResults` at the same time.
- The abort signal can only prevent tools that have not started and operations that actively check the signal. Writes that have already started complete as usual, and cancellation does not undo side effects.
- When a streaming request falls back to a non-streaming request, the same call in the new response runs again. Whether the change is made twice depends on whether the tool itself has a precondition check.

The stream, the queue and the recovery branches all live inside the CLI. The next chapter, [Model access and desktop integration](./06-desktop-integration.en.md), looks outward along the provider configuration and the desktop session channel: how the model service is chosen, and how these messages produced by the CLI reach the desktop app and the phone.
