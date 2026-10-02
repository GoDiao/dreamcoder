/**
 * MCP curated registry — versioned contract for DreamCoder-curated MCP servers.
 *
 * Scope (issue #44): v1 deliberately covers `stdio` servers only. HTTP/SSE
 * catalog entries are out of scope until the install flow can express them.
 *
 * Security contract:
 * - Entries NEVER carry secret values. `env` declares variable names and
 *   whether a value is required; the actual secret is supplied by the user
 *   at install time (or from their OS keychain) and must not be committed.
 * - `command` must be an executable name or a relative path. Absolute paths
 *   and shell metacharacters are rejected so a catalog entry cannot be used
 *   to execute an arbitrary path chosen by whoever edits the catalog.
 */

import { z } from 'zod'

/** Registry format version. Bump when the entry contract changes. */
export const REGISTRY_VERSION = 1

/** Transports allowed in v1. */
export const REGISTRY_TRANSPORTS = ['stdio'] as const

/**
 * A single environment variable requirement. Carries the variable name and
 * how it is obtained — never the value itself.
 */
export const envVarSchema = z
  .object({
    /** Variable name, e.g. `BRAVE_API_KEY`. */
    name: z
      .string()
      .regex(/^[A-Z_][A-Z0-9_]*$/, 'env.name must be SCREAMING_SNAKE_CASE'),
    /**
     * How the user supplies the value.
     * - `user`: shown as a prompt during install.
     * - `system`: read from the user's existing environment.
     * - `optional`: not required for the server to start.
     */
    source: z.enum(['user', 'system', 'optional']),
    /** One-line hint shown next to the prompt. */
    description: z.string().max(200).optional(),
  })
  .strict()

/**
 * A single curated MCP server entry.
 *
 * `id` is the stable identifier: lowercase, dash-separated, and never reused
 * for a different server. Rename a server's display name freely, but treat a
 * change to `id` as a breaking change to downstream consumers.
 */
export const registryEntrySchema = z
  .object({
    /** Stable identifier, e.g. `brave-search`. */
    id: z
      .string()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'id must be lowercase-dash-separated'),
    /** Human-readable name shown in UI. */
    name: z.string().min(1).max(80),
    /** What the server does. Should say what a user gets, not how it works. */
    description: z.string().min(10).max(500),
    /** Transport type. v1 is stdio-only. */
    transport: z.enum(REGISTRY_TRANSPORTS),
    /** Executable to run: an npm/bun package name, or a relative path. */
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
    /** Arguments passed to the command. Values may reference {env:NAME}. */
    args: z.array(z.string()).default([]),
    /**
     * Environment requirements. Declares names and prompts only — an entry
     * that looks like it carries a value is rejected by the guard below.
     */
    env: z.array(envVarSchema).default([]),
    /** Project homepage or repository. */
    homepage: z.string().url(),
    /** Discovery tags, lowercase. */
    tags: z.array(z.string().regex(/^[a-z0-9-]+$/)).min(1),
    /**
     * Runtime requirement for the command. Required so a catalog entry can be
     * rejected up front instead of failing at spawn time.
     */
    runtime: z.enum(['node', 'bun', 'python', 'uvx', 'binary']),
    /**
     * Version pin policy for `runtime: binary` entries. The registry prefers
     * exact pins so a catalog install cannot silently pull new code.
     */
    version: z.string().regex(/^[\w.\-+~]+$/).optional(),
    /** Optional maintainer note, e.g. why an entry was curated. */
    notes: z.string().max(300).optional(),
  })
  .strict()
  // A binary entry without a pin can change behaviour on every install.
  .refine((e) => e.runtime !== 'binary' || !!e.version, {
    message: 'runtime "binary" entries require an exact version pin',
    path: ['version'],
  })
  // Guard against a secret being smuggled into the catalog.
  .refine(
    (e) =>
      !e.env.some((v) => Object.prototype.hasOwnProperty.call(v as object, 'value')) &&
      !e.args.some((a) => /(?:=|^)(?:sk-|ghp_|AKIA)[A-Za-z0-9_\-]{8,}/.test(a)),
    { message: 'registry entries must never contain secret values', path: ['env'] },
  )

/** The registry document itself. */
export const registrySchema = z
  .object({
    /** Registry format version. Must match REGISTRY_VERSION for now. */
    version: z.literal(REGISTRY_VERSION),
    /** Entries, unique by `id`. Enforced below. */
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

/**
 * Validate a registry document.
 *
 * Returns a discriminated result rather than throwing, so callers (CLI, CI,
 * future Browse UI) can surface every problem at once instead of dying on the
 * first bad entry.
 */
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

/** Validate a single entry in isolation — used by contributor tooling. */
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
  /** Dotted path to the offending field. */
  path: string
  /** Human-readable, actionable message. */
  message: string
}