[English](./README.en.md) | 简体中文

# 编程智能体实现指南

本系列通过 DreamCoder 的源码，讲解编程智能体如何工作：一条“把 `value` 改成 2”的消息，怎样变成多次模型请求、文件读取和修改；程序怎样校验参数、请求用户确认、保存会话，又怎样处理取消和失败。文章是源码导读，不要求读者另写教学程序。

## 适合谁

- 用过 Claude Code 等编程智能体，想知道它们内部怎样工作的开发者。
- 准备自己实现编程智能体，想参考一套完整实现的开发者。
- 想参与 DreamCoder 开发，需要先熟悉代码结构的贡献者。

## 预备知识

需要 TypeScript 基础和 `async/await`，知道 HTTP 与 WebSocket 的基本用途。异步生成器、JSONL、Hook、Sidecar 等概念在首次出现时解释。

## 读完能做什么

- 说清一条用户消息怎样由执行循环变成多次模型请求和工具执行，循环在什么条件下结束。
- 找到 DreamCoder 中工具、权限、会话、流式执行和桌面集成的代码入口，理解修改这些代码时要注意的约束。
- 自己实现编程智能体时，知道需要处理哪些问题：工具结果与调用的对应、执行前的权限判断、会话记录与请求上下文的区别、取消和重试带来的副作用。

## 两种读法

- **只读源码。** 按目录顺序阅读，文中的源码链接指向固定版本，点开即可对照。
- **运行项目对照。** 按根目录 README 的[快速开始](../../README.md#-快速开始)从源码运行 DreamCoder，在桌面端让它修改一个小文件，再对照[开篇](./00-overview.zh.md)中“桌面界面上看到的”一节。运行的代码可能比文中引用的版本新。

## 目录

| 篇目 | 内容 |
| --- | --- |
| [开篇：编程智能体如何完成一次代码修改](./00-overview.zh.md) | 用一次小修改走完桌面、Sidecar、CLI、模型和工具的完整路径 |
| [第一篇：智能体的执行循环](./01-execution-loop.zh.md) | 请求模型、识别工具调用、执行工具、追加结果的四步循环，以及循环何时结束 |
| [第二篇：代码工具系统](./02-code-tools.zh.md) | 工具怎样被查找、校验、执行和转换结果，多个调用怎样分批并发 |
| [第三篇：工具权限控制与执行边界](./03-permissions.zh.md) | `allow`、`deny`、`ask` 的判定，桌面确认的往返，Bash 路径检查与沙箱 |
| [第四篇：会话持久化与上下文工程](./04-session-context.zh.md) | 同一组消息在磁盘、恢复后和模型请求中的差别，自动压缩怎样工作 |
| [第五篇：流式响应与故障恢复](./05-streaming-recovery.zh.md) | 模型输出期间就执行工具，取消和回退时哪些已经执行、哪些会重复 |
| [第六篇：模型接入与桌面端集成](./06-desktop-integration.zh.md) | Provider 配置怎样进入 CLI，会话进程与消息通道，OpenAI 格式的协议转换和手机接续 |

## 阅读约定

- 文中源码链接固定在 commit [`dba5b24`](https://github.com/GoDiao/dreamcoder/tree/dba5b24c75be4e3c35cd42d082dc9a7f8b631087)；之后的代码可能与文中描述不同。
- 文中的 JSON 消息、ID（如 `toolu_read_1`）和路径（如 `/example/src/app.ts`）都是示意数据，按源码中的数据结构构造，不是运行记录。
- 代码片段节选自上述版本的源码，省略处用注释标出，不能单独运行。各篇另有明确标注的教学伪代码，用于说明结构，不是 DreamCoder 源码。
- `tool_use.id` 与 `tool_result.tool_use_id` 的对应关系在[第一篇](./01-execution-loop.zh.md#从-tool_use-到-tool_result)完整说明，其余各篇直接使用。

## 参与与反馈

- 发现文中描述与代码不符，或有讲得不清楚的地方，欢迎提交 [issue](https://github.com/GoDiao/dreamcoder/issues)。
- 想动手改进 DreamCoder，可以先读[贡献指南](../CONTRIBUTING_zh.md)，再从 [good first issue](https://github.com/GoDiao/dreamcoder/issues?q=is%3Aopen+is%3Aissue+label%3A%22good+first+issue%22) 开始。
