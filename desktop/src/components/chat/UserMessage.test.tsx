import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { formatBrowserReferencePrompt } from '../../lib/browserReferences'
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

  it('shows a restored browser reference as a card and hides its fenced block', () => {
    const prompt = [
      formatBrowserReferencePrompt([
        {
          browser: { url: 'https://example.com/a', title: 'Example page', text: 'quoted line', truncated: false },
          note: 'check this',
        },
      ]),
      'what does this mean',
    ].join('\n\n')

    render(<UserMessage content={prompt} />)

    expect(screen.getByText('what does this mean')).not.toBeNull()
    expect(screen.getByText('Example page')).not.toBeNull()
    expect(screen.getByText('quoted line')).not.toBeNull()
    expect(screen.queryByText(/UNTRUSTED_PAGE_CONTENT/)).toBeNull()
    expect(screen.queryByText(/Referenced browser content/)).toBeNull()
  })

  it('shows a restored picked element by its label with its text, and a sensitive one with a notice', () => {
    const prompt = [
      formatBrowserReferencePrompt([
        {
          browser: {
            url: 'https://example.com/a',
            title: 'Example page',
            text: 'Buy now',
            truncated: false,
            element: {
              ref: '3',
              tag: 'button',
              label: 'button.buy',
              role: 'button',
              name: 'Buy',
              selector: 'main > button.buy',
              html: '<button class="buy">Buy now</button>',
              sensitive: false,
              stale: false,
            },
          },
        },
        {
          browser: {
            url: 'https://example.com/login',
            title: 'Log in',
            text: '',
            truncated: false,
            element: { ref: '4', tag: 'input', label: 'input.pw', role: '', name: '', selector: 'form > input.pw', sensitive: true, stale: false },
          },
        },
      ]),
      'why is this slow',
    ].join('\n\n')

    render(<UserMessage content={prompt} />)

    expect(screen.getByText('button.buy')).not.toBeNull()
    expect(screen.getByText('Buy now')).not.toBeNull()
    expect(screen.getByText('input')).not.toBeNull()
    expect(screen.getByText('Password and card fields are never carried; only where the element is.')).not.toBeNull()
    expect(screen.queryByText(/main > button.buy/)).toBeNull()
    expect(screen.getByText('why is this slow')).not.toBeNull()
  })

  it('leaves a message that only mentions the header untouched', () => {
    render(<UserMessage content="Referenced browser content is what I typed" />)

    expect(screen.getByText('Referenced browser content is what I typed')).not.toBeNull()
  })
})
