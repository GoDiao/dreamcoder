import catalogJson from '../../../mcp-registry.json'
import { validateRegistry, type Registry, type RegistryIssue } from './schema.js'

export type CatalogResult =
  | { ok: true; catalog: Registry }
  | { ok: false; errors: RegistryIssue[] }

/**
 * The JSON import is intentional: Bun embeds it in the compiled desktop
 * sidecar, so the catalog is available both from the repository and from a
 * packaged Tauri installation.
 */
export function loadCuratedMcpCatalog(input: unknown = catalogJson): CatalogResult {
  const result = validateRegistry(input)
  return result.ok
    ? { ok: true, catalog: result.data }
    : { ok: false, errors: result.errors }
}
