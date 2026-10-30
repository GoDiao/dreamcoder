import { defineMessages } from "../index";

// Fallback shown when a block cannot be rendered: the component status card.
export default defineMessages("widget", {
  "zh-CN": {
    unavailable: "此组件暂时无法显示",
    viewData: "查看组件数据",
    downloadData: "下载组件数据",
    renderFailed: "组件渲染失败。",
    invalidData: "组件数据格式不正确。",
    loading: "正在加载组件…",
    sharedDataUnavailable: "此组件的数据来自共享数据，在当前位置无法读取。",
    "status.unavailable": "「{name}」组件暂时无法显示",
    "status.rejectionCause": "组件在后台执行的操作出错，显示的内容可能不完整。",
    "status.missingBuiltinCause": "当前版本的 ShowAI 没有「{kind}」组件。",
  },
  en: {
    unavailable: "This component can't be displayed right now",
    viewData: "View component data",
    downloadData: "Download component data",
    renderFailed: "The component failed to render.",
    invalidData: "The component data format is invalid.",
    loading: "Loading component…",
    sharedDataUnavailable:
      "This component's data comes from shared data, which can't be read here.",
    "status.unavailable": "The “{name}” component can't be displayed here",
    "status.rejectionCause":
      "Something the component was doing in the background failed. What it shows may be incomplete.",
    "status.missingBuiltinCause":
      "This version of ShowAI has no “{kind}” component.",
  },
});
