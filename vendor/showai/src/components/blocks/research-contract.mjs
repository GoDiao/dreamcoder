import { CAPACITY } from "../../portable/capacity.mjs";
const formats = {
  video: ["video/mp4", "video/webm", "video/ogg", "video/quicktime"],
  audio: [
    "audio/mpeg",
    "audio/mp4",
    "audio/wav",
    "audio/x-wav",
    "audio/ogg",
    "audio/webm",
    "audio/flac",
    "audio/aac",
  ],
  pdf: ["application/pdf"],
};
export const MAX_UPLOAD_BYTES = CAPACITY.resourceBytes;
export function resourceMime(kind, value) {
  const match =
    typeof value === "string" &&
    value.match(/^data:([^;,]+);base64,[a-z\d+/=\s]+$/i);
  return match && formats[kind]?.includes(match[1].toLowerCase())
    ? match[1].toLowerCase()
    : undefined;
}
export function safeResourceUrl(kind, value) {
  if (
    typeof value !== "string" ||
    /^[\u0000-\u0020]|[\u0000-\u001f]/.test(value)
  )
    return;
  if (resourceMime(kind, value)) return value;
  try {
    const url = new URL(value);
    if (["http:", "https:"].includes(url.protocol)) return url.href;
  } catch {
    /* URL parsing is an input boundary. */
  }
}
export function fileMime(kind, file) {
  const extensions = {
    mp4: "video/mp4",
    webm: kind === "audio" ? "audio/webm" : "video/webm",
    ogv: "video/ogg",
    mov: "video/quicktime",
    mp3: "audio/mpeg",
    m4a: "audio/mp4",
    wav: "audio/wav",
    oga: "audio/ogg",
    ogg: kind === "video" ? "video/ogg" : "audio/ogg",
    flac: "audio/flac",
    aac: "audio/aac",
    pdf: "application/pdf",
  };
  const mime = extensions[file.name.split(".").pop()?.toLowerCase()];
  if (mime && formats[kind]?.includes(mime)) return mime;
  return formats[kind]?.includes(file.type) ? file.type : undefined;
}
export function referenceUrl(item) {
  const doi = item.doi?.trim().replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "");
  const candidate = item.url || (doi ? `https://doi.org/${doi}` : "");
  return safeResourceUrl("pdf", candidate);
}
export function validateResearchData(kind, data) {
  if (!data || typeof data !== "object" || Array.isArray(data))
    throw new Error("组件数据必须是对象。");
  const text = (value, label, limit = 10000) => {
    if (
      value !== undefined &&
      (typeof value !== "string" || value.length > limit)
    )
      throw new Error(`${label}必须是文字，长度不超过 ${limit}。`);
  };
  ["title", "description", "caption", "fileName"].forEach((key) =>
    text(data[key], key),
  );
  if (kind === "references") {
    if (!Array.isArray(data.items) || data.items.length > 500)
      throw new Error("参考文献最多支持 500 条。");
    const ids = new Set();
    for (const item of data.items) {
      if (!item || typeof item !== "object" || Array.isArray(item))
        throw new Error("参考文献条目必须是对象。");
      if (
        typeof item.id !== "string" ||
        !item.id.trim() ||
        ids.has(item.id) ||
        ["__proto__", "constructor", "prototype"].includes(item.id)
      )
        throw new Error("参考文献需要不重复的 id。");
      ids.add(item.id);
      if (typeof item.title !== "string" || !item.title.trim())
        throw new Error("参考文献需要标题。");
      for (const key of [
        "id",
        "title",
        "authors",
        "year",
        "venue",
        "doi",
        "url",
        "note",
      ])
        text(item[key], key);
      if (item.url && !safeResourceUrl("pdf", item.url))
        throw new Error("文献链接需要 http 或 https 网址。");
      if (
        item.doi &&
        !/^10\.\d{4,9}\/\S+$/i.test(
          item.doi.replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, ""),
        )
      )
        throw new Error("DOI 格式应为 10.xxxx/…。");
    }
    return;
  }
  if (!formats[kind]) throw new Error(`未知的文件组件：${kind}`);
  if (
    data.src !== undefined &&
    data.src !== "" &&
    !safeResourceUrl(kind, data.src)
  )
    throw new Error("文件需要 http、https 或匹配文件类型的内嵌地址。");
  if (
    data.poster &&
    !(
      safeResourceUrl("pdf", data.poster) ||
      /^data:image\/(png|jpeg|gif|webp|avif);base64,[a-z\d+/=\s]+$/i.test(
        data.poster,
      )
    )
  )
    throw new Error("封面需要有效图片地址。");
  if (
    data.page !== undefined &&
    (!Number.isInteger(data.page) || data.page < 1 || data.page > 100000)
  )
    throw new Error("初始页码必须是正整数。");
  if (
    data.height !== undefined &&
    (typeof data.height !== "number" ||
      !Number.isFinite(data.height) ||
      data.height < 240 ||
      data.height > 1200)
  )
    throw new Error("阅读区高度需要在 240 到 1200 之间。");
  if (
    data.aspectRatio !== undefined &&
    !["16:9", "4:3", "1:1", "9:16"].includes(data.aspectRatio)
  )
    throw new Error("画面比例不受支持。");
  for (const key of ["loop", "muted"])
    if (data[key] !== undefined && typeof data[key] !== "boolean")
      throw new Error(`${key}必须是布尔值。`);
}
