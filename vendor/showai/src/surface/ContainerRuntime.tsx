import {readBoardToolPreferences,saveBoardToolPreferences,boardStyleKey,boardToolPreferencesChanged,boardToolPreferencesKey} from "./board-tool-preferences";
import { PageOutline, PageOutlinePrint } from "./PageOutline";
import { OutlineSettings } from "./OutlineSettings";
import type { OutlineViewState } from "./page-outline.mjs";
import outlineMessages from "../i18n/messages/pageOutline";
import {isEditableDrawing} from "./portable-ink.mjs";
import { TextSelectionScope } from "./TextSelectionScope";
import { SurfaceGeometryStore } from "./geometry-store";
import { readingCapture } from "./reading-capture";
import { EditorViewScope } from "../editor/view-scope";
import {
  transformObjects,
  duplicateObjects,
  removeObjects,
  copyObjects,
  pasteObjects,
  reorderObjects,
  groupObjects,
  ungroupRegion,
  adoptIntoRegion,
  setObjectsLocked,
} from "./board-commands";
import {
  reconcileConnections,
  arrowEndpoints,
  arrowFromEndpoints,
  bindingAtPoint,
} from "./connections.mjs";
import type { EditorControls } from "./EditorControls";
import { AdditionalComponentsProvider } from "../components/custom/CustomBlock";
import type { CompiledComponent } from "../components/custom/types";
import { flushSync, createPortal } from "react-dom";
import { ComponentSlashMenu } from "../components/ComponentSlashMenu";
import { RegisterComponentContext } from "../components/useComponentCatalog";
import { insertComponent } from "./component-insertion";
import { labelCapable, labelFitHeight } from "./drawing-label.mjs";
import { tidyFrames } from "./diagram.mjs";
import {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import type { JSONContent } from "@tiptap/core";
import { ArrowLeft, ChevronRight, LayoutDashboard, X } from "../ui/icons";
import type { ContainerDocument, ShowDocument } from "../types";
import type {
  BoardTool,
  NodeLayout,
  PageWidthMode,
} from "./types";
import {
  SurfaceContent,
  hasDefaultName,
  nodeName,
  type ContentRenderer,
} from "./SurfaceContent";
import PageSurface, { type SurfaceHandle } from "./PageSurface";
import { ObjectContext, type ObjectActions } from "./SurfaceObject";
import {
  addNode,
  editNode as editSurfaceNode,
  moveNode,
  removeNode,
} from "./editing";
import { ownSourceValue } from "./source-runtime";

import {
  findSurfaceNode,
  nodePaths,
  visitNodes,
} from "./document.mjs";
import {
  resourceNodes,
  surfaceKind,
  surfaceViews,
  wrapSurface,
} from "./containers.mjs";
import "./containers.css";
import PageIcon from "../components/PageIcon";
import PageIconDialog from "../studio/PageIconDialog";
import { PageWidthSwitch } from "./PageWidthSwitch";
import { BoardTools } from "./BoardTools";
import { useTranslator } from "../i18n/react";
import commonMessages from "../i18n/messages/common";
import messages from "../i18n/messages/surface";
import {
  isFlag,
  isRecord,
  isStringList,
  useReaderStateScope,
} from "./reader-state";

// Attribute commands replace nested values explicitly, retaining source ink and
// children. Structural commands below perform their own reconciliation.
function editNode(
  source: ShowDocument,
  id: string,
  update: (node: JSONContent) => void,
) {
  return ownSourceValue(editSurfaceNode(source, id, update, {
    normalize: false,
    attributesOnly: true,
  }));
}

/** Text placed on a Board starts as a note-sized box rather than a page column. */
const boardTextWidth = 320;
interface Runtime {
  geometry: SurfaceGeometryStore;
  document: ContainerDocument;
  current: RefObject<ContainerDocument>;
  /** Commits sharing a group within a short interval form one undo step. */
  commit: (next: ShowDocument, group?: string) => void;
  readOnly: boolean;
  printing: boolean;
  pageWidthModes: boolean;
  selected: string | null;
  select: (id: string | null) => void;
  inspect: (id: string | null) => void;
  expand: (id: string) => void;
  active: string;
  activate: (id: string) => void;
  render: ContentRenderer;
  scrolls: Map<string, number>;
  outlines: Map<string, OutlineViewState>;
  outlineSettings: (id: string) => void;
  revealRequest: string | null;
  requestReveal: (id: string | null) => void;
  openComponents: (
    parentId: string,
    point: { x: number; y: number },
    position: { x: number; y: number },
  ) => void;
}
const Context = createContext<Runtime>(null!);
export interface ContainerViewState {
  selected?: string | null;
  expanded?: string | null;
  active?: string;
  scrolls?: Map<string, number>;
  outlines?: Map<string, OutlineViewState>;
}
export function ContainerRuntime({
  document: sourceDocument,
  geometry: suppliedGeometry,
  onChange,
  renderContent,
  header,
  revealId,
  revealInPlace,
  onRevealHandled,
  undo,
  redo,
  canUndo = false,
  canRedo = false,
  reading = false,
  nativeInkBackground = false,
  hideTitle = false,
  pageWidthModes = false,
  onActiveSurfaceChange,
  onControlsChange,
  retainedState,
  inspectorHost,
  onOpenEmbeddedSurface,
}: {
  document: ContainerDocument;
  onOpenEmbeddedSurface?: (id:string) => void;
  geometry?: SurfaceGeometryStore;
  onChange?: (next: ShowDocument, group?: string) => void;
  renderContent: ContentRenderer;
  header?: ReactNode;
  revealId?: string | null;
  revealInPlace?: string | null;
  onRevealHandled?: () => void;
  undo?: () => void;
  redo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
  reading?: boolean;
  nativeInkBackground?: boolean;
  hideTitle?: boolean;
  /** App editors opt in; exported readers retain their existing width. */
  pageWidthModes?: boolean;
  onActiveSurfaceChange?: (id: string) => void;
  onControlsChange?: (controls: EditorControls | null) => void;
  retainedState?: ContainerViewState;
  inspectorHost?: HTMLElement | null;
}) {
  const t = useTranslator(messages);
  const tc = useTranslator(commonMessages);
  const ot = useTranslator(outlineMessages);
  const [outlineSettingsId, setOutlineSettingsId] = useState<string | null>(null);
  const document = useMemo(
    () => ownSourceValue(reconcileConnections({ ...sourceDocument })),
    [sourceDocument],
  );
  const localGeometry = useMemo(
    () => new SurfaceGeometryStore(),
    [document.id],
  );
  const geometry = suppliedGeometry ?? localGeometry;
  const current = useRef(document);
  current.current = document;
  const [selected, select] = useState<string | null>(
      retainedState?.selected ?? null,
    ),
    [inspecting, inspect] = useState<string | null>(null),
    [expanded, expand] = useState<string | null>(
      retainedState?.expanded ?? null,
    ),
    [active, activate] = useState(
      retainedState?.active ?? document.content.attrs!.id,
    ),
    [revealRequest, requestReveal] = useState<string | null>(null);
  const [iconTarget, setIconTarget] = useState<string | null>(null);
  const [slash, setSlash] = useState<{
    parentId: string;
    left: number;
    top: number;
    position?: { x: number; y: number };
  } | null>(null);
  const [loadedComponents, setLoadedComponents] = useState<CompiledComponent[]>(
    [],
  );
  const closeSlash = useCallback(() => setSlash(null), []);
  const [printing, setPrinting] = useState(false);
  useEffect(() => {
    const media = matchMedia("print");
    const before = () => flushSync(() => setPrinting(true)),
      after = () => setPrinting(false),
      changed = () => setPrinting(media.matches);
    window.addEventListener("beforeprint", before);
    window.addEventListener("afterprint", after);
    media.addEventListener("change", changed);
    return () => {
      window.removeEventListener("beforeprint", before);
      window.removeEventListener("afterprint", after);
      media.removeEventListener("change", changed);
    };
  }, []);
  const scrolls = useRef(retainedState?.scrolls ?? new Map<string, number>());
  const outlines = useRef(
    retainedState?.outlines ?? new Map<string, OutlineViewState>(),
  );
  const viewState = useRef({ selected, expanded, active });
  viewState.current = { selected, expanded, active };
  useLayoutEffect(
    () => () => {
      if (retainedState)
        Object.assign(retainedState, viewState.current, {
          scrolls: scrolls.current,
          outlines: outlines.current,
        });
    },
    [retainedState],
  );
  useEffect(() => {
    onActiveSurfaceChange?.(active);
  }, [active, document.id]);
  const paths = useMemo(() => nodePaths(document), [document.content]);
  const target = expanded
    ? findSurfaceNode(document, expanded)?.node
    : undefined;
  const root = target?.type === "surface" ? target : document.content;
  const chain = [...(paths[root.attrs!.id] ?? []), root.attrs!.id]
    .map((id) => findSurfaceNode(document, id)?.node)
    .filter((node) => node?.type === "surface") as JSONContent[];
  const rootId = document.content.attrs!.id;
  const focusSurface = useCallback(
    (id: string) => {
      if(id!==rootId && onOpenEmbeddedSurface){onOpenEmbeddedSurface(id);return;}
      expand(id === rootId ? null : id);
      activate(id);
      select(null);
      inspect(null);
    },
    [rootId,onOpenEmbeddedSurface],
  );
  const surfaceId = root.attrs!.id;
  const setSurfaceIcon = useCallback(
    () => setIconTarget(surfaceId),
    [surfaceId],
  );
  const setPageWidthMode = useCallback(
    (mode: PageWidthMode) => {
      const next = editNode(current.current, surfaceId, (node) => {
        node.attrs = { ...node.attrs, widthMode: mode };
      });
      current.current = next as ContainerDocument;
      onChange?.(next);
    },
    [surfaceId, onChange],
  );
  const wrap = useCallback(
    (kind: "page" | "board") => {
      const next = wrapSurface(current.current, surfaceId, kind);
      current.current = next;
      onChange?.(next);
      focusSurface(
        findSurfaceNode(next, surfaceId)?.parent?.attrs?.id ??
          next.content.attrs!.id,
      );
    },
    [surfaceId, onChange, focusSurface],
  );
  const name =
    root === document.content
      ? document.title || nodeName(root)
      : nodeName(root);
  const kind = surfaceKind(root);
  useEffect(() => {
    if (kind === "board" && inspecting && inspecting !== selected)
      inspect(null);
  }, [kind, selected, inspecting]);
  const controls = useMemo<EditorControls | null>(
    () =>
      onChange && undo && redo
        ? {
            documentId: document.id,
            surfaceId,
            name,
            kind,
            nested: surfaceId !== rootId,
            canUndo,
            canRedo,
            undo,
            redo,
            setIcon: setSurfaceIcon,
            wrap,
            pageWidthMode: root.attrs?.widthMode ?? "standard",
            setPageWidthMode,
            outlineSettings: () => setOutlineSettingsId(surfaceId),
          }
        : null,
    [
      document.id,
      surfaceId,
      name,
      kind,
      rootId,
      canUndo,
      canRedo,
      undo,
      redo,
      setSurfaceIcon,
      wrap,
      root.attrs?.widthMode,
      setPageWidthMode,
      onChange,
    ],
  );
  useLayoutEffect(() => {
    onControlsChange?.(controls);
  }, [onControlsChange, controls]);
  useLayoutEffect(
    () => () => {
      onControlsChange?.(null);
    },
    [onControlsChange],
  );
  useEffect(() => {
    if (expanded && !target) focusSurface(document.content.attrs!.id);
  }, [expanded, !!target]);
  useEffect(() => {
    if (!revealId) return;
    requestReveal(revealId);
    select(revealId);
    const ancestors = paths[revealId] ?? [];
    const owner = [...ancestors]
      .reverse()
      .find((id) => findSurfaceNode(document, id)?.node.type === "surface");
    if (owner) {
      activate(owner);
      expand(owner === document.content.attrs!.id ? null : owner);
    }
    onRevealHandled?.();
  }, [revealId]);
  useEffect(() => {
    if (revealInPlace) {
      select(revealInPlace);
      requestReveal(revealInPlace);
    }
  }, [revealInPlace]);
  const runtime: Runtime = {
    geometry,
    document,
    current,
    commit: (next, group) => {
      const measured = ownSourceValue(geometry.materialize(next));
      current.current = measured as ContainerDocument;
      onChange?.(measured, group);
    },
    readOnly: !onChange,
    printing,
    pageWidthModes,
    selected,
    select,
    inspect,
    expand: focusSurface,
    active,
    activate,
    render: renderContent,
    scrolls: scrolls.current,
    outlines: outlines.current,
    outlineSettings: setOutlineSettingsId,
    revealRequest,
    requestReveal,
    openComponents: (parentId, point, position) =>
      setSlash({ parentId, left: point.x, top: point.y, position }),
  };
  const selectedEntry = inspecting
    ? findSurfaceNode(document, inspecting)
    : undefined;
  const frame = inspecting ? document.layout[inspecting] : undefined;
  const updateFrame = (value: NodeLayout) =>
    runtime.commit(
      transformObjects(runtime.geometry.materialize(current.current), {
        [inspecting!]: value,
      }),
    );
  return (
    <AdditionalComponentsProvider components={loadedComponents}>
      <RegisterComponentContext.Provider
        value={(component) =>
          setLoadedComponents((items) => [...items, component])
        }
      >
        <Context.Provider value={runtime}>
          {outlineSettingsId &&
            !runtime.readOnly &&
            findSurfaceNode(document, outlineSettingsId)?.node.attrs?.kind ===
              "page" && (
              <OutlineSettings
                page={findSurfaceNode(document, outlineSettingsId)!.node}
                onClose={() => setOutlineSettingsId(null)}
                onSave={(config, baseline) => {
                  const target = findSurfaceNode(
                    current.current,
                    outlineSettingsId,
                  )?.node;
                  if (
                    !target ||
                    target.attrs?.kind !== "page" ||
                    JSON.stringify(target.attrs.outline) !== baseline
                  )
                    throw new Error(ot("errorChanged"));
                  runtime.commit(
                    editNode(current.current, outlineSettingsId, (node) => {
                      node.attrs = { ...node.attrs };
                      if (config) node.attrs.outline = config;
                      else delete node.attrs.outline;
                    }),
                  );
                }}
              />
            )}
          {iconTarget && !runtime.readOnly && (
            <PageIconDialog
              value={
                iconTarget === document.content.attrs!.id
                  ? document.icon
                  : (findSurfaceNode(document, iconTarget)?.node.attrs?.icon ??
                    "")
              }
              onClose={() => setIconTarget(null)}
              onSave={async (icon) => {
                const source = current.current;
                if (iconTarget === source.content.attrs!.id)
                  runtime.commit({ ...source, icon });
                else {
                  if (!findSurfaceNode(source, iconTarget))
                    throw new Error(t("error.pageRemoved"));
                  runtime.commit(
                    editNode(source, iconTarget, (node) => {
                      node.attrs = { ...node.attrs, icon };
                    }),
                  );
                }
              }}
            />
          )}
          {slash && (
            <ComponentSlashMenu
              left={slash.left}
              top={slash.top}
              onClose={closeSlash}
              onInsert={(kind, data) => {
                const inserted = insertComponent(
                  current.current,
                  slash.parentId,
                  kind,
                  data,
                );
                if (slash.position)
                  Object.assign(
                    inserted.document.layout[inserted.nodeId],
                    slash.position,
                  );
                runtime.commit(inserted.document);
                select(inserted.nodeId);
                if (!slash.position) requestReveal(inserted.nodeId);
                closeSlash();
              }}
            />
          )}
          <TextSelectionScope
            className="container-workspace"
            data-resource-id={document.id}
            onKeyDown={(event) => {
              if (event.defaultPrevented || event.nativeEvent.isComposing)
                return;
              // A reconstructed text view has a fresh ProseMirror history. The
              // retained surface history still owns edits made before eviction.
              if (
                !runtime.readOnly &&
                (event.metaKey || event.ctrlKey) &&
                !event.altKey &&
                !(event.target as Element).closest("input,textarea,select") &&
                ["z", "y"].includes(event.key.toLowerCase())
              ) {
                const forward =
                  event.shiftKey || event.key.toLowerCase() === "y";
                if (forward ? canRedo && redo : canUndo && undo) {
                  event.preventDefault();
                  event.stopPropagation();
                  if (forward) redo?.();
                  else undo?.();
                  return;
                }
              }
              if (
                event.key === "/" &&
                !event.metaKey &&
                !event.ctrlKey &&
                !event.altKey &&
                !runtime.readOnly &&
                !(event.target as Element).closest(
                  'input,textarea,select,[role="dialog"]',
                ) &&
                (event.target as Element)
                  .closest("[contenteditable]")
                  ?.getAttribute("contenteditable") !== "true"
              ) {
                const element = (event.target as Element).closest<HTMLElement>(
                  "[data-component-container],[data-container-root]",
                );
                const parentId =
                  element?.dataset.componentContainer ??
                  element?.dataset.containerRoot ??
                  active;
                const rect =
                  element?.getBoundingClientRect() ??
                  event.currentTarget.getBoundingClientRect();
                event.preventDefault();
                event.stopPropagation();
                let owner = findSurfaceNode(current.current, parentId);
                while (owner && owner.node.type !== "surface")
                  owner = owner.parent?.attrs?.id
                    ? findSurfaceNode(current.current, owner.parent.attrs.id)
                    : undefined;
                activate(owner?.node.attrs?.id ?? active);
                setSlash({
                  parentId,
                  left: rect.left + 40,
                  top: rect.top + 80,
                });
                return;
              }
              if (
                event.key === "Escape" &&
                !(event.target as Element).closest("input,textarea,select")
              ) {
                if (inspecting) {
                  inspect(null);
                  return;
                }
                if (active !== root.attrs!.id) {
                  activate(root.attrs!.id);
                  return;
                }
                if (chain.length > 1) focusSurface(chain.at(-2)!.attrs!.id);
              }
            }}
          >
            {chain.length > 1 && (
              <div className="container-workspace-bar" data-surface-ui>
                <nav aria-label={t("nav.hierarchy")}>
                  {chain.map((node, index) => (
                    <span key={node.attrs!.id}>
                      {index > 0 && <ChevronRight size={13} />}
                      <button
                        type="button"
                        aria-current={node === root ? "page" : undefined}
                        onClick={() => focusSurface(node.attrs!.id)}
                      >
                        {surfaceKind(node) === "page" ? (
                          <PageIcon
                            value={
                              node === document.content
                                ? document.icon
                                : node.attrs?.icon
                            }
                            size={14}
                          />
                        ) : (
                          <LayoutDashboard size={14} />
                        )}
                        <span>
                          {index === 0
                            ? (!hideTitle && document.title) ||
                              t(
                                surfaceKind(node) === "page"
                                  ? "node.page"
                                  : "node.board",
                              )
                            : nodeName(node)}
                        </span>
                      </button>
                    </span>
                  ))}
                </nav>
                {chain.length > 1 && (
                  <button
                    type="button"
                    onClick={() => focusSurface(chain.at(-2)!.attrs!.id)}
                  >
                    <ArrowLeft size={14} />
                    {t("nav.back")}
                  </button>
                )}
              </div>
            )}
            <div className="container-main">
              <ContainerView
                key={root.attrs!.id}
                node={root}
                root
                header={
                  root === document.content ? (
                    header
                  ) : (
                    <h1>
                      <PageIcon value={root.attrs?.icon} size={32} />{" "}
                      {nodeName(root)}
                    </h1>
                  )
                }
                reading={reading}
                nativeInkBackground={nativeInkBackground}
              />
            </div>
            {selectedEntry && (
              <InspectorOutlet host={inspectorHost}>
                <aside
                  className={`surface-inspector container-inspector${kind === "board" ? " board-bottom-inspector" : ""}`}
                  data-surface-ui
                  aria-label={t("inspector.title")}
                >
                  <header>
                    <strong>
                      {inspectorHost
                        ? t("inspector.currentObject")
                        : t("inspector.title")}
                    </strong>
                    <button
                      type="button"
                      aria-label={t("inspector.close")}
                      onClick={() => inspect(null)}
                    >
                      <X size={16} />
                    </button>
                  </header>
                  <label>
                    {t("inspector.name")}
                    <input
                      aria-label={t("inspector.nameLabel")}
                      value={
                        hasDefaultName(selectedEntry.node)
                          ? nodeName(selectedEntry.node)
                          : (selectedEntry.node.attrs?.name ??
                            nodeName(selectedEntry.node))
                      }
                      maxLength={200}
                      onChange={(event) =>
                        runtime.commit(
                          editNode(current.current, inspecting!, (node) => {
                            node.attrs = {
                              ...node.attrs,
                              name: event.target.value,
                            };
                          }),
                        )
                      }
                    />
                  </label>
                  {selectedEntry.node.type === "surface" && (
                    <button
                      type="button"
                      onClick={() =>
                        setIconTarget(selectedEntry.node.attrs!.id)
                      }
                    >
                      <PageIcon
                        value={selectedEntry.node.attrs?.icon}
                        size={18}
                      />{" "}
                      {t("container.setIcon")}
                    </button>
                  )}
                  {pageWidthModes &&
                    selectedEntry.node.type === "surface" &&
                    surfaceKind(selectedEntry.node) === "page" && (
                      <label>
                        {t("pageWidth")}
                        <PageWidthSwitch
                          value={
                            selectedEntry.node.attrs?.widthMode ?? "standard"
                          }
                          onChange={(mode) =>
                            runtime.commit(
                              editNode(current.current, inspecting!, (node) => {
                                node.attrs = {
                                  ...node.attrs,
                                  widthMode: mode,
                                };
                              }),
                            )
                          }
                        />
                      </label>
                    )}
                  {selectedEntry.node.type === "surface" &&
                    surfaceKind(selectedEntry.node) === "page" && (
                      <label>
                        <input
                          type="checkbox"
                          checked={!!selectedEntry.node.attrs?.frameless}
                          onChange={(event) =>
                            runtime.commit(
                              editNode(current.current, inspecting!, (node) => {
                                node.attrs = {
                                  ...node.attrs,
                                  frameless: event.target.checked,
                                };
                              }),
                            )
                          }
                        />
                        {t("container.frameless")}
                      </label>
                    )}
                  {selectedEntry.node.type === "region" && (
                    <label>
                      {t("inspector.arrange")}
                      <select
                        aria-label={t("inspector.regionLayout")}
                        value={frame?.mode ?? "flow"}
                        onChange={(event) =>
                          updateFrame({
                            ...frame!,
                            mode: event.target.value as NodeLayout["mode"],
                          })
                        }
                      >
                        <option value="flow">{t("layout.flow")}</option>
                        <option value="grid">{t("layout.grid")}</option>
                        <option value="free">{t("layout.free")}</option>
                      </select>
                    </label>
                  )}
                  {frame?.mode === "grid" && (
                    <label>
                      {t("inspector.columns")}
                      <input
                        aria-label={t("inspector.gridColumns")}
                        type="number"
                        min={1}
                        max={12}
                        value={frame.columns ?? 2}
                        onChange={(event) => {
                          const value = Number(event.target.value);
                          if (
                            Number.isInteger(value) &&
                            value >= 1 &&
                            value <= 12
                          )
                            updateFrame({ ...frame, columns: value });
                        }}
                      />
                    </label>
                  )}
                  {frame &&
                    !(
                      selectedEntry.node.type === "drawing" &&
                      selectedEntry.node.attrs?.tool === "arrow"
                    ) && (
                      <>
                        <label>
                          {t("inspector.width")}
                          <input
                            aria-label={t("inspector.moduleWidth")}
                            type="number"
                            min={
                              selectedEntry.node.type === "drawing" ? 1 : 120
                            }
                            max={10000}
                            value={Math.round(frame.width)}
                            onChange={(event) => {
                              const width = Number(event.target.value);
                              if (
                                width >=
                                  (selectedEntry.node.type === "drawing"
                                    ? 1
                                    : 120) &&
                                width <= 10000
                              )
                                updateFrame({ ...frame, width });
                            }}
                          />
                        </label>
                        {selectedEntry.node.type === "surface" && (
                          <>
                            <label>
                              {t("inspector.heightMode")}
                              <select
                                aria-label={t("inspector.moduleHeightMode")}
                                value={frame.heightMode ?? "fixed"}
                                onChange={(event) =>
                                  updateFrame({
                                    ...frame,
                                    heightMode: event.target.value as
                                      "fixed" | "auto",
                                  })
                                }
                              >
                                <option value="fixed">
                                  {t("heightMode.fixed")}
                                </option>
                                {surfaceKind(selectedEntry.node) === "page" && (
                                  <option value="auto">
                                    {t("heightMode.auto")}
                                  </option>
                                )}
                              </select>
                            </label>
                            {frame.heightMode !== "auto" && (
                              <label>
                                {t("inspector.height")}
                                <input
                                  aria-label={t("inspector.moduleHeight")}
                                  type="number"
                                  min={180}
                                  max={5000}
                                  value={frame.height ?? 460}
                                  onChange={(event) => {
                                    const height = Number(event.target.value);
                                    if (height >= 180 && height <= 5000)
                                      updateFrame({ ...frame, height });
                                  }}
                                />
                              </label>
                            )}
                          </>
                        )}
                      </>
                    )}
                  <label>
                    {t("inspector.parent")}
                    <select
                      aria-label={t("inspector.parent")}
                      value={selectedEntry.parent?.attrs?.id ?? ""}
                      onChange={(event) => {
                        const parentId = event.target.value;
                        runtime.commit(
                          moveNode(
                            runtime.geometry.materialize(current.current),
                            inspecting!,
                            parentId,
                            {
                              ...(frame ?? { width: 640 }),
                              x: 0,
                              y: 0,
                            },
                          ),
                        );
                        inspect(null);
                        focusSurface(parentId);
                        requestReveal(inspecting);
                      }}
                    >
                      {containerOptions(document, inspecting!).map((node) => (
                        <option key={node.attrs!.id} value={node.attrs!.id}>
                          {node === document.content
                            ? t("inspector.rootOption", {
                                name: nodeName(node),
                              })
                            : nodeName(node)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="surface-inspector-actions">
                    {[-1, 1].map((delta) => (
                      <button
                        type="button"
                        key={delta}
                        onClick={() => {
                          const entry = findSurfaceNode(
                              current.current,
                              inspecting!,
                            )!,
                            parent = entry.parent!;
                          const index = parent.content!.indexOf(entry.node);
                          const next = moveNode(
                            current.current,
                            inspecting!,
                            parent.attrs?.id,
                            undefined,
                            Math.max(
                              0,
                              Math.min(
                                parent.content!.length - 1,
                                index + delta,
                              ),
                            ),
                          );
                          const newParent = findSurfaceNode(
                            next,
                            parent.attrs!.id,
                          )!.node;
                          const views = next.surfaceViews![parent.attrs!.id];
                          if (views)
                            views.readingOrder = newParent.content!.map(
                              (node) => node.attrs!.id,
                            );
                          runtime.commit(next);
                        }}
                      >
                        {delta < 0
                          ? t("inspector.moveEarlier")
                          : t("inspector.moveLater")}
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      runtime.commit(
                        removeNode(
                          runtime.geometry.materialize(current.current),
                          inspecting!,
                        ),
                      );
                      inspect(null);
                      select(null);
                    }}
                  >
                    {tc("delete")}
                  </button>
                </aside>
              </InspectorOutlet>
            )}
          </TextSelectionScope>
        </Context.Provider>
      </RegisterComponentContext.Provider>
    </AdditionalComponentsProvider>
  );
}
function InspectorOutlet({
  host,
  children,
}: {
  host?: HTMLElement | null;
  children: ReactNode;
}) {
  return host ? createPortal(children, host) : children;
}
function containerOptions(document: ShowDocument, id: string) {
  const excluded = new Set<string>();
  const target = findSurfaceNode(document, id)?.node;
  if (target)
    visitNodes(target, (n) => {
      if (n.attrs?.id) excluded.add(n.attrs.id);
    });
  const result: JSONContent[] = [];
  visitNodes(document.content, (node) => {
    if (
      ["surface", "region"].includes(node.type ?? "") &&
      !excluded.has(node.attrs!.id)
    )
      result.push(node);
  });
  if (target?.type === "drawing")
    return result.filter((node) => {
      let owner: JSONContent | undefined = node;
      while (owner && owner.type !== "surface")
        owner = findSurfaceNode(document, owner.attrs!.id)?.parent ?? undefined;
      return owner?.attrs?.kind === "board";
    });
  return result;
}
function ContainerView({
  node,
  root = false,
  header,
  reading = false,
  nativeInkBackground = false,
}: {
  node: JSONContent;
  root?: boolean;
  header?: ReactNode;
  reading?: boolean;
  nativeInkBackground?: boolean;
}) {
  const t = useTranslator(messages);
  const runtime = useContext(Context),
    id = node.attrs!.id,
    kind = surfaceKind(node),
    readOnly = runtime.readOnly;
  const viewport = useRef<SurfaceHandle>(null),
    page = useRef<HTMLDivElement>(null);
  const pageShell = useRef<HTMLDivElement>(null);
  const [preferences] = useState(readBoardToolPreferences);
  const [tool, setTool] = useState<BoardTool | null>(preferences.tool);
  const [styles, setStyles] = useState(preferences.styles);
  const toolValue=useRef(tool),styleValues=useRef(styles);
  styleValues.current=styles;
  const keyForTool=boardStyleKey;
  useEffect(() => {
    const refresh = () => {const next=readBoardToolPreferences();styleValues.current=next.styles;setStyles(next.styles)};
    const storage = (event:StorageEvent) => {if(event.key===boardToolPreferencesKey || event.key===null)refresh()};
    window.addEventListener(boardToolPreferencesChanged,refresh);
    window.addEventListener("storage",storage);
    return () => {window.removeEventListener(boardToolPreferencesChanged,refresh);window.removeEventListener("storage",storage)};
  }, []);
  const styleKey=keyForTool(tool);
  const style = styles[styleKey];
  const chooseTool = (next: BoardTool | null) => {
    // The native control lane seals and registers the outgoing contact. Its
    // captured/queued ownership is not an ACK and does not force a checkpoint.
    const nativeControlled=viewport.current?.configureNativeInput(next,styleValues.current[keyForTool(next)]);
    const saving = next===toolValue.current||nativeControlled ? undefined:window.showai?.inlineInk?.flush();
    toolValue.current=next;
    runtime.activate(id);
    runtime.select(null);
    runtime.inspect(null);
    setTool(next);
    saveBoardToolPreferences({tool:next});
    return saving;
  };
  const enabled = root || runtime.active === id;
  const viewScope = useContext(EditorViewScope);
  const sharedScrollKey = `showai.page-scroll.v3:${runtime.document.id}:${id}:${root ? "expanded" : "embedded"}`;
  const persistKey = `${sharedScrollKey}${viewScope ? `:${viewScope}` : ""}`;
  const reader = useReaderStateScope();
  const outlineSlot = `outline:${root ? "expanded" : "embedded"}`;
  if (!runtime.outlines.has(persistKey))
    runtime.outlines.set(
      persistKey,
      readOutlineView(reader?.store.read(reader.page, id, outlineSlot)),
    );
  const outlineView = runtime.outlines.get(persistKey)!;
  const scrollTarget = useRef<number | undefined>(undefined);
  // The page is marked while it restores, so components that mount above the
  // view leave the scroll position to the restore (see mount-queue.ts).
  const aimScroll = (target: number | undefined) => {
    scrollTarget.current = target;
    const element = page.current;
    if (!element) return;
    if (target === undefined) delete element.dataset.restoringScroll;
    else element.dataset.restoringScroll = "true";
  };
  useLayoutEffect(() => {
    const element = page.current;
    if (!element) return;
    const captured = readingCapture()?.pageScrolls?.[id];
    if (captured) {
      element.scrollLeft = captured.x;
      element.scrollTop = captured.y;
      return;
    }
    // Another tab, or a tab opened after a restart, starts where this page was last read.
    const saved =
      runtime.scrolls.get(persistKey) ??
      readScroll(persistKey) ??
      readScroll(sharedScrollKey);
    // Content that is still loading cannot reach the saved position yet: keep
    // restoring as it grows, until the reader scrolls or something is revealed.
    aimScroll(saved);
    let restored = element.scrollTop;
    const restore = () => {
      const target = scrollTarget.current;
      if (target === undefined) return;
      element.scrollTop = target;
      restored = element.scrollTop;
      if (Math.abs(restored - target) < 2) aimScroll(undefined);
    };
    restore();
    const growth = new ResizeObserver(restore);
    for (const child of element.children) growth.observe(child);
    const settle = window.setTimeout(
      () => aimScroll(undefined),
      4000,
    );
    const reading = () => aimScroll(undefined);
    const inputs = ["wheel", "touchstart", "pointerdown", "keydown"] as const;
    for (const type of inputs)
      element.addEventListener(type, reading, { passive: true });
    let timer = 0;
    const remember = () => {
      clearTimeout(timer);
      timer = 0;
      const top = scrollTarget.current ?? element.scrollTop;
      runtime.scrolls.set(persistKey, top);
      writeScroll(persistKey, top);
      writeScroll(sharedScrollKey, top);
    };
    // Written after scrolling pauses, so quitting the App keeps the position.
    const scrolled = () => {
      // A scroll the restore did not make, such as following a link, wins.
      if (Math.abs(element.scrollTop - restored) > 2)
        aimScroll(undefined);
      clearTimeout(timer);
      timer = window.setTimeout(remember, 500);
    };
    element.addEventListener("scroll", scrolled, { passive: true });
    window.addEventListener("pagehide", remember);
    return () => {
      growth.disconnect();
      clearTimeout(settle);
      for (const type of inputs) element.removeEventListener(type, reading);
      element.removeEventListener("scroll", scrolled);
      window.removeEventListener("pagehide", remember);
      remember();
      aimScroll(undefined);
    };
  }, [persistKey]);
  useLayoutEffect(() => {
    if (!runtime.printing && page.current && runtime.scrolls.has(persistKey))
      page.current.scrollTop = runtime.scrolls.get(persistKey)!;
  }, [runtime.printing, persistKey]);
  useEffect(() => {
    const target = runtime.revealRequest;
    if (!target) return;
    const path = nodePaths(runtime.current.current)[target] ?? [];
    const owner = [...path]
      .reverse()
      .find(
        (parent) =>
          findSurfaceNode(runtime.current.current, parent)?.node.type ===
          "surface",
      );
    if (owner !== id) return;
    aimScroll(undefined);
    if (kind === "board" && !reading) viewport.current?.reveal(target);
    else
      requestAnimationFrame(() =>
        page.current
          ?.querySelector(
            `[data-surface-id="${CSS.escape(target)}"],[data-block-id="${CSS.escape(target)}"]`,
          )
          ?.scrollIntoView({ block: "nearest" }),
      );
    runtime.requestReveal(null);
  }, [runtime.revealRequest]);
  const actions = useMemo<ObjectActions>(
    () => ({
      geometry: runtime.geometry,
      scale: 1,
      selected: runtime.selected,
      select: runtime.select,
      inspect: runtime.inspect,
      expand: runtime.expand,
      readOnly,
      revealAll: kind === "page" || reading,
      revealed: new Set(),
      move: readOnly
        ? undefined
        : (nodeId, frame) =>
            runtime.commit(
              transformObjects(
                runtime.geometry.materialize(runtime.current.current),
                { [nodeId]: frame },
              ),
            ),
      remove: readOnly
        ? undefined
        : (nodeId) => {
            runtime.commit(
              removeNode(
                runtime.geometry.materialize(runtime.current.current),
                nodeId,
              ),
            );
            runtime.select(null);
          },
    }),
    [runtime, readOnly, kind, reading],
  );
  // Local tool/style state must not broadcast a new object context. These
  // handlers capture the actual runtime and are renewed on document, selection
  // or permission context changes; mutations still read its current source.
  const transformObjectFrames = useCallback(
    (frames: Record<string, NodeLayout>, group?: string) =>
      runtime.commit(
        transformObjects(
          runtime.geometry.materialize(runtime.current.current),
          frames,
        ),
        group,
      ),
    [runtime],
  );
  const connectObject = useCallback<NonNullable<ObjectActions["connect"]>>(
    (nodeId, endpoint, point) => {
      const source = runtime.geometry.materialize(runtime.current.current),
        entry = findSurfaceNode(source, nodeId);
      if (!entry || !source.layout[nodeId]) return;
      const endpoints = arrowEndpoints(entry.node, source.layout[nodeId]);
      endpoints[endpoint === "start" ? 0 : 1] = point;
      const bindings = { ...entry.node.attrs?.bindings };
      const binding = bindingAtPoint(
        source,
        entry.parent!.attrs!.id,
        point,
        8 / (viewport.current?.scale() ?? 1),
      );
      if (binding) bindings[endpoint] = binding;
      else delete bindings[endpoint];
      const resolved = arrowFromEndpoints(
        entry.node,
        source.layout[nodeId],
        endpoints,
        bindings,
      );
      runtime.commit(
        editNode(
          {
            ...source,
            layout: { ...source.layout, [nodeId]: resolved.frame },
          },
          nodeId,
          (node) => {
            node.attrs = resolved.node.attrs;
          },
        ),
      );
    },
    [runtime],
  );
  const setObjectLabel = useCallback<NonNullable<ObjectActions["setLabel"]>>(
    (nodeId, label, minHeight) => {
      let next = runtime.geometry.materialize(runtime.current.current);
      const frame = next.layout?.[nodeId];
      if (minHeight && frame && minHeight > (frame.height ?? 0))
        next = transformObjects(next, {
          [nodeId]: { ...frame, height: minHeight },
        });
      next = editNode(next, nodeId, (node) => {
        if (label) node.attrs = { ...node.attrs, label };
        else delete node.attrs!.label;
      }) as ContainerDocument;
      runtime.commit(next);
    },
    [runtime],
  );
  // A borderless Page blends into its Board: no frame and no title line.
  const heading =
    header ??
    (!root && !node.attrs?.frameless ? (
      <h2>
        <PageIcon value={node.attrs?.icon} size={24} /> {nodeName(node)}
      </h2>
    ) : undefined);
  const renderSurface = useCallback(
    (child: JSONContent) => <ContainerView node={child} />,
    [],
  );
  if (root && nativeInkBackground && readOnly && kind === "board")
    return (
      <ObjectContext.Provider value={{ ...actions, revealAll: true }}>
        <div className="native-ink-background">
          <div className="native-ink-world" data-native-ink-world>
            <SurfaceContent
              document={runtime.document}
              container={node}
              spatial
              renderContent={runtime.render}
              renderSurface={renderSurface}
            />
          </div>
        </div>
      </ObjectContext.Provider>
    );
  if (kind === "page" || reading)
    return (
      <ObjectContext.Provider value={actions}>
        <div className="page-outline-shell" ref={pageShell}>
          <div
            ref={page}
            className={`container-page${root ? " is-root" : ""}${reading ? " is-reading-projection" : ""}`}
            data-container-root={id}
            data-frameless={node.attrs?.frameless || undefined}
            data-width-mode={
              (runtime.pageWidthModes || node.attrs?.outline?.enabled) &&
              kind === "page"
                ? (node.attrs?.widthMode ?? "standard")
                : undefined
            }
            data-input-surface={id}
            aria-label={t("node.pageLabel", { name: nodeName(node) })}
            onScroll={(event) => {
              if (!runtime.printing && !matchMedia("print").matches)
                runtime.scrolls.set(persistKey, event.currentTarget.scrollTop);
            }}
            onPointerDownCapture={(event) => {
              if (
                (event.target as Element).closest("[data-container-root]") ===
                event.currentTarget
              )
                runtime.activate(id);
            }}
          >
            <div className="container-page-column">
              {heading && (
                <div className="container-page-heading">{heading}</div>
              )}
              {kind === "page" && <PageOutlinePrint page={node} />}
              <SurfaceContent
                document={runtime.document}
                container={node}
                spatial={!reading}
                renderContent={runtime.render}
                renderSurface={renderSurface}
              />
            </div>
          </div>
          {kind === "page" && !runtime.printing && (
            <PageOutline
              page={node}
              documentId={runtime.document.id}
              scroll={page}
              shell={pageShell}
              view={outlineView}
              onViewChange={(view) =>
                reader?.store.write(reader.page, id, outlineSlot, {
                  ...view,
                })
              }
              onSettings={
                readOnly ? undefined : () => runtime.outlineSettings(id)
              }
            />
          )}
        </div>
      </ObjectContext.Provider>
    );
  return (
    <div
      className={`container-board${root ? " is-root" : ""}${enabled ? " is-active" : ""}`}
      data-container-root={id}
      aria-label={t("node.boardLabel", { name: nodeName(node) })}
      onPointerDownCapture={(event) => {
        if (
          (event.target as Element).closest("[data-container-root]") ===
          event.currentTarget
        )
          runtime.activate(id);
      }}
    >
      <div className="container-board-scene">
        <PageSurface
          embedded={!root}
          geometry={runtime.geometry}
          boardDocument={runtime.document}
          containerId={id}
          onTransform={readOnly ? undefined : transformObjectFrames}
          onDuplicate={
            readOnly
              ? undefined
              : (ids, offset) => {
                  const copied = duplicateObjects(
                    runtime.geometry.materialize(runtime.current.current),
                    ids,
                    offset,
                  );
                  runtime.commit(copied.document);
                  runtime.select(copied.ids[0] ?? null);
                  return copied.ids;
                }
          }
          onCopyObjects={(ids) =>
            copyObjects(
              runtime.geometry.materialize(runtime.current.current),
              ids,
            )
          }
          onPasteObjects={
            readOnly
              ? undefined
              : (paste, point) => {
                  const source = runtime.geometry.materialize(
                    runtime.current.current,
                  );
                  if ("text" in paste) {
                    const inserted = insertComponent(source, id, "text", {
                      format: "richtext",
                      content: {
                        type: "doc",
                        content: paste.text
                          .split(/\r?\n/)
                          .slice(0, 500)
                          .map((line) => ({
                            type: "paragraph",
                            ...(line
                              ? { content: [{ type: "text", text: line }] }
                              : {}),
                          })),
                      },
                    });
                    Object.assign(inserted.document.layout[inserted.nodeId], {
                      width: boardTextWidth,
                      ...point,
                    });
                    runtime.commit(inserted.document);
                    runtime.select(inserted.nodeId);
                    return [inserted.nodeId];
                  }
                  const roots = paste.clip.nodes
                    .map((node) => paste.clip.layout[node.attrs!.id])
                    .filter(Boolean);
                  // Paste centers the copy under the pointer when it is over
                  // the Board; otherwise it lands slightly offset.
                  const offset =
                    point && roots.length
                      ? {
                          x:
                            point.x -
                            (Math.min(...roots.map((f) => f.x)) +
                              Math.max(...roots.map((f) => f.x + f.width))) /
                              2,
                          y: point.y - Math.min(...roots.map((f) => f.y)),
                        }
                      : { x: 24, y: 24 };
                  const pasted = pasteObjects(source, id, paste.clip, offset);
                  runtime.commit(pasted.document);
                  runtime.select(pasted.ids[0] ?? null);
                  return pasted.ids;
                }
          }
          onReorder={
            readOnly
              ? undefined
              : (ids, order) =>
                  runtime.commit(
                    reorderObjects(
                      runtime.geometry.materialize(runtime.current.current),
                      ids,
                      order,
                    ),
                  )
          }
          onGroup={
            readOnly
              ? undefined
              : (ids, bounds, offset) => {
                  const grouped = groupObjects(
                    runtime.geometry.materialize(runtime.current.current),
                    ids,
                    bounds,
                    offset,
                  );
                  if (!grouped) return null;
                  runtime.commit(grouped.document);
                  runtime.select(grouped.id);
                  return grouped.id;
                }
          }
          onUngroup={
            readOnly
              ? undefined
              : (regionId, offset) => {
                  const result = ungroupRegion(
                    runtime.geometry.materialize(runtime.current.current),
                    regionId,
                    offset,
                  );
                  if (!result) return [];
                  runtime.commit(result.document);
                  runtime.select(result.ids[0] ?? null);
                  return result.ids;
                }
          }
          onLock={
            readOnly
              ? undefined
              : (ids, locked) =>
                  runtime.commit(
                    setObjectsLocked(
                      runtime.geometry.materialize(runtime.current.current),
                      ids,
                      locked,
                    ),
                  )
          }
          onDeleteSelection={
            readOnly
              ? undefined
              : (ids) =>
                  runtime.commit(
                    removeObjects(
                      runtime.geometry.materialize(runtime.current.current),
                      ids,
                    ),
                  )
          }
          ref={viewport}
          pageId={`${runtime.document.id}:${id}:${root ? "expanded" : "embedded"}`}
          enabled
          printing={runtime.printing}
          nodes={resourceNodes(runtime.document, node).map((child) => ({
            id: child.attrs!.id,
            name: nodeName(child),
          }))}
          layoutKey={runtime.document.layout}
          paths={nodePaths({ ...runtime.document, content: node })}
          views={surfaceViews(runtime.document, node)}
          header={root ? heading : undefined}
          selected={runtime.selected}
          onSelect={runtime.select}
          onInspect={runtime.inspect}
          onExpand={runtime.expand}
          onMove={actions.move}
          onConnect={readOnly ? undefined : connectObject}
          onRemove={actions.remove}
          onViews={
            readOnly
              ? undefined
              : (views) =>
                  runtime.commit({
                    ...runtime.current.current,
                    surfaceViews: {
                      ...runtime.current.current.surfaceViews,
                      [id]: views,
                    },
                  })
          }
          drawTool={tool}
          drawColor={style.color}
          drawFillColor={style.fillColor}
          drawStrokeWidth={style.strokeWidth}
          drawPressure={style.pressure !== false}
          onStyleChange={(ids, patch) => {
            const drawings = ids.filter(
              (nodeId) => isEditableDrawing(findSurfaceNode(runtime.current.current,nodeId)?.node),
            );
            // A current selection takes precedence over the active drawing tool.
            if (!drawings.length) {
              const key=keyForTool(toolValue.current),next={...styleValues.current,[key]:{...styleValues.current[key],...patch}};
              styleValues.current=next;
              viewport.current?.configureNativeInput(toolValue.current,next[key]);
              setStyles(next);
              saveBoardToolPreferences({style:{key,patch}});
              return;
            }
            let next = runtime.current.current;
            for (const nodeId of drawings)
              next = editNode(next, nodeId, (node) => {
                const applicable = { ...patch };
                if (!["rectangle", "ellipse"].includes(node.attrs!.tool))
                  delete applicable.fillColor;
                if (!labelCapable(node)) delete applicable.labelSize;
                node.attrs = { ...node.attrs, ...applicable };
              }) as ContainerDocument;
            // A larger label grows its shape in the same step when it no longer fits.
            if (patch.labelSize !== undefined) {
              const grown: Record<string, NodeLayout> = {};
              for (const nodeId of drawings) {
                const node = findSurfaceNode(next, nodeId)?.node,
                  frame = next.layout?.[nodeId];
                if (
                  !node?.attrs?.label ||
                  !frame ||
                  node.attrs.tool === "arrow" ||
                  !labelCapable(node)
                )
                  continue;
                const needed = labelFitHeight(
                  node.attrs.tool,
                  node.attrs.label,
                  patch.labelSize,
                  frame.width,
                  node.attrs.strokeWidth,
                );
                if (needed > (frame.height ?? 0))
                  grown[nodeId] = { ...frame, height: needed };
              }
              if (Object.keys(grown).length)
                next = transformObjects(next, grown) as ContainerDocument;
            }
            // Dragging a slider or color picker is one undo step.
            runtime.commit(next, `style:${[...drawings].sort().join(",")}`);
          }}
          onLabel={readOnly ? undefined : setObjectLabel}
          onTidy={
            readOnly
              ? undefined
              : (ids, direction) => {
                  const source = runtime.geometry.materialize(
                    runtime.current.current,
                  );
                  const tidy = tidyFrames(source, ids, direction);
                  if (!tidy) return;
                  let next = transformObjects(source, tidy.frames);
                  for (const [arrowId, anchors] of Object.entries(tidy.anchors))
                    next = editNode(next, arrowId, (node) => {
                      const bindings = node.attrs!.bindings;
                      node.attrs!.bindings = {
                        start: { ...bindings.start, anchor: anchors.start },
                        end: { ...bindings.end, anchor: anchors.end },
                      };
                    }) as ContainerDocument;
                  runtime.commit(reconcileConnections({ ...next }));
                }
          }
          onAddComponent={
            readOnly
              ? undefined
              : (kind, point) => {
                  const inserted = insertComponent(
                    runtime.current.current,
                    id,
                    kind,
                    kind === "text"
                      ? {
                          format: "richtext",
                          content: {
                            type: "doc",
                            content: [{ type: "paragraph" }],
                          },
                        }
                      : {},
                  );
                  Object.assign(
                    inserted.document.layout[inserted.nodeId],
                    kind === "text" ? { width: boardTextWidth } : {},
                    point,
                  );
                  runtime.commit(inserted.document);
                  runtime.select(inserted.nodeId);
                  chooseTool(null);
                  return inserted.nodeId;
                }
          }
          onOpenComponents={
            readOnly
              ? undefined
              : (point, position) => runtime.openComponents(id, point, position)
          }
          onDrawExit={() => chooseTool(null)}
          onToolChange={chooseTool}
          onDraw={
            readOnly
              ? undefined
              : (drawing, frame, adopt) => {
                  if (drawing.attrs?.tool === "arrow") {
                    const endpoints = arrowEndpoints(drawing, frame);
                    const start = bindingAtPoint(
                      runtime.geometry.materialize(runtime.current.current),
                      id,
                      endpoints[0],
                      8 / (viewport.current?.scale() ?? 1),
                    );
                    const end = bindingAtPoint(
                      runtime.geometry.materialize(runtime.current.current),
                      id,
                      endpoints[1],
                      8 / (viewport.current?.scale() ?? 1),
                    );
                    if (start || end)
                      drawing.attrs.bindings = {
                        ...(start ? { start } : {}),
                        ...(end ? { end } : {}),
                      };
                  }
                  let next = addNode(
                    runtime.current.current,
                    drawing,
                    frame,
                    id,
                  );
                  if (adopt)
                    next = adoptIntoRegion(
                      next,
                      drawing.attrs!.id,
                      adopt.ids,
                      adopt.offset,
                    );
                  runtime.commit(next);
                  // Keep drawing: the tool stays active and the next stroke
                  // must not grab what was just drawn.
                  runtime.select(null);
                }
          }
          extraActions={
            <>
              {!readOnly && (
                <>
                  <span className="surface-toolbar-divider" />
                  <BoardTools tool={tool} onChange={chooseTool} />
                </>
              )}
            </>
          }
        >
          <SurfaceContent
            document={runtime.document}
            container={node}
            renderContent={runtime.render}
            renderSurface={renderSurface}
          />
        </PageSurface>
      </div>
    </div>
  );
}

/** A saved outline view, keeping only the fields it still understands. */
function readOutlineView(value: unknown): OutlineViewState {
  if (!isRecord(value)) return {};
  return {
    ...(isFlag(value.expanded) ? { expanded: value.expanded } : {}),
    ...(isFlag(value.pinned) ? { pinned: value.pinned } : {}),
    ...(isStringList(value.branches) ? { branches: value.branches } : {}),
  };
}
function readScroll(key: string) {
  try {
    const saved = localStorage.getItem(key);
    const value = saved === null ? NaN : Number(saved);
    return Number.isFinite(value) ? value : undefined;
  } catch {
    return undefined;
  }
}
function writeScroll(key: string, value: number) {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    /* Personal view storage may be unavailable in an opaque inline host. */
  }
}
