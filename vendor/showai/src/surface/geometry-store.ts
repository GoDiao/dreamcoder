import type { JSONContent } from "@tiptap/core";
import type { ShowDocument } from "../types";
import type { NodeLayout } from "./types";
import {
  arrowFromEndpoints,
  boundEndpoints,
  indexSurfaceTree,
  reconcileConnections,
  type SurfaceIndex,
} from "./connections.mjs";

/** DOM measurements are transient. Only an explicit editor command materializes hints. */
export class SurfaceGeometryStore {
  private measurements = new Map<string, { width: number; height: number }>();
  private listeners = new Map<string, Set<() => void>>();
  private content: JSONContent | undefined;
  private index: SurfaceIndex = new Map();
  private revision = 0;
  private gestures = 0;
  private scheduled = 0;
  private changed = new Set<string>();
  getSnapshot = () => this.revision;
  subscribe(ids: string[], listener: () => void) {
    for (const id of ids) {
      const listeners = this.listeners.get(id) ?? new Set();
      listeners.add(listener);
      this.listeners.set(id, listeners);
    }
    return () => {
      for (const id of ids) {
        const listeners = this.listeners.get(id);
        listeners?.delete(listener);
        if (!listeners?.size) this.listeners.delete(id);
      }
    };
  }
  measure(id: string, width: number, height: number) {
    if (!(width > 0 && height > 0)) return;
    const before = this.measurements.get(id);
    if (
      before &&
      Math.abs(before.width - width) < 0.25 &&
      Math.abs(before.height - height) < 0.25
    )
      return;
    this.measurements.set(id, { width, height });
    this.changed.add(id);
    this.publish();
  }
  forget(id: string) {
    if (this.measurements.delete(id)) {
      this.changed.add(id);
      this.publish();
    }
  }
  beginGesture() {
    this.gestures++;
  }
  endGesture() {
    this.gestures = Math.max(0, this.gestures - 1);
    this.publish();
  }
  private publish() {
    if (this.gestures || !this.changed.size) return;
    // React subscribers can change a connector's size. Deliver outside the
    // ResizeObserver phase so that change cannot trigger a same-frame loop.
    if (typeof requestAnimationFrame === "function") {
      if (!this.scheduled)
        this.scheduled = requestAnimationFrame(() => {
          this.scheduled = 0;
          this.flush();
        });
    } else this.flush();
  }
  private flush() {
    if (this.gestures || !this.changed.size) return;
    const notify = new Set<() => void>();
    for (const id of this.changed)
      for (const listener of this.listeners.get(id) ?? []) notify.add(listener);
    this.changed.clear();
    this.revision++;
    for (const listener of notify) listener();
  }
  private entries(document: ShowDocument) {
    if (this.content !== document.content) {
      this.content = document.content;
      this.index = indexSurfaceTree(document.content);
    }
    return this.index;
  }
  frame(id: string, frame: NodeLayout) {
    const measurement = this.measurements.get(id);
    if (!measurement || Math.abs(measurement.width - frame.width) > 0.5)
      return frame;
    return { ...frame, contentSize: measurement };
  }
  resolveArrow(node: JSONContent, frame: NodeLayout, document: ShowDocument) {
    const layout: Record<string, NodeLayout> = {};
    const index = this.entries(document),
      parent = index.get(node.attrs!.id)?.parent;
    if (parent?.attrs?.id && document.layout?.[parent.attrs.id])
      layout[parent.attrs.id] = document.layout[parent.attrs.id];
    for (const binding of Object.values(node.attrs?.bindings ?? {}) as {
      targetId: string;
    }[]) {
      const target = document.layout?.[binding.targetId];
      if (target)
        layout[binding.targetId] = this.frame(binding.targetId, target);
    }
    return arrowFromEndpoints(
      node,
      frame,
      boundEndpoints(node, frame, index, layout),
    );
  }
  materialize<T extends ShowDocument>(document: T): T {
    let layout = document.layout;
    // Authoring observes the current tree, including any externally edited
    // nodes on this same root reference; the render cache is not evidence.
    const index = indexSurfaceTree(document.content);
    for (const [id, measurement] of this.measurements) {
      const frame = layout?.[id],
        node = index.get(id)?.node;
      if (
        !frame ||
        !node ||
        node.type === "drawing" ||
        (node.type === "surface" && frame.heightMode !== "auto") ||
        Math.abs(measurement.width - frame.width) > 0.5
      )
        continue;
      if (
        frame.contentSize?.width === measurement.width &&
        frame.contentSize?.height === measurement.height
      )
        continue;
      if (layout === document.layout) layout = { ...layout };
      layout![id] = { ...frame, contentSize: measurement };
    }
    // Connection reconciliation may replace root fields even with no new measurements.
    const next = reconcileConnections({ ...document, ...(layout ? { layout } : {}) });
    return next.content === document.content && next.layout === document.layout ? document : next;
  }
}
