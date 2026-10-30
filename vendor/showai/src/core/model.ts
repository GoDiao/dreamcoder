import type { JSONContent } from "@tiptap/core";
import type { ShowDocument } from "../types";
import type { NodeLayout, SavedView } from "../surface/types";
import type {
  DiagramDirection,
  DiagramInsertInput,
} from "../surface/diagram.mjs";

export type { ShowArtifact, ShowDocument } from "../types";
export type { JSONContent } from "@tiptap/core";

export interface ProjectBinding {
  harness: string;
  sessionId: string;
  sourceDirectory?: string;
}

export type DirectorySortBy = "name" | "createdAt" | "updatedAt" | "manual";

export interface DirectoryPreferences {
  /** Applies to the immediate children of this directory; omitted means updatedAt. */
  sortBy?: DirectorySortBy;
  manualOrder?: string[];
}

export interface ProjectMetadata extends DirectoryPreferences {
  format: "showai-project";
  version: 1;
  id: string;
  name: string;
  icon?: string;
  createdAt: string;
  updatedAt: string;
  /** Canonical host project directory, shared by all Agent sessions in it. */
  sourceDirectory?: string;
  binding?: ProjectBinding;
  bindings?: ProjectBinding[];
  pinned?: boolean;
  archived?: boolean;
  folders?: FolderMetadata[];
}

export interface FolderMetadata extends DirectoryPreferences {
  id: string;
  name: string;
  icon?: string;
  parentId: string | null;
  pinned: boolean;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectSummary extends ProjectMetadata {
  pageCount: number;
}

/** A project directory whose metadata or pages could not be read. */
export interface UnreadableProject {
  directory: string;
  /** Absolute path of the project directory. */
  path: string;
  code: string;
  message: string;
}

export interface ProjectGroup {
  id: string;
  name: string;
}

export interface SidebarOrganization {
  groups: ProjectGroup[];
  projectGroups: Record<string, string>;
  projectOrder?: string[];
  entryOrder?: Record<string, string[]>;
}

export interface SidebarEntryMove {
  /** Change only sibling order, without updating page content or requiring its revision. */
  reorderOnly?: boolean;
  kind: "page" | "folder";
  projectId: string;
  id: string;
  destinationProjectId: string;
  parentId: string | null;
  relativeId?: string;
  placement?: "before" | "after";
  baseHash?: string;
  baseRevision?: string;
}

export interface PageRecord {
  retainedSyncConflicts?: import("../sync/conflict-retention").RetainedConflict[];
  revision?: string;
  workspaceConflicts?: import("./workspace-conflicts").WorkspaceConflict[];
  document: ShowDocument;
  hash: string;
  path: string;
}

export interface PageSummary {
  revision?: string;
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  icon: string;
  hash: string;
  blockCount: number;
  /** Created by an Agent and not opened in the workbench since (local state). */
  agentCreated?: import("./agent-created").AgentCreatedMark;
  parentId: string | null;
  favorite: boolean;
  archived: boolean;
}

export type PageFields = Partial<
  Pick<
    ShowDocument,
    | "title"
    | "icon"
    | "cover"
    | "parentId"
    | "favorite"
    | "archived"
    | "comments"
    | "layout"
    | "views"
    | "surfaceViews"
    | "templateContext"
  >
>;

/** A null parent identifies the document root; omitted afterId appends. */
export type PageOperation =
  | {
      type: "component.insert";
      kind: string;
      data: Record<string, unknown>;
      parentId?: string | null;
      afterId?: string | null;
    }
  | { type: "surface.upgrade" }
  | {
      type: "surface.create";
      kind: "page" | "board";
      name?: string;
      nodeId?: string;
      parentId?: string | null;
    }
  | { type: "surface.wrap"; nodeId?: string; kind: "page" | "board" }
  | { type: "surface.layout.set"; nodeId: string; layout: Partial<NodeLayout> }
  | {
      type: "surface.view.save";
      surfaceId?: string;
      view: SavedView;
      initial?: boolean;
    }
  | { type: "surface.view.remove"; surfaceId?: string; viewId: string }
  | { type: "surface.reading-order.set"; surfaceId?: string; nodeIds: string[] }
  | { type: "page.set"; fields: PageFields }
  | {
      type: "block.insert";
      node: JSONContent;
      parentId?: string | null;
      afterId?: string | null;
    }
  | { type: "block.remove"; blockId: string }
  | { type: "block.replace"; blockId: string; node: JSONContent }
  | {
      type: "block.move";
      blockId: string;
      parentId?: string | null;
      afterId?: string | null;
    }
  | { type: "block.attrs.set"; blockId: string; attrs: Record<string, unknown> }
  /** Replace top-level component data keys without resending the node envelope. */
  | {
      type: "component.props.set";
      blockId: string;
      props: Record<string, unknown>;
    }
  | { type: "block.text.set"; blockId: string; text: string }
  /**
   * Point a custom component block at another exact revision. The block id,
   * props and dataset binding stay; the props are checked against the new
   * revision's schema (resolved props for bound blocks).
   */
  | {
      type: "component.ref.set";
      blockId: string;
      componentId?: string;
      version: string;
      integrity: string;
    }
  /** Bind a component block to a project dataset; see the datasets guide. */
  | {
      type: "component.binding.set";
      blockId: string;
      binding: Record<string, unknown>;
    }
  /** Detach a bound block; "snapshot" (default) keeps the shown props in the block. */
  | {
      type: "component.binding.remove";
      blockId: string;
      keep?: "snapshot" | "local";
    }
  /** Native shapes and bound arrows from nodes and edges, laid out when unpositioned. */
  | ({ type: "diagram.insert" } & DiagramInsertInput)
  /** Lay out existing connected objects along their arrows, as the editor's arrange command does. */
  | { type: "diagram.arrange"; nodeIds: string[]; direction?: DiagramDirection };

/**
 * Fields of each page operation, for argument checks, error messages and the
 * test that keeps documented examples current. The type ties every entry to
 * PageOperation.
 */
export const PAGE_OPERATION_FIELDS = {
  "component.insert": ["kind", "data", "parentId", "afterId"],
  "surface.upgrade": [],
  "surface.create": ["kind", "name", "nodeId", "parentId"],
  "surface.wrap": ["nodeId", "kind"],
  "surface.layout.set": ["nodeId", "layout"],
  "surface.view.save": ["surfaceId", "view", "initial"],
  "surface.view.remove": ["surfaceId", "viewId"],
  "surface.reading-order.set": ["surfaceId", "nodeIds"],
  "page.set": ["fields"],
  "block.insert": ["node", "parentId", "afterId"],
  "block.remove": ["blockId"],
  "block.replace": ["blockId", "node"],
  "block.move": ["blockId", "parentId", "afterId"],
  "block.attrs.set": ["blockId", "attrs"],
  "component.props.set": ["blockId", "props"],
  "block.text.set": ["blockId", "text"],
  "component.ref.set": ["blockId", "componentId", "version", "integrity"],
  "component.binding.set": ["blockId", "binding"],
  "component.binding.remove": ["blockId", "keep"],
  "diagram.insert": [
    "parentId",
    "direction",
    "origin",
    "spacing",
    "nodes",
    "edges",
  ],
  "diagram.arrange": ["nodeIds", "direction"],
} as const satisfies {
  [K in PageOperation["type"]]: readonly Exclude<
    keyof Extract<PageOperation, { type: K }>,
    "type"
  >[];
};

export interface ApplyPageInput {
  baseRevision?: string;
  baseHash: string;
  operations: PageOperation[];
  /**
   * Dataset hashes ("projectId/datasetId" or datasetId → hash) the writer read
   * for bound blocks; defaults to this session's last read of each dataset.
   */
  datasetBases?: Record<string, string>;
}

export interface FieldChange {
  field: string;
  before?: unknown;
  after?: unknown;
}

export type PageChange =
  | { type: "page.changed"; fields: FieldChange[] }
  | {
      type: "block.added";
      blockId: string;
      parentId: string | null;
      afterId: string | null;
      node: JSONContent;
    }
  | {
      type: "block.removed";
      blockId: string;
      parentId: string | null;
      node: JSONContent;
    }
  | { type: "block.changed"; blockId: string; fields: FieldChange[] }
  | {
      type: "block.moved";
      blockId: string;
      parentId: string | null;
      afterId: string | null;
    };

export interface PageDiff {
  baseRevision?: string;
  currentRevision?: string;
  projectId: string;
  pageId: string;
  baseHash: string;
  currentHash: string;
  changed: boolean;
  changes: PageChange[];
}

export type CoreErrorCode =
  | "SNAPSHOT_EXPIRED"
  | "NOT_FOUND"
  | "CONFLICT"
  | "MISSING_BASELINE"
  | "INVALID_PATH"
  | "INVALID_DATA"
  | "LOCKED"
  /** A dataset's linked external file cannot be read on this device. */
  | "SOURCE_UNAVAILABLE"
  /** The action needs the person's decision first; details describe it. */
  | "CONFIRMATION_REQUIRED";

export class CoreError extends Error {
  readonly code: CoreErrorCode;
  readonly currentHash?: string;
  readonly currentRevision?: string;
  readonly conflictId?: string;
  /** Structured facts for the caller, e.g. the conflicting fields of a dataset write. */
  details?: Record<string, unknown>;
  /** A specific next step that replaces the generic guidance for this code. */
  nextStep?: string;
  saveFailed?: boolean;
  recovery?: {
    action: "read-compare-save";
    projectId?: string;
    pageId?: string;
    baseRevision?: string;
  };

  constructor(
    code: CoreErrorCode,
    message: string,
    details: {
      currentHash?: string;
      currentRevision?: string;
      conflictId?: string;
    } = {},
  ) {
    super(message);
    this.name = "CoreError";
    this.code = code;
    this.currentHash = details.currentHash;
    this.currentRevision = details.currentRevision;
    this.conflictId = details.conflictId;
  }
}
