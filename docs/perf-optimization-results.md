# DreamCoder Performance Optimization Results

> Branch: `perf/optimization-report` | Date: 2026-05-29

## Benchmark Results

### Branch Comparison

Measured on Windows 10, Bun 1.3.7, 594 session JSONL files.

| Metric | Baseline (dev) | Optimized (perf) | Delta |
|--------|---------------|-------------------|-------|
| Tools module import (`src/tools.ts`) | 921ms | 919ms | -0.2% |
| Sidecar binary size | 118.4 MB | 118.4 MB | +0.0% |

> Module import: lazy `require()` 的优势主要体现在 CLI 冷启动首次加载，后续调用因 Bun 的 require 缓存差异趋近。需要在真实 `bun run ./bin/dreamcoder` 冷启动场景测量。

### Pattern Validation

| Optimization | Before | After | Improvement |
|-------------|--------|-------|-------------|
| Session metadata cache | 2.02s (cold: stat + parse 594 JSONL) | 81ms (warm: stat only) | **24.8x** |
| Elapsed timer external hook | 10.91ms (in-store, 100K updates) | 6.74ms (external, 100K updates) | **1.6x** fewer re-renders |
| Markdown useDeferredValue | 105µs sync (blocks main thread) | yields via setTimeout | main thread stays responsive |
| Pipe transport | 16.77ms JSON serialize (50K msgs) | 24.99ms JSON + encode (50K msgs) | +49% per-msg overhead, but eliminates WebSocket double-hop |

### Key Takeaway

**Session metadata cache** 是收益最大的优化 — 594 个会话文件从 2s 降到 81ms，用户体验直接改善（打开会话列表速度）。

---

## Optimization Summary

### Phase 1: Quick Fixes (1-2 days) — ✅ Complete

| # | Optimization | Status | Commit |
|---|-------------|--------|--------|
| 1.1 | PTY read buffer 8KB → 32KB | ✅ | `edf968f` |
| 1.2 | `allUserMessages` cap at 3 | ✅ | `edf968f` |
| 1.3 | Team member poll in-flight guard | ✅ | `edf968f` |
| 1.4 | Tool modules lazy import | ✅ | `8626e85` |
| 1.5 | `terminal_environment()` OnceLock cache | ✅ | `edf968f` |
| 1.6 | Remove unused `reqwest` dependency | ✅ | `edf968f` |

### Phase 2: Rust Layer (2-3 days) — ✅ Complete

| # | Optimization | Status | Commit |
|---|-------------|--------|--------|
| 2.1 | Window state persistence debounce (500ms) | ✅ | `57c60a4` |
| 2.2 | Sidecar startup async (thread::spawn) | ✅ | `57c60a4` |
| 2.3 | Terminal sessions → DashMap | ❌ Not feasible | `0ab98a7` (reverted) |

> 2.3 不可行原因: `TerminalSession` 包含 `Box<dyn MasterPty + Send>`，不满足 `Sync` trait bound，DashMap 要求 `Send + Sync`。

### Phase 3: Frontend (5-7 days) — ✅ Complete

| # | Optimization | Status | Commit |
|---|-------------|--------|--------|
| 3.1 | Elapsed timer → external hook | ✅ | `8636592` |
| 3.2 | chatStore granular selectors | ✅ | `8636592` |
| 3.3 | Markdown useDeferredValue | ✅ | `8636592` |

### Phase 4: Server Core (5-7 days) — ✅ Partial

| # | Optimization | Status | Commit |
|---|-------------|--------|--------|
| 4.1 | Session metadata cache (mtime-based) | ✅ | `563ffcf` |
| 4.2 | Query loop merge traversal | ❌ Not feasible | — |

> 4.2 不可行原因: `microCompact` 和 `applyToolResultBudget` 内部多次遍历有显式顺序依赖，无法安全合并为单次遍历。

### Phase 5: Architecture (10-15 days) — ✅ Partial

| # | Optimization | Status | Commit |
|---|-------------|--------|--------|
| 5.1 | CLI↔Server pipe transport | ✅ | `23f6fdd` |
| 5.2 | Binary protocol (msgpack) | ⏸ Deferred | — |

> 5.2 暂缓原因: 投入产出比低 — 消息体积小、JSON 开销低、增加调试难度。通过 `DREAMCODER_USE_PIPE_TRANSPORT=1` 环境变量启用 pipe transport。

---

## Files Changed

### Rust Layer
- `desktop/src-tauri/src/lib.rs` — PTY buffer, window debounce, sidecar async, terminal env cache
- `desktop/src-tauri/Cargo.toml` — removed `reqwest`

### TypeScript Server
- `src/tools.ts` — lazy require() with caching getters
- `src/server/ws/handler.ts` — allUserMessages cap
- `src/server/services/sessionService.ts` — metadata cache
- `sidecar/src/server/services/sessionService.ts` — synced
- `sidecar/src/server/ws/handler.ts` — synced

### TypeScript Frontend
- `desktop/src/hooks/useElapsedTimer.ts` — new file
- `desktop/src/stores/chatStore.ts` — removed elapsedTimer
- `desktop/src/stores/teamStore.ts` — in-flight guard
- `desktop/src/components/chat/MessageList.tsx` — granular selectors
- `desktop/src/components/chat/StreamingIndicator.tsx` — useElapsedTimer
- `desktop/src/components/markdown/MarkdownRenderer.tsx` — useDeferredValue

### Transport
- `src/cli/transports/PipeTransport.ts` — new file
- `src/cli/transports/transportUtils.ts` — pipe: protocol support
- `src/server/services/conversationService.ts` — pipe read/write

---

## How to Run Benchmarks

```bash
# From project root
bun run scripts/benchmark.ts

# Custom paths
bun run scripts/benchmark.ts <baseline_dir> <optimized_dir>
```

## How to Build

```bash
bun install
cd desktop && bun install
bun run build:sidecar
cd desktop && bun run build:windows-x64
```

## Rollback Strategy

Each phase is an independent commit. To rollback:

```bash
git revert <commit-hash>
```

Phase 5.1 (pipe transport) retains the old WebSocket path as fallback — no `DREAMCODER_USE_PIPE_TRANSPORT` env var = original behavior.
