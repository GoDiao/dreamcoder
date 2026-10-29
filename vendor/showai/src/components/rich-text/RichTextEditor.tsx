import { textRangeEditMeta } from "./text-range-edit";
import { registerSelectionEditor } from "../../surface/text-selection";
import { ContentNodeActions } from "./ContentNodeActions";
import { primitiveNodeTypes, primitiveContentNode } from "./model.mjs";
import { CAPACITY, formatBytes } from "../../portable/capacity.mjs";
import {
  navigationTarget,
  pageLink,
  parsePageLink,
  requestNavigation,
} from "../../portable/page-link.mjs";
import { translator } from "../../i18n";
import { useTranslator } from "../../i18n/react";
import commonMessages from "../../i18n/messages/common";
import { supportsManualEditing } from "../blocks/manual-editing";
import messages from "../../i18n/messages/richText";
import noteMessages from "../../i18n/messages/richTextNotes";
import ExpandableSearch from "../ExpandableSearch";
import { RichTextEnvironment } from "./environment";
import type { CatalogComponent } from "../../core/component-categories";
import {
  splitForComponent,
  type TextInsertionPoint,
} from "./component-insertion";
import {
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useId,
  useRef,
  useState,
  type DragEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { RetainedEditorContent as EditorContent } from "./RetainedEditorContent";
import {
  hasRetainedSelection,
  useWorkspaceEditor,
} from "../../editor/workspace-editor";
import { editorNodeJSON } from "../../editor/node-json";
import { selectionBlockIds } from "./assistant-selection";
import type { Editor, JSONContent, Extensions } from "@tiptap/core";
import { NodeSelection, Selection, TextSelection } from "@tiptap/pm/state";
import { clearWidgetSelection } from "./widget-selection";
import { externalContentTransaction } from "./external-content";
import { CellSelection } from "@tiptap/pm/tables";
import { SelectionToolbar } from "../../editor/SelectionToolbar";
import { ToolbarPanel } from "../../editor/ToolbarPanel";
import { TableSelectionActions } from "./TableSelectionActions";
import {
  documentTableActionMeta,
  restoreDocumentTableCellSelection,
} from "./table-selection";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowDown,
  ArrowUp,
  AtSign,
  Check,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  CodeXml,
  Copy,
  ExternalLink,
  Expand,
  FileText,
  GripVertical,
  Heading1,
  Heading2,
  Heading3,
  ImagePlus,
  Link2,
  List,
  ListOrdered,
  ArrowRight,
  MessageSquareQuote,
  MessageSquareText,
  Minus,
  PanelTop,
  Plus,
  Quote,
  Redo2,
  Sparkles,
  Table2,
  Trash2,
  Type,
  Undo2,
  Upload,
  X,
} from "../../ui/icons";
import { TableControls } from "./TableControls";
import { FormatControls } from "./FormatControls";
import { createExtensions } from "./extensions";
import {
  NOTE_MAX,
  annotateLatex,
  outerLatexNote,
} from "../blocks/note-markup.mjs";
import "./editor.css";

const initialSelections = new WeakSet<Editor>();
const translate = translator(messages);
export interface RichTextEditorProps {
  content: JSONContent;
  onChange: (
    content: JSONContent,
    options?: { separateHistory?: boolean; historyGroup?: string },
  ) => void;
  readOnly?: boolean;
  minimal?: boolean;
  additionalExtensions?: Extensions;
  trailingNode?: boolean;
  retentionKey?: string;
  onEditorReady?: (editor: Editor) => void;
  onInsertNative?: (
    kind: string,
    data: Record<string, unknown>,
    point: TextInsertionPoint,
  ) => void;
  onDetachBlock?: (node: JSONContent) => void;
}

interface MenuItem {
  id: string;
  title: string;
  keywords: string;
  icon: ReactNode;
  group: string;
  run: (editor: Editor) => void;
  component?: CatalogComponent;
}

interface SlashState {
  from: number;
  to: number;
  query: string;
  left: number;
  top: number;
  manual?: boolean;
}
interface HoverBlock {
  pos: number;
  size: number;
  top: number;
  index: number;
}
type DialogState = {
  type: "image" | "link" | "note";
  value: string;
  alt: string;
  /** Formula node that receives the note through \note in its LaTeX. */
  math?: { pos: number; body: string };
  /** The selection already carried a note when the dialog opened. */
  hadNote?: boolean;
};

function DialogBackdrop({
  children,
  className,
  onDismiss,
}: {
  children: ReactNode;
  className?: string;
  onDismiss: () => void;
}) {
  return (
    <div
      className={className}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onDismiss();
      }}
    >
      {children}
    </div>
  );
}

function ToolButton({
  label,
  children,
  onClick,
  active,
  disabled,
}: {
  label: string;
  children: ReactNode;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className={`editor-tool${active ? " is-active" : ""}`}
      aria-label={label}
      title={label}
      aria-pressed={active}
      disabled={disabled}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function safeImageUrl(value: string) {
  return (
    /^https?:\/\//i.test(value) ||
    /^data:image\/(png|jpe?g|gif|webp|avif);base64,/i.test(value)
  );
}

function safeLinkUrl(value: string) {
  return /^(https?:\/\/|mailto:|tel:|#)/i.test(value) || !!parsePageLink(value);
}

/** Page editors append a synthetic tail paragraph that is not stored in the document. */
function isSyntheticId(id: string) {
  return id.startsWith("page-tail-");
}
function menuPosition(editor: Editor, from: number) {
  const rect = editor.view.coordsAtPos(
    Math.min(from, editor.state.doc.content.size),
  );
  return {
    left: Math.max(12, Math.min(rect.left, window.innerWidth - 340)),
    top: Math.max(70, Math.min(rect.bottom + 8, window.innerHeight - 370)),
  };
}

export default function RichTextEditor({
  content,
  onChange,
  readOnly = false,
  minimal = true,
  onEditorReady,
  onInsertNative,
  onDetachBlock,
  additionalExtensions,
  trailingNode = true,
  retentionKey,
}: RichTextEditorProps) {
  const t = useTranslator(messages);
  const tc = useTranslator(commonMessages);
  const tn = useTranslator(noteMessages);
  const latestOnChange = useRef(onChange);
  const selectionMenuId = useId();
  latestOnChange.current = onChange;
  const wrapperRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const slashInputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<SlashState | null>(null);
  const dismissedSlash = useRef<string | null>(null);
  const itemsRef = useRef<MenuItem[]>([]);
  const runItemRef = useRef<(index: number) => void>(() => {});
  const selectedRef = useRef(0);
  const dragPosition = useRef<number | null>(null);
  const [slash, setSlash] = useState<SlashState | null>(null);
  const { useCatalog, registerComponent, assistant, pageLinks } =
    useContext(RichTextEnvironment);
  const pageLinksRef = useRef(pageLinks);
  pageLinksRef.current = pageLinks;
  const catalog = useCatalog(!!slash);
  const [inserting, setInserting] = useState(false);
  const insertionTicket = useRef(0);
  useEffect(
    () => () => {
      insertionTicket.current++;
    },
    [],
  );
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [hover, setHover] = useState<HoverBlock | null>(null);
  const [blockMenu, setBlockMenu] = useState(false);
  const hoverHideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hoverMenuOpen = useRef(blockMenu);
  hoverMenuOpen.current = blockMenu;
  // Pointer moves are measured once per frame; moving within one block keeps state.
  const hoverFrame = useRef(0);
  const hoverPointer = useRef(0);
  useEffect(() => () => cancelAnimationFrame(hoverFrame.current), []);
  const keepBlockHandle = useCallback(() => {
    if (hoverHideTimer.current !== null) {
      clearTimeout(hoverHideTimer.current);
      hoverHideTimer.current = null;
    }
  }, []);
  const hideBlockHandleLater = useCallback(() => {
    if (hoverHideTimer.current !== null) return;
    hoverHideTimer.current = setTimeout(() => {
      hoverHideTimer.current = null;
      const handle = wrapperRef.current?.querySelector(".block-handle");
      if (
        hoverMenuOpen.current ||
        dragPosition.current !== null ||
        handle?.contains(document.activeElement)
      )
        return;
      setHover(null);
    }, 450);
  }, []);
  useEffect(() => keepBlockHandle, [keepBlockHandle]);
  const [styleMenu, setStyleMenu] = useState(false);
  const [insertMenu, setInsertMenu] = useState(false);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [dialogToolbar, setDialogToolbar] = useState<HTMLElement | null>(null);
  const [dialogError, setDialogError] = useState("");
  const [notice, setNotice] = useState("");
  const [bubble, setBubble] = useState<{
    left: number;
    top: number;
    bottom: number;
  } | null>(null);
  useEffect(() => {
    if (!bubble && dialogToolbar) {
      setDialog(null);
      setDialogToolbar(null);
    }
  }, [Boolean(bubble), dialogToolbar]);
  const dismissedSelection = useRef<string | null>(null);
  // Native selects and color pickers blur ProseMirror before they emit a value.
  const selectionMenuInteracting = useRef(false);
  const [, setRevision] = useState(0);
  const selectionBeforeDialog = useRef<{ from: number; to: number } | null>(
    null,
  );
  menuRef.current = slash;
  selectedRef.current = selectedIndex;

  const extensions = useMemo(
    () => [
      ...createExtensions({
        // An empty page (no trailing node: the continuous page editor) points to the Agent.
        placeholder: ({ empty }) =>
          translate(empty && !trailingNode ? "placeholderPage" : "placeholder"),
        trailingNode,
      }),
      ...(additionalExtensions ?? []),
    ],
    [additionalExtensions, trailingNode],
  );
  useLayoutEffect(() => {
    if (!blockMenu) return;
    const root = wrapperRef.current;
    const menu = root?.querySelector<HTMLElement>(".block-menu");
    const handle = root?.querySelector<HTMLElement>(".block-handle");
    if (!menu || !handle) return;
    const place = () => {
      const anchor = handle.getBoundingClientRect();
      const rect = menu.getBoundingClientRect();
      Object.assign(menu.style, {
        position: "fixed",
        left: `${Math.max(12, Math.min(anchor.right, window.innerWidth - rect.width - 12))}px`,
        top: `${Math.max(12, Math.min(anchor.top, window.innerHeight - rect.height - 12))}px`,
      });
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(menu);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [blockMenu, hover?.pos]);
  const editor = useWorkspaceEditor({
    retentionKey,
    extensions,
    content,
    editable: !readOnly,
    immediatelyRender: false,
    shouldRerenderOnTransaction: false,
    editorProps: {
      attributes: {
        class: "document-content",
        "aria-label": translate("documentContent"),
        spellcheck: "false",
      },
      handleKeyDown: (view, event) => {
        if (event.isComposing) return false;
        if (
          event.key === "Escape" &&
          !menuRef.current &&
          !view.state.selection.empty
        ) {
          dismissedSelection.current = `${view.state.selection.from}:${view.state.selection.to}`;
          setBubble(null);
          event.preventDefault();
          return true;
        }
        if (!menuRef.current) return false;
        if (event.key === "Escape") {
          dismissSlash();
          return true;
        }
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          const count = itemsRef.current.length;
          setSelectedIndex((index) =>
            count
              ? (index + (event.key === "ArrowDown" ? 1 : -1) + count) % count
              : 0,
          );
          return true;
        }
        if (event.key === "Enter" && itemsRef.current.length) {
          runItemRef.current(selectedRef.current);
          return true;
        }
        return false;
      },
      handleClick: (_view, _position, event) => {
        const link = (event.target as Element).closest?.(
          "a[href]",
        ) as HTMLAnchorElement | null;
        if (!link || (!readOnly && !event.metaKey && !event.ctrlKey))
          return false;
        const href = link.getAttribute("href") ?? "";
        if (!safeLinkUrl(href)) return true;
        const target = navigationTarget(href);
        // The modifier that follows a link while editing is not a tab request.
        if (target && requestNavigation(link, target, readOnly ? event : undefined))
          return true;
        if (href.startsWith("#")) {
          const target = document.getElementById(href.slice(1));
          target?.scrollIntoView({ behavior: "smooth", block: "start" });
        } else if (!target) window.open(href, "_blank", "noopener,noreferrer");
        return true;
      },
      handlePaste: (view, event) => {
        const pasted = event.clipboardData?.getData("text/plain").trim() ?? "";
        const linked = parsePageLink(pasted);
        if (linked) {
          // A copied page link links the selected text, or inserts the page title.
          event.preventDefault();
          const { empty, from, to } = view.state.selection;
          const mark = view.state.schema.marks.link.create({ href: pasted });
          view.dispatch(
            empty
              ? view.state.tr.insert(
                  from,
                  view.state.schema.text(linkLabel(pasted), [mark]),
                )
              : view.state.tr.addMark(from, to, mark),
          );
          return true;
        }
        const files = [...(event.clipboardData?.files ?? [])].filter((file) =>
          file.type.startsWith("image/"),
        );
        if (!files.length) return false;
        event.preventDefault();
        void insertImageFiles(files);
        return true;
      },
    },
    onUpdate: ({ editor: current, transaction }) =>
      latestOnChange.current(editorNodeJSON(current.state.doc), {
        separateHistory: Boolean(transaction.getMeta(documentTableActionMeta)),
        historyGroup: transaction.getMeta(textRangeEditMeta),
      }),
  });

  useEffect(
    () => (editor ? registerSelectionEditor(editor) : undefined),
    [editor],
  );
  useEffect(() => {
    if (editor) onEditorReady?.(editor);
  }, [editor, onEditorReady]);
  useEffect(() => {
    if (editor && editor.isEditable === readOnly) {
      editor.setEditable(!readOnly, false);
      editor.view.dispatch(editor.state.tr.setMeta("editableChanged", true));
    }
    setRevision((value) => value + 1);
    if (readOnly) {
      setSlash(null);
      setHover(null);
      setBlockMenu(false);
      setStyleMenu(false);
      setInsertMenu(false);
      setDialog(null);
      setBubble(null);
    }
  }, [editor, readOnly]);
  // React node views (toggle, callout, stepper) render synchronously while a
  // transaction is applied; the page re-renders inside that flush with the
  // previous echo of its content. Syncing then would revert the transaction.
  const latestContent = useRef(content);
  latestContent.current = content;
  const dispatching = useRef(false);
  useEffect(() => {
    if (!editor) return;
    const begin = () => {
      dispatching.current = true;
    };
    const end = () => {
      dispatching.current = false;
    };
    editor.on("beforeTransaction", begin);
    editor.on("transaction", end);
    return () => {
      editor.off("beforeTransaction", begin);
      editor.off("transaction", end);
    };
  }, [editor]);
  useLayoutEffect(() => {
    if (!editor) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const apply = () => {
      if (editor.isDestroyed) return;
      if (editor.view.composing || dispatching.current) {
        timer = setTimeout(apply, dispatching.current ? 0 : 25);
        return;
      }
      const transaction = externalContentTransaction(
        editor.state,
        latestContent.current,
      );
      if (!transaction) return;
      const widgetId =
        editor.state.selection instanceof NodeSelection &&
        editor.state.selection.node.type.name === "widget"
          ? editor.state.selection.node.attrs.id
          : null;
      const cellSelection =
        editor.state.selection instanceof CellSelection
          ? editor.state.selection
          : null;
      editor.view.dispatch(transaction);
      if (cellSelection) {
        const restored = restoreDocumentTableCellSelection(
          editor.state.doc,
          cellSelection,
        );
        if (restored)
          editor.view.dispatch(editor.state.tr.setSelection(restored));
      }
      if (widgetId) {
        let position: number | undefined;
        editor.state.doc.descendants((node, pos) => {
          if (node.type.name === "widget" && node.attrs.id === widgetId)
            position = pos;
        });
        if (position !== undefined) editor.commands.setNodeSelection(position);
        else {
          const transaction = clearWidgetSelection(editor.state);
          if (transaction) editor.view.dispatch(transaction);
        }
      }
    };
    const afterComposition = () => {
      timer = setTimeout(apply, 25);
    };
    if (editor.view.composing)
      editor.view.dom.addEventListener("compositionend", afterComposition);
    else apply();
    return () => {
      if (timer) clearTimeout(timer);
      editor.view.dom.removeEventListener("compositionend", afterComposition);
    };
  }, [content, editor]);

  useEffect(() => {
    if (!dialog) return;
    const focusFrame = requestAnimationFrame(() =>
      document
        .querySelector<HTMLInputElement>(
          ".editor-modal input, .editor-modal textarea",
        )
        ?.focus(),
    );
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setDialog(null);
        editor?.commands.focus();
      }
      if (event.key !== "Tab") return;
      const targets = Array.from(
        document.querySelectorAll<HTMLElement>(
          ".editor-modal button:not(:disabled), .editor-modal input:not(:disabled), .editor-modal textarea:not(:disabled)",
        ),
      );
      const first = targets[0];
      const last = targets[targets.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [Boolean(dialog), editor]);

  useEffect(() => {
    if (!editor || readOnly) return;
    const clearInitialSelection = () => {
      const transaction = clearWidgetSelection(editor.state);
      if (transaction) editor.view.dispatch(transaction);
    };
    if (!initialSelections.has(editor) && !hasRetainedSelection(editor)) {
      initialSelections.add(editor);
      if (editor.isInitialized) clearInitialSelection();
      else editor.on("create", clearInitialSelection);
    }
    const clearOnBlank = (event: PointerEvent) => {
      if (event.button !== 0 || !(event.target instanceof Element)) return;
      const target = event.target;
      const widget = target.closest(".document-widget");
      if (widget && editor.view.dom.contains(widget)) return;
      // Keep the selection while using its formatting, menus and dialogs.
      if (
        !widget &&
        target.closest(
          'button, input, textarea, select, a, summary, [role="button"], [role="dialog"], .block-handle, .editor-toolbar, .editor-bubble, .editor-small-menu, .editor-modal',
        )
      )
        return;
      const transaction = clearWidgetSelection(editor.state);
      if (!transaction) return;
      const active = document.activeElement;
      if (active instanceof HTMLElement && editor.view.dom.contains(active))
        active.blur();
      editor.view.dispatch(transaction);
      // Editor whitespace otherwise lets ProseMirror select the nearest atom again.
      if (
        editor.view.dom.contains(target) &&
        !target.closest("[data-block-id]")
      )
        event.preventDefault();
    };
    document.addEventListener("pointerdown", clearOnBlank, true);
    return () => {
      editor.off("create", clearInitialSelection);
      document.removeEventListener("pointerdown", clearOnBlank, true);
    };
  }, [editor, readOnly]);

  useEffect(() => {
    if (!slash?.manual) return;
    const frame = requestAnimationFrame(() => slashInputRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [slash?.manual]);

  useEffect(() => {
    if (!styleMenu && !insertMenu && !blockMenu) return;
    const closeMenus = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setStyleMenu(false);
      setInsertMenu(false);
      setBlockMenu(false);
      editor?.commands.focus();
    };
    document.addEventListener("keydown", closeMenus);
    return () => document.removeEventListener("keydown", closeMenus);
  }, [styleMenu, insertMenu, blockMenu, editor]);

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(""), 4500);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  useEffect(() => {
    if (!editor) return;
    const refresh = () => {
      if (!minimal || !editor.state.selection.empty)
        setRevision((value) => value + 1);
      if (!editor.isEditable) return;
      const { selection } = editor.state;
      const { $from, from, to, empty } = selection;
      if (
        empty ||
        (dismissedSelection.current &&
          dismissedSelection.current !== `${from}:${to}`)
      )
        dismissedSelection.current = null;
      if (!menuRef.current?.manual) {
        const text = $from.parent.isTextblock
          ? $from.parent.textBetween(0, $from.parentOffset, "\n")
          : "";
        const match = empty && text.match(/^\/([^\n/]*)$/);
        if (match) {
          const start = from - match[0].length;
          if (dismissedSlash.current !== `${start}:${to}:${match[1]}`) {
            dismissedSlash.current = null;
            setSlash({
              from: start,
              to,
              query: match[1],
              ...menuPosition(editor, from),
            });
          }
        } else {
          setSlash(null);
          dismissedSlash.current = null;
        }
      }
      if (
        !empty &&
        dismissedSelection.current !== `${from}:${to}` &&
        (editor.isFocused || selectionMenuInteracting.current) &&
        !editor.isActive("codeBlock") &&
        !editor.isActive("widget") &&
        !editor.isActive("pageModule")
      ) {
        const start = editor.view.coordsAtPos(from);
        const end = editor.view.coordsAtPos(to);
        setBubble({
          left: (start.left + end.right) / 2,
          top: start.top,
          bottom: Math.max(start.bottom, end.bottom),
        });
      } else setBubble(null);
    };
    const ownsMenuTarget = (target: EventTarget | null) =>
      target instanceof Element &&
      target.closest(".editor-bubble")?.id === selectionMenuId;
    const enteringMenu = (event: FocusEvent) => {
      // Capture keyboard focus transfers before Tiptap's blur transaction.
      if (ownsMenuTarget(event.relatedTarget))
        selectionMenuInteracting.current = true;
    };
    const hideBubble = () => {
      selectionMenuInteracting.current = false;
      setBubble(null);
    };
    const trackMenuInteraction = (event: Event) => {
      selectionMenuInteracting.current = ownsMenuTarget(event.target);
      if (
        !selectionMenuInteracting.current &&
        (!(event.target instanceof Node) ||
          !editor.view.dom.contains(event.target))
      )
        hideBubble();
    };
    const blur = ({ event }: { event: FocusEvent }) => {
      if (
        !selectionMenuInteracting.current &&
        !ownsMenuTarget(event.relatedTarget)
      )
        hideBubble();
    };
    const scroll = (event: Event) => {
      if (!ownsMenuTarget(event.target)) hideBubble();
    };
    const viewportChanged = (event: Event) => {
      if (
        !(event.target instanceof Element) ||
        !event.target.contains(editor.view.dom)
      )
        return;
      setBubble(null);
      setSlash(null);
      setBlockMenu(false);
      setHover(null);
    };
    editor.on("transaction", refresh);
    editor.on("focus", refresh);
    editor.on("blur", blur);
    editor.view.dom.addEventListener("blur", enteringMenu, true);
    document.addEventListener("pointerdown", trackMenuInteraction, true);
    document.addEventListener("focusin", trackMenuInteraction, true);
    editor.view.dom.addEventListener("contextmenu", hideBubble);
    window.addEventListener("scroll", scroll, true);
    window.addEventListener("resize", refresh);
    window.addEventListener("showai:viewport-change", viewportChanged);
    return () => {
      editor.off("transaction", refresh);
      editor.off("focus", refresh);
      editor.off("blur", blur);
      editor.view.dom.removeEventListener("blur", enteringMenu, true);
      document.removeEventListener("pointerdown", trackMenuInteraction, true);
      document.removeEventListener("focusin", trackMenuInteraction, true);
      editor.view.dom.removeEventListener("contextmenu", hideBubble);
      window.removeEventListener("scroll", scroll, true);
      window.removeEventListener("resize", refresh);
      window.removeEventListener("showai:viewport-change", viewportChanged);
    };
  }, [editor, selectionMenuId, minimal]);

  useEffect(() => setSelectedIndex(0), [slash?.query]);
  useEffect(() => {
    document
      .querySelector(".slash-menu .slash-item.is-selected")
      ?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  function dismissSlash() {
    const current = menuRef.current;
    if (current && !current.manual)
      dismissedSlash.current = `${current.from}:${current.to}:${current.query}`;
    menuRef.current = null;
    setSlash(null);
  }

  /** Text for a link inserted without a selection: the page title for page links. */
  function linkLabel(href: string) {
    const target = parsePageLink(href);
    const bridge = pageLinksRef.current;
    const title =
      target &&
      bridge?.projectId === target.projectId &&
      bridge.pages.find((page) => page.id === target.pageId)?.title;
    return title || href;
  }
  function applyLink(value: string) {
    if (!editor) return;
    if (selectionBeforeDialog.current)
      editor.commands.setTextSelection(selectionBeforeDialog.current);
    if (!value)
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
    else if (editor.state.selection.empty && !editor.isActive("link"))
      editor
        .chain()
        .focus()
        .insertContent({
          type: "text",
          text: linkLabel(value),
          marks: [{ type: "link", attrs: { href: value } }],
        })
        .run();
    else
      editor
        .chain()
        .focus()
        .extendMarkRange("link")
        .setLink({ href: value })
        .run();
    setDialog(null);
  }
  const linkQuery =
    dialog?.type === "link" && pageLinks && !/^[a-z][a-z0-9+.-]*:|^#/i.test(dialog.value.trim())
      ? dialog.value.trim().toLocaleLowerCase()
      : null;
  // Typing a page name instead of an address offers the project's pages.
  const linkSuggestions = useMemo(
    () =>
      linkQuery === null || !pageLinks
        ? []
        : pageLinks.pages
            .filter(
              (page) =>
                page.id !== pageLinks.pageId &&
                (page.title || t("dialog.untitledPage"))
                  .toLocaleLowerCase()
                  .includes(linkQuery),
            )
            .slice(0, 6)
            .map((page) => ({
              ...page,
              href: pageLink({ projectId: pageLinks.projectId, pageId: page.id }),
            })),
    [linkQuery, pageLinks, t],
  );
  const [linkChoice, setLinkChoice] = useState(-1);
  useEffect(() => setLinkChoice(linkQuery ? 0 : -1), [linkQuery]);
  const openDialog = useCallback(
    (type: "image" | "link" | "note") => {
      if (!editor) return;
      const { selection } = editor.state;
      selectionBeforeDialog.current = {
        from: selection.from,
        to: selection.to,
      };
      const formula =
        type === "note" &&
        selection instanceof NodeSelection &&
        ["mathInline", "mathBlock"].includes(selection.node.type.name)
          ? selection.node
          : null;
      const outer = formula
        ? outerLatexNote(String(formula.attrs.latex ?? ""))
        : null;
      setDialog({
        type,
        value:
          type === "link"
            ? (editor.getAttributes("link").href ?? "")
            : type === "note"
              ? formula
                ? (outer?.note ?? "")
                : (editor.getAttributes("annotation").note ?? "")
              : "",
        alt: "",
        hadNote:
          type === "note" &&
          (formula ? Boolean(outer) : editor.isActive("annotation")),
        ...(formula
          ? {
              math: {
                pos: selection.from,
                body: outer?.body ?? String(formula.attrs.latex ?? ""),
              },
            }
          : {}),
      });
      setDialogError("");
      setInsertMenu(false);
      const toolbar =
        type !== "image" ? document.getElementById(selectionMenuId) : null;
      setDialogToolbar(toolbar);
      if (!toolbar) setBubble(null);
    },
    [editor, selectionMenuId],
  );

  /** Add, change or remove the hover note of the selected text or formula. */
  function applyNote(state: DialogState, value: string) {
    if (!editor) return false;
    if (value.length > NOTE_MAX) {
      setDialogError(tn("dialog.noteTooLong", { max: NOTE_MAX }));
      return false;
    }
    if (state.math) {
      const { pos, body } = state.math;
      const node = editor.state.doc.nodeAt(pos);
      if (!node || !["mathInline", "mathBlock"].includes(node.type.name)) {
        setDialogError(tn("dialog.noteTargetMissing"));
        return false;
      }
      editor
        .chain()
        .focus()
        .command(({ tr }) => {
          tr.setNodeMarkup(pos, undefined, {
            ...node.attrs,
            latex: value ? annotateLatex(body, value) : body,
          });
          return true;
        })
        .run();
      return true;
    }
    if (selectionBeforeDialog.current)
      editor.commands.setTextSelection(selectionBeforeDialog.current);
    if (editor.state.selection.empty && !editor.isActive("annotation")) {
      setDialogError(tn("dialog.noteNeedsSelection"));
      return false;
    }
    const chain = editor.chain().focus();
    if (editor.state.selection.empty) chain.extendMarkRange("annotation");
    if (value) chain.setMark("annotation", { note: value });
    else chain.unsetMark("annotation");
    chain.run();
    return true;
  }

  async function insertImageFiles(
    files: File[],
    restoreDialogSelection = false,
  ) {
    if (!editor || !editor.isEditable) return;
    if (restoreDialogSelection && selectionBeforeDialog.current)
      editor.commands.setTextSelection(selectionBeforeDialog.current);
    let bookmark = editor.state.selection.getBookmark();
    const mapBookmark = ({
      transaction,
    }: {
      transaction: import("@tiptap/pm/state").Transaction;
    }) => {
      bookmark = bookmark.map(transaction.mapping);
    };
    editor.on("transaction", mapBookmark);
    for (const file of files) {
      if (!/^image\/(png|jpeg|gif|webp|avif)$/.test(file.type)) {
        setNotice(t("notice.imageTypes"));
        continue;
      }
      if (file.size > CAPACITY.resourceBytes) {
        setNotice(
          t("notice.imageTooLarge", {
            name: file.name,
            size: formatBytes(file.size),
            limit: formatBytes(CAPACITY.resourceBytes),
          }),
        );
        continue;
      }
      let source: string;
      try {
        source = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => reject(reader.error);
          reader.onabort = () => reject(new Error(t("notice.readCancelled")));
          reader.readAsDataURL(file);
        });
      } catch {
        setNotice(t("notice.imageUnreadable", { name: file.name }));
        continue;
      }
      if (editor.isDestroyed || !editor.isEditable) break;
      const selection = bookmark.resolve(editor.state.doc);
      editor.view.dispatch(editor.state.tr.setSelection(selection));
      editor.chain().focus().setImage({ src: source, alt: file.name }).run();
      bookmark = editor.state.selection.getBookmark();
    }
    editor.off("transaction", mapBookmark);
    setDialog(null);
  }

  const items: MenuItem[] = useMemo(
    () => [
      {
        id: "text",
        title: t("block.text"),
        keywords: `text paragraph ${t("block.textKeywords")}`,
        icon: <Type size={20} />,
        group: t("group.basic"),
        run: (e: Editor) => {
          e.chain().focus().setParagraph().run();
        },
      },
      ...([1, 2, 3, 4, 5, 6] as const).map((level) => ({
        id: `heading-${level}`,
        title: t("block.heading", { level }),
        keywords: `heading h${level} ${t("block.headingKeywords")}`,
        icon:
          level === 1 ? (
            <Heading1 size={20} />
          ) : level === 2 ? (
            <Heading2 size={20} />
          ) : (
            <Heading3 size={20} />
          ),
        group: t("group.basic"),
        run: (e: Editor) => {
          e.chain().focus().setHeading({ level }).run();
        },
      })),
      {
        id: "bullet",
        title: t("block.bullet"),
        keywords: `bullet list ${t("block.bulletKeywords")}`,
        icon: <List size={20} />,
        group: t("group.basic"),
        run: (e: Editor) => {
          e.chain().focus().toggleBulletList().run();
        },
      },
      {
        id: "ordered",
        title: t("block.ordered"),
        keywords: `ordered numbered list ${t("block.orderedKeywords")}`,
        icon: <ListOrdered size={20} />,
        group: t("group.basic"),
        run: (e: Editor) => {
          e.chain().focus().toggleOrderedList().run();
        },
      },
      {
        id: "todo",
        title: t("block.todo"),
        keywords: `todo task check ${t("block.todoKeywords")}`,
        icon: <CheckSquare size={20} />,
        group: t("group.basic"),
        run: (e: Editor) => {
          e.chain().focus().toggleTaskList().run();
        },
      },
      {
        id: "quote",
        title: t("block.quote"),
        keywords: `blockquote quote ${t("block.quoteKeywords")}`,
        icon: <Quote size={20} />,
        group: t("group.basic"),
        run: (e: Editor) => {
          e.chain().focus().toggleBlockquote().run();
        },
      },
      {
        id: "callout",
        title: t("block.callout"),
        keywords: `callout note ${t("block.calloutKeywords")}`,
        icon: <MessageSquareQuote size={20} />,
        group: t("group.basic"),
        run: (e: Editor) => {
          e.chain()
            .focus()
            .insertContent({
              type: "callout",
              attrs: { icon: "💡", tone: "sage" },
              content: [
                {
                  type: "paragraph",
                  content: [
                    // i18n-exempt: default text saved into the new callout
                    { type: "text", text: "在这里记录一个值得注意的发现。" },
                  ],
                },
              ],
            })
            .run();
        },
      },
      {
        id: "toggle",
        title: t("block.toggle"),
        keywords: `toggle details ${t("block.toggleKeywords")}`,
        icon: <ChevronRight size={20} />,
        group: t("group.basic"),
        run: (e: Editor) => {
          e.chain()
            .focus()
            .insertContent({
              type: "toggle",
              attrs: { title: "展开了解更多", open: true }, // i18n-exempt: default title saved into the new toggle
              content: [{ type: "paragraph" }],
            })
            .run();
        },
      },
      {
        id: "stepper",
        title: t("block.stepper"),
        keywords: `stepper steps ${t("block.stepperKeywords")}`,
        icon: <ArrowRight size={20} />,
        group: t("group.basic"),
        run: (e: Editor) => {
          // Untitled steps read as "Step n" in the current language.
          const step = { type: "step", content: [{ type: "paragraph" }] };
          const { from } = e.state.selection;
          e.chain()
            .focus()
            .insertContent({ type: "stepper", content: [step, step] })
            // Same transaction: continue typing in the new stepper's first step.
            .command(({ tr }) => {
              let stepper = -1;
              tr.doc.nodesBetween(
                Math.max(0, from - 1),
                tr.doc.content.size,
                (node, pos) => {
                  if (stepper < 0 && node.type.name === "stepper")
                    stepper = pos;
                  return stepper < 0;
                },
              );
              if (stepper >= 0)
                tr.setSelection(TextSelection.create(tr.doc, stepper + 3));
              return true;
            })
            .run();
        },
      },
      {
        id: "divider",
        title: t("block.divider"),
        keywords: `divider hr ${t("block.dividerKeywords")}`,
        icon: <Minus size={20} />,
        group: t("group.basic"),
        run: (e: Editor) => {
          e.chain().focus().setHorizontalRule().run();
        },
      },
      {
        id: "image",
        title: t("block.image"),
        keywords: `image photo ${t("block.imageKeywords")}`,
        icon: <ImagePlus size={20} />,
        group: t("group.rich"),
        run: () => openDialog("image"),
      },
      {
        id: "code",
        title: t("block.code"),
        keywords: `code snippet ${t("block.codeKeywords")}`,
        icon: <CodeXml size={20} />,
        group: t("group.rich"),
        run: (e: Editor) => {
          e.chain().focus().toggleCodeBlock().run();
        },
      },
      {
        id: "table",
        title: t("block.table"),
        keywords: `table ${t("block.tableKeywords")}`,
        icon: <Table2 size={20} />,
        group: t("group.rich"),
        run: (e: Editor) => {
          e.chain()
            .focus()
            .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
            .run();
        },
      },
      ...catalog.items
        .filter(
          (item) =>
            ("kind" in item || item.role !== "page-outline") &&
            !("kind" in item && primitiveNodeTypes[item.kind]) &&
            (!("kind" in item && item.insertion) || !!onInsertNative),
        )
        .map((item) => ({
          id:
            "catalog:" +
            ("kind" in item
              ? item.kind
              : `${item.id}@${item.version}#${item.integrity}`),
          title: catalog.displayName(item),
          keywords: `${"kind" in item ? item.kind : item.id} ${item.name} ${item.description} ${catalog.displayDescription(item)}`,
          icon: <PanelTop size={20} />,
          group: t("group.components"),
          component: item,
          run: () => {},
        })),
    ],
    [
      openDialog,
      onInsertNative,
      catalog.items,
      catalog.displayName,
      catalog.displayDescription,
      t,
    ],
  );
  const filteredItems = items.filter((item) =>
    `${item.title} ${item.keywords}`
      .toLowerCase()
      .includes(slash?.query.toLowerCase() ?? ""),
  );
  itemsRef.current = filteredItems;

  const runItem = async (index: number) => {
    const state = menuRef.current;
    const item = itemsRef.current[index];
    if (!editor || !state || !item || inserting) return;
    if (item.component) {
      const before = editor.state.doc;
      const ticket = ++insertionTicket.current;
      setInserting(true);
      try {
        const value = await catalog.resolve(item.component);
        if (ticket !== insertionTicket.current || editor.isDestroyed) return;
        if (menuRef.current !== state || !editor.state.doc.eq(before)) return;
        setSlash(null);
        menuRef.current = null;
        if (value.component) registerComponent(value.component);
        if (value.native && onInsertNative) {
          const transaction = editor.state.tr.delete(state.from, state.to);
          onInsertNative(
            value.kind,
            value.data,
            splitForComponent(transaction.doc, state.from),
          );
        } else {
          editor
            .chain()
            .focus()
            .deleteRange({ from: state.from, to: state.to })
            .insertContent({
              ...(primitiveNodeTypes[value.kind]
                ? primitiveContentNode(value.kind, value.data)
                : {
                    type: "widget",
                    attrs: { kind: value.kind, data: value.data },
                  }),
            })
            .run();
        }
      } catch (reason) {
        setNotice((reason as Error).message);
      } finally {
        if (ticket === insertionTicket.current) setInserting(false);
      }
      return;
    }
    setSlash(null);
    menuRef.current = null;
    if (state.from !== state.to)
      editor
        .chain()
        .focus()
        .deleteRange({ from: state.from, to: state.to })
        .run();
    else editor.commands.focus();
    item.run(editor);
  };
  runItemRef.current = runItem;

  const openSlash = () => {
    if (!editor) return;
    dismissedSlash.current = null;
    const { from, to } = editor.state.selection;
    setSlash({
      from,
      to,
      query: "",
      manual: true,
      ...menuPosition(editor, from),
    });
    setSelectedIndex(0);
    setInsertMenu(false);
  };

  const blockAdd = () => {
    if (!editor || !hover) return;
    const position = hover.pos + hover.size;
    editor
      .chain()
      .focus()
      .insertContentAt(position, { type: "paragraph" })
      .setTextSelection(position + 1)
      .run();
    setSlash({
      from: position + 1,
      to: position + 1,
      query: "",
      manual: true,
      ...menuPosition(editor, position + 1),
    });
    setBlockMenu(false);
  };

  function moveBlock(position: number, direction: -1 | 1) {
    if (!editor) return;
    const nodes: { pos: number; size: number }[] = [];
    editor.state.doc.forEach((node, pos) =>
      nodes.push({ pos, size: node.nodeSize }),
    );
    const index = nodes.findIndex((node) => node.pos === position);
    const other = nodes[index + direction];
    const source = editor.state.doc.nodeAt(position);
    if (!other || !source) return;
    const target =
      direction === -1 ? other.pos : other.pos + other.size - source.nodeSize;
    const transaction = editor.state.tr
      .delete(position, position + source.nodeSize)
      .insert(target, source);
    transaction.setSelection(
      Selection.near(transaction.doc.resolve(target + 1)),
    );
    editor.view.dispatch(transaction);
    editor.view.focus();
    setBlockMenu(false);
    setHover(null);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    if (!editor || !editor.isEditable) return;
    const sourcePosition = dragPosition.current;
    if (sourcePosition !== null) {
      event.preventDefault();
      event.stopPropagation();
      dragPosition.current = null;
      setHover(null);
      const node = editor.state.doc.nodeAt(sourcePosition);
      if (!node) return;
      let destination = editor.state.doc.content.size;
      let found = false;
      editor.state.doc.forEach((_node, position) => {
        const dom = editor.view.nodeDOM(position);
        if (!(dom instanceof HTMLElement) || found) return;
        const rect = dom.getBoundingClientRect();
        if (event.clientY < rect.top + rect.height / 2) {
          destination = position;
          found = true;
        }
      });
      if (
        destination !== sourcePosition &&
        destination !== sourcePosition + node.nodeSize
      ) {
        const adjusted =
          destination > sourcePosition
            ? destination - node.nodeSize
            : destination;
        const transaction = editor.state.tr
          .delete(sourcePosition, sourcePosition + node.nodeSize)
          .insert(adjusted, node);
        transaction.setSelection(
          Selection.near(transaction.doc.resolve(adjusted + 1)),
        );
        editor.view.dispatch(transaction);
      }
      return;
    }
    const images = [...event.dataTransfer.files].filter((file) =>
      file.type.startsWith("image/"),
    );
    if (images.length) {
      event.preventDefault();
      event.stopPropagation();
      const position = editor.view.posAtCoords({
        left: event.clientX,
        top: event.clientY,
      });
      if (position) editor.commands.setTextSelection(position.pos);
      void insertImageFiles(images);
    }
  }

  if (!editor)
    return <div className="editor-loading" aria-label={t("openingDocument")} />;

  // Components without a settings form or in-place editing are changed by an agent.
  const hoverNode = hover && blockMenu ? editor.state.doc.nodeAt(hover.pos) : null;
  const hoverNeedsAgent =
    hoverNode?.type.name === "widget" &&
    !supportsManualEditing(String(hoverNode.attrs.kind ?? ""));
  const textStyle = editor.isActive("heading")
    ? t("block.heading", { level: editor.getAttributes("heading").level })
    : t("block.text");
  // The reference action names how many blocks the selection touches.
  const bubbleBlockCount =
    bubble && assistant
      ? selectionBlockIds(
          editor.state.doc,
          editor.state.selection.from,
          editor.state.selection.to,
        ).length
      : 0;
  const DialogContainer = dialogToolbar ? ToolbarPanel : DialogBackdrop;
  const formatButtons = (!minimal || bubble) && (
    <FormatControls
      editor={editor}
      onLink={() => openDialog("link")}
      onNote={() => openDialog("note")}
    />
  );

  return (
    <div
      className={`document-editor${readOnly ? " is-readonly" : ""}${minimal ? " is-minimal" : ""}`}
    >
      {!readOnly && !minimal && (
        <div
          className="editor-toolbar"
          role="toolbar"
          aria-label={t("format.toolbar")}
        >
          <div className="toolbar-style">
            <button
              className="text-style-button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                setStyleMenu(!styleMenu);
                setInsertMenu(false);
              }}
              aria-expanded={styleMenu}
            >
              {textStyle}
              <ChevronDown size={13} />
            </button>
            {styleMenu && (
              <>
                <div
                  className="editor-menu-dismiss"
                  onClick={() => setStyleMenu(false)}
                />
                <div className="editor-small-menu style-menu">
                  {items.slice(0, 7).map((item) => (
                    <button
                      key={item.id}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => {
                        item.run(editor);
                        setStyleMenu(false);
                      }}
                    >
                      {item.icon}
                      <span>{item.title}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
          <span className="toolbar-divider" />
          {formatButtons}
          <span className="toolbar-divider" />
          <ToolButton
            label={t("block.bullet")}
            active={editor.isActive("bulletList")}
            onClick={() => editor.chain().focus().toggleBulletList().run()}
          >
            <List size={17} />
          </ToolButton>
          <ToolButton
            label={t("block.todo")}
            active={editor.isActive("taskList")}
            onClick={() => editor.chain().focus().toggleTaskList().run()}
          >
            <CheckSquare size={16} />
          </ToolButton>
          <div className="toolbar-insert">
            <ToolButton
              label={t("format.more")}
              active={insertMenu}
              onClick={() => {
                setInsertMenu(!insertMenu);
                setStyleMenu(false);
              }}
            >
              <Plus size={17} />
            </ToolButton>
            {insertMenu && (
              <>
                <div
                  className="editor-menu-dismiss"
                  onClick={() => setInsertMenu(false)}
                />
                <div className="editor-small-menu insert-menu">
                  <button onClick={openSlash}>
                    <Plus size={16} />
                    {t("insert.content")}
                    <span className="menu-key">/</span>
                  </button>
                  <button
                    onClick={() => {
                      editor.chain().focus().toggleOrderedList().run();
                      setInsertMenu(false);
                    }}
                  >
                    <ListOrdered size={16} />
                    {t("block.ordered")}
                  </button>
                  <button
                    onClick={() => {
                      editor.chain().focus().toggleBlockquote().run();
                      setInsertMenu(false);
                    }}
                  >
                    <Quote size={16} />
                    {t("block.quote")}
                  </button>
                  <button onClick={() => openDialog("image")}>
                    <ImagePlus size={16} />
                    {t("insert.image")}
                  </button>
                  <button
                    onClick={() => {
                      editor
                        .chain()
                        .focus()
                        .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
                        .run();
                      setInsertMenu(false);
                    }}
                  >
                    <Table2 size={16} />
                    {t("insert.table")}
                  </button>
                  <div className="menu-rule" />
                  <div className="align-tools">
                    <ToolButton
                      label={t("format.alignLeft")}
                      active={editor.isActive({ textAlign: "left" })}
                      onClick={() =>
                        editor.chain().focus().setTextAlign("left").run()
                      }
                    >
                      <AlignLeft size={17} />
                    </ToolButton>
                    <ToolButton
                      label={t("format.alignCenter")}
                      active={editor.isActive({ textAlign: "center" })}
                      onClick={() =>
                        editor.chain().focus().setTextAlign("center").run()
                      }
                    >
                      <AlignCenter size={17} />
                    </ToolButton>
                    <ToolButton
                      label={t("format.alignRight")}
                      active={editor.isActive({ textAlign: "right" })}
                      onClick={() =>
                        editor.chain().focus().setTextAlign("right").run()
                      }
                    >
                      <AlignRight size={17} />
                    </ToolButton>
                  </div>
                </div>
              </>
            )}
          </div>
          <div className="toolbar-spacer" />
          <ToolButton
            label={t("format.undo")}
            disabled={!editor.can().undo()}
            onClick={() => editor.chain().focus().undo().run()}
          >
            <Undo2 size={16} />
          </ToolButton>
          <ToolButton
            label={t("format.redo")}
            disabled={!editor.can().redo()}
            onClick={() => editor.chain().focus().redo().run()}
          >
            <Redo2 size={16} />
          </ToolButton>
        </div>
      )}

      <div
        className="editor-canvas"
        ref={wrapperRef}
        onKeyDown={(event) => {
          if (
            (event.metaKey || event.ctrlKey) &&
            event.shiftKey &&
            event.key.toLowerCase() === "k" &&
            !readOnly
          ) {
            event.preventDefault();
            event.stopPropagation();
            openDialog("link");
          }
        }}
        onMouseEnter={keepBlockHandle}
        onMouseMove={(event) => {
          if (readOnly || blockMenu || dragPosition.current !== null) return;
          if ((event.target as Element).closest(".block-handle")) {
            keepBlockHandle();
            return;
          }
          const wrapper = wrapperRef.current;
          if (!wrapper) return;
          if (
            (event.target as Element).closest(".document-editor") !==
            wrapper.closest(".document-editor")
          )
            return;
          hoverPointer.current = event.clientY;
          if (hoverFrame.current) return;
          hoverFrame.current = requestAnimationFrame(() => {
            hoverFrame.current = 0;
            const wrapper = wrapperRef.current;
            if (!wrapper || dragPosition.current !== null || editor.isDestroyed)
              return;
            const y = hoverPointer.current;
            const frame = wrapper.getBoundingClientRect();
            const scale = frame.width / wrapper.offsetWidth || 1;
            let next: HoverBlock | null = null;
            editor.state.doc.forEach((node, pos, index) => {
              const dom = editor.view.nodeDOM(pos);
              if (!(dom instanceof HTMLElement)) return;
              const rect = dom.getBoundingClientRect();
              if (y >= rect.top - 3 && y <= rect.bottom + 3)
                next = {
                  pos,
                  size: node.nodeSize,
                  index,
                  top: (rect.top - frame.top) / scale,
                };
            });
            const found = next as HoverBlock | null;
            if (found) {
              keepBlockHandle();
              setHover((current) =>
                current &&
                current.pos === found.pos &&
                current.size === found.size &&
                current.index === found.index &&
                Math.abs(current.top - found.top) < 0.5
                  ? current
                  : found,
              );
            } else hideBlockHandleLater();
          });
        }}
        onMouseLeave={hideBlockHandleLater}
        onDragOver={(event) => {
          if (
            dragPosition.current !== null ||
            [...event.dataTransfer.types].includes("Files")
          )
            event.preventDefault();
        }}
        onDropCapture={handleDrop}
      >
        <EditorContent editor={editor} />
        {!readOnly && <TableControls editor={editor} />}
        {!readOnly && hover && (
          <div
            className="block-handle"
            style={{ top: hover.top }}
            onMouseEnter={keepBlockHandle}
            onFocus={keepBlockHandle}
          >
            <button
              aria-label={t("insert.addBelow")}
              title={t("insert.addContent")}
              onMouseDown={(event) => event.preventDefault()}
              onClick={blockAdd}
            >
              <Plus size={15} />
            </button>
            <button
              aria-label={t("block.handle")}
              title={t("block.handleTitle")}
              draggable
              onDragStart={(event) => {
                keepBlockHandle();
                dragPosition.current = hover.pos;
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData(
                  "application/x-showai-block",
                  String(hover.pos),
                );
                const dom = editor.view.nodeDOM(hover.pos);
                if (dom instanceof HTMLElement)
                  event.dataTransfer.setDragImage(dom, 0, 0);
                setBlockMenu(false);
              }}
              onDragEnd={() => {
                dragPosition.current = null;
              }}
              onClick={() => setBlockMenu(!blockMenu)}
            >
              <GripVertical size={15} />
            </button>
            {blockMenu && (
              <>
                <div
                  className="editor-menu-dismiss"
                  onClick={() => setBlockMenu(false)}
                />
                <div className="editor-small-menu block-menu">
                  {minimal &&
                    ["paragraph", "heading"].includes(
                      editor.state.doc.nodeAt(hover.pos)?.type.name ?? "",
                    ) && (
                      <>
                        <div
                          className="align-tools"
                          role="group"
                          aria-label={t("block.style")}
                        >
                          {items.slice(0, 7).map((item, index) => (
                            <ToolButton
                              key={item.id}
                              label={item.title}
                              active={
                                index === 0
                                  ? editor.state.doc.nodeAt(hover.pos)?.type
                                      .name === "paragraph"
                                  : editor.state.doc.nodeAt(hover.pos)?.attrs
                                      .level === index
                              }
                              onClick={() => {
                                editor
                                  .chain()
                                  .focus()
                                  .setTextSelection(hover.pos + 1)
                                  .run();
                                item.run(editor);
                                setBlockMenu(false);
                              }}
                            >
                              {item.icon}
                            </ToolButton>
                          ))}
                        </div>
                        <div className="align-tools">
                          {(
                            [
                              [
                                "left",
                                t("format.alignLeft"),
                                <AlignLeft key="left" size={16} />,
                              ],
                              [
                                "center",
                                t("format.alignCenter"),
                                <AlignCenter key="center" size={16} />,
                              ],
                              [
                                "right",
                                t("format.alignRight"),
                                <AlignRight key="right" size={16} />,
                              ],
                            ] as const
                          ).map(([align, label, icon]) => (
                            <ToolButton
                              key={align}
                              label={label}
                              active={
                                editor.state.doc.nodeAt(hover.pos)?.attrs
                                  .textAlign === align
                              }
                              onClick={() => {
                                editor
                                  .chain()
                                  .focus()
                                  .setTextSelection(hover.pos + 1)
                                  .setTextAlign(align)
                                  .run();
                                setBlockMenu(false);
                              }}
                            >
                              {icon}
                            </ToolButton>
                          ))}
                        </div>
                        <div className="menu-rule" />
                      </>
                    )}
                  <ContentNodeActions
                    editor={editor}
                    position={hover.pos}
                    onDone={() => setBlockMenu(false)}
                  />
                  {onDetachBlock && (
                    <button
                      onClick={() => {
                        const node = editor.state.doc.nodeAt(hover.pos);
                        if (node) onDetachBlock(node.toJSON());
                        setBlockMenu(false);
                        setHover(null);
                      }}
                    >
                      <Expand size={15} />
                      {t("block.detach")}
                    </button>
                  )}
                  <button
                    disabled={hover.index === 0}
                    onClick={() => moveBlock(hover.pos, -1)}
                  >
                    <ArrowUp size={15} />
                    {t("block.moveUp")}
                  </button>
                  <button
                    disabled={hover.index === editor.state.doc.childCount - 1}
                    onClick={() => moveBlock(hover.pos, 1)}
                  >
                    <ArrowDown size={15} />
                    {t("block.moveDown")}
                  </button>
                  <button
                    onClick={() => {
                      const node = editor.state.doc.nodeAt(hover.pos);
                      if (node)
                        editor
                          .chain()
                          .focus()
                          .insertContentAt(
                            hover.pos + node.nodeSize,
                            node.toJSON(),
                          )
                          .run();
                      setBlockMenu(false);
                    }}
                  >
                    <Copy size={15} />
                    {t("block.duplicate")}
                  </button>
                  {hoverNeedsAgent && (
                    <p className="block-menu-note">
                      {t("block.noManualEditing")}
                    </p>
                  )}
                  {assistant && (
                    <button
                      onClick={(event) => {
                        const id = editor.state.doc.nodeAt(hover.pos)?.attrs.id;
                        const rect = event.currentTarget
                          .closest(".block-handle")!
                          .getBoundingClientRect();
                        setBlockMenu(false);
                        if (typeof id === "string" && !isSyntheticId(id))
                          assistant.open({
                            kind: "blocks",
                            blockIds: [id],
                            anchor: {
                              left: rect.right + 160,
                              top: rect.top,
                              bottom: rect.bottom,
                            },
                          });
                      }}
                    >
                      <Sparkles size={15} />
                      {hoverNeedsAgent
                        ? t("assistant.editComponent")
                        : tc("askAgent")}
                    </button>
                  )}
                  {assistant && (
                    <button
                      onClick={(event) => {
                        const id = editor.state.doc.nodeAt(hover.pos)?.attrs.id;
                        const rect = event.currentTarget
                          .closest(".block-handle")!
                          .getBoundingClientRect();
                        setBlockMenu(false);
                        if (typeof id === "string" && !isSyntheticId(id))
                          assistant.reference({
                            kind: "blocks",
                            blockIds: [id],
                            anchor: {
                              left: rect.right,
                              top: rect.top,
                              bottom: rect.bottom,
                            },
                          });
                      }}
                    >
                      <AtSign size={15} />
                      {tc("copyReference")}
                    </button>
                  )}
                  {pageLinks && (
                    <button
                      onClick={() => {
                        const id = editor.state.doc.nodeAt(hover.pos)?.attrs.id;
                        setBlockMenu(false);
                        if (typeof id === "string" && !isSyntheticId(id))
                          pageLinks.copyLink([id]);
                      }}
                    >
                      <Link2 size={15} />
                      {tc("copyLink")}
                    </button>
                  )}
                  <div className="menu-rule" />
                  <button
                    className="danger"
                    onClick={() => {
                      editor
                        .chain()
                        .focus()
                        .deleteRange({
                          from: hover.pos,
                          to: hover.pos + hover.size,
                        })
                        .run();
                      setBlockMenu(false);
                      setHover(null);
                    }}
                  >
                    <Trash2 size={15} />
                    {tc("delete")}
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
      {!readOnly && !minimal && (
        <button
          className="document-add-block"
          onClick={() => {
            editor.chain().focus("end").run();
            if (
              editor.state.selection.$from.parent.type.name !== "paragraph" ||
              editor.state.selection.$from.parent.content.size
            ) {
              editor
                .chain()
                .insertContentAt(editor.state.doc.content.size, {
                  type: "paragraph",
                })
                .focus("end")
                .run();
            }
            openSlash();
          }}
        >
          <Plus size={15} />
          <span>{t("insert.addContent")}</span>
          <kbd>/</kbd>
        </button>
      )}

      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp,image/avif"
        className="editor-hidden-input"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void insertImageFiles([file], true);
          event.target.value = "";
        }}
      />
      {notice && (
        <div className="editor-notice" role="status">
          {notice}
          <button aria-label={t("dismissNotice")} onClick={() => setNotice("")}>
            <X size={14} />
          </button>
        </div>
      )}
      {bubble && !readOnly && (
        <SelectionToolbar
          id={selectionMenuId}
          className="rich-text-selection-toolbar"
          anchor={bubble}
          viewportTop={
            Math.max(
              0,
              ...Array.from(
                wrapperRef.current
                  ?.closest(".studio")
                  ?.querySelectorAll(".studio-window-topbar, .studio-topbar") ??
                  [],
                (element) => element.getBoundingClientRect().bottom,
              ),
            ) + 8
          }
          onEscape={() => {
            selectionMenuInteracting.current = false;
            dismissedSelection.current = `${editor.state.selection.from}:${editor.state.selection.to}`;
            if (editor.state.selection instanceof CellSelection)
              editor.view.dispatch(
                editor.state.tr.setSelection(
                  TextSelection.near(editor.state.selection.$from),
                ),
              );
            setBubble(null);
            editor.view.focus();
          }}
        >
          {formatButtons}
          <TableSelectionActions editor={editor} />
          {assistant && (
            <>
              <span className="toolbar-divider" aria-hidden="true" />
              <button
                type="button"
                className="editor-bubble-assistant"
                aria-label={tc("askAgent")}
                title={tc("askAgent")}
                onClick={() => {
                  const { from, to } = editor.state.selection;
                  const anchor = bubble;
                  selectionMenuInteracting.current = false;
                  setBubble(null);
                  assistant.open({
                    kind: "text",
                    blockIds: selectionBlockIds(editor.state.doc, from, to),
                    text: editor.state.doc.textBetween(from, to, "\n"),
                    anchor,
                  });
                }}
              >
                <Sparkles size={15} />
                <span>{tc("askAgent")}</span>
              </button>
              <button
                type="button"
                className="editor-tool editor-bubble-reference"
                aria-label={tc("copyReference")}
                title={t("assistant.referenceSelection", {
                  count: bubbleBlockCount,
                })}
                onClick={() => {
                  const { from, to } = editor.state.selection;
                  const anchor = bubble;
                  selectionMenuInteracting.current = false;
                  setBubble(null);
                  assistant.reference({
                    kind: "text",
                    blockIds: selectionBlockIds(editor.state.doc, from, to),
                    text: editor.state.doc.textBetween(from, to, "\n"),
                    anchor,
                  });
                }}
              >
                <AtSign size={16} />
              </button>
            </>
          )}
          {
            <>
              <span className="toolbar-divider" aria-hidden="true" />
              <button
                type="button"
                className="editor-bubble-insert"
                aria-label={t("insert.fromSelection")}
                title={t("insert.fromSelectionTitle")}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  // Same entry as «/», opened at the end of the selected block so
                  // the insertion neither replaces nor splits the selected text.
                  const end = editor.state.selection.$to.end();
                  selectionMenuInteracting.current = false;
                  setBubble(null);
                  editor.commands.setTextSelection(end);
                  openSlash();
                  // The toolbar closes after this click; keep typing in the search field.
                  setTimeout(() => slashInputRef.current?.focus(), 0);
                }}
              >
                <Plus size={15} />
                <span>{t("insert.fromSelection")}</span>
              </button>
            </>
          }
        </SelectionToolbar>
      )}
      {slash &&
        !readOnly &&
        createPortal(
          <>
            <div
              className="slash-dismiss"
              onClick={() => {
                dismissSlash();
                editor.commands.focus();
              }}
            />
            <div
              className={`slash-menu${minimal ? " is-minimal" : ""}`}
              role="dialog"
              aria-label={t("insert.content")}
              style={{ left: slash.left, top: slash.top }}
            >
              <div className="slash-search">
                {slash.manual ? (
                  <ExpandableSearch
                    label={t("insert.search")}
                    placeholder={t("insert.searchPlaceholder")}
                    defaultExpanded
                    inputRef={slashInputRef}
                    value={slash.query}
                    onChange={(value) => setSlash({ ...slash, query: value })}
                    onKeyDown={(event) => {
                      if (event.key === "Escape") {
                        dismissSlash();
                        editor.commands.focus();
                      }
                      if (event.key === "Enter") {
                        event.preventDefault();
                        runItem(selectedIndex);
                      }
                      if (
                        event.key === "ArrowDown" ||
                        event.key === "ArrowUp"
                      ) {
                        event.preventDefault();
                        setSelectedIndex((index) =>
                          filteredItems.length
                            ? (index +
                                (event.key === "ArrowDown" ? 1 : -1) +
                                filteredItems.length) %
                              filteredItems.length
                            : 0,
                        );
                      }
                    }}
                  />
                ) : (
                  <span>{slash.query || t("insert.addToDocument")}</span>
                )}
                <kbd>esc</kbd>
              </div>
              <div
                className="slash-items"
                role="listbox"
                aria-label={t("insert.blockTypes")}
                aria-busy={inserting || catalog.loading}
              >
                {catalog.error && (
                  <p role="alert" className="slash-empty">
                    {catalog.error}
                  </p>
                )}
                {filteredItems.length === 0 && (
                  <div className="slash-empty">{t("insert.noResults")}</div>
                )}
                {filteredItems.map((item, index) => (
                  <div key={item.id}>
                    {(index === 0 ||
                      filteredItems[index - 1].group !== item.group) && (
                      <div className="slash-group">{item.group}</div>
                    )}
                    <button
                      role="option"
                      disabled={inserting}
                      aria-selected={index === selectedIndex}
                      className={`slash-item${index === selectedIndex ? " is-selected" : ""}`}
                      onMouseEnter={() => setSelectedIndex(index)}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => runItem(index)}
                    >
                      <span className="slash-item-icon">{item.icon}</span>
                      <span>
                        <strong>{item.title}</strong>
                      </span>
                      {index === selectedIndex && (
                        <span className="slash-enter">↵</span>
                      )}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </>,
          document.body,
        )}
      {dialog &&
        createPortal(
          <DialogContainer
            className={
              dialogToolbar ? "editor-format-panel" : "editor-modal-backdrop"
            }
            onDismiss={() => {
              setDialog(null);
              editor.commands.focus();
            }}
          >
            <form
              className="editor-modal"
              role="dialog"
              aria-modal={dialogToolbar ? undefined : true}
              aria-labelledby="editor-dialog-title"
              onKeyDown={(event) => {
                if (event.key === "Escape") setDialog(null);
              }}
              onSubmit={(event) => {
                event.preventDefault();
                const value = dialog.value.trim();
                if (dialog.type === "image" && !safeImageUrl(value)) {
                  setDialogError(t("dialog.invalidImageUrl"));
                  return;
                }
                const link =
                  dialog.type === "link"
                    ? (linkSuggestions[linkChoice]?.href ?? value)
                    : value;
                if (dialog.type === "link" && link && !safeLinkUrl(link)) {
                  setDialogError(t("dialog.invalidLinkUrl"));
                  return;
                }
                if (dialog.type === "note") {
                  if (!applyNote(dialog, value)) return;
                  setDialog(null);
                  return;
                }
                if (dialog.type === "link") {
                  applyLink(link);
                  return;
                }
                if (selectionBeforeDialog.current)
                  editor.commands.setTextSelection(
                    selectionBeforeDialog.current,
                  );
                editor
                  .chain()
                  .focus()
                  .setImage({ src: value, alt: dialog.alt })
                  .run();
                setDialog(null);
              }}
            >
              <div className="editor-modal-heading">
                <div className="editor-modal-symbol">
                  {dialog.type === "image" ? (
                    <ImagePlus size={21} />
                  ) : dialog.type === "note" ? (
                    <MessageSquareText size={21} />
                  ) : (
                    <Link2 size={21} />
                  )}
                </div>
                <h3 id="editor-dialog-title">
                  {dialog.type === "image"
                    ? t("insert.image")
                    : dialog.type === "note"
                      ? tn(
                          dialog.hadNote ? "dialog.editNote" : "dialog.addNote",
                        )
                      : t("dialog.addLink")}
                </h3>
                <button
                  type="button"
                  aria-label={t("dialog.close")}
                  data-no-tooltip
                  onClick={() => setDialog(null)}
                >
                  <X size={18} />
                </button>
              </div>
              {dialog.type === "image" && (
                <button
                  className="image-upload-area"
                  type="button"
                  onClick={() => fileRef.current?.click()}
                >
                  <Upload size={23} />
                  <strong>{t("dialog.chooseImage")}</strong>
                  <span>{t("dialog.imageFormats")}</span>
                </button>
              )}
              {dialog.type === "note" && (
                <label className="editor-field">
                  <span>
                    {dialog.math
                      ? tn("dialog.noteFormula")
                      : tn("dialog.noteText")}
                  </span>
                  <textarea
                    autoFocus
                    rows={4}
                    maxLength={NOTE_MAX}
                    placeholder={tn("dialog.notePlaceholder")}
                    value={dialog.value}
                    onChange={(event) => {
                      setDialog({ ...dialog, value: event.target.value });
                      setDialogError("");
                    }}
                    onKeyDown={(event) => {
                      if (
                        event.key === "Enter" &&
                        (event.metaKey || event.ctrlKey)
                      ) {
                        event.preventDefault();
                        event.currentTarget.form?.requestSubmit();
                      }
                    }}
                  />
                  <small>{tn("dialog.noteHint")}</small>
                </label>
              )}
              {dialog.type !== "note" && (
                <label className="editor-field">
                  <span>
                    {dialog.type === "image"
                      ? t("dialog.imageUrl")
                      : t("dialog.linkUrl")}
                  </span>
                  <input
                    autoFocus
                    type="text"
                    placeholder={
                      dialog.type === "link" && pageLinks
                        ? t("dialog.linkOrPage")
                        : "https://"
                    }
                    value={dialog.value}
                    role={linkSuggestions.length ? "combobox" : undefined}
                    aria-expanded={
                      linkSuggestions.length ? true : undefined
                    }
                    aria-controls={
                      linkSuggestions.length ? "editor-link-pages" : undefined
                    }
                    aria-activedescendant={
                      linkSuggestions[linkChoice]
                        ? `editor-link-page-${linkChoice}`
                        : undefined
                    }
                    onChange={(event) => {
                      setDialog({ ...dialog, value: event.target.value });
                      setDialogError("");
                    }}
                    onKeyDown={(event) => {
                      if (
                        !linkSuggestions.length ||
                        !["ArrowDown", "ArrowUp"].includes(event.key)
                      )
                        return;
                      event.preventDefault();
                      const step = event.key === "ArrowDown" ? 1 : -1;
                      setLinkChoice(
                        (current) =>
                          (current + step + linkSuggestions.length) %
                          linkSuggestions.length,
                      );
                    }}
                  />
                </label>
              )}
              {linkSuggestions.length > 0 && (
                <ul
                  className="editor-link-pages"
                  id="editor-link-pages"
                  role="listbox"
                  aria-label={t("dialog.linkPages")}
                >
                  {linkSuggestions.map((page, index) => (
                    <li
                      key={page.id}
                      id={`editor-link-page-${index}`}
                      role="option"
                      aria-selected={index === linkChoice}
                      onMouseEnter={() => setLinkChoice(index)}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => applyLink(page.href)}
                    >
                      <FileText size={14} />
                      <span>{page.title || t("dialog.untitledPage")}</span>
                    </li>
                  ))}
                </ul>
              )}
              {dialog.type === "image" && (
                <label className="editor-field">
                  <span>
                    {t("dialog.imageAlt")} <small>{t("dialog.optional")}</small>
                  </span>
                  <input
                    placeholder={t("dialog.imageAltPlaceholder")}
                    value={dialog.alt}
                    onChange={(event) =>
                      setDialog({ ...dialog, alt: event.target.value })
                    }
                  />
                </label>
              )}
              {dialogError && (
                <p className="editor-field-error" role="alert">
                  {dialogError}
                </p>
              )}
              <div className="editor-modal-actions">
                {dialog.type === "link" && editor.isActive("link") && (
                  <button
                    type="button"
                    className="editor-text-action"
                    onClick={() => {
                      editor
                        .chain()
                        .focus()
                        .extendMarkRange("link")
                        .unsetLink()
                        .run();
                      setDialog(null);
                    }}
                  >
                    {t("dialog.removeLink")}
                  </button>
                )}
                {dialog.type === "note" && dialog.hadNote && (
                  <button
                    type="button"
                    className="editor-text-action"
                    onClick={() => {
                      if (applyNote(dialog, "")) setDialog(null);
                    }}
                  >
                    {tn("dialog.removeNote")}
                  </button>
                )}
                <button
                  type="button"
                  className="editor-secondary"
                  onClick={() => setDialog(null)}
                >
                  {t("dialog.cancel")}
                </button>
                <button
                  type="submit"
                  className="editor-primary"
                  disabled={
                    (dialog.type === "image" || dialog.type === "note") &&
                    !dialog.value.trim()
                  }
                >
                  <Check size={15} />
                  {dialog.type === "image"
                    ? t("insert.image")
                    : t("dialog.confirm")}
                </button>
              </div>
            </form>
          </DialogContainer>,
          dialogToolbar ?? document.body,
        )}
      {readOnly && (
        <span className="editor-readonly-note">
          <ExternalLink size={12} />
          {t("readOnlyNote")}
        </span>
      )}
    </div>
  );
}
