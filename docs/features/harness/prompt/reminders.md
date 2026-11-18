# 文字层评审：会话中途注入的文字（T-INJ）

范围：会话进行中，harness 在用户输入和工具结果之外加进对话的文字。包括全部附件类型（`src/utils/attachments.ts` 产生、`src/utils/messages.ts` 渲染）、追加在工具结果上的文字、harness 合成的消息（中断、拒绝、Stop hook 反馈、续写、恢复会话时插入的消息、压缩后的回填），以及 DreamCoder 服务器和桌面端在用户消息里加的文字（附件、文件引用、侧边对话、看板、跨会话消息、产物）。工具自己的成功或错误文字（T-TOOL）、会话开始时的上下文加载（T-CTX）、system 本身（T-SYS）不在范围内。

场景：桌面端服务器以 `--print` stream-json 启动 CLI（`src/server/services/conversationService.ts:124-158`），环境变量里有 `CLAUDE_CODE_ENABLE_TASKS=1`、`CLAUDE_COWORK_MEMORY_PATH_OVERRIDE`（打开 auto memory）、按设置可能有 Agent Teams 开关（`conversationService.ts:1035-1077`；`src/server/services/agentTeamsEnv.ts:9-15`）；模型是经 OpenAI 兼容端点接入的第三方模型，请求经本地代理（`openai_chat`）；`USER_TYPE` 不是 `ant`，`feature()` 全为 false，GrowthBook 关闭（`checkStatsigFeatureGate_CACHED_MAY_BE_STALE` 在 GrowthBook 关闭时返回 false，`src/services/analytics/growthbook.ts:806-821`）。

路径约定：DreamCoder 相对仓库根，读的是 `main` 的干净检出（`ce209f69`）；`codex:` 相对 `refs/coding-agents/codex/codex-rs`；`zcode:` 相对 ZCode 仓库根 `refs/coding-agents/zcode`（注意：ZCode 核心代码实际在 `apps/zcode-cli/packages/core/src/` 下，见「3. 与已有结论的出入」第 10 条）。

测量方法：

- 在 scratchpad 下写了两个 bun 脚本（`measure.ts`、`measure2.ts`），从 `main` 检出导入 `normalizeAttachmentForAPI`、`wrapCommandText`、`wrapCrossSessionBody`、`getCompactUserSummaryMessage` 和 `CYBER_RISK_MITIGATION_REMINDER`，用空字符串或最小样例填变量字段，把渲染结果里所有文本块的 `length` 相加。`CLAUDE_CONFIG_DIR` 和 `DREAMCODER_CONFIG_DIR` 指向脚本目录下的空目录。
- 数字是 JS 字符串长度（UTF-16 码元，对英文等于字符数），含 `<system-reminder>\n` 和 `\n</system-reminder>` 包装（共 37 字符），不含路径、列表、diff 片段等可变部分，除非另行说明。
- 另两家和少数 DreamCoder 常量用 `node -e` 对字面量取 `length`。
- 没有运行模型，没有对任何提供方发请求；对模型行为的影响都标「推断」。

插入位置（与缓存相关，后文多处引用）：

1. `getAttachments` 在每次用户输入时（带 `input`）和每个工具批次之后（`input` 为 null）各调用一次（`src/query.ts:1555-1564`；`src/utils/attachments.ts:740-985`）。
2. 渲染前 `reorderAttachmentsForAPI` 把附件向上移动，直到碰到 assistant 消息或以 tool_result 开头的 user 消息（`src/utils/messages.ts:1486-1532`）。所以工具批次后的附件紧跟在工具结果后面，用户输入时的附件排在用户这条消息前面。
3. GrowthBook 关闭时走「旧 smoosh」：上一个块是字符串内容的 tool_result、且附件全是文本时，附件文字用 `\n\n` 并进这个 tool_result 的字符串（`messages.ts:2694-2722`，`2628-2662`）；否则作为同一条 user 消息里的文本块，代理把它变成跟在 `role: tool` 消息后面的一条 `role: user` 消息（`src/server/proxy/transform/anthropicToOpenaiChat.ts:107-133`）。
4. 附件都在对话尾部追加，同一进程内后续请求重新渲染时内容不变，不打断前缀。CLI 重启后情况不同，见 T-INJ-02。

## 1. 发现清单

### T-INJ-01 每次读文件都附 340 字符的 Anthropic 恶意软件条款，发给所有非 `claude-opus-4-7` 模型，@ 引用和压缩恢复的文件也带

- 状态：维护者已定（2026-11-18）：对所有模型删除这段条款，包括 Claude。
- 类型：问题
- 严重程度：高
- 体量：每次出现 340 字符。出现在每个有内容的 Read 文本结果、每个 @ 引用的文本文件（桌面端附件和代码引用都走这条路，见 T-INJ-05）、压缩后恢复的每个文件（最多 5 个）。进入历史后随每个后续请求重发。
- 现状（按执行顺序）：
  1. Read 返回文本时，`mapToolResultToToolResultBlockParam` 在行号内容后拼上 `CYBER_RISK_MITIGATION_REMINDER`（`src/tools/FileReadTool/FileReadTool.ts:692-699`），正文是「Whenever you read a file, you should consider whether it would be considered malware ... you MUST refuse to improve or augment the code」（`:727-728`）。
  2. 是否附加只看模型名是否为 `claude-opus-4-7`（`:731-736`）。第三方模型名都不在豁免集合里。
  3. @ 引用的文件由 `generateFileAttachment` 调 `FileReadTool.call`（`src/utils/attachments.ts:3004` 起），渲染时 `createToolResultMessage` 再调同一个映射函数（`src/utils/messages.ts:3639-3666`，`4382-4410`）。实测：内容只有 1 个字符的 @ 引用文件，渲染后 520 字符，其中 340 是这段条款，并且条款自带的 `<system-reminder>` 又被外层 `<system-reminder>` 包住（见 T-INJ-15）。
  4. 压缩后 `createPostCompactFileAttachments` 恢复最近读过的最多 5 个文件，同样经 `generateFileAttachment`（`src/services/compact/compact.ts:1411-1460`），每个都带这段条款。
- 场景：GLM-4.6 修一个 bug，读了 12 个文件，历史里累计 4,080 字符的同一段条款，之后每个请求都带着；没有前缀缓存时每次都按输入计费。用户让它给仓库里的安全扫描器补一条检测规则，或改测试里的漏洞复现脚本，条款里「MUST refuse to improve or augment the code」可能让不熟悉这段文字的模型拒绝修改或反复确认（推断）。这段文字是 Anthropic 针对 Claude 的使用政策，第三方模型有各自的政策，DreamCoder 也没有在 system 里说明这段条款从哪来。
- 参考：Codex 无对应（`codex:core/src` 中搜不到 malware）；ZCode 无对应（`zcode:apps/zcode-cli/packages/core/src` 中搜不到 malware），ZCode 的 @ 文件渲染格式与 DreamCoder 相同但不附条款（`zcode:apps/zcode-cli/packages/core/src/system-reminder/prompt-attachment.ts:60-100`）。
- 改法方向：只对 Anthropic 模型（模型名以 `claude` 开头且走 Anthropic 格式）保留，第三方模型不附。判断放在 `shouldIncludeFileReadMitigation` 一处，Read、@ 引用和压缩恢复自然一起生效。
- 确定程度：代码确认（对模型行为的影响为推断）

### T-INJ-02 CLI 重启后，除排队消息外的所有中途注入文字都从历史里消失，技能清单整份重发，前缀从第一个附件处失配

- 状态：已修复（#270）：transcript 写入所有附件；用户停止后只有这一轮没有因中断结束时才结束 CLI。
- 状态：维护者已定（2026-11-18）：transcript 保留所有附件；用户停止后，只有这一轮没有停下时才结束 CLI。
- 类型：问题
- 严重程度：高
- 体量：每次重启丢失的内容不定（上传的图片和文件、代码引用的整份文件、子目录 CLAUDE.md、压缩后恢复的文件和技能）；每次重启后第一轮再追加一份完整技能清单（上限 = 上下文窗口 token 数 × 4 × 1%，200K 窗口为 8,000 字符，`src/tools/SkillTool/prompt.ts:21-40`）；另加 T-INJ-17 的两条合成消息。
- 现状（按执行顺序）：
  1. 写 transcript 时，非 `ant` 用户的附件只保留 `queued_command`（和一个默认关闭的 hook 例外），其余全部丢弃（`src/utils/sessionStorage.ts:4406-4423`，`4506-4514`）。注释说明这是上游为训练数据隐私加的。
  2. DreamCoder 的服务器经常重启 CLI：
     - 用户点停止：先发 interrupt，3 秒后只要进程还在、代次没变就结束进程，条件里没有判断这一轮是否已经停下（`src/server/ws/handler.ts:862-884`）。
     - 切换模型或进出 `bypassPermissions`：一轮结束后重启（`handler.ts:795-830`，`restartSession` 在 `:814`；`docs/features/session-links/tech-design.md:186`）。
     - 预热后 5 分钟未用：结束进程（`handler.ts:950-970`）。
     - 应用重启。
     - 侧边对话、分叉、回退：从 transcript 文件复制记录（`src/utils/sessionBranching.ts`）。
  3. 新进程以 `--resume` 读 transcript，看到的历史里没有上面这些附件。
  4. 恢复时只有 transcript 里存在 `skill_listing` 附件才会抑制重发（`src/utils/conversationRecovery.ts:395-401`），而这个附件从不写入，所以 `sentSkillNames` 在新进程里为空，第一次收集附件时整份清单重新注入（`src/utils/attachments.ts:2645-2715`）。
  5. 恢复时还会插入 T-INJ-17 的合成消息（`conversationRecovery.ts:206-245`）。
- 场景：用户在桌面端粘一张截图问「这个布局哪里错了」，模型看图后回答并开始改代码；用户中途点停止，3 秒后 CLI 被结束；用户接着说「继续，但别动 header」。新进程的历史里，第一条用户消息只剩文字 `@"/…/uploads/<id>-pasted-image.png" 这个布局哪里错了`，图片没了；之前读入的子目录 CLAUDE.md 内容也没了。尾部又多了一份完整技能清单。对提供方来说，这次请求的消息序列在第一处被删掉的附件那里就和上一次不同，后面整段历史都缓存未命中（推断）。侧边对话从父会话 transcript 分叉，同样看不到父会话里用户上传的文件和图片。
- 参考：ZCode 把所有输入附件写入历史，注释写明「全部写入历史，resume 后前缀不变」（`zcode:apps/zcode-cli/packages/core/src/runtime/methods/turn-loop.ts:281-283`），output_style 提醒也为同样的原因改成每次收集都发并落盘（`:379-381`）。Codex 的上下文片段作为 response item 写入 rollout（推断，未逐一核对）。
- 改法方向：DreamCoder 不上传 transcript，去掉 `isLoggableMessage` 对非 `ant` 附件的过滤，让所有会渲染给模型的附件都写入 transcript。session-links 已经为 `queued_command` 开过同样的例外（`docs/features/session-links/tech-design.md:176`）。恢复时的技能清单抑制随之生效。停止后结束进程的行为属于服务端，交给执行层另行评估。
- 确定程度：代码确认（3 秒结束进程的路径为代码确认，未运行验证；缓存失配为推断）

### T-INJ-03 桌面端拒绝权限时，模型只收到「User denied via UI」，没有「停下等用户」，也没有用户的说明

- 类型：问题
- 严重程度：中
- 体量：18 字符，每次拒绝一次
- 现状（按执行顺序）：
  1. 桌面端拒绝时，服务器回 `{ behavior: 'deny', message: 'User denied via UI' }`（`src/server/services/conversationService.ts:544-575`）。协议里 `permission_response` 只有 `allowed`、`rule`、`updatedInput`，没有说明字段（`src/server/ws/protocol.ts:70-75`）。
  2. CLI 把 `message` 原样放进 `is_error` 的 tool_result（`src/utils/permissions/PermissionPromptToolResultSchema.ts:117-127`；`src/services/tools/toolExecution.ts:1024-1036`）。没有 `interrupt`，这一轮继续。
  3. 终端版在同样情况下用 `REJECT_MESSAGE`：「The user doesn't want to proceed with this tool use ... STOP what you are doing and wait for the user to tell you how to proceed」，带说明时用 `REJECT_MESSAGE_WITH_REASON_PREFIX`（`src/utils/messages.ts:217-220`；`src/hooks/toolPermission/PermissionContext.ts:163-164`）。桌面端两者都没用上。
  4. 拒绝 ExitPlanMode（计划）也是这句话，终端版有专门的 `PLAN_REJECTION_PREFIX`（`messages.ts:225-226`）。
- 场景：默认权限模式下，模型要执行 `rm -rf dist && npm run build`，用户拒绝。模型看到「User denied via UI」，没有被告知停下，可能换成 `npx rimraf dist` 再请求一次，或者改用 Write 达到同样目的（推断）。system 里关于拒绝的说明是「think about why the user has denied the tool call and adjust your approach」（T-SYS 范围），和终端版工具结果里的「STOP ... wait」不一致。
- 参考：ZCode 用户拒绝时给出与 `REJECT_MESSAGE` 相同的文字，用户填了说明就追加「To tell you how to proceed, the user said:」（`zcode:apps/zcode-cli/packages/bootstrap/src/permission-options.ts:8-16`），system 里另有一句「a denied call means the user declined it — adjust, don't retry verbatim」（`zcode:apps/zcode-cli/packages/core/src/context/sections/identity.ts:36`）。Codex 返回「exec command rejected by user」/「patch rejected by user」（`codex:core/src/tools/events.rs:454-457`；`codex:core/src/tools/approvals.rs:431-437`）。
- 改法方向：服务器拒绝时用 CLI 已有的 `REJECT_MESSAGE`（不要在服务器里另写一份字符串）；协议加可选的说明字段，桌面拒绝时可填，有说明就用 `REJECT_MESSAGE_WITH_REASON_PREFIX`；计划被拒用 `PLAN_REJECTION_PREFIX`。改协议要同时改服务器、桌面端和 H5。
- 确定程度：代码确认（模型后续行为为推断）

### T-INJ-04 任务提醒按「内容块」计数，实际 3~5 次请求就触发一次，问答类任务也被推去建任务

- 类型：问题
- 严重程度：中
- 体量：任务列表为空时 517 字符；5 个任务（每个标题 40 字符）时 823 字符。每满 10 个计数单位一次。
- 现状（按执行顺序）：
  1. 服务器设 `CLAUDE_CODE_ENABLE_TASKS=1`（`conversationService.ts:1052`），所以走 `getTaskReminderAttachments`（`attachments.ts:884-889`，`3359-3413`）。
  2. 计数函数从尾部往前数 `type === 'assistant'` 的消息，只跳过纯思考消息，直到碰到 TaskCreate/TaskUpdate 或上一次提醒（`attachments.ts:3303-3357`）。阈值都是 10（`:251-254`）。
  3. 流式响应在每个 `content_block_stop` 生成一条 AssistantMessage（`src/services/api/claude.ts:2221-2261`）。一次响应里「一句说明 + 两个工具调用」就是 3 条。
  4. 提醒正文：「The task tools haven't been used recently ... consider using TaskCreate ... Make sure that you NEVER mention this reminder to the user」（`messages.ts:3774-3792`）。
- 场景：用户问「这个函数为什么返回 undefined」，模型每次响应先写一句再并行调 2 个 Read/Grep。第 4 次请求前计数已到 10，模型收到建议用 TaskCreate 的提醒；如果它不建任务，之后每 3~4 次请求再来一次。第三方模型倾向照提醒字面执行（推断），会为一个问答建任务、逐个标 in_progress/completed，每个多 1~2 次工具调用（loop-execution.md 中「用任务工具时 6~7 次」的来源之一）。
- 参考：ZCode 的 todo 提醒同样是 10/10，但每个 assistant entry 是一次完整响应，「工具数量和工具结果都不增加轮次」（`zcode:apps/zcode-cli/packages/core/src/runtime/helpers/runtime-reminders.ts:157`，`207-245`）；正文没有「NEVER mention」（`:260-270`）。Codex 无对应。
- 改法方向：计数单位改为「一次模型响应」，按 `message.id` 去重，与 ZCode 一致。正文去掉「NEVER mention this reminder」（见 T-INJ-14）。
- 确定程度：代码确认（对模型行为的影响为推断）

### T-INJ-05 工作区里选几行代码或加行评论发给模型时，服务器把整份文件读进上下文，与引用的几行重复

- 类型：问题
- 严重程度：中
- 体量：每个引用的文件一次，最多 25,000 token 或截断为前 2,000 行，再加 340 字符条款（T-INJ-01）和约 180 字符的包装；文件未变时重复引用不再发送（`already_read_file`，`attachments.ts:3054-3100`）。
- 现状（按执行顺序）：
  1. 工作区面板加代码选区或行评论时，引用带 `absolutePath`、`lineStart`、`lineEnd`、`quote`（`desktop/src/components/workspace/WorkspacePanel.tsx:669-691`）。
  2. 发送时，桌面端：
     - 把引用格式化进正文：`Referenced workspace context:` + `@"<相对路径>:L10-20":` + 引用代码块（`desktop/src/stores/workspaceChatContextStore.ts:112-173`）；
     - 同时把同一个引用作为 `type: 'file'`、`path: absolutePath` 的附件发出（`desktop/src/components/chat/ChatInput.tsx:621-632`，`695-699`）。
  3. 服务器只看附件的 `path`，在正文前加 `@"<绝对路径>"`，行号丢掉（`conversationService.ts:1421-1485`）。
  4. CLI 解析 @ 引用，没有 `#L` 范围就整份读取（`attachments.ts:1878-1940`），渲染成「Called the Read tool ... Result of calling the Read tool: <整份文件>」。
  5. 正文里的 `@"src/a.ts:L10-20":` 也被当成 @ 文件解析，文件名带 `:L10-20` 找不到，被静默跳过（`attachments.ts:2741-2785`，`1878-1940`）。
- 场景：用户在一个 1,800 行的 `chatStore.ts` 里选中第 900~920 行，写「这里为什么不节流」。模型收到整份 1,800 行文件（约 7 万字符）和 21 行引用。用户的意图只是这 21 行。没有前缀缓存的提供方每个后续请求都为这 7 万字符计费。
- 参考：ZCode 和 Codex 对选区引用的处理未核实。CLI 自己支持 `@file#L10-20` 只读范围（`attachments.ts:2820-2837`，`1888`，`1934-1937`）。
- 改法方向：服务器把附件的 `lineStart`/`lineEnd` 转成 `@"path#L10-20"`，或者对已有 `quote` 的代码引用不再附整份文件；正文里的位置标记改成 CLI 能识别的 `#L` 格式，或改成不以 `@"` 开头。
- 确定程度：代码确认

### T-INJ-06 文件被外部改动的通知：归因写死为「用户或 linter」，要求不告诉用户，每个文件最多 8K 字符

- 状态：已修复（#270）：归因改为中性（自己运行的命令、用户或其他会话），去掉「不要告诉用户」，片段上限 2 KB 并提示用 Read 看全文。「本轮自己用 Bash 改的文件不发通知」未做。
- 类型：问题
- 严重程度：中
- 体量：338 字符包装加 diff 片段（上限 8,192 字节，`src/tools/FileEditTool/utils.ts:355`，`395-405`）。每个读过、之后被 Edit/Write 以外的方式改动的文件一次。
- 现状（按执行顺序）：
  1. 每次收集附件时，`getChangedFiles` 遍历 `readFileState` 里所有不带 offset/limit 读过的文件，比较 mtime，重读后算 diff（`attachments.ts:2047-2140`）。
  2. 渲染文字：「Note: X was modified, either by the user or by a linter. This change was intentional, so make sure to take it into account as you proceed (ie. don't revert it unless the user asks you to). Don't tell the user this, since they are already aware.」（`messages.ts:3632-3638`）。
  3. 在 DreamCoder 里改动这些文件的来源还有：
     - 模型自己用 Bash 跑的格式化器、`git checkout`、`sed -i`；
     - 共用同一工作目录的侧边对话（`docs/features/side-chat/tech-design.md`：「和父会话共用同一个工作目录」）；
     - 看板分派到同一仓库的其他会话；
     - 用户在应用里编辑产物。
- 场景：
  - 侧边对话里另一个模型改了 `api.ts`。父会话下一轮收到「被用户或 linter 改动、是有意的、不要告诉用户」。用户并不知道侧边对话已经落盘，父会话却被要求不提这件事。
  - 模型自己跑 `npm run format`，触及它读过的 6 个文件：每个文件一条通知，最多 6 × 8.5K 字符，内容是模型自己触发的格式变化，却被说成用户改的。
- 参考：ZCode 和 Codex 都没有主动推送外部改动的 diff；ZCode 只在 Edit/Write 时检查文件是否在读后被改，并报错要求重读（`zcode:apps/zcode-cli/packages/core/src/tool/handlers/edit.ts:65`）。
- 改法方向：
  - 文字改为中性：「X 在你上次读取后被改动（可能来自你运行的命令、用户或其他会话）」，去掉「Don't tell the user」。
  - 片段上限降到 2K 左右并给出「完整内容请重新 Read」。
  - 模型本轮自己用 Bash 改动的文件不发通知（可按「该文件最后一次改动发生在本轮 Bash 执行期间」判断，推断可行）。
- 确定程度：代码确认（侧边对话与父会话的交互为推断）

### T-INJ-07 `/goal` 续跑时模型只收到评估器的一句理由，没有目标原文、预算和无进展检查，也没有续跑上限

- 状态：已修复（#270）：续跑消息写明是 /goal 自动续跑、目标原文、评估器理由；同一条用户消息内最多连续 10 次（计数放在查询循环里，压缩不清零），第 10 次要求汇报。另修了评审时发现的问题：评估器判未完成时同时要求停止，`executeHooks` 把停止要求和阻断信息分两次产出，结果 /goal 第一次判未完成就结束这一轮，从未自动续跑；现在 /goal 的 hook 判未完成时只返回阻断信息。评估器另有第三种答案「卡在用户这里」（`blocked: true`）：这一轮结束、不续跑，goal 保留。
- 类型：问题
- 严重程度：中
- 体量：每次续跑 55 字符前缀加评估器理由；`/goal` 设定时 `<command-name>/goal</command-name>…<local-command-stdout>Goal set: …</local-command-stdout>` 一次。
- 现状（按执行顺序）：
  1. 桌面端的斜杠命令里有 `/goal`（`desktop/src/components/chat/composerUtils.ts:30`）。`/goal X` 在会话里挂一个 Stop 阶段的 prompt hook，评估提示词要求小模型判断目标是否完成（`src/goals/goalState.ts:59-90`，`140-160`）。
  2. 设定后模型被查询，看到的只是命令标签和「Goal set: X」（`src/commands/goal/goal.tsx:42-46`；`src/utils/processUserInput/processSlashCommand.tsx:593`）。
  3. 每次模型要结束时，评估器返回 `{ok:false, reason}`，这一轮继续，追加一条 meta 用户消息「Stop hook feedback:\nPrompt hook condition was not met: <reason>」（`src/utils/hooks/execPromptHook.ts:153-166`；`src/utils/hooks.ts:1912-1914`；`src/query/stopHooks.ts:268-292`；`src/query.ts:1270-1290`）。
  4. 续跑没有次数或 token 上限（`query.ts:1270-1290` 只设 `stopHookActive`）。
- 场景：用户 `/goal 所有单测通过`。模型跑测试，剩 2 个失败，停下来解释原因。评估器回「2 tests still failing」，模型收到「Prompt hook condition was not met: 2 tests still failing」。它不知道这是 /goal 机制，也看不到目标原文（只在很早的命令标签里），可能当成用户的新意见回复一段话后再次结束，于是再被拉回，循环直到评估器判通过（推断）。
- 参考：
  - Codex 的 goals 特性 stable 且默认开启（`codex:features/src/lib.rs:1957-1962`）。续跑模板 6,451 字节，含目标原文（声明为用户提供的数据）、token 预算、「从证据出发」「无进展检查」、完成前验证的要求（`codex:ext/goal/templates/goals/continuation.md`；`codex:ext/goal/src/steering.rs:12-27`），另有预算用尽模板（`budget_limit.md`）。
  - ZCode 续跑消息：评估器的理由和下一步、`<untrusted_objective>` 目标原文、已用时间和 token、预算（`zcode:apps/zcode-cli/packages/contracts/src/tools/target.ts:137-177`）。
- 改法方向：评估器判未完成时，给模型的消息改为续跑模板：说明这是 /goal 续跑、附目标原文（标为用户数据）、评估器理由、已续跑次数；加续跑次数或 token 上限，到上限时发收尾提示。上限本身属执行层，见「交给其他维度」。
- 确定程度：代码确认（模型行为为推断）

### T-INJ-08 缺失：同名同参连续调用没有任何提醒

- 类型：缺失
- 严重程度：中
- 体量：ZCode 正文 269 字符，每回合最多 3 次，只在异常时出现
- 现状：DreamCoder 的附件全集里没有重复调用检测（见附录 A）；`query.ts` 的工具循环也没有（loop-execution.md 结论 5，本次复核 `src/query.ts:1430-1700` 未见相关逻辑）。
- 场景：第三方模型对一个返回空结果的 Grep 连续发同样的参数 5 次，每次结果相同，没有任何文字提示它换做法（推断：这类重复在弱一些的模型上常见）。
- 参考：ZCode 同名同参连续 3 次时插入「You have called X with the same input 3 times in a row. Do not repeat the exact same tool call again unless the user explicitly asked ... Use the existing result to take a different next step, explain the blocker, or ask the user for guidance.」，每回合最多 3 次（`zcode:apps/zcode-cli/packages/core/src/runtime/helpers/model-anomaly.ts:23-60`，`95-103`；注入点 `zcode:apps/zcode-cli/packages/core/src/runtime/methods/turn-tool-warnings.ts:52-62`）。Codex 无对应。
- 改法方向：新增一种附件，在工具批次后检查最近连续的同名同参调用，达到 3 次时注入，每回合上限 3 次；文字可直接采用 ZCode 的三句。
- 确定程度：代码确认（缺失本身）；效果为推断

### T-INJ-09 plan 模式首条提醒 4.7K 字符，要求最多 3 个 Explore 和至少 1 个 Plan 子 agent

- 状态：已修复（#270）：随 T-TOOL-09 删除 5 阶段流程，不再要求 Explore/Plan 子 agent。
- 类型：优化
- 严重程度：低
- 体量：完整版 4,719 字符（不含计划文件路径），之后每 5 个用户轮发简版 312 字符，每第 5 次再发完整版（`attachments.ts:256-259`，`1187-1253`）；子 agent 版 955 字符；重新进入 990 字符；退出 137 字符。
- 现状：桌面端权限模式里可以选 plan（`desktop/src/components/controls/PermissionModeSelector.tsx:61-64`）。正文是五阶段流程：
  - 阶段 1「Launch up to 3 Explore agents IN PARALLEL」；
  - 阶段 2「Default: Launch at least 1 Plan agent for most tasks」（`messages.ts:3305-3400`）；
  - Explore/Plan 对外部构建默认开启（`src/tools/AgentTool/builtInAgents.ts:13-16`）。
- 场景：用户在 plan 模式下让 Kimi 规划一个中等改动。按提醒最多起 3 个 Explore 和 1 个 Plan 子 agent，每个子 agent 都带完整 system 和工具定义，各跑多轮（推断：对第三方模型，这些子 agent 的总输入可能是主会话本身的数倍）。
- 参考：ZCode 五阶段文字几乎相同，研究 agent 数也是 3（`zcode:apps/zcode-cli/packages/core/src/runtime/helpers/runtime-reminders.ts:25-78`）。Codex 的 plan 模式是 9,184 字节的 collaboration mode 模板，不要求起子 agent（`codex:collaboration-mode-templates/templates/plan.md`）。
- 改法方向：对非 Claude 模型把 Explore 上限降到 1，阶段 2 改为「复杂改动才起 Plan agent」；或通过 `CLAUDE_CODE_PLAN_V2_EXPLORE_AGENT_COUNT` 由服务器按模型设置（`src/utils/planModeV2.ts:32-44`）。是否值得改需要实测。
- 确定程度：代码确认（成本影响为推断）

### T-INJ-10 技能目录有任何变化就整份重发技能清单，而不是只发新增的

- 状态：已修复（#270）：同 T-CTX-03，目录变化只发新增技能。
- 类型：问题
- 严重程度：低
- 体量：每次变化一份完整清单（上限同 T-INJ-02），头部固定 103 字符
- 现状：本场景下技能目录监听在运行（`src/main.tsx:2814-2819`，`381-418`；`src/utils/skills/skillChangeDetector.ts:86-130`）。目录下任一文件变化，`resetSentSkillNames()` 清空已发集合（`skillChangeDetector.ts:270-292`），下一次收集把全部技能当作新的发出，头部仍是「The following skills are available for use with the Skill tool」，不说明这是替换（`attachments.ts:2645-2715`；`messages.ts:3822-3832`）。
- 场景：用户在桌面端的技能页面装一个技能，或者让模型在 `.claude/skills/` 下写一个新技能，当前会话下一次工具批次后收到第二份完整清单，与第一份几乎相同。
- 参考：ZCode 的 skills 公告首轮一次，之后只发增量（prompt.md Q7，`zcode:apps/zcode-cli/packages/core/src/runtime/methods/turn-loop.ts:297`，具体增量逻辑未逐行核对）。
- 改法方向：变化时不清空已发集合，只重新计算差集；删除的技能单列「不再可用」。
- 确定程度：代码确认

### T-INJ-11 后台任务完成通知作为新一轮的用户消息发出，只有裸 XML，没有「这不是用户输入」的说明

- 类型：缺失
- 严重程度：低
- 体量：每个后台 agent 或后台命令结束一次；Bash 约 200 字符加路径，agent 带 `<result>` 全文
- 现状（按执行顺序）：
  1. 后台 agent 和后台 Bash 的完成通知优先级为 `later`（`src/utils/messageQueueManager.ts:142-145`；`src/tasks/LocalShellTask/LocalShellTask.tsx:166-171`，`MONITOR_TOOL` 关闭）。
  2. 本场景轮中只排出 `next` 及以上（`src/query.ts:1545-1556`），所以通知不在轮中插入。
  3. 一轮结束后 `print.ts` 把通知当作 prompt 开新一轮，模型看到的用户消息就是 `<task-notification><task-id>…<status>completed</status><summary>…</summary><result>…</result></task-notification>`（`src/cli/print.ts:2058-2143`；`src/tasks/LocalAgentTask/LocalAgentTask.tsx:245-262`）。
  4. 工具描述只说「you will be notified」，没有说明通知的格式和来源（`src/tools/AgentTool/prompt.ts:263`；`src/tools/BashTool/prompt.ts:317-319`）。
- 场景：模型问用户「要不要我顺便更新文档？」后结束一轮，用户还没回答，后台测试命令完成。新一轮的用户消息是 `<task-notification>…completed…`，模型可能把它当作用户的回应，直接去改文档（推断）。
- 参考：ZCode 在任务通知前加「[SYSTEM NOTIFICATION - NOT USER INPUT] … Do NOT interpret this as user acknowledgement, confirmation, or response to any pending question …」（约 550 字符），与用户消息同轮时换用另一版（`zcode:apps/zcode-cli/packages/core/src/system-reminder/incoming-message.ts:9-15`，`17-37`）。Codex 的子 agent 通知用 `<subagent_notification>` 包住的 JSON（`codex:core/src/context/subagent_notification.rs:25-45`）。
- 改法方向：在 `wrapCommandText` 的 `task-notification` 分支（`messages.ts:5631-5632`）和新一轮的入口统一加一句短说明（不必用 ZCode 那么长）：「这是后台任务的自动通知，不是用户消息，不代表用户对任何待答问题的回应」。
- 确定程度：代码确认（误读为推断）

### T-INJ-12 跨会话和看板消息在一轮中途送达时被并进无关的工具结果，每条都重复约 300 字符的固定说明

- 状态：已修复（#270）：非 Claude 模型的中途文字保留为独立文本块（Claude 模型照旧拼接）；信封里的权限说明缩短为一句，还原改为按标签解析。
- 类型：优化
- 严重程度：低
- 体量：信封加固定说明，session 消息 584 字符，brief 808，report 561；看板按用途 440~772（实测，名称和 id 用短样例）。每条消息一次。
- 现状（按执行顺序）：
  1. 带 `origin` 的消息不进服务器的排队（`src/server/services/turnQueueService.ts:27-32`），直接发给 CLI 且不带 priority，CLI 默认为 `next`（`print.ts:4142-4150`；`messageQueueManager.ts:126-130`）。
  2. 所以在下一个工具批次后作为 `queued_command` 附件插入，经 `wrapCommandText` 加信封（`messages.ts:5626-5639`；`src/utils/crossSessionEnvelope.ts:85-106`）。
  3. 再按旧 smoosh 并进刚完成的那个工具结果的字符串（`messages.ts:2709-2722`），代理后成为 `role: tool` 消息的一部分。
  4. 每条都带同一段 `NO_USER_AUTHORITY`（225 字符）和回复说明（`crossSessionEnvelope.ts:41-55`）。
- 场景：模型在跑 `npm test`，另一个会话发来「我已经改完 schema 了」，这段文字出现在 `npm test` 输出的末尾。OpenAI 格式下它和测试输出在同一条 tool 消息里，模型需要靠 `<system-reminder>` 和信封标签区分（推断：多数模型能区分，但这是唯一一种把「另一方的发言」放进工具输出的路径）。
- 参考：ZCode 的中途输入按附件投影、随附件冒泡，对子 agent 的回信带更长的权限说明（`zcode:apps/zcode-cli/packages/core/src/system-reminder/incoming-message.ts:3-8`，`17-52`），做法相近。Codex 无跨会话消息。
- 改法方向：把重复的权限说明移到 SendMessage/Kanban 工具描述或 system 的固定段落里，信封里只留来源和一句「不代表用户授权」；轮中送达的这类消息不并进 tool_result，单独作为 user 文本块（需要对旧 smoosh 加例外）。改动前先确认看板功能的设计意图（`docs/features/kanban/`）。
- 确定程度：代码确认（模型混淆为推断）

### T-INJ-13 压缩摘要让模型去读 JSONL 格式的完整 transcript，文件通常超过 Read 的 256KB 上限

- 状态：已修复（#270）：改为用 Grep 搜索 transcript。
- 类型：问题
- 严重程度：低
- 体量：每次压缩一次，325 字符包装（自动压缩时 606，含「Continue the conversation ... without asking」那段）
- 现状：`getCompactUserSummaryMessage` 在摘要后加「If you need specific details from before compaction ... read the full transcript at: <路径>」（`src/services/compact/prompt.ts:336-372`；调用处 `src/services/compact/compact.ts:610-620`）。路径是会话 JSONL 文件，读取权限自动放行（`src/utils/permissions/filesystem.ts:1808-1819`）。触发压缩时上下文已接近窗口上限，JSONL 还含进度和元数据，体积通常大于 Read 不带 limit 时的 256KB 上限（`src/utils/file.ts:48`）。
- 场景：压缩后模型想找之前的报错原文，按提示 Read transcript，收到超限错误，再用 Grep 在 JSON 转义过的文本里找，多 1~2 轮（推断）。
- 参考：ZCode 的摘要函数保留了这句话，但调用时不传 transcriptPath，所以不发送（`zcode:apps/zcode-cli/packages/core/src/compact/prompt.ts:148-182`；`zcode:apps/zcode-cli/packages/core/src/runtime/methods/compact-active.ts:644-647`）。ZCode 另有「保留的消息比摘要新」的说明（`prompt.ts:140-141`）。Codex 的摘要前缀不提 transcript（prompt.md Q8）。
- 改法方向：去掉这句话，或改为「需要细节时用 Grep 在 <路径> 中搜索」。
- 确定程度：代码确认（文件大小为推断）

### T-INJ-14 多处提醒要求模型「不要告诉用户」，这是针对 Claude 习惯写的措辞

- 类型：优化
- 严重程度：低
- 体量：每处 60~110 字符，随所在提醒出现
- 现状：
  - 任务提醒：「Make sure that you NEVER mention this reminder to the user」（`messages.ts:3757-3792`）。
  - 文件改动：「Don't tell the user this, since they are already aware」（`:3632-3638`）。
  - 跨天：「DO NOT mention this to the user explicitly because they are already aware」（`:4256-4262`）。
  - @ 文件截断：「Don't tell the user about this truncation」（`:3650-3664`）。
- 场景：T-INJ-06 的侧边对话场景里，用户并不知道文件被改，模型却被要求不提。被截断的 @ 文件，用户以为模型看了全文，模型被要求不说只看了前 2,000 行。
- 参考：ZCode 的 todo 提醒删掉了「NEVER mention」（`zcode:apps/zcode-cli/packages/core/src/runtime/helpers/runtime-reminders.ts:260-270`）；跨天改成「No need to announce the new date — the user's own clock shows it」（`:168-170`）；截断那句保留未改（`zcode:apps/zcode-cli/packages/core/src/system-reminder/prompt-attachment.ts:95`）。Codex 没有这类提醒。
- 改法方向：按 ZCode 的方向改成「不必主动提起」；截断那句改为「如与回答有关，说明只看了前 2,000 行」。
- 确定程度：代码确认（对用户的影响为推断）

### T-INJ-15 system-reminder 嵌套：@ 引用文件里的条款和空文件警告被外层 system-reminder 再包一次

- 类型：问题
- 严重程度：低
- 体量：每处多 37 字符包装
- 现状：Read 结果自带 `<system-reminder>`（条款，`FileReadTool.ts:727-728`；空文件和 offset 越界警告，`:700-705`）。作为 @ 引用或压缩恢复渲染时，`wrapMessagesInSystemReminder` 再包一层（`messages.ts:3195-3228`，`3650-3664`）。实测输出为 `<system-reminder>\nResult of calling the Read tool:\n<system-reminder>Warning: ...</system-reminder>\n</system-reminder>`。
- 场景：模型看到嵌套标签，难以判断哪段是文件内容、哪段是系统说明（推断，影响小）。
- 参考：ZCode 明确禁止嵌套，`wrapSystemReminder` 遇到嵌套直接抛错（`zcode:apps/zcode-cli/packages/core/src/system-reminder/source.ts:256-262`）。
- 改法方向：T-INJ-01 改完后条款不再出现；空文件警告在 Read 的映射函数里不自带标签，由调用方决定是否包装。
- 确定程度：代码确认

### T-INJ-16 verification 子 agent 每个工具批次都重复一次 222 字符的 CRITICAL 提醒

- 类型：优化
- 严重程度：低
- 体量：259 字符（含包装）× verification 子 agent 的每次请求
- 现状：verification agent 对外部构建启用（`src/tools/AgentTool/builtInAgents.ts:24-27`），定义了 `criticalSystemReminder_EXPERIMENTAL`（`src/tools/AgentTool/built-in/verificationAgent.ts:151-152`），`getAttachments` 每次调用都发（`attachments.ts:910-913`，`1571-1579`）。字段注释写的是「re-injected at every user turn」（`src/tools/AgentTool/loadAgentsDir.ts:121`），实际是每个工具批次。
- 场景：模型自己选择起 verification 子 agent，子 agent 跑 25 次请求，历史里累积 25 份相同的 CRITICAL 提醒（约 6.5K 字符）。
- 参考：ZCode、Codex 无对应。
- 改法方向：同 plan 模式的节流，首次发完整句，之后每 5 次请求发一次，或只在子 agent 第一次请求时发。
- 确定程度：代码确认

### T-INJ-17 恢复会话时插入「Continue from where you left off.」和假的 assistant「No response requested.」，但不会自动续跑

- 状态：已修复（#270）：恢复时不再插入续跑消息和假回复；只有设置了自动续跑时才补发。
- 类型：问题
- 严重程度：低
- 体量：33 + 23 字符，每次 CLI 重启一组（与 T-INJ-02 叠加）
- 现状：
  1. 恢复时，若最后一条是工具结果或附件，追加 meta 用户消息「Continue from where you left off.」。
  2. 若最后一条是用户消息（包括中断标记「[Request interrupted by user for tool use]」），在其后插入 assistant「No response requested.」（`src/utils/conversationRecovery.ts:206-245`，`262-330`）。
  3. 自动续跑只在设了 `CLAUDE_CODE_RESUME_INTERRUPTED_TURN` 时发生（`src/cli/print.ts:1218-1240`），服务器不设。所以这两条留在历史里，紧接着是用户的新消息。
- 场景：结合 T-INJ-02：用户点停止，3 秒后 CLI 被结束；用户再发「改用方案 B」。模型看到的是：中断标记 → 自己「说过」No response requested. → 新消息。如果是工具结果中途被杀，则是「Continue from where you left off.」→ No response requested. → 「改用方案 B」，前一句指令和用户新指令方向相反（推断：模型可能先继续旧方案）。
- 参考：ZCode 的中断标记持久化并在冷恢复时按原样还原（`zcode:apps/zcode-cli/packages/core/src/runtime/methods/interrupt-marker.ts:44-60`），未见插入续跑指令（未逐行核对 ZCode 恢复流程）。Codex 用 `<turn_aborted>` 说明上一轮被中断（`codex:core/src/context/turn_aborted.rs:11-13`）。
- 改法方向：服务器不自动续跑时不插入「Continue from where you left off.」；需要 API 合法性时，用中断标记代替假的 assistant 回复，或在下一条用户消息到来时移除这两条。
- 确定程度：代码确认（合成消息是否被写回 transcript 未核实，见第 5 节）

### T-INJ-18 中断时的工具结果说「用户现在不想做这个操作」，没说明工具可能已经部分执行

- 类型：优化
- 严重程度：低
- 体量：126 字符 × 被中断的工具数，加 29/42 字符的中断标记
- 现状：
  - 正在执行的工具被中断时，结果是 `CANCEL_MESSAGE`「The user doesn't want to take this action right now. STOP what you are doing and wait ...」（`src/services/tools/toolExecution.ts:416-450`；`messages.ts:215-216`）。
  - 未执行的工具结果是「Interrupted by user」（`src/query.ts:124-149`，`1015-1030`）。
  - 之后是「[Request interrupted by user for tool use]」（`query.ts:1472-1480`）。
- 场景：Bash 跑 `npm install && npm run migrate` 时用户停止，迁移已执行一半。模型看到的文字暗示动作没发生，下一轮可能直接重跑迁移（推断）。
- 参考：Codex 的 `<turn_aborted>`：「The user interrupted the previous turn on purpose. Any running unified exec processes may still be running in the background. If any tools/commands were aborted, they may have partially executed.」（`codex:core/src/context/turn_aborted.rs:11-13`）。ZCode 标记与 DreamCoder 相同，被取消的工具统一用 `REJECT_MESSAGE` 文字（`zcode:apps/zcode-cli/packages/core/src/runtime/methods/interrupt-marker.ts:11-16`）。
- 改法方向：Bash 等有副作用的工具被中断时，结果补一句「命令可能已部分执行，继续前先检查状态」。
- 确定程度：代码确认（模型行为为推断）

### T-INJ-19 读到子目录文件时注入的 CLAUDE.md 只有「Contents of <path>:」，不说明它是项目指令，也不读子目录的 AGENTS.md

- 状态：维护者已定（2026-11-18）：随 T-CTX-01 的指令文件规则一起改。
- 类型：问题
- 严重程度：低
- 体量：头部 52 字符加文件内容，每个子目录指令文件每会话一次（重启后丢失，见 T-INJ-02）
- 现状：`nested_memory` 渲染为「Contents of <path>:\n\n<content>」（`messages.ts:3794-3801`），文件集合只有 CLAUDE.md、`.claude/CLAUDE.md`、`.claude/rules/*.md`（`src/utils/claudemd.ts:1-16`；`attachments.ts:1694-1760`）。system 里的 CLAUDE.md 有「These instructions OVERRIDE any default behavior」一类说明（T-CTX 范围），子目录这份没有。
- 场景：`packages/api/CLAUDE.md` 写「这个包的 SQL 必须走 query builder」。模型读 `packages/api/db.ts` 时收到这段内容，只看到「Contents of …」，可能当作普通参考文件（推断）。若这个子目录只有 `AGENTS.md`，模型什么也收不到。
- 参考：Codex 在会话开始时读根目录到 cwd 路径上的 AGENTS.md，不在读子目录文件时增量加载（推断，未逐行核对）。ZCode 会话中只在压缩后重读指令文件（prompt.md Q7）。
- 改法方向：头部改为「<path> 是 <目录> 下的项目指令，处理该目录内的文件时遵守」；文件集合与会话开始时的指令文件保持一致（是否加入 AGENTS.md 由 T-CTX 的结论决定）。
- 确定程度：代码确认（模型理解为推断）

### T-INJ-20 缺失：长时间只调工具不说话时没有「向用户汇报进展」的提醒

- 类型：缺失
- 严重程度：低
- 体量：ZCode 正文 139 字符，连续 5 次响应没有可见文字时发，每段静默最多 3 次
- 现状：DreamCoder 附件全集中没有对应项。system 里有关于输出简洁的条文（T-SYS 范围），没有中途汇报的机制。
- 场景：第三方模型连续 15 次请求只调工具，桌面端用户只看到工具卡片，不知道它在做什么（推断）。
- 参考：ZCode「The user hasn't heard from you in a while. As you continue, keep them updated when there's something to tell — a finding, a change of plan.」（`zcode:apps/zcode-cli/packages/core/src/runtime/helpers/runtime-reminders.ts:105-161`；注入 `zcode:apps/zcode-cli/packages/core/src/runtime/methods/turn-loop.ts:363-374`）。Codex 无对应。
- 改法方向：可选。若加，按「一次响应」计数（与 T-INJ-04 同一计数函数），文字采用 ZCode 那句。和 system 里要求简洁的条文是否冲突需要一起看（T-SYS）。
- 确定程度：代码确认（缺失本身）

### T-INJ-21 缺失：没有逐批次的 `<total_tokens>` 剩余预算提示

- 类型：缺失
- 严重程度：低
- 体量：ZCode 约 86 字符（含包装）× 每个工具批次
- 现状：DreamCoder 的 `token_usage` 附件需要 `CLAUDE_CODE_ENABLE_TOKEN_USAGE_ATTACHMENT`（`attachments.ts:3791-3807`），`output_token_usage` 需要 `feature('TOKEN_BUDGET')`（`:3809-3825`），本场景都不发。
- 场景：无具体失败场景。
- 参考：ZCode 每个工具批次后发 `<total_tokens>N tokens left</total_tokens>`，预算固定 15,000,000，用户输入时重新起算（`zcode:apps/zcode-cli/packages/core/src/context/total-tokens.ts:1-9`；`zcode:apps/zcode-cli/packages/core/src/runtime/helpers/total-tokens-budget.ts:53-67`；`zcode:apps/zcode-cli/packages/core/src/runtime/methods/turn-loop.ts:416-447`）。Codex 的 token budget 是开发中特性，默认关（`codex:features/src/lib.rs:1963-1968`）。
- 改法方向：不建议照搬。ZCode 的预算是固定的大数，几乎总是「剩很多」，对决策帮助有限，而每批次 86 字符在 30 次请求里约 2.5K。若 DreamCoder 将来有真实的预算（例如 /goal 的 token 上限，见 T-INJ-07），再按需提示。
- 确定程度：代码确认

### T-INJ-22 缺失：空响应不重试，也没有给模型的提示文字

- 类型：缺失
- 严重程度：低
- 体量：无文字
- 现状：代理对空 choice 造一个空文本 end_turn，CLI 当作正常结束（loop-execution.md 结论 4，`src/server/proxy/transform/openaiChatToAnthropic.ts:93-104`；`src/services/api/claude.ts:2390-2404`）。属执行层，这里只记文字层没有对应项。
- 参考：ZCode 判为可重试错误「Model returned no text, no tool calls, and no usage before completing the turn.」（`zcode:apps/zcode-cli/packages/core/src/runtime/helpers/model-errors.ts:114-131`），不给模型加文字。Codex 无对应。
- 改法方向：见 loop-execution.md；文字层不需要新增内容。
- 确定程度：代码确认

### T-INJ-23 缺失：用户在一轮进行中发的消息要等这一轮结束，没有轮中插话

- 类型：缺失
- 严重程度：低
- 体量：无（DreamCoder 现有的轮中文字在本场景不出现）
- 现状：
  - 桌面端在一轮进行中发送时，服务器以 `priority: 'later'` 交给 CLI 并记进排队（`desktop/src/stores/chatStore.ts:909-912`；`src/server/services/turnQueueService.ts:43-53`）。
  - CLI 轮中只排出 `next` 及以上（`query.ts:1545-1556`），所以这条消息在本轮结束后才作为新一轮发出。「立即发送」先中断本轮再发（`turnQueueService.ts:67-73`）。
  - CLI 里为轮中用户消息准备的文字「The user sent a new message while you were working ... After completing your current task, you MUST address the user's message above」（`messages.ts:5640-5643`）在本场景不会出现。
- 场景：模型在一个 20 步的重构里走错了方向，用户发「别改 utils 目录」。这条消息要等 20 步做完才送达，或者用户只能中断本轮。
- 参考：ZCode 在下一个工具批次后插入「The user sent a new message while you were working: … This is how ZCode surfaces messages the user sends mid-turn … Address the message above as you continue this turn.」（`zcode:apps/zcode-cli/packages/core/src/system-reminder/incoming-message.ts:3-4`，`23-24`）。注意它是「继续本轮时就处理」，与 DreamCoder CLI 现有文字的「完成当前任务后再处理」相反。Codex 把运行中提交的输入在下一次采样前作为用户输入记录（`codex:core/src/session/turn.rs:461-479`）。
- 改法方向：属于产品和执行层的决定（是否支持轮中插话）。若支持，文字采用 ZCode 的说法（继续本轮时处理），不要用现有的「完成当前任务后」版本。
- 确定程度：代码确认

## 2. 汇总表

| 编号 | 标题 | 类型 | 严重程度 | 体量 |
|---|---|---|---|---|
| T-INJ-01 | 每次读文件附 340 字符恶意软件条款，@ 引用和压缩恢复也带 | 问题 | 高 | 340/次，累积 |
| T-INJ-02 | CLI 重启后中途注入文字大多丢失，技能清单整份重发 | 问题 | 高 | 每次重启：丢失不定量 + 一份清单（≤8K@200K） |
| T-INJ-03 | 拒绝权限只给「User denied via UI」 | 问题 | 中 | 18/次拒绝 |
| T-INJ-04 | 任务提醒按内容块计数，3~5 次请求就触发 | 问题 | 中 | 517~823/次 |
| T-INJ-05 | 代码选区引用把整份文件读入 | 问题 | 中 | 每文件最多 25K token |
| T-INJ-06 | 文件改动通知归因写死、要求不告诉用户、单文件最多 8K | 问题 | 中 | 338 + ≤8,192/文件 |
| T-INJ-07 | /goal 续跑只给一句理由，无目标原文、预算、上限 | 问题 | 中 | 55 + 理由/次续跑 |
| T-INJ-08 | 缺失：重复调用提醒 | 缺失 | 中 | ZCode 269/次 |
| T-INJ-09 | plan 模式首条 4.7K，要求最多 3+1 个子 agent | 优化 | 低 | 4,719 首次，312/5 用户轮 |
| T-INJ-10 | 技能目录变化时整份重发清单 | 问题 | 低 | 一份清单/次变化 |
| T-INJ-11 | 后台通知是裸 XML 的新一轮用户消息，无「非用户输入」说明 | 缺失 | 低 | 约 200+/次 |
| T-INJ-12 | 跨会话/看板消息并进无关工具结果，固定说明每条重复 | 优化 | 低 | 440~808/条 |
| T-INJ-13 | 压缩摘要指向超过 Read 上限的 JSONL transcript | 问题 | 低 | 325/606 每次压缩 |
| T-INJ-14 | 多处「不要告诉用户」措辞 | 优化 | 低 | 60~110/处 |
| T-INJ-15 | system-reminder 嵌套 | 问题 | 低 | 37/处 |
| T-INJ-16 | verification 子 agent 每批次重复 CRITICAL 提醒 | 优化 | 低 | 259/次请求 |
| T-INJ-17 | 恢复时插入续跑指令和假 assistant 回复，但不续跑 | 问题 | 低 | 56/次重启 |
| T-INJ-18 | 中断结果不说明可能已部分执行 | 优化 | 低 | 126/工具 |
| T-INJ-19 | 子目录 CLAUDE.md 无指令说明，不读 AGENTS.md | 问题 | 低 | 52 + 内容 |
| T-INJ-20 | 缺失：静默轮数提醒 | 缺失 | 低 | ZCode 139/次 |
| T-INJ-21 | 缺失：`<total_tokens>`（不建议照搬） | 缺失 | 低 | ZCode 86/批次 |
| T-INJ-22 | 缺失：空响应重试（执行层，无文字） | 缺失 | 低 | 0 |
| T-INJ-23 | 缺失：轮中插话 | 缺失 | 低 | 0 |

30 次请求会话的累计估算（按以下假设计算，假设本身是推断）：一次用户请求，模型共发 30 次请求（29 个工具批次），平均每次响应 2 个非思考内容块，读 12 个文件，不用任务工具，一次 Bash 格式化改动了 2 个已读文件、各约 1,500 字符 diff，不跨天，不在 plan 模式。

| | DreamCoder | ZCode | Codex |
|---|---|---|---|
| 逐批次固定提示 | 无 | `<total_tokens>` 29 × 约 86 ≈ 2,500 | 无 |
| 读文件附加 | 12 × 340 = 4,080 | 0 | 0 |
| 任务/todo 提醒 | 内容块累计 60，每 10 个一次 → 6 × 517 ≈ 3,100 | 按响应计，30 次中 3 次 × 约 430 ≈ 1,300（前提是工具里有 TodoWrite，未核实） | 0 |
| 文件改动通知 | 2 × (338 + 1,500) ≈ 3,700 | 0 | 0 |
| 静默提醒 | 0 | 每次都有文字时为 0，否则最多 3 × 约 176 | 0 |
| 合计 | 约 10,900 字符（约 3K token） | 约 2,500~4,300 | 约 0 |

这些文字一旦插入就留在历史里。没有前缀缓存时，第 k 次请求要为之前插入的全部文字计费，30 次请求累计计费量约为合计 × 15，DreamCoder 约 16 万字符。若中途发生一次停止（T-INJ-02），还要加一份技能清单，并在重启后的第一个请求上丢失缓存。

## 3. 与已有结论的出入

1. prompt.md Q7「`task_reminder` 距上次 TaskCreate/TaskUpdate ≥10 个 assistant 轮」：需要修正。计数单位是非思考的 AssistantMessage，每个内容块一条（`src/services/api/claude.ts:2221-2261`），实际触发比「10 次响应」频繁 2~3 倍（T-INJ-04）。大小「480 + 任务列表」与实测 517（含包装、空列表）一致。
2. Q7「`edited_text_file` 302 + diff 片段」：证实（实测 338 含 37 字符包装）；补充片段上限 8,192 字节和归因问题（T-INJ-06）。
3. Q7「`skill_listing` 第一轮，及新增 skill 时」：需要补充。技能目录变化时是整份重发而不是只发新增（T-INJ-10）；每次 CLI 重启后也整份重发（T-INJ-02）。
4. Q7「`queued_command` / 任务通知：后台 agent 或后台命令结束」：需要修正。本场景下任务通知优先级是 `later`，不在轮中插入，而是在轮结束后作为新一轮的用户消息（T-INJ-11）；轮中插入的只有带 `origin` 的跨会话和看板消息（T-INJ-12）。
5. Q7「`date_change` 约 100」：实测 165（含包装）。
6. Q7「不触发：teammate 系列（需 agent teams 开关）」：需要补充。用户在设置里打开 Agent Teams 时服务器设置环境变量（`src/server/services/agentTeamsEnv.ts:9-15`），killswitch 默认放行（`src/utils/agentSwarmsEnabled.ts:24-40`），`team_context`、`teammate_mailbox` 会出现。
7. Q7 表格漏列了本场景会出现的几类：plan 模式提醒（T-INJ-09）、`critical_system_reminder`（T-INJ-16）、/goal 的 Stop hook 反馈（T-INJ-07）、权限拒绝文字（T-INJ-03）、跨会话/看板信封（T-INJ-12）、压缩后的恢复附件（T-INJ-01、T-INJ-13）、恢复会话时插入的消息（T-INJ-17）。
8. Q7 ZCode「重复调用提醒 约 150」：实测正文 269 字符。「静默轮次提醒 139」证实。
9. Q7 Codex「token budget … 需 TokenBudget 等开发中特性」：证实（`codex:features/src/lib.rs:1963-1968`）。需要补充：Codex 的 goals 特性 stable 且默认开启（`:1957-1962`），用 /goal 时有 6.4K 的续跑模板；中断后有带说明文字的 `<turn_aborted>`。这两项和本报告的 T-INJ-07、T-INJ-18 直接相关，Q7 的「未找到 Codex 在本场景对重复调用、静默、todo 一类的提醒」本身仍成立。
10. prompt.md 和 loop-execution.md 中 ZCode 路径写作 `zcode:core/src/...`，按简报的约定（相对仓库根）应为 `zcode:apps/zcode-cli/packages/core/src/...`。行号经抽查一致（`runtime-reminders.ts:105-161`、`model-anomaly.ts:23-60`）。
11. loop-execution.md「DreamCoder 每次 Read 结果末尾还附约 330 字符的恶意软件提醒」：实测 340；需要补充：@ 引用的文件和压缩后恢复的文件同样附带（T-INJ-01）。
12. prompt.md 第 3 节「DreamCoder 会话内各算一次，只有日期跨天、子目录 CLAUDE.md 等少数附件会补发」：证实；需要补充：这些附件不写入 transcript，CLI 重启后从历史中消失（T-INJ-02）。
13. loop-execution.md「Stop hook：blockingError 时把 hook 输出作为 meta 消息追加并继续」：证实；需要补充：DreamCoder 自己的 /goal 就走这条路径，续跑文字和上限的问题见 T-INJ-07。

## 4. 已查无问题

- system 解释了 `<system-reminder>` 标签的含义（`src/constants/prompts.ts:132`，`190`），第三方模型有据可依。
- 同一进程内，附件追加在尾部、按原样重新渲染，不打断前缀（见开头「插入位置」）；`date_change` 特意在尾部追加而不改 system 里的旧日期（`src/utils/attachments.ts:1404-1445`）。
- 截断续写文字「Output token limit hit. Resume directly — no apology …」183 字符（`src/query.ts:1211-1215`）：与 ZCode 逐字相同，「no apology」针对 Claude 习惯但对其他模型无害。
- 空工具结果的占位「(X completed with no output)」（`src/utils/toolResultStorage.ts:280-294`）：原因写的是 Claude 的停止序列习惯，对所有模型都有用。
- 中断标记「[Request interrupted by user]」「… for tool use」：与 ZCode 相同。
- 侧边对话和分叉的说明（142、203 字符，`src/server/services/sessionLinksService.ts:30-35`；`src/utils/sessionBranching.ts:237-251`）：一次性，内容准确。
- 浏览器引用把页面文本围在带 nonce 的 `UNTRUSTED_PAGE_CONTENT` 里并附安全说明（`desktop/src/lib/browserReferences.ts:63-68`，`141-143`）：做法合理。
- 产物编辑说明（约 140 字符，`desktop/src/lib/artifactEditReference.ts:24-35`）：一次性，指示具体。
- 读 auto memory 文件时的新鲜度说明（242 字符，只对超过 1 天的记忆，`src/memdir/memoryAge.ts:33-54`）：只在读记忆文件时出现。
- 大输出落盘说明「Output too large … Full output saved to … Preview (first 2KB)」135 字符加预览（`src/utils/toolResultStorage.ts:189-199`）：文字本身无问题；Bash 只保留开头的截断方式交给 T-TOOL。
- 跨会话消息的标签伪造防护（`src/utils/crossSessionEnvelope.ts:102-106`）：有效。
- 计划模式提醒的节流按「用户轮」计数（`attachments.ts:1132-1164`），没有 T-INJ-04 的问题。
- 本场景不触发的附件（条件见附录 A）：`token_usage`、`budget_usd`、`output_token_usage`、`verify_plan_reminder`、`deferred_tools_delta`、`agent_listing_delta`、`mcp_instructions_delta`、`compaction_reminder`、`context_efficiency`、`auto_mode`、`auto_mode_exit`、`ultrathink_effort`、`skill_discovery`、`relevant_memories`、`diagnostics`（IDE 与 LSP）、`selected_lines_in_ide`、`opened_file_in_ide`、`companion_intro`、`current_session_memory`、`bagel_console`、`max_turns_reached`。另外，按时间清理旧工具结果默认关闭（`src/services/compact/timeBasedMCConfig.ts:31-33`），拒绝消息后的记忆提示受 GrowthBook 控制（`src/utils/messages.ts:189-197`），流式工具执行器的取消文字受 GrowthBook 控制（`src/query/config.ts:33-35`），工具调用摘要需要环境变量（`:36-38`），都不出现。

## 5. 没有核实的地方

- 恢复时插入的「Continue from where you left off.」和「No response requested.」是否会在下一轮被写回 transcript（决定多次重启后前缀是否还会变化）：未核实。
- 停止后 3 秒结束 CLI 进程：按代码路径确认，没有运行桌面端验证；也没有查是否有测试刻意覆盖这一行为。
- 桌面端怎样展示 ExitPlanMode 的审批、拒绝计划时模型收到什么：只确认了走通用权限拒绝（T-INJ-03），未在桌面端操作验证。
- DreamCoder 默认安装下技能清单的实际长度：未测（T-CTX 范围）。
- ZCode 本场景默认工具里是否有 TodoWrite（影响 30 次请求估算里 ZCode 的 todo 提醒一项）：未核实。
- ZCode 和 Codex 对「代码选区引用」的处理：未核实。
- Codex 的上下文片段是否全部写入 rollout、恢复后前缀是否不变：推断。
- ZCode skills 增量公告的具体实现：只看了调用点，未逐行核对。
- 所有「模型可能会……」的行为影响：没有运行模型验证。

## 交给其他维度

- 执行层 / 服务端：停止后 3 秒无条件结束 CLI 进程（`src/server/ws/handler.ts:862-884`），是 T-INJ-02 的主要触发源；/goal 续跑没有次数或 token 上限（`src/query.ts:1270-1290`）；空响应处理（loop-execution.md）。
- T-TOOL：Bash 长输出只保留开头（`src/tools/BashTool/utils.ts:156-158`），对比 Codex 保留首尾（`codex:utils/output-truncation/src/lib.rs:32`）；Read 的 `FILE_UNCHANGED_STUB`。
- T-CTX：首轮技能清单的体量；会话开始时不读 AGENTS.md；MCP 服务器晚于首轮连接时 system 中 instructions 的变化（`mcp_instructions_delta` 在本场景关闭，`src/utils/mcpInstructionsDelta.ts:26-33`）。
- T-SYS：`DONT_ASK_REJECT_MESSAGE` 含「Claude Code」（`src/utils/messages.ts:242-244`），dontAsk 在桌面端不可选，本场景不出现；system 里拒绝工具调用的说明与 T-INJ-03 改后的文字要一致。
- Agent Teams（AT 负责人）：`team_context`、`teammate_mailbox` 的文字（`src/utils/messages.ts:3547-3593`）。
- 代理层：@ 引用的图片发给不支持视觉的模型（P-REQ-11）。

## 附录 A：附件类型全集与本场景结论

附件类型定义见 `src/utils/attachments.ts:293-728`，渲染见 `src/utils/messages.ts:3547-4379`。长度为实测（含包装、变量为空），「—」表示不渲染给模型。

| 类型 | 触发条件 | 本场景 | 固定部分长度 | 结论 |
|---|---|---|---|---|
| `file` | @ 引用文件；压缩后恢复 | 是（桌面附件、代码引用、压缩） | 约 180 + 内容 + 340 条款 | T-INJ-01、05、15 |
| `compact_file_reference` | 压缩恢复时文件过大 | 偶发 | 180 | 无问题 |
| `pdf_reference` | @ 引用大 PDF | 偶发 | 401 | 无问题（PDF 内容送达问题见 P-REQ-03） |
| `already_read_file` | @ 引用未变的已读文件 | 是 | — | 无问题 |
| `directory` | @ 引用目录 | 是（工作区引用目录） | 合成 Bash ls 调用 + 列表（≤1,000 项） | 无问题 |
| `agent_mention` | 输入含 `@agent-x` | 少见 | 171 | 无问题 |
| `mcp_resource` | 输入含 `@server:uri` | 否（桌面不生成） | 95 起 | 不触发 |
| `edited_text_file` | 读过的文件被外部改动 | 是 | 338 + diff | T-INJ-06、14 |
| `edited_image_file` | 同上，图片 | 是 | — | 不渲染 |
| `nested_memory` | 读到含 CLAUDE.md 的子目录文件 | 视仓库 | 52 + 内容 | T-INJ-19 |
| `relevant_memories` | GrowthBook `tengu_moth_copse` | 否 | — | 不触发 |
| `dynamic_skill` | 读到含技能的子目录 | 视仓库 | — | 不渲染（新技能进入清单） |
| `skill_listing` | 首轮；技能变化；每次重启 | 是 | 103 + 清单 | T-INJ-02、10；首轮体量交 T-CTX |
| `skill_discovery` | `feature('EXPERIMENTAL_SKILL_SEARCH')` | 否 | — | 不触发 |
| `queued_command` | 轮中排出的 prompt/通知 | 是（仅跨会话/看板） | 信封 440~808 | T-INJ-12、23 |
| `task_status` | 压缩后有运行中的后台任务 | 偶发 | 215 起 | 无问题 |
| `todo_reminder` | TodoWrite 模式 | 否（服务器启用 Task V2） | 481 | 不触发 |
| `task_reminder` | Task V2，10/10 计数 | 是 | 517 + 列表 | T-INJ-04、14 |
| `date_change` | 跨天 | 少见 | 165 | T-INJ-14 |
| `plan_mode` / `plan_mode_reentry` / `plan_mode_exit` | 桌面选 plan 模式 | 是（用户选择时） | 4,719 / 312 / 955 / 990 / 137 | T-INJ-09 |
| `plan_file_reference` | 压缩后存在计划文件 | 偶发 | 189 + 计划 | 无问题 |
| `invoked_skills` | 压缩后有已调用技能 | 偶发 | 146 + 技能全文（≤25K token） | 无问题（重启后丢失见 T-INJ-02） |
| `auto_mode` / `auto_mode_exit` | `feature('TRANSCRIPT_CLASSIFIER')` | 否 | — | 不触发 |
| `critical_system_reminder` | agent 定义带该字段 | 是（verification 子 agent） | 259 | T-INJ-16 |
| `output_style` | 设置里 outputStyle 非默认 | 少见（桌面无入口） | 131/每批次 | 无问题（与 ZCode 相同，每次收集都发） |
| `diagnostics` | IDE MCP 或插件 LSP | 否 | — | 不触发 |
| `selected_lines_in_ide` / `opened_file_in_ide` | 连接 IDE | 否 | 132 / 126 | 不触发 |
| `token_usage` | 环境变量 | 否 | 80 | 不触发（T-INJ-21） |
| `budget_usd` | `--max-budget-usd` | 否（服务器不传） | 72 | 不触发 |
| `output_token_usage` | `feature('TOKEN_BUDGET')` | 否 | — | 不触发 |
| `verify_plan_reminder` | 仅 ant | 否 | — | 不触发 |
| `compaction_reminder` | `feature('COMPACTION_REMINDERS')` | 否 | — | 不触发 |
| `context_efficiency` | `feature('HISTORY_SNIP')` | 否 | — | 不触发 |
| `ultrathink_effort` | `feature('ULTRATHINK')` | 否 | 121 | 不触发 |
| `deferred_tools_delta` | 仅 ant 或 GrowthBook，且 ToolSearch 开 | 否 | — | 不触发 |
| `agent_listing_delta` | 环境变量或 GrowthBook | 否 | — | 不触发（清单在 Agent 工具描述里，T-TOOL） |
| `mcp_instructions_delta` | 环境变量、仅 ant 或 GrowthBook | 否 | — | 不触发（交 T-CTX） |
| `companion_intro` | 全局配置有 companion | 否（需 /buddy，headless 不可用） | 约 450 | 不触发 |
| `teammate_mailbox` / `team_context` | 用户打开 Agent Teams | 视设置 | 原文 / 约 1,000 | 交 AT 负责人 |
| `teammate_shutdown_batch` | 仅界面折叠 | 否 | — | 不渲染 |
| `current_session_memory` / `bagel_console` | 无生产方 | 否 | — | 不触发 |
| `max_turns_reached` | `--max-turns` | 否（服务器不传） | — | 不渲染 |
| `structured_output` / `command_permissions` | 各自事件 | 视情况 | — | 不渲染 |
| `async_hook_response` | 异步 hook 返回 | 视插件 | 原文 | 无问题（需用户配置 hook） |
| `hook_blocking_error` | hook 阻断 | 视插件 | 76 + 原文 | 无问题 |
| `hook_additional_context` / `hook_success` | SessionStart/UserPromptSubmit hook 输出 | 视插件 | 64 + 原文 | 无问题 |
| `hook_stopped_continuation` | hook 阻止继续 | 视插件 | 原文 | 无问题 |
| `hook_permission_decision` / `hook_system_message` / `hook_cancelled` / `hook_error_during_execution` / `hook_non_blocking_error` | 各自事件 | 视插件 | — | 不渲染 |

附件之外的合成文字：

| 文字 | 位置 | 长度 | 结论 |
|---|---|---|---|
| Read 恶意软件条款 | `src/tools/FileReadTool/FileReadTool.ts:727-728` | 340 | T-INJ-01 |
| 权限拒绝「User denied via UI」 | `src/server/services/conversationService.ts:572` | 18 | T-INJ-03 |
| 中断标记、取消结果 | `src/utils/messages.ts:212-216`；`src/query.ts:1015-1030`，`1472-1480` | 29 / 42 / 126 | T-INJ-18 |
| Stop hook 反馈（/goal） | `src/utils/hooks.ts:1912-1914`；`src/utils/hooks/execPromptHook.ts:161-163` | 55 + 理由 | T-INJ-07 |
| 截断续写 | `src/query.ts:1211-1215` | 183 | 无问题 |
| 压缩摘要包装 | `src/services/compact/prompt.ts:336-372` | 325 / 606 | T-INJ-13 |
| 恢复时插入 | `src/utils/conversationRecovery.ts:210-245` | 33 + 23 | T-INJ-17 |
| 侧边对话 / 分叉说明 + 「No response requested.」 | `src/server/services/sessionLinksService.ts:30-35`；`src/utils/sessionBranching.ts:237-251` | 142 / 203 + 23 | 无问题 |
| 后台任务通知 | `src/tasks/LocalAgentTask/LocalAgentTask.tsx:245-262`；`src/tasks/LocalShellTask/LocalShellTask.tsx:160-171` | 约 200 + 内容 | T-INJ-11 |
| 跨会话 / 看板信封 | `src/utils/crossSessionEnvelope.ts:41-106` | 440~808 | T-INJ-12 |
| 服务器附件前缀 `@"path"` 与「Please analyze the attached files.」 | `src/server/services/conversationService.ts:1421-1485` | 路径 + 34 | T-INJ-05（桌面端 `chatStore.ts:1806-1814` 有同样的默认句，只用于显示） |
| 桌面端工作区 / 对话选区引用 | `desktop/src/stores/workspaceChatContextStore.ts:112-173` | 标题 30 + 引用 | T-INJ-05 |
| 浏览器引用围栏 | `desktop/src/lib/browserReferences.ts:63-68`，`141-193` | 90 + 199 + 内容 | 无问题 |
| 产物编辑说明 | `desktop/src/lib/artifactEditReference.ts:24-35` | 约 140 | 无问题 |
| 空工具结果占位 | `src/utils/toolResultStorage.ts:280-294` | 约 30 | 无问题 |
| 大输出落盘说明 | `src/utils/toolResultStorage.ts:189-199` | 135 + 2KB 预览 | 无问题（截断方式交 T-TOOL） |
| 记忆新鲜度说明 | `src/memdir/memoryAge.ts:33-54` | 242 | 无问题 |
