export const MAX_UPLOAD_BYTES: number;
export function resourceMime(kind: string, value: unknown): string | undefined;
export function safeResourceUrl(
  kind: string,
  value: unknown,
): string | undefined;
export function fileMime(
  kind: string,
  file: { name: string; type: string },
): string | undefined;
export function referenceUrl(item: {
  doi?: string;
  url?: string;
}): string | undefined;
export function validateResearchData(
  kind: string,
  data: Record<string, unknown>,
): void;
