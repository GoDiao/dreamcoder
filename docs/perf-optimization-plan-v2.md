# DreamCoder 性能优化计划 v2

> 基于 dev 分支二次审计（2026-06-10），针对 v1 报告外发现的 13 个新优化点

v1 报告（`perf-optimization-report.md`）覆盖了通信协议、会话缓存、chatStore、Rust 层等系统级问题；v2 聚焦 **Bundle 体积、状态结构、轮询节流、内存驻留** 等 v1 未覆盖的工程优化。

---

## 一、决策记录

| 项 | 决策 | 备注 |
|---|---|---|
| Batch D 终端卸载方案 | **A 保守方案** | 限并发 5 个，第 6 个起把最老的 unmount，buffer 序列化到内存 |
| #7 handleTeamCreated | **指数退避重试** | 1s / 2s / 4s 最多 3 次，不依赖 WebSocket 推送 |
| Benchmark 自动化对比脚本 | **要做** | `scripts/benchmark/compare.ts`，stash → baseline → pop → after → diff |

---

## 二、批次划分

每批一个独立 commit，独立 benchmark，独立可回滚。

| 批次 | 内容 | 风险 | Benchmark |
|---|---|---|---|
| **Batch A** Bundle 瘦身 | #1 Settings lazy + #2 mermaid/katex 动态 import + #3 manualChunks | 低 | bundle 体积 + Coverage |
| **Batch E** 低影响清理 | #12 Vec::with_capacity + #13 console.warn 守护 | 极低 | build 通过 |
| **Batch C** 节流/防抖 | #6 sidebarWidth + #7 handleTeamCreated + #10 任务通知轮询 + #11 ActiveSession 轮询 | 低 | 5 分钟请求计数 |
| **Batch B** 状态结构 | #5 sessionsById 索引 + #9 chatStore sessions Map 化 | 中 | updateSessionIn 微基准 |
| **Batch D** 终端 + Rust | #4 终端限并发 5 + #8 Rust spin-wait 移 spawn_blocking | 中-高 | 多终端 RSS + 启动时间 |

执行顺序：**A → E → C → B → D**（从低风险到高风险，互相不阻塞）。

---

## 三、Batch A — Bundle 瘦身

### 改动清单

1. **`desktop/vite.config.ts`** 新增 `build.rollupOptions.output.manualChunks`：
   ```ts
   manualChunks: {
     'vendor-mermaid': ['mermaid'],
     'vendor-katex': ['katex'],
     'vendor-shiki': ['shiki'],
     'vendor-xterm': ['xterm', '@xterm/addon-fit'],
     'vendor-react': ['react', 'react-dom'],
   }
   ```
   同时把 `chunkSizeWarningLimit` 从 2200 调回 700（默认值），强制后续不退化。

2. **`desktop/src/pages/Settings.tsx`** 每个 tab 改 `React.lazy()` + `Suspense`：
   ```tsx
   const ProviderSettings = React.lazy(() => import('../components/settings/ProviderSettings'));
   // ... 其他 14 个
   <Suspense fallback={<TabSkeleton />}>{renderActiveTab()}</Suspense>
   ```
   涉及组件：`ProviderSettings`、`McpSettings`、`TerminalSettings`、`MemorySettings`、`PluginList`、`ComputerUseSettings`、`DiagnosticsSettings`、`AgentsSettings`、`SkillSettings`、`AboutSettings` 等 15+ 个。

3. **`desktop/src/components/markdown/MarkdownRenderer.tsx`** 改异步加载：
   ```tsx
   // 删掉 import katex from 'katex'
   const [katex, setKatex] = useState<typeof import('katex') | null>(null);
   useEffect(() => {
     if (containsMath(content)) {
       import('katex').then((m) => setKatex(m.default));
     }
   }, [content]);
   ```
   - mermaid 同理（在 `MermaidRenderer.tsx` 内部）
   - 加载完成前显示占位（公式/图表区域用 skeleton）

### Benchmark 方案

**新增 `scripts/benchmark/bundle.ts`**：
```ts
// 1. cd desktop && bun run build
// 2. 扫描 dist/assets/*.js，输出每个 chunk 的 size (bytes) + gzip size
// 3. 用 grep 检测主 chunk 是否还包含 'mermaid'/'katex'/'shiki' 字面量
// 4. 输出 markdown 表格 + 写入 docs/perf-optimization-results-v2.md
```

**指标**：
- 主 chunk 体积（gzip）
- mermaid/katex chunk 是否被独立拆出
- 首次加载（不打开设置 / 不渲染数学）的总下载量

**预期收益**：主 chunk -800KB（mermaid）-300KB（katex）-200KB（设置子模块）。

---

## 四、Batch E — 低影响清理

### 改动清单

1. **`desktop/src-tauri/src/lib.rs`** 三处 `Vec::new()` → `Vec::with_capacity()`：
   - L973 `pending_utf8`: `Vec::with_capacity(256)`
   - L1548 `candidates`: `Vec::with_capacity(4)`
   - L1713 `children`: `Vec::with_capacity(4)`

2. **生产 `console.warn` 守护**：
   - `desktop/src/lib/desktopNotifications.ts` (L89, 104, 119, 134, 223, 426, 433)
   - `desktop/src/components/chat/ChatInput.tsx` (L769, 783)
   - `desktop/src/pages/EmptySession.tsx` (L449, 462)
   - `desktop/src/hooks/useScheduledTaskDesktopNotifications.ts` (L105)
   - `desktop/src/stores/adapterStore.ts` (L22)
   - `desktop/src/lib/composerAttachments.ts` (L63)
   
   统一改成：
   ```ts
   if (import.meta.env.DEV) console.warn(...);
   ```
   或者抽一个 `devWarn()` helper。

### Benchmark 方案

不需要专门 benchmark。验证标准：
- `cargo build` 通过
- `bun run build` 通过
- 生产构建 `console.warn` 字符串数 < 当前数（用 `grep -c` 验证）

---

## 五、Batch C — 节流/防抖

### 改动清单

1. **#6 sidebarWidth 防抖** (`desktop/src/stores/uiStore.ts:120-123`)
   ```ts
   let persistTimer: NodeJS.Timeout | null = null;
   setSidebarWidth: (width) => {
     set({ sidebarWidth: width });  // 内存立即更新
     if (persistTimer) clearTimeout(persistTimer);
     persistTimer = setTimeout(() => {
       localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(width));
     }, 300);
   }
   ```

2. **#7 handleTeamCreated 指数退避** (`desktop/src/stores/teamStore.ts:289-292`)
   ```ts
   async function retryWithBackoff<T>(fn: () => Promise<T>, tries = 3, base = 1000): Promise<T> {
     for (let i = 0; i < tries; i++) {
       try { return await fn(); }
       catch (e) {
         if (i === tries - 1) throw e;
         await new Promise(r => setTimeout(r, base * Math.pow(2, i)));
       }
     }
     throw new Error('unreachable');
   }
   // 把 1.5s/4s/8s 三个 setTimeout 替换为单次 retryWithBackoff(fetchTeamDetail)
   ```

3. **#10 任务通知轮询** (`desktop/src/hooks/useScheduledTaskDesktopNotifications.ts:110-113`)
   ```ts
   const POLL_FAST = 30_000;
   const POLL_SLOW = 5 * 60_000;
   let interval = POLL_SLOW;  // 默认慢轮询
   
   async function poll() {
     const tasks = await tasksApi.list();
     if (tasks.length === 0) {
       interval = POLL_SLOW;
       return;  // 短路，不发 getRecentRuns
     }
     interval = POLL_FAST;
     await tasksApi.getRecentRuns(50);
   }
   // 用递归 setTimeout 而不是 setInterval，便于动态调整间隔
   ```

4. **#11 ActiveSession 轮询** (`desktop/src/pages/ActiveSession.tsx:314-316`)
   ```ts
   const TASK_POLL_INTERVAL_MS = 3000;  // 1000 → 3000
   ```
   或加退避（1s→2s→3s→5s 封顶）。

### Benchmark 方案

**新增 `scripts/benchmark/polling.ts`**：
```ts
// 1. 启动 server + puppeteer 客户端打开应用
// 2. 静置 5 分钟，统计：
//    - /api/tasks/list, /api/tasks/recent-runs 请求次数
//    - /api/team/* 请求次数
//    - localStorage.setItem 调用次数（注入 hook）
// 3. 模拟拖动 sidebar 60 秒，统计 localStorage 写入次数
// 4. 输出对比表
```

**指标**：5 分钟内总请求数 / 拖动 60s 内 localStorage 写次数。

**预期收益**：
- 任务通知轮询 5 分钟从 20 次 → 2 次（无任务用户）
- ActiveSession 轮询 5 分钟从 300 次 → 100 次
- sidebar 拖动 60s 从 ~3600 次 → ~10 次

---

## 六、Batch B — 状态结构

### 改动清单

1. **#5 sessionsById 派生索引** (`desktop/src/stores/sessionStore.ts`)
   - 在 `sessions: SessionListItem[]` 旁边维护 `sessionsById: Map<string, SessionListItem>`
   - 所有 `set({ sessions })` 同步重建 Map
   - 暴露 selector：
     ```ts
     export const useSessionById = (id: string | undefined) =>
       useSessionStore((s) => (id ? s.sessionsById.get(id) : undefined));
     ```
   - 替换 `.find()` 调用点（用 Grep 批量定位）：
     - `desktop/src/components/layout/AppShell.tsx:52`
     - `desktop/src/pages/ActiveSession.tsx:276`
     - `desktop/src/components/chat/ChatInput.tsx:138`
     - `desktop/src/components/layout/TabBar.tsx:59`
     - `desktop/src/components/layout/Sidebar.tsx:133, 1076, 1709`
     - `desktop/src/components/layout/StatusBar.tsx:12`
     - `desktop/src/components/plugins/PluginList.tsx:28`
     - `desktop/src/components/plugins/PluginDetail.tsx:42`
     - `desktop/src/components/settings/McpSettings.tsx:460`
     - `desktop/src/components/settings/AgentsSettings.tsx:290`
     - `desktop/src/components/skills/SkillList.tsx:35`

2. **#9 chatStore.sessions Map 化** (`desktop/src/stores/chatStore.ts:732-740`)
   - `sessions: Record<string, PerSessionState>` → `sessions: Map<string, PerSessionState>`
   - `updateSessionIn` 改成：
     ```ts
     const sessions = get().sessions;
     const session = sessions.get(sessionId);
     if (!session) return;
     const next = { ...session, ...updater(session) };
     // Zustand 需要新引用：用浅拷贝 Map
     const newSessions = new Map(sessions);
     newSessions.set(sessionId, next);
     set({ sessions: newSessions });
     ```
     虽然还是新建 Map，但只复制指针不复制 entry 对象。
   - 所有读 `sessions[id]` 改成 `sessions.get(id)`
   - 所有 `Object.values(sessions)` 改成 `[...sessions.values()]`

### Benchmark 方案

**新增 `scripts/benchmark/store.ts`**：
```ts
// 1. mock zustand + perSessionState
// 2. 创建 50 个 session
// 3. 模拟 10000 次 updateSessionIn（content_delta 场景）
// 4. 用 performance.now() 测总耗时 + 平均每次耗时
// 5. 用 V8 heap snapshot 看 Object spread 后 garbage 增长
```

**指标**：updateSessionIn p50 / p99 耗时、堆 GC 次数。

**预期收益**：Record spread 复杂度从 O(n_sessions) → O(1)，50 sessions 时 spread 耗时下降 ~80%。

### 注意

- 这是 **侵入式重构**，做之前先 `grep -rn "session\.messages\|sessions\["` 全量扫描
- 单元测试必须先跑通（`chatStore.test.ts` 已有覆盖）
- 如果发现某处依赖 Record 的 JSON 序列化，加 `mapToObject` 适配

---

## 七、Batch D — 终端卸载 + Rust spin-wait

### 改动清单

#### #4 终端限并发 5（方案 A）

**`desktop/src/stores/terminalStore.ts`**（如不存在则在 `chatStore` 或新建）：
```ts
const MAX_LIVE_TERMINALS = 5;

interface TerminalState {
  liveTerminalIds: string[];  // LRU 队列，新激活的进队尾
  hibernatedBuffers: Map<string, string>;  // 卸载后保留的文本快照
}

activateTerminal(id) {
  // 如果 id 已在 live 列表，移到队尾
  // 如果 id 不在 live 列表：
  //   - 如果 live.length >= 5：取队首 oldId，序列化其 xterm.buffer 到 hibernatedBuffers，从 DOM 卸载
  //   - 把 id 加到队尾
}
```

**`desktop/src/components/layout/ContentRouter.tsx:33-55`**：
- 把 `terminalSessions.map(s => <Terminal hidden={s.id !== activeId} />)` 改成
- `liveTerminalIds.map(id => <Terminal key={id} sessionId={id} hidden={id !== activeId} />)`
- 非 live 的终端不渲染。当用户点击它的 tab 时，先调 `activateTerminal(id)`，组件挂载后从 `hibernatedBuffers.get(id)` 恢复文本（write 到 xterm）。

#### #8 Rust spin-wait 移 spawn_blocking

**`desktop/src-tauri/src/lib.rs:1277-1299`** `login_shell_environment`：

当前：
```rust
let mut child = Command::new(shell).args(["-l", "-c", "env -0"]).spawn()?;
let deadline = Instant::now() + Duration::from_secs(2);
loop {
    if let Some(status) = child.try_wait()? { ... break }
    if Instant::now() >= deadline { child.kill()?; ... }
    thread::sleep(Duration::from_millis(25));
}
```

改为：
```rust
// 上层调用点用 tokio::task::spawn_blocking 包裹整个 terminal_environment()
let output = Command::new(shell)
    .args(["-l", "-c", "env -0"])
    .stdout(Stdio::piped())
    .spawn()?
    .wait_with_output_timeout(Duration::from_secs(2))?;  // 用 wait-timeout crate 或自写 channel
```

由于 `terminal_environment` 已有 `OnceLock` 缓存（v1 已做），整个进程生命周期只执行一次。这次改动主要把首次调用从"阻塞 Tauri worker thread"改成"阻塞 blocking thread pool"，不占调度器名额。

### Benchmark 方案

**新增 `scripts/benchmark/memory.ts`**：
```ts
// 1. tauri dev 启动
// 2. 通过 Tauri command 打开 1/3/5/8 个终端，每个跑 `cat /large.log`
// 3. 调 process.memoryUsage() 或调用 Windows tasklist /v 抓 dreamcoder.exe RSS
// 4. 输出 N 终端 vs RSS 表
```

**#8 启动时间**：在 `src-tauri/src/lib.rs` 的 `setup()` 入口和第一次 WebSocket 连接成功处加 `Instant::now()` 时间戳，输出到日志，对比 before/after。

**指标**：
- 5 终端时 RSS（before vs after，期望降 50%+）
- 冷启动到可交互的时间（期望降 1-2s）

---

## 八、Batch F — Benchmark 自动化对比

### 新增脚本

**`scripts/benchmark/compare.ts`**：
```ts
// Usage: bun run scripts/benchmark/compare.ts [bundle|store|polling|memory] [baseline_ref] [after_ref]
// Default baseline_ref = HEAD~1, after_ref = HEAD
//
// 流程：
// 1. git stash --include-untracked -m "benchmark-compare"
// 2. git checkout <baseline_ref>
// 3. 运行指定 benchmark 脚本，结果存 .benchmark-baseline.json
// 4. git checkout <after_ref>
// 5. 运行指定 benchmark 脚本，结果存 .benchmark-after.json
// 6. 生成 diff 表（百分比变化、绝对值），追加到 docs/perf-optimization-results-v2.md
// 7. git stash pop
```

**保证**：
- 失败时自动 `git stash pop` 恢复工作区
- 用 try-finally 包裹整个流程
- 输出格式与 v1 results 文档对齐

### 目录结构

```
scripts/
  benchmark.ts                  # v1 现有入口（保留）
  benchmark/
    bundle.ts                   # Batch A
    polling.ts                  # Batch C
    store.ts                    # Batch B
    memory.ts                   # Batch D
    compare.ts                  # Batch F 自动化对比
    _common.ts                  # 共享工具：写 markdown、跑 puppeteer
```

---

## 九、执行顺序与时间预估

| 阶段 | 内容 | 估时 | 依赖 |
|---|---|---|---|
| 0 | 写 `compare.ts` + `_common.ts` 骨架 | 0.5h | — |
| 1 | Batch A 实现 + bundle.ts benchmark | 1.5h | 0 |
| 2 | Batch E 实现 + build 验证 | 0.5h | — |
| 3 | Batch C 实现 + polling.ts benchmark | 1h | 0 |
| 4 | Batch B 实现 + store.ts benchmark | 2h | 0 |
| 5 | Batch D 实现 + memory.ts benchmark | 2.5h | 0 |
| 6 | 整体回归（bun test + 手动） | 0.5h | 1-5 |
| 7 | 更新 results-v2.md + push | 0.5h | 6 |

**总计 ~9 小时**。每批结束 commit 一次，最后整体 push。

---

## 十、风险预案

| 风险 | 应对 |
|---|---|
| Batch B 改 sessions 数据结构遗漏读路径 | 先 `grep -rn "sessions\[" desktop/src` 列出所有点，做完后用 `bun run typecheck` 双重保险 |
| Batch D 终端 buffer 序列化丢失 | xterm 的 `buffer.active.getLine(i).translateToString()` 遍历可行；不行就降级为"只限并发不卸载" |
| Batch A lazy 后 Suspense fallback 闪烁 | fallback 用现有 `<TabSkeleton />`，至少 200ms 平滑 |
| Benchmark 数字浮动大 | 每个跑 3 次取中位数，写入 results 时标 `±X%` |
| 改动证明无收益甚至负优化 | 保留 commit 但在 results 标记，必要时 revert |
| Windows 路径 / 行尾符问题 | git config core.autocrlf 已就绪，benchmark 输出路径用 `path.posix.join` 规范化 |

---

## 十一、产出文档

- 本文档：`docs/perf-optimization-plan-v2.md`（实施计划，本文件）
- 结果文档：`docs/perf-optimization-results-v2.md`（每批完成后追加，由 benchmark 脚本自动写入）
- 老文档保留：`perf-optimization-report.md`（v1 审计）、`perf-optimization-plan.md`（v1 计划）、`perf-optimization-results.md`（v1 结果）

---

## 十二、待用户确认（已完成）

- [x] Batch D 终端方案选 A（保守，限并发 5）
- [x] #7 handleTeamCreated 用指数退避
- [x] 做自动化对比脚本

确认完成，进入实施阶段。
