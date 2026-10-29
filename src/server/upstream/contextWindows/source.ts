export type ContextWindowRequest = {
  baseUrl: string
  presetId?: string
  listed: Record<string, unknown>[]
  fetchJson: (url: string, init?: { method?: 'GET' | 'POST'; body?: unknown }) => Promise<unknown>
}

export type ContextWindowSource = {
  id: string
  matches: (request: ContextWindowRequest) => boolean
  windows: (request: ContextWindowRequest, modelIds: string[]) => Promise<Map<string, unknown>>
}

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

export function asRecords(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.flatMap((entry) => asRecord(entry) ?? []) : []
}

export function hostnameOf(url: string): string {
  return URL.parse(url)?.hostname ?? ''
}

export function windowsById(entries: Record<string, unknown>[], idField: string, read: (entry: Record<string, unknown>) => unknown): Map<string, unknown> {
  const windows = new Map<string, unknown>()
  for (const entry of entries) {
    const id = entry[idField]
    if (typeof id === 'string' && id.trim()) windows.set(id.trim(), read(entry))
  }
  return windows
}

export function warnLookupFailure(source: string, detail: Record<string, unknown>, err: unknown): void {
  console.warn('[providers] Context window lookup failed', {
    source,
    ...detail,
    error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
  })
}
