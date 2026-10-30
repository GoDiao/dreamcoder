import { useEffect, useRef } from "react";
import type { RefObject } from "react";
import type { ShowDocument } from "../types";
import { findSurfaceNode } from "./document.mjs";
import { inkNodes } from "./inline-ink";
import { inkUIRegions } from "./ink-ui-regions";
import type { InkCommand } from "./inline-ink";
import type { Camera } from "./model";
import { useNativeBoard, type NativeBoardOptions } from "./useNativeBoard";

/** WebKit's SVG screen matrix omits ancestor CSS scales. Read the CSS basis
 * and locate its transformed border box, including rotated/nested objects. */
function clientMatrix(element: Element, width: number, height: number) {
  let matrix = new DOMMatrix();
  for (
    let parent: Element | null = element;
    parent;
    parent = parent.parentElement
  ) {
    const transform = getComputedStyle(parent).transform;
    if (transform === "none") continue;
    const m = new DOMMatrix(transform);
    matrix = new DOMMatrix([m.a, m.b, m.c, m.d, 0, 0]).multiply(matrix);
  }
  const rect = element.getBoundingClientRect();
  matrix.e =
    rect.left -
    Math.min(
      0,
      matrix.a * width,
      matrix.c * height,
      matrix.a * width + matrix.c * height,
    );
  matrix.f =
    rect.top -
    Math.min(
      0,
      matrix.b * width,
      matrix.d * height,
      matrix.b * width + matrix.d * height,
    );
  return matrix;
}
function inkMatrix(element: SVGSVGElement) {
  const style = getComputedStyle(element),
    box = element.viewBox.baseVal;
  const width = parseFloat(style.width),
    height = parseFloat(style.height);
  if (!(width > 0 && height > 0 && box.width > 0 && box.height > 0)) return;
  return clientMatrix(element, width, height)
    .scale(width / box.width, height / box.height)
    .translate(-box.x, -box.y);
}
const values = (m: DOMMatrix) =>
  [m.a, m.b, m.c, m.d, m.e, m.f].map((n) => Math.round(n * 1e6) / 1e6);
export function useInlineInk({
  root,
  world,
  camera: viewCamera,
  document: source,
  boardId,
  tool,
  color,
  width,
  pressure,
  ruler,
  enabled,
  onCamera,
  onTool,
  onShapeGesture,
  onClearSelection,
  selection,
  onSelection,
  onLayout,
  onDrawing,
  onActivate,
  fillColor,
  control,
}: {
  root: RefObject<HTMLDivElement | null>;
  world: RefObject<HTMLDivElement | null>;
  camera: RefObject<Camera>;
  document?: ShowDocument;
  boardId: string;
  tool: string | null | undefined;
  color: string;
  width: number;
  pressure: boolean;
  ruler: boolean;
  enabled: boolean;
  onCamera: (
    camera: { x: number; y: number; scale: number },
    final: boolean,
  ) => void;
  onTool: (tool: string) => void;
  onClearSelection: () => void;
  onShapeGesture: (value: NonNullable<InkCommand["shapeGesture"]>) => void;
  selection?: NativeBoardOptions["selection"];
  onSelection?: NativeBoardOptions["onSelection"];
  onLayout?: NativeBoardOptions["onLayout"];
  onDrawing?: NativeBoardOptions["onDrawing"];
  onActivate?: NativeBoardOptions["onActivate"];
  fillColor?: string;
  control?:NativeBoardOptions["control"];
}) {
  const nativeScene=useNativeBoard({root,world,camera:viewCamera,document:source,boardId,tool,color,width,pressure,ruler,enabled,
    onCamera,onTool,onClearSelection,selection,onSelection,onLayout,onDrawing,onActivate,fillColor,control});
  const legacyEnabled=enabled&&(typeof window==="undefined"||window.showai?.inlineInk?.nativeScene!==true);
  const current = useRef({
    source,
    color,
    width,
    pressure,
    ruler,
    onCamera,
    onTool,
    onShapeGesture,
    onClearSelection,
    tool,
  });
  const cameraRevision = useRef(0),
    previousInk = useRef("pen");
  const invalidate = useRef<(() => void) | null>(null);
  const navigating = useRef(false);
  const inking = tool === "pen" || tool === "highlighter" || tool === "eraser";
  if (tool === "pen" || tool === "highlighter") previousInk.current = tool;
  current.current = {
    source,
    color,
    width,
    pressure,
    ruler,
    onCamera,
    onTool,
    onShapeGesture,
    onClearSelection,
    tool,
  };
  useEffect(() => {
    const bridge = window.showai?.inlineInk;
    if (!bridge || !legacyEnabled || !source) return;
    return bridge.onCommand((value) => {
      if (value.pageId !== source.id || value.boardId !== boardId) return;
      if (value.clearSelection) current.current.onClearSelection();
      if (value.shapeGesture)
        current.current.onShapeGesture(value.shapeGesture);
      if (value.camera) {
        navigating.current = !!value.navigating;
        cameraRevision.current = value.cameraVersion ?? cameraRevision.current;
        current.current.onCamera(value.camera, !value.navigating);
        if (!value.navigating) invalidate.current?.();
      }
      if (value.tool)
        current.current.onTool(
          value.tool === "toggleEraser"
            ? current.current.tool === "eraser"
              ? previousInk.current
              : "eraser"
            : value.tool === "previous"
              ? previousInk.current
              : value.tool,
        );
    });
  }, [legacyEnabled, source?.id, boardId]);
  useEffect(() => {
    invalidate.current?.();
  }, [source, color, width, pressure, ruler, tool]);
  useEffect(() => {
    const bridge = window.showai?.inlineInk;
    if (
      !bridge ||
      !legacyEnabled ||
      !source ||
      !inking ||
      !root.current ||
      !world.current
    )
      return;
    const token = crypto.randomUUID(),
      surface = root.current,
      content = world.current;
    let alive = true,
      pending = false,
      failed = false,
      lastKey = "",
      lastDocument: ShowDocument | undefined,
      frame = 0,
      poseDocument: ShowDocument | undefined,
      poseSize = "",
      poses: Record<string, number[]> = {},
      lastPoses: Record<string, number[]> | undefined;
    let dirty = false,
      animations = 0;
    const schedule = () => {
      dirty = true;
      if (!alive || failed || frame || pending) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        void send();
      });
    };
    invalidate.current = schedule;
    const refreshDocument = () => {
      lastKey = "";
      lastDocument = undefined;
      lastPoses = undefined;
      schedule();
    };
    surface.addEventListener("showai:ink-refresh", refreshDocument);
    const send = async () => {
      if (!alive || failed) return;
      dirty = false;
      if (
        pending ||
        !surface.getClientRects().length ||
        document.visibilityState === "hidden"
      )
        return;
      const documentValue = current.current.source;
      if (!documentValue) return;
      const viewport = clientMatrix(
          surface,
          surface.offsetWidth,
          surface.offsetHeight,
        ),
        worldMatrix = clientMatrix(
          content,
          content.offsetWidth,
          content.offsetHeight,
        );
      const size = surface.clientWidth + ":" + surface.clientHeight;
      if (poseDocument !== documentValue || poseSize !== size) {
        const inverse = worldMatrix.inverse(),
          next: Record<string, number[]> = {};
        const board = findSurfaceNode(documentValue, boardId)?.node;
        const elements = new Map(
          [...content.querySelectorAll<SVGSVGElement>("[data-native-ink]")].map(
            (element) => [
              element.closest<HTMLElement>("[data-surface-id]")?.dataset
                .surfaceId,
              element,
            ],
          ),
        );
        for (const node of inkNodes(board ?? { content: [] })) {
          const element = elements.get(node.attrs!.id),
            m = element && inkMatrix(element);
          if (!m) return;
          const frame = documentValue.layout?.[node.attrs!.id];
          const object = element.closest<HTMLElement>(".surface-object");
          if (frame?.height && object?.parentElement === content) {
            // The document is authoritative. CSS rounds fractional SVG sizes
            // to layout pixels; feeding that rounding back rescales saved ink.
            const extent =
              node.attrs!.extent ??
              node.attrs!.nativeInk?.extent ??
              node.attrs!.data?.nativeInk?.extent;
            const a = ((frame.rotation ?? 0) * Math.PI) / 180,
              c = Math.cos(a),
              s = Math.sin(a),
              w = frame.width,
              h = frame.height;
            next[node.attrs!.id] = [
              (c * w) / extent[0],
              (s * w) / extent[0],
              (-s * h) / extent[1],
              (c * h) / extent[1],
              frame.x + w / 2 - (c * w) / 2 + (s * h) / 2,
              frame.y + h / 2 - (s * w) / 2 - (c * h) / 2,
            ];
          } else next[node.attrs!.id] = values(inverse.multiply(m));
        }
        poses = next;
        poseDocument = documentValue;
        poseSize = size;
      }
      const holes = inkUIRegions(
        document.querySelectorAll<HTMLElement>(
          "[data-surface-ui],.surface-toolbar,.studio-context-menu,.studio-modal-shade,.container-inspector,.studio-sidebar-shell:not([data-sidebar-mode=hidden]) .studio-sidebar,.studio-mobile-sidebar-edge,.studio-mobile-sidebar-scrim,.studio-mobile-navigation-tools",
        ),
      );
      const packet = {
        token,
        pageId: documentValue.id,
        boardId,
        tool: current.current.tool as "pen" | "highlighter" | "eraser",
        color: current.current.color,
        width: current.current.width,
        pressure: current.current.pressure,
        ruler: current.current.ruler,
        dark: document.documentElement.dataset.theme === "dark",
        widthPx: surface.clientWidth,
        heightPx: surface.clientHeight,
        viewport: values(viewport),
        // WebKit's SVG screen matrix can omit ancestor CSS scale. The shared
        // viewport already owns these coordinates; never infer them from SVG.
        camera: { ...viewCamera.current },
        cameraVersion: cameraRevision.current,
        holes,
        shapes: [
          ...content.querySelectorAll<HTMLElement>('[data-board-shape="true"]'),
        ]
          .filter(
            (element) =>
              element.closest(".page-surface") === surface &&
              element.getClientRects().length,
          )
          .map((element) => {
            const r = element.getBoundingClientRect();
            return {
              id: element.dataset.surfaceId!,
              x: r.x - 8,
              y: r.y - 8,
              width: r.width + 16,
              height: r.height + 16,
            };
          }),
      };
      const key = JSON.stringify(packet);
      if (key === lastKey && documentValue === lastDocument) {
        if (animations) schedule();
        return;
      }
      pending = true;
      try {
        if (surface.dataset.nativeInkToken !== token)
          surface.dataset.nativeInkToken = token;
        const accepted = await bridge.frame({
          ...packet,
          ...(lastPoses !== poses ? { poses } : {}),
          // The bridge uses this model identity to verify nested DOM poses.
          // It removes unchanged document payloads before native transport.
          document: documentValue,
        });
        if (accepted === false) return;
        lastKey = key;
        lastDocument = documentValue;
        lastPoses = poses;
        if (alive) {
          if (surface.dataset.nativeInkToken !== token)
            surface.dataset.nativeInkToken = token;
          if (surface.dataset.nativeInkActive !== "true")
            surface.dataset.nativeInkActive = "true";
        }
      } catch (error) {
        failed = true;
        throw error;
      } finally {
        pending = false;
        if (dirty || animations) schedule();
      }
    };
    const mutations = new MutationObserver((changes) => {
      if (
        changes.some(
          (change) =>
            !(
              navigating.current &&
              (change.target === content ||
                change.target === surface ||
                (change.target instanceof Element &&
                  change.target.classList.contains("surface-grid"))) &&
              change.attributeName === "style"
            ),
        )
      )
        schedule();
    });
    mutations.observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: [
        "style",
        "class",
        "hidden",
        "open",
        "data-sidebar-mode",
        "data-mobile-sidebar",
        "data-theme",
        "data-native-orientation",
        "data-dragging",
      ],
    });
    const resize = new ResizeObserver(schedule);
    resize.observe(surface);
    const viewportChanged = () => {
      if (navigating.current) return;
      cameraRevision.current++;
      // Camera updates bypass document import and the full-frame in-flight queue.
      // The native side rejects older revisions so an expensive import cannot rewind zoom.
      if (bridge.viewport && surface.dataset.nativeInkActive === "true") {
        const viewport = clientMatrix(
          surface,
          surface.clientWidth,
          surface.clientHeight,
        );
        void bridge
          .viewport({
            token,
            pageId: source.id,
            boardId,
            widthPx: surface.clientWidth,
            heightPx: surface.clientHeight,
            viewport: values(viewport),
            camera: { ...viewCamera.current },
            cameraVersion: cameraRevision.current,
          })
          .catch((error) => {
            failed = true;
            console.error("Native ink viewport:", error);
            surface.dispatchEvent(
              new CustomEvent("showai:ink-error", {
                bubbles: true,
                detail: String(error),
              }),
            );
          });
      }
      schedule();
    };
    const animationStart = (event: Event) => {
      if (event.target instanceof Element && !content.contains(event.target)) {
        animations++;
        schedule();
      }
    };
    const animationEnd = (event: Event) => {
      if (event.target instanceof Element && !content.contains(event.target)) {
        animations = Math.max(0, animations - 1);
        schedule();
      }
    };
    surface.addEventListener("showai:viewport-change", viewportChanged);
    document.addEventListener("visibilitychange", schedule);
    document.addEventListener("transitionrun", animationStart, true);
    document.addEventListener("transitionend", animationEnd, true);
    document.addEventListener("transitioncancel", animationEnd, true);
    document.addEventListener("scroll", schedule, true);
    window.addEventListener("resize", schedule);
    schedule();
    return () => {
      alive = false;
      surface.removeEventListener("showai:ink-refresh", refreshDocument);
      if (invalidate.current === schedule) invalidate.current = null;
      cancelAnimationFrame(frame);
      mutations.disconnect();
      resize.disconnect();
      surface.removeEventListener("showai:viewport-change", viewportChanged);
      document.removeEventListener("visibilitychange", schedule);
      document.removeEventListener("transitionrun", animationStart, true);
      document.removeEventListener("transitionend", animationEnd, true);
      document.removeEventListener("transitioncancel", animationEnd, true);
      document.removeEventListener("scroll", schedule, true);
      window.removeEventListener("resize", schedule);
      void bridge.hide(source.id, boardId, token).finally(() => {
        if (surface.dataset.nativeInkToken === token) {
          delete surface.dataset.nativeInkActive;
          delete surface.dataset.nativeInkToken;
        }
      });
    };
  }, [legacyEnabled, source?.id, boardId, inking, root, world, viewCamera]);
  return nativeScene;
}
