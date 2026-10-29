import { defineMessages } from "../index";

// Hover-note action and dialog of the rich text editor. Kept apart from the
// richText catalog so page readers, which never edit, do not carry them.
export default defineMessages("richTextNotes", {
  "zh-CN": {
    "format.note": "注释",
    "dialog.addNote": "添加注释",
    "dialog.editNote": "修改注释",
    "dialog.noteText": "注释内容（读者把鼠标移到所选文字上时显示）",
    "dialog.noteFormula": "注释内容（读者把鼠标移到这个公式上时显示）",
    "dialog.notePlaceholder": "例如：第 t 步的带噪潜变量，形状与图像潜变量相同",
    "dialog.noteHint":
      "可用 $…$ 写公式；只注释公式中的某个变量时，在公式源码里写 \\note{x_t}{…}。⌘↩ 保存。",
    "dialog.removeNote": "删除注释",
    "dialog.noteNeedsSelection": "先选中要加注释的文字或公式。",
    "dialog.noteTargetMissing": "要注释的公式已经不在原位置，请重新选择。",
    "dialog.noteTooLong": "注释最多 {max} 个字符。",
  },
  en: {
    "format.note": "Note",
    "dialog.addNote": "Add note",
    "dialog.editNote": "Edit note",
    "dialog.noteText": "Note (shown when readers hover the selected text)",
    "dialog.noteFormula": "Note (shown when readers hover this formula)",
    "dialog.notePlaceholder":
      "For example: the noisy latent at step t, shaped like the image latent",
    "dialog.noteHint":
      "Use $…$ for formulas. To annotate one variable inside a formula, write \\note{x_t}{…} in its source. ⌘↩ saves.",
    "dialog.removeNote": "Remove note",
    "dialog.noteNeedsSelection":
      "Select the text or formula to annotate first.",
    "dialog.noteTargetMissing": "The formula moved. Select it again.",
    "dialog.noteTooLong": "Notes can have at most {max} characters.",
  },
});
