import { useEffect, useRef, useState, type RefObject } from "react";
import { AtSign, X } from "../ui/icons";
import type { ShowDocument } from "../types";
import type { AgentTarget } from "../agent-host/types";
import {
  addressableIds,
  formatReference,
  pageReference,
  referenceVersion,
  type PageReference,
} from "../core/page-reference";
import { paintedTextSelection } from "../surface/text-selection";
import { findSurfaceNode } from "../surface/document.mjs";
import { useTranslator } from "../i18n/react";
import messages from "../i18n/messages/reader";

/** The saved page a conversation reader shows; written by the MCP Apps reader
 * only when its host accepts model context. */
export interface ConversationPage {
  projectId: string;
  pageId: string;
  title: string;
  hash: string;
  revision?: string;
}
/** The conversation reader listens for this; detail.result settles delivery. */
export const conversationReferenceEvent = "showai:conversation-reference";

export function conversationPage(
  options: string | null | undefined,
): ConversationPage | null {
  const value = options ? JSON.parse(options).conversation : null;
  return value &&
    typeof value.projectId === "string" &&
    typeof value.pageId === "string" &&
    typeof value.hash === "string"
    ? {
        projectId: value.projectId,
        pageId: value.pageId,
        title: typeof value.title === "string" ? value.title : "",
        hash: value.hash,
        ...(typeof value.revision === "string"
          ? { revision: value.revision }
          : {}),
      }
    : null;
}

const idOf = (element: HTMLElement) =>
  element.dataset.blockId ?? element.dataset.surfaceId!;

/** Blocks or Board objects the text selection under the pointer covers,
 * innermost first, with its text. A click elsewhere is about that place. */
function selectionAt(root: HTMLElement, event: MouseEvent) {
  const { clientX: x, clientY: y } = event;
  // Readers paint their own text selection; the DOM selection is the fallback.
  const painted =
    event.target instanceof Element ? paintedTextSelection(event.target) : null;
  const selection = window.getSelection();
  const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
  const ranges = painted?.ranges ?? (range && !range.collapsed ? [range] : []);
  const under = ranges.some((item) =>
    [...item.getClientRects()].some(
      (rect) =>
        x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom,
    ),
  );
  if (!under) return null;
  const covered = [
    ...root.querySelectorAll<HTMLElement>("[data-block-id],[data-surface-id]"),
  ].filter((element) =>
    ranges.some((item) => {
      if (!item.intersectsNode(element)) return false;
      const inner = document.createRange();
      inner.selectNodeContents(element);
      // Components render in shadow roots: count them when wholly selected.
      if (
        item.compareBoundaryPoints(Range.START_TO_START, inner) <= 0 &&
        item.compareBoundaryPoints(Range.END_TO_END, inner) >= 0
      )
        return true;
      if (item.compareBoundaryPoints(Range.START_TO_START, inner) > 0)
        inner.setStart(item.startContainer, item.startOffset);
      if (item.compareBoundaryPoints(Range.END_TO_END, inner) < 0)
        inner.setEnd(item.endContainer, item.endOffset);
      return inner.toString().trim() !== "";
    }),
  );
  return {
    elements: covered.filter(
      (element) =>
        !covered.some((other) => other !== element && element.contains(other)),
    ),
    text: painted?.text ?? selection?.toString() ?? "",
  };
}

interface MenuState {
  x: number;
  y: number;
  selection: HTMLElement[];
  text: string;
  block: HTMLElement | null;
}

/** "Reference … in the conversation" for a page shown inside an MCP Apps
 * host. The host shows the reference in its input; nothing is sent or saved. */
export function useConversationReference(
  root: RefObject<HTMLElement | null>,
  document: ShowDocument,
  page: ConversationPage | null,
) {
  const t = useTranslator(messages);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [active, setActive] = useState(false);
  const [status, setStatus] = useState("");
  const menuRef = useRef<HTMLDivElement>(null);
  const deliver = async (reference: PageReference | null, text = "") => {
    const detail: {
      reference: PageReference | null;
      text: string;
      result?: Promise<unknown>;
    } = { reference, text };
    root.current?.dispatchEvent(
      new CustomEvent(conversationReferenceEvent, {
        bubbles: true,
        composed: true,
        detail,
      }),
    );
    if (!detail.result) throw new Error(t("referenceUnavailable"));
    await detail.result;
  };
  const reference = (target: AgentTarget) => {
    if (!page) return;
    const { ids } = addressableIds(document, target.blockIds ?? []);
    const surfaceId =
      target.surfaceId &&
      !addressableIds(document, [target.surfaceId]).missing.length
        ? target.surfaceId
        : undefined;
    const value = pageReference(
      page.projectId,
      { document, hash: page.hash, revision: page.revision },
      {
        ...target,
        blockIds: ids,
        surfaceId,
        ...(target.kind !== "page" && !ids.length && !surfaceId
          ? { kind: "page" }
          : {}),
      },
    );
    const heading = t(
      value.kind === "page"
        ? "referenceHeadingPage"
        : value.kind === "board"
          ? value.nodeIds?.length
            ? "referenceHeadingBoard"
            : "referenceHeadingBoardAll"
          : "referenceHeadingSelection",
      {
        title: value.title || page.title,
        count: (value.blockIds ?? value.nodeIds ?? []).length,
        version: referenceVersion(value),
      },
    );
    void deliver(value, formatReference(value, heading))
      .then(() => {
        setActive(true);
        setStatus(t("referenceAdded", { version: referenceVersion(value) }));
      })
      .catch((error: Error) => setStatus(error.message));
  };
  const clear = () =>
    void deliver(null)
      .then(() => {
        setActive(false);
        setStatus(t("referenceCleared"));
      })
      .catch((error: Error) => setStatus(error.message));
  useEffect(() => {
    const element = root.current;
    if (!page || !element) return;
    // A secondary click may move the caret before contextmenu fires, so the
    // selection is read when the button goes down.
    let pressed: {
      at: number;
      selection: ReturnType<typeof selectionAt>;
    } | null = null;
    const press = (event: PointerEvent) => {
      if (event.button === 2)
        pressed = {
          at: event.timeStamp,
          selection: selectionAt(element, event),
        };
    };
    const open = (event: MouseEvent) => {
      const target = event.target as Element;
      // Shift keeps the browser menu; fields and links keep theirs.
      if (
        event.shiftKey ||
        target.closest("input,textarea,select,a[href],[contenteditable=true]")
      )
        return;
      event.preventDefault();
      const selected =
        pressed && event.timeStamp - pressed.at < 1000
          ? pressed.selection
          : selectionAt(element, event);
      pressed = null;
      setMenu({
        x: event.clientX,
        y: event.clientY,
        selection: selected?.elements ?? [],
        text: selected?.text ?? "",
        block: target.closest<HTMLElement>("[data-block-id],[data-surface-id]"),
      });
    };
    element.addEventListener("pointerdown", press, true);
    element.addEventListener("contextmenu", open);
    return () => {
      element.removeEventListener("pointerdown", press, true);
      element.removeEventListener("contextmenu", open);
    };
  }, [root, page]);
  useEffect(() => {
    if (!menu) return;
    const close = (event: Event) => {
      if (event instanceof KeyboardEvent && event.key !== "Escape") return;
      if (
        event instanceof PointerEvent &&
        menuRef.current?.contains(event.target as Node)
      )
        return;
      setMenu(null);
    };
    window.addEventListener("pointerdown", close, true);
    window.addEventListener("keydown", close, true);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("pointerdown", close, true);
      window.removeEventListener("keydown", close, true);
      window.removeEventListener("scroll", close, true);
    };
  }, [menu]);
  useEffect(() => {
    if (!status) return;
    const timer = setTimeout(() => setStatus(""), 3000);
    return () => clearTimeout(timer);
  }, [status]);
  useEffect(() => {
    const element = menuRef.current;
    if (!element || !menu) return;
    // Keep the menu inside the conversation frame.
    const box = element.getBoundingClientRect();
    element.style.left = `${Math.max(8, Math.min(menu.x, innerWidth - box.width - 8))}px`;
    element.style.top = `${Math.max(8, Math.min(menu.y, innerHeight - box.height - 8))}px`;
    element.querySelector("button")?.focus();
  }, [menu]);
  // Readers may show a Board as a reading projection, so its objects are
  // recognised from the document rather than from the layout on screen.
  const boardOf = (id: string) => {
    const parent = findSurfaceNode(document, id)?.parent;
    return parent?.type === "surface" && parent.attrs?.kind === "board"
      ? (parent.attrs.id as string)
      : undefined;
  };
  const targetOf = (elements: HTMLElement[], text?: string): AgentTarget => {
    const ids = elements.map(idOf);
    const boards = ids.map(boardOf);
    return boards[0] && boards.every((board) => board === boards[0])
      ? { kind: "board", blockIds: ids, surfaceId: boards[0] }
      : text
        ? { kind: "text", blockIds: elements.map(idOf), text }
        : { kind: "blocks", blockIds: elements.map(idOf) };
  };
  const choose = (action: () => void) => {
    setMenu(null);
    action();
  };
  const contextMenu = menu && (
    <div
      ref={menuRef}
      className="portable-options-menu portable-context-menu"
      role="menu"
      style={{ left: menu.x, top: menu.y }}
    >
      {menu.selection.length ? (
        <button
          role="menuitem"
          onClick={() =>
            choose(() => reference(targetOf(menu.selection, menu.text)))
          }
        >
          <AtSign size={15} />
          {t("referenceSelection", { count: menu.selection.length })}
        </button>
      ) : (
        menu.block && (
          <button
            role="menuitem"
            onClick={() => choose(() => reference(targetOf([menu.block!])))}
          >
            <AtSign size={15} />
            {t("referenceBlock")}
          </button>
        )
      )}
      <button
        role="menuitem"
        onClick={() => choose(() => reference({ kind: "page" }))}
      >
        <AtSign size={15} />
        {t("referencePage")}
      </button>
      {active && (
        <button role="menuitem" onClick={() => choose(clear)}>
          <X size={15} />
          {t("referenceClear")}
        </button>
      )}
    </div>
  );
  return {
    contextMenu,
    status: status && (
      <div className="portable-reference-status" role="status">
        {status}
      </div>
    ),
  };
}
