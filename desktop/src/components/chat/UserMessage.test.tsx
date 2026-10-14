import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { UserMessage } from './UserMessage'

describe('UserMessage', () => {
  it('carries the wrapping rules the bubble declares', () => {
    const longUrl = `https://cn.bing.com/search?q=${'encoded'.repeat(60)}`

    const { container } = render(<UserMessage content={longUrl} />)

    const shell = container.querySelector('[data-message-shell="user"]')
    const bubble = screen.getByText(longUrl)

    expect(shell?.className).toContain('min-w-0')
    expect(bubble.className).toContain('min-w-0')
    expect(bubble.className).toContain('max-w-full')
    expect(bubble.className).toContain('whitespace-pre-wrap')
    expect(bubble.className).toContain('break-words')
    expect(bubble.className).toContain('[overflow-wrap:anywhere]')
    expect(bubble.className).toContain('[word-break:break-word]')
  })
})
