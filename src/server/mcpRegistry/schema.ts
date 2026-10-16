import { z } from 'zod'

export const REGISTRY_VERSION = 1

export const REGISTRY_TRANSPORTS = ['stdio'] as const

export const envVarSchema = z
  .object({
    name: z
      .string()
      .regex(/^[A-Z_][A-Z0-9_]*$/, 'env.name must be SCREAMING_SNAKE_CASE'),
    source: z.enum(['user', 'system', 'optional']),
    description: z.string().max(200).optional(),
  })
  .strict()

const EXACT_VERSION_PIN =
  /^v?\d+(?:\.\d+){1,2}(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/

export const registryEntrySchema = z
  .object({
    id: z
      .string()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'id must be lowercase-dash-separated'),
    name: z.string().min(1).max(80),
    description: z.string().min(10).max(500),
    transport: z.enum(REGISTRY_TRANSPORTS),
    command: z
      .string()
      .min(1)
      .refine(
        (v) => !v.startsWith('/') && !/^([a-zA-Z]:\\|\\\\)/.test(v),
        'command must be a package name or relative path, not an absolute path',
      )
      .refine(
        (v) => !/[;&|`$><\n]/.test(v),
        'command must not contain shell metacharacters',
      ),
    args: z.array(z.string()).default([]),
    env: z.array(envVarSchema).default([]),
    homepage: z.string().url(),
    tags: z.array(z.string().regex(/^[a-z0-9-]+$/)).min(1),
    runtime: z.enum(['node', 'bun', 'python', 'uvx', 'binary']),
    version: z.string().regex(/^[\w.\-+~]+$/).optional(),
    notes: z.string().max(300).optional(),
  })
  .strict()
  .refine(
    (e) =>
      e.runtime !== 'binary' ||
      (typeof e.version === 'string' && EXACT_VERSION_PIN.test(e.version)),
    {
      message:
        'runtime "binary" entries require an exact version pin (e.g. "2.31.0"), not a moving tag or range like "latest" or "~2.31.0"',
      path: ['version'],
    },
  )
  .refine(
    (e) =>
      !e.env.some((v) => Object.prototype.hasOwnProperty.call(v as object, 'value')) &&
      !e.args.some((a) => /(?:=|^)(?:sk-|ghp_|AKIA)[A-Za-z0-9_\-]{8,}/.test(a)),
    { message: 'registry entries must never contain secret values', path: ['env'] },
  )

export const registrySchema = z
  .object({
    version: z.literal(REGISTRY_VERSION),
    servers: z.array(registryEntrySchema).min(1),
  })
  .strict()
  .superRefine((reg, ctx) => {
    const seen = new Set<string>()
    reg.servers.forEach((s, i) => {
      if (seen.has(s.id)) {
        ctx.addIssue({
          code: 'custom',
          message: `duplicate entry id "${s.id}"`,
          path: ['servers', i, 'id'],
        })
      }
      seen.add(s.id)
    })
  })

export type RegistryEntry = z.infer<typeof registryEntrySchema>
export type Registry = z.infer<typeof registrySchema>

export function validateRegistry(
  input: unknown,
): { ok: true; data: Registry } | { ok: false; errors: RegistryIssue[] } {
  const result = registrySchema.safeParse(input)
  if (result.success) return { ok: true, data: result.data }

  const errors: RegistryIssue[] = result.error.issues.map((issue) => ({
    path: issue.path.join('.') || '(root)',
    message: issue.message,
  }))
  return { ok: false, errors }
}

export function validateEntry(
  input: unknown,
): { ok: true; data: RegistryEntry } | { ok: false; errors: RegistryIssue[] } {
  const result = registryEntrySchema.safeParse(input)
  if (result.success) return { ok: true, data: result.data }
  return {
    ok: false,
    errors: result.error.issues.map((issue) => ({
      path: issue.path.join('.') || '(root)',
      message: issue.message,
    })),
  }
}

export interface RegistryIssue {
  path: string
  message: string
}