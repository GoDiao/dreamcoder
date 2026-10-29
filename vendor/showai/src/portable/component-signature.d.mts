import type { JsonSchema } from "../components/custom/types";
/** Default character limit of a component signature line. */
export const COMPONENT_SIGNATURE_LIMIT: 320;
/**
 * Deterministic one-line type summary of a component's props schema:
 * `id { required: type, optional?: type }`. Nested structures collapse to
 * `{…}` and trailing fields to `…` when the line would exceed the limit.
 */
export function componentSignature(
  id: string,
  schema: JsonSchema | undefined,
  limit?: number,
): string;
