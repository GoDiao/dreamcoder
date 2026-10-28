import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '@testing-library/jest-dom'
import { CodeViewer } from './CodeViewer'
import { loadHighlighter } from '../../lib/highlighter'
import { useSettingsStore } from '../../stores/settingsStore'

vi.mock('../../lib/highlighter', () => ({ loadHighlighter: vi.fn() }))

const load = vi.mocked(loadHighlighter)
const highlight = (code: string) => ({ lines: code.split('\n').map((line) => <span data-testid="highlighted">{line}</span>), state: undefined })

describe('CodeViewer', () => {
  const initialSettings = useSettingsStore.getState()

  beforeEach(() => {
    useSettingsStore.setState({ locale: 'en' })
    load.mockReset().mockResolvedValue(null)
  })

  afterEach(() => {
    cleanup()
    useSettingsStore.setState(initialSettings)
    vi.restoreAllMocks()
  })

  it('shows plain text and line numbers while the language loads, then highlights the same content', async () => {
    let resolve!: (value: Awaited<ReturnType<typeof loadHighlighter>>) => void
    load.mockReturnValue(new Promise((done) => { resolve = done }))
    const { container } = render(<CodeViewer code={'cd testb\nnpm run dev'} language="bash" showLineNumbers />)
    expect(screen.getByText('cd testb')).toBeVisible()
    expect(screen.getByText('npm run dev')).toBeVisible()
    expect(container.querySelector('[data-numbered]')).toBeTruthy()
    expect(container.querySelectorAll('[data-slot="code-block-line"]')).toHaveLength(2)
    expect(screen.queryByTestId('highlighted')).toBeNull()
    await act(async () => { resolve({ highlight }) })
    expect(screen.getAllByTestId('highlighted')).toHaveLength(2)
    expect(screen.getByText('cd testb')).toBeVisible()
  })

  it('keeps the code visible when the language fails to load', async () => {
    const error = new Error('Language unavailable')
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    load.mockRejectedValue(error)
    render(<CodeViewer code="const value = 1" language="ts" />)
    await waitFor(() => expect(log).toHaveBeenCalledWith('[CodeHighlight] Failed to load language:', 'ts', error))
    expect(screen.getByText('const value = 1')).toBeVisible()
  })

  it('ignores a previous language load after switching code', async () => {
    let resolve!: (value: Awaited<ReturnType<typeof loadHighlighter>>) => void
    load.mockReturnValueOnce(new Promise((done) => { resolve = done })).mockResolvedValue(null)
    const { rerender } = render(<CodeViewer code="const value = 1" language="ts" />)
    rerender(<CodeViewer code="plain replacement" language="text" />)
    await act(async () => { resolve({ highlight }) })
    expect(screen.getByText('plain replacement')).toBeVisible()
    expect(screen.queryByTestId('highlighted')).toBeNull()
  })

  it('expands and collapses code without losing the full copy payload', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
    try {
      render(<CodeViewer code={'one\ntwo\nthree'} maxLines={2} />)
      expect(screen.queryByText('three')).toBeNull()
      fireEvent.click(screen.getByRole('button', { name: /show.*1/i }))
      expect(screen.getByText('three')).toBeVisible()
      fireEvent.click(screen.getByRole('button', { name: /collapse/i }))
      expect(screen.queryByText('three')).toBeNull()
      fireEvent.click(screen.getByRole('button', { name: 'Copy' }))
      await waitFor(() => expect(writeText).toHaveBeenCalledWith('one\ntwo\nthree'))
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
