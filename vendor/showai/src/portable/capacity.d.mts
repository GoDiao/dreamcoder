export const CAPACITY: Readonly<{
  pageStructureBytes: number;
  resourceBytes: number;
  pageResourceBytes: number;
  componentPropsBytes: number;
  datasetBytes: number;
  componentSourceBytes: number;
  componentAssetBytes: number;
  componentFiles: number;
  compiledComponentBytes: number;
  artifactBytes: number;
  htmlBytes: number;
  authoringRequestBytes: number;
  publicationBytes: number;
  publicationTransferBytes: number;
  syncManifestBytes: number;
  syncObjectBytes: number;
  chatBytes: number;
  mcpImageBytes: number;
}>;
export function utf8Bytes(value: string): number;
export function formatBytes(bytes: number): string;
export class CapacityError extends Error {
  code: string;
  kind: string;
  actualBytes: number;
  limitBytes: number;
  constructor(kind: string, actualBytes: number, limitBytes: number);
}
export function assertBytes(kind: string, bytes: number, maximum: number): void;
export function base64Bytes(encoded: string): number;
/** Pure classifier; it does not attach an owned capacity proof or admit bytes. */
export function dataUrlContent(
  value: unknown,
): { value: string; bytes: number; structureBytes: number } | null;
export interface ContentSize {
  structureBytes: number;
  resourceBytes: number;
  resourceCount: number;
  jsonBytes: number;
  prettyJsonBytes: number;
}
export function measureContent(value: unknown): ContentSize;
/** Internal traversal evidence; null for reports not produced by measureContent. */
export function contentMeasurementDepth(report: ContentSize): number | null;
/** Byte comparison, not a document validation proof. */
export function nonResourceReplacementDoesNotGrow(
  before: unknown,
  after: unknown,
): boolean;
export function assertContent(
  value: unknown,
  kind?: string,
  maximum?: number,
): ContentSize;
export function assertContentSizes(
  sizes: ContentSize,
  kind?: string,
  maximum?: number,
): ContentSize;
export function assertCompiledComponent(component: {
  html: string;
  inline?: { script: string; styles: string };
}): void;
export function assertPackageFiles(
  files: Iterable<[string, number, boolean]>,
): { sourceBytes: number; assetBytes: number; files: number };
export function readCapacityText(
  request: Request,
  maximum: number,
  kind: string,
): Promise<string>;
