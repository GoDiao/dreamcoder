import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'
import '@testing-library/jest-dom'
import { marked } from 'marked'

const codeViewerRenders = vi.hoisted(() => ({ codes: [] as string[] }))

vi.mock('../chat/CodeViewer', () => ({
  CodeViewer: ({ code, language, highlighter }: { code: string; language?: string; highlighter?: string }) => {
    codeViewerRenders.codes.push(code)
    return (
      <div data-testid="code-viewer" data-language={language ?? ''} data-highlighter={highlighter ?? 'shiki'}>
        {code}
      </div>
    )
  },
}))

vi.mock('../chat/MermaidRenderer', () => ({
  MermaidRenderer: ({ code }: { code: string }) => (
    <div data-testid="mermaid-renderer">{code}</div>
  ),
}))

import { StreamingMarkdownRenderer } from './MarkdownRenderer'
import { loadKatex } from '../../lib/katexLoader'

function streamInto(text: string, step: number) {
  const view = render(<StreamingMarkdownRenderer content={text.slice(0, step)} />)
  for (let end = step * 2; end < text.length + step; end += step) {
    view.rerender(<StreamingMarkdownRenderer content={text.slice(0, Math.min(end, text.length))} />)
  }
  return view
}

describe('StreamingMarkdownRenderer', () => {
  beforeAll(async () => {
    await loadKatex()
  })

  beforeEach(() => {
    codeViewerRenders.codes = []
  })

  it('renders a half-written list', () => {
    const { container } = render(<StreamingMarkdownRenderer content={'Steps:\n\n- first\n- sec'} />)
    const items = container.querySelectorAll('li')
    expect(items).toHaveLength(2)
    expect(items[1]).toHaveTextContent('sec')
  })

  it('renders a half-written table', () => {
    const { container } = render(
      <StreamingMarkdownRenderer content={'| Name | Cost |\n| --- | --- |\n| parse | 3 ms |\n| valid'} />,
    )
    expect(container.querySelector('table')).not.toBeNull()
    expect(container.querySelectorAll('tbody tr')).toHaveLength(2)
    expect(container.querySelector('tbody tr:last-child td')).toHaveTextContent('valid')
  })

  it('renders an unclosed code fence as code with the lightweight highlighter', () => {
    const { getByTestId } = render(
      <StreamingMarkdownRenderer content={'Example:\n\n```ts\nconst a = 1\nconst b'} />,
    )
    const code = getByTestId('code-viewer')
    expect(code).toHaveTextContent('const a = 1 const b')
    expect(code).toHaveAttribute('data-language', 'ts')
    expect(code).toHaveAttribute('data-highlighter', 'prism')
  })

  it('shows half-written math as text and renders it once it closes', () => {
    const view = render(<StreamingMarkdownRenderer content={'Energy is $E = mc'} />)
    expect(view.container).toHaveTextContent('Energy is $E = mc')
    expect(view.container.querySelector('.katex')).toBeNull()

    view.rerender(<StreamingMarkdownRenderer content={'Energy is $E = mc^2$.\n\n$$\na + b\n\n= c'} />)
    expect(view.container.querySelectorAll('.md-math-inline .katex')).toHaveLength(1)
    expect(view.container.querySelector('.md-math-display')).toBeNull()

    view.rerender(<StreamingMarkdownRenderer content={'Energy is $E = mc^2$.\n\n$$\na + b\n\n= c\n$$\n'} />)
    expect(view.container.querySelectorAll('.md-math-display .katex')).toHaveLength(1)
  })

  it('renders the same content as the whole reply once streaming is done', () => {
    const text = '# Title\n\nIntro with `code`.\n\n1. one\n\n2. two\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\nDone.'
    const view = streamInto(text, 3)
    expect(view.container.querySelectorAll('ol > li')).toHaveLength(2)
    expect(view.container.querySelectorAll('ol')).toHaveLength(1)
    expect(view.container.querySelector('h1')).toHaveTextContent('Title')
    expect(view.container.querySelector('table')).not.toBeNull()
    expect(view.container).toHaveTextContent('Done.')
  })

  it('keeps finished blocks mounted and parses only the growing tail', () => {
    const first = 'First paragraph stays put.\n\nSecond paragraph'
    const view = render(<StreamingMarkdownRenderer content={first} />)
    const finishedParagraph = view.getByText('First paragraph stays put.')
    const finishedText = finishedParagraph.firstChild

    const parse = vi.spyOn(marked, 'parse')
    view.rerender(<StreamingMarkdownRenderer content={`${first} keeps growing`} />)
    view.rerender(<StreamingMarkdownRenderer content={`${first} keeps growing and growing`} />)

    expect(parse).toHaveBeenCalledTimes(2)
    for (const [source] of parse.mock.calls) {
      expect(source).not.toContain('First paragraph')
    }
    parse.mockRestore()
    expect(view.getByText('First paragraph stays put.')).toBe(finishedParagraph)
    expect(finishedParagraph.firstChild).toBe(finishedText)
    expect(view.getByText('Second paragraph keeps growing and growing')).toBeInTheDocument()
  })

  it('does not re-render a finished code block when the tail grows', () => {
    const head = 'Intro.\n\n```ts\nconst finished = 1\n```\n\nTail'
    const view = render(<StreamingMarkdownRenderer content={head} />)
    const before = codeViewerRenders.codes.filter((code) => code.includes('finished')).length
    expect(before).toBe(1)

    view.rerender(<StreamingMarkdownRenderer content={`${head} more`} />)
    view.rerender(<StreamingMarkdownRenderer content={`${head} more and more`} />)

    expect(codeViewerRenders.codes.filter((code) => code.includes('finished'))).toHaveLength(before)
  })

  it('renders reference-style links while streaming', () => {
    const { container } = render(
      <StreamingMarkdownRenderer content={'See [the docs][r].\n\n[r]: https://example.com/docs\n\nNext'} />,
    )
    expect(container.querySelector('a[href="https://example.com/docs"]')).toHaveTextContent('the docs')
    expect(container).not.toHaveTextContent('://example.com/docs')
  })

  it('keeps the body of a streaming details element inside it', () => {
    const text = 'Intro\n\n<details>\n<summary>More</summary>\n\nHidden text\n\n</details>\n\nDone'
    const view = streamInto(text, 5)
    const details = view.container.querySelector('details')!
    expect(details).not.toBeNull()
    expect(details).toHaveTextContent('Hidden text')
    expect(view.container).toHaveTextContent('Done')
  })

  it('keeps a selection in the finished part across flushes', () => {
    const text = 'Select these words please.\n\nThe tail'
    const view = render(<StreamingMarkdownRenderer content={text} />)
    const textNode = view.getByText('Select these words please.').firstChild!

    const range = document.createRange()
    range.setStart(textNode, 7)
    range.setEnd(textNode, 18)
    const selection = window.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)
    expect(selection.toString()).toBe('these words')

    view.rerender(<StreamingMarkdownRenderer content={`${text} grows`} />)
    view.rerender(<StreamingMarkdownRenderer content={`${text} grows more\n\nAnother block`} />)

    expect(selection.rangeCount).toBe(1)
    expect(selection.anchorNode).toBe(textNode)
    expect(textNode.isConnected).toBe(true)
    expect(selection.toString()).toBe('these words')
  })
})
