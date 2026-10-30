import { createContext } from "react";
import type { NodeLayout } from "./types";
import type { SurfaceGeometryStore } from "./geometry-store";
import type { BoardInteraction } from "./useBoardInteraction";

// Kept apart from SurfaceObject so the component SDK can read the context
// without bundling the editor's object chrome.
export interface ObjectActions {
  componentActionsHost?: HTMLElement | null;
  /** This exact Board has an accepted native scene owning paint and selection. */
  nativeScene?: boolean;
  scale: number;
  geometry?: SurfaceGeometryStore;
  selected: string | null;
  board?: BoardInteraction;
  connect?: (
    id: string,
    endpoint: "start" | "end",
    point: { x: number; y: number },
  ) => void;
  select: (id: string | null, additive?: boolean) => void;
  /** Mark the object an arrow endpoint at this client point would bind to; null clears. */
  highlightTarget?: (x: number | null, y?: number, exclude?: string) => void;
  inspect?: (id: string | null) => void;
  expand?: (id: string) => void;
  remove?: (id: string) => void;
  move?: (id: string, frame: NodeLayout) => void;
  /** The shape or arrow whose label is open for editing. */
  labelEditing?: string | null;
  editLabel?: (id: string | null) => void;
  /** Commit a label; minHeight grows a shape whose text no longer fits. */
  setLabel?: (id: string, label: string, minHeight?: number) => void;
  readOnly: boolean;
  revealAll: boolean;
  revealed: Set<string>;
}
export const ObjectContext = createContext<ObjectActions>({
  scale: 1,
  selected: null,
  select: () => {},
  readOnly: true,
  revealAll: false,
  revealed: new Set(),
});
