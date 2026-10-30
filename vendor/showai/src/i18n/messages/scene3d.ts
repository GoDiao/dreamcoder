import { defineMessages } from "../index";

// 3D scene built-in.
export default defineMessages("scene3d", {
  "zh-CN": {
    title: "3D 场景",
    lockTarget: "3D 视角",
    unlockDescription: "允许拖动旋转、滚轮缩放和平移视角",
    canvas: "3D 视图：{labels}",
    canvasEmpty: "3D 视图",
    loading: "正在准备 3D 视图…",
    webglFailed: "无法初始化 3D 视图：{error}。参数和标注仍可阅读。",
    parameters: "参数",
    demo: "演示 {label}",
    demoShort: "演示",
    stop: "停止",
    reset: "重置",
    resetTitle: "恢复初始参数与视角",
    dragHint: "解锁后可拖动旋转、滚轮缩放",
    labels: "标注",
  },
  en: {
    title: "3D scene",
    lockTarget: "3D view",
    unlockDescription: "drag to rotate, scroll to zoom and pan the view",
    canvas: "3D view: {labels}",
    canvasEmpty: "3D view",
    loading: "Preparing the 3D view…",
    webglFailed:
      "The 3D view could not start: {error}. Parameters and labels remain readable.",
    parameters: "Parameters",
    demo: "Demonstrate {label}",
    demoShort: "Demo",
    stop: "Stop",
    reset: "Reset",
    resetTitle: "Restore the initial parameters and view",
    dragHint: "Unlock to drag-rotate and scroll-zoom",
    labels: "Labels",
  },
});
