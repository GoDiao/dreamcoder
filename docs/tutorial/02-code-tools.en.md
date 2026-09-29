English | [简体中文](./02-code-tools.zh.md)

# The code tool system

A `tool_use` in a model response is only data: a tool name, a set of JSON arguments and a call ID. To turn it into "read `/example/src/app.ts`" or "change `value = 1` to `value = 2`", the program has to find the local implementation by name, reject invalid arguments, obtain permission before writing a file, and after execution write the result as a `tool_result` the model can read. When one response contains several calls, the program also has to decide which calls can run at the same time.

This chapter first lists the minimal steps of tool execution. It then follows one `Read → Edit` change and maps each step to DreamCoder's `runToolUse()` and the concrete tool implementations, and finally looks at how multiple calls are executed in batches. This chapter continues from step 3, "execute tools", of the execution loop in [Part 1](./01-execution-loop.en.md).

## Minimal tool execution

Without hooks, streaming execution and the special branches of each tool, executing one tool call takes six steps:

1. Each tool provides a name, a description and an input schema. These are sent to the model with the request as tool definitions, and the model proposes a `tool_use` based on them.
2. Find the tool implementation by `tool_use.name`. If none is found, return an error result.
3. Check the arguments: first the structure (whether all fields are present and the types are correct), then the conditions that depend on current state (for example, whether the file has already been read).
4. Obtain a permission decision. If not allowed, return an error result.
5. Execute the tool.
6. Convert the data returned by the tool into a `tool_result`.

Steps 2 to 6 look roughly like this in pseudocode. **This is simplified code written to explain the structure. It is not DreamCoder source code.**

```ts
async function runTool(use, tools, context) {
  const tool = tools.find(t => t.name === use.name)               // Step 2
  if (!tool) return errorResult(use.id, `No such tool: ${use.name}`)
  const parsed = tool.inputSchema.safeParse(use.input)            // Step 3: structure
  if (!parsed.success) return errorResult(use.id, parsed.error)
  const check = await tool.validateInput(parsed.data, context)    // Step 3: state
  if (!check.ok) return errorResult(use.id, check.message)
  if (!(await isAllowed(tool, parsed.data))) {                    // Step 4
    return errorResult(use.id, 'Permission denied')
  }
  const data = await tool.call(parsed.data, context)              // Step 5
  return tool.toToolResult(data, use.id)                          // Step 6
}
```

Every exit builds its result with the same `use.id`, so the model knows which call succeeded or failed. This correspondence is described in [Part 1](./01-execution-loop.en.md#from-tool_use-to-tool_result).

### Example: changing `value` to 2

Before execution, `/example/src/app.ts` contains a single line, `export const value = 1`. The model first asks to read this file:

```json
{
  "type": "tool_use",
  "id": "toolu_read_1",
  "name": "Read",
  "input": { "file_path": "/example/src/app.ts" }
}
```

`Read` returns text with line numbers. The default format is line number, tab, text, produced by [`addLineNumbers()`](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/utils/file.ts#L290):

```json
{
  "type": "tool_result",
  "tool_use_id": "toolu_read_1",
  "content": "1\texport const value = 1"
}
```

In its next response the model proposes the change. `old_string` is the original text in the file, without the line-number prefix:

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

After writing the file, `Edit` returns `The file /example/src/app.ts has been updated successfully.`, and the file content becomes `export const value = 2`. The two calls belong to two separate model responses: the model sees the result of `Read` first, and only then can it write an `old_string` that matches the file.

## Mapping to the DreamCoder source

The `queryLoop()` from Part 1 hands this turn's `tool_use` blocks to `runTools()` in [`src/query.ts`](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/query.ts#L1381). When streaming tool execution is enabled, it hands them to [`StreamingToolExecutor`](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/services/tools/StreamingToolExecutor.ts#L40) instead. Both paths end up calling [`runToolUse()`](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/services/tools/toolExecution.ts#L337). This chapter follows the regular path.

| Code location | Steps | Responsibility |
| --- | --- | --- |
| [`src/Tool.ts`](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/Tool.ts#L362), [`src/utils/api.ts`](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/utils/api.ts#L119) | Steps 1 and 2 | Tool interface, lookup by name, the default behavior of `buildTool()`, and the tool definitions sent to the model. |
| [`toolOrchestration.ts`](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/services/tools/toolOrchestration.ts#L19) | Multiple calls | Splits calls into batches by concurrency safety and passes requests to `runToolUse()`. |
| [`toolExecution.ts`](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/services/tools/toolExecution.ts#L337) | Steps 2 to 6 | Finds the tool, validates input, handles hooks and permissions, calls the tool and assembles the result. |
| [`FileReadTool.ts`](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/tools/FileReadTool/FileReadTool.ts#L337), [`FileEditTool.ts`](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/tools/FileEditTool/FileEditTool.ts#L86) | Steps 3, 5 and 6 | Validation, execution and result mapping for reading and editing files. |

### Steps 1 and 2: tool definition and lookup

DreamCoder's [`Tool` type](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/Tool.ts#L362) defines members such as `name`, `prompt()`, `inputSchema`, `validateInput()`, `checkPermissions()`, `call()` and `mapToolResultToToolResultBlockParam()`. The definition sent to the model is assembled by [`toolToAPISchema()`](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/utils/api.ts#L169): `description` takes the text returned by `tool.prompt()`, and `input_schema` is the zod `inputSchema` converted to JSON Schema. The four tools in this chapter are all created with `buildTool()`, and methods they do not declare take default values: `isConcurrencySafe()` and `isReadOnly()` return `false`, and `checkPermissions()` returns `allow`. [`TOOL_DEFAULTS`](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/Tool.ts#L757)

[`runToolUse()`](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/services/tools/toolExecution.ts#L345) searches the tools sent to the model in this turn. [`findToolByName()`](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/Tool.ts#L358) matches both the primary name and `aliases`. If nothing is found, it searches all built-in tools, but only accepts a tool matched through a deprecated alias. If both searches fail, it builds an error result with the content `No such tool available: <name>` and skips the remaining steps. [Unknown-tool branch](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/services/tools/toolExecution.ts#L368)

### Step 3: two layers of argument checks

Arguments generated by the model may be missing fields or have wrong types. They may also have a correct structure but not match the actual state of the file. The first kind can be detected from the arguments alone, while the second requires reading the file or session state. [`checkPermissionsAndCallTool()`](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/services/tools/toolExecution.ts#L599) therefore runs two checks in order:

```ts
const parsedInput = tool.inputSchema.safeParse(input)
if (!parsedInput.success) {
  // Return an InputValidationError carrying tool_use_id
}
const isValidCall = await tool.validateInput?.(
  parsedInput.data,
  toolUseContext,
)
if (isValidCall?.result === false) {
  // Return the specific error given by the tool
}
```

Both failure branches return before permissions and `call()`. The two calls in the example check different things at this step:

- [`Read.validateInput()`](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/tools/FileReadTool/FileReadTool.ts#L418) checks conditions such as page-number format, path and file type.
- The [input schema](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/tools/FileEditTool/types.ts#L5) of `Edit` requires `file_path`, `old_string` and `new_string`. Its [`validateInput()`](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/tools/FileEditTool/FileEditTool.ts#L137) uses the `readFileState` left by `Read` (read records stored by file path in the tool context): the target file must have been read, the modification time must not indicate that the file has changed, and `old_string` must appear in the file. It also returns an error when there are multiple matches and `replace_all` is `false`. [Read state and match checks](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/tools/FileEditTool/FileEditTool.ts#L275)

If the model skips `Read` and proposes `toolu_edit_2` directly, the result is:

```json
{
  "type": "tool_result",
  "tool_use_id": "toolu_edit_2",
  "content": "<tool_use_error>File has not been read yet. Read it first before writing to it.</tool_use_error>",
  "is_error": true
}
```

If `old_string` includes the line-number prefix (for example `1\texport const value = 1`), the text cannot be found in the file, and an error is also returned at this step.

### Step 4: permission decision

After the arguments pass the checks, the execution layer runs the `PreToolUse` hook, and [`resolveHookPermissionDecision()`](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/services/tools/toolExecution.ts#L921) combines the hook result with the regular permission decision to produce `allow`, `deny` or `ask`. The tool's own `checkPermissions()` is called only after `validateInput()` passes, and `Edit` delegates the decision to `checkWritePermissionForTool()`. [`Tool.checkPermissions()`](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/Tool.ts#L495), [`Edit.checkPermissions()`](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/tools/FileEditTool/FileEditTool.ts#L125) Only `allow` reaches `tool.call()`. Rules, modes and the desktop confirmation flow are covered in [Part 3](./03-permissions.en.md).

### Step 5: executing the tool

[`Read.call()`](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/tools/FileReadTool/FileReadTool.ts#L496) updates `readFileState` after reading the file. `Edit.call()` also updates the same record after a successful write:

| Point in time | File content | Record in `readFileState` |
| --- | --- | --- |
| Before `Read` | `export const value = 1` | No record. An `Edit` proposed now fails at step 3 |
| After `Read` | `export const value = 1` | `content` is the text that was read, `timestamp` is the file modification time, `offset` is 1 |
| After `Edit` | `export const value = 2` | `content` is the full text after the write, `timestamp` is the modification time after the write, `offset` and `limit` are empty |

The corresponding source code is the [text-reading branch of `Read`](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/tools/FileReadTool/FileReadTool.ts#L1032) and the [state update in `Edit`](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/tools/FileEditTool/FileEditTool.ts#L520).

#### Why `Edit.call()` checks the file again

After `Edit.validateInput()` completes, permission confirmation may pause execution. During that time the user or another program may also change the file. [`Edit.call()`](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/tools/FileEditTool/FileEditTool.ts#L387) therefore reads the current content and modification time again before writing. The source first checks the last read state, then computes the patch and writes:

```ts
const lastRead = readFileState.get(absoluteFilePath)
if (!lastRead || lastWriteTime > lastRead.timestamp) {
  // For a full read, the content can also be compared; stop if it has actually changed
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

This is excerpted from the [check-and-write section of `Edit.call()`](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/tools/FileEditTool/FileEditTool.ts#L442). If the check fails, `call()` throws a `File has been unexpectedly modified` error, and the [exception branch of `runToolUse()`](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/services/tools/toolExecution.ts#L1589) writes it as a `tool_result` with `is_error: true`. There is no `await` between the check and the write, so other asynchronous tasks in the same process cannot run between them. Directory creation and file-history backup, which need to wait, are both placed before the check.

### Step 6: converting the result

After `tool.call()` returns an internal `ToolResult`, the execution layer calls the tool's [`mapToolResultToToolResultBlockParam()`](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/services/tools/toolExecution.ts#L1292) to get the `tool_result` sent to the model. The internal data and what the model receives can differ a lot:

| Tool | Internal data returned by `call()` | `tool_result` content received by the model |
| --- | --- | --- |
| `Read` (text) | File path, content, starting line number, line count and total line count | Text with line numbers. The [`text` branch](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/tools/FileReadTool/FileReadTool.ts#L692) may also add notice text before or after it |
| `Edit` | File path, original file content, the `structuredPatch` patch, `userModified` and more | A text message saying the file was updated. If the user changed the edit during confirmation, the message says so. [Success branch](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/tools/FileEditTool/FileEditTool.ts#L589) |

## Four code operations

Search and command execution follow the same six steps. The table below is for reference.

| Tool | Main input | Purpose |
| --- | --- | --- |
| [`Read`](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/tools/FileReadTool/FileReadTool.ts#L227) | `file_path`, optional `offset`, `limit`, `pages` | Reads text, images, PDFs and other files |
| [`Grep`](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/tools/GrepTool/GrepTool.ts#L160) | `pattern`, optional `path`, `glob`, `output_mode` | Searches with ripgrep and returns matching files, matching lines or counts |
| [`Edit`](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/tools/FileEditTool/types.ts#L5) | `file_path`, `old_string`, `new_string`, optional `replace_all` | Replaces file content by matching the original text |
| [`Bash`](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/tools/BashTool/BashTool.tsx#L420) | `command`, optional `timeout`, background-execution flag | Runs a command and returns its output. Path checks are covered in Part 3 |

## Concurrency is decided by input

One response may ask to read several files at once. Running them one by one makes the reads wait for each other. When a call that writes a file runs at the same time as other calls, which one finishes first affects what is read. DreamCoder therefore lets only concurrency-safe calls run at the same time, and decides whether each call can run concurrently from that call's input.

[`partitionToolCalls()`](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/services/tools/toolOrchestration.ts#L91) first parses the input of each request, then calls the tool's `isConcurrencySafe(parsedInput)`. If the tool is not found, the input fails to parse or the method throws, the call is treated as not concurrency-safe. Consecutive concurrency-safe calls form one batch and run at the same time within the batch, up to a limit set by `CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY` (default 10). Each call that is not concurrency-safe forms its own batch. [Concurrency limit](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/services/tools/toolOrchestration.ts#L8)

| Tool | `isConcurrencySafe()` |
| --- | --- |
| [`Read`](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/tools/FileReadTool/FileReadTool.ts#L373), [`Grep`](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/tools/GrepTool/GrepTool.ts#L183) | Always returns `true`. |
| [`Edit`](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/tools/FileEditTool/FileEditTool.ts#L86) | Uses the `buildTool()` default, `false`. |
| [`Bash`](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/tools/BashTool/BashTool.tsx#L434) | Delegates to `isReadOnly(input)`: read-only commands may enter a concurrent batch, other commands do not. |

This decision is used only to schedule execution order. Every execution still goes through input validation and the permission flow.

For example, if one response contains `Read A`, `Grep B`, `Edit C`, `Read D` in that order, they are split into `[Read A, Grep B] → [Edit C] → [Read D]`. Order is kept between batches. Results within a concurrent batch can be produced one by one during execution, while context modifications produced by the tools are applied in the original call order after the batch ends. [`runTools()`](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/services/tools/toolOrchestration.ts#L26), [Applying context modifications](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/services/tools/toolOrchestration.ts#L54)

## Design analysis

The following is an analysis of what this implementation does.

### Why argument checks are split into structure, state and permission layers

`inputSchema` looks only at the arguments and does not access files. `validateInput()` is implemented by each tool to check its own state. Permission logic handles only input that has passed validation. Each layer produces different error content, so the model can tell apart "the arguments are wrong", "the file state is wrong" and "permission was not granted". The cost is that the permission decision sits between `validateInput()` and `call()`, so state checked by the former may be stale by the time of execution. This is why `Edit` checks again inside `call()`. The boundaries between the three layers are also not fully separate: [`Edit.validateInput()`](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/tools/FileEditTool/FileEditTool.ts#L160) checks deny rules for edits itself.

### Why only adjacent concurrency-safe calls are merged

Batching scans calls in their original order and splits whenever it meets a call that is not concurrency-safe. This keeps the order the model wrote around write operations. In `Read A → Edit A → Read A`, the second `Read` always runs after `Edit` completes and reads the modified content. If the two `Read` calls were merged into one batch and run early, the second read could get the old content. The cost is limited parallelism. Read-only calls separated by a write are not merged, even when they read unrelated files: in `Read A → Edit C → Read D`, `Read A` and `Read D` still run in two batches.

## Branches beyond the pseudocode

> You can skip this section on a first read and come back to it after reading Part 3.

**`Read` and `Edit` in the same response.** When the model requests `Read` and then `Edit` in the same response, `runTools()` completes `Read` before running `Edit`, following the batch order. However, when the model proposed `Edit`, it had not yet seen the content of this read, so the arguments may not match the actual state of the file.

**Repeated reads.** When the same text range is read again and the file modification time has not changed, `Read` returns `file_unchanged`, and the result-mapping function turns it into a short notice instead of including the full text again. Images, PDFs and similar types are not part of this check. [Repeated-read check](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/tools/FileReadTool/FileReadTool.ts#L540), [Result mapping](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/tools/FileReadTool/FileReadTool.ts#L686)

**Result size and hook order.** Oversized content in results is handled according to each tool's `maxResultSizeChars`: 20,000 characters for `Grep`, and `Infinity` for `Read`, which is controlled by its own token limit. [`GrepTool`](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/tools/GrepTool/GrepTool.ts#L164), [`FileReadTool`](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/tools/FileReadTool/FileReadTool.ts#L342) Results of built-in tools are assembled before the `PostToolUse` hook. Results of MCP tools are assembled only after the hook runs, so the hook can modify the output first. [Order of result and hook](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/services/tools/toolExecution.ts#L1476)

**Streaming tool execution.** `StreamingToolExecutor` calls `isConcurrencySafe()` in the same way, but schedules execution with its own queue and does not go through `partitionToolCalls()`. See [Part 5](./05-streaming-recovery.en.md). [`StreamingToolExecutor`](https://github.com/GoDiao/dreamcoder/blob/dba5b24c75be4e3c35cd42d082dc9a7f8b631087/src/services/tools/StreamingToolExecutor.ts#L104)

## Summary

- One tool call goes through six steps: tool definition, lookup by name, two layers of argument checks, permission decision, execution and result mapping. Every failure exit produces an error `tool_result` carrying the original ID.
- `Edit` depends on the `readFileState` left by `Read`, and checks again before writing, to guard against the file being changed while waiting for permission.
- Multiple calls are batched by `isConcurrencySafe(parsedInput)`: adjacent concurrency-safe calls run at the same time, and the original order is kept around write operations.

In step 4, after `Edit`'s arguments pass validation, it still needs `allow` before it can write the file. The next chapter, [Tool permission control and execution boundaries](./03-permissions.en.md), continues with `toolu_edit_2` and follows the permission decision from the CLI to the desktop app and back to the execution layer.
