import { EFFORT_LEVELS } from '../api/models.js'
import type { RuntimeSelection } from '../session/state/types.js'

export function normalizeRuntimeSelection(value: unknown): RuntimeSelection | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const candidate = value as Record<string, unknown>
  const modelId = typeof candidate.modelId === 'string' ? candidate.modelId.trim() : ''
  const effort =
    typeof candidate.effort === 'string' && (EFFORT_LEVELS as readonly string[]).includes(candidate.effort)
      ? candidate.effort
      : undefined
  if (!modelId && !effort) return null
  const providerId = modelId && typeof candidate.providerId === 'string' ? candidate.providerId : null
  return { providerId, modelId, ...(effort ? { effort } : {}) }
}

export function runtimeSelectionFromTranscriptEntries(
  entries: ReadonlyArray<Record<string, unknown>>,
): RuntimeSelection | null | undefined {
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i]!
    if (entry.type === 'runtime-config') return normalizeRuntimeSelection(entry.runtime)
  }
  return undefined
}
