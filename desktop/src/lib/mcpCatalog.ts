import { validateRegistry, type Registry, type RegistryEntry, type RegistryIssue } from '../../../sidecar/mcp-registry/schema'

export type { RegistryEntry }

export class InvalidMcpCatalogError extends Error {
  constructor(readonly issues: RegistryIssue[]) {
    super('The bundled MCP catalog is invalid')
    this.name = 'InvalidMcpCatalogError'
  }
}

export function parseMcpCatalog(raw: string): Registry {
  let input: unknown
  try {
    input = JSON.parse(raw)
  } catch {
    throw new InvalidMcpCatalogError([{ path: '(root)', message: 'Expected valid JSON' }])
  }
  const result = validateRegistry(input)
  if (!result.ok) throw new InvalidMcpCatalogError(result.errors)

  // The shared schema accepts any URL; only web URLs may be opened by the UI.
  const unsafeLinks = result.data.servers.flatMap((entry, index) => (
    ['https:', 'http:'].includes(new URL(entry.homepage).protocol)
      ? []
      : [{ path: `servers.${index}.homepage`, message: 'Homepage must use HTTP or HTTPS' }]
  ))
  if (unsafeLinks.length) throw new InvalidMcpCatalogError(unsafeLinks)
  return result.data
}

export async function loadMcpCatalog(): Promise<Registry> {
  // Vite emits this import inside frontendDist for both dev and packaged Tauri.
  // No repository-relative fetch, sidecar filesystem access, or network is needed.
  const { default: raw } = await import('../../../mcp-registry.json?raw')
  return parseMcpCatalog(raw)
}

export function filterMcpCatalog(entries: RegistryEntry[], query: string, tag: string): RegistryEntry[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  return entries.filter((entry) => {
    if (tag && !entry.tags.includes(tag)) return false
    const text = [entry.id, entry.name, entry.description, entry.command, entry.runtime, ...entry.tags, ...entry.env.map((env) => env.name)].join(' ').toLowerCase()
    return terms.every((term) => text.includes(term))
  })
}

export function hasInstalledCatalogName(entry: RegistryEntry, installedNames: ReadonlySet<string>): boolean {
  return installedNames.has(entry.id) || installedNames.has(entry.name)
}
