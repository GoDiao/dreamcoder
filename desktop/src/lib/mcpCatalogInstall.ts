import type { McpCatalogEntry, McpEditableConfig, McpWritableScope } from '../types/mcp'

export function catalogScopeIsShadowed(scope: McpWritableScope, existingScope: string) {
  return (scope === 'user' && (existingScope === 'local' || existingScope === 'project')) ||
    (scope === 'project' && existingScope === 'local')
}

type InstallErrorCode =
  | 'unsupportedRuntime'
  | 'invalidPackage'
  | 'invalidVersion'
  | 'invalidEnvironment'
  | 'invalidArguments'
  | 'missingEnvironment'
  | 'unsafeValue'

type InstallResult =
  | { ok: true; config: Extract<McpEditableConfig, { type: 'stdio' }> }
  | { ok: false; error: { code: InstallErrorCode; name?: string } }

const ENVIRONMENT_NAME = /^[A-Z_][A-Z0-9_]*$/
const NPM_PACKAGE = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/
const PYTHON_PACKAGE = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/
const NPM_VERSION = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/
// A conservative subset of exact PEP 440 versions; never accept ranges or tags.
const PYTHON_VERSION = /^\d+(?:\.\d+)*(?:(?:a|b|rc)\d+)?(?:\.post\d+)?(?:\.dev\d+)?(?:\+[A-Za-z0-9]+(?:[._-][A-Za-z0-9]+)*)?$/

function failure(code: InstallErrorCode, name?: string): InstallResult {
  return { ok: false, error: { code, ...(name ? { name } : {}) } }
}

function matchesEntire(pattern: RegExp, value: string) {
  // JavaScript's $ also matches before a final newline.
  return pattern.exec(value)?.[0] === value
}

function hasUnsafeValue(value: string) {
  // Native MCP loading expands ${...} against the host environment. There is
  // no proven literal escape for it, so do not save a value that could change.
  return value.includes('\0') || value.includes('${')
}

/** Build a reviewed stdio configuration without reading the host or executing it. */
export function prepareCatalogInstall(
  entry: McpCatalogEntry,
  values: Record<string, string>,
): InstallResult {
  if (entry.runtime !== 'node' && entry.runtime !== 'bun' && entry.runtime !== 'uvx') {
    return failure('unsupportedRuntime')
  }

  const python = entry.runtime === 'uvx'
  const packagePattern = python ? PYTHON_PACKAGE : NPM_PACKAGE
  if (typeof entry.command !== 'string' || !matchesEntire(packagePattern, entry.command) || entry.command.length > 214) {
    return failure('invalidPackage')
  }
  if (entry.version !== undefined && (
    typeof entry.version !== 'string' || !matchesEntire(python ? PYTHON_VERSION : NPM_VERSION, entry.version)
  )) {
    return failure('invalidVersion')
  }

  if (!Array.isArray(entry.env) || !values || typeof values !== 'object' || Array.isArray(values)) {
    return failure('invalidEnvironment')
  }
  const declarations = new Map<string, McpCatalogEntry['env'][number]>()
  for (const variable of entry.env) {
    if (!variable || typeof variable.name !== 'string' || !matchesEntire(ENVIRONMENT_NAME, variable.name)) {
      return failure('invalidEnvironment')
    }
    if (declarations.has(variable.name) || !['user', 'system', 'optional'].includes(variable.source)) {
      return failure('invalidEnvironment', variable.name)
    }
    declarations.set(variable.name, variable)
  }

  if (entry.transport !== 'stdio' || !Array.isArray(entry.args)) return failure('invalidArguments')
  const referenced = new Set<string>()
  for (const argument of entry.args) {
    if (typeof argument !== 'string' || !argument.trim() || hasUnsafeValue(argument)) {
      return failure('invalidArguments')
    }
    // Reserve braces for the catalog placeholder syntax. Reject malformed
    // templates instead of silently persisting unresolved or partial values.
    for (const match of argument.matchAll(/\{env:([A-Z_][A-Z0-9_]*)\}|[{}]/g)) {
      const name = match[1]
      if (!name) return failure('invalidArguments')
      if (!declarations.has(name)) return failure('invalidArguments', name)
      referenced.add(name)
    }
  }

  const supplied = new Map<string, string>()
  for (const [name, variable] of declarations) {
    const value = Object.prototype.hasOwnProperty.call(values, name) ? values[name] : undefined
    if (value !== undefined && typeof value !== 'string') return failure('invalidEnvironment', name)
    if (value !== undefined && hasUnsafeValue(value)) return failure('unsafeValue', name)
    if (value === undefined || !value.trim()) {
      // System inputs also require explicit review; this function never reads
      // process.env or guesses which variables a packaged app inherits.
      if (variable.source !== 'optional' || referenced.has(name)) return failure('missingEnvironment', name)
      continue
    }
    supplied.set(name, value)
  }

  const args = entry.args.map((argument) => argument.replace(
    /\{env:([A-Z_][A-Z0-9_]*)\}/g,
    (_placeholder, name: string) => supplied.get(name)!,
  ))
  // Adjacent substitutions can assemble native interpolation even when each
  // input was safe in isolation (for example "$" followed by "{HOST_VAR}").
  if (args.some(hasUnsafeValue)) return failure('unsafeValue')
  const packageSpecifier = `${entry.command}${entry.version ? `@${entry.version}` : ''}`
  const command = entry.runtime === 'node' ? 'npx' : entry.runtime === 'bun' ? 'bun' : 'uvx'
  const runnerArgs = entry.runtime === 'node'
    ? ['--yes', '--', packageSpecifier]
    : entry.runtime === 'bun'
      ? ['x', '--bun', packageSpecifier]
      : ['--no-python-downloads', packageSpecifier]

  return {
    ok: true,
    config: {
      type: 'stdio',
      command,
      args: [...runnerArgs, ...args],
      env: Object.fromEntries(supplied),
    },
  }
}
