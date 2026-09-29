English | [简体中文](./README.md)

# Coding Agent Implementation Guide

This series uses the DreamCoder source code to explain how a coding agent works: how a message such as "Change `value` to 2" becomes several model requests, file reads and file edits; how the program validates arguments, asks the user for confirmation and saves the session; and how it handles cancellation and failure. The articles are a guided reading of the source code, and you do not need to write a separate teaching program.

This is the English translation of a series first written in Chinese.

## Who this is for

- Developers who have used coding agents such as Claude Code and want to know how they work internally.
- Developers who plan to implement a coding agent and want a complete implementation to refer to.
- Contributors who want to take part in DreamCoder development and need to learn the code structure first.

## Prerequisites

You need basic TypeScript and `async/await`, and you should know what HTTP and WebSocket are generally used for. Concepts such as async generators, JSONL, Hooks and the Sidecar are explained where they first appear.

## What you can do after reading

- Explain how the execution loop turns one user message into several model requests and tool executions, and under what conditions the loop ends.
- Find the code entry points for tools, permissions, sessions, streaming execution and desktop integration in DreamCoder, and understand the constraints to keep in mind when changing that code.
- When implementing a coding agent yourself, know which problems need to be handled: matching tool results to tool calls, the permission check before execution, the difference between the session record and the request context, and the side effects of cancellation and retries.

## Two ways to read

- **Read the source only.** Read the chapters in the order listed. Source links in the text point to a pinned version; open them to compare.
- **Run the project alongside.** Follow [Getting Started](../../README_en.md#-getting-started) in the root README to run DreamCoder from source, have it change a small file in the desktop app, then compare what you see with the section "What the desktop UI shows" in the [overview](./00-overview.en.md). The code you run may be newer than the version cited in the text.

## Table of contents

| Chapter | Content |
| --- | --- |
| [Overview: How a coding agent completes a code change](./00-overview.en.md) | Follows one small change through the full path across the desktop app, Sidecar, CLI, model and tools |
| [Part 1: The agent's execution loop](./01-execution-loop.en.md) | The four-step loop of requesting the model, detecting tool calls, running tools and appending results, and when the loop ends |
| [Part 2: The code tool system](./02-code-tools.en.md) | How tools are looked up, validated, executed and have their results converted, and how multiple calls are batched for concurrency |
| [Part 3: Tool permission control and execution boundaries](./03-permissions.en.md) | How `allow`, `deny` and `ask` are decided, the round trip of desktop confirmation, Bash path checks and the sandbox |
| [Part 4: Session persistence and context engineering](./04-session-context.en.md) | How the same set of messages differs on disk, after resume and in a model request, and how auto-compaction works |
| [Part 5: Streaming responses and failure recovery](./05-streaming-recovery.en.md) | Running tools while the model is still producing output, and what has already run and what will repeat on cancellation and fallback |
| [Part 6: Model access and desktop integration](./06-desktop-integration.en.md) | How provider configuration reaches the CLI, session processes and message channels, protocol conversion for the OpenAI format, and continuing on a phone |

## Reading conventions

- Source links in the text are pinned to commit [`dba5b24`](https://github.com/GoDiao/dreamcoder/tree/dba5b24c75be4e3c35cd42d082dc9a7f8b631087). Later code may differ from what the text describes.
- JSON messages, IDs (such as `toolu_read_1`) and paths (such as `/example/src/app.ts`) in the text are illustrative data. They are constructed from the data structures in the source code and are not records of real runs.
- Code snippets are excerpts from the source at the version above. Omitted parts are marked with comments, and the snippets cannot run on their own. Each chapter also contains clearly labeled teaching pseudocode, which explains structure and is not DreamCoder source code.
- The correspondence between `tool_use.id` and `tool_result.tool_use_id` is fully explained in [Part 1](./01-execution-loop.en.md#from-tool_use-to-tool_result). The other chapters use it directly.

## Participation and feedback

- If a description does not match the code, or a part is not explained clearly, please open an [issue](https://github.com/GoDiao/dreamcoder/issues).
- If you want to improve DreamCoder, read the [contributing guide](../CONTRIBUTING_en.md) first, then start with a [good first issue](https://github.com/GoDiao/dreamcoder/issues?q=is%3Aopen+is%3Aissue+label%3A%22good+first+issue%22).
