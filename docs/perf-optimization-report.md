# DreamCoder 性能优化报告

> 基于 dev 分支代码审计，2025-05-29

## 一、架构级（高投入 · 高回报）

### 1. 通信协议：localhost HTTP/JSON → 直接 IPC / 二进制协议

**现状**：streaming token 经过 **两次 WebSocket 跳 + 两次 JSON parse/stringify**：
```
CLI subprocess → SDK WebSocket → Server 翻译 → Client WebSocket
```
每个 delta token 都要做完整的 JSON 序列化。100 tokens/sec = 每秒 200+ 次 JSON 操作。无快捷路径，所有 `content_delta` 都走这条双跳路径。

- `src/server/index.ts:195` — `/ws/:sessionId` 客户端通道
- `src/server/index.ts:233` — `/sdk/:sessionId` CLI 子进程通道
- `src/server/ws/handler.ts:1133-1138` — `translateCliMessage` 翻译 `content_block_delta`
- `desktop/src/api/websocket.ts:66` — `JSON.parse(event.data)` 逐消息解析

**方案**：
- CLI 子进程改用 **stdin/stdout pipe 或 Unix domain socket**，省掉一跳网络开销
- streaming delta 用 **MessagePack 或长度前缀二进制帧**，替代 JSON
- 预估收益：每 chunk 延迟降低 2-5ms，高吞吐场景下 GC 压力大幅下降

**权衡**：实现复杂度高，调试困难，破坏浏览器 DevTools 检查能力。

### 2. 会话数据存储：JSONL 全量解析 → 元数据缓存

**现状**：`sessionService.ts` — `listSessions()` 对每个会话文件做 **完整 JSONL 读取 + 逐行 JSON.parse**，只为提取 title、workDir、messageCount。`extractTitle` 还要在解析后的 entries 上做多遍扫描。100 个会话 = 100 次全文件读取。无任何缓存机制。

- `src/server/services/sessionService.ts:1282-1348` — `listSessions` 逐文件全量解析
- `src/server/services/sessionService.ts:260-282` — `readJsonlFile` 全文件读取 + 逐行 JSON.parse
- `src/server/services/sessionService.ts:903-953` — `discoverSessionFiles` 全目录扫描，无索引
- `src/server/services/sessionService.ts:848-893` — `extractTitle` 多遍扫描 entries

**方案**：内存缓存元数据，用 file mtime 或 watcher 触发失效。session list API 从 O(n×file_size) 降到 O(n)。

**权衡**：需处理缓存失效（CLI 端可能并发写入），内存占用增加。

---

## 二、核心逻辑（中投入 · 高回报）

### 3. Query Loop 消息扫描优化

**现状**：`src/query.ts:366-469`，每次 agent loop 迭代对 messages 数组执行 5 个独立操作（实际内部遍历 7-10+ 次）：

| # | 操作 | 条件 | 内部遍历次数 |
|---|------|------|-------------|
| 1 | `applyToolResultBudget` | GrowthBook flag 门控 | 2-3 次 O(n) |
| 2 | snip compaction | `feature('HISTORY_SNIP')` 门控 | 1+ 次 |
| 3 | microcompact | **无条件执行** | 2-3 次 O(n) |
| 4 | context collapse | `feature('CONTEXT_COLLAPSE')` 门控 | 1+ 次 |
| 5 | autocompact check | **无条件执行** | 1+ 次 O(n) |

这些操作之间有 **显式的顺序依赖**（budget 在 microcompact 之前，snip 的 tokensFreed 传递给 autocompact），**无法合并为单次遍历**。

- `src/query.ts:370-373` — budget 必须在 microcompact 之前
- `src/query.ts:397` — snip 在 microcompact 之前
- `src/query.ts:413` — microcompact 在 autocompact 之前
- `src/query.ts:429-432` — context collapse 在 autocompact 之前

**方案**：
- 对无条件执行的 3 个操作，检测 messages 是否与上次迭代相同（工具未调用时直接跳过）
- 内部多遍扫描的操作（如 microcompact 的 `collectCompactableToolIds` + `findLast` + `map`）合并为单次遍历
- feature-gated 的操作在 flag 关闭时编译期 DCE，不影响外部构建

### 4. chatStore 状态形状重构

**现状**：`chatStore.ts` 2600 行巨石，`updateSessionIn` 每次创建新 sessions Record + 新 session 对象。`content_delta` 有 50ms 节流缓解，但其他消息类型（status、thinking、tool_result 等）均无节流，立即触发全量 spread。

- `desktop/src/stores/chatStore.ts:732-740` — `updateSessionIn` 全量 spread
- `desktop/src/stores/chatStore.ts:1212-1215` — `update()` 辅助函数包装每个消息处理
- `desktop/src/stores/chatStore.ts:1346-1395` — `content_delta` 50ms 节流
- `desktop/src/stores/chatStore.ts:931-935` — elapsed timer 每秒触发 `updateSessionIn`
- `desktop/src/components/chat/MessageList.tsx:1210-1211` — 选择整个 session 对象导致不必要 re-render

跨 store 级联更新：
- `chatStore.ts:1272` — status 消息写入 `tabStore`
- `chatStore.ts:1633-1634` — `session_title_updated` 写入 `sessionStore` + `tabStore`
- `chatStore.ts:1681-1684` — `session_cleared` 写入 `cliTaskStore` + `sessionStore` + `tabStore`

**方案**：
- 将 `messages` 数组从 `PerSessionState` 中拆出到独立的 `messagesBySession` record
- 组件使用 **granular selectors**（选具体字段而非整个 session 对象）
- elapsed timer 移出 Zustand state，改为 UI 层 `useRef` 管理

**权衡**：大规模重构，需迁移所有 `session.messages` 消费方。

---

## 三、Rust 层（低投入 · 高回报）

### 5. Sidecar 启动移出同步 `setup()`

**现状**：`start_server_sidecar()` 在 Tauri `setup()` 中同步执行，包含最多 10 秒的 TCP 轮询等待。`.run()` 在 `.build()` 返回后才执行，窗口可见但完全无响应。

- `desktop/src-tauri/src/lib.rs:2258` — 同步调用 `start_server_sidecar`
- `desktop/src-tauri/src/lib.rs:1482-1498` — `wait_for_server` 10 秒 TCP 轮询
- `desktop/src-tauri/src/lib.rs:2278/2281` — `.build()` 阻塞 `.run()`

**方案**：`setup()` 中只启动异步任务，前端显示 loading 状态，监听 `"server-ready"` 事件。

**权衡**：前端需处理"服务未就绪"状态，UI 复杂度增加。

### 6. 窗口状态持久化加防抖

**现状**：每帧 `Moved/Resized` 事件都调用 `save_main_window_state`，最终走 `fs::write` 同步写盘。拖动窗口时每秒触发数十次磁盘 I/O。**无任何防抖机制**。

- `desktop/src-tauri/src/lib.rs:2293-2299` — 事件处理器直接调用
- `desktop/src-tauri/src/lib.rs:792` — `std::fs::write` 同步写盘

**方案**：500ms 防抖，或只在 `CloseRequested`/`ExitRequested` 时保存。

**权衡**：应用崩溃时可能丢失最后 500ms 的窗口位置，影响可忽略。

### 7. Terminal sessions 锁粒度优化

**现状**：所有终端操作（spawn、write、resize、kill、exit cleanup，共 5 个调用点）共享一个 `Mutex<HashMap<u32, TerminalSession>>`，多 session 场景互相阻塞。

- `desktop/src-tauri/src/lib.rs:413-416` — `TerminalState` 结构定义
- `desktop/src-tauri/src/lib.rs:956,1051,1078,1100,1011` — 5 个锁获取点

**方案**：换 `DashMap`，不同 session 的 read/write/resize 不再竞争。

**权衡**：新增 `dashmap` 依赖，分片锁内存略增。

---

## 四、前端渲染（中投入 · 中回报）

### 8. Markdown 解析管道异步化

**现状**：两个 `useMemo` 同步执行在渲染路径中，无 `useDeferredValue` 或 `startTransition` 使用。长消息首次渲染阻塞主线程。

- `desktop/src/components/markdown/MarkdownRenderer.tsx:300-307` — `parseMarkdown` 同步执行 `extractMath` + `marked.parse`
- `desktop/src/components/markdown/MarkdownRenderer.tsx:464-490` — `enhanceMarkdownHtml` 同步执行 `katex.renderToString` + `document.createElement('div')` + `querySelectorAll`/`replaceWith`
- `desktop/src/components/markdown/MarkdownRenderer.tsx:237-243` — `katex.renderToString` 同步调用

**方案**：用 `useDeferredValue` 包裹 content，让 React 可以在高优先级更新时中断解析。

**权衡**：流式输出可能在高速 delta 时滞后一帧。

### 9. 补全 memoization

- `desktop/src/components/chat/MessageList.tsx:1766` — `renderTranscriptItem` 未包 `useCallback`
- `desktop/src/components/chat/ToolCallGroup.tsx:164` — `ToolCallGroupContent` 未包 `memo()`
- `desktop/src/components/chat/ToolCallGroup.tsx:417` — `ToolCallGroupMulti` 未包 `memo()`

顶层 `ToolCallGroup` 已包 `memo()`，但内部两个子组件没有，父组件 re-render 时级联。

---

## 五、快速修复（低投入 · 低-中回报）

| # | 项目 | 位置 | 修复 | 验证状态 |
|---|------|------|------|---------|
| 1 | PTY 读缓冲区太小 | `lib.rs:972` | 8KB → 32KB | 已确认 `[0_u8; 8192]` |
| 2 | `allUserMessages` 无界增长 | `handler.ts:62-68` | 只保留前 3 条（生成标题只用前 3 条） | 已确认 `line 317` 无条件 push，无上限 |
| 3 | Team 成员轮询无去重 | `teamStore.ts:262` | 1.5s 轮询加 in-flight flag | 已确认无 AbortController、无去重 |
| 4 | 工具模块全量 eager import | `src/tools.ts:1-98` | 改为 lazy `require()` | 已确认 25+ 静态 import |
| 5 | `terminal_environment()` 重复调用 | `lib.rs:932, 1588, 1724` | `OnceLock` 缓存结果（当前每次 spawn 子进程，最多阻塞 2s） | 已确认 3 个调用点无缓存 |
| 6 | 移除未使用的 `reqwest` 依赖 | `Cargo.toml:27` | 减小 Rust 二进制体积 | 已确认 lib.rs 中零引用 |

---

## 投入优先级建议

### 最低投入，最高回报（先做这 3 个）

1. **会话元数据缓存** (#2) — 直接改善"打开会话列表"速度
2. **chatStore 重构** (#4) — 前端最大的性能债务
3. **Sidecar 启动异步化** (#5) — 消除启动时"白屏假死"

### 大幅重写方向

- **#1 通信层重构** — 重新设计 sidecar ↔ server ↔ client 通信，pipe + 二进制协议
- **#4 chatStore 重构** — 拆分 PerSessionState，granular selectors

### 快速修复可并行推进

- 快速修复 #1-6 均为独立改动，可与上述工作并行
- Rust 层 #6 #7 也可独立推进
