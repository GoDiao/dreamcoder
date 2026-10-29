import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { loadHighlighter } from './highlighter'

function markup(lines: React.ReactNode[]) {
  return lines.map((line) => renderToStaticMarkup(<>{line}</>))
}

describe('code highlighter', () => {
  it.each(['typescript', 'go', 'rust', 'java', 'c++', 'shell', 'sh', 'zsh'])('loads %s with both syntax themes', async (language) => {
    const highlighter = await loadHighlighter(language)
    expect(highlighter).not.toBeNull()
    const html = markup(highlighter!.highlight('return 42').lines).join('')
    expect(html).toContain('--shiki-light')
    expect(html).toContain('--shiki-dark')
  })

  it('does not resolve inherited object properties as languages', async () => {
    expect(await loadHighlighter('constructor')).toBeNull()
    expect(await loadHighlighter('unknown-language')).toBeNull()
  })

  it('continues multiline grammar across streamed line boundaries', async () => {
    const highlighter = await loadHighlighter('typescript')
    expect(highlighter).not.toBeNull()
    const first = highlighter!.highlight('/* opening comment')
    const second = highlighter!.highlight('still a comment\n*/ const value = 1', first.state)
    const full = highlighter!.highlight('/* opening comment\nstill a comment\n*/ const value = 1')
    expect(markup([...first.lines, ...second.lines])).toEqual(markup(full.lines))
  })
})
