import { useContext, useEffect, useRef, useSyncExternalStore } from "react";
import { EditorViewScope } from "../editor/view-scope";
import { translator } from "../i18n";
import messages from "../i18n/messages/surface";
import { fingerNavigatesBoard } from "./board-input.mjs";
import {
  GESTURE_IDLE,
  MAX_ZOOM,
  MIN_ZOOM,
  normalizedWheel,
  zoomAt,
  type Camera,
} from "./model";
import {
  nearestSnap,
  momentumStep,
  PanVelocity,
  panFrom,
  springStep,
  type SurfaceAnchor,
  type SurfaceRegion,
} from "./physics";

const t = translator(messages);

/** Zoom changes every gesture frame; only the zoom controls subscribe to it. */
export interface ViewportScale {
  get(): number;
  subscribe(listener: () => void): () => void;
}
function viewportScale(): ViewportScale & { set(value: number): void } {
  let value = 1;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set(next) {
      if (next === value) return;
      value = next;
      for (const listener of listeners) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
export function useViewportScale(scale: ViewportScale) {
  return useSyncExternalStore(scale.subscribe, scale.get, scale.get);
}

const editable = (target: EventTarget | null) =>
  target instanceof Element &&
  (!!target.closest(
    'input, textarea, select, [role="textbox"], [data-editor-keyboard-scope]',
  ) ||
    target.closest("[contenteditable]")?.getAttribute("contenteditable") ===
      "true");
const interactive = (target: EventTarget | null) =>
  target instanceof Element &&
  (editable(target) ||
    !!target.closest(
      'button, a, input, textarea, select, summary, [role="slider"], iframe, [data-surface-gesture="own"], .react-flow',
    ));

/** Embedded controls and scroll areas keep the whole gesture, including its tail. */
function ownsWheel(
  target: EventTarget | null,
  boundary: HTMLElement,
  x: number,
  y: number,
  zoom: boolean,
) {
  if (!(target instanceof Element)) return false;
  const locked = target.closest('[data-viewport-locked="true"]');
  const ownership =
    target
      .closest("[data-surface-gesture]")
      ?.getAttribute("data-surface-gesture")
      ?.split(/\s+/) ?? [];
  if (
    ownership.includes("own") ||
    (zoom
      ? ownership.includes("zoom")
      : ownership.includes(Math.abs(x) > Math.abs(y) ? "x" : "y"))
  )
    return true;
  if (
    target.closest(
      '[data-surface-ui], [data-surface-gesture="own"], input[type="range"], select',
    )
  )
    return true;
  if (!locked && target.closest(".react-flow")) return true;
  // Pinch and Ctrl/Command zoom belong to the Board unless a control claims it.
  if (zoom) return false;
  for (
    let element: Element | null = target;
    element && element !== boundary;
    element = element.parentElement
  ) {
    const style = getComputedStyle(element);
    // Only a scroller that can still move in this direction keeps the gesture;
    // at its end the Board continues panning.
    if (
      Math.abs(x) > Math.abs(y) &&
      /auto|scroll/.test(style.overflowX) &&
      (x > 0
        ? element.scrollLeft + element.clientWidth < element.scrollWidth - 1
        : element.scrollLeft > 0)
    )
      return true;
    if (
      Math.abs(y) >= Math.abs(x) &&
      /auto|scroll/.test(style.overflowY) &&
      (y > 0
        ? element.scrollTop + element.clientHeight < element.scrollHeight - 1
        : element.scrollTop > 0)
    )
      return true;
  }
  return false;
}

interface PanGesture {
  origin: Camera;
  anchor: SurfaceAnchor | null;
  delta: { x: number; y: number };
  released: boolean;
  /** Discrete wheel steps land exactly where they scroll; no snap afterwards. */
  stepped?: boolean;
}

export interface SurfaceViewportOptions {
  /** Reading views keep the gentle region snap; editing pans and zooms freely. */
  reading?: boolean;
  /** Keep content fixed on screen when the viewport's own box moves or resizes. */
  anchorScreen?: boolean;
  /** Dragging anywhere pans, like holding Space. */
  panMode?: { current: boolean };
}

/** Dot spacing stays readable at every zoom by stepping in powers of four. */
export function gridSpacing(scale: number) {
  let size = 24 * scale;
  while (size < 12) size *= 4;
  while (size > 96) size /= 4;
  return size;
}

export function useSurfaceViewport(
  layoutKey: unknown,
  storageKey?: string,
  enabled = true,
  options: SurfaceViewportOptions = {},
) {
  const viewScope = useContext(EditorViewScope);
  const sharedStorageKey = storageKey;
  if (storageKey && viewScope) storageKey = `${storageKey}:${viewScope}`;
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const rootRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const camera = useRef<Camera>({ x: 0, y: 0, scale: 1 });
  const scaleRef = useRef<ReturnType<typeof viewportScale> | null>(null);
  const scale = (scaleRef.current ??= viewportScale());
  const controls = useRef({
    fit: (_ids?: string[], _immediate?: boolean) => {},
    focus: (_id: string, _immediate?: boolean) => {},
    point: (_x: number, _y: number) => ({ x: 0, y: 0 }),
    restored: false,
    restoredTargets: [] as string[],
    restoredAnchor: null as string | null,
    restore: () => {},
    zoom: (_scale: number) => {},
    panBy: (_x: number, _y: number) => {},
    moveTo: (_camera: Camera, _immediate = false) => {},
    navigateTo: (_camera: Camera, _final = false) => {},
    refresh: () => {},
    cancel: () => {},
    objectGesture: (_active: boolean) => {},
  });

  useEffect(() => {
    const root = rootRef.current!,
      scroll = scrollRef.current!,
      world = worldRef.current!;
    const gridLayer = scroll.querySelector<HTMLElement>(
      ":scope > .surface-grid",
    );
    const ownsInput = (target: EventTarget | null) =>
      enabledRef.current &&
      (!(target instanceof Element) ||
        !target.closest("[data-input-surface]") ||
        target.closest("[data-input-surface]") === root);
    /** A nested active Board keeps its own wheel; Page cards only keep scrolls they can perform. */
    const nestedBoard = (target: EventTarget | null) => {
      for (
        let element = target instanceof Element ? target : null;
        element && element !== root;
        element = element.parentElement
      )
        if (
          element.classList.contains("page-surface") &&
          (element as HTMLElement).dataset.inputSurface
        )
          return true;
      return false;
    };
    const outerScale = () =>
      root.getBoundingClientRect().width / root.clientWidth || 1;
    const clientPoint = (x: number, y: number) => {
      const rect = root.getBoundingClientRect(),
        scale = outerScale();
      return { x: (x - rect.left) / scale, y: (y - rect.top) / scale };
    };
    const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0,
      springFrame = 0,
      idle = 0;
    let anchor: SurfaceAnchor | null = null;
    let objectGesture = false;
    let gesture: PanGesture | null = null;
    let lastWheel = -Infinity,
      nestedGesture = false,
      space = false,
      hovering = false;
    const panTool = () =>
      root.dataset.boardTool === "pan" || !!optionsRef.current.panMode?.current;
    const panning = () => space || panTool();
    let drag: {
      id: number;
      x: number;
      y: number;
      started: boolean;
      touch: boolean;
      gesture: PanGesture;
      velocity: PanVelocity;
    } | null = null;
    const touches = new Map<number, { x: number; y: number }>();
    let pinch: {
      distance: number;
      center: { x: number; y: number };
      camera: Camera;
      anchor: SurfaceAnchor | null;
    } | null = null;
    const bounds = () => ({
      width: scroll.clientWidth,
      height: root.clientHeight,
      offsetX: 0,
    });
    const regions = (): SurfaceRegion[] => {
      const base = world.getBoundingClientRect(),
        // Client rects include every ancestor Board's zoom as well as our own.
        scale = camera.current.scale * outerScale();
      return [...world.querySelectorAll<HTMLElement>("[data-surface-id]")]
        .filter(
          (element) =>
            element.closest(".surface-world") === world &&
            element.closest("[data-container-root]") ===
              world.closest("[data-container-root]"),
        )
        .map((element) => {
          const rect = element.getBoundingClientRect();
          return {
            id: element.dataset.surfaceId!,
            label: element.dataset.surfaceName || t("node.region"),
            x: (rect.left - base.left) / scale,
            y: (rect.top - base.top) / scale,
            width: rect.width / scale,
            height: rect.height / scale,
          };
        });
    };
    const snapAt = (target: Camera) =>
      optionsRef.current.reading
        ? nearestSnap(regions(), target, bounds())
        : null;
    let previousAnchor: { id: string; x: number; y: number } | null = null;
    const remember = () => {
      if (!storageKey) return;
      const visible = regions()
        .filter((item) => {
          const c = camera.current;
          return (
            item.x * c.scale + c.x < root.clientWidth &&
            (item.x + item.width) * c.scale + c.x > 0 &&
            item.y * c.scale + c.y < root.clientHeight &&
            (item.y + item.height) * c.scale + c.y > 0
          );
        })
        .slice(0, 100);
      const anchorId = anchor?.id;
      const anchored =
        anchorId && regions().find((item) => item.id === anchorId);
      try {
        localStorage.setItem(
          storageKey,
          JSON.stringify({
            ...camera.current,
            visibleIds: visible.map((item) => item.id),
            anchor: anchored
              ? { id: anchored.id, x: anchored.x, y: anchored.y }
              : null,
          }),
        );
      } catch {
        /* Personal view state is disposable; content uses the normal save path. */
      }
    };
    if (storageKey) {
      try {
        const saved = JSON.parse(
          localStorage.getItem(storageKey) ||
            (sharedStorageKey
              ? localStorage.getItem(sharedStorageKey)
              : null) ||
            "null",
        );
        if (
          saved &&
          [saved.x, saved.y, saved.scale].every(Number.isFinite) &&
          saved.scale >= MIN_ZOOM &&
          saved.scale <= MAX_ZOOM &&
          Array.isArray(saved.visibleIds) &&
          saved.visibleIds.length <= 100 &&
          saved.visibleIds.every((id: unknown) => typeof id === "string")
        ) {
          camera.current = { x: saved.x, y: saved.y, scale: saved.scale };
          controls.current.restored = true;
          controls.current.restoredTargets = saved.visibleIds;
          if (
            saved.anchor &&
            typeof saved.anchor.id === "string" &&
            [saved.anchor.x, saved.anchor.y].every(Number.isFinite)
          )
            previousAnchor = saved.anchor;
        }
      } catch {
        /* Ignore unavailable or invalid personal view state. */
      }
    }
    const targetRegion = (id: string): SurfaceRegion | undefined => {
      const region = regions().find((candidate) => candidate.id === id);
      if (region) return region;
      const element = world.querySelector<HTMLElement>(
        `[data-block-id="${CSS.escape(id)}"]`,
      );
      if (!element) return;
      const rect = element.getBoundingClientRect(),
        base = world.getBoundingClientRect(),
        scale = camera.current.scale * outerScale();
      return {
        id,
        label: t("node.content"),
        x: (rect.left - base.left) / scale,
        y: (rect.top - base.top) / scale,
        width: rect.width / scale,
        height: rect.height / scale,
      };
    };
    const setAnchor = (next: SurfaceAnchor | null) => {
      anchor = next;
      root.dataset.anchor = next?.id ?? "";
    };
    const paintNow = () => {
      const c = camera.current;
      const transform = `translate3d(${c.x}px, ${c.y}px, 0) scale(${c.scale})`;
      const previousTransform = world.style.transform;
      world.style.transform = transform;
      // CSSOM normalizes values such as the translate3d z coordinate from 0
      // to 0px. Compare serialized values on both sides so a layout refresh
      // does not announce a camera move and hide the live native ink.
      const changed = world.style.transform !== previousTransform;
      // Selection chrome and the dot grid read these to stay screen-sized.
      if (root.style.getPropertyValue("--board-zoom") !== String(c.scale))
        root.style.setProperty("--board-zoom", String(c.scale));
      const grid = gridSpacing(c.scale);
      if (gridLayer) {
        if (
          gridLayer.style.getPropertyValue("--board-grid-size") !== `${grid}px`
        )
          gridLayer.style.setProperty("--board-grid-size", `${grid}px`);
        gridLayer.style.transform = `translate3d(${c.x % grid}px, ${c.y % grid}px, 0)`;
      }
      // Only the zoom controls subscribe; objects read the camera directly.
      scale.set(c.scale);
      // Followers measure the committed transform in this frame, not the previous camera.
      if (changed)
        root.dispatchEvent(
          new Event("showai:viewport-change", { bubbles: true }),
        );
    };
    const paint = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(paintNow);
    };
    const stopSpring = () => {
      cancelAnimationFrame(springFrame);
      springFrame = 0;
      delete root.dataset.settling;
    };
    const springTo = (target: Camera, complete?: () => void) => {
      stopSpring();
      cancelAnimationFrame(frame);
      if (reducedMotion.matches) {
        camera.current = target;
        paintNow();
        complete?.();
        remember();
        return;
      }
      root.dataset.settling = "true";
      let previous = performance.now();
      const velocity = { x: 0, y: 0, scale: 0 };
      const step = (time: number) => {
        const elapsed = (time - previous) / 1000;
        previous = time;
        const next = { ...camera.current };
        let settled = true;
        for (const key of ["x", "y", "scale"] as const) {
          const updated = springStep(
            next[key],
            velocity[key],
            target[key],
            elapsed,
          );
          next[key] = updated.position;
          velocity[key] = updated.velocity;
          const tolerance = key === "scale" ? 0.0002 : 0.15;
          if (
            Math.abs(next[key] - target[key]) > tolerance ||
            Math.abs(velocity[key]) > tolerance * 8
          )
            settled = false;
        }
        camera.current = settled ? target : next;
        paintNow();
        if (settled) {
          stopSpring();
          complete?.();
          remember();
        } else springFrame = requestAnimationFrame(step);
      };
      springFrame = requestAnimationFrame(step);
    };
    const refresh = () => {
      if (document.documentElement.dataset.native === "ios") {
        setAnchor(null);
        paint();
        return;
      }
      if (gesture) gesture.released = true;
      const visible = snapAt(camera.current);
      // Content edits/resize may change geometry. Refresh resistance without
      // dragging the user's camera along with a moving or resizing card.
      setAnchor(visible ? { ...visible.anchor, x: camera.current.x } : null);
      paint();
    };
    const settle = () => {
      clearTimeout(idle);
      const current = gesture;
      gesture = null;
      if (document.documentElement.dataset.native === "ios") {
        setAnchor(null);
        paintNow();
        remember();
        return;
      }
      if (
        current?.anchor &&
        !current.released &&
        regions().some((region) => region.id === current.anchor!.id)
      ) {
        setAnchor(current.anchor);
        springTo({
          ...camera.current,
          x: current.anchor.x,
          y: Math.max(
            current.anchor.minY,
            Math.min(current.anchor.maxY, camera.current.y),
          ),
        });
        return;
      }
      const snap = current?.stepped ? null : snapAt(camera.current);
      setAnchor(snap?.anchor ?? null);
      if (snap) springTo(snap.camera);
      else remember();
    };
    const later = () => {
      clearTimeout(idle);
      idle = window.setTimeout(settle, GESTURE_IDLE);
    };
    const interrupt = () => {
      clearTimeout(idle);
      stopSpring();
      gesture = null;
    };
    const coast = (velocity: { x: number; y: number }) => {
      if (reducedMotion.matches || Math.hypot(velocity.x, velocity.y) < 40)
        return false;
      interrupt();
      setAnchor(null);
      cancelAnimationFrame(frame);
      paintNow();
      root.dataset.settling = "true";
      let previous = performance.now();
      const step = (time: number) => {
        const next = momentumStep(velocity, (time - previous) / 1000);
        previous = time;
        velocity = next.velocity;
        camera.current = {
          ...camera.current,
          x: camera.current.x + next.x,
          y: camera.current.y + next.y,
        };
        paintNow();
        if (Math.hypot(velocity.x, velocity.y) < 20) {
          stopSpring();
          remember();
        } else springFrame = requestAnimationFrame(step);
      };
      springFrame = requestAnimationFrame(step);
      return true;
    };
    const beginPan = (): PanGesture => {
      interrupt();
      return {
        origin: { ...camera.current },
        anchor,
        delta: { x: 0, y: 0 },
        released: false,
      };
    };
    const pan = (current: PanGesture) => {
      const next = panFrom(current.origin, current.delta, current.anchor);
      current.released ||= next.released;
      camera.current = next.camera;
      if (current.released && current.anchor) {
        // Once free, continue 1:1 from where the resisted pull is displayed.
        current.anchor = null;
        current.origin = {
          ...next.camera,
          x: next.camera.x - current.delta.x,
          y: next.camera.y - current.delta.y,
        };
        setAnchor(null);
      }
      paint();
    };
    const moveTo = (target: Camera, immediate = false) => {
      interrupt();
      setAnchor(null);
      if (immediate) {
        camera.current = target;
        paintNow();
        refresh();
      } else springTo(target, refresh);
    };
    const navigateTo = (target: Camera, final = false) => {
      interrupt();
      setAnchor(null);
      camera.current = target;
      paintNow();
      if (final) remember();
    };
    const visibleArea = () => ({ top: 56, bottom: root.clientHeight - 84 });
    const fit = (ids?: string[], immediate = false) => {
      const all = regions(),
        chosen = ids?.length
          ? ids
              .map(targetRegion)
              .filter((region): region is SurfaceRegion => !!region)
          : all;
      if (!chosen.length) {
        moveTo({ x: 64, y: 64, scale: 1 }, immediate);
        return;
      }
      const minX = Math.min(...chosen.map((item) => item.x)),
        minY = Math.min(...chosen.map((item) => item.y));
      const maxX = Math.max(...chosen.map((item) => item.x + item.width)),
        maxY = Math.max(...chosen.map((item) => item.y + item.height));
      const area = visibleArea();
      const scale = Math.max(
        MIN_ZOOM,
        Math.min(
          1,
          (root.clientWidth - 96) / Math.max(1, maxX - minX),
          (area.bottom - area.top) / Math.max(1, maxY - minY),
        ),
      );
      const height = (maxY - minY) * scale;
      moveTo(
        {
          x: root.clientWidth / 2 - ((minX + maxX) / 2) * scale,
          // Center what fits between the header and the toolbar; tall content
          // starts at its top.
          y:
            height <= area.bottom - area.top
              ? (area.top + area.bottom) / 2 - ((minY + maxY) / 2) * scale
              : area.top - minY * scale,
          scale,
        },
        immediate,
      );
    };
    const focus = (id: string, immediate = false) => {
      const target = targetRegion(id);
      if (!target) return;
      const scale = Math.max(
        MIN_ZOOM,
        Math.min(1, (root.clientWidth - 96) / target.width),
      );
      moveTo(
        {
          x: root.clientWidth / 2 - (target.x + target.width / 2) * scale,
          y: 64 - target.y * scale,
          scale,
        },
        immediate,
      );
    };
    const zoom = (
      value: number,
      point = {
        x: bounds().width / 2 - bounds().offsetX,
        y: root.clientHeight / 2,
      },
    ) => {
      interrupt();
      setAnchor(null);
      camera.current = zoomAt(camera.current, point, value);
      paint();
      // Zooming never snaps afterwards: the point under the cursor stays put.
      idle = window.setTimeout(remember, GESTURE_IDLE);
    };
    const panBy = (x: number, y: number) => {
      interrupt();
      setAnchor(null);
      camera.current = {
        ...camera.current,
        x: camera.current.x + x,
        y: camera.current.y + y,
      };
      paintNow();
      idle = window.setTimeout(remember, GESTURE_IDLE);
    };
    controls.current = {
      fit,
      focus,
      zoom,
      panBy,
      moveTo,
      navigateTo,
      refresh,
      cancel: controls.current.cancel,
      objectGesture: controls.current.objectGesture,
      restored: controls.current.restored,
      restoredTargets: controls.current.restoredTargets,
      restoredAnchor: previousAnchor?.id ?? null,
      restore: () => {
        const next =
          previousAnchor &&
          regions().find((item) => item.id === previousAnchor!.id);
        if (next && previousAnchor)
          camera.current = {
            ...camera.current,
            x:
              camera.current.x +
              (previousAnchor.x - next.x) * camera.current.scale,
            y:
              camera.current.y +
              (previousAnchor.y - next.y) * camera.current.scale,
          };
        paintNow();
        refresh();
      },
      point: (x, y) => {
        const local = clientPoint(x, y);
        return {
          x: (local.x - camera.current.x) / camera.current.scale,
          y: (local.y - camera.current.y) / camera.current.scale,
        };
      },
    };

    const wheel = (event: WheelEvent) => {
      if (!enabledRef.current || nestedBoard(event.target)) return;
      if (event.defaultPrevented || drag || pinch) return;
      const delta = normalizedWheel(
        event.deltaX,
        event.deltaY,
        event.deltaMode,
        root.clientHeight,
        event.shiftKey,
      );
      const zooming = event.ctrlKey || event.metaKey;
      const now = performance.now();
      // The layer that receives a gesture's first event keeps all of it,
      // including trackpad momentum that slides other content under the cursor.
      if (now - lastWheel > GESTURE_IDLE)
        nestedGesture =
          !objectGesture &&
          ownsWheel(event.target, root, delta.x, delta.y, zooming);
      lastWheel = now;
      if (nestedGesture) return;
      event.preventDefault();
      if (zooming) {
        const rect = root.getBoundingClientRect();
        zoom(
          camera.current.scale *
            Math.exp(-Math.max(-35, Math.min(35, delta.y)) * 0.009),
          {
            x: (event.clientX - rect.left) / outerScale() - bounds().offsetX,
            y: (event.clientY - rect.top) / outerScale(),
          },
        );
        return;
      }
      if (objectGesture) {
        // Panning under a dragged object keeps the object under the pointer.
        panBy(-delta.x / outerScale(), -delta.y / outerScale());
        return;
      }
      if (!gesture) gesture = beginPan();
      // A mouse wheel notch is a deliberate step, not a pull against the
      // reading anchor.
      if (
        event.deltaMode !== 0 ||
        (Math.abs(event.deltaY) >= 50 && Number.isInteger(event.deltaY))
      ) {
        gesture.released = gesture.stepped = true;
        if (!gesture.delta.x && !gesture.delta.y) gesture.anchor = null;
      }
      gesture.delta.x -= delta.x / outerScale();
      gesture.delta.y -= delta.y / outerScale();
      pan(gesture);
      later();
    };
    const localPoint = (event: PointerEvent) => {
      const rect = root.getBoundingClientRect();
      return {
        x: (event.clientX - rect.left) / outerScale() - bounds().offsetX,
        y: (event.clientY - rect.top) / outerScale(),
      };
    };
    const pinchMetrics = () => {
      const [a, b] = [...touches.values()];
      return {
        distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
        center: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      };
    };
    const captureTouch = (event: PointerEvent) => {
      if (ownsInput(event.target) && springFrame) {
        interrupt();
        paintNow();
        remember();
      }
      if (
        !ownsInput(event.target) ||
        event.pointerType !== "touch" ||
        (event.target as Element).closest(
          '[data-surface-ui],iframe,[data-surface-gesture="own"],.react-flow',
        )
      )
        return;
      touches.set(event.pointerId, localPoint(event));
      if (touches.size !== 2) return;
      event.preventDefault();
      event.stopPropagation();
      interrupt();
      drag = null;
      root.dispatchEvent(new Event("showai-board-pinch"));
      pinch = { ...pinchMetrics(), camera: { ...camera.current }, anchor };
      setAnchor(null);
      for (const id of touches.keys()) root.setPointerCapture(id);
    };
    const down = (event: PointerEvent) => {
      const hand = panning(),
        handTool = panTool();
      if (
        !ownsInput(event.target) ||
        event.defaultPrevented ||
        (!fingerNavigatesBoard(event.pointerType) &&
          (event.target as Element).closest('[data-drawing-active="true"]')) ||
        ((event.target as Element).closest("[data-board-drawing-input]") &&
          !fingerNavigatesBoard(event.pointerType) &&
          event.button !== 1 &&
          !hand)
      )
        return;
      if (springFrame || gesture) interrupt();
      const target = event.target as Element;
      // The hand tool pans from any content, but never from the toolbar.
      if (
        handTool &&
        target.closest("[data-surface-ui]") &&
        !world.contains(target)
      )
        return;
      if (
        target.closest("[data-surface-handle]") &&
        !hand &&
        event.button !== 1
      ) {
        if (event.button === 0) {
          controls.current.cancel();
          objectGesture = true;
        }
        return;
      }
      if (
        target.closest('[data-surface-gesture="own"], .react-flow') ||
        (!hand &&
          event.button !== 1 &&
          target.closest("[data-surface-ui], [data-surface-handle]"))
      )
        return;
      const touch = event.pointerType === "touch";
      if (touch) {
        touches.set(event.pointerId, localPoint(event));
        if (touches.size === 2) {
          event.preventDefault();
          interrupt();
          drag = null;
          pinch = { ...pinchMetrics(), camera: { ...camera.current }, anchor };
          setAnchor(null);
          for (const id of touches.keys()) root.setPointerCapture(id);
          return;
        }
      }
      const touchReading =
        touch &&
        !target.closest(
          'button, a, input, textarea, select, summary, [role="slider"], iframe',
        );
      if (
        drag ||
        event.button > 1 ||
        (interactive(target) &&
          !touchReading &&
          !(event.button === 1 || handTool || (hand && !editable(target))))
      )
        return;
      const background = !target.closest("[data-surface-content]");
      if (!background && !touchReading && !hand && event.button !== 1) return;
      if (!touch) {
        event.preventDefault();
        root.focus({ preventScroll: true });
        root.setPointerCapture(event.pointerId);
      }
      drag = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        touch,
        started: !touch,
        gesture: beginPan(),
        velocity: new PanVelocity(),
      };
      drag.velocity.add(0, 0, event.timeStamp);
      if (!touch) root.classList.add("is-panning");
    };
    const move = (event: PointerEvent) => {
      if (objectGesture) return;
      if (touches.has(event.pointerId))
        touches.set(event.pointerId, localPoint(event));
      if (pinch && touches.size >= 2) {
        const metrics = pinchMetrics();
        const next = zoomAt(
          pinch.camera,
          pinch.center,
          (pinch.camera.scale * metrics.distance) / pinch.distance,
        );
        camera.current = {
          ...next,
          x: next.x + metrics.center.x - pinch.center.x,
          y: next.y + metrics.center.y - pinch.center.y,
        };
        paint();
        return;
      }
      if (!drag || drag.id !== event.pointerId) return;
      const dx = (event.clientX - drag.x) / outerScale(),
        dy = (event.clientY - drag.y) / outerScale();
      if (!drag.started) {
        if (Math.hypot(dx, dy) < 8 || !window.getSelection()?.isCollapsed)
          return;
        drag.started = true;
        root.setPointerCapture(event.pointerId);
        root.classList.add("is-panning");
      }
      drag.gesture.delta = { x: dx, y: dy };
      drag.velocity.add(dx, dy, event.timeStamp);
      pan(drag.gesture);
    };
    const finish = (event?: PointerEvent, cancelled = false) => {
      objectGesture = false;
      if (event) touches.delete(event.pointerId);
      else touches.clear();
      if (pinch) {
        const initial = pinch;
        pinch = null;
        if (cancelled && document.documentElement.dataset.native !== "ios") {
          setAnchor(initial.anchor);
          springTo(initial.camera);
        } else {
          setAnchor(null);
          paintNow();
          remember();
        }
      }
      if (drag && (!event || drag.id === event.pointerId)) {
        const initial = drag;
        drag = null;
        if (root.hasPointerCapture(initial.id))
          root.releasePointerCapture(initial.id);
        if (initial.started) {
          if (cancelled && document.documentElement.dataset.native !== "ios") {
            setAnchor(initial.gesture.anchor);
            springTo(initial.gesture.origin);
          } else {
            if (!(
              initial.touch &&
              !cancelled &&
              coast(
                initial.velocity.release(event?.timeStamp ?? performance.now()),
              )
            )) {
              gesture = initial.gesture;
              settle();
            }
          }
        }
      }
      root.classList.remove("is-panning");
    };
    const up = (event: PointerEvent) => {
      if (drag?.touch && drag.id === event.pointerId) move(event);
      finish(event);
    };
    const captureMove = (event: PointerEvent) => {
      if (!pinch) return;
      event.preventDefault();
      event.stopPropagation();
      move(event);
    };
    const captureEnd = (event: PointerEvent) => {
      if (pinch) {
        event.preventDefault();
        event.stopPropagation();
        finish(event, event.type === "pointercancel");
      } else if (!drag) touches.delete(event.pointerId);
    };
    controls.current.cancel = () => {
      interrupt();
      if (drag && root.hasPointerCapture(drag.id))
        root.releasePointerCapture(drag.id);
      drag = null;
      pinch = null;
      touches.clear();
      objectGesture = false;
      nestedGesture = false;
      space = false;
      root.classList.remove("is-panning", "is-hand");
    };
    controls.current.objectGesture = (active) => {
      objectGesture = active;
      if (!active) refresh();
    };
    const cancel = (event: PointerEvent) => finish(event, true);
    const lostCapture = (event: PointerEvent) => {
      if (event.target !== root) return;
      objectGesture = false;
      if (drag?.id === event.pointerId) finish(event, true);
    };
    const holdSpace = (event: KeyboardEvent) => {
      event.preventDefault();
      space = true;
      root.classList.add("is-hand");
    };
    const keydown = (event: KeyboardEvent) => {
      if (!ownsInput(event.target)) return;
      if (springFrame) stopSpring();
      if (editable(event.target) && gesture) {
        interrupt();
        refresh();
      }
      if (event.defaultPrevented || event.isComposing || editable(event.target))
        return;
      if (event.code === "Space" && !interactive(event.target))
        holdSpace(event);
      if (event.key === "Escape") {
        if (drag || pinch) finish(undefined, true);
      }
      if (event.target !== root) return;
      const step = event.shiftKey ? 320 : 120;
      const arrows: Record<string, [number, number]> = {
        ArrowLeft: [step, 0],
        ArrowRight: [-step, 0],
        ArrowUp: [0, step],
        ArrowDown: [0, -step],
        PageUp: [0, root.clientHeight * 0.8],
        PageDown: [0, -root.clientHeight * 0.8],
      };
      if (arrows[event.key]) {
        event.preventDefault();
        const [x, y] = arrows[event.key];
        moveTo({
          ...camera.current,
          x: camera.current.x + x,
          y: camera.current.y + y,
        });
      }
      // Command/Ctrl with these keys stays with the application's own zoom.
      if (
        ["+", "=", "-"].includes(event.key) &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey
      ) {
        event.preventDefault();
        zoom(camera.current.scale * (event.key === "-" ? 1 / 1.2 : 1.2));
      }
      if (
        (event.key === "0" && !event.shiftKey && !event.metaKey) ||
        event.key === "Home"
      ) {
        event.preventDefault();
        fit();
      }
    };
    // Space also pans while the pointer rests over the Board and focus is
    // elsewhere on the page, as long as no field or control would lose a keystroke.
    const windowKeydown = (event: KeyboardEvent) => {
      if (
        event.code !== "Space" ||
        space ||
        !hovering ||
        !enabledRef.current ||
        event.defaultPrevented ||
        event.repeat ||
        root.contains(event.target as Node) ||
        (event.target !== document.body &&
          event.target !== document.documentElement)
      )
        return;
      holdSpace(event);
    };
    const enter = () => (hovering = true);
    const leave = () => (hovering = false);
    const keyup = (event: KeyboardEvent) => {
      if (event.code === "Space") {
        space = false;
        root.classList.remove("is-hand");
      }
    };
    const blur = () => {
      space = false;
      root.classList.remove("is-hand");
      finish(undefined, true);
      if (gesture) settle();
      if (springFrame) {
        interrupt();
        paintNow();
        remember();
      }
    };
    const visibility = () => {
      if (document.visibilityState === "hidden") {
        controls.current.cancel();
        remember();
      }
    };
    const nativeScroll = () => {
      if (matchMedia("print").matches) return;
      if (!scroll.scrollTop && !scroll.scrollLeft) return;
      const x = scroll.scrollLeft,
        y = scroll.scrollTop;
      scroll.scrollTop = 0;
      scroll.scrollLeft = 0;
      if (!enabledRef.current) return;
      // Editor transactions may request scroll while a region is being revealed.
      // The camera owns that transition; a real pointer/key event interrupts it.
      if (springFrame) {
        paint();
        return;
      }
      // Browser find, caret navigation and focus still request native scroll.
      // Keep those movements in the same camera coordinates as pointer gestures.
      interrupt();
      camera.current = {
        ...camera.current,
        x: camera.current.x - x,
        y: camera.current.y - y,
      };
      refresh();
    };
    let placement = root.getBoundingClientRect();
    const resize = new ResizeObserver((entries) => {
      if (
        optionsRef.current.anchorScreen &&
        entries.some((entry) => entry.target === root)
      ) {
        // A sidebar opening or closing moves the viewport; the content stays
        // where it was on screen instead of jumping under the pointer.
        const next = root.getBoundingClientRect(),
          ratio = outerScale();
        const dx = (placement.left - next.left) / ratio,
          dy = (placement.top - next.top) / ratio;
        placement = next;
        if (dx || dy) {
          camera.current = {
            ...camera.current,
            x: camera.current.x + dx,
            y: camera.current.y + dy,
          };
          paintNow();
        }
      }
      if (!gesture && !drag && !pinch && !springFrame && !objectGesture)
        refresh();
    });
    resize.observe(root);
    const observedCards = new Set<HTMLElement>();
    const refreshLayout = () => {
      const cards = new Set(
        [...world.querySelectorAll<HTMLElement>("[data-surface-id]")].filter(
          (element) =>
            element.closest(".surface-world") === world &&
            element.closest("[data-container-root]") ===
              world.closest("[data-container-root]"),
        ),
      );
      for (const card of observedCards) {
        if (!cards.has(card)) {
          resize.unobserve(card);
          observedCards.delete(card);
        }
      }
      for (const card of cards) {
        if (!observedCards.has(card)) {
          resize.observe(card);
          observedCards.add(card);
        }
      }
      if (!objectGesture) refresh();
    };
    controls.current.refresh = refreshLayout;
    root.addEventListener("wheel", wheel, { passive: false });
    root.addEventListener("pointerdown", captureTouch, true);
    root.addEventListener("pointermove", captureMove, true);
    root.addEventListener("pointerup", captureEnd, true);
    root.addEventListener("pointercancel", captureEnd, true);
    root.addEventListener("pointerdown", down);
    root.addEventListener("pointermove", move);
    root.addEventListener("pointerup", up);
    root.addEventListener("pointercancel", cancel);
    root.addEventListener("lostpointercapture", lostCapture);
    root.addEventListener("keydown", keydown);
    root.addEventListener("pointerenter", enter);
    root.addEventListener("pointerleave", leave);
    scroll.addEventListener("scroll", nativeScroll);
    window.addEventListener("keydown", windowKeydown);
    window.addEventListener("keyup", keyup);
    window.addEventListener("blur", blur);
    document.addEventListener("visibilitychange", visibility);
    refreshLayout();
    return () => {
      remember();
      resize.disconnect();
      cancelAnimationFrame(frame);
      cancelAnimationFrame(springFrame);
      clearTimeout(idle);
      root.removeEventListener("wheel", wheel);
      root.removeEventListener("pointerdown", captureTouch, true);
      root.removeEventListener("pointermove", captureMove, true);
      root.removeEventListener("pointerup", captureEnd, true);
      root.removeEventListener("pointercancel", captureEnd, true);
      root.removeEventListener("pointerdown", down);
      root.removeEventListener("pointermove", move);
      root.removeEventListener("pointerup", up);
      root.removeEventListener("pointercancel", cancel);
      root.removeEventListener("lostpointercapture", lostCapture);
      root.removeEventListener("keydown", keydown);
      root.removeEventListener("pointerenter", enter);
      root.removeEventListener("pointerleave", leave);
      scroll.removeEventListener("scroll", nativeScroll);
      window.removeEventListener("keydown", windowKeydown);
      window.removeEventListener("keyup", keyup);
      window.removeEventListener("blur", blur);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, []);
  useEffect(() => {
    controls.current.refresh();
  }, [layoutKey]);
  useEffect(() => {
    if (!enabled) controls.current.cancel();
  }, [enabled]);
  return {
    rootRef,
    scrollRef,
    worldRef,
    scale,
    camera,
    controls,
  };
}
