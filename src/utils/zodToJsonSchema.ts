/**
 * Converts Zod v4 schemas to JSON Schema using native toJSONSchema.
 */

import { toJSONSchema, type ZodTypeAny } from 'zod/v4'

export type JsonSchema7Type = Record<string, unknown>

// toolToAPISchema() runs this for every tool on every API request (~60-250
// times/turn). Tool schemas are wrapped with lazySchema() which guarantees the
// same ZodTypeAny reference per session, so we can cache by identity.
const cache = new WeakMap<ZodTypeAny, JsonSchema7Type>()

function makeDefaultedPropertiesOptional(node: {
  properties?: Record<string, unknown>
  required?: string[]
}): void {
  if (!node.required) return
  const required = node.required.filter(key => {
    const property = node.properties?.[key]
    return !(typeof property === 'object' && property && 'default' in property)
  })
  if (required.length > 0) node.required = required
  else delete node.required
}

/**
 * Converts a Zod v4 schema to JSON Schema format.
 */
export function zodToJsonSchema(schema: ZodTypeAny): JsonSchema7Type {
  const hit = cache.get(schema)
  if (hit) return hit
  const result = toJSONSchema(schema, {
    override: ({ jsonSchema }) => makeDefaultedPropertiesOptional(jsonSchema),
  }) as JsonSchema7Type
  cache.set(schema, result)
  return result
}
