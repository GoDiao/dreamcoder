import { defineMessages } from "../index";

// Layer diagram built-in.
export default defineMessages("layerDiagram", {
  "zh-CN": {
    title: "分层架构图",
    hint: "点选模块查看说明",
    modules: "{layer}的模块",
    empty: "暂无模块",
    prompt: "选择上方任一模块，查看它的职责和位置。",
    path: "位置",
  },
  en: {
    title: "Layer diagram",
    hint: "Select a module to see its details",
    modules: "Modules in {layer}",
    empty: "No modules",
    prompt: "Select any module above to see what it does and where it lives.",
    path: "Location",
  },
});
