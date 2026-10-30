import { richTextDocument } from "../components/rich-text/model.mjs";
import type { JSONContent } from "@tiptap/core";
import type { ShowDocument } from "../types";

export function newDocument(title = ""): ShowDocument {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    title,
    icon: "",
    cover: "none",
    parentId: null,
    favorite: false,
    archived: false,
    createdAt: now,
    updatedAt: now,
    content: { type: "doc", content: [{ type: "paragraph" }] },
    comments: [],
  };
}

export function plainText(node: JSONContent): string {
  if (node.text) return node.text;
  if (node.type === "widget" && node.attrs?.kind === "text")
    return plainText(richTextDocument(node.attrs.data));
  return (node.content ?? [])
    .map(plainText)
    .join(node.type === "doc" ? "\n" : "");
}

export function toMarkdown(node: JSONContent, depth = 0): string {
  const children = () =>
    (node.content ?? []).map((child) => toMarkdown(child, depth)).join("");
  if (node.type === "text") {
    let value = node.text ?? "";
    for (const mark of node.marks ?? []) {
      if (mark.type === "bold") value = `**${value}**`;
      if (mark.type === "italic") value = `*${value}*`;
      if (mark.type === "strike") value = `~~${value}~~`;
      if (mark.type === "code") value = "`" + value + "`";
      if (mark.type === "link") value = `[${value}](${mark.attrs?.href ?? ""})`;
    }
    return value;
  }
  switch (node.type) {
    case "doc":
    case "surface":
    case "region":
    case "richText":
      return children().trim() + "\n";
    case "heading":
      return "#".repeat(node.attrs?.level ?? 2) + " " + children() + "\n\n";
    case "paragraph":
      return children() + "\n\n";
    case "hardBreak":
      return "  \n";
    case "horizontalRule":
      return "\n---\n\n";
    case "codeBlock":
      return (
        "```" +
        (node.attrs?.language ?? "") +
        "\n" +
        plainText(node) +
        "\n```\n\n"
      );
    case "blockquote":
    case "callout":
      return (
        children()
          .trim()
          .split("\n")
          .map((line) => "> " + line)
          .join("\n") + "\n\n"
      );
    case "bulletList":
    case "orderedList":
    case "taskList":
      return (
        (node.content ?? [])
          .map(
            (child, i) =>
              "  ".repeat(depth) +
              (node.type === "orderedList"
                ? `${i + 1}. `
                : node.type === "taskList"
                  ? `- [${child.attrs?.checked ? "x" : " "}] `
                  : "- ") +
              (child.content ?? [])
                .map((n) => toMarkdown(n, depth + 1))
                .join("")
                .trim() +
              "\n",
          )
          .join("") + "\n"
      );
    case "drawing":
      return typeof node.attrs?.label === "string"
        ? node.attrs.label + "\n\n"
        : "";
    case "image":
      return `![${node.attrs?.alt ?? ""}](${node.attrs?.src ?? ""})\n\n`;
    case "mathInline":
      return `$${node.attrs?.latex ?? ""}$`;
    case "mathBlock":
      return `$$\n${node.attrs?.latex ?? ""}\n$$\n\n`;
    case "widget":
      if (node.attrs?.kind === "text")
        return toMarkdown(richTextDocument(node.attrs.data), depth);
      return (
        "```showai-block\n" + JSON.stringify(node.attrs, null, 2) + "\n```\n\n"
      );
    case "table":
      return (
        (node.content ?? [])
          .map(
            (row, index) =>
              "| " +
              (row.content ?? [])
                .map((cell) => plainText(cell).replaceAll("|", "\\|"))
                .join(" | ") +
              " |\n" +
              (index === 0
                ? "| " +
                  (row.content ?? []).map(() => "---").join(" | ") +
                  " |\n"
                : ""),
          )
          .join("") + "\n"
      );
    default:
      return children();
  }
}

export function downloadFile(name: string, data: string, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name.replace(/[<>:"/\\|?*]/g, "_");
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
