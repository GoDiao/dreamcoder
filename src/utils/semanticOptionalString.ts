import { z } from 'zod/v4'

export function semanticOptionalString<T extends z.ZodType>(inner: T) {
  return z.preprocess((value: unknown) => (value === '' ? undefined : value), inner)
}
