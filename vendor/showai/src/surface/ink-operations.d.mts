import type { JSONContent } from "@tiptap/core";
import type { NodeLayout } from "./types";
import type { PortableInk } from "./portable-ink.mjs";
export const INK_OPERATION_FORMAT: "showai-ink-operation-v1";
export const INK_CHECKPOINT_FORMAT: "showai-ink-checkpoint-v1";
export type InkEditPatch = {
  ink?: PortableInk | null;
  inkFragments?: PortableInk[] | null;
  color?: string | null;
  strokeWidth?: number | null;
  pressure?: boolean | null;
  /** Node structure/metadata excluding ink, color, strokeWidth and pressure. */
  node?: JSONContent;
  layout?: NodeLayout;
  placement?: { parentId: string; after: string | null; before: string | null };
};
export type InkOperationChange =
  | { kind: "create"; strokeId: string; node: JSONContent; layout: NodeLayout; placement?: InkEditPatch["placement"] }
  | { kind: "edit"; strokeId: string; patch: InkEditPatch }
  | { kind: "delete" | "restore"; strokeId: string };
export interface InkOperationIdentity { actor: string; sequence: number }
export interface InkOperation extends InkOperationIdentity {
  format: typeof INK_OPERATION_FORMAT;
  id: string;
  pageId: string;
  boardId: string;
  parents: string[];
  changes: InkOperationChange[];
}
export interface InkRegisterEntry { operationId: string; value: unknown }
export interface InkOperationConflict {
  strokeId: string;
  field: string;
  candidates: InkRegisterEntry[];
}
export interface InkOperationCheckpoint {
  format: typeof INK_CHECKPOINT_FORMAT;
  pageId: string;
  boardId: string;
  frontier: string[];
  known: Record<string, { hash: string | null; clock: Record<string, number>; level: number; anchor?: boolean; partial?: boolean; sourceHash?: string }>;
  strokes: {
    id: string;
    creationId: string;
    creationOrder: [number, string, number];
    registers: Record<string, InkRegisterEntry[]>;
  }[];
}
export interface InkMaterialization {
  pageId: string;
  boardId: string;
  frontier: string[];
  strokes: {
    id: string;
    node: JSONContent;
    layout: NodeLayout;
    placement?: InkEditPatch["placement"];
    deleted: boolean;
    heads: Record<string, string[]>;
    conflicts: InkOperationConflict[];
  }[];
  conflicts: InkOperationConflict[];
  tombstones: string[];
}
export interface InkReplicaRecord {
  kind: "known" | "stroke" | "register";
  key: string;
  field: string;
  value: unknown;
}
export interface InkUndoRecord {
  changes: InkOperationChange[];
  beforeHeads?: Record<string, Record<string, { operationId: string; valueHash: string }[]>>;
}
export interface InkReplicaPrepared {
  token: string;
  records: InkReplicaRecord[];
  frontier: string[];
  appendedIds: string[];
  clock: Record<string, number>;
  undo?: Record<string, InkUndoRecord>;
}
export class InkOperationReplica {
  constructor(value: { pageId?: string; boardId?: string; checkpoint?: InkOperationCheckpoint });
  readonly pageId: string;
  readonly boardId: string;
  readonly frontier: Set<string>;
  prepare(operations: InkOperation[]): InkReplicaPrepared;
  prepareImport(checkpoint: InkOperationCheckpoint): InkReplicaPrepared;
  actorSequence(actor: string): number;
  compensationGroupPlan(sources: {operation: InkOperation; undo: InkUndoRecord}[]): {pageId: string; boardId: string; changes: InkOperationChange[]; phases: InkOperationChange[][]; parents: string[]; skipped: {strokeId: string; field: string; reason: string}[]};
  compensationPlan(operation: InkOperation, inverse: { changes: InkOperationChange[] }): { pageId: string; boardId: string; changes: InkOperationChange[]; parents: string[]; skipped: { strokeId: string; field: string }[] };
  commit(token: string): { frontier: string[]; version: number };
  abort(token: string): void;
  append(operations: InkOperation[]): InkReplicaPrepared;
  checkpoint(): InkOperationCheckpoint;
  projectionIndex(): {id:string;born:[number,string,number];placement?:InkEditPatch["placement"]}[];
  sparseCheckpoint(ids: string[]): {checkpoint: InkOperationCheckpoint; clock: Record<string,number>; level:number};
  materialize(ids?: string[]): InkMaterialization;
}
export function inkCheckpointRecords(checkpoint: InkOperationCheckpoint): InkReplicaRecord[];
export function inkCheckpointFromRecords(value: { pageId: string; boardId: string; frontier: string[]; records: InkReplicaRecord[] }): InkOperationCheckpoint;
export type InkJournalEvent = { ordinal: number } & ({ kind: "operation"; operation: InkOperation } | { kind: "import"; delta: { records: InkReplicaRecord[]; frontier: string[]; clock: Record<string, number> } });
export function replayInkJournalEvents(scope: { pageId: string; boardId: string }, events: InkJournalEvent[]): InkOperationCheckpoint;
export function canonicalInkJSON(value: unknown): string;
export function inkOperationDigest(value: unknown): string;
/** SHA-256 of UTF-8 input, replacing isolated surrogates and preserving normalization. */
export function installInkDigestProvider(provider: ((source:string)=>string)|null): void;
export function inkNodeMetadata(node: JSONContent): JSONContent;
export function validateInkCheckpoint(value: unknown): InkOperationCheckpoint;
export function emptyInkCheckpoint(scope: { pageId: string; boardId: string }): InkOperationCheckpoint;
export function validateInkOperation(value: unknown): InkOperation;
export function createInkOperation(value: InkOperationIdentity & {
  pageId: string; boardId: string; parents?: string[]; changes: InkOperationChange[];
}): InkOperation;
export function bootstrapInkOperation(value: {
  actor?: string; pageId: string; boardId: string; nodes: JSONContent[]; layout: Record<string, NodeLayout>;
}): InkOperation | null;
export function checkpointInkOperations(operations: InkOperation[], checkpoint?: InkOperationCheckpoint): InkOperationCheckpoint;
export function materializeInkOperations(operations: InkOperation[], checkpoint?: InkOperationCheckpoint): InkMaterialization;
export function compensateInkOperation(operations: InkOperation[], operationId: string, identity: InkOperationIdentity): {
  operation: InkOperation | null; skipped: { strokeId: string; field: string }[];
};
export function inkCompensationPlan(operations: InkOperation[], operationId: string): {
  pageId: string; boardId: string; changes: InkOperationChange[]; parents: string[];
  skipped: { strokeId: string; field: string }[];
};

export function validateInkOperationField(name: string, value: unknown): void;
