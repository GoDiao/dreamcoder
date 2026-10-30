import { defineMessages } from "../index";

// Shared file settings panel for video, audio and PDF blocks.
export default defineMessages("resourceEditor", {
  "zh-CN": {
    wrongType: "请选择对应类型的文件。",
    tooLarge:
      "「{name}」为 {size}，单个资源上限 {limit}。较大的媒体可填写在线文件地址。",
    readFailed: "文件读取失败。",
    invalid: "文件设置不正确。",
    reading: "读取文件…",
    chooseLocal: "选择本地文件",
    onlineUrl: "在线文件地址",
    title: "标题",
    caption: "说明",
    aspectRatio: "画面比例",
    poster: "封面图片地址",
    initialPage: "初始页码",
    readerHeight: "阅读区高度",
    hint: "本地文件随页面保存；在线地址需要网络。单个原始文件最多 64 MiB，页面资源合计最多 128 MiB；页面文字与结构另行计算。",
  },
  en: {
    wrongType: "Choose a file of the matching type.",
    tooLarge:
      "“{name}” is {size}. Each resource can be up to {limit}. For larger media, enter an online file URL.",
    readFailed: "Couldn't read the file.",
    invalid: "The file settings are invalid.",
    reading: "Reading file…",
    chooseLocal: "Choose local file",
    onlineUrl: "Online file URL",
    title: "Title",
    caption: "Caption",
    aspectRatio: "Aspect ratio",
    poster: "Cover image URL",
    initialPage: "Starting page",
    readerHeight: "Reader height",
    hint: "Local files are saved with the page; online URLs need a network connection. Each original file can be up to 64 MiB and a page's resources up to 128 MiB in total. Page text and structure are counted separately.",
  },
});
