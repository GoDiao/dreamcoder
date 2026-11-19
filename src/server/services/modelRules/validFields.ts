import type { z } from 'zod'

type ValidFields<Shape extends Record<string, z.ZodType>> = { [Field in keyof Shape]?: z.output<Shape[Field]> }

export function validFields<Shape extends Record<string, z.ZodType>>(
  raw: Record<string, unknown>,
  shape: Shape,
  onInvalid: (field: string) => void = () => {},
): ValidFields<Shape> {
  const fields: ValidFields<Shape> = {}
  for (const [field, value] of Object.entries(raw)) {
    const parsed = Object.hasOwn(shape, field) ? shape[field]!.safeParse(value) : undefined
    if (!parsed?.success) onInvalid(field)
    else if (parsed.data !== undefined) fields[field as keyof Shape] = parsed.data as z.output<Shape[keyof Shape]>
  }
  return fields
}
