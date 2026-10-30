import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseDiffFromFile } from '@pierre/diffs'
import { FileDiff } from '@pierre/diffs/react'
import { PierreDiffSurface } from './PierreDiffSurface'
import { THEME_MODES } from '../../types/settings'

vi.mock('@pierre/diffs/react', () => ({ FileDiff: vi.fn(() => null) }))

const fileDiff = parseDiffFromFile({ name: 'sample.ts', contents: 'const count = 1\n' }, { name: 'sample.ts', contents: 'const count = 2\n' })

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('Pierre theme integration', () => {
  it.each(THEME_MODES)('uses app theme %s independently of the system preference', (theme) => {
    render(<PierreDiffSurface fileDiff={fileDiff} theme={theme} />)
    const props = vi.mocked(FileDiff).mock.calls.at(-1)![0]
    expect(props.fileDiff).toBe(fileDiff)
    expect(props.options).toMatchObject({
      theme: { light: 'github-light', dark: 'github-dark' },
      themeType: ['dark', 'midnight', 'aurora'].includes(theme) ? 'dark' : 'light',
      diffStyle: 'unified',
    })
  })

  it('updates theme without rebuilding the diff', () => {
    const { rerender } = render(<PierreDiffSurface fileDiff={fileDiff} theme="white" />)
    rerender(<PierreDiffSurface fileDiff={fileDiff} theme="midnight" />)
    const props = vi.mocked(FileDiff).mock.calls.at(-1)![0]
    expect(props.fileDiff).toBe(fileDiff)
    expect(props.options).toMatchObject({ themeType: 'dark', diffStyle: 'unified' })
  })
})
