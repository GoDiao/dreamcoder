import type { TranslationKey } from '../i18n'
import type { DesignSystem } from '../types/design'
import { matchesQuery } from './textMatch'

export const DESIGN_SYSTEM_SOURCE_LABELS: Record<DesignSystem['origin'], TranslationKey> = {
  starter: 'design.systemSourceStarter',
  converted: 'design.systemSourceConverted',
}

export function designSystemCategories(systems: readonly DesignSystem[]): string[] {
  return [...new Set(systems.map((system) => system.category))].sort((a, b) => a.localeCompare(b))
}

export function filterDesignSystems(systems: readonly DesignSystem[], category: string | null, query: string): DesignSystem[] {
  return systems.filter((system) => {
    if (category !== null && system.category !== category) return false
    return matchesQuery([system.id, system.name.en, system.name.zh, system.description.en, system.description.zh, system.category], query)
  })
}
