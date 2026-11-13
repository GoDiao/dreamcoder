# UI 视觉重构：与 t3code 对照

日期：2026-11-12。基线：本仓库 `main@f7f14456`；参考项目 `refs/coding-agents/t3code`（浅克隆，只读）。

本笔记是 UI 视觉重构的第一阶段准备：在同一组维度（基础变量、共享组件、主要界面）上对照 t3code 和我们，记录它好在哪、我们差在哪、哪些值得借鉴。只读代码，没有运行任何一方，没有改代码。所有路径：t3code 一侧相对 `refs/coding-agents/t3code/apps/web/src`（文档类相对 t3code 根目录），我们一侧相对 `desktop/src`。

上一轮 UI 刷新（#107，记录在 [design-log.zh.md](./design-log.zh.md)）已经定下的要求仍然有效，比如单行输入条、会话行整行一体、无顶部标签栏、权限名英文。本轮只改视觉，不推翻那些结构决定。

## 一、总体判断

t3code 的「精致感」主要来自四件事，按影响大小排：

1. **尺寸体系小而统一。** 控件高度只有几档（28/32/36px），圆角统一 8px，所有控件、菜单行、输入框共用这几档。我们控件高度相近，但圆角偏大（14px），并且大量页面绕开共享组件手写尺寸和颜色。
2. **颜色层级少而克制。** 一套语义色（background / card / popover / muted / accent / border / input），浅色走 zinc 中性灰，深色是纯黑底加白色透明度叠出层次。我们有 7 套主题，每套一百多个变量，其中很多是某个功能专用的颜色和固定透明度副本。
3. **细节质感。** 按钮和输入框带 1px 内高光/内阴影、按下缩到 0.97、菜单和弹窗用毛玻璃加长软阴影、图标描边 1.75。我们的按钮是平的，弹层只有一层投影。
4. **规则约束外观。** `components/ui` 的组件只能通过 `variant`/`size` 选外观，调用处不许用 `className` 改样式，lint 强制。我们没有这条规则，调用处覆盖样式很普遍。

## 二、基础变量

| 维度 | t3code | 我们 | 差距与建议 |
| --- | --- | --- | --- |
| 圆角 | 一个 `--radius: 0.5rem`（`index.css:1115`），`sm/md/lg/xl/2xl/3xl` 由它加减 4px 推出（`index.css:289-294`）；控件另有 `--control-radius: 0.5rem`（`index.css:103`）。按钮、输入、菜单都是 8px，弹窗 `rounded-2xl`（16px，`components/ui/dialog-styles.ts:10`）。 | `--radius-sm/md/lg/xl` 写死为 6/10/14/18px（`theme/globals.css:310-313`），并且写在 `:root` 里，覆盖了 Tailwind 的同名变量，所以全应用的 `rounded-lg` 实际是 14px：32px 高的按钮（`components/shared/ui/button.tsx:8`）、输入框（`ui/input.tsx:10`）和菜单（`ui/dropdown-menu.tsx:38`）都接近胶囊形。业务代码里还有 `rounded-[4px]`/`[6px]`/`[7px]`/`[8px]`/`[10px]`/`[12px]` 等任意值约 40 处。 | **差距最大的一项。** 建议改为一个基准半径推出各档，控件 8px 左右，弹窗/卡片大一档；任意值圆角收回到档位。 |
| 控件尺寸 | 语义尺寸变量：`--sidebar-content-inset`、`--sidebar-row-content-inset`、`--command-shell-inset`、`--floating-content-inset`、`--workspace-topbar-height: 52px`、`--chat-content-max-width: 46rem` 等（`index.css:103-139`）。注释写明目的：让侧栏、命令面板、提示、工具栏的控件不会各自漂移（`index.css:99-102`）。 | 只有外壳尺寸：`--sidebar-width: 280px`、`--titlebar-height: 44px`、`--statusbar-height: 36px`（`theme/globals.css:169-175`）。行高、内边距、内容最大宽度散在各组件里。 | 值得借鉴：把「侧栏行内边距」「浮层内边距」「聊天内容最大宽度」「顶栏高度」做成语义变量，侧栏、命令面板、菜单共用。 |
| 字号 | 用 Tailwind 原生 `xs/sm/base`，额外补了 `2xs`(11px)、`3xs`(10px) 等更小档（`index.css:183-190`），并注册进 `tailwind-merge`。桌面正文 14px（控件 `text-base sm:text-sm`，`components/ui/button.tsx:9`）。 | 已有 `--text-ui-aux/nav/body/message/title` = 12/13/14/16/20px（`theme/globals.css:1606-1612`），但业务代码里只用了 87 次；同时有 365 处任意字号 `text-[11px]`(150)、`text-[13px]`(71)、`text-[12px]`(65)、`text-[10px]`(53) 等，另有 250 处 `text-xs`、134 处 `text-sm`。同一个 11px 有三种写法。 | 字号档位本身够用，问题在没被采用。建议把任意字号全部收进档位（补一个 11px 档），然后不再允许 `text-[Npx]`。 |
| 颜色结构 | 一层语义色（`index.css:1113-1229`），浅色基于 zinc，深色画布纯黑 `#000`，表面用 `neutral-950` 掺 3% 白（`index.css:1192-1199`），次级表面全用白色透明度 3%/4%，边框 8%、输入框边框 11%（`index.css:1200-1213`）。多主题只覆盖一组 `--app-theme-*` 变量（`index.css:1325-1383`）。另有一层 `--contrast-*` 统一做对比度调节（`index.css:1601-1660`）。 | 两层：Material 风格的 `--color-surface-container-*` 等，再映射到 shadcn 的 `--background/--card/...`（`theme/globals.css:27-47`）。7 套主题（light/white/dark/dreamfield/amber/midnight/aurora，`theme/colorScheme.ts`），每套都重写一百多个变量，包括功能专用色（`--color-inspector-*`、`--color-activity-*`、`--color-memory-*`，`theme/globals.css:185-239`）和固定透明度副本（`--color-text-primary-a88` 等，`theme/globals.css:299-308`）。light 和 dark 还在文件末尾被整体再覆盖一次（`theme/globals.css:1614-1718`）。业务代码直接写 `[var(--color-…)]` 1902 处，用 `ui-` 语义色只有 149 处。 | 浅色暖灰、深色暖炭是我们上一轮刻意选的，不必照搬 t3 的 zinc/纯黑。值得借鉴的是**结构**：语义色少、次级层级用前景色透明度叠出来、主题只覆盖少量基色。是否保留 7 套主题、是否把功能专用色收回语义色，需要维护者决定。 |
| 阴影 | 少而具体：`--shadow-composer`（浅色 `0 1px 2px /5%`，深色 `0 14px 32px -18px /75%`，`index.css:198-199`）；按钮内高光 `inset 0 1px white/16%`、按下 `black/8%`（`index.css:193-194`）；弹窗 `0 24px 64px -24px`（`index.css:430`）；菜单 `0 16px 40px -18px`（`components/ui/menu.tsx:58`）。负扩散让阴影收在下方，不晕开。 | `--shadow-dropdown` 两层外扩投影（`theme/globals.css:1650`、`:1713`），弹层统一用它加 `ring-1 ring-foreground/10`（`ui/dropdown-menu.tsx:38`、`ui/popover.tsx:33`）；按钮无阴影，主按钮用渐变变量但已压成纯色（`theme/globals.css:1652`）。 | 借鉴：负扩散的长软阴影 + 1px 内高光，深浅主题各一组。 |
| 毛玻璃 | `surface-glass`、`dialog-glass`、`dropdown-glass` 三个工具类，背景 80% 不透明 + blur 12/16px + 饱和度 1.14（`index.css:119-121`、`:364-467`），并有不支持时的纯色回退。 | `.glass-panel` 一个类，blur 20px（`theme/globals.css:1139-1145`）；但 light/dark 末尾把 `--color-surface-glass` 改成了不透明色（`theme/globals.css:1648`、`:1694`），实际已无玻璃效果。 | 可选。菜单、命令面板、弹窗的轻毛玻璃是 t3 观感的一部分，要不要做由维护者看图决定。 |
| 动效 | 变量只有一个缓动 `--ease-drawer: cubic-bezier(0.32,0.72,0,1)`（`index.css:195`）。弹层 `scale-98 + opacity`，200ms（`components/ui/dialog-styles.ts:8`、`components/ui/tooltip.tsx:143`）。按钮按下 `scale-[0.97]`（`components/ui/button.tsx:9`）。循环动画全部用 `steps()` 降帧，避免高刷屏一直重绘（`index.css:224-227`、`:295-361`），AGENTS.md 明令禁止持续重绘的动画（`AGENTS.md:207`）。 | `--motion-fast 150ms`、`--motion-medium 220ms`、侧栏 280ms，统一一条 ease-out（`theme/globals.css:176-180`）；弹层只有淡入淡出（`theme/globals.css:1388-1420`）；按钮按下 `translate-y-px`（`ui/button.tsx:8`）。有若干连续动画：`shimmer`、`pulse-dot`、`composer-drop-pulse`（`theme/globals.css:1584-1601`、`:1153`）。 | 借鉴：弹层加 2% 缩放、按钮按下微缩；连续动画改成 `steps()` 或静态。时长档位我们已有，够用。 |
| 图标 | 全局把 lucide 描边从 2 改为 1.75（`index.css:1728-1732`）；按钮里图标颜色默认用弱化色，通过 `--control-icon-color` 统一（`components/ui/button.tsx:9`、`:51`）。 | lucide 默认描边 2；图标颜色由各处自己写。 | 借鉴，改动小、效果明显。 |
| 纹理 | 全局 3.5% 噪点背景（`index.css:1768-1785`）。 | 无。 | 可选，偏风格化，看维护者喜好。 |

## 三、共享组件

| 组件 | t3code | 我们 | 差距与建议 |
| --- | --- | --- | --- |
| 规则 | `components/ui` 的导出「自己拥有外观」，只许选 `variant`/`size`，调用处 `className` 只能放布局；没有合适的就给组件加 variant（`AGENTS.md:197`）。lint `shadcn/no-restyle` 强制（`vite.config.ts:559-571`，依赖 `@shadcn/lint`）。不许用原生 `<button>` 等手写出看起来像共享控件的东西（`docs/internals/web-ui.md:8-10`）。 | 只有「复用共享组件」的原则，没有外观归属的规则。279 处 `<Button>` 里约 60 处传了 `className`，覆盖的多是颜色（`text-[var(--color-text-…)]`）、圆角、内边距、高度；另有 73 处原生 `<button>` 手写样式。 | **最值得借鉴的一条。** 建议把这条写进我们的 AGENTS.md。是否引入 `@shadcn/lint` 做强制是加依赖，需要先讨论。 |
| 组合方式 | 复杂组件导出一组小插槽（slots），插槽自带样式，变体和密度是 `Root` 的属性；调用方几行拼出来。参考实现是 `components/chat/ComposerBanner.tsx`（`docs/internals/web-ui.md:24-39`）。 | 有组合组件（`Modal`、`Dropdown`、`ActionMenu` 等，`components/README.md:54-75`），但输入框上方的各种提示条、卡片各写各的。 | 借鉴：输入框上方的提示条（无服务商、分支失效、权限请求等）统一做成一套插槽组件。 |
| Button | 尺寸 14 档，桌面高度 20/24/28/32/36/40px（`components/ui/button.tsx:16-42`），触屏自动大一档（`h-9 sm:h-8`）。变体含 `ghost-muted`、`ghost-destructive`、`outline`、`glass` 等（`:43-70`）。质感：内高光、`before` 伪元素做 1px 阴影、按下 0.97、禁用 64% 透明度、触屏最小 44px 命中区（`:9`、`:45`、`:64`）。另有 `InlineButton` 处理文字链接式按钮（`:103-139`）。 | 尺寸 10 档，高度 24/28/32/36/44px（`ui/button.tsx:25-38`），桌面和触屏同高；变体 7 个，无「弱化 ghost」，所以各处用 `className` 把 ghost 的文字改灰（`ui/button.tsx:11-24`）。圆角 14px，无内高光，按下下沉 1px。 | 高度档位接近，主要差圆角、质感和缺少 `ghost-muted` 一类变体。 |
| Input | 输入框外层是带 `before` 内阴影的容器，聚焦时边框变主色加淡色光环（`components/ui/input.tsx:64`）；桌面高 30px，`sm`/`compact` 两档（`:22-24`）。 | 32px，`rounded-lg`（14px），聚焦是 3px 光环（`ui/input.tsx:10`）。 | 统一到控件圆角；聚焦光环收细。 |
| 菜单 | 毛玻璃背景、`rounded-lg`(8px)、长软阴影（`components/ui/menu.tsx:58`）；菜单项桌面 28px 高、14px 字、图标 16px 且默认弱化色 80% 透明（`:132`）；带复选的项内嵌一个迷你开关（`:191-194`）；快捷键提示右对齐、宽字距（`:301`）。 | 不透明背景、14px 圆角、`ring-1` 描边（`ui/dropdown-menu.tsx:38`）；菜单项 `py-1 text-sm`，约 28px（`ui/dropdown-menu.tsx:60`）。 | 菜单行高已接近；差在圆角、背景质感、图标弱化。 |
| Tooltip | 与弹层同色（`bg-popover` + 边框 + `shadow-md/5`），圆角 6px、12px 字，进出 `scale-98 + opacity`（`components/ui/tooltip.tsx:143-146`）。 | 反色（深底浅字）+ 箭头（`ui/tooltip.tsx:53`、`:59`）。 | 风格选择，看维护者喜好。t3 的做法更安静。 |
| Dialog | 毛玻璃 + 16px 圆角 + 长阴影（`components/ui/dialog-styles.ts:10`、`index.css:425-442`），遮罩是背景色 60% + 4px 模糊（`index.css:444-452`）；嵌套弹窗逐层缩小、下移（`dialog-styles.ts:8`）；手机宽度变成贴底全宽（`:14`）。 | 不透明、`rounded-xl`（18px）、`ring-1`，遮罩是暖黑 48% + `backdrop-blur-xs`（`ui/dialog.tsx:29`、`:53`）。 | 借鉴遮罩做法（用背景色而不是黑色压暗，浅色主题更干净）和手机贴底。 |
| Badge / Kbd | Badge 多档尺寸（`components/ui/badge.tsx:17-22`），有一个按任意颜色生成浅底深字的 `label` 变体（`:35`）；Kbd 20px 高、无底色（`components/ui/kbd.tsx:16`）。 | 无 Badge 组件，各处手写；Kbd 带 `bg-muted` 底色（`ui/kbd.tsx:8`）。 | 建议补一个 Badge 原语，收拢各处手写的标签。 |

## 四、主要界面

t3code 的界面有一个共同点：同一类控件在不同界面长得完全一样。例如右侧面板的标签和终端列表的行，都是 `h-6 rounded-md text-xs`、选中 `bg-accent`、悬停 `bg-accent/60`（`components/RightPanelTabs.tsx:1016-1020`、`components/ThreadTerminalDrawer.tsx:1449-1453`）。我们正相反：同一类控件在不同界面的高度、圆角、悬停色都不一样（见每节「我们」一列）。

### 侧栏

| t3code | 我们 | 值得借鉴 |
| --- | --- | --- |
| 会话行固定 `h-9`（36px）、`px-2.5`、`rounded-md`、标题 `text-sm`（`components/sidebar/SidebarThreadRow.tsx:1242`、`:966`、`:1037`）。浅色下选中行是白底加 1px 内描边（`:971-974`），未选中行的前置图标是 40% 透明加去色，悬停才恢复（`:1260`）。行内操作默认隐藏、悬停淡入（`:1349`）。 | 会话行 `min-h-[30px] text-ui-nav`（13px）（`components/layout/Sidebar.tsx:958`），圆角 8px（`theme/globals.css:1487`）；顶部导航按钮却是 `rounded-[12px] py-2.5`（约 40px）（`Sidebar.tsx:1548`）；侧栏收起/展开按钮一个 `h-11 rounded-xl`、一个 `h-8 rounded-full`（`Sidebar.tsx:628`、`:639`）。同一个侧栏里有 5、6、7、8、12px 和 full 多种圆角。 | 行高、圆角、内边距统一成一档；未选中图标弱化、选中行「白底 + 细描边」的层次。行高本身上一轮要求过压低（U16），36px 是否可接受要维护者看图。 |
| 项目（文件夹）头 `h-8`、名称 `text-sm font-medium`、计数 `text-xs tabular-nums`（`components/sidebar/SidebarProjectFolderHeader.tsx:76-88`）；分组标题是一行小字加一条 `h-px` 细线和小箭头（`components/ui/collapsible-section-header.tsx:30-44`）。 | 项目行 `text-ui-aux`（12px）次级色（`Sidebar.tsx:849`）；「项目」分组标题 `text-ui-aux font-semibold`（`Sidebar.tsx:1170-1172`）。 | 分组标题加细线的做法比单纯小字更有结构感。 |
| 状态点 `size-1.5`，运行中用阶梯式脉冲（`index.css:226`、`:332-346`）；改动行数用等宽字体加增删色（`SidebarThreadRow.tsx:1184-1186`）。 | 运行中是持续旋转的 `LoaderCircle`（`Sidebar.tsx:1482-1487`）；批量选择的复选框是手写的（`Sidebar.tsx:963-970`），没用 `ui/checkbox`。 | 运行状态改成静态点或降帧脉冲；复选框换共享组件。 |

### 输入框

| t3code | 我们 | 值得借鉴 |
| --- | --- | --- |
| 宽度用 `--chat-content-max-width`（46rem），和时间线同一个变量（`components/chat/ComposerSurface.tsx:15`、`index.css:952-957`）。 | 输入框 `max-w-[760px]`（`components/chat/ChatInput.tsx:963`），时间线 `max-w-[860px]`（`components/chat/MessageList.tsx:1935`），两边不对齐。 | 用一个变量统一内容宽度。 |
| 卡片 `rounded-2xl`，1px 外描边（浅色黑 8%、深色白 5%）加极轻阴影 `0 1px 2px /5%`，深色不用阴影（`ComposerSurface.tsx:14-16`、`:41`、`index.css:198`）。 | `glass-panel rounded-2xl`（`components/chat/ComposerShell.tsx:70`），阴影用的是弹层的 `--shadow-dropdown`（`theme/globals.css:1144`），所以输入框像一个浮起来的菜单。 | 输入框用自己更轻的阴影，深色主题靠描边而不是阴影。 |
| 底部工具栏控件是专用的 `ComposerControl`：高 28/24px、8px 圆角、文字 80%/70% 前景色、图标弱化、按下 0.97（`components/chat/ComposerControl.tsx:10-22`）。发送按钮圆形，带内高光，悬停放大 5%（`components/chat/ComposerPrimaryActions.tsx:309`）。 | 权限、模型选择器共用 `PICKER_TRIGGER_CLASS`：`h-7 rounded-[7px] text-ui-aux`（`components/controls/controlStyles.ts:2`），一个基于 `Button`、一个基于 `SelectTrigger` 再覆盖圆角（`components/controls/ModelSelector.tsx:16`）；悬停色是 `--color-surface-hover`，而共享 ghost 按钮是 `ui-muted`、菜单项是 `ui-accent`。 | 把「输入框工具栏控件」做成一个变体（而不是共享的 className 字符串），悬停色和其他 ghost 控件统一。 |
| 输入框上方的提示条统一用 `ComposerBanner` 插槽，可贴在输入框顶上（向下压 1rem 被输入框盖住）或独立；五种语气、三档密度（`components/chat/ComposerBanner.tsx:10`、`:49-76`、`:92-94`）；出现只淡入（`components/chat/ComposerBannerStack.tsx:31`）。 | 各写各的：无服务商卡片 `rounded-2xl min-h-[78px]` 并把 xs 按钮强行改成 `h-8 text-[13px]`（`components/chat/ProviderRequiredNotice.tsx:34`、`:46`）；工作目录警告 `rounded-lg text-[11px]`（`ChatInput.tsx:980`）；排队消息/任务条 `rounded-lg max-w-[860px]`（`components/chat/ChatTraceBar.tsx:7`）。 | **建议重点借鉴。** 做一套提示条插槽，所有输入框周边的提示都用它。 |

### 对话时间线

| t3code | 我们 | 值得借鉴 |
| --- | --- | --- |
| 用户消息 `rounded-2xl max-w-[80%]`，连续消息相邻处的角收成 6px（`components/chat/TimelineUserMessageRow.tsx:865-868`）；背景比画布深一档（`index.css:1139-1140`）。助手消息无气泡（`components/chat/TimelineAssistantRows.tsx:40`）。 | 用户消息 `rounded-xl rounded-br-sm`，14px 字（`components/chat/UserMessage.tsx:39`）；助手消息 16px（`components/chat/AssistantMessage.tsx:29`）。用户 14px、助手 16px 字号不一致。 | 两者结构已经接近。字号是否统一需要维护者决定（上一轮把回复定为 16px）。 |
| 工具行：`rounded-md`、图标 `size-4` 弱化色、文字 `text-sm`、标签用次级色，展开箭头 70% 透明（`components/chat/TimelineWorkEntryRow.tsx:396-405`、`:459`、`:548-550`）。正在运行的工具名用降帧的扫光（`live-tool-shine`，2.2s `steps(30)`，只在可见且未关闭减少动效时跑，`index.css:551-576`）。 | 工具行 `min-h-7`，图标 14px，摘要 `font-mono text-[11px]`，等待中 `text-[10px]`（`components/chat/ToolCallBlock.tsx:68-92`）；复制按钮手写 `text-[10px]`（`ToolCallBlock.tsx:233`）；结果标题 `text-[10px] uppercase tracking-[0.18em]`（`:351-373`）。思考块标题运行时 2s 连续扫光（`theme/globals.css:1740-1752`）。记忆卡片在两处各写一份（`MessageList.tsx:217`、`ToolCallGroup.tsx:269`）。 | 工具行字号收进档位；扫光改降帧；重复的卡片合一。 |
| 左侧小地图：每条消息一根 2px 横线，离当前位置越远越短，悬停弹出毛玻璃预览卡；只在精确指针下显示（`components/chat/TimelineMinimap.tsx:108-111`、`:202-214`、`:229-232`）。 | 无。 | 这是新功能，不算视觉重构，单独评估。 |
| 系统分隔线是 `h-px` 细线加小字（`components/chat/MessagesTimeline.tsx:1494-1498`）。 | 重试提示用写死的 Tailwind amber 色（`components/chat/StreamingIndicator.tsx:62-64`）；回到底部按钮是手写的（`MessageList.tsx:1991`）。 | 换成主题 token 和共享按钮。 |

### 右侧面板

| t3code | 我们 | 值得借鉴 |
| --- | --- | --- |
| 标签栏高度就是顶栏高度 52px（`components/RightPanelTabs.tsx:1341`）；标签 `h-6 rounded-md text-xs`，选中只换底色，无下划线、无边框（`:1016-1020`）。 | 标签用共享 `TabsList variant="line"`，但每个标签外面又包一层手写 `<span>`，`rounded-[6px]`、`text-[11px]`，并把共享组件的下划线 `after:hidden` 掉（`components/workspace/WorkspacePanel.tsx:1168-1200`）；关闭按钮 `rounded-[4px]`。 | 给 `tabs` 加一个「药丸」变体，面板标签、终端标签都用它，删掉手写外壳。 |
| 面板与主区之间只有 `border-l`，标题行有 `border-b`（`components/DiffPanelShell.tsx:16`、`:30-34`）。 | 同样是 `border-l`（`components/workspace/WorkspaceSplit.tsx:18-21`），标题行 44px（`hooks/useTitleRow.ts:9-14`）。 | 已接近。 |

### 终端

| t3code | 我们 | 值得借鉴 |
| --- | --- | --- |
| 底部抽屉，默认 280px，最小 180px（`components/ThreadTerminalDrawer.tsx:111-112`）；没有传统标题栏，右上角浮一个小工具条（`:1848-1891`）；终端背景跟随主题 `--terminal-background`（浅色主题是浅色终端，`index.css:1182-1185`、`:1226-1227`）。 | 在右侧面板的标签里（上一轮的决定）；xterm 主题是写死的对象，背景 `#121212`（`pages/TerminalSettings.tsx:149-169`），和外层容器的 `--color-terminal-bg`（`theme/globals.css:288`）不是同一个颜色，也不跟主题变。 | 终端配色接入主题 token，至少让外框和画布同色。位置不变。 |

### 命令面板与菜单

| t3code | 我们 | 值得借鉴 |
| --- | --- | --- |
| 毛玻璃弹窗 `rounded-2xl`，顶部对齐（距顶 10vh），`max-w-xl`（`components/ui/command.tsx:48`、`:77`）；输入框无边框无底色（`:115-122`）；行 28px，高亮 `bg-foreground/[0.09]`（`:198`）；底部一条快捷键说明栏，浅底细线（`:228`）；快捷键提示宽字距右对齐（`:215`）。 | 共享 `Dialog` 居中、`sm:max-w-[600px]`、`rounded-xl`、无阴影（`components/CommandPalette/CommandPalette.tsx:42`、`components/shared/ui/dialog.tsx:53`）；行 `py-3`（约 44px）（`CommandPalette.tsx:62-70`）；`Select` 项高亮用 `ui-muted`，菜单项用 `ui-accent`，两者不同（`components/shared/ui/select.tsx:101`、`ui/dropdown-menu.tsx:60`）。 | 命令面板顶部对齐、行高压到 28–32px、底部快捷键栏；高亮色统一。 |
| 菜单 `rounded-lg`（8px）毛玻璃，长软阴影（`components/ui/menu.tsx:58`）。 | 菜单 14px 圆角、不透明（`ui/dropdown-menu.tsx:38`）；内容类写 `duration-100`，而进出动画是 150ms（`theme/globals.css:1414`），两处时长不一致。 | 同第三节。 |

### 顶栏

| t3code | 我们 | 值得借鉴 |
| --- | --- | --- |
| 顶栏 52px 一个变量，侧栏头、聊天头、右侧面板标签栏、提示位置全部共用（`index.css:123`；使用处见 `components/ChatView.tsx:3291`、`components/RightPanelTabs.tsx:1341`、`components/sidebar/SidebarChrome.tsx:62`）。聊天头无下边框，内容滚到下面时渐隐 1.5rem（`index.css:130`、`components/chat/MessagesTimeline.tsx:161`）。标题 `text-sm font-medium`，项目名是弱化色的面包屑（`components/chat/ChatHeader.tsx:270-275`、`:327`）。 | 已有 `--titlebar-height` 44px 统一（`theme/globals.css:173`、`hooks/useTitleRow.ts:9-14`）；mac 下多处用内联 `style` 写这个高度（`components/layout/AppShell.tsx:390`、`Sidebar.tsx:596`）。 | 顶栏去掉下边框改成滚动渐隐，观感更「一整块」。 |

## 五、综合：值得借鉴的，按建议顺序

和任务建议的顺序一致：先基础变量，再共享组件，最后逐页。每一步都要在亮色、暗色，中英文，以及 H5 宽度下检查。下面每条都只改外观，不改功能。

**第一步：基础变量**

1. 圆角：改为一个基准半径推出各档，控件约 8px、弹层/卡片大一档；去掉 `:root` 里写死的 6/10/14/18（`theme/globals.css:310-313`）。这一条改完全应用立刻变化最大。
2. 字号：沿用已有 `text-ui-*` 档位，补 11px 一档；把 365 处 `text-[Npx]` 收进档位。
3. 语义尺寸变量：内容最大宽度、侧栏行内边距、浮层内边距、控件高度。
4. 阴影：弹层一组（负扩散长软阴影），输入框一组（极轻），按钮内高光一组；深浅主题各一份。
5. 动效：弹层进出加 2% 缩放、按钮按下微缩；连续循环动画改降帧或静态；统一 `duration-100` 和 150ms 的不一致。
6. 图标描边全局 1.75。

**第二步：共享组件**

7. 写进 AGENTS.md：共享组件外观只能通过 `variant`/`size` 选，调用处 `className` 只放布局。
8. Button 补 `ghost-muted` 类变体和内高光质感；Tabs 补药丸变体；补 Badge；Tooltip、Dialog 遮罩按维护者选的风格调。
9. 输入框周边提示条做成一套插槽组件。

**第三步：逐页**

10. 侧栏、输入框、时间线、右侧面板、终端、命令面板，按上面各节逐个收敛：删手写按钮/标签外壳、统一悬停色和行高、写死颜色换 token。

## 六、需要维护者决定的事

1. **喜欢 t3code 的哪些界面和地方。** 请截图指出。尤其是：毛玻璃菜单/弹窗要不要、噪点纹理要不要、深色主题要不要走「纯黑底 + 白色透明度」的路线。
2. **配色方向。** 保持我们上一轮的暖灰/暖炭（只借鉴结构），还是向 t3 的中性 zinc 靠。
3. **7 套主题是否保留。** 每套一百多个变量，是维护成本最大的部分。如果保留，建议主题只覆盖少量基色，其余由语义色推出。
4. **行高。** 侧栏会话行我们 30px、t3 36px；命令面板行我们约 44px、t3 28px。上一轮要求过压低会话行（U16）。
5. **强制规则。** 是否引入 `@shadcn/lint` 的 `no-restyle` 规则做 lint 强制（新依赖，需要讨论），还是只写进 AGENTS.md 靠审查。
6. **用户消息和回复的字号。** 现在 14px 对 16px。

## 七、维护者方向（2026-11-12）

维护者给了一张 t3code 深色主题的截图，指明喜欢的是**右侧面板**（浏览器、终端等「surface」所在的那一栏），不是左侧会话栏。逐块对照如下（t3code 路径同前，我们的在 `desktop/src/components/workspace/WorkspacePanel.tsx`）：

| 区块 | t3code | 我们 |
| --- | --- | --- |
| 空面板（启动器） | 内容在面板里**垂直水平居中**，宽度上限 `max-w-xs`；一行 14px 标题「Open a surface」，下面一列行：每行 `h-8`、8px 圆角、16px 图标 + 名称 + 右侧单字母 `Kbd`，悬停 `bg-accent/60`（`components/RightPanelTabs.tsx:480-518`）。不可用的项不隐藏，50% 透明，悬停说明原因（`:546-561`）。浏览器有多个配置时行内多一个小箭头（`:519-544`）。 | 顶部对齐，`px-4 py-5`；先一个地址输入框，下面三列网格的大方块按钮（outline、图标在上、12px 字），再下面「最近」列表（`:980-1022`）。 |
| 快捷键 | 启动器打开时按 B/T/F/D… 直接打开对应项，方向键 + 回车也能选（`:418-459`）。 | 无。 |
| 标签栏 | 就在顶栏那一行（52px），**没有下边框**；标签 `h-6 rounded-md text-xs`，选中 `bg-accent`，未选中弱化色、悬停 `bg-accent/60`（`:1016-1020`、`:1341`）。可拖动排序，溢出时横向滚动并两端渐隐（`:1349-1358`）。 | 标题行 44px，有 `border-b`（`:1154`）；标签是共享 `TabsList` 外再包手写 `<span>`，`rounded-[6px]`、`text-[11px]`，关掉共享组件的下划线（`:1168-1200`）。 |
| 关闭按钮 | 平时显示该标签的图标，鼠标移到标签上时图标换成 ×，不额外占宽度（`components/ui/panel-tab-close-button.tsx:21-28`）。 | 图标在左、× 在右，常驻（`:1188`、`:1192-1199`）。 |
| 「+」 | 弹出菜单，菜单项就是启动器里那几项（`:1399-1440`）。 | 新开一个「新标签」启动器标签页（`:1207`）。 |
| 右上角控件 | 展开、底部终端开关、右侧面板开关；开关用 `Toggle`，打开时有按下底色（`components/chat/PanelLayoutControls.tsx:92-125`、`:152-162`）。 | 新标签、展开、关闭面板三个 `icon-sm` ghost 按钮（`:1205-1221`）。 |
| 与主区的分隔 | 只有一条 `border-l`（`components/preview/PreviewPanelShell.tsx:162`），面板与主区同底色。 | 同样 `border-l`（`WorkspaceSplit.tsx:19`）。 |

t3code 的「Pull request」「Device」「Side chat」是我们没有的功能，不在视觉重构范围内。

## 八、右侧面板里的各个页面（2026-11-12）

维护者补充：面板里各页面的样式也在喜欢之列，包括终端和浏览器。t3code 路径相对 `apps/web/src`；我们的相对 `desktop/src`，`WP` = `components/workspace/WorkspacePanel.tsx`，`TS` = `pages/TerminalSettings.tsx`。

### 共同做法：页面不自带「框」

t3code 每个页面顶部都有一条子工具栏，打同一个标记 `data-surface-subheader`。独立显示时 40px 高、带下边框（`components/preview/PreviewChromeRow.tsx:94`、`components/files/fileSurfaceChrome.tsx:10-11`）。放进右侧面板后，一条全局规则把它压成 28px，边框改透明，下面留 12px（`index.css:945-950`）。所以在面板里，标签栏、工具栏、内容三层之间没有一条横线，页面内容也不套边框和圆角，直接铺满。代码、差异、文件树的底色都用同一个 `--code-background`（`lib/diffRendering.ts:277`）。

我们正相反，每页各自加框：文件预览和差异外面套 `rounded-[7px] border`（`WP:549`），终端套 `rounded-[8px] border`（`TS:338`），浏览器工具栏 `border-b`（`components/workspace/BrowserView.tsx:160`），Artifacts 标题栏也是 `border-b`（`components/workspace/ArtifactsView.tsx:209`），文件页筛选行却没有边框（`WP:745`）。各页左右留白有 `px-2`、`px-3`、`p-3` 三种。

### 浏览器

| t3code | 我们 |
| --- | --- |
| 地址栏是「幽灵」输入框：平时无边框无底色，悬停淡底，聚焦才出边框和 3px 内光环；聚焦时全选网址；28px 高、8px 圆角（`components/preview/PreviewChromeRow.tsx:153`、`:164`，`components/ui/input-group.tsx:8`、`:25`）。「在系统浏览器打开」按钮平时隐藏，悬停地址栏才出现（`PreviewChromeRow.tsx:191`）。 | 普通 `Input`，常驻边框，14px 圆角，`h-7` 靠 className 覆盖（`BrowserView.tsx:184`、`components/shared/ui/input.tsx:10`）。 |
| 加载时工具栏底部一条 2px 主色进度条，带微光，5.3s 缓出，减少动效时静止（`PreviewChromeRow.tsx:290-295`、`index.css:2390-2422`）。 | 没有加载指示，只把刷新换成停止（`BrowserView.tsx:167-176`）。 |
| 导航按钮 `ghost icon-xs`，按下态切 `secondary` 并给图标上主色（`PreviewChromeRow.tsx:101-137`、`:218-228`）。 | 本地 `ToolbarButton` 包共享 `Button`，`icon-sm`，按下态 `secondary`（`BrowserView.tsx:61-76`）。已接近。 |
| 打不开页面时整页错误页：大标题、错误码小字、浅底详情框、操作按钮（`components/preview/PreviewUnreachable.tsx:61-107`）。 | 只有顶部一条提示栏，没有错误语气（`BrowserView.tsx:248`）。 |

### 终端

t3code 用 Ghostty WASM 画终端，我们用 xterm；渲染器不换，只借外观。

| t3code | 我们 |
| --- | --- |
| 没有标题栏。单个终端时右上角浮一个小工具组（分屏、新建、删除），`rounded-md border bg-background shadow-xs`，按钮 `p-1`、图标 13px（`components/ThreadTerminalDrawer.tsx:1848-1862`）。 | 终端上方一行工具栏（清屏、重启），下面一行 11px 灰字说明，再下面才是终端（`TS:305-326`）。 |
| 终端颜色来自主题变量 `--terminal-background/foreground/cursor/selection-background`；浅色主题下终端就是浅底深字，和应用同底色（`index.css:1182-1185`、`:1226-1227`；读取处 `ThreadTerminalDrawer.tsx:326-371`）。 | xterm 主题写死：背景 `#121212`、前景 `#d7d2d0`、16 色全是固定值，所有主题都一样（`TS:149-169`）；外框又用 `--color-terminal-bg`（浅色主题 `#1E1B18`），和画布不是同一个颜色（`TS:338`、`theme/globals.css:288`）。滚动条颜色也写死（`theme/globals.css:105-107`）。 |
| 画布四周只留 4px（`terminal/ghostty/surface.ts:35`），滚动条是 6px 的细条，颜色跟主题（`surface.ts:699-708`、`index.css:92-98`）。 | 外框内 `px-2 pb-2 pt-1.5`，外面再 `p-3`（`TS:343`、`:305`）。 |
| 多个终端时右侧一列 144px 的终端列表，行 `h-6 rounded-md text-xs`，和面板标签同一个样子（`ThreadTerminalDrawer.tsx:1901`、`:1450-1453`）；分屏之间只有细线（`:1347-1351`）。 | 多个终端只能通过面板标签切换（`WP:1224-1228`）。 |

### 文件

| t3code | 我们 |
| --- | --- |
| 目录树用 Pierre 的紧凑密度，12px 字，彩色文件图标，选中 12%、悬停 7% 的前景色透明叠加，背景透明（`components/files/FileBrowserPanel.tsx:269-273`、`pierre-tree-theme.ts:5-14`）。 | 自己写的树：`Button size="row"` 再用 className 把内边距、圆角改成 `rounded-[6px] py-[7px] text-[12px]`（`WP:379`、`:460-469`），缩进写在内联 style（`WP:458`）；图标统一灰色 13px（`WP:477`、`:491-495`）。 |
| 预览顶部是可点的面包屑路径，溢出时两端渐隐（`components/files/FilePreviewPanel.tsx:1263-1272`、`components/files/FileBreadcrumbs.tsx:281-334`）。 | 一行 11px 灰色路径文字（`WP:635`）。 |
| 加载、失败、提示三种状态做成共享小组件（`fileSurfaceChrome.tsx:109-145`）。 | 文件、变更、Artifacts 用 `PanelMessage`（`components/workspace/PanelStates.tsx:16-33`），浏览器和终端各写各的（`BrowserView.tsx:261`、`TS:289`）。 |

### 差异

| t3code | 我们 |
| --- | --- |
| 每个文件一个 32px 吸顶标题行：12px 无衬线文件名、11px 等宽增删数；悬停左侧出现 3px 色条；代码区淡入 200ms（`components/diffs/StyledDiffCodeView.tsx:97-119`、`:170-214`）。 | 列表行之间 `border-t` 分隔（`WP:397`），Pierre 自带标题隐藏（`components/shared/PierreDiffSurface.tsx:17`）；增删数 11px 等宽，颜色走 token（`WP:412-414`），已接近。 |
| 增删底色由 `--code-background` 和成功/错误色按比例混出，浅深主题各一组比例；可切蓝橙配色（`lib/diffRendering.ts:286-327`、`index.css:2287-2309`）。 | `pierre.css` 映射到每个主题单独写死的 `--color-diff-*`（`components/shared/pierre.css:3-24`、`theme/globals.css:273-285`）。语法高亮固定 `github-light/dark`（`PierreDiffSurface.tsx:20`）。 |

### 归纳：右侧面板值得借鉴的

1. 面板里各页面统一一条 28px 子工具栏，不画分隔线，内容不套边框圆角，底色统一。
2. 终端颜色接主题：浅色主题用浅色终端（或至少画布、外框同色），留白收到 4px 左右，去掉上方工具栏，改成右上角浮动小工具组。
3. 浏览器地址栏改成幽灵输入框，加 2px 加载进度条，补整页错误态。
4. 文件预览加面包屑；加载、失败、提示状态统一一套组件。
5. 差异：文件标题吸顶，悬停色条；增删底色由基础色混出，不再每个主题各写一份。
6. 空面板改成居中启动列表，标签改药丸样式、关闭按钮图标换 ×（见第七节）。

## 九、确认的重点：不套框（2026-11-12）

维护者确认「页面不自带框」是这次的重点，并且适用于其他组件，比如选项卡。

**原则。** 容器里的内容直接铺在容器底色上，不再加边框、圆角和分隔线。层次靠底色深浅、间距和文字层级表达。只有本身就是独立对象的东西才有框：弹窗、菜单、需要用户处理的卡片（权限请求、提问）、设置分组。t3code 也是这样分的，比如设置分组仍是 `rounded-xl border`（`components/settings/SettingsGroup.tsx:20-25`）。

**选项卡与分段控件。**

| | t3code | 我们 |
| --- | --- | --- |
| 选项卡 | 没有通用 Tabs 组件，面板和终端的标签都是 `h-6 rounded-md text-xs` 的药丸，选中只换底色（`components/RightPanelTabs.tsx:1016-1020`）。 | 共享 `tabs` 有两种：默认是灰底盒子里的白色滑块，`line` 是下划线（`components/shared/ui/tabs.tsx:25-37`、`:64-67`）；三处使用都选 `line`（`components/chat/LocalSlashCommandPanel.tsx:708`、`components/workspace/WorkspacePanel.tsx:1168`、`components/kanban/InboxView.tsx:117`），面板那处又手写外壳把下划线关掉。 |
| 分段控件 | 一个浅底槽 `bg-input/40 p-0.5 rounded-lg`，里面 24px 高的段，选中段抬起（`components/ui/toggle-group.tsx:32-33`、`components/ui/toggle.tsx:21-22`）。 | `SegmentedControl` 是间隔 1 的一排独立小按钮，没有底槽（`components/shared/SegmentedControl.tsx:17`、`components/shared/ui/toggle-group.tsx:43`）。 |

**其他套框较多的地方**（按 `rounded-* border` 粗略计数，只算单行 className）：`components/chat/LocalSlashCommandPanel.tsx`（25）、`components/plugins/PluginDetail.tsx`（15）、`components/chat/MessageList.tsx`（12）、`components/chat/ToolCallGroup.tsx`（7）、`components/chat/MermaidRenderer.tsx`（7）、`pages/TerminalSettings.tsx`（5）、`components/skills/SkillDetail.tsx`（5）、`components/settings/AgentsSettings.tsx`（5）。逐页阶段按上面的原则逐个判断去留。

## 十、维护者决定（2026-11-12）

- 同意加 `@pierre/trees` 依赖，文件树换成它（t3code 用的是 `1.0.0-beta.6`，`apps/web/package.json:33`）。实施时用 `bun add` 更新 lockfile，并核对版本和许可证。
- 对照画板：https://claude.ai/artifact/StghiQpQ1Btdgs9sBGVvbv （六块：基础控件、选项卡与分段控件、空面板、终端、浏览器、文件与差异；左现在、右改后，浅色主题真实变量值）。
- 字号全 app 对齐（维护者原话：会话里的字明显比左侧边栏大，要调整）。t3code 的会话正文 `text-sm leading-relaxed`，颜色 90%（`components/ChatMarkdown.tsx:1813-1814`），侧栏会话行也是 `text-sm`（`components/sidebar/SidebarThreadRow.tsx:1037`），根字号 16px（`packages/contracts/src/settings.ts:172`），即两边都是 14px。我们是回复 16px（`components/chat/AssistantMessage.tsx:29`、`:63`）、用户消息 14px（`components/chat/UserMessage.tsx:39`）、侧栏会话行 13px（`components/layout/Sidebar.tsx:958`）、项目行 12px（`Sidebar.tsx:849`）。新档位：10 角标 / 11 小注 / 12 次要 / 14 正文 / 16 小标题 / 20 标题，用 rem 定义；侧栏、对话、菜单、按钮正文同为 14。这一条覆盖上一轮「回复约 16px、导航约 13px」的样稿方案（design-log.zh.md 第 44 行）。画板加了第 7 块「字号：侧栏与会话」。
