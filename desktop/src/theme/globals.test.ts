import { luminance } from './testColors'
import { describe, expect, it } from 'vitest'

import css from './globals.css?raw'
import auroraCss from './aurora.css?raw'

const normalizedCss = `${css}\n${auroraCss}`.replace(/\r\n/g, '\n')

function getThemeBlock(selector: ':root,\n[data-theme="light"]' | '[data-theme="white"]' | '[data-theme="dark"]' | '[data-theme="aurora"]') {
  const start = normalizedCss.indexOf(`${selector} {`)
  expect(start).toBeGreaterThanOrEqual(0)

  const bodyStart = normalizedCss.indexOf('{', start)
  let depth = 0
  for (let index = bodyStart; index < normalizedCss.length; index += 1) {
    const char = normalizedCss[index]
    if (char === '{') depth += 1
    if (char === '}') {
      depth -= 1
      if (depth === 0) {
        return normalizedCss.slice(bodyStart + 1, index)
      }
    }
  }

  throw new Error(`Theme block not closed: ${selector}`)
}

describe('desktop theme tokens', () => {
  const themes = [':root,\n[data-theme="light"]', '[data-theme="white"]', '[data-theme="dark"]'] as const
  const requiredTokens = [
    '--theme-activity-heat-0',
    '--theme-activity-heat-1',
    '--theme-activity-heat-2',
    '--theme-activity-heat-3',
    '--theme-activity-heat-4',
    '--theme-activity-cell-border',
    '--theme-activity-cell-border-hover',
    '--theme-success-container',
    '--theme-info',
    '--theme-info-container',
    '--theme-warning-container',
    '--theme-memory-accent',
    '--theme-memory-surface',
    '--theme-memory-border',
    '--theme-memory-icon-bg',
  ]

  it('lets only the base light block use a bare :root, so later blocks cannot override other themes', () => {
    // A bare `:root` has the same specificity as `[data-theme="midnight"]`;
    // declared later in the file it would repaint every theme.
    const bareRootBlocks = normalizedCss.match(/^:root\s*[,{]/gm) ?? []
    expect(bareRootBlocks).toHaveLength(1)
  })

  it('gives the dark theme its own error surface instead of the light default', () => {
    const block = getThemeBlock('[data-theme="dark"]')
    expect(block).toContain('--theme-error-container:')
  })

  it('derives diff colors from each theme\'s status colors', () => {
    expect(normalizedCss).toContain('--diff-added: color-mix(in srgb, var(--success) 14%, var(--code));')
    expect(normalizedCss).toContain('--diff-removed: color-mix(in srgb, var(--destructive) 10%, var(--code));')
  })

  it('defines activity and status tokens for every supported theme', () => {
    for (const theme of themes) {
      const block = getThemeBlock(theme)

      for (const token of requiredTokens) {
        expect(block, `${theme} should define ${token}`).toContain(`${token}:`)
      }
    }
  })

  it('defines activity and status tokens for Aurora', () => {
    const block = getThemeBlock('[data-theme="aurora"]')
    for (const token of requiredTokens) {
      expect(block, `Aurora should define ${token}`).toContain(`${token}:`)
    }
  })
})

function auroraColor(token: string): string {
  const value = new RegExp(`${token}:\\s*([^;]+);`).exec(auroraCss)?.[1]?.trim()
  if (!value) throw new Error(`Missing Aurora token: ${token}`)
  const alias = /^var\((--[\w-]+)\)$/.exec(value)
  return alias ? auroraColor(alias[1]!) : value
}

it('keeps Aurora text readable on chat, sidebar, code, and primary buttons', () => {
  const pairs = [
    ['--theme-text-primary', '--theme-surface'],
    ['--theme-text-secondary', '--theme-surface-sidebar'],
    ['--theme-text-tertiary', '--theme-surface-container-highest'],
    ['--theme-btn-primary-fg', '--theme-primary'],
    ['--theme-code-fg', '--theme-code-bg'],
  ]
  for (const [foreground, background] of pairs) {
    const values = [luminance(auroraColor(foreground!)), luminance(auroraColor(background!))]
    const contrast = (Math.max(...values) + 0.05) / (Math.min(...values) + 0.05)
    expect(contrast, `${foreground} on ${background}`).toBeGreaterThanOrEqual(4.5)
  }
})

describe('window drag regions', () => {
  it('drag the window from title areas but leave their controls clickable', () => {
    expect(normalizedCss).toMatch(/\.window-drag-region \{\s*-webkit-app-region: drag;\s*app-region: drag;\s*\}/)
    expect(normalizedCss).toMatch(/\.window-drag-region :is\(button, input, textarea, select, a, \[role="button"\][^)]*\),\s*\.window-no-drag \{\s*-webkit-app-region: no-drag;\s*app-region: no-drag;\s*\}/)
  })
})
