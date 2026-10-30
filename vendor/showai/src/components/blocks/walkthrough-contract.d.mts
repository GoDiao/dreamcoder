import type { DiagramTone } from "./doc-diagrams-contract.mjs";

export type EntryStatus = "new" | "changed" | "retired" | "kept";
export type ActionKind = "input" | "action" | "result" | "note";
export type WalkthroughPart = {
  id: string;
  label: string;
  plain?: string;
  how?: string;
  tone?: DiagramTone;
};
export type WalkthroughAction = {
  actor: string;
  text: string;
  code?: string;
  kind?: ActionKind;
  illustrative?: boolean;
};
export type WalkthroughEntry = {
  id: string;
  partId: string;
  title: string;
  status: EntryStatus;
  statusLabel?: string;
  fields: { label: string; value: string; mono?: boolean }[];
  note?: string;
};
export type WalkthroughOutput = {
  heading: string;
  blocks: {
    id: string;
    partId?: string;
    label: string;
    text: string;
    callouts?: string[];
  }[];
  hidePartId?: string;
  hideLabel?: string;
  hideNote?: string;
};
export type WalkthroughStep = {
  id: string;
  label: string;
  takeaway: string;
  actionsHeading?: string;
  actions: WalkthroughAction[];
  entries?: WalkthroughEntry[];
  partNotes?: { partId: string; text: string }[];
  output?: WalkthroughOutput;
  details?: string[];
  sources?: { label: string; url: string }[];
};
export type WalkthroughData = {
  title: string;
  question?: string;
  note?: string;
  stateHeading?: string;
  parts: WalkthroughPart[];
  initialStep?: string;
  steps: WalkthroughStep[];
};
export declare const ENTRY_STATUSES: readonly EntryStatus[];
export declare const ACTION_KINDS: readonly ActionKind[];
export declare const WALKTHROUGH_LIMITS: Record<
  | "parts"
  | "steps"
  | "actions"
  | "entries"
  | "fields"
  | "blocks"
  | "callouts"
  | "details"
  | "sources",
  number
>;
export declare function validateWalkthroughData(data: unknown): WalkthroughData;
export declare function summarizeWalkthrough(data: WalkthroughData): {
  id: string;
  parts: {
    id: string;
    total: number;
    active: number;
    new: number;
    changed: number;
    retired: number;
  }[];
  outputBlocks: string[];
}[];
