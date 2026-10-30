import { useCallback, useMemo, useSyncExternalStore } from "react";
import type { JSONContent } from "@tiptap/core";
import type { ShowDocument } from "../types";
import type { SurfaceGeometryStore } from "./geometry-store";
const snapshot = () => 0;
export function useConnectionGeometry(
  node: JSONContent,
  document: ShowDocument,
  geometry?: SurfaceGeometryStore,
) {
  const start = node.attrs?.bindings?.start?.targetId,
    end = node.attrs?.bindings?.end?.targetId;
  const subscribe = useCallback(
    (listener: () => void) =>
      geometry?.subscribe([start, end].filter(Boolean), listener) ?? (() => {}),
    [geometry, start, end],
  );
  const revision = useSyncExternalStore(
    subscribe,
    geometry?.getSnapshot ?? snapshot,
    snapshot,
  );
  const frame = document.layout?.[node.attrs?.id];
  return useMemo(
    () =>
      geometry &&
      frame &&
      node.type === "drawing" &&
      node.attrs?.tool === "arrow" &&
      (start || end)
        ? geometry.resolveArrow(node, frame, document)
        : { node, frame },
    [node, frame, document, geometry, revision, start, end],
  );
}
