import { defineMessages } from "../index";

export default defineMessages("media", {
  "zh-CN": {
    video: "视频",
    audio: "音频",
    videoPlayer: "视频播放器",
    audioPlayer: "音频播放器",
    playFailed: "文件无法播放，请检查地址、网络或文件编码。",
    openOriginal: "打开原文件",
    addVideo: "添加视频",
    addAudio: "添加音频",
    emptyDescription: "上传本地文件或填写在线文件地址",
    chooseFile: "选择文件",
    imageFailed: "图片无法加载（来源离线或文件已移动）",
    imageBlocked: "图片地址不受支持，只能显示 http、https 或内嵌的图片。",
    openAddress: "打开原地址",
    copyAddress: "复制地址",
    copyAddressFailed: "无法复制",
  },
  en: {
    video: "Video",
    audio: "Audio",
    videoPlayer: "Video player",
    audioPlayer: "Audio player",
    playFailed:
      "This file can't be played. Check the URL, your network or the file encoding.",
    openOriginal: "Open original file",
    addVideo: "Add video",
    addAudio: "Add audio",
    emptyDescription: "Upload a local file or enter an online file URL",
    chooseFile: "Choose file",
    imageFailed: "The image can't be loaded (the source is offline or the file has moved)",
    imageBlocked:
      "This image address isn't supported. Only http, https and embedded images can be shown.",
    openAddress: "Open original address",
    copyAddress: "Copy address",
    copyAddressFailed: "Couldn't copy",
  },
});
