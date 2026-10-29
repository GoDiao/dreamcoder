import { defineMessages } from "../index";

// Chrome of exported HTML readers. The language follows the exporter (<html lang>).
export default defineMessages("reader", {
  "zh-CN": {
    draftNote: "交互预览 · 更改仅保存在此预览中",
    downloadOriginalSource: "下载原始源文件",
    remoteInlineBlocked: "对话内页面必须完整打包组件，不能使用远程依赖。",
    remoteLoadFailed: "远程组件无法加载，请检查网络。",
    remoteLoading: "正在校验并加载已发布的固定版本组件…",
    remoteRequired: "此页面使用已发布的固定版本组件，需要联网加载。",
    integrityUnavailable: "组件完整性校验需要 HTTPS 或在本机打开页面。",
    componentFetchFailed:
      "无法加载组件 {component}：{reason}。请检查网络和发布服务器的 CORS 设置。",
    networkFailed: "网络请求失败",
    contentUnavailable: "此部分内容暂时无法加载，请检查网络后刷新。",
    contentUnverified: "此部分内容未通过完整性校验，没有加载。",
    componentChecksumFailed:
      "组件 {component} 的文件校验失败（SHA-256 或字节数不一致）。",
    lockedComponentMissing: "缺少页面锁定的组件 {component}，原页面未被替换。",
    emptyPage: "页面内容为空。",
    unreadablePage: "无法读取这份页面。",
    openFailed: "无法打开页面",
    referenceSelection: "引用选区到对话（{count}）",
    referenceBlock: "引用此内容块到对话",
    referencePage: "引用整页到对话",
    referenceClear: "取消对话引用",
    referenceAdded: "已加入对话输入框 · 引用版本 {version}",
    referenceCleared: "已取消对话引用",
    referenceUnavailable: "当前对话不接收页面引用。",
    referenceHeadingSelection:
      "ShowAI 引用 · 选区（{count} 个内容块）·《{title}》· 版本 {version}",
    referenceHeadingBoard:
      "ShowAI 引用 · 白板中 {count} 个对象 ·《{title}》· 版本 {version}",
    referenceHeadingBoardAll:
      "ShowAI 引用 · 整个白板 ·《{title}》· 版本 {version}",
    referenceHeadingPage: "ShowAI 引用 · 整页 ·《{title}》· 版本 {version}",
  },
  en: {
    draftNote: "Interactive preview · Changes are kept only in this preview",
    downloadOriginalSource: "Download original source file",
    remoteInlineBlocked:
      "Pages shown in a conversation must bundle their components; remote dependencies aren't allowed.",
    remoteLoadFailed: "Couldn't load remote components. Check your network.",
    remoteLoading: "Verifying and loading published component versions…",
    remoteRequired:
      "This page uses published component versions and needs a network connection to load them.",
    integrityUnavailable:
      "Verifying components requires HTTPS or opening the page locally.",
    componentFetchFailed:
      "Couldn't load component {component}: {reason}. Check your network and the publishing server's CORS settings.",
    networkFailed: "Network request failed",
    contentUnavailable:
      "Part of this page can't be loaded right now. Check your network and refresh.",
    contentUnverified: "Part of this page failed verification and wasn't loaded.",
    componentChecksumFailed:
      "Component {component} failed verification (SHA-256 or size mismatch).",
    lockedComponentMissing:
      "Component {component} locked by this page is missing. The original page was not replaced.",
    emptyPage: "The page is empty.",
    unreadablePage: "Couldn't read this page.",
    openFailed: "Couldn't open page",
    referenceSelection: "Reference selection in chat ({count})",
    referenceBlock: "Reference this block in chat",
    referencePage: "Reference the page in chat",
    referenceClear: "Remove the chat reference",
    referenceAdded: "Added to the chat input · version {version}",
    referenceCleared: "Chat reference removed",
    referenceUnavailable: "This conversation doesn't accept page references.",
    referenceHeadingSelection: {
      one: "ShowAI reference · selection ({count} block) · “{title}” · version {version}",
      other:
        "ShowAI reference · selection ({count} blocks) · “{title}” · version {version}",
    },
    referenceHeadingBoard: {
      one: "ShowAI reference · {count} board object · “{title}” · version {version}",
      other:
        "ShowAI reference · {count} board objects · “{title}” · version {version}",
    },
    referenceHeadingBoardAll:
      "ShowAI reference · whole board · “{title}” · version {version}",
    referenceHeadingPage:
      "ShowAI reference · whole page · “{title}” · version {version}",
  },
});
