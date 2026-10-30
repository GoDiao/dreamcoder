import type {
  CompiledComponent,
  PackageRevisionRef,
} from "../components/custom/types";
import type { PublishedComponentLocator } from "./publication-types";
export const MAX_PUBLICATION_BUNDLE_BYTES: number;
export function publicationRefKey(ref: PackageRevisionRef): string;
export function validatePublicationRef(
  value: unknown,
  kind?: "component" | "template",
): PackageRevisionRef;
export function publicationUrl(value: unknown): string;
export function validateRemoteComponents(
  input: unknown,
): PublishedComponentLocator[];
export function sha256Bytes(bytes: Uint8Array): Promise<string>;
export function fetchPublicationFile(
  url: string,
  options?: { signal?: AbortSignal; maxBytes?: number; requireCors?: boolean },
): Promise<{
  bytes: Uint8Array;
  text: string;
  sha256: string;
  cors: string | null;
}>;
export function loadRemoteComponents(
  locators: PublishedComponentLocator[],
  options?: { signal?: AbortSignal },
): Promise<CompiledComponent[]>;
