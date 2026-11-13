# 桌面 UI 视觉重构：实施记录

分支 `feat/ui-visual-refresh`，2026-11-12 至 2026-11-13。参考对象是 t3code，调研见 [t3code-comparison.zh.md](./t3code-comparison.zh.md)。第一轮只改外观和交互入口，不改会话、权限、服务端状态的逻辑；唯一的服务端改动是允许「用编辑器打开」单个文件。第二轮在分支 `feat/skill-detail-refresh`（2026-11-13 至 2026-11-14）重做技能详情页（D11 至 D13），服务端改了技能详情接口返回的文件信息。

## 维护者确认的决定

| 编号 | 决定 |
| --- | --- |
| D1 | 右侧面板的各个页面（终端、浏览器、文件、变更）不自带边框；标签栏、选项卡等组件同样去框。 |
| D2 | 全应用字号对齐：对话正文和侧栏用同一档 14px，辅助文字用 12/11/10px 三档。 |
| D3 | 引入 `@pierre/trees` 替换文件树；引入 `oxlint` 和 `@shadcn/lint`，设计规则由 lint 强制。 |
| D4 | 终端跟随主题，浅色主题下是浅色终端。 |
| D5 | Files 标签改成左右分栏：左边预览、右边文件树；在树里点文件就地预览，不开新标签。启动页的「最近文件」和输入的文件路径也切到 Files 标签并选中该文件；看板卡片里的文件链接和树的右键「在新标签中打开」仍然单独开标签。 |
| D6 | Files 顶部是一整行路径栏，横跨预览和文件树；右侧依次是编辑器分体按钮、Markdown 预览开关、自动换行开关、文件树开关。Markdown 默认显示渲染效果（2026-11-13 改：原为默认显示源码，改成与技能详情页一致），代码默认自动换行。面板窄时，还没选文件就显示文件树，选了文件后自动收起（2026-11-13 检查时补充：窄面板一开始只有空白预览，找不到入口）。 |
| D7 | 「用编辑器打开」改成分体按钮：左边是当前编辑器图标，点了直接打开；右边是下拉箭头，列出所有程序。会话标题栏的「打开项目」用同一个组件。 |
| D8 | 去掉文件预览的「…」更多菜单，操作放进内容区右键。内容区右键不放「打开方式」「在 Finder 中显示」（顶部已有分体按钮），也不做「跳到行」。 |
| D9 | 路径栏每一段都有右键菜单，悬停显示该段的绝对路径（不缩写成 `~`），左键点击在文件树中定位；目录的菜单另有「在终端中打开」。 |
| D10 | 变更列表保留「…」，并参照 Claude Code：每行加「打开文件」按钮；「…」和右键是同一个菜单。 |
| D11 | 技能详情页参照 Claude Code：顶部是返回链接、图标、名称和来源一行；下方分「概览」和「内容 · 文件数」两个标签。概览左边是描述和 frontmatter 里的字段，右边灰底卡片列来源、插件、斜杠命令、版本、大小和位置。 |
| D12 | 「内容」标签左边是文件树（入口文件排第一，目录全部展开），右边是预览，顶部一行显示文件路径；Markdown 默认显示渲染效果，可切到源码。 |
| D13 | 技能里的图片直接显示；二进制文件和超过 100 KB 的文本文件显示「无法预览」的提示，不显示内容。 |

## 实现

**主题与字号。** [globals.css](../../../desktop/src/theme/globals.css) 分两层：七个主题只提供 `--theme-*` 调色板变量；`html {}` 里把它们映射成语义变量（`--background`、`--muted-foreground`、`--hover`、`--selected`、`--code`、`--terminal*`、差异配色等），`@theme inline` 再把语义变量暴露成 Tailwind 工具类。字号增加 `text-2xs`（11px）和 `text-3xs`（10px），圆角恢复 Tailwind 默认档。

**共享组件自带外观。** `shared/ui` 里的组件用 `variant` 和 `size` 决定外观，调用处的 `className` 只放布局。按钮新增 `ghost-muted`、`toolbar`、`row-lg`、`row-flush`、`inline-text` 等档；新增 `button-group`。规则写在 [AGENTS.md](../../../AGENTS.md)，由 [.oxlintrc.json](../../../desktop/.oxlintrc.json) 中的 `shadcn/no-restyle`、`shadcn/no-arbitrary-values`、`shadcn/no-raw-colors` 在 `bun run lint` 中检查。

**面板去框。** 终端、浏览器、空状态、差异和预览都不再画外框；终端颜色从 `--terminal*` 变量读取，切换主题时重新应用；字体先从 `--font-mono` 读出实际字体名并等字体加载完再创建终端（xterm 在画布上测字宽，画布不认 `var()`，直接传变量会按默认字体量宽度，字距被拉开）；项目、分支和清空、重启按钮放在终端上方单独一行，不再浮在输出上；浏览器地址栏下方显示加载进度条。

**Files 标签。** 选中的文件存在 [workspacePanelStore.ts](../../../desktop/src/stores/workspacePanelStore.ts) 的 `selectedFile` 里，随面板一起保存和恢复；`selectFile` 同时更新「最近文件」并切到 Files 标签。[WorkspaceFileTree.tsx](../../../desktop/src/components/workspace/WorkspaceFileTree.tsx) 把已加载的目录交给 `@pierre/trees`，展开目录时才加载它的内容，路径列表从根目录逐层收集，父目录不再列出的子目录随之消失；子目录加载失败会提示，并在下次展开时重试；路径栏点击定位时，先加载各级父目录，等它们出现在树里再展开并滚动到目标。Files 标签选中的文件和单独打开的文件标签一样，在每轮对话结束后重新读取。[WorkspacePanel.tsx](../../../desktop/src/components/workspace/WorkspacePanel.tsx) 中 `FilesView` 用 `ResizeObserver` 判断面板宽度（小于 520px 视为窄）；窄时文件树的默认状态取决于有没有选中文件，手动开关后以手动选择为准。

**菜单。** [ActionMenu.tsx](../../../desktop/src/components/shared/ActionMenu.tsx) 增加普通子菜单 `MenuSubmenu`，下拉菜单和右键菜单都能用；`RowActionMenu` 的 `selectable` 让右键区域里仍可选中文字，供代码和 Markdown 预览使用。文件、目录、变更行、文件树的菜单项都由 `useWorkspaceFileActions` 生成；文件树的菜单用 `AnchoredActionMenu` 打开在 `@pierre/trees` 给出的位置上，桌面端右键打开，H5 页面每行显示一个菜单按钮（触屏长按不会触发右键）；已删除的文件不提供打开类菜单项。「打开方式」和「在 Finder 中显示」读取 [OpenProjectMenu.tsx](../../../desktop/src/components/layout/OpenProjectMenu.tsx) 中的 `useOpenTargets`，与分体按钮共用同一份程序列表。终端标签可以带一个起始目录 `cwd`。

**行评论。** 行号列宽按行数的位数计算；鼠标所在行（或获得焦点的行号）旁显示一个评论图标，整个预览只有这一个图标元素，移动时直接改它的位置，不重新渲染各行；触屏上行号用主题色提示可以点。差异视图用 `@pierre/diffs` 的 gutter utility 显示同一个图标，删除行上隐藏。评论框用 `InputGroup`：上方一行写行号，回车提交，Shift+回车换行，Esc 取消，输入法组字时这些按键交给输入法；空的评论框在应用内点别处时关闭，写了内容的不关；按下行号不会让评论框失焦，点另一行直接切换。

**服务端。** [openTargetService.ts](../../../src/server/services/openTargetService.ts) 的 `resolveOpenPath` 允许文件：编辑器直接打开文件，文件管理器打开它所在的目录。

**技能详情页（第二轮）。** [SkillDetail.tsx](../../../desktop/src/components/skills/SkillDetail.tsx) 用 `Tabs` 新增的 `line` 变体做两个标签；[SkillFileTree.tsx](../../../desktop/src/components/skills/SkillFileTree.tsx) 用 `@pierre/trees` 显示文件树，样式与 Files 标签共用 [fileTreeCss.ts](../../../desktop/src/components/shared/fileTreeCss.ts)。设置页的内容区改成纵向弹性布局，详情页铺满剩余高度，「内容」标签的树和预览在面板内滚动，不再让整个设置页滚动。服务端 [skills.ts](../../../src/server/api/skills.ts) 给每个文件标 `kind`（`text`、`image`、`binary`、`too_large`），路径统一用 `/` 分隔；图片不随详情一起返回，选中时由页面通过 `/api/filesystem/file` 加载。图片扩展名到 MIME 类型的对应表只有一份，在 [imageMime.ts](../../../src/server/services/imageMime.ts)，技能详情、Files 预览和 `/api/filesystem/file` 共用。

## 检查

- `bun run lint`、桌面测试全部通过。
- 在 dev app 中经调试端口截图检查：亮色和暗色主题、中英文界面、Files 分栏、路径栏和内容区右键菜单。检查中修正了三处：自动换行时行号与首行对齐、换行不在单词中间断开、窄面板的路径栏优先收起目录段并截断文件名；中文「添加到聊天」统一为「添加到对话」。
- 未检查真实的 H5 页面，只用桌面布局模拟了 390px 宽度。
- 第二轮：`bun run lint`、桌面测试和服务端测试全部通过；在 dev app 中截图检查了技能详情的概览、内容（含 shadcn 技能的图片和多层目录）、暗色主题和 390px 宽度，以及其他设置页的显示和滚动。

## 已知限制

- 文件树收起再展开、或面板宽窄变化导致自动收起时，已展开的目录会折叠回去。
- 对文件用「在 Finder 中显示」时打开的是所在目录，不会在 Finder 中选中该文件。
- 未做「标为已查看」和「跳到行」。
