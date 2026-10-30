import { defineMessages } from "../index";

// Sequence diagram built-in.
export default defineMessages("sequenceDiagram", {
  "zh-CN": {
    title: "时序图",
    diagram: "时序图，共 {count} 步。方向键切换步骤，Home / End 跳到首尾。",
    controls: "步骤控制",
    prev: "上一步",
    next: "下一步",
    play: "播放",
    pause: "暂停",
    restart: "重来",
    count: "第 {current} / {total} 步",
    hint: "点击箭头跳到该步 · 方向键切换",
    reply: "返回",
    note: "备注",
    stepTitle: "{number}. {from} → {to}：{label}",
    allSteps: "全部步骤",
    actors: "参与者",
  },
  en: {
    title: "Sequence diagram",
    diagram:
      "Sequence diagram with {count} steps. Arrow keys change the step; Home and End jump to the ends.",
    controls: "Step controls",
    prev: "Previous",
    next: "Next",
    play: "Play",
    pause: "Pause",
    restart: "Restart",
    count: "Step {current} of {total}",
    hint: "Click an arrow to jump · arrow keys to step",
    reply: "reply",
    note: "note",
    stepTitle: "{number}. {from} → {to}: {label}",
    allSteps: "All steps",
    actors: "Participants",
  },
});
