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
    // Restores the rule d5a667d dropped. That commit moved the border radius
    // into Tailwind classes and deleted the whole inline style block with it,
    // taking `overflowWrap: 'anywhere'` (and `wordBreak`) with it. The old
    // assertions read `.style.overflowWrap`, so they went red the moment the
    // inline block disappeared and could never pass again; asserting the class
    // is what actually pins the rule.
    //
    // `break-word` and `anywhere` both break an unbreakable URL; `anywhere`
    // additionally contributes those soft wrap opportunities to min-content
    // sizing. That difference is a layout property this test does not measure,
    // so it verifies the rule is present, not a rendered regression.
    expect(bubble.className).toContain('[overflow-wrap:anywhere]')
  })
})
