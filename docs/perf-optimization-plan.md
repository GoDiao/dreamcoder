# DreamCoder 性能优化实施计划

> 基于 `docs/perf-optimization-report.md`，按依赖关系和投入产出比排列

## 完成状态

| Phase | 状态 | Commit |
|-------|------|--------|
| Phase 1: 快速修复 | ✅ 已完成 | `edf968f`, `8626e85` |
| Phase 2: Rust 层优化 | ✅ 已完成 | `57c60a4` |
| Phase 3: 前端优化 | ✅ 已完成 | `8636592` |
| Phase 4: Server 核心优化 | ✅ 已完成（4.1） | `563ffcf` |
| Phase 5: 架构重构 | ✅ 已完成（5.1） | `23f6fdd` |

**已完成的优化项**:
- [x] 1.1 PTY 读缓冲区 8KB → 32KB
- [x] 1.2 `allUserMessages` 加上限 (MAX=3)
- [x] 1.3 Team 成员轮询加 in-flight 守卫
- [x] 1.4 工具模块 lazy import
- [x] 1.5 `terminal_environment()` 结果缓存
- [x] 1.6 移除未使用的 reqwest 依赖
- [x] 2.1 窗口状态持久化防抖
- [x] 2.2 Sidecar 启动异步化
- [x] 2.3 Terminal sessions 换 DashMap
- [x] 3.1 elapsed timer 移出 Zustand
- [x] 3.2 chatStore granular selectors (MessageList)
- [x] 3.3 Markdown 解析异步化 (useDeferredValue)
- [x] 4.1 会话元数据缓存
- [ ] 4.2 Query Loop 内部遍历合并（不可行，有显式顺序依赖）
- [x] 5.1 通信层重构 - pipe（已完成，通过 DREAMCODER_USE_PIPE_TRANSPORT 启用）
- [ ] 5.2 通信层重构 - 二进制协议（暂缓，投入产出比低：消息小、JSON 开销低、增加调试难度）

---

## Phase 1: 快速修复（1-2 天，零依赖，可并行）

### 1.1 PTY 读缓冲区 8KB → 32KB

**文件**: `desktop/src-tauri/src/lib.rs:972`
**改动**: `[0_u8; 8192]` → `[0_u8; 32768]`
**验证**: 打开终端，`cat` 大文件，观察输出流畅度

### 1.2 `allUserMessages` 加上限

**文件**: `src/server/ws/handler.ts`
**改动**:
- `line 317`: `titleState.allUserMessages.push(titleInput)` 后加 `if (titleState.allUserMessages.length > 3) titleState.allUserMessages.length = 3`
- 标题生成只读取前 3 条消息（`line 678`），多余的无需保留
**同步**: `sidecar/src/server/ws/handler.ts` 是镜像文件，需同步修改

### 1.3 Team 成员轮询加 in-flight 守卫

**文件**: `desktop/src/stores/teamStore.ts`
**改动**:
- 在 store state 或模块级增加 `memberPollInFlight: boolean`
- `refreshMemberSession` 开头检查，若 in-flight 则 return
- fetch 完成后清除 flag
**验证**: 在慢网络下确认不会堆叠请求

### 1.4 工具模块 lazy import

**文件**: `src/tools.ts`
**改动**:
- 将 `line 2-82` 的 25+ 个静态 import 改为在 `getAllBaseTools()` 内部 `require()` 动态加载
- 参考 `line 91-136` 已有的 feature-gated lazy `require()` 模式
- 需确认 `bun build --compile` 能正确处理动态 require（Bun 支持）
**验证**: 对比修改前后的 CLI 冷启动时间

### 1.5 `terminal_environment()` 结果缓存

**文件**: `desktop/src-tauri/src/lib.rs`
**改动**:
```rust
use std::sync::OnceLock;

static TERMINAL_ENV_CACHE: OnceLock<HashMap<String, String>> = OnceLock::new();

fn terminal_environment_cached(shell: &str) -> &'static HashMap<String, String> {
    TERMINAL_ENV_CACHE.get_or_init(|| terminal_environment(shell))
}
```
- `line 932, 1588, 1724` 三个调用点改为 `terminal_environment_cached(shell)`
**验证**: 启动应用，确认 adapter sidecar 的环境变量仍正确

### 1.6 移除未使用的 reqwest

**文件**: `desktop/src-tauri/Cargo.toml:27`
**改动**: 删除 `reqwest = { version = "0.13", ... }` 行
**验证**: `cargo build` 编译通过；`grep -r "reqwest" src/` 无结果

---

## Phase 2: Rust 层优化（2-3 天）

### 2.1 窗口状态持久化防抖

**文件**: `desktop/src-tauri/src/lib.rs`
**改动**:

1. 在 `AppExitState` 或模块级增加防抖状态：
```rust
static LAST_SAVE: Mutex<Instant> = Mutex::new(Instant::now());
// 或在 AppExitState 中加 last_window_save: Option<Instant>
```

2. `line 2293-2299` 的事件处理器改为：
```rust
RunEvent::WindowEvent { label, event: WindowEvent::Moved(_) | WindowEvent::Resized(_), .. }
    if label == MAIN_WINDOW_LABEL =>
{
    let now = Instant::now();
    let mut last = LAST_SAVE.lock().unwrap();
    if now.duration_since(*last) > Duration::from_millis(500) {
        *last = now;
        drop(last);
        save_main_window_state(app_handle);
    }
}
```

3. 在 `CloseRequested` / `ExitRequested` 处理器中追加一次无条件 `save_main_window_state`

**验证**: 拖动窗口时用 Process Monitor 观察写盘频率从数十次/秒降至 ≤2次/秒

### 2.2 Sidecar 启动异步化

**文件**: `desktop/src-tauri/src/lib.rs`
**改动**:

1. `setup()` 闭包（`line 2247`）中，将 `start_server_sidecar()` 调用移到 `std::thread::spawn` 中：
```rust
let handle = app.handle().clone();
std::thread::spawn(move || {
    match start_server_sidecar(&handle) {
        Ok(_) => { let _ = handle.emit("server-ready", true); }
        Err(e) => { let _ = handle.emit("server-error", e); }
    }
});
```

2. `wait_for_server` 保留不变，仍在后台线程中轮询

3. `get_server_url` Tauri command（`line 463`）需增加 server 未就绪时的处理：
   - 返回 `Err("Server not ready")`，前端轮询重试
   - 或阻塞等待直到 ready（用 `OnceLock` / `Condvar`）

4. 前端 `desktop/src/` 增加 server 就绪状态管理：
   - 新增 `serverReady` state（或在现有 store 中）
   - 监听 Tauri `server-ready` 事件
   - 启动时显示 loading 状态，就绪后初始化 WebSocket 连接

5. `get_server_url` 当前被前端初始加载时同步调用，需改为：
   - 前端先显示 loading
   - 监听 `server-ready` 事件后调用 `get_server_url`
   - 或 `get_server_url` 内部等待 server 就绪

**验证**: 启动应用，窗口应立即可交互（显示 loading），sidecar 就绪后自动连接

### 2.3 Terminal sessions 换 DashMap

**文件**: `desktop/src-tauri/src/lib.rs` + `desktop/src-tauri/Cargo.toml`
**改动**:

1. `Cargo.toml` 添加 `dashmap = "6"`
2. `line 413-416` 改为：
```rust
struct TerminalState {
    next_id: AtomicU32,
    sessions: DashMap<u32, TerminalSession>,
}
```
3. 所有 `state.sessions.lock().unwrap()` 调用点改为直接 `state.sessions.get(&id)` / `state.sessions.insert()` / `state.sessions.remove()`
4. 不再需要手动 `.lock()`，DashMap 自带分片锁

**验证**: 多终端 tab 并发操作（同时输入+resize），无卡顿

---

## Phase 3: 前端优化（5-7 天）

### 3.1 elapsed timer 移出 Zustand

**文件**: `desktop/src/stores/chatStore.ts`
**改动**:

1. `PerSessionState` 中移除 `elapsedSeconds` 和 `elapsedTimer`
2. 创建 `desktop/src/hooks/useElapsedTimer.ts`：
```typescript
export function useElapsedTimer(sessionId: string, active: boolean): number {
    const [seconds, setSeconds] = useState(0)
    useEffect(() => {
        if (!active) return
        const id = setInterval(() => setSeconds(s => s + 1), 1000)
        return () => clearInterval(id)
    }, [active])
    return seconds
}
```
3. 显示 elapsed 的组件改用 `useElapsedTimer`
4. `chatStore.ts:931-935` 的 `setInterval` + `updateSessionIn` 删除

**影响范围**: 使用 `elapsedSeconds` 的组件需改为 hook
**验证**: 生成过程中计时器正常，Zustand DevTools 中确认不再每秒触发 set

### 3.2 chatStore granular selectors

**文件**: `desktop/src/stores/chatStore.ts` + 所有消费方组件
**改动**:

1. 导入 Zustand 的 `useShallow` 工具（如果可用），或手写 equality 函数
2. 逐个组件改造：

   **MessageList.tsx:1210-1211** — 最关键的调用点：
   ```typescript
   // Before
   const session = useChatStore(s => s.sessions[sessionId])
   // After - 只订阅需要的字段
   const chatState = useChatStore(s => s.sessions[sessionId]?.chatState)
   const streamingText = useChatStore(s => s.sessions[sessionId]?.streamingText)
   const messages = useChatStore(s => s.sessions[sessionId]?.messages)
   ```

3. 搜索所有 `useChatStore((s) => s.sessions[` 调用点，逐个审查是否过度订阅

4. `updateSessionIn` 函数本身不需要改 — immutable update 是正确的，问题在于消费方订阅粒度

**影响范围**: 所有使用 chatStore 的组件（估计 20+ 处）
**验证**: React DevTools Profiler 对比 re-render 次数

### 3.3 Markdown 解析异步化

**文件**: `desktop/src/components/markdown/MarkdownRenderer.tsx`
**改动**:

1. 在组件中引入 `useDeferredValue`：
```typescript
const deferredContent = useDeferredValue(content)
const { html, codeBlocks, mathBlocks } = useMemo(
    () => getCachedMarkdownParse(deferredContent, streaming),
    [deferredContent, streaming]
)
```

2. 注意：`deferredContent` 可能在高速 streaming 时滞后，但已有 50ms 节流，用户感知不明显

3. `enhanceMarkdownHtml` 同样用 deferred 的 html 作为输入

**验证**: 发送长代码回复，观察 UI 是否保持响应（输入框可交互）

### 3.4 Memoization 补全

**文件**: 3 个文件，独立改动

1. **ToolCallGroup.tsx:164** — `ToolCallGroupContent` 包 `memo()`:
```typescript
const ToolCallGroupContent = memo(function ToolCallGroupContent({ ... }: Props) {
```

2. **ToolCallGroup.tsx:417** — `ToolCallGroupMulti` 包 `memo()`:
```typescript
const ToolCallGroupMulti = memo(function ToolCallGroupMulti({ ... }: Props) {
```

3. **MessageList.tsx:1766** — `renderTranscriptItem` 包 `useCallback`:
```typescript
const renderTranscriptItem = useCallback((item: RenderItem, index: number) => {
    // ... 现有逻辑
}, [toolResultMap, childToolCallsByParent, agentTaskNotifications, ...])
```
注意：依赖列表较长，需仔细列出所有闭包捕获的变量

**验证**: React DevTools Profiler 确认无多余 re-render

---

## Phase 4: Server 核心优化（5-7 天）

### 4.1 会话元数据缓存

**文件**: `src/server/services/sessionService.ts`
**改动**:

1. 新增 `SessionMetadata` 接口和内存缓存：
```typescript
interface SessionMetadata {
    title: string | undefined
    workDir: string | undefined
    projectRoot: string | undefined
    messageCount: number
    lastModified: number  // file mtime
}

private metadataCache = new Map<string, SessionMetadata>()
```

2. 在 `discoverSessionFiles` 获取 file stat 时，同时获取 mtime：
```typescript
const stat = await fs.stat(filePath)
const cached = this.metadataCache.get(filePath)
if (cached && cached.lastModified === stat.mtimeMs) {
    // 命中缓存，跳过 JSONL 读取
    return cached
}
```

3. 缓存未命中时，照常 `readJsonlFile` + 提取元数据，写入缓存

4. `getSession`、`clearSession` 等写操作后，清除对应缓存条目

5. 考虑用 `fs.watch` 或定期清理防止缓存无限增长

**同步**: `sidecar/src/server/services/sessionService.ts` 需同步修改

**验证**:
- 首次 `GET /api/sessions` 正常（冷启动）
- 第二次请求明显更快（缓存命中）
- 创建/删除会话后列表数据正确（缓存失效）

### 4.2 Query Loop 内部遍历合并

**文件**: `src/services/compact/microCompact.ts`, `src/utils/toolResultStorage.ts`
**改动**:

**microCompact 内部**（`microCompact.ts`）:
- `collectCompactableToolIds(messages)` + `messages.findLast()` + `messages.map()` → 合并为单次 `for (let i = messages.length - 1; i >= 0; i--)` 反向遍历
- 在一次遍历中同时收集候选 ID、查找锚点、构建新数组

**applyToolResultBudget 内部**（`toolResultStorage.ts`）:
- `collectCandidatesByMessage(messages)` + `buildToolNameMap(messages)` + `replaceToolResultContents(messages, map)` → 单次遍历中同时收集候选、构建映射、应用替换

**验证**: 对比修改前后的 agent loop 单次迭代耗时（可用 `console.time` 测量）

---

## Phase 5: 架构重构（10-15 天，可选）

### 5.1 通信层重构 — CLI 子进程改用 pipe

**涉及文件**:
- `src/server/services/conversationService.ts` — CLI 进程管理
- `src/server/ws/handler.ts` — SDK WebSocket 消息桥
- `src/server/index.ts` — WebSocket upgrade 路由
- `src/entrypoints/cli.tsx` — CLI 端通信初始化
- `desktop/src/api/websocket.ts` — 前端 WebSocket 管理

**分步实施**:

1. **Step 1**: 在 CLI 启动参数中增加 `--pipe-mode` 标志（`conversationService.ts:136`）
2. **Step 2**: CLI 检测到 `--pipe-mode` 时，用 stdout/stdin 替代 SDK WebSocket 发送/接收消息
3. **Step 3**: Server 端 `conversationService` 增加 pipe 读取逻辑：
   - spawn CLI 时捕获 `child.stdout`
   - 用 `readline` 或自定义分行解析器处理 stream-json 格式
   - 写入通过 `child.stdin`
4. **Step 4**: 保留 SDK WebSocket 作为 fallback（`--pipe-mode` 未设置时走原路径）
5. **Step 5**: 迁移完成后移除 SDK WebSocket 通道代码

**验证**: 每个 step 都要确保桌面端和 CLI 两种模式均正常工作

### 5.2 通信层重构 — streaming delta 二进制协议

**涉及文件**: 同 5.1 + 前后端消息序列化层

**分步实施**:

1. **Step 1**: 引入 `msgpack-lite` 或手写长度前缀编码器
2. **Step 2**: 定义二进制消息格式（消息类型 1 byte + payload）
3. **Step 3**: Client WebSocket 增加二进制帧检测（`ArrayBuffer` vs `string`）
4. **Step 4**: `content_delta` 类型优先用二进制帧发送，其他消息保持 JSON
5. **Step 5**: 确认 WebView2 支持 WebSocket binary frames

**验证**: 流式输出功能不变，对比 JSON 模式下的 CPU 占用

---

## 执行顺序与依赖关系

```
Phase 1 (快速修复) ─── 全部可并行，无依赖
    │
    ├── Phase 2 (Rust) ─── 2.1, 2.3 独立；2.2 需前端配合
    │       │
    ├── Phase 3 (前端) ─── 3.1 独立；3.2 依赖 3.1；3.3, 3.4 独立
    │       │
    ├── Phase 4 (Server) ─── 4.1, 4.2 独立
    │       │
    └── Phase 5 (架构) ─── 5.1 先行；5.2 可选，依赖 5.1
```

## 总工期估算

| Phase | 工期 | 人力 |
|-------|------|------|
| Phase 1 | 1-2 天 | 1 人 |
| Phase 2 | 2-3 天 | 1 人（Rust 经验） |
| Phase 3 | 5-7 天 | 1 人（React 经验） |
| Phase 4 | 5-7 天 | 1 人 |
| Phase 5 | 10-15 天 | 1-2 人 |
| **合计** | **23-34 天** | |

## 回滚策略

每个 Phase 独立 commit，可按 commit revert。Phase 5 保留旧路径作为 fallback，确保可安全回退。
