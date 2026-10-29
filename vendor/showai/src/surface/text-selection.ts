import type { Editor } from "@tiptap/core";
import { createTextModel } from "./text-selection-model";
import {
  replaceTextRanges,
  textRangeEditMeta,
  type TextEditRange,
} from "../components/rich-text/text-range-edit";

const editors = new WeakMap<HTMLElement, Editor>();
const frames = new WeakMap<
  HTMLIFrameElement,
  { channel: string; text: string }
>();
type Point = { x: number; y: number };
type Caret = { node: Node; offset: number };
/** Installed scopes read their painted selection through this, not the DOM selection. */
const paintedSelections = new WeakMap<
  HTMLElement,
  () => { ranges: Range[]; text: string } | null
>();
/** The read-only text selection painted in the scope around `target`, if any.
 * Its document selection lives in a hidden input, so callers read it here. */
export function paintedTextSelection(target: Element) {
  for (
    let element: HTMLElement | null = target.closest<HTMLElement>("*");
    element;
    element = element.parentElement
  ) {
    const read = paintedSelections.get(element);
    if (read) return read();
  }
  return null;
}
const textBoundarySelector =
  ".document-widget,.portable-widget,.page-document-module,.rich-text-component,[data-surface-id],pre,table,.document-callout,.document-toggle,.document-stepper";
export function registerSelectionEditor(editor: Editor) {
  editors.set(editor.view.dom, editor);
  return () => {
    editors.delete(editor.view.dom);
  };
}
export function registerSelectionFrame(
  frame: HTMLIFrameElement,
  channel: string,
) {
  frames.set(frame, { channel, text: "" });
  return () => {
    frames.delete(frame);
  };
}
export function receiveSelectionFrameText(
  frame: HTMLIFrameElement,
  text: unknown,
) {
  const entry = frames.get(frame);
  if (entry && typeof text === "string" && text.length <= 256_000)
    entry.text = text;
}
export function relayComponentSelectionPointer(
  frame: HTMLIFrameElement,
  data: Record<string, unknown>,
) {
  if (
    !["down", "move", "up", "cancel"].includes(String(data.phase)) ||
    ![data.x, data.y, data.width, data.height, data.buttons, data.offset].every(
      (value) => typeof value === "number" && Number.isFinite(value),
    ) ||
    Number(data.width) <= 0 ||
    Number(data.height) <= 0
  )
    return;
  const rect = frame.getBoundingClientRect();
  frame.dispatchEvent(
    new CustomEvent("showai:text-selection-pointer", {
      bubbles: true,
      detail: {
        phase: data.phase,
        buttons: data.buttons,
        point: {
          x: rect.left + (Number(data.x) / Number(data.width)) * rect.width,
          y: rect.top + (Number(data.y) / Number(data.height)) * rect.height,
        },
        caret: { node: frame, offset: Number(data.offset) },
      },
    }),
  );
}
function caretAt(doc: Document, point: Point): Caret | null {
  if (doc.caretRangeFromPoint) {
    const range = doc.caretRangeFromPoint(point.x, point.y);
    return range
      ? { node: range.startContainer, offset: range.startOffset }
      : null;
  }
  const position = (
    doc as Document & {
      caretPositionFromPoint?: (
        x: number,
        y: number,
      ) => { offsetNode: Node; offset: number } | null;
    }
  ).caretPositionFromPoint?.(point.x, point.y);
  return position
    ? { node: position.offsetNode, offset: position.offset }
    : null;
}
function textBoundary(node: Node) {
  return (node instanceof Element ? node : node.parentElement)?.closest(
    ".document-widget,.portable-widget,.page-document-module,.rich-text-component,[data-surface-id]",
  );
}
export function isTextPointerTarget(target: Element, x: number, y: number) {
  const caret = caretAt(target.ownerDocument, { x, y });
  return (
    !!caret &&
    caret.node.nodeType === Node.TEXT_NODE &&
    target.contains(caret.node) &&
    getComputedStyle(target).userSelect !== "none"
  );
}
export function edgeVelocity(value: number, low: number, high: number) {
  const margin = Math.min(40, (high - low) / 3);
  if (margin <= 0) return 0;
  if (value < low + margin)
    return -18 * Math.min(1, (low + margin - value) / margin);
  if (value > high - margin)
    return 18 * Math.min(1, (value - high + margin) / margin);
  return 0;
}

export function scrollSelection(
  target: Element,
  page: HTMLElement,
  point: Point,
) {
  let changed = false,
    movedX = false,
    movedY = false;
  const clip = page.getBoundingClientRect();
  for (
    let current: Element | null = target;
    current && page.contains(current);
    current = current.parentElement
  ) {
    if (!(current instanceof HTMLElement)) continue;
    const style = getComputedStyle(current);
    const rect = current.getBoundingClientRect();
    const x =
      !movedX && /auto|scroll/.test(style.overflowX)
        ? edgeVelocity(
            point.x,
            Math.max(0, rect.left, clip.left),
            Math.min(innerWidth, rect.right, clip.right),
          )
        : 0;
    const y =
      !movedY && /auto|scroll/.test(style.overflowY)
        ? edgeVelocity(
            point.y,
            Math.max(0, rect.top, clip.top),
            Math.min(innerHeight, rect.bottom, clip.bottom),
          )
        : 0;
    const beforeX = current.scrollLeft,
      beforeY = current.scrollTop;
    if (x) current.scrollLeft += x;
    if (y) current.scrollTop += y;
    if (current.scrollLeft !== beforeX || current.scrollTop !== beforeY) {
      changed = true;
      movedX ||= current.scrollLeft !== beforeX;
      movedY ||= current.scrollTop !== beforeY;
      if (movedX && movedY) break;
    }
    if (current === page) break;
  }
  return changed;
}

/** Cross-component selection is a set of character ranges, never a node selection. */
export function installPageTextSelection(
  root: HTMLElement,
  inputLabel = "Text selection",
) {
  const doc = root.ownerDocument,
    win = doc.defaultView!;
  const name = "showai-text-" + crypto.randomUUID();
  const style = doc.createElement("style");
  style.textContent = `::highlight(${name}){background:Highlight;color:HighlightText}`;
  root.append(style);
  const proxy = doc.createElement("textarea");
  proxy.tabIndex = -1;
  proxy.hidden = true;
  proxy.dataset.textSelectionInput = "true";
  proxy.setAttribute("aria-label", inputLabel);
  proxy.style.cssText =
    "position:fixed;left:-10000px;top:0;width:1px;height:1px;opacity:0;pointer-events:none";
  root.append(proxy);
  const highlightAPI = win as unknown as {
    Highlight?: new (...ranges: Range[]) => unknown;
    CSS: { highlights?: Map<string, unknown> };
  };
  let drag: {
    page: HTMLElement;
    target: Element;
    anchor: Caret;
    start: Point;
    point: Point;
    cross: boolean;
    moved: boolean;
    pointer?: number;
    head?: Caret;
    readOnlyStart: boolean;
    boundaries: Element[];
    table: Element | null;
  } | null = null;
  let selected: {
    page: HTMLElement;
    anchor: Caret;
    head: Caret;
    model: ReturnType<typeof createTextModel>;
    from: number;
    to: number;
  } | null = null;
  let frame = 0,
    suppressClick = false,
    composing = false;
  const send = (
    iframe: HTMLIFrameElement,
    type: string,
    fields: Record<string, unknown> = {},
  ) => {
    const info = frames.get(iframe);
    if (info)
      iframe.contentWindow?.postMessage(
        { channel: info.channel, type, ...fields },
        "*",
      );
  };
  const stop = () => {
    win.cancelAnimationFrame(frame);
    frame = 0;
    drag = null;
  };
  const clear = () => {
    highlightAPI.CSS.highlights?.delete(name);
    for (const iframe of root.querySelectorAll("iframe"))
      send(iframe, "showai:text-selection-range", { from: 0, to: 0 });
    selected = null;
    proxy.value = "";
    if (doc.activeElement === proxy) proxy.blur();
    proxy.hidden = true;
    delete root.dataset.textSelection;
  };
  const paint = (page: HTMLElement, anchor: Caret, head: Caret) => {
    const model = createTextModel(
      page,
      (iframe) => frames.get(iframe)?.text ?? "",
    );
    const a = model.offsetAt(anchor.node, anchor.offset),
      b = model.offsetAt(head.node, head.offset);
    if (a === null || b === null) return;
    const from = Math.min(a, b),
      to = Math.max(a, b);
    selected = { page, anchor, head, model, from, to };
    proxy.value = model.text.slice(from, to);
    proxy.setSelectionRange(0, proxy.value.length);
    if (highlightAPI.Highlight && highlightAPI.CSS.highlights)
      highlightAPI.CSS.highlights.set(
        name,
        new highlightAPI.Highlight(...model.ranges(from, to)),
      );
    else
      doc
        .getSelection()
        ?.setBaseAndExtent(anchor.node, anchor.offset, head.node, head.offset);
    for (const entry of model.entries)
      if (entry.node instanceof HTMLIFrameElement)
        send(entry.node, "showai:text-selection-range", {
          from: Math.max(0, from - entry.start),
          to: Math.min(entry.end - entry.start, to - entry.start),
        });
  };
  const start = (
    target: Element,
    point: Point,
    anchor = caretAt(doc, point),
    pointer?: number,
  ) => {
    if (
      !anchor ||
      target.closest(
        'button,input,textarea,select,summary,[role="button"],[role="slider"],[data-surface-ui],[data-surface-handle],.block-handle,.react-flow,[data-surface-gesture="own"]',
      )
    )
      return;
    if (
      !(anchor.node instanceof HTMLIFrameElement) &&
      !isTextPointerTarget(target, point.x, point.y)
    )
      return;
    let page = target.closest<HTMLElement>(".container-page");
    if (!page || !root.contains(page)) return;
    for (
      let parent = page.parentElement?.closest<HTMLElement>(".container-page");
      parent && root.contains(parent);
      parent = parent.parentElement?.closest<HTMLElement>(".container-page")
    )
      page = parent;
    stop();
    clear();
    for (const iframe of page.querySelectorAll("iframe"))
      send(iframe, "showai:text-selection-content-request");
    const editable = (
      anchor.node instanceof Element ? anchor.node : anchor.node.parentElement
    )?.closest<HTMLElement>("[contenteditable]");
    const readOnlyStart = !editable || !editors.get(editable)?.isEditable;
    if (readOnlyStart && doc.activeElement instanceof HTMLElement)
      doc.activeElement.blur();
    drag = {
      page,
      target,
      anchor,
      start: point,
      point,
      cross: false,
      moved: false,
      pointer,
      readOnlyStart,
      boundaries: [...page.querySelectorAll(textBoundarySelector)],
      table: target.closest("table"),
    };
  };
  const extend = (remote?: Caret) => {
    if (!drag || !drag.moved || !drag.anchor.node.isConnected) return;
    const { page, anchor, point } = drag,
      rect = page.getBoundingClientRect();
    const clipped = {
      x: Math.max(rect.left + 2, Math.min(rect.right - 2, point.x)),
      y: Math.max(
        rect.top + 2,
        Math.min(innerHeight - 2, rect.bottom - 2, point.y),
      ),
    };
    const target = doc.elementFromPoint(clipped.x, clipped.y);
    if (!target || !page.contains(target)) return;
    if (target instanceof HTMLIFrameElement && !remote) {
      const box = target.getBoundingClientRect();
      send(target, "showai:text-selection-hit", {
        x: ((clipped.x - box.left) / box.width) * target.clientWidth,
        y: ((clipped.y - box.top) / box.height) * target.clientHeight,
        buttons: 1,
      });
      return;
    }
    const head = remote ?? caretAt(doc, clipped);
    if (!head || !page.contains(head.node)) return;
    let cross =
      drag.cross ||
      drag.readOnlyStart ||
      textBoundary(anchor.node) !== textBoundary(head.node) ||
      !!(drag.table && target.closest("table") !== drag.table);
    if (
      !cross &&
      !(anchor.node instanceof HTMLIFrameElement) &&
      !(head.node instanceof HTMLIFrameElement)
    ) {
      const probe = doc.createRange(),
        end = doc.createRange();
      probe.setStart(anchor.node, anchor.offset);
      probe.collapse(true);
      end.setStart(head.node, head.offset);
      end.collapse(true);
      if (probe.compareBoundaryPoints(Range.START_TO_START, end) > 0) {
        probe.setStart(head.node, head.offset);
        probe.setEnd(anchor.node, anchor.offset);
      } else probe.setEnd(head.node, head.offset);
      cross = drag.boundaries.some(
        (element) =>
          element.isConnected &&
          !element.contains(anchor.node) &&
          !element.contains(head.node) &&
          probe.intersectsNode(element),
      );
    }
    if (!cross) return;
    if (!drag.cross) {
      drag.cross = true;
      root.dataset.textSelection = "true";
      // Focus outside contenteditable prevents an editor from clamping the DOM range.
      proxy.hidden = false;
      proxy.focus({ preventScroll: true });
      doc.getSelection()?.removeAllRanges();
    }
    drag.head = head;
    paint(page, anchor, head);
  };
  const tick = () => {
    if (!drag) return;
    if (drag.moved) {
      const hit = doc.elementFromPoint(
        Math.max(0, Math.min(innerWidth - 1, drag.point.x)),
        Math.max(0, Math.min(innerHeight - 1, drag.point.y)),
      );
      const changed = scrollSelection(
        hit && drag.page.contains(hit) ? hit : drag.target,
        drag.page,
        drag.point,
      );
      if (changed) {
        if (drag.cross) extend();
        else if (!drag.page.querySelector(".selectedCell")) {
          const rect = drag.page.getBoundingClientRect();
          const caret = caretAt(doc, {
            x: Math.max(rect.left + 2, Math.min(rect.right - 2, drag.point.x)),
            y: Math.max(
              rect.top + 2,
              Math.min(innerHeight - 2, rect.bottom - 2, drag.point.y),
            ),
          });
          if (
            caret &&
            drag.anchor.node instanceof Text &&
            drag.page.contains(caret.node)
          )
            doc
              .getSelection()
              ?.setBaseAndExtent(
                drag.anchor.node,
                Math.min(drag.anchor.offset, drag.anchor.node.length),
                caret.node,
                caret.offset,
              );
          extend();
        } else {
          const rect = drag.page.getBoundingClientRect();
          doc.dispatchEvent(
            new MouseEvent("mousemove", {
              bubbles: true,
              buttons: 1,
              clientX: drag.point.x,
              clientY: Math.max(
                rect.top + 2,
                Math.min(rect.bottom - 2, innerHeight - 2, drag.point.y),
              ),
            }),
          );
        }
      }
    }
    frame = win.requestAnimationFrame(tick);
  };
  const down = (event: PointerEvent) => {
    if (
      event.button === 0 &&
      event.pointerType === "mouse" &&
      !event.shiftKey &&
      !event.metaKey &&
      !event.ctrlKey &&
      event.target instanceof Element
    )
      start(
        event.target,
        { x: event.clientX, y: event.clientY },
        undefined,
        event.pointerId,
      );
  };
  const move = (event: PointerEvent) => {
    if (
      !drag ||
      (drag.pointer !== undefined && drag.pointer !== event.pointerId)
    )
      return;
    if (!(event.buttons & 1)) {
      stop();
      return;
    }
    drag.point = { x: event.clientX, y: event.clientY };
    drag.moved ||=
      Math.hypot(drag.point.x - drag.start.x, drag.point.y - drag.start.y) > 4;
    extend();
    if (drag?.cross) {
      event.preventDefault();
      event.stopPropagation();
    }
    if (!frame) frame = win.requestAnimationFrame(tick);
  };
  const up = () => {
    if (drag?.cross) {
      extend(drag.head);
      suppressClick = true;
    }
    stop();
  };
  const mouseMove = (event: MouseEvent) => {
    if (drag?.cross) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  };
  const click = (event: MouseEvent) => {
    if (suppressClick) {
      suppressClick = false;
      event.preventDefault();
      event.stopPropagation();
    }
  };
  const apply = (text: string) => {
    if (!selected || selected.from === selected.to) return;
    if (!selected.anchor.node.isConnected || !selected.head.node.isConnected) {
      clear();
      return;
    }
    const plans = new Map<Editor, TextEditRange[]>();
    let insertion: Editor | undefined;
    for (const range of selected.model.ranges(selected.from, selected.to)) {
      const parent =
        range.startContainer instanceof Element
          ? range.startContainer
          : range.startContainer.parentElement!;
      const editable = parent.closest<HTMLElement>("[contenteditable]");
      const editor = editable && editors.get(editable);
      if (
        !editor?.isEditable ||
        editor.isDestroyed ||
        !editor.view.dom.isConnected
      )
        continue;
      const from = editor.view.posAtDOM(
          range.startContainer,
          range.startOffset,
        ),
        to = editor.view.posAtDOM(range.endContainer, range.endOffset);
      if (from >= to) continue;
      insertion ??= editor;
      const ranges = plans.get(editor) ?? [];
      ranges.push({ from, to });
      plans.set(editor, ranges);
    }
    if (!insertion) {
      proxy.value = selected.model.text.slice(selected.from, selected.to);
      proxy.setSelectionRange(0, proxy.value.length);
      return;
    }
    const group = "text-selection:" + crypto.randomUUID();
    const ordered = [...plans].sort(([a], [b]) =>
      a.view.dom.contains(b.view.dom)
        ? -1
        : b.view.dom.contains(a.view.dom)
          ? 1
          : 0,
    );
    clear();
    for (const [editor, ranges] of ordered) {
      const tr = replaceTextRanges(
        editor.state,
        ranges,
        text,
        editor === insertion,
      );
      if (tr) editor.view.dispatch(tr.setMeta(textRangeEditMeta, group));
    }
    insertion.view.focus();
  };
  const copy = (event: ClipboardEvent) => {
    if (!selected || doc.activeElement !== proxy || !event.clipboardData)
      return;
    event.clipboardData.setData(
      "text/plain",
      selected.model.text.slice(selected.from, selected.to),
    );
    event.preventDefault();
    event.stopPropagation();
    if (event.type === "cut") apply("");
  };
  const key = (event: KeyboardEvent) => {
    if (!selected || doc.activeElement !== proxy) return;
    if (
      (event.metaKey || event.ctrlKey) &&
      ["z", "y"].includes(event.key.toLowerCase())
    ) {
      clear();
      stop();
      return;
    }
    if (
      [
        "ArrowLeft",
        "ArrowRight",
        "ArrowUp",
        "ArrowDown",
        "Home",
        "End",
      ].includes(event.key)
    ) {
      event.preventDefault();
      event.stopPropagation();
      const backward = ["ArrowLeft", "ArrowUp", "Home"].includes(event.key);
      const ranges = selected.model.ranges(selected.from, selected.to);
      if (!backward) ranges.reverse();
      for (const range of ranges) {
        const node = backward ? range.startContainer : range.endContainer;
        const element = node instanceof Element ? node : node.parentElement;
        const editable = element?.closest<HTMLElement>("[contenteditable]");
        const editor = editable && editors.get(editable);
        if (
          !editor?.isEditable ||
          editor.isDestroyed ||
          !editor.view.dom.isConnected
        )
          continue;
        const position = editor.view.posAtDOM(
          node,
          backward ? range.startOffset : range.endOffset,
        );
        clear();
        stop();
        editor.commands.focus(position, { scrollIntoView: false });
        return;
      }
      clear();
      stop();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      clear();
      stop();
      return;
    }
    if (event.key === "Backspace" || event.key === "Delete") {
      event.preventDefault();
      event.stopPropagation();
      apply("");
    } else if (event.key === "Enter" && !event.isComposing) {
      event.preventDefault();
      event.stopPropagation();
      apply("\n");
    }
  };
  const input = (event: Event) => {
    if (!composing) {
      const value = event as InputEvent;
      apply(
        value.inputType.startsWith("delete") ? "" : (value.data ?? proxy.value),
      );
    }
  };
  const compositionStart = () => {
    composing = true;
  };
  const compositionEnd = () => {
    composing = false;
    apply(proxy.value);
  };
  const paste = (event: ClipboardEvent) => {
    if (selected && doc.activeElement === proxy) {
      event.preventDefault();
      event.stopPropagation();
      apply(event.clipboardData?.getData("text/plain") ?? "");
    }
  };
  const focus = (event: FocusEvent) => {
    if (selected && event.target !== proxy) {
      clear();
      stop();
    }
  };
  const reset = (event: PointerEvent) => {
    if (event.button === 0) {
      stop();
      clear();
      suppressClick = false;
    }
  };
  const bridge = (event: Event) => {
    if (!(event.target instanceof Element)) return;
    const { phase, point, caret, buttons } = (event as CustomEvent).detail;
    if (phase === "down") start(event.target, point, caret);
    else if (phase === "move" && drag && buttons & 1) {
      drag.point = point;
      drag.moved ||=
        Math.hypot(point.x - drag.start.x, point.y - drag.start.y) > 4;
      extend(caret);
      if (!frame) frame = win.requestAnimationFrame(tick);
    } else if (phase === "up") up();
    else if (phase === "cancel") stop();
  };
  const blur = () => stop();
  doc.addEventListener("focusin", focus, true);
  doc.addEventListener("pointerdown", reset, true);
  root.addEventListener("pointerdown", down, true);
  doc.addEventListener("pointermove", move, true);
  doc.addEventListener("mousemove", mouseMove, true);
  doc.addEventListener("pointerup", up, true);
  doc.addEventListener("pointercancel", stop, true);
  root.addEventListener("click", click, true);
  doc.addEventListener("copy", copy, true);
  doc.addEventListener("cut", copy, true);
  doc.addEventListener("keydown", key, true);
  doc.addEventListener("paste", paste, true);
  proxy.addEventListener("input", input);
  proxy.addEventListener("compositionstart", compositionStart);
  proxy.addEventListener("compositionend", compositionEnd);
  root.addEventListener("showai:text-selection-pointer", bridge);
  win.addEventListener("blur", blur);
  paintedSelections.set(root, () =>
    selected && selected.to > selected.from
      ? {
          ranges: selected.model.ranges(selected.from, selected.to),
          text: selected.model.text.slice(selected.from, selected.to),
        }
      : null,
  );
  return () => {
    paintedSelections.delete(root);
    stop();
    clear();
    style.remove();
    proxy.remove();
    doc.removeEventListener("focusin", focus, true);
    doc.removeEventListener("pointerdown", reset, true);
    root.removeEventListener("pointerdown", down, true);
    doc.removeEventListener("pointermove", move, true);
    doc.removeEventListener("mousemove", mouseMove, true);
    doc.removeEventListener("pointerup", up, true);
    doc.removeEventListener("pointercancel", stop, true);
    root.removeEventListener("click", click, true);
    doc.removeEventListener("copy", copy, true);
    doc.removeEventListener("cut", copy, true);
    doc.removeEventListener("keydown", key, true);
    doc.removeEventListener("paste", paste, true);
    root.removeEventListener("showai:text-selection-pointer", bridge);
    win.removeEventListener("blur", blur);
  };
}
