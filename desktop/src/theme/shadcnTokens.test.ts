import { luminance } from './testColors'
import { describe, expect, it } from 'vitest'
import { THEME_MODES } from '../types/settings'
import { themeColorScheme } from './colorScheme'
import css from './globals.css?raw'
import auroraCss from './aurora.css?raw'

const aliases = ['background', 'foreground', 'card', 'card-foreground', 'popover', 'popover-foreground', 'primary', 'primary-foreground', 'secondary', 'secondary-foreground', 'muted', 'muted-foreground', 'accent', 'accent-foreground', 'destructive', 'border', 'input', 'ring', 'radius']

function themeVariables(theme: string) {
  const values = new Map<string, string>()
  for (const match of `${css}\n${auroraCss}`.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = match[1]!.trim().split(',').map((selector) => selector.trim())
    if (!selectors.some((selector) => ['@theme', ':root', ':root[data-theme]', `[data-theme="${theme}"]`, `:root[data-theme="${theme}"]`].includes(selector))) continue
    for (const declaration of match[2]!.matchAll(/(--[\w-]+):\s*([^;]+);/g)) {
      values.set(declaration[1]!, declaration[2]!.trim())
    }
  }
  return values
}

function resolveToken(name: string, values: Map<string, string>, seen: string[] = []): string {
  if (seen.includes(name)) throw new Error(`Circular theme token: ${[...seen, name].join(' -> ')}`)
  const value = values.get(name)
  if (!value) throw new Error(`Missing theme token: ${name}`)
  return value.replace(/var\((--[\w-]+)\)/g, (_, token: string) => resolveToken(token, values, [...seen, name]))
}

describe('shadcn theme bridge', () => {
  it.each(THEME_MODES)('resolves every semantic token in %s without cycles or missing values', (theme) => {
    const values = themeVariables(theme)
    for (const alias of aliases) {
      expect(resolveToken(`--${alias}`, values)).not.toContain('var(')
      if (alias !== 'radius') expect(css).toContain(`--color-ui-${alias}: var(--${alias});`)
    }
  })

  it.each(THEME_MODES)('keeps menu highlight distinct from the popover surface in %s', (theme) => {
    const values = themeVariables(theme)
    const levels = ['--accent', '--popover'].map((token) => luminance(resolveToken(token, values)))
    const contrast = (Math.max(...levels) + 0.05) / (Math.min(...levels) + 0.05)
    expect(contrast).toBeGreaterThanOrEqual(1.08)
  })

  it.each(THEME_MODES)('uses the application color scheme for %s', (theme) => {
    expect(themeColorScheme(theme)).toBe(['dark', 'midnight', 'aurora'].includes(theme) ? 'dark' : 'light')
  })
})
