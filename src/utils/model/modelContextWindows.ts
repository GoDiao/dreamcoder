import { normalizeModelId } from './modelRules.js'

const DIRECT_MODEL_CONTEXT_WINDOWS: Record<string, number> = {
  'claude-opus-4-7': 1_000_000,
  'claude-sonnet-4-6': 200_000,
  'claude-haiku-4-5': 200_000,
}

export function getBuiltInModelContextWindow(model: string): number | undefined {
  return DIRECT_MODEL_CONTEXT_WINDOWS[normalizeModelId(model)]
}
