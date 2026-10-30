import { defineMessages } from "../index";

// The workbench component status card; readers use a lighter stand-in.
export default defineMessages("componentStatus", {
  "zh-CN": {
    "status.crashed": "「{name}」组件运行出错",
    "status.invalid": "「{name}」组件的参数不符合要求",
    "status.missing": "缺少组件「{name}」",
    "status.safety": "页面其他内容不受影响，组件数据已保留。",
    "status.crashedCause":
      "组件代码在显示时出错。可能是代码问题，也可能是数据缺少它需要的内容。",
    "status.missingCause": "页面使用的组件 {component} 不在当前内容库中。",
    "status.moreIssues": "还有 {count} 项",
    "status.retry": "重试",
    "status.askAgent": "让 Agent 修复",
    "status.askAgentInstall": "让 Agent 安装或重建",
    "status.copyDetails": "复制错误详情",
    "status.copyId": "复制组件标识",
    "status.copied": "已复制",
    "status.copyFailed": "无法复制，请在技术详情中手动选择文字。",
    "status.findInLibrary": "在组件库中查找",
    "status.details": "技术详情",
    "status.reportProblem": "报告问题",
    "status.promptCrashed":
      "页面中的「{name}」组件（{component}）运行出错：{error}\n请修复这个组件，保留它现有的数据。",
    "status.promptInvalid":
      "页面中的「{name}」组件（{component}）的参数不符合要求：{error}\n请修正这个组件的数据，使它符合组件的参数说明。",
    "status.promptMissing":
      "页面使用的组件 {component} 不在当前内容库中。请安装它；如果找不到，请按页面中保留的数据重建一个兼容的组件。",
  },
  en: {
    "status.crashed": "The “{name}” component ran into an error",
    "status.invalid":
      "The “{name}” component's parameters don't match its rules",
    "status.missing": "Component “{name}” is missing",
    "status.safety":
      "The rest of the page isn't affected, and the component data is kept.",
    "status.crashedCause":
      "The component's code failed while displaying. This may be a code problem, or the data may lack something the component needs.",
    "status.missingCause":
      "This page uses component {component}, which isn't in the current library.",
    "status.moreIssues": "{count} more",
    "status.retry": "Try again",
    "status.askAgent": "Ask the Agent to fix it",
    "status.askAgentInstall": "Ask the Agent to install or rebuild it",
    "status.copyDetails": "Copy error details",
    "status.copyId": "Copy component ID",
    "status.copied": "Copied",
    "status.copyFailed":
      "Couldn't copy. Select the text in the technical details instead.",
    "status.findInLibrary": "Find in component library",
    "status.details": "Technical details",
    "status.reportProblem": "Report a problem",
    "status.promptCrashed":
      "The “{name}” component ({component}) on this page ran into an error: {error}\nPlease fix the component and keep its existing data.",
    "status.promptInvalid":
      "The parameters of the “{name}” component ({component}) on this page don't match its rules: {error}\nPlease correct the component's data so it follows the component's parameter documentation.",
    "status.promptMissing":
      "This page uses component {component}, which isn't in the current library. Please install it, or rebuild a compatible component from the data kept on the page.",
  },
});
