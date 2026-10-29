import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import katex from 'katex'

const katexLoader = vi.hoisted(() => {
  let resolveLoad: (() => void) | null = null
  const state = {
    loaded: null as typeof katex | null,
    loadKatex: null as unknown as ReturnType<typeof vi.fn>,
    finishLoad: () => resolveLoad?.(),
  }
  state.loadKatex = vi.fn(() => new Promise<void>((resolve) => {
    resolveLoad = () => {
      state.loaded = katex
      resolve()
    }
  }))
  return state
})

vi.mock('../../lib/katexLoader', () => ({
  getLoadedKatex: () => katexLoader.loaded,
  loadKatex: katexLoader.loadKatex,
}))

import { MarkdownRenderer, __markdownParseCacheInternals } from './MarkdownRenderer'

describe('MarkdownRenderer on-demand KaTeX', () => {
  beforeEach(() => {
    katexLoader.loaded = null
    katexLoader.loadKatex.mockClear()
    __markdownParseCacheInternals.reset()
  })

  afterEach(() => {
    katexLoader.finishLoad()
  })

  it('does not load KaTeX for a reply without math', () => {
    const { container } = render(<MarkdownRenderer content={'Plain **markdown**, priced at \\$5.'} />)

    expect(container).toHaveTextContent('Plain markdown, priced at $5.')
    expect(katexLoader.loadKatex).not.toHaveBeenCalled()
  })

  it('shows the TeX source in place while KaTeX loads, then renders the formula', async () => {
    const { container } = render(
      <MarkdownRenderer content={'Inline $E = mc^2$\n\n$$\\frac{1}{3}$$'} />,
    )

    expect(katexLoader.loadKatex).toHaveBeenCalledTimes(1)
    expect(container.querySelector('.katex')).not.toBeInTheDocument()
    expect(container.querySelector('.md-math-inline')).toHaveTextContent('E = mc^2')
    expect(container.querySelector('.md-math-display')).toHaveTextContent('\\frac{1}{3}')

    katexLoader.finishLoad()

    await waitFor(() => expect(container.querySelectorAll('.katex')).toHaveLength(2))
    expect(container.querySelector('.md-math-inline .katex')).toBeInTheDocument()
    expect(container.querySelector('.md-math-display .katex')).toBeInTheDocument()
    expect(container.textContent).not.toContain('\\frac{1}{3}')
  })

  it('shows TeX that looks like markup as plain text while KaTeX loads', () => {
    const { container } = render(<MarkdownRenderer content={'Order: $a<b>c$'} />)

    expect(container.querySelector('.md-math-inline')).toHaveTextContent('a<b>c')
    expect(container.querySelector('.md-math-inline b')).not.toBeInTheDocument()
  })
})
