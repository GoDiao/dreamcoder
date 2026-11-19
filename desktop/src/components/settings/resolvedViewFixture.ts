import type { CapabilityField, InheritedSource, ResolvedModelRulesView } from '../../types/provider'

type ViewOverrides = Partial<Omit<ResolvedModelRulesView, 'sources'>> & { sources?: Record<CapabilityField, InheritedSource> }

export function resolvedView(overrides: ViewOverrides = {}): ResolvedModelRulesView {
  const values: Omit<ResolvedModelRulesView, 'inherited' | 'sources'> & { sources: Record<CapabilityField, InheritedSource> } = {
    contextWindow: 1048576,
    maxOutputTokens: 65536,
    reasoning: { control: 'toggle_effort' },
    effortLevels: ['low', 'high', 'max'],
    appliedEffort: { low: 'low', medium: 'high', high: 'high', max: 'max' },
    image: false,
    pdf: false,
    usedFallback: false,
    sources: { contextWindow: 'model', maxOutputTokens: 'discovered', reasoning: 'model', image: 'fallback', pdf: 'model', structuredOutput: 'model' },
    ...overrides,
  }
  const { contextWindow, maxOutputTokens, reasoning, effortLevels, image, pdf, sources } = values
  return { ...values, inherited: overrides.inherited ?? { contextWindow, maxOutputTokens, reasoning, effortLevels, image, pdf, sources } }
}
