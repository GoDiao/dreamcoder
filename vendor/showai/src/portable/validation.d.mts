import type { ShowArtifact, ShowDocument } from "../types";
import type { CompiledComponent } from "../components/custom/types";
import type { PublishedComponentLocator } from "./publication-types";
/** Compatibility artifact import budget; page and resource limits are in CAPACITY. */
export const MAX_ARTIFACT_BYTES: number;
export const ARTIFACT_DATA_ID: string;
export function isSafeUrl(value: unknown, image?: boolean): boolean;
export function validateDocument(value: unknown): ShowDocument;
export function isDocumentTimestamp(value: unknown): boolean;
/** Internal trusted adapter: held body must come from the actual source registry. */
export function parseArtifactWithValidatedDocument(input: unknown, heldDocument: ShowDocument): ShowArtifact;
export function parseArtifact(input: unknown): ShowArtifact;
/** Internal backend parser; consumes its exclusively held JSON.parse graph. */
export function parseArtifactConsumingDocument(input: unknown): ShowArtifact;
export function serializeArtifact(
  document: ShowDocument,
  components?: CompiledComponent[],
  remoteComponents?: PublishedComponentLocator[],
  presentation?: "spatial" | "reading",
  selection?: ShowArtifact["selection"],
): string;
export function escapeJsonForHtml(value: unknown): string;
export function injectArtifactIntoHtml(
  template: string,
  document: ShowDocument,
  components?: CompiledComponent[],
  remoteComponents?: PublishedComponentLocator[],
  presentation?: "spatial" | "reading",
  selection?: ShowArtifact["selection"],
): string;
/** Internal closed source factories; canonical document is recursively owned before escape. */
export function parseArtifactForSourceSnapshot(input:unknown):ShowArtifact;
export function parseArtifactConsumingForSourceSnapshot(input:unknown,observer?:(stage:string,milliseconds:number)=>void):ShowArtifact;
export function shareSourceSnapshotDocument<T extends ShowDocument>(base:T,canonical:T):T;
export function inheritSourceSnapshotTimestampCapacity(base:ShowDocument,body:ShowDocument):boolean;
/** Actual saved backend result only; always measures complete final body. */
export function assertOwnedSourceDocumentCapacity(body:ShowDocument):import("./capacity.mjs").ContentSize;

/** Read-only presence check, never a caller-provided proof. */
export function hasSourceSnapshotCapacity(body:unknown):boolean;
