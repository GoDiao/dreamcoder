# E 维度：Agent 循环与核心动作执行

场景：headless 运行，第三方模型经 OpenAI 兼容 chat-completions 接入（Codex：`codex exec` + 自定义 provider + 未知 slug；ZCode：`--prompt` + `openai-chat-completions`；DreamCoder：服务器启动的 `--print` CLI + 本地代理 `openai_chat`，`feature()` 全 false，GrowthBook 关闭）。

路径约定：`codex:` 相对 `refs/coding-agents/codex/codex-rs`；`zcode:` 相对 `refs/coding-agents/zcode/apps/zcode-cli/packages`；DreamCoder 相对仓库根。

关键结论做过二次核对（DreamCoder 截断续写文案 `src/query.ts:1211-1215`；ZCode 重复调用阈值 `zcode:core/src/runtime/helpers/model-anomaly.ts:23-60`；Codex 未知模型不声明 apply_patch `codex:core/src/tools/spec_plan.rs:1409` + `codex:models-manager/src/model_info.rs:124`），均与源码一致。

---

## 1. 结论

1. **编辑的容错差距最大。** 同样是字符串替换，ZCode 在精确匹配失败后依次尝试 7 种回退（引号、行号前缀、转义、`\u` 转义、逐行 trim、公共缩进、首尾锚定+相似度 0.8）；DreamCoder 只有弯引号归一和一张「反净化」替换表，不处理空白、缩进、行号前缀、转义。Codex 用补丁格式，四遍逐行匹配（精确 → 忽略行尾空白 → 忽略两端空白 → Unicode 标点归一）。
2. **DreamCoder 与 ZCode 都强制 read-before-edit 和过期检查，文案逐字相同；Codex 没有这两项前置条件。** 在「找到函数、改一行」这类任务里，DreamCoder/ZCode 至少多一次 Read 往返；Codex 可以用 `rg -n -C` 一次拿到上下文后直接打补丁。
3. **Codex 在本场景的编辑入口很脆弱。** apply_patch 不作为工具声明，模型必须在 `exec_command` 里写恰好一条 `apply_patch <<'EOF' … EOF` 才会被拦截；回退 prompt 只有一行格式说明，而且示例是 exec_command 无法表达的 argv 数组形式；只给补丁正文时的报错又让模型「Rerun as ["apply_patch", "<patch>"]」。补丁语法本身没有在 prompt 中说明（推断：对非 OpenAI 模型是格式错误的主要来源）。另外，v0.164.0 已不支持 `wire_api = "chat"`，纯 chat-completions 端点无法直接接入（`codex:model-provider-info/src/lib.rs:102-135`）。
4. **循环结束条件三家相同：响应里没有工具调用就结束。** 都没有默认的步数/轮数上限；都没有对「只有推理、没有文本」的专门处理。ZCode 额外有可疑空响应判定（无文本、无工具、零 usage → 可重试错误），DreamCoder 与 Codex 把空响应当作正常结束。
5. **只有 ZCode 有重复调用防护**：同名同参连续 3 次插入提醒（只提醒不拦截，每回合最多 3 次）。DreamCoder 与 Codex 未找到任何重复调用检测。ZCode 还有「静默 5 次响应提醒向用户汇报」。
6. **工具并行：Codex 和 ZCode 在流式过程中就开始执行，DreamCoder 在本场景下要等整个响应结束。** DreamCoder 的流式工具执行受 GrowthBook 门控，GrowthBook 关闭时为 false。Codex 对可并行工具不设数量上限；ZCode 与 DreamCoder 上限 10。
7. **读取上限：DreamCoder 与 ZCode 常量相同（256KB、25,000 token、描述写 2000 行但代码不按行截断），但超 token 时行为不同**：ZCode 首次整文件读取返回部分视图，DreamCoder 直接报错，模型要再发一次带 offset/limit 的请求。DreamCoder 每次 Read 结果末尾还附约 330 字符的恶意软件提醒，另两家没有。
8. **Shell 超时语义：Codex 不杀进程，10 秒后交回 session ID 由模型轮询；ZCode 与 DreamCoder 默认 120 秒，到时自动转后台并承诺完成后通知。** 输出上限：Codex 约 10,000 token/字节，ZCode 30KB 尾部预览，DreamCoder 30,000 字符。
9. **规划工具：Codex 不注册 `update_plan` 但 prompt 仍描述它；ZCode 的 TodoWrite 描述只有 3 行、不鼓励主动使用；DreamCoder 在应用里启用 4 个 Task 工具（约 8K 字符描述），描述要求「3 步以上主动使用」、开始前标 in_progress、完成后立即标 completed。** 这是 DreamCoder 在普通小任务上额外工具调用和往返的主要来源（推断）。
10. **子 agent：Codex 明文禁止未经要求就委派；ZCode 鼓励「需要跨多个文件阅读」时委派；DreamCoder 鼓励「超过 3 次查询」时用 Explore（模型为 provider 的 fastModel）。** DreamCoder 与 Codex 子 agent 都不能再嵌套（深度 1）。

---

## 2. 逐项对比

### 2.1 循环

| | Codex | ZCode | DreamCoder |
|---|---|---|---|
| 结束条件 | 无工具调用且无待处理输入 | 无可执行工具调用 | 流中未出现 tool_use |
| 步数/轮数上限 | 无（未找到） | 主循环无（未找到） | 无（`--max-turns` 服务器不传） |
| 输出截断（length） | 走流错误重试（未逐条核实） | 续写提示，最多 3 次 | 续写提示，最多 3 次 |
| 空响应 | 正常结束 | 零 usage 时报可重试错误 | 正常结束 |
| 只有推理 | 正常结束 | 正常结束（推断） | 正常结束 |
| 重复调用防护 | 无 | 连续 3 次同参提醒 | 无 |
| Stop hook / 完成校验 | Stop hook 可续跑；goal 需显式要求 | Stop hook 续跑 ≤3 次；target 模式需显式入口 | Stop hook 可续跑；无完成校验 |

- Codex：`run_turn` 循环（`codex:core/src/session/turn.rs:460`），`needs_follow_up` 来自工具调用、`end_turn == Some(false)` 或待处理用户输入（`turn.rs:609, 3028-3030`）；为 false 时跑 Stop hook（`turn.rs:725`），hook 要求续跑则追加 prompt 并继续（`turn.rs:742-759`），否则 break（`turn.rs:830`）。上下文超限时自动压缩后继续（`turn.rs:664-705`）。`ResponseIncomplete` 走 `handle_response_stream_error` 重试，次数 `stream_max_retries`（`turn.rs:1743, 1810-1835, 2850-2870`）；各 incomplete 原因的处理未核实。goal 工具描述要求「do not infer goals from ordinary tasks」（`codex:ext/goal/src/spec.rs:~33`）。
- ZCode：`runRegularTurnLoop`（`zcode:core/src/runtime/methods/turn-loop.ts:56-57`），无工具调用时 `finishModelStepWithoutToolCalls`（`turn-stop.ts:167`）先处理中途追加的用户消息，再跑 Stop hook，续跑上限 3（`runtime/methods/hooks.ts:14, 232-241`）。截断续写文案与 DreamCoder 逐字相同，3 次后抛 `The model's response exceeded the output token maximum.`（`runtime/methods/turn-output-token-continuation.ts:20-41, 175-178`）。可疑空响应：`Model returned no text, no tool calls, and no usage before completing the turn.`，标 retryable（`runtime/helpers/model-errors.ts:114-131`；`turn-model-step.ts:690-713`）。重复调用提醒：`You have called X with the same input 3 times in a row. Do not repeat the exact same tool call again ...`，只在连续次数恰好等于阈值时触发（`runtime/helpers/model-anomaly.ts:23-60, 98-105`；注入点 `turn-tool-warnings.ts:52-70`）。静默提醒：连续 5 次模型响应没有可见文本时插入「The user hasn't heard from you in a while ...」，每段最多 3 次（`runtime/helpers/runtime-reminders.ts:105-160`）。每次收集输入附件时追加 runtime context、ToolSearch、agent 清单、skills、runtime_mode、todo 提醒、token 预算、output_style 等（`turn-loop.ts:240-343`），字节数未测。
- DreamCoder：`src/query.ts` 的 `while (true)`，退出信号是流中是否出现 tool_use（`src/query.ts:555-559, 835, 1050`）。默认无轮数上限：`maxTurns` 只来自隐藏选项 `--max-turns`（`src/main.tsx:969`），服务器不传（`src/server/services/conversationService.ts:142-156`；`src/query.ts:1680`）。截断：代理把 `finish_reason: length` 映射为 `max_tokens`（`src/server/proxy/transform/openaiChatToAnthropic.ts:74`）→ 合成 `max_output_tokens` 错误（`src/services/api/claude.ts:2316-2327`）→ 提升输出上限的分支依赖 GrowthBook，本场景不走（`src/query.ts:1183-1209`）→ 追加 meta 用户消息续写，最多 3 次（`src/query.ts:1165, 1211-1240`）。空响应：代理对空 choice 造一个空文本 end_turn（`openaiChatToAnthropic.ts:93-104`），视为正常结束（`claude.ts:2390-2404`）。Stop hook：blockingError 时把 hook 输出作为 meta 消息追加并继续，`preventContinuation` 则结束（`src/query.ts:1266-1294`；`src/query/stopHooks.ts`）。

### 2.2 工具执行

| | Codex | ZCode | DreamCoder |
|---|---|---|---|
| 何时开始执行 | 每个调用在流中完成即派发 | 流中执行只读、并发安全、无需审批的工具；其余流结束后 | 流结束后（流式执行被 GrowthBook 门关闭） |
| 并发上限 | 可并行工具无上限（读写锁） | 10 | 10 |
| 可并行的工具 | exec_command、view_image；apply_patch 独占 | Read/Glob/Grep/TodoRead/Agent；Edit/Write/Bash 串行 | 相邻的「并发安全」调用成批；其余串行 |
| 结果顺序 | 流结束后按序收集 | 按 blockIndex 排序 | 按调用顺序 |
| 错误形态 | 纯文本，`success:false` | `<tool_use_error>…</tool_use_error>` | `<tool_use_error>…</tool_use_error>` + `is_error` |
| 未知工具 | `unsupported call: <name>` | 未细查 | `Error: No such tool available: X` |
| 需审批的调用（headless） | 策略 Never，直接拒绝 | deny broker 直接拒绝 | 应用里转发给桌面端等待 |
| 向用户提问 | 拒绝：`request_user_input is not supported in exec mode` | 拒绝：`No permission client configured for <tool>` | 转发给桌面端等待 |

- Codex：`handle_output_item_done` 构造 future，`tokio::spawn` 执行（`codex:core/src/stream_events_utils.rs:~345-372`；`codex:core/src/tools/parallel.rs:201`）；读写锁分配（`parallel.rs:213-217`）；`exec_command` 声明可并行（`codex:core/src/tools/handlers/unified_exec/exec_command.rs:135`），apply_patch handler 默认不可并行（`codex:tools/src/tool_executor.rs:122`）。错误输出（`parallel.rs:338-384`；`codex:core/src/tools/registry.rs:963-966`）。exec 审批策略固定 Never（`codex:exec/src/lib.rs:591`），`request_user_input` 与文件变更审批被拒（`exec/src/lib.rs:2122-2143`）；需要提权时返回「approval policy is Never; reject command — you cannot ask for escalated permissions ...」（`exec_command.rs:~330`）。
- ZCode：`ToolScheduler` 并发 10，判定规则（`zcode:core/src/tool/scheduler.ts:45, 90-185`）；流中执行条件 `modelStreaming === "on"`（headless 为 on，`zcode:cli/src/prompt-command.ts:270`）且 `streamingToolExecution` 默认 `readOnly`（`runtime/methods/streaming-tool-coordinator.ts:383-406`）；排序（`runtime/methods/turn-tools.ts:47-57`）。错误措辞与 DreamCoder 同一套（`tool/input-validation-model-content.ts:12-68`；`tool/executor/errors.ts:44-58`）。`zcode -p` 默认 yolo（`zcode:cli/src/run.ts:52`），但判为 ask 的调用经 deny broker 拒绝（`permission/broker.ts:22-37`；`permission/service.ts:121-150`；`prompt-command.ts:250-253`；`tool/executor/errors.ts:136-160`）。
- DreamCoder：流式执行门 `tengu_streaming_tool_execution2`（`src/query/config.ts:33`），GrowthBook 无 clientKey 时关闭（`src/services/analytics/growthbook.ts:173, 422-427, 819-821`），所以由 `runTools` 在响应结束后执行（`src/query.ts:1368-1370`）。并发上限 `CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY` 默认 10（`src/services/tools/toolOrchestration.ts:8-112`）。错误类型（`src/services/tools/toolExecution.ts:402, 474-482, 671, 724`）。权限拒绝返回 is_error 的 tool_result（`toolExecution.ts:1030-1040`），文案见 `src/utils/messages.ts:217-241`。应用用 `--sdk-url` 强制 stdio 权限提示并转发服务器（`src/cli/print.ts:851-853, 4315-4317`）；无人响应时是等待而不是自动拒绝（推断）。

### 2.3 编辑文件

| | Codex | ZCode | DreamCoder |
|---|---|---|---|
| 接口 | exec_command 里写 `apply_patch <<'EOF'` | Edit(file_path, old_string, new_string, replace_all) + Write | 同 ZCode |
| 描述长度 | prompt 一行 | Edit 约 380 字符 | Edit 约 1.2K 字符 |
| read-before-edit | 无 | 有 | 有 |
| 过期检查 | 无 | mtime 前进或大小变化 | mtime 前进且内容不同 |
| 匹配遍数 | 4 遍逐行 + 末尾空行回退 | 精确 + 7 回退 | 精确 + 弯引号；接收时反净化 |
| 歧义处理 | 不拒绝，取游标后第一个 | 拒绝 | 拒绝 |
| 失败提示是否带文件实际内容 | 否 | 否 | 否 |
| 成功返回 | 文件列表 A/M/D，约 100–200 字符 | 一句话 + 「不要读回」 | 一句话，约 60–100 字符 |
| 行尾 | 逐行保留 | 保留 | Edit 保留；Write 固定 LF |
| 格式化器 | 无 | 无 | 无 |

**Codex**
- 入口：未知模型 `apply_patch_tool_type: None`，不注册 apply_patch（`codex:models-manager/src/model_info.rs:124`；`codex:core/src/tools/spec_plan.rs:1409`）。`exec_command` 执行前调用 `intercept_apply_patch`（`codex:core/src/tools/handlers/unified_exec/exec_command.rs:358-372`；`codex:core/src/tools/handlers/apply_patch.rs:435-475`）。识别只接受脚本中唯一顶层语句 `apply_patch <<'EOF' … EOF`，可带 `cd <path> &&` 前缀（`codex:apply-patch/src/invocation.rs:274-300`）。exec_command 只有字符串参数 `cmd`（`codex:core/src/tools/handlers/shell_spec.rs:33-36`）。
- prompt：回退 prompt 只有一行，示例为 argv 数组 `{"command":["apply_patch","*** Begin Patch..."]}`（`codex:models-manager/prompt.md:132`），全文只出现一次 `Begin Patch`，没有补丁语法说明。
- 只给补丁正文时：`patch detected without explicit call to apply_patch. Rerun as ["apply_patch", "<patch>"]`（`codex:apply-patch/src/lib.rs:86-90`；`invocation.rs:146-157`）。写成 `apply_patch '<patch>'`（带引号参数）不会被拦截，会作为普通命令执行 PATH 中的 apply_patch 别名（`codex:arg0/src/lib.rs:138-145, 300-310`）（推断：能改文件，但绕过补丁事件与审批路径）。
- 解析宽松，接受外层 heredoc 包裹（`codex:apply-patch/src/parser.rs:47-53, 225-290`）。
- 匹配：每个 hunk 从上一个 hunk 结束处向后找（`codex:apply-patch/src/file_update.rs:95-150`）。`seek_sequence` 四遍：精确；`trim_end`；`trim`；trim 后把 Unicode 连字符、弯引号、各种空格归一为 ASCII（`codex:apply-patch/src/seek_sequence.rs:12-110`）。模式末尾空行找不到时去掉再找（`file_update.rs:107-123`）。`@@ <context>` 行先单独定位（`file_update.rs:69-82`）。
- 失败：`apply_patch verification failed: Failed to find expected lines in <path>:\n<old lines>` 或 `Failed to find context '<ctx>' in <path>`（`apply_patch.rs:463-467`；`file_update.rs:80-82, 154-158`）。整份补丁先校验，失败不写任何文件。
- 成功：`Success. Updated the following files:` + `A/M/D <path>`（`codex:apply-patch/src/lib.rs:826-840`），外层套 exec 输出头（`codex:core/src/tools/context.rs:524-548`）。prompt 要求不要重读已改文件（`prompt.md:143`）。
- 行尾按行保留（`codex:apply-patch/src/text_file.rs:14-46`；`file_update.rs:125-140`）。

**ZCode**（`zcode:core/src/tool/`）
- 校验顺序（`handlers/edit.ts:105-245`）：old==new → 空路径 → 文件不存在（old_string 为空则创建；否则提示 cwd 并给同名不同扩展名或编辑距离 ≤3 的建议，`edit.ts:354-389`）→ >1GB → 统一行尾为 LF → old_string 空但文件非空 → .ipynb → 未读过/部分视图：`File has not been read yet. Read it first before writing to it.`；过期：`File has been modified since read, either by the user or by a linter. Read it again before attempting to write it.`（整毫秒 mtime 前进或大小变化；完整读过且内容相同则放行，`edit.ts:425-470`）→ 匹配。
- 匹配（`tool/edit-matchers.ts:41-68`），精确后依次：quote_normalized；line_number_prefix_stripped（每行都带 `N: ` 或 `N\t` 才剥，`:253-263`）；escape_normalized（`\n \t \r \" \' \` \\ \$`，new_string 同样反转义，`:75-80, 265-284`）；unicode_escape_normalized；line_trimmed；indentation_flexible（≥2 行）；block_anchor（≥3 行，首尾行 trim 相等、中间行平均相似度 ≥0.8，`:204-220, 323-340`）。replace_all 时跳过后三种宽松匹配（`:25-29, 62`）。第一个有候选的策略即被采用。
- 歧义：同一策略的候选实际文本不唯一，或实际文本出现多次且未 replace_all，报 `Found N matches of the string to replace, but replace_all is false ...`（`edit.ts:216-231, 641-646`）。
- 找不到：`String to replace not found in file.\nString: <old_string>`（`edit.ts:210-214`），与 DreamCoder 逐字相同。
- 宽松匹配命中后 new_string 原样写入，不按文件实际缩进调整（推断：模型 new_string 缩进错时写入的也是错的）。
- 成功：`The file X has been updated successfully. (file state is current in your context — no need to Read it back)`（`edit.ts:53-77`）；结果给模型的上限 100KB（`edit.ts:281-289`）。保留编码与行尾（`edit.ts:509-515`）。Write 描述约 230 字符，同样的未读/过期检查，保留原行尾（`handlers/write.ts:37-64, 109, 131`）。

**DreamCoder**（`src/tools/FileEditTool/`）
- 接收时（解析模型输出阶段，`src/utils/messages.ts:2798` → `src/utils/api.ts:622-645` → `utils.ts:581-662`）：new_string 每行去尾部空白（.md/.mdx 除外）；old_string 精确找不到时套用 18 项反净化表（`<fnr>`、`<n>`、`\n\nH:` 等，`utils.ts:531-550`），同样替换应用到 new_string。
- validateInput 顺序（`FileEditTool.ts:138-345`）：old==new → deny 规则 → >1GiB（`:85`）→ 读入并 CRLF→LF → 文件不存在（附 Did you mean）/ old_string 空但文件非空 → .ipynb → 未读过或部分视图（code 6）→ 过期（code 7，文案同 ZCode）→ 精确匹配，失败再弯引号归一（`utils.ts:73-96`）→ 找不到（code 8：`String to replace not found in file.\nString: <old_string>`）→ 多处匹配（code 9）。
- call 阶段再查一次过期，失败抛 `File has been unexpectedly modified. Read it again before attempting to write it.`（`FileEditTool.ts:445-470`；`constants.ts:10-11`）。new_string 为空且后接换行时连换行一起删（`utils.ts:218-229`）。保留编码（utf8/utf16le）与行尾（`src/utils/fileRead.ts:87-96`；`src/utils/file.ts:84-98`）。
- 成功：`The file <path> has been updated successfully.`（`FileEditTool.ts:555-575`）。没有「不要读回」提示。
- Write：已存在文件要求读过且未改（`src/tools/FileWriteTool/FileWriteTool.ts:199-219`）；content 每行去尾空白（非 md，`src/utils/api.ts:646-660`）；固定写 LF（`FileWriteTool.ts:307`）；返回 `File created successfully at: <path>` 或 `The file <path> has been updated successfully.`（`:426, 432`）。
- 读过的文件被外部修改后，下一次请求附 `edited_text_file` 附件（`src/utils/attachments.ts:862, 2047-2102`）。

**每种失败的额外模型往返（推断，按典型行为计）**

| 失败 | Codex | ZCode | DreamCoder |
|---|---|---|---|
| 未读就编辑 | 不适用 | +2（Read，再 Edit） | +2 |
| 读后文件被改（过期） | 不适用 | +2 | +2 |
| old_string / 上下文不匹配（空白、缩进、行号前缀、转义造成） | 多数被 4 遍匹配吸收；否则 +1~2 | 多数被 7 回退吸收；否则 +1~2 | +1（凭记忆改）或 +2（重读再改） |
| 多处匹配 | 不报错（可能改错位置） | +1 | +1 |
| 调用形式错误（apply_patch 没写成 heredoc） | +1~2 | 不适用 | 不适用 |

### 2.4 读取与搜索

| | Codex | ZCode | DreamCoder |
|---|---|---|---|
| 专用工具 | 无，用 shell | Read/Grep/Glob | Read/Grep/Glob |
| 行号格式 | 无 | `N\t内容` | `N\t内容` |
| 默认读取范围 | 由命令决定 | 整文件（描述写 2000 行） | 整文件（描述写 2000 行） |
| 字节上限 | 输出 10,000 字节/token | 256KB（未给 limit 时） | 256KB（未给 limit 时） |
| token 上限 | — | 25,000，首次整读超限给部分视图 | 25,000，超限报错 |
| 重复读未改文件 | 无去重 | 「Wasted call — file unchanged ...」 | 「File unchanged since last read ...」 |
| 每次结果附加文字 | 输出头 | 无 | 约 330 字符恶意软件提醒 |
| Grep 默认 | — | files_with_matches | files_with_matches，head_limit 250，2 万字符 |

- Codex：读取靠 `cat`/`sed -n`/`rg`；exec 输出预算默认 10,000 token（`codex:core/src/unified_exec/mod.rs:74`），回退模型截断策略 10,000 字节（`codex:models-manager/src/model_info.rs:126`），截断时加 `Warning: truncated output (original token count: N)`（`codex:core/src/tools/context.rs:519-521`）。
- ZCode：常量 256KB / 25,000 / 2,000（`zcode:contracts/src/tools/read.ts:15-17`）；2,000 只用于描述和附件（`zcode:core/src/runtime/helpers/attachments.ts:307`；`zcode:core/src/tool/handlers/read.ts:72`）。超 token 的首次整读返回前若干行，提示放在批次后附件中（`zcode:core/src/tool/handlers/read-text.ts:150-200`）；带 offset/limit 超限才报错。超 256KB 报错，文案与 DreamCoder 相同（`zcode:adapters/src/fs/text-range-reader.ts:41-43`）。去重文案（`read-text.ts:17-18`；`read.ts:207-210`）。描述写明「Do NOT re-read a file you just edited to verify」（`read.ts:78`）。Glob 100 条/100KB（`zcode:core/src/tool/handlers/glob.ts:20-21`）；Grep 默认 files_with_matches（`grep.ts:29, 203`）。
- DreamCoder：确认上限为 256KB（`src/utils/file.ts:48`；`src/utils/readFileInRange.ts:63, 96-101`，仅在未给 limit 时检查，`src/tools/FileReadTool/FileReadTool.ts:1017-1025`）与 25,000 token（`src/tools/FileReadTool/limits.ts` `DEFAULT_MAX_OUTPUT_TOKENS`；`FileReadTool.ts:176-183, 753-770`）。报错文案都要求「Use offset and limit parameters to read specific portions of the file, or search for specific content」，模型下一步是带 offset/limit 重读或改用 Grep，+1 往返。描述默认不提 256KB（`includeMaxSizeInPrompt` 来自 GrowthBook，`FileReadTool.ts:347-349`）。估算超过 6,250 token 时调用 count_tokens API；代理只接 `/proxy/v1/messages`（`src/server/proxy/handler.ts:11-17`），调用失败返回 null 后用估算值（`src/services/tokenEstimation.ts:192-198`）（推断：每次大文件读取多一次失败的本地 HTTP 请求）。2,000 行只用于描述和附件（`src/tools/FileReadTool/prompt.ts:37`；`src/utils/attachments.ts:3137`）。去重仅对同 offset/limit、mtime 未变的 Read 生效（`FileReadTool.ts:530-570`），Edit 后的状态不参与去重。恶意软件提醒对 `claude-opus-4-7` 以外的所有模型都附（`FileReadTool.ts:697-698, 727-736`）。Grep head_limit 250、2 万字符（`src/tools/GrepTool/GrepTool.ts:108, 164`）；Glob 100 个（`src/tools/GlobTool/GlobTool.ts:157`）。

### 2.5 Shell

| | Codex | ZCode | DreamCoder |
|---|---|---|---|
| 工具 | exec_command + write_stdin | Bash | Bash |
| 默认等待/超时 | 10 s 后交回 session ID（250–30,000 ms） | 120 s，最大 600 s | 120 s，最大 600 s |
| 到时行为 | 进程继续，模型轮询 | 自动转后台（`sleep` 除外） | 自动转后台（`sleep` 等除外） |
| 完成通知 | 未找到，需轮询（推断） | 通知入队作为新回合；headless 普通后台 Bash 不等待（推断） | task-notification 入队作为下一轮 |
| 交互进程 | `tty=true` + write_stdin | 不支持交互参数 | 不支持 |
| cwd 跨调用 | 不保留，用 `workdir`（推断） | 保留（项目内） | 保留 |
| 子进程环境 | NO_COLOR、TERM=dumb、C.UTF-8、PAGER=cat、CODEX_CI=1 | GIT_EDITOR=true | GIT_EDITOR=true、CLAUDECODE=1 |
| 输出上限 | 10,000 token/字节 | 30KB 尾部预览，全文存 artifact | 30,000 字符；错误时首尾各 5,000 |
| 沙箱（headless） | 由 sandbox_mode/项目信任推导，默认值未核实 | 未核实 | 默认关闭 |

- Codex：`codex:core/src/tools/handlers/shell_spec.rs:20-84`；`codex:core/src/unified_exec/mod.rs:68-77, 170-180`（最多 64 进程；write_stdin 单次最长等待默认 300,000 ms）；`codex:core/src/config/mod.rs:3825-3850, 4067-4070`；环境 `codex:core/src/unified_exec/process_manager.rs:93-104`；输出头 `codex:core/src/tools/context.rs:524-548`。
- ZCode：`zcode:core/src/tool/bash-timeout-policy.ts:6-7`；`tool/handlers/bash-background-policy.ts:3-9`；`bash-model-content.ts:62-75, 139-151`；`bash.ts:200-270, 600-611`；`bash-prompt.ts:13-18`（描述约 1.6K 字符）；`zcode:adapters/src/exec/bash-shell-provider.ts:111`；`zcode:cli/src/headless-workflow.ts:318-331`。
- DreamCoder：`src/utils/timeouts.ts:2-3`；`src/tools/BashTool/BashTool.tsx:307-315, 424, 596-622, 860-971`；`src/utils/shell/outputLimits.ts:3-4`；`src/utils/toolErrors.ts:5-27`；`src/utils/Shell.ts:321-322`；`src/utils/sandbox/sandbox-adapter.ts:530-544`；`src/cli/print.ts:1988-2119`。Bash 描述源文件 21,130 字节（`src/tools/BashTool/prompt.ts`，含 git/PR 说明），实际字符数未测。

### 2.6 子 agent

| | Codex | ZCode | DreamCoder |
|---|---|---|---|
| 工具 | spawn_agent/send_input/wait_agent/resume_agent/close_agent | Agent（+SendMessage） | Agent |
| prompt 态度 | 未经用户/AGENTS.md 明确要求不得委派 | 跨多文件阅读、并行工作时委派 | 匹配 agent 描述时用；超过 3 次查询用 Explore |
| 默认模型 | 继承 | profile 的 modelSelection（默认未核实） | Explore 用 provider fastModel；Plan/general 继承 |
| 默认同步/异步 | 异步线程，wait_agent 取结果 | 前台（同步） | 同步 |
| 结果返回 | wait_agent 返回 | 加框缩进的报告 | 最终文本 + agentId/usage 尾注 |
| 深度/数量 | 深度 1，并发 6 | 未核实（子 agent maxTurns 默认 4，但未找到执行处） | 深度 1（非 ant 禁 Agent），数量未找到上限 |
| 普通编码任务默认委派 | 否 | 可能（「跨多个文件」即鼓励） | 可能（搜索超过 3 次） |

- Codex：Collab 默认开（`codex:features/src/lib.rs:1508-1511`），V1 工具（`codex:core/src/config/mod.rs:1668-1676`）；spawn_agent 描述禁止未经要求的委派（`codex:core/src/tools/handlers/multi_agents_spec.rs:735-737`）；继承模型（`:17`）；深度 1、并发 6（`codex:core/src/config/mod.rs:256, 266`）。
- ZCode：Agent 描述「When to use」段（`zcode:core/src/tool/handlers/agent.ts:92-120`）；报告加 `[Subagent hand-back]` 框并逐行缩进（`agent.ts:122-135`）；子 agent `maxTurns` 默认 4（`zcode:core/src/runtime/methods/subagent.ts:340`），主循环未找到消费 `config.maxTurns` 的代码，是否生效未核实；Explore/general-purpose 提示词（`zcode:core/src/subagent/explore.ts`、`general-purpose.ts`）。
- DreamCoder：非 ant 启用 Explore、Plan（`src/tools/AgentTool/builtInAgents.ts:13-22, 58-65`），Verification agent 也注册（`builtInAgents.ts:24-32, 76-78`），但系统提示里的强制验证段落受 `feature('VERIFICATION_AGENT')` 门控为 false（`src/constants/prompts.ts:~392-394`）。Explore 模型 `haiku`（`src/tools/AgentTool/built-in/exploreAgent.ts:78`），在应用里映射为 provider 的 fastModel（`src/server/services/providerRuntimeEnv.ts:247-248`）。委派指引（`src/constants/prompts.ts:315-320, 375-380`；`EXPLORE_AGENT_MIN_QUERIES = 3`，`exploreAgent.ts:59`）。fork 子 agent 在非交互会话关闭（`src/tools/AgentTool/forkSubagent.ts:32-39`）。子 agent 禁用 Agent（`src/constants/tools.ts:41-55`）。默认同步（`src/tools/AgentTool/AgentTool.tsx:568`）。Agent 工具 prompt 源文件 16,671 字节，内置 agent 定义合计约 40KB（`wc -c`），实际发送字符数未测。

### 2.7 规划与任务跟踪

| | Codex | ZCode | DreamCoder（应用内） |
|---|---|---|---|
| 工具 | 不注册 update_plan | TodoWrite / TodoRead | TaskCreate / TaskGet / TaskUpdate / TaskList |
| 描述大小 | prompt 中有两节描述该工具 | 约 350 字符 | 4 个 prompt 源文件合计 8,024 字节 |
| 使用指引 | prompt 描述何时用 plan，但工具不存在 | 只说明格式，不要求主动使用 | 「3 步以上主动使用」、开始前标 in_progress、完成立即标 completed |
| 提醒 | 无 | 10 回合未用时提醒 | 10 回合未用时提醒 |
| 每次使用开销 | 调用失败一轮（推断） | 全量列表一次调用 | 每个任务至少 create + 2 次 update（推断） |

- Codex：`resolve_update_plan_enabled` 只在配置启用时为 true（`codex:core/src/config/mod.rs:2791-2796`；`spec_plan.rs:1292`）；prompt 仍有 Planning 与 `update_plan` 两节（`codex:models-manager/prompt.md:52-70, 267-275`）。
- ZCode：`zcode:core/src/tool/handlers/todo.ts:137-141`；提醒（`zcode:core/src/runtime/helpers/runtime-reminders.ts:100-103, 252-270`）。
- DreamCoder：服务器给 CLI 设置 `CLAUDE_CODE_ENABLE_TASKS=1`（`src/server/services/conversationService.ts:1052`），于是 Task V2 工具启用、TodoWrite 关闭（`src/utils/tasks.ts:133-139`；`src/tools.ts:218-229`；`src/tools/TodoWriteTool/TodoWriteTool.ts:52-54`）。TaskCreate 描述（`src/tools/TaskCreateTool/prompt.ts`）；系统提示要求「Mark each task as completed as soon as you are done ... Do not batch up」（`src/constants/prompts.ts:270-282`）；提醒间隔（`src/utils/attachments.ts:251-254, 884`）。这些工具 `shouldDefer: true`，但本场景 ToolSearch 关闭，所以描述每次请求都发送（ToolSearch 关闭的依据见 [tools.md](tools.md)）。

### 2.8 推演示例（推断）

任务：「找到函数 `foo` 的定义，改其中一行，运行该测试文件」。假设：仓库不大，`foo` 只定义一次，模型行为符合各自 prompt，编辑一次成功，测试一次通过。

**Codex（4 次往返）**
1. exec_command `rg -n -C3 "foo" ...`（拿到位置和上下文；prompt 鼓励用 rg）
2. exec_command `apply_patch <<'EOF' … EOF`（上下文行来自第 1 步，无需 Read）
3. exec_command 运行测试
4. 最终回复
若模型先 `sed -n` 看更多上下文：+1；若补丁调用形式错（argv 或无 apply_patch）：+1~2。无计划工具。

**ZCode（5 次往返）**
1. Grep（content 模式）定位
2. Read 该文件（Edit 的强制前置；依赖第 1 步的路径，不能合并）
3. Edit
4. Bash 运行测试
5. 最终回复
TodoWrite 描述不要求主动使用，通常不调用。若 old_string 带行号前缀或缩进偏差，回退匹配可吸收，不增加往返。

**DreamCoder（5~7 次往返）**
1. Grep 定位（可能同时 TaskCreate ×3：查找/修改/测试，描述要求 3 步以上主动使用）
2. Read（强制前置；可能同时 TaskUpdate in_progress）
3. Edit（可能同时 TaskUpdate）
4. Bash 运行测试
5. TaskUpdate completed（若未与第 4 步合并则单独一轮）
6. 最终回复
不用任务工具时与 ZCode 同为 5 次；用任务工具且模型按「开始前标 in_progress、完成立即标 completed」逐步执行时为 6~7 次。每次请求都携带全部工具描述（约 64K 字符，见 [tools.md](tools.md)），Read 结果额外附 330 字符提醒。old_string 若带行号前缀或缩进偏差，DreamCoder 不能吸收，+1~2。

---

## 3. 对 DreamCoder 的含义

### DreamCoder 有而另两家都没有

| 差异 | 事实 | 后果（推断） |
|---|---|---|
| 每次 Read 附恶意软件提醒 | 约 330 字符，除 `claude-opus-4-7` 外都附（`src/tools/FileReadTool/FileReadTool.ts:697-736`） | 每次读取多约 80–100 token，并累积进历史；对非 Claude 模型没有对应训练，可能使其对正常代码修改更犹豫 |
| 应用内启用 4 个 Task 工具且描述要求主动、逐项更新 | `src/server/services/conversationService.ts:1052`；`src/constants/prompts.ts:270-282` | 小任务也可能多 1~2 次往返和多次工具调用；4 份描述每次请求都发送 |
| Read 超 25,000 token 直接报错 | `FileReadTool.ts:176-183, 753-770` | 大文件首读必定 +1 往返；ZCode 同常量但返回部分视图 |
| 大文件读取触发 count_tokens 请求 | 代理不接该路径（`src/server/proxy/handler.ts:11-17`） | 一次失败的本地 HTTP 请求，增加延迟，不增加 token |
| 接收时的反净化替换表 | `src/tools/FileEditTool/utils.ts:531-550` | 针对 Claude 输出特性的修正，对第三方模型基本无作用 |

### 另两家都有而 DreamCoder 没有

| 差异 | 事实 | 后果（推断） |
|---|---|---|
| 流式过程中开始执行工具 | Codex 全部、ZCode 只读类（`codex:core/src/stream_events_utils.rs:~345-372`；`zcode:core/src/runtime/methods/streaming-tool-coordinator.ts:383-406`）；DreamCoder 被 GrowthBook 门关闭（`src/query/config.ts:33`） | 不影响 token 和轮数，只影响墙钟时间；与 benchmark 中 Claude Code「运行时间最长」方向一致，但贡献大小未测 |
| 编辑匹配对空白/缩进的容忍 | Codex trim_end/trim/Unicode 归一；ZCode 7 种回退；DreamCoder 只有弯引号 | 第三方模型常见的缩进、行尾空白、带行号前缀、转义错误在 DreamCoder 上都变成失败，每次 +1~2 往返，且需重发整段 old_string |
| 编辑成功后明确告诉模型「不要读回」 | ZCode 成功文案（`zcode:core/src/tool/handlers/edit.ts:59`）、Read 描述（`read.ts:78`）；Codex prompt（`codex:models-manager/prompt.md:143`）；DreamCoder 两处都没有 | 模型可能在编辑后再 Read 验证，+1 往返和一份全文输出 |
| 循环异常保护（在两家中至少一家有） | ZCode 有重复调用提醒、可疑空响应重试、静默提醒；Codex 没有。严格说这不是「两家都有」，单列在此 | DreamCoder 遇到第三方模型重复同一调用时没有任何干预；空响应直接结束回合，headless 运行会以空结果收尾 |

### 三家共同点（不构成差异，但影响判断）

- 都没有默认步数上限；都没有对 reasoning-only 响应的处理；截断续写文案 ZCode 与 DreamCoder 逐字相同。
- 编辑失败文案都不包含文件实际内容或最近似片段，模型要么凭记忆重试，要么重读。

---

## 4. 没有核实的地方

- Codex：`ResponseIncomplete` 各原因（max_output_tokens 等）的具体处理；`codex exec` 无参数时的默认沙箱档；后台进程完成是否有主动通知（只找到轮询路径）；apply_patch 通过 PATH 别名直接执行时是否仍有事件记录；读取文件的编码处理。前提问题：v0.164.0 不支持 chat wire API，本场景是否需要上游提供 Responses 接口。
- ZCode：子 agent `maxTurns`（默认 4）是否在任何地方生效；子 agent 默认模型与嵌套深度；headless 沙箱；`targetCompletionVerification` 默认开关；系统提示中是否另有 TodoWrite 使用指引；每回合输入附件的字节数。
- DreamCoder：工具描述、Agent/Task 描述实际发送的字符数（只测了源文件字节数）；LSP 诊断在 headless 应用模式是否启用；权限请求在桌面端无人响应时的最终行为。
- 所有「额外往返」数字和第 2.8 节的推演都是按 prompt 和代码路径推断，没有运行验证。
