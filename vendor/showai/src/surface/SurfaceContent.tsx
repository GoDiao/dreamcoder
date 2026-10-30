import {usePreparedCubic} from "./PortableCubicContext";
import {
  inkArchiveGroup,
  inkArchiveGroupLayout,
} from "./ink-archive-group.mjs";
import { useConnectionGeometry } from "./useConnectionGeometry";
import { objectCapabilities } from "./geometry.mjs";
import { Drawing } from "./Drawing";
import { isResource, resourceNodes, surfaceKind } from "./containers.mjs";
import {
  memo,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type CSSProperties,
} from "react";
import type { JSONContent } from "@tiptap/core";
import type { ShowDocument } from "../types";
import { ObjectContext, SurfaceObject } from "./SurfaceObject";
import { orderedSurfaceNodes } from "./document.mjs";
import { translator } from "../i18n";
import { useTranslator } from "../i18n/react";
import messages from "../i18n/messages/surface";

const translate = translator(messages);

/**
 * Containers are saved with the untranslated default name "Page" or "Board"
 * (containers.mjs); the interface shows those as the localized kind instead.
 */
export function hasDefaultName(node: JSONContent) {
  return (
    node.type === "surface" &&
    (node.attrs?.name === "Page" || node.attrs?.name === "Board")
  );
}

export function nodeName(node: JSONContent) {
  const t = translate;
  return String(
    (!hasDefaultName(node) && node.attrs?.name) ||
      node.attrs?.data?.title ||
      (
        {
          region: t("node.region"),
          surface: t(node.attrs?.kind === "board" ? "node.board" : "node.page"),
          drawing: t("node.drawing"),
          richText: t("node.text"),
          image: t("node.image"),
          paragraph: t("node.text"),
          heading: t("node.heading"),
          table: t("node.table"),
          widget: node.attrs?.kind || t("node.component"),
        } as Record<string, string>
      )[node.type ?? ""] ||
      t("node.content"),
  );
}
export interface ContentRenderProps {
  content: JSONContent;
  parentId: string;
  ids: string[];
  kind: "children" | "single";
  componentData?: Record<string, unknown>;
  renderModule?: (node: JSONContent) => ReactNode;
}
export type ContentRenderer = (props: ContentRenderProps) => ReactNode;

function FreeLayout({
  children,
  minHeight = 160,
}: {
  children: ReactNode;
  minHeight?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(minHeight);
  useEffect(() => {
    const root = ref.current!;
    const measure = () =>
      setHeight(
        Math.max(
          minHeight,
          ...[...root.children]
            .filter(
              (child) =>
                child instanceof HTMLElement &&
                child.hasAttribute("data-surface-id"),
            )
            .map(
              (child) =>
                (child as HTMLElement).offsetTop +
                (child as HTMLElement).offsetHeight +
                24,
            ),
        ),
      );
    const observer = new ResizeObserver(measure);
    for (const child of root.children)
      if (child instanceof HTMLElement && child.hasAttribute("data-surface-id"))
        observer.observe(child);
    measure();
    return () => observer.disconnect();
  }, [children, minHeight]);
  return (
    <div
      className="surface-layout-free"
      ref={ref}
      style={
        { minHeight: height, "--free-height": `${height}px` } as CSSProperties
      }
    >
      {children}
    </div>
  );
}

const ContentNode = memo(
  function RenderNode({
    node: sourceNode,
    document,
    positioned,
    renderContent,
    spatial = true,
    renderSurface,
  }: {
    node: JSONContent;
    document: ShowDocument;
    positioned: boolean;
    renderContent: ContentRenderer;
    spatial?: boolean;
    renderSurface?: (node: JSONContent) => ReactNode;
  }) {
    const actions = useContext(ObjectContext);
    const observed = useConnectionGeometry(
      sourceNode,
      document,
      actions.nativeScene?undefined:actions.geometry,
    );
    const ink=sourceNode.attrs?.ink;
    const prepared=usePreparedCubic(ink?.format==='showai-ink-v2'?ink:undefined,sourceNode.attrs?.strokeWidth??ink?.width??1,sourceNode.attrs?.pressure??ink?.brush!=="monoline",!!actions.nativeScene);
    // Keep this strong reference for the mounted reader even if the bounded
    // shared cache evicts its LRU entry.
    const heldGeometry=useRef(prepared.held);if(prepared.held)heldGeometry.current=prepared.held;
    const lastPaint=useRef<JSONContent|undefined>(undefined);
    if(prepared.ready)lastPaint.current=observed.node;
    // Keep the last real vector presentation while a new width/source suffix
    // is being prepared. Canonical data and the current pose stay independent;
    // an asynchronous style edit must not briefly erase the visible stroke.
    const node=prepared.ready?observed.node:lastPaint.current??observed.node,frame=observed.frame;
    const id = node.attrs!.id;
    const inkData = node.attrs?.nativeInk ?? node.attrs?.data?.nativeInk;
    const nativeInk = !!inkData;
    // Keep stored native widgets intact while sharing the drawing's chrome.
    const drawingNode: JSONContent | undefined =
      node.type === "drawing"
        ? node
        : nativeInk
          ? {
              type: "drawing",
              attrs: {
                id,
                name: node.attrs!.name,
                tool: "pen",
                color: "#252629",
                strokeWidth: 2.5,
                extent: inkData.extent,
                points: [
                  { x: 0, y: 0 },
                  {
                    x: inkData.extent[0],
                    y: inkData.extent[1],
                  },
                ],
                ink: inkData,
              },
            }
          : undefined;
    let body: ReactNode;
    if (node.type === "surface") body = renderSurface?.(node);
    else if (drawingNode) body = <Drawing node={drawingNode} frame={frame} />;
    else if (node.type === "region") {
      const mode = frame?.mode ?? "flow",
        children = node.content ?? [];
      if (inkArchiveGroup(node)) {
        const local = inkArchiveGroupLayout(inkArchiveGroup(node)!, frame!);
        body = (
          <div
            className="surface-layout-free ink-archive-local-space"
            style={{
              width: local.width,
              height: local.height,
              transform: `scale(${local.scaleX},${local.scaleY})`,
              transformOrigin: "0 0",
            }}
          >
            {children.map((child) => (
              <ContentNode
                key={child.attrs!.id}
                node={child}
                document={document}
                positioned
                spatial={spatial}
                renderContent={renderContent}
                renderSurface={renderSurface}
              />
            ))}
          </div>
        );
      } else if (mode === "flow") {
        const groups: (JSONContent[] | JSONContent)[] = [];
        for (const child of children) {
          if (
            ["region", "richText", "surface", "drawing"].includes(
              child.type ?? "",
            )
          )
            groups.push(child);
          else {
            const previous = groups.at(-1);
            if (Array.isArray(previous)) previous.push(child);
            else groups.push([child]);
          }
        }
        if (
          !groups.length ||
          (!actions.readOnly && !Array.isArray(groups.at(-1)))
        )
          groups.push([]);
        body = (
          <div className="surface-layout-flow">
            {groups.map((group, index) =>
              Array.isArray(group) ? (
                <div key={`flow-${index}`}>
                  {renderContent({
                    content: { type: "doc", content: group },
                    parentId: id,
                    ids: group.map((item) => item.attrs?.id),
                    kind: "children",
                  })}
                </div>
              ) : (
                <ContentNode
                  key={group.attrs!.id}
                  node={group}
                  document={document}
                  positioned={false}
                  spatial={spatial}
                  renderContent={renderContent}
                  renderSurface={renderSurface}
                />
              ),
            )}
          </div>
        );
      } else {
        const empty = !children.length ? <AddToRegion id={id} /> : null;
        const items = children.map((child) => (
          <ContentNode
            key={child.attrs!.id}
            node={child}
            document={document}
            positioned={spatial && mode === "free"}
            spatial={spatial}
            renderContent={renderContent}
            renderSurface={renderSurface}
          />
        ));
        body =
          mode === "grid" ? (
            <div
              className="surface-layout-grid"
              style={{
                gridTemplateColumns: `repeat(${frame?.columns ?? 2}, minmax(0, 1fr))`,
                gap: frame?.gap ?? 24,
              }}
            >
              {items}
              {empty}
            </div>
          ) : spatial ? (
            <FreeLayout minHeight={frame?.height ?? 200}>
              {items}
              {empty}
            </FreeLayout>
          ) : (
            <div className="surface-layout-flow">{items}</div>
          );
      }
    } else if (node.type === "richText")
      body = renderContent({
        content: { type: "doc", content: node.content ?? [] },
        componentData: node.attrs?.data,
        parentId: id,
        ids: (node.content ?? []).map((child) => child.attrs?.id),
        kind: "children",
      });
    else
      body = renderContent({
        content: { type: "doc", content: [node] },
        parentId: id,
        ids: [id],
        kind: "single",
      });
    if (
      !positioned &&
      (node.type === "richText" ||
        (node.type === "region" && (frame?.mode ?? "flow") === "flow"))
    )
      return (
        <div className="page-document-flow" data-surface-id={id}>
          {body}
        </div>
      );
    if(!prepared.ready&&!lastPaint.current)return <div data-surface-id={id} data-cubic-pending="true" style={positioned&&frame?{position:"absolute",left:frame.x,top:frame.y,width:frame.width,height:frame.height}:undefined}/>;
    return (
      <SurfaceObject
        id={id}
        rotatable={objectCapabilities(node).rotate}
        resizable={!(node.type === "drawing" && node.attrs?.tool === "arrow")}
        name={nodeName(node)}
        positioned={positioned}
        region={node.type === "region"}
        archiveGroup={!!inkArchiveGroup(node)}
        container={node.type === "surface"}
        drawing={node.type === "drawing" || nativeInk}
        component={node.type === "widget"}
        drawingNode={drawingNode}
        fixedHeight={
          (node.type === "surface" &&
            (surfaceKind(node) === "board" || frame?.heightMode !== "auto")) ||
          node.type === "drawing" ||
          nativeInk ||
          (node.type === "region" && frame?.mode === "free" && !!frame.height)
        }
        frame={frame}
      >
        {body}
      </SurfaceObject>
    );
  },
  (before, after) => {
    if (
      before.node !== after.node ||
      before.positioned !== after.positioned ||
      before.spatial !== after.spatial ||
      before.renderSurface !== after.renderSurface ||
      before.renderContent !== after.renderContent
    )
      return false;
    const sameFrames = (node: JSONContent): boolean =>
      before.document.layout?.[node.attrs?.id] ===
        after.document.layout?.[node.attrs?.id] &&
      (node.type !== "region" || (node.content ?? []).every(sameFrames));
    return sameFrames(after.node);
  },
);
function AddToRegion({ id }: { id: string }) {
  const t = useTranslator(messages);
  const actions = useContext(ObjectContext);
  return actions.readOnly ? null : (
    <div
      tabIndex={0}
      className="surface-empty-region"
      data-component-container={id}
      aria-label={t("region.empty")}
    >
      {t("region.emptyHint")}
    </div>
  );
}

export function SurfaceContent({
  document,
  renderContent,
  spatial = true,
  container = document.content,
  renderSurface,
}: {
  document: ShowDocument;
  renderContent: ContentRenderer;
  spatial?: boolean;
  container?: JSONContent;
  renderSurface?: (node: JSONContent) => ReactNode;
}) {
  const actions = useContext(ObjectContext);
  if (
    isResource(document) &&
    container.type === "surface" &&
    surfaceKind(container) === "page"
  ) {
    if (!actions.readOnly)
      return (
        <div className="surface-layout-flow page-continuous-content">
          {renderContent({
            content: { type: "doc", content: container.content ?? [] },
            parentId: container.attrs!.id,
            ids: (container.content ?? []).map((node) => node.attrs!.id),
            kind: "children",
            renderModule: (node) => (
              <ContentNode
                node={node}
                document={document}
                positioned={false}
                spatial={spatial}
                renderContent={renderContent}
                renderSurface={renderSurface}
              />
            ),
          })}
        </div>
      );
    const groups: (JSONContent[] | JSONContent)[] = [];
    for (const node of container.content ?? []) {
      if (
        ["region", "richText", "surface", "drawing"].includes(node.type ?? "")
      )
        groups.push(node);
      else {
        const last = groups.at(-1);
        if (Array.isArray(last)) last.push(node);
        else groups.push([node]);
      }
    }
    if (!groups.length || (!actions.readOnly && !Array.isArray(groups.at(-1))))
      groups.push([]);
    return (
      <div className="surface-layout-flow">
        {groups.map((group, index) =>
          Array.isArray(group) ? (
            <div key={`flow-${index}`}>
              {renderContent({
                content: { type: "doc", content: group },
                parentId: container.attrs!.id,
                ids: group.map((node) => node.attrs!.id),
                kind: "children",
              })}
            </div>
          ) : (
            <ContentNode
              key={group.attrs!.id}
              node={group}
              document={document}
              positioned={false}
              spatial={spatial}
              renderContent={renderContent}
              renderSurface={renderSurface}
            />
          ),
        )}
      </div>
    );
  }
  const nodes = isResource(document)
    ? resourceNodes(document, container)
    : orderedSurfaceNodes(document);
  return (
    <>
      {nodes.map((node) => (
        <ContentNode
          key={node.attrs!.id}
          node={node}
          document={document}
          positioned={spatial}
          spatial={spatial}
          renderContent={renderContent}
          renderSurface={renderSurface}
        />
      ))}
    </>
  );
}
