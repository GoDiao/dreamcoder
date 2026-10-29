import { richTextStyle } from "./model.mjs";
import { parsePageLink } from "../../portable/page-link.mjs";
import { translator } from "../../i18n";
import messages from "../../i18n/messages/richText";
import { Extension, mergeAttributes, Node, Mark } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import StarterKit from "@tiptap/starter-kit";
import { HighlightedCodeBlock } from "./code-block";
import Placeholder from "@tiptap/extension-placeholder";
import Image from "@tiptap/extension-image";
import { TableKit, TableView } from "@tiptap/extension-table";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { ReadingHighlight } from "./reading-highlight";
import TextAlign from "@tiptap/extension-text-align";
import { TableAlignmentAttributes } from "./table-alignment";
import { DropCursorCleanup } from "./drop-cursor-cleanup";
import {
  CalloutView,
  ToggleView,
  StepperView,
  WidgetView,
  MathView,
  ImageView,
} from "./NodeViews";

export const blockIdNodeTypes = [
  "paragraph",
  "heading",
  "blockquote",
  "bulletList",
  "orderedList",
  "listItem",
  "taskList",
  "taskItem",
  "codeBlock",
  "hardBreak",
  "horizontalRule",
  "image",
  "table",
  "tableRow",
  "tableCell",
  "tableHeader",
  "callout",
  "toggle",
  "stepper",
  "step",
  "widget",
  "mathInline",
  "mathBlock",
];

export const blockIdPluginKey = new PluginKey("showaiBlockIds");

/** Attribute-only steps leave document positions, selection, and text untouched. */
export function createBlockIdPlugin(isEditable: () => boolean): Plugin {
  const types = new Set([
    ...blockIdNodeTypes,
    "region",
    "richText",
    "pageModule",
  ]);
  return new Plugin({
    key: blockIdPluginKey,
    appendTransaction(transactions, _previous, current) {
      if (
        !isEditable() ||
        !transactions.some(
          (transaction) =>
            transaction.docChanged ||
            transaction.getMeta(blockIdPluginKey) ||
            transaction.getMeta("editableChanged"),
        )
      )
        return null;
      const used = new Set<string>();
      const transaction = current.tr;
      current.doc.descendants((node, position) => {
        if (!types.has(node.type.name)) return;
        const existing = node.attrs.id;
        if (
          typeof existing === "string" &&
          existing.trim() &&
          !used.has(existing)
        ) {
          used.add(existing);
          return;
        }
        let id: string;
        do {
          id = globalThis.crypto.randomUUID();
        } while (used.has(id));
        used.add(id);
        transaction.setNodeAttribute(position, "id", id);
      });
      if (!transaction.docChanged) return null;
      return transaction
        .setMeta(blockIdPluginKey, true)
        .setMeta("addToHistory", false);
    },
  });
}

export const StableBlockIds = Extension.create<{ readOnly: boolean }>({
  name: "showaiStableBlockIds",
  addOptions: () => ({ readOnly: false }),
  addGlobalAttributes() {
    return [
      {
        types: [...blockIdNodeTypes, "region", "richText", "pageModule"],
        attributes: {
          id: {
            default: null,
            parseHTML: (element) => element.getAttribute("data-block-id"),
            renderHTML: (attributes) =>
              typeof attributes.id === "string" && attributes.id.trim()
                ? { "data-block-id": attributes.id }
                : {},
          },
        },
      },
    ];
  },
  addProseMirrorPlugins() {
    return [
      createBlockIdPlugin(
        () => !this.options.readOnly && this.editor.isEditable,
      ),
    ];
  },
  onCreate() {
    if (!this.options.readOnly && this.editor.isEditable) {
      this.editor.view.dispatch(
        this.editor.state.tr
          .setMeta(blockIdPluginKey, true)
          .setMeta("addToHistory", false),
      );
    }
  },
});

export const WidgetNode = Node.create({
  name: "widget",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes() {
    return {
      kind: { default: "chart" },
      data: {
        default: {},
        parseHTML: (element) => {
          const value = element.getAttribute("data-widget-content");
          if (!value) return {};
          try {
            return JSON.parse(value);
          } catch {
            return {};
          }
        },
        renderHTML: (attributes) => ({
          "data-widget-content": JSON.stringify(attributes.data),
        }),
      },
    };
  },
  parseHTML: () => [{ tag: "div[data-showai-widget]" }],
  renderHTML: ({ HTMLAttributes }) => [
    "div",
    mergeAttributes(HTMLAttributes, { "data-showai-widget": "" }),
  ],
  addNodeView: () => ReactNodeViewRenderer(WidgetView),
});

export const CalloutNode = Node.create({
  name: "callout",
  group: "block",
  content: "block+",
  defining: true,
  draggable: true,
  addAttributes: () => ({
    icon: { default: "💡" },
    tone: { default: "sage" },
    title: { default: "" },
  }),
  parseHTML: () => [{ tag: "aside[data-callout]" }],
  renderHTML: ({ HTMLAttributes }) => [
    "aside",
    mergeAttributes(HTMLAttributes, { "data-callout": "" }),
    0,
  ],
  addNodeView: () => ReactNodeViewRenderer(CalloutView),
});

export const ToggleNode = Node.create({
  name: "toggle",
  group: "block",
  content: "block+",
  defining: true,
  draggable: true,
  addAttributes: () => ({
    title: { default: "展开了解更多" }, // i18n-exempt: default title saved into documents
    open: { default: true },
  }),
  parseHTML: () => [{ tag: "section[data-toggle]" }],
  renderHTML: ({ HTMLAttributes }) => [
    "section",
    mergeAttributes(HTMLAttributes, { "data-toggle": "" }),
    0,
  ],
  addNodeView: () => ReactNodeViewRenderer(ToggleView),
});

/** Ordered steps shown one at a time; which step is open is reading state, kept per reader and never saved to the page. */
export const StepperNode = Node.create({
  name: "stepper",
  group: "block",
  content: "step+",
  defining: true,
  draggable: true,
  isolating: true,
  parseHTML: () => [{ tag: "section[data-stepper]" }],
  renderHTML: ({ HTMLAttributes }) => [
    "section",
    mergeAttributes(HTMLAttributes, { "data-stepper": "" }),
    0,
  ],
  addNodeView: () => ReactNodeViewRenderer(StepperView),
});

/** One step: a short title and any blocks, including other components. */
export const StepNode = Node.create({
  name: "step",
  content: "block+",
  defining: true,
  isolating: true,
  addAttributes: () => ({
    title: { default: "" },
  }),
  parseHTML: () => [{ tag: "section[data-step]" }],
  renderHTML: ({ HTMLAttributes }) => [
    "section",
    mergeAttributes(HTMLAttributes, { "data-step": "" }),
    0,
  ],
});

export const RichTextNode = Node.create({
  name: "richText",
  priority: 50,
  group: "block",
  content: "block*",
  defining: true,
  addAttributes: () => ({
    id: { default: null },
    name: { default: "富文本" }, // i18n-exempt: default node name saved into documents
    data: {
      default: {},
      parseHTML: (element) =>
        JSON.parse(element.getAttribute("data-rich-text-settings") || "{}"),
      renderHTML: () => ({}),
    },
  }),
  parseHTML: () => [
    { tag: 'div[data-component-kind="text"]' },
    { tag: 'div[data-page-flow="richText"]' },
  ],
  renderHTML: ({ node, HTMLAttributes }) => [
    "div",
    mergeAttributes(HTMLAttributes, {
      "data-component-kind": "text",
      "data-rich-text-settings": JSON.stringify(node.attrs.data),
      class: "page-document-flow rich-text-component",
      style: Object.entries(richTextStyle(node.attrs.data))
        .filter(([, v]) => v !== undefined)
        .map(
          ([k, v]) =>
            `${k.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase())}:${typeof v === "number" ? `${v}px` : v}`,
        )
        .join(";"),
    }),
    0,
  ],
});

const TextStyle = Mark.create({
  name: "textStyle",
  addAttributes: () =>
    Object.fromEntries(
      ["color", "fontFamily", "fontSize"].map((key) => [
        key,
        {
          default: null,
          parseHTML: (element: HTMLElement) => element.style[key as "color"],
          renderHTML: (attrs: Record<string, string>) =>
            attrs[key]
              ? {
                  style: `${key.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase())}: ${attrs[key]}`,
                }
              : {},
        },
      ]),
    ),
  parseHTML: () => [{ tag: "span[style]" }],
  renderHTML: ({ HTMLAttributes }) => [
    "span",
    mergeAttributes(HTMLAttributes),
    0,
  ],
});
// [visible text]{note}: hovering, focusing or tapping the text shows the note.
const Annotation = Mark.create({
  name: "annotation",
  inclusive: false,
  addAttributes: () => ({
    note: {
      default: "",
      parseHTML: (element: HTMLElement) =>
        element.getAttribute("data-showai-note") ?? "",
      renderHTML: (attrs: { note?: string }) => ({
        "data-showai-note": attrs.note ?? "",
      }),
    },
  }),
  parseHTML: () => [{ tag: "span[data-showai-note]" }],
  renderHTML: ({ HTMLAttributes }) => [
    "span",
    mergeAttributes({ class: "showai-note" }, HTMLAttributes),
    0,
  ],
});
const mathNode = (inline: boolean) =>
  Node.create({
    name: inline ? "mathInline" : "mathBlock",
    group: inline ? "inline" : "block",
    inline,
    atom: true,
    addAttributes: () => ({
      latex: { default: "" },
      display: { default: !inline },
    }),
    parseHTML: () => [{ tag: inline ? "span[data-math]" : "div[data-math]" }],
    renderHTML: ({ node, HTMLAttributes }) => [
      inline ? "span" : "div",
      { ...HTMLAttributes, "data-math": node.attrs.latex },
    ],
    addNodeView: () => ReactNodeViewRenderer(MathView),
  });

const t = translator(messages);

export function createExtensions(
  options: {
    readOnly?: boolean;
    /** Called while rendering so the placeholder follows the current language. */
    placeholder?: string | ((context: { empty: boolean }) => string);
    trailingNode?: boolean;
  } = {},
) {
  return [
    ContentAttributes,
    RichTextNode,
    TextStyle,
    Annotation,
    mathNode(true),
    mathNode(false),
    StableBlockIds.configure({ readOnly: options.readOnly ?? false }),
    DropCursorCleanup,
    StarterKit.configure({
      trailingNode: options.trailingNode === false ? false : {},
      heading: { levels: [1, 2, 3, 4, 5, 6] },
      link: {
        openOnClick: options.readOnly ?? false,
        HTMLAttributes: { rel: "noopener noreferrer", target: "_blank" },
        // ShowAI page links are kept; the page around the editor follows them.
        isAllowedUri: (url, context) =>
          !!parsePageLink(url) || context.defaultValidate(url),
      },
      codeBlock: false,
    }),
    HighlightedCodeBlock,
    Placeholder.configure({
      placeholder: ({ node, editor }) =>
        node.type.name === "heading"
          ? t("placeholderHeading")
          : typeof options.placeholder === "function"
            ? options.placeholder({ empty: editor.isEmpty })
            : (options.placeholder ?? t("placeholderDefault")),
      includeChildren: false,
    }),
    Image.extend({
      addNodeView: () => ReactNodeViewRenderer(ImageView),
    }).configure({
      allowBase64: true,
      HTMLAttributes: { class: "document-image" },
    }),
    TableKit.configure({ table: { resizable: true, View: ContentTableView } }),
    TableAlignmentAttributes,
    TaskList,
    TaskItem.configure({ nested: true }),
    ReadingHighlight.configure({ multicolor: true }),
    TextAlign.configure({ types: ["heading", "paragraph"] }),
    CalloutNode,
    ToggleNode,
    StepperNode,
    StepNode,
    WidgetNode,
  ];
}

/** Persist the same metadata through every ProseMirror edit and clipboard round trip. */
const ContentAttributes = Extension.create({
  name: "showaiContentAttributes",
  addGlobalAttributes() {
    const attribute = (name: string) => ({
      default: null,
      parseHTML: (element: HTMLElement) => {
        const value = element.getAttribute(
          `data-content-${name.toLowerCase()}`,
        );
        if (value === null) return null;
        try {
          return name === "title" ? value : JSON.parse(value);
        } catch {
          return null;
        }
      },
      renderHTML: (attrs: Record<string, unknown>) =>
        attrs[name] == null
          ? {}
          : {
              [`data-content-${name.toLowerCase()}`]:
                name === "title"
                  ? String(attrs[name])
                  : JSON.stringify(attrs[name]),
              ...(name === "componentStyle"
                ? {
                    style: Object.entries({
                      ...richTextStyle(attrs[name] as Record<string, unknown>),
                      borderTopColor: (attrs[name] as Record<string, unknown>)
                        ?.color,
                    })
                      .filter(([, value]) => value !== undefined)
                      .map(
                        ([key, value]) =>
                          `${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}:${typeof value === "number" ? `${value}px` : value}`,
                      )
                      .join(";"),
                  }
                : {}),
            },
    });
    return [
      {
        types: blockIdNodeTypes,
        attributes: { name: { ...attribute("name"), default:"",
          parseHTML:(element:HTMLElement)=>{
            const value=attribute("name").parseHTML(element);
            return typeof value === "string" ? value:"";
          },
        } },
      },
      {
        types: [
          "image",
          "codeBlock",
          "table",
          "callout",
          "toggle",
          "stepper",
          "horizontalRule",
        ],
        attributes: { componentStyle: attribute("componentStyle") },
      },
      {
        types: ["image"],
        attributes: Object.fromEntries(
          ["caption", "fit", "nativeInk", "width", "height", "align"].map(
            (key) => [key, attribute(key)],
          ),
        ),
      },
      { types: ["table"], attributes: { title: attribute("title") } },
    ];
  },
});

/** Retain Tiptap resizing and cell editing while displaying shared table metadata. */
class ContentTableView extends TableView {
  constructor(...args: ConstructorParameters<typeof TableView>) {
    super(...args);
    this.syncMetadata();
  }
  syncMetadata() {
    const style = richTextStyle(this.node.attrs.componentStyle);
    this.dom.style.cssText = "";
    Object.assign(
      this.dom.style,
      Object.fromEntries(
        Object.entries(style)
          .filter(([, value]) => value !== undefined)
          .map(([key, value]) => [
            key,
            typeof value === "number" ? `${value}px` : value,
          ]),
      ),
    );
    if (this.node.attrs.id) this.table.dataset.blockId = this.node.attrs.id;
    const title = this.node.attrs.title;
    if (title) {
      const caption = this.table.caption ?? this.table.createCaption();
      caption.textContent = title;
    } else this.table.caption?.remove();
    this.dom.tabIndex = 0;
  }
  update(node: Parameters<TableView["update"]>[0]) {
    if (!super.update(node)) return false;
    this.syncMetadata();
    return true;
  }
}
