export type ModelMetadataRequest = {
  baseUrl: string
  presetId?: string
  listed: Record<string, unknown>[]
  fetchJson: (url: string, init?: { method?: 'GET' | 'POST'; body?: unknown }) => Promise<unknown>
}

export type RawModelMetadata = {
  contextWindow?: unknown
  maxOutputTokens?: unknown
  image?: unknown
  pdf?: unknown
}

export type ModelMetadataSource = {
  id: string
  matches: (request: ModelMetadataRequest) => boolean
  metadata: (request: ModelMetadataRequest, modelIds: string[]) => Promise<Map<string, RawModelMetadata>>
}

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

export function asRecords(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.flatMap((entry) => asRecord(entry) ?? []) : []
}

export function metadataById(
  entries: Record<string, unknown>[],
  idField: string,
  read: (entry: Record<string, unknown>) => RawModelMetadata,
): Map<string, RawModelMetadata> {
  const metadata = new Map<string, RawModelMetadata>()
  for (const entry of entries) {
    const id = entry[idField]
    if (typeof id === 'string' && id.trim()) metadata.set(id.trim(), read(entry))
  }
  return metadata
}

export function inputModalities(value: unknown): Pick<RawModelMetadata, 'image' | 'pdf'> {
  if (!Array.isArray(value)) return {}
  const modalities = value.flatMap((modality) => typeof modality === 'string' ? [modality.toLowerCase()] : [])
  return {
    image: modalities.includes('image'),
    ...(modalities.includes('file') && { pdf: true }),
  }
}

export function visionCapability(capabilities: unknown): boolean | undefined {
  if (Array.isArray(capabilities)) return capabilities.includes('vision')
  const vision = asRecord(capabilities)?.vision
  return typeof vision === 'boolean' ? vision : undefined
}

export function warnLookupFailure(source: string, detail: Record<string, unknown>, err: unknown): void {
  console.warn('[providers] Model metadata lookup failed', {
    source,
    ...detail,
    error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
  })
}
