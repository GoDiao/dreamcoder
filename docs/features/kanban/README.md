# 项目看板（Kanban）

本目录记录项目看板的需求、技术设计和调研。看板为 DreamCoder 已有的会话协作能力加一块持久的项目看板：人和会话共用一棵任务和子任务组成的树，每张卡记着负责人、审核人和创建者。

当前阶段：首版已实现，在 `feat/kanban` 分支上。PRD 和技术设计随实现一起更新，最近一次是 2026-11-09。

RFC：[#241](https://github.com/GoDiao/dreamcoder/issues/241)。会话之间的新开和消息已随 [#239](https://github.com/GoDiao/dreamcoder/pull/239) 合并，见 [session-links 技术设计](../session-links/tech-design.md)，看板建立在它之上。

## 文档

- [PRD](./prd.zh.md)：要解决的问题、角色、工作流程、状态与权限、首版需求、非目标、验收标准。开头的修订记录写了每次改动和原因。
- [技术设计](./tech-design.zh.md)：存储（每块看板一个事件日志）、看板与 worktree 的对应、看板工具和控制请求、通知的送达、权限与不变量的落点、页面流程。开头的修订记录和 PRD 对应。
- [初步思路](./vision.zh.md)：维护者最早写的分层架构，原文照录。后来的修订去掉了其中的 PM 和上下级。
- 调研：
  - [同类产品调研](./research/landscape.zh.md)：2026-11-03 的综合报告，比较 11 个仓库的源码和 3 个产品的公开文档。
  - [数据模型：同类项目对比](./research/data-model.zh.md)：7 个项目的数据模型对比，供技术设计参考。分项报告：
    - [Paperclip](./research/data-model-paperclip.zh.md)
    - [Multica](./research/data-model-multica.zh.md)
    - [Beads](./research/data-model-beads.zh.md)
    - [Linear](./research/data-model-linear.zh.md)
    - [Chorus](./research/data-model-chorus.zh.md)
    - [kandev](./research/data-model-kandev.zh.md)
    - [避免两张卡改同一批文件：kander 及其他项目的做法](./research/file-overlap-kander.zh.md)

参考仓库是浅克隆，在主工作区的 `refs/agent-kanban/` 下（git 已忽略），只读，不运行，不抄代码。AGPL 和 source-available 的项目只借鉴思路。

## 现在的模型

- **任务和子任务。** 卡片之间只有父子关系和 "必须先完成" 的依赖，没有 PM，也没有上下级。
- **三种身份记在卡上。** 负责人做这张卡；审核人（可以没有）按审核说明检查交付并接受或退回，没有审核人时由人验收；创建者管理这张卡、定验收要点、指定审核人，收到提交和阻塞的通知；负责人对要点有疑问时问创建者，自己改要人确认。同一个会话不能既做又审同一张卡。
- **会话的操作在会话里确认。** 在别处建卡、分配别的会话或自己，跟着会话的权限模式确认；分配给自己开出来的子会话不再确认。开新会话（可以带上一张卡和身份）、取消卡、建看板每次都要人确认。
- **人能做看板上的任何操作。** 重新打开、归档、重发通知只有人能做。
- **通知按卡上的身份送达。** 分配、撤销、评论、提交、阻塞、退回、接受、解除阻塞、退回待办、取消、重新打开，各自送给相关的身份，不依赖会话的父子关系。
- **看板页有看板和层级两个视图**，任务详情在右侧面板打开，"待我处理" 列出要人决定的事。

每项决定的来龙去脉见 PRD 和技术设计开头的修订记录。
