# 现有功能与新 UI 样稿覆盖核对

日期：2026-10-17。用户表示当前页面暂时满意，要求核对现有页面的功能是否全部覆盖；本轮没有调整样稿或正式应用代码。

源码基线：原仓库当前已是 `main`，提交 `5721c21`（typed live events 合并后的版本）。UI 工作区仍是 `feat/ui-refresh`，基线 `d5ee9159`。本次按原仓库当前源码核对，未切换或修改它的分支。

范围：从 AppShell / ContentRouter 的实际入口出发，核对侧栏、空会话、活动会话、文件工作区、终端，以及相邻的设置和定时任务。未把目录中未接入的旧演示页面当作现有功能。静态核对，不是浏览器验收；设置页仅核对分类和部分关键流程，并未逐个字段全面审计。

## 结论

主要导航与日常聊天操作已有设计位置，但不能认为功能已经全部覆盖。遗漏集中在复杂状态、辅助流程和多实例切换。样稿中出现按钮也不代表该按钮后的流程完整。

以下「已有」仅表示设计入口或典型演示可找到，不代表正式代码已实现。

| 区域 | 当前覆盖 | 缺口或差异 | 源码定位（相对仓库根目录） |
| --- | --- | --- | --- |
| 新建、搜索、项目展开 | 已有 | 搜索只过滤样例标题；缺加载失败 / 重试和完整键盘选择状态。 | `desktop/src/components/CommandPalette/CommandPalette.tsx` |
| 项目管理 | 已有大部分 | 置顶、隐藏 / 恢复、排序和拖动有位置；任意项目直接在文件管理器打开的能力被缩成仅当前项目入口。 | `desktop/src/components/layout/Sidebar.tsx:1099` |
| 长会话列表与批量操作 | 部分 | 缺每项目「显示更多 / 更少」、项目范围批量选择、Shift 范围选择等完整行为；样稿批量全选直接选中全部样例。 | `desktop/src/components/layout/Sidebar.tsx:898`、`:1018` |
| 会话运行标记 | 部分 | 样稿只为当前会话显示执行中，没有多会话同时运行时的独立状态。 | `desktop/src/components/layout/Sidebar.tsx:1820` |
| 创建位置、分支、worktree | 入口已有 | 缺分支搜索、本地 / 远端 / 已占用区分、加载状态、脏工作区和启动失败反馈。 | `desktop/src/components/shared/RepositoryLaunchControls.tsx:236`、`:431`；`desktop/src/pages/EmptySession.tsx:56` |
| 无服务商首次使用 | 未覆盖 | 原页面提供没有服务商的提示和添加服务商入口；样稿默认配置已就绪。 | `desktop/src/pages/EmptySession.tsx:550` |
| 输入、发送、停止、草稿 | 典型流程已有 | 尚不能代替正式发送 / 停止和跨会话草稿验收。 | `desktop/src/components/chat/ChatInput.tsx:149`、`:540` |
| 附件、粘贴、拖放、引用 | 入口已有 | 只有名称标签；缺图片缩略图 / 放大浏览与附件读取失败状态。 | `desktop/src/components/chat/AttachmentGallery.tsx:24`；`desktop/src/components/chat/ChatInput.tsx:729` |
| 模型、服务商、推理强度、权限 | 入口已有 | 原应用执行中禁用模型切换；成员会话隐藏模型 / 权限等控件。样稿未准确体现这些限制。 | `desktop/src/components/chat/ChatInput.tsx:1055` |
| 上下文用量 | 部分 | 有正常快照，缺加载、失败、实际 / 估算数据来源等状态。 | `desktop/src/components/chat/ContextUsageIndicator.tsx:72` |
| 消息、工具、思考、运行中 | 典型外观已有 | 缺流式、压缩中、工具失败等完整过程；多类型 Markdown / 图片内容未逐类展示。 | `desktop/src/components/chat/MessageList.tsx:1830`、`:1985` |
| 工具授权 | 基本覆盖 | 允许一次、会话内允许、拒绝和完整参数有样稿。 | `desktop/src/components/chat/PermissionDialog.tsx:199` |
| 提问 | 部分 | 只有一个单选问题；原应用支持多题、多选、逐题自由回答、已回答结果。 | `desktop/src/components/chat/AskUserQuestion.tsx:8`、`:237` |
| 复制、引用、分叉 | 入口已有 | 样稿只展示一处固定回复的操作，未完整展示各条消息及失败 / 进行中状态。 | `desktop/src/components/chat/MessageList.tsx:1697`、`:1719` |
| 撤销 / 回退 | 语义不完整 | 样稿写「撤销本轮文件修改」；真实流程还回退对话、恢复原输入及附件，有历史轮次确认和代码无法回退的分支。直接照样稿文案落地会误导用户。 | `desktop/src/components/chat/MessageList.tsx:1635`、`:1869` |
| 任务、团队、目标、记忆事件 | 典型入口已有 | 只有固定任务及一个成员样例，尚未覆盖多成员独立状态、成员会话控件限制、各目标状态。 | `desktop/src/components/teams/TeamStatusBar.tsx`；`desktop/src/pages/ActiveSession.tsx:501` |
| Computer Use 授权 | 只有简化入口 | 按应用授权的弹窗已随 cua-driver 改造删除。cua 的操作走通用权限弹窗，标题和摘要来自 `cuaToolDisplay`（如“允许 Computer Use 点击？”）；系统权限在 Computer Use 设置页处理。 | `desktop/src/components/chat/PermissionDialog.tsx`、`desktop/src/lib/cuaToolDisplay.ts` |
| 文件与差异 | 主要入口已有 | 缺真实目录树、多文件预览切换、Markdown / 图片预览、无变更 / 非 Git / 加载失败状态；关闭其他预览仅显示提示。 | `desktop/src/components/workspace/WorkspacePanel.tsx:1103`、`:1242`、`:1277` |
| 终端 | 部分，且有失效入口 | 有展开、清屏、重启；没有多个终端实例的切换与保留状态。设置弹窗中的打开终端仍使用已删除的 `terminal-tab` 动作，不会执行。 | `desktop/src/components/layout/ContentRouter.tsx:40`；`desktop/src/pages/ActiveSession.tsx:523`；样稿 `settingDetail` / `actions` |
| 面板尺寸 | 未覆盖 | 原版终端和文件工作区可拖动调整尺寸；样稿固定布局。 | `desktop/src/pages/ActiveSession.tsx:521`、`:540` |
| 定时任务 | 入口已有，细节不足 | 缺立即执行、运行记录及输出、完整编辑、每 N 分钟 / 小时、工作日 / 指定日 / 每月 / 自定义 cron、模型权限配置及完成通知。 | `desktop/src/components/tasks/TaskRow.tsx:99`；`NewTaskModal.tsx:66`；`TaskRunsPanel.tsx:103` |
| 设置 | 14 个分类已有 | 大部分是简化表单或通用保存提示，不能视为原设置页全部功能覆盖。需要后续逐页核对，不在本轮重做。 | `desktop/src/pages/Settings.tsx` |
| 应用更新 | 未覆盖 | 缺新版本提醒、说明、下载进度、失败与重启状态。 | `desktop/src/components/shared/UpdateChecker.tsx:28` |

## 已明确取消的内容

- 顶部会话标签栏及其关闭左侧 / 右侧等操作：用户明确认为冗余，不计为遗漏。其背后的运行任务和终端生命周期仍要迁移，不能随视觉标签一起丢弃。
- 会话列表时间文字：用户明确只需要时间参与排序，不计为遗漏。
- 项目标题 / 项目行的「⋯」：用户明确要求收敛，已迁移到集中管理。
- 用户占位栏：无明确用途，已移除。
- 「已归档」：之前源码未核实出对应接通的入口，不应为了补覆盖而添加。

## 优先级建议（尚未授权实施）

先补主聊天页可能阻断工作或误导用户的部分：撤销的真实含义、无服务商 / 启动失败、完整提问、执行中和成员会话的控件限制、后台运行标记、多终端切换及失效终端入口。

再补文件预览、附件预览、Computer Use 授权、面板尺寸和列表规模状态。设置、定时任务、更新可以作为后续独立画板审阅，不需要把全部控件重新堆回聊天主页面。

本轮只完成核对与留存，未修复已发现的样稿问题，也未运行正式应用测试。

## 用户后续取舍（2026-10-17）

此前优先级建议已被用户进一步收敛：先看异常提示和提问三种状态；撤销、文件、定时任务暂缓。多终端的 tab 放在终端区域内部。新增 [状态样稿](./interaction-states.zh.md) 供审阅；原核对表保留作为核对时点记录，不代表这些缺口已实现或验收。
# 后续补充：设置页面（2026-10-17）

用户随后明确要求补画全部设置页面。当前主样稿的 14 个分类已扩展为表单、列表和详情，详见 [设置页记录](./settings-ui.zh.md)。本文件此前的设置缺口描述属于原核对时间点；新增的是可交互演示，不代表真实系统操作、全部异常状态或正式应用实现已经完成。

# 后续补充：对齐 main@ac0ea44（2026-10-18）

- 「无服务商首次使用」已补画：首次启动的导入画面和服务商引导画面，以及没有服务商、没有默认服务商两种提示条。
- 新增的现有功能已补画：从 Claude Code 导入（首次启动及通用设置）、MCP 浏览目录，以及 Skills、Agents 的 Claude Code 来源。
- 已删除的订阅登录也已从样稿中去掉。
- 本表其余缺口仍按 `main@5721c21` 的核对结果记录。正式实现前，应以最新 main 重新核对一次。
