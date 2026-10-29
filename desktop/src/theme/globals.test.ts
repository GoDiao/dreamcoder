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
    '--color-activity-heat-0',
    '--color-activity-heat-1',
    '--color-activity-heat-2',
    '--color-activity-heat-3',
    '--color-activity-heat-4',
    '--color-activity-cell-border',
    '--color-activity-cell-border-hover',
    '--color-activity-cell-border-active',
    '--color-activity-tooltip-surface',
    '--color-activity-tooltip-border',
    '--color-activity-tooltip-text',
    '--color-activity-tooltip-muted',
    '--color-success-container',
    '--color-info',
    '--color-info-container',
    '--color-warning-container',
    '--color-memory-accent',
    '--color-memory-surface',
    '--color-memory-border',
    '--color-memory-icon-bg',
    '--color-goal-accent',
    '--color-goal-surface',
    '--color-goal-border',
    '--color-goal-icon-bg',
    '--color-goal-chip-bg',
    '--color-goal-chip-border',
    '--color-text-secondary-a72',
    '--color-text-secondary-a68',
    '--color-text-primary-a88',
    '--color-text-primary-a82',
    '--color-text-primary-a78',
    '--color-surface-hover-a34',
    '--color-surface-hover-a54',
    '--color-outline-a72',
    '--color-outline-a78',
    '--color-outline-a92',
  ]

  it('lets only the base light block use a bare :root, so later blocks cannot override other themes', () => {
    // A bare `:root` has the same specificity as `[data-theme="midnight"]`;
    // declared later in the file it would repaint every theme.
    const bareRootBlocks = normalizedCss.match(/^:root\s*[,{]/gm) ?? []
    expect(bareRootBlocks).toHaveLength(1)
  })

  it('gives the dark theme its own error surface instead of the light default', () => {
    const block = getThemeBlock('[data-theme="dark"]')
    expect(block).toContain('--color-error-container:')
    expect(block).toContain('--color-on-error-container:')
  })

  it('gives every dark theme its own diff colors instead of the light defaults', () => {
    const diffTokens = ['--color-diff-added-bg', '--color-diff-removed-bg', '--color-diff-added-text', '--color-diff-removed-text']
    const darkBlocks = normalizedCss.split('[data-theme="dark"] {').slice(1).map((rest) => rest.slice(0, rest.indexOf('\n}')))
    for (const token of diffTokens) {
      expect(darkBlocks.some((block) => block.includes(`${token}:`)), `dark should define ${token}`).toBe(true)
    }
    const aurora = getThemeBlock('[data-theme="aurora"]')
    for (const token of diffTokens) {
      expect(aurora, `Aurora should define ${token}`).toContain(`${token}:`)
    }
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

it('keeps Aurora text readable on chat, sidebar, terminal, code, and primary buttons', () => {
  const pairs = [
    ['--color-text-primary', '--color-surface'],
    ['--color-text-secondary', '--color-surface-sidebar'],
    ['--color-text-tertiary', '--color-surface-container-highest'],
    ['--color-terminal-fg', '--color-terminal-bg'],
    ['--color-terminal-muted', '--color-terminal-header'],
    ['--color-btn-primary-fg', '--color-primary'],
    ['--color-btn-primary-fg', '--color-primary-container'],
    ['--color-on-error', '--color-error'],
    ['--color-code-fg', '--color-code-bg'],
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
