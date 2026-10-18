import type { EffortLevel } from './settings'

/**
 * A session's runtime choice. An empty `modelId` (with `providerId: null`)
 * means "follow the default provider and model" and only carries `effort`.
 */
export type RuntimeSelection = {
  providerId: string | null
  modelId: string
  /** Per-session reasoning effort; absent means the global default applies. */
  effort?: EffortLevel
}
