import { z } from 'zod/v4'

export function semanticArray<T extends z.ZodType>(inner: T) {
  return z.preprocess((value: unknown, ctx) => {
    if (typeof value !== 'string' || !value.trimStart().startsWith('[')) return value
    try {
      const parsed: unknown = JSON.parse(value)
      return Array.isArray(parsed) ? parsed : value
    } catch (error) {
      ctx.addIssue({
        code: 'custom',
        message: `This parameter was sent as a string that is not valid JSON (${error instanceof Error ? error.message : String(error)}; the string is ${value.length} characters long, so it may be cut off). Send it as a JSON array, not a string, and keep each call small: create the page with a few blocks and add the rest with component.insert.`,
      })
      return z.NEVER
    }
  }, inner)
}
