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

function getCssBetween(startMarker: string, endMarker: string) {
  const start = normalizedCss.indexOf(startMarker)
  expect(start).toBeGreaterThanOrEqual(0)
  const end = normalizedCss.indexOf(endMarker, start)
  expect(end).toBeGreaterThan(start)
  return normalizedCss.slice(start, end)
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

  it('avoids color-mix in the startup-critical UI zoom shell chrome for Safari 15 WebView support', () => {
    const zoomShellCss = getCssBetween('.settings-zoom-kbd {', '/* ─── Tailwind Theme Override')

    expect(zoomShellCss).not.toContain('color-mix(')
  })

  it('keeps the UI zoom slider thumb visible in dark mode', () => {
    expect(css).toContain('[data-theme="dark"] .settings-zoom-control')
    expect(css).toContain('--settings-zoom-thumb-bg: var(--color-surface-bright);')
    expect(css).toContain('--settings-zoom-thumb-border: rgba(255, 181, 159, 0.78);')
    expect(css).toContain('box-shadow: var(--settings-zoom-thumb-shadow);')
  })
})

function auroraColor(token: string): string {
  const value = new RegExp(`${token}:\\s*([^;]+);`).exec(auroraCss)?.[1]?.trim()
  if (!value) throw new Error(`Missing Aurora token: ${token}`)
  const alias = /^var\((--[\w-]+)\)$/.exec(value)
  return alias ? auroraColor(alias[1]!) : value
}

function luminance(color: string): number {
  const channels = [1, 3, 5].map((offset) => parseInt(color.slice(offset, offset + 2), 16) / 255)
  const linear = channels.map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
  return linear[0]! * 0.2126 + linear[1]! * 0.7152 + linear[2]! * 0.0722
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
    ...['fg', 'comment', 'string', 'keyword', 'function', 'number', 'property', 'type', 'punctuation']
      .map((syntax) => [`--color-code-${syntax}`, '--color-code-bg']),
  ]
  for (const [foreground, background] of pairs) {
    const values = [luminance(auroraColor(foreground!)), luminance(auroraColor(background!))]
    const contrast = (Math.max(...values) + 0.05) / (Math.min(...values) + 0.05)
    expect(contrast, `${foreground} on ${background}`).toBeGreaterThanOrEqual(4.5)
  }
})
