import { defineMessages } from "../index";

// Custom (sandboxed or inline) component blocks inside pages and readers.
export default defineMessages("customComponents", {
  "zh-CN": {
    notInstalledError: "组件尚未安装。",
    ambiguousVersion: "组件 {component} 有多个不同内容版本，请指定完整性指纹。",
    invalidJson: "JSON 格式不正确。",
    notJsonObject: "组件数据必须是有效的 JSON 对象。",
    dataTooLarge: "组件数据超限。",
    dataChanged: "组件数据已更新，请重新打开编辑后再修改。",
    validationTimeout: "组件未响应数据校验，请重新加载组件后再试。",
    cannotDisplay: "组件无法显示。",
    viewportLockFailed: "无法保存阅读锁状态：{error}",
    invalidProps: "数据不符合组件的属性要求。",
    editData: "编辑组件数据",
    data: "组件数据",
    noManualEditing:
      "此组件暂不支持手动编辑参数。可以让 Agent 按你的要求修改，或在「高级」中直接编辑组件数据。",
    askAgentToEdit: "让 Agent 修改此组件…",
    advancedJson: "高级 · 编辑组件数据（JSON）",
    propsJson: "组件属性 JSON",
    validating: "校验中…",
    apply: "应用",
    inlineOnlyInConversation: "此运行方式仅用于对话内的独立页面。",
    inlineUnavailable:
      "组件 {component} 尚无对话内运行版本，请从源码导入新版本后重新导出。",
    inlineBlocked: "宿主未允许此组件运行。",
    "media.title": "本机文件",
    "media.close": "关闭",
    "media.loading": "正在打开…",
    "media.unsupported": "这个文件不能在 ShowAI 里预览，可以在文件夹中打开。",
    "media.unavailable":
      "这里不能打开本机文件。请在 ShowAI 桌面版或本机浏览器版中查看。",
    "media.failed": "无法打开文件：{error}",
    "media.notFound": "找不到这个文件，可能已经移动或删除。",
    "media.playFailed": "无法播放这个文件，可能是编码格式不受支持。",
    "media.copyPath": "复制位置",
    "media.copied": "已复制",
    "media.reveal": "在文件夹中显示",
  },
  en: {
    notInstalledError: "This component isn't installed.",
    ambiguousVersion:
      "Component {component} has several versions with different content. Specify its integrity fingerprint.",
    invalidJson: "The JSON is malformed.",
    notJsonObject: "Component data must be a valid JSON object.",
    dataTooLarge: "The component data is too large.",
    dataChanged:
      "The component data has changed. Reopen the editor before making changes.",
    validationTimeout:
      "The component didn't respond to data validation. Reload the component and try again.",
    cannotDisplay: "This component can't be displayed.",
    viewportLockFailed: "Couldn't save the reading lock state: {error}",
    invalidProps: "The data doesn't match the component's property rules.",
    editData: "Edit component data",
    data: "Component data",
    noManualEditing:
      "This component’s parameters can’t be edited by hand yet. Ask an Agent to change it, or edit the component data directly under Advanced.",
    askAgentToEdit: "Ask Agent to change this component…",
    advancedJson: "Advanced · Edit component data (JSON)",
    propsJson: "Component properties JSON",
    validating: "Validating…",
    apply: "Apply",
    inlineOnlyInConversation:
      "This mode only runs in standalone pages inside a conversation.",
    inlineUnavailable:
      "Component {component} has no in-conversation build yet. Import a new version from source and export again.",
    inlineBlocked: "The host didn't allow this component to run.",
    "media.title": "Local file",
    "media.close": "Close",
    "media.loading": "Opening…",
    "media.unsupported":
      "ShowAI can't preview this file. Open it from its folder instead.",
    "media.unavailable":
      "Local files can't be opened here. View this page in the ShowAI desktop app or local browser mode.",
    "media.failed": "Couldn't open the file: {error}",
    "media.notFound":
      "This file can't be found. It may have been moved or deleted.",
    "media.playFailed":
      "Couldn't play this file. Its format may not be supported.",
    "media.copyPath": "Copy location",
    "media.copied": "Copied",
    "media.reveal": "Show in folder",
  },
});
