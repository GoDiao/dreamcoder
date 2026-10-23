import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CodeViewer } from './CodeViewer'

const shiki = vi.hoisted(() => ({ loads: 0 }))

vi.mock('react-shiki', () => {
  shiki.loads += 1
  return {
    ShikiHighlighter: ({ children }: { children: string }) => (
      <div data-testid="shiki-container"><code>{children}</code></div>
    ),
    createJavaScriptRegexEngine: () => ({}),
  }
})

describe('CodeViewer', () => {
  it('keeps the same inner padding for highlighted code content', () => {
    const { container } = render(
      <CodeViewer code={'cd testb\nnpm run dev'} language="bash" showLineNumbers />,
    )

    expect(screen.getByText('cd testb')).toBeTruthy()
    expect(screen.getByText('npm run dev')).toBeTruthy()

    const contentWrapper = container.querySelector('[data-code-viewer-content]') as HTMLElement | null
    expect(contentWrapper).toBeTruthy()
    expect(contentWrapper?.style.padding).toBe('0.5rem 12px')
    expect(contentWrapper?.style.whiteSpace).toBe('pre')
    expect(contentWrapper?.style.wordBreak).toBe('normal')

    const codeArea = container.querySelector('.code-viewer-area') as HTMLElement | null
    expect(codeArea?.getAttribute('data-has-line-numbers')).toBe('true')
    expect(container.querySelector('[data-line-number="1"]')).toBeTruthy()
    expect(container.querySelector('[data-line-number="2"]')).toBeTruthy()
  })

  describe('highlighter', () => {
    afterEach(() => {
      vi.unstubAllEnvs()
    })

    it('never loads Shiki for the prism highlighter', async () => {
      vi.stubEnv('MODE', 'production')
      const { container } = render(<CodeViewer code="const a = 1" language="ts" highlighter="prism" />)

      await new Promise((resolve) => setTimeout(resolve, 20))
      expect(shiki.loads).toBe(0)
      expect(container.querySelector('[data-highlight-engine="shiki"]')).toBeNull()
      expect(container.querySelector('[data-highlight-engine="prism"]')).not.toBeNull()
    })

    it('switches to Shiki for the default highlighter', async () => {
      vi.stubEnv('MODE', 'production')
      const { container } = render(<CodeViewer code="const b = 2" language="ts" />)

      await waitFor(() => {
        expect(container.querySelector('[data-highlight-engine="shiki"] [data-testid="shiki-container"]')).not.toBeNull()
      })
      expect(shiki.loads).toBe(1)
    })
  })
})
