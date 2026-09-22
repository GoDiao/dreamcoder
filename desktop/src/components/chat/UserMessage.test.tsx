import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { UserMessage } from './UserMessage'

describe('UserMessage', () => {
  it('keeps long URLs inside the message bubble', () => {
    const longUrl = `https://cn.bing.com/search?q=${'encoded'.repeat(60)}`

    const { container } = render(<UserMessage content={longUrl} />)

    const shell = container.querySelector('[data-message-shell="user"]')
    const bubble = screen.getByText(longUrl)

    expect(shell?.className).toContain('min-w-0')
    expect(bubble.className).toContain('min-w-0')
    expect(bubble.className).toContain('max-w-full')
    expect(bubble.className).toContain('whitespace-pre-wrap')
    // `break-words` alone maps to `overflow-wrap: break-word`, which will not
    // break a run with no spaces — a pasted URL has none, so it overflows the
    // bubble. The assistant side pairs it with `[overflow-wrap:anywhere]`
    // (MarkdownRenderer BASE_PROSE_CLASSES) for exactly this case.
    expect(bubble.className).toContain('break-words')
    expect(bubble.className).toContain('[overflow-wrap:anywhere]')
  })
})
