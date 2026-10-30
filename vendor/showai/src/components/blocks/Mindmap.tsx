import {
  useEffect,
  useLayoutEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type CSSProperties,
} from "react";
import { SelectionToolbar } from "../../editor/SelectionToolbar";
import {
  Plus,
  Minus,
  Maximize2,
  Network,
  ListTree,
  Type,
  Trash2,
  ChevronRight,
  Undo2,
  Redo2,
} from "../../ui/icons";
import { BlockHeader, blockLabel } from "./shared";
import { useTranslator } from "../../i18n/react";
import messages from "../../i18n/messages/mindmap";
import type { BlockProps } from "./types";
import {
  addMindmapNode,
  layoutMindmap,
  mindmapConnectionPath,
  MAX_MINDMAP_NODES,
  mindmapChildren,
  promoteMindmapNode,
  removeMindmapNode,
  validateMindmapData,
  type MindmapData,
} from "./mindmap-contract.mjs";
import "./mindmap.css";
import {
  isRecord,
  isStringList,
  useReaderState,
} from "../../surface/reader-state";

export function MindmapBlock({
  data: raw,
  onChange,
  readOnly = false,
}: BlockProps) {
  const t = useTranslator(messages);
  const data = useMemo(() => validateMindmapData(raw), [raw]);
  const editable = !readOnly && !!onChange;
  const root = data.nodes.find((node) => node.parentId === null)!;
  const [selected, setSelected] = useState(root.id);
  const [active, setActive] = useState(false);
  const [editing, setEditing] = useState<{ id: string; value: string } | null>(
    null,
  );
  const editingId = useRef<string | null>(null);
  const selectName = useRef(true);
  const [collapsedList, setCollapsedList] = useReaderState<string[] | null>(
    "collapsed",
    null,
    { accept: (value) => value === null || isStringList(value) },
  );
  const readingCollapsed = useMemo(
    () => (collapsedList ? new Set(collapsedList) : null),
    [collapsedList],
  );
  const setReadingCollapsed = (next: Set<string>) =>
    setCollapsedList([...next]);
  const [readingView, setReadingView] = useReaderState<{
    layout: "radial" | "tree";
    direction: "right" | "left";
  } | null>("layout", null, {
    accept: (value) =>
      value === null ||
      (isRecord(value) &&
        ["radial", "tree"].includes(value.layout as string) &&
        ["right", "left"].includes(value.direction as string)),
  });
  const layout = (!editable && readingView?.layout) || data.layout || "radial";
  const direction =
    (!editable && readingView?.direction) || data.direction || "right";
  const collapsed =
    readingCollapsed ??
    new Set(data.nodes.filter((node) => node.collapsed).map((node) => node.id));
  const graph = useMemo(
    () => layoutMindmap({ ...data, layout, direction }, collapsed),
    [data, layout, direction, JSON.stringify([...collapsed])],
  );
  const [scale, setScale] = useState(1);
  const [anchor, setAnchor] = useState<{ left: number; top: number } | null>(
    null,
  );
  const section = useRef<HTMLElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const menuId = useId();
  const history = useRef<{
    past: MindmapData[];
    future: MindmapData[];
    expected: string | null;
  }>({ past: [], future: [], expected: null });
  const [notice, setNotice] = useState("");
  const node = data.nodes.find((item) => item.id === selected) ?? root;
  const hasChildren = mindmapChildren(data, node.id).length > 0;
  const fit = () => {
    const element = viewport.current;
    if (element)
      setScale(
        Math.max(
          0.15,
          Math.min(
            1,
            (element.clientWidth - 20) / graph.width,
            (element.clientHeight - 20) / graph.height,
          ),
        ),
      );
  };
  useLayoutEffect(fit, [layout, direction]);
  useEffect(() => {
    const signature = JSON.stringify(data);
    if (
      history.current.expected !== null &&
      history.current.expected !== signature
    ) {
      history.current.past = [];
      history.current.future = [];
    }
    history.current.expected = signature;
  }, [data]);
  useEffect(() => {
    if (
      !graph.nodes.some((item) => item.id === selected) &&
      editing?.id !== selected
    )
      setSelected(root.id);
  }, [graph, selected, root.id, editing?.id]);
  const focus = (id: string) => {
    setSelected(id);
    requestAnimationFrame(() => {
      const button = buttons.current.get(id);
      button?.focus({ preventScroll: true });
      button?.scrollIntoView({ block: "nearest", inline: "nearest" });
    });
  };
  useLayoutEffect(() => {
    if (editing) {
      input.current?.focus();
      if (selectName.current) input.current?.select();
      else
        input.current?.setSelectionRange(
          editing.value.length,
          editing.value.length,
        );
      input.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  }, [editing?.id, data.nodes.length]);
  useLayoutEffect(() => {
    if (!active || editing || !editable) {
      setAnchor(null);
      return;
    }
    const place = () => {
      const element = buttons.current.get(selected),
        canvas = viewport.current;
      if (!element || !canvas) return;
      const rect = element.getBoundingClientRect(),
        bounds = canvas.getBoundingClientRect();
      setAnchor(
        rect.bottom < bounds.top ||
          rect.top > bounds.bottom ||
          rect.right < bounds.left ||
          rect.left > bounds.right
          ? null
          : {
              left: Math.max(
                bounds.left,
                Math.min(bounds.right, rect.left + rect.width / 2),
              ),
              top: Math.max(bounds.top, rect.top),
            },
      );
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    const observer = new ResizeObserver(place);
    if (viewport.current) observer.observe(viewport.current);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
      observer.disconnect();
    };
  }, [active, editing, editable, selected, graph, scale]);
  const change = (next: MindmapData) => {
    if (!editable || next === data) return;
    validateMindmapData(next);
    history.current.past = [...history.current.past.slice(-99), data];
    history.current.future = [];
    history.current.expected = JSON.stringify(next);
    setNotice("");
    onChange?.(next);
  };
  const switchLayout = (next: "radial" | "tree") => {
    const nextDirection =
      next === "tree" && layout === "tree"
        ? direction === "right"
          ? "left"
          : "right"
        : direction;
    if (next === layout && nextDirection === direction) return;
    if (editable) change({ ...data, layout: next, direction: nextDirection });
    else setReadingView({ layout: next, direction: nextDirection });
  };
  const undo = (redo = false) => {
    const from = redo ? history.current.future : history.current.past;
    const next = from.pop();
    if (!next || !editable) return;
    (redo ? history.current.past : history.current.future).push(data);
    history.current.expected = JSON.stringify(next);
    onChange?.(next);
    focus(next.nodes.some((item) => item.id === selected) ? selected : root.id);
  };
  const edit = (id = selected, value?: string) => {
    if (!editable) return;
    const target = data.nodes.find((item) => item.id === id);
    if (!target) return;
    editingId.current = id;
    selectName.current = value === undefined;
    setAnchor(null);
    setEditing({ id, value: value ?? target.label });
  };
  const finish = (cancel = false) => {
    if (!editing || editingId.current !== editing.id) return;
    const label = editing.value.trim();
    if (!cancel && !label) {
      setNotice(t("enterNodeName"));
      input.current?.focus();
      return;
    }
    editingId.current = null;
    setEditing(null);
    if (
      !cancel &&
      label !== data.nodes.find((item) => item.id === editing.id)?.label
    )
      change({
        ...data,
        nodes: data.nodes.map((item) =>
          item.id === editing.id ? { ...item, label } : item,
        ),
      });
    focus(editing.id);
  };
  const add = (relation: "child" | "sibling", before = false) => {
    if (!editable) return;
    if (data.nodes.length >= MAX_MINDMAP_NODES) {
      setNotice(t("nodeLimit", { count: MAX_MINDMAP_NODES }));
      return;
    }
    const id = crypto.randomUUID();
    const next = addMindmapNode(data, selected, id, relation, before);
    change(next);
    setSelected(id);
    editingId.current = id;
    selectName.current = true;
    setEditing({ id, value: next.nodes.find((item) => item.id === id)!.label });
  };
  const remove = () => {
    if (!editable || node.parentId === null) return;
    change(removeMindmapNode(data, selected));
    focus(node.parentId);
  };
  const toggle = () => {
    if (!hasChildren) return;
    const next = new Set(collapsed);
    if (next.has(selected)) next.delete(selected);
    else next.add(selected);
    if (editable)
      change({
        ...data,
        nodes: data.nodes.map((item) =>
          item.id === selected
            ? { ...item, collapsed: next.has(selected) }
            : item,
        ),
      });
    else setReadingCollapsed(next);
    focus(selected);
  };
  const keyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (
      event.nativeEvent.isComposing ||
      event.keyCode === 229 ||
      (event.target as Element).closest("input, .sm-view-controls")
    )
      return;
    const command = event.metaKey || event.ctrlKey;
    const menu =
      (event.target as Element).closest(".editor-bubble")?.id === menuId;
    const layoutControl = (event.target as Element).closest(
      ".sb-header .sb-actions",
    );
    if (
      menu || layoutControl
        ? !command
        : !(event.target as Element).closest(".sm-node")
    )
      return;
    let handled = true;
    if (command && event.key.toLowerCase() === "z" && editable)
      undo(event.shiftKey);
    else if (command && event.key.toLowerCase() === "y" && editable) undo(true);
    else if (command || event.altKey) handled = false;
    else if (event.key === "Tab" && editable && !event.shiftKey) add("child");
    else if (event.key === "Tab" && editable && event.shiftKey) {
      change(promoteMindmapNode(data, selected));
      focus(selected);
    } else if (event.key === "Enter" && editable)
      add("sibling", event.shiftKey);
    else if (event.key === "F2" && editable) edit();
    else if ((event.key === "Delete" || event.key === "Backspace") && editable)
      remove();
    else if (event.key === " ") toggle();
    else if (event.key === "ArrowLeft") {
      if (node.parentId) focus(node.parentId);
    } else if (event.key === "ArrowRight") {
      if (collapsed.has(selected)) toggle();
      else {
        const child = mindmapChildren(data, selected)[0];
        if (child) focus(child.id);
      }
    } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      const siblings = data.nodes.filter(
        (item) => item.parentId === node.parentId,
      );
      const index = siblings.findIndex((item) => item.id === selected);
      const next = siblings[index + (event.key === "ArrowUp" ? -1 : 1)];
      if (next) focus(next.id);
    } else if (event.key === "Escape") {
      setActive(false);
      (event.target as HTMLElement).blur();
    } else if (event.key.length === 1 && editable) edit(selected, event.key);
    else handled = false;
    if (handled) {
      event.preventDefault();
      event.stopPropagation();
    }
  };
  return (
    <section
      ref={section}
      className="sb-block sm-block"
      aria-label={blockLabel(data.title, t("mindmap"))}
      contentEditable={false}
      data-editor-keyboard-scope="mindmap"
      data-mindmap-layout={layout}
      data-mindmap-direction={direction}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={keyDown}
      onFocus={(event) => {
        if ((event.target as Element).closest(".sm-node, .sm-node-input"))
          setActive(true);
      }}
      onBlur={(event) => {
        if (
          !section.current?.contains(event.relatedTarget as Node) &&
          !(event.relatedTarget as Element | null)?.closest?.(
            `[id="${menuId}"]`,
          )
        )
          setActive(false);
      }}
      onContextMenu={() => setActive(false)}
    >
      <BlockHeader
        title={data.title}
        // i18n-exempt: matches the saved default title
        defaultTitle="思维导图"
        description={data.description}
      >
        <button
          type="button"
          className="sb-icon-button"
          aria-label={t("radialLayout")}
          title={t("radialLayout")}
          aria-pressed={layout === "radial"}
          data-surface-ui
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => switchLayout("radial")}
        >
          <Network size={16} />
        </button>
        <button
          type="button"
          className="sb-icon-button"
          aria-label={t("treeLayout")}
          title={
            direction === "right"
              ? t(
                  layout === "tree"
                    ? "treeLayout.rightToggle"
                    : "treeLayout.right",
                )
              : t(
                  layout === "tree"
                    ? "treeLayout.leftToggle"
                    : "treeLayout.left",
                )
          }
          aria-pressed={layout === "tree"}
          data-surface-ui
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => switchLayout("tree")}
        >
          <ListTree
            size={16}
            style={{
              transform: direction === "left" ? "scaleX(-1)" : undefined,
            }}
          />
        </button>
      </BlockHeader>
      <div
        ref={viewport}
        className="sm-viewport"
        style={{ height: data.height ?? 460 }}
      >
        <div
          className="sm-scroll-space"
          style={{
            width: graph.width * scale,
            height: graph.height * scale,
            minWidth: "100%",
            minHeight: "100%",
          }}
        >
          <div
            className="sm-map"
            role="tree"
            aria-label={t("nodes")}
            style={{
              width: graph.width,
              height: graph.height,
              transform: `scale(${scale})`,
              left: `max(0px, calc(50% - ${(graph.width * scale) / 2}px))`,
              top: `max(0px, calc(50% - ${(graph.height * scale) / 2}px))`,
            }}
          >
            <svg
              className="sm-connections"
              width={graph.width}
              height={graph.height}
              aria-hidden="true"
            >
              {graph.nodes
                .filter((item) => item.parentId)
                .map((item) => {
                  const parent = graph.nodes.find(
                    (candidate) => candidate.id === item.parentId,
                  )!;
                  return (
                    <path
                      key={item.id}
                      className={`sm-branch-${item.color}`}
                      d={mindmapConnectionPath(parent, item)}
                    />
                  );
                })}
            </svg>
            {graph.nodes.map((item) => {
              const count = mindmapChildren(data, item.id).length;
              const isEditing = editing?.id === item.id;
              return (
                <div
                  key={item.id}
                  className={`sm-node-wrap sm-branch-${item.color}${item.parentId === null ? " sm-root" : ""}`}
                  style={
                    {
                      left: item.x,
                      top: item.y,
                      width: item.width,
                      minHeight: item.height,
                      "--sm-node-height": `${item.height}px`,
                    } as CSSProperties
                  }
                >
                  {isEditing ? (
                    <input
                      ref={input}
                      className="sm-node-input"
                      aria-label={t("nodeName")}
                      maxLength={200}
                      value={editing.value}
                      onChange={(event) =>
                        setEditing({ id: item.id, value: event.target.value })
                      }
                      onBlur={() => finish()}
                      onKeyDown={(event) => {
                        event.stopPropagation();
                        if (
                          event.nativeEvent.isComposing ||
                          event.keyCode === 229
                        )
                          return;
                        if (event.key === "Enter" || event.key === "Tab") {
                          event.preventDefault();
                          finish();
                        }
                        if (event.key === "Escape") {
                          event.preventDefault();
                          finish(true);
                        }
                      }}
                    />
                  ) : (
                    <button
                      type="button"
                      ref={(element) => {
                        if (element) buttons.current.set(item.id, element);
                        else buttons.current.delete(item.id);
                      }}
                      className={`sm-node${active && selected === item.id ? " is-selected" : ""}`}
                      role="treeitem"
                      aria-level={item.depth + 1}
                      aria-selected={selected === item.id}
                      aria-expanded={
                        count ? !collapsed.has(item.id) : undefined
                      }
                      tabIndex={selected === item.id ? 0 : -1}
                      onFocus={() => setSelected(item.id)}
                      onClick={(event) => {
                        event.currentTarget.focus({ preventScroll: true });
                        setSelected(item.id);
                        setActive(true);
                      }}
                      onDoubleClick={() => edit(item.id)}
                    >
                      <span>{item.label}</span>
                      {count > 0 && collapsed.has(item.id) && (
                        <span className="sm-count">+{count}</span>
                      )}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <div className="sm-footer">
        <div className="sm-view-controls" role="group" aria-label={t("view")}>
          <button
            type="button"
            aria-label={t("zoomOut")}
            disabled={scale <= 0.15}
            onClick={() => setScale(Math.max(0.15, scale / 1.2))}
          >
            <Minus size={15} />
          </button>
          <button type="button" aria-label={t("fit")} onClick={fit}>
            <Maximize2 size={15} />
            <span>{Math.round(scale * 100)}%</span>
          </button>
          <button
            type="button"
            aria-label={t("zoomIn")}
            disabled={scale >= 2}
            onClick={() => setScale(Math.min(2, scale * 1.2))}
          >
            <Plus size={15} />
          </button>
        </div>
      </div>
      {notice && (
        <p role="status" className="sm-notice">
          {notice}
        </p>
      )}
      {anchor && editable && !editing && (
        <SelectionToolbar
          id={menuId}
          anchor={anchor}
          anchorElement={buttons.current.get(selected)}
          label={t("nodeActions")}
          keyboardScope="mindmap"
          onEscape={() => {
            setActive(false);
            buttons.current.get(selected)?.blur();
          }}
        >
          <button
            className="editor-tool"
            type="button"
            aria-label={t("editNode")}
            title={t("editNode")}
            onClick={() => edit()}
          >
            <Type size={16} />
          </button>
          <span className="toolbar-divider" />
          <button
            className="editor-tool sm-labeled-action"
            type="button"
            aria-label={t("newChild")}
            title={t("newChild")}
            disabled={data.nodes.length >= MAX_MINDMAP_NODES}
            onClick={() => add("child")}
          >
            <Plus size={16} />
            <span>{t("child")}</span>
          </button>
          <button
            className="editor-tool sm-labeled-action"
            type="button"
            aria-label={t("newSibling")}
            title={t("newSibling")}
            disabled={
              data.nodes.length >= MAX_MINDMAP_NODES || node.parentId === null
            }
            onClick={() => add("sibling")}
          >
            <Plus size={16} />
            <span>{t("sibling")}</span>
          </button>
          <button
            className="editor-tool"
            type="button"
            aria-label={
              collapsed.has(selected) ? t("expandBranch") : t("collapseBranch")
            }
            title={t("toggleBranch")}
            disabled={!hasChildren}
            onClick={toggle}
          >
            <ChevronRight size={16} />
          </button>
          <button
            className="editor-tool"
            type="button"
            aria-label={t("undoAction")}
            title={t("undo")}
            disabled={!history.current.past.length}
            onClick={() => undo()}
          >
            <Undo2 size={16} />
          </button>
          <button
            className="editor-tool"
            type="button"
            aria-label={t("redoAction")}
            title={t("redo")}
            disabled={!history.current.future.length}
            onClick={() => undo(true)}
          >
            <Redo2 size={16} />
          </button>
          <button
            className="editor-tool"
            type="button"
            aria-label={t("deleteNodeAndChildren")}
            title={t("deleteBranch")}
            disabled={node.parentId === null}
            onClick={remove}
          >
            <Trash2 size={16} />
          </button>
        </SelectionToolbar>
      )}
    </section>
  );
}
