# 桌面 UI 设计记录

本目录记录 DreamCoder 桌面端的设计讨论、用户反馈和演示样稿。后续修改先看当前约束，再看过程记录，避免把早期方案重新带回来。

- [现有功能覆盖核对](./coverage-audit.zh.md)：以 `main@5721c21` 对照当前样稿，记录缺口和待迁移流程。
- [设计决策与修改过程](./design-log.zh.md)：用户明确要求、样稿采用的方案、待确认项及检查清单。
- [设置页面样稿](./settings-ui.zh.md)：14 个分类的内容、源码对应及演示边界。
- [可直接打开的演示样稿](./mockups/dreamcoder-preview.html)：独立 HTML，保留演示交互。
- [样稿源片段](./mockups/dreamcoder-complete-study.html)：用于继续编辑和重新导出。

当前为设计阶段。样稿使用模拟数据，页面中的任务、文件变化、终端输出和设置反馈不代表真实应用执行结果。

记录基线：2026-10-17，`feat/ui-refresh`，从当时本地 `main`（`d5ee9159`）建立。2026-10-18 样稿内容对齐到 `main@ac0ea44`，分支本身尚未 rebase。原有 `refactor/typed-live-events` 工作目录保持原状。

后续在这个 UI 分支中迭代时，同步更新设计记录与样稿；每次注明反馈、改动、验证和剩余问题。用户的明确要求与设计者提出的方案分开记录。保存文件不等于用户已经验收，也不等于功能已经实现。

菜单事件回归检查：在工作区运行 `node docs/ui/checks/menu-events.cjs`。该检查模拟图标替换后的事件传播，不替代浏览器交互验收。

状态同步回归：`node docs/ui/checks/state-sync.cjs`，使用独立预览的真实状态桥接函数，检查点击回写不会重建控件；不替代原生下拉弹层的浏览器验收。

通用下拉回归：`node docs/ui/checks/general-dropdown.cjs`，检查页面内点击菜单的展开、选择、焦点返回与关闭；不替代实际浏览器验收。

- [提问与异常状态设计](./interaction-states.zh.md)
- [提问与异常独立预览](./mockups/interaction-states-preview.html)
