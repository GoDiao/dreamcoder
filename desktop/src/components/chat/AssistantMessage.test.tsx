import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'

vi.mock('./CodeViewer', () => ({
  CodeViewer: ({ code, highlighter }: { code: string; highlighter?: string }) => (
    <div data-testid="code-viewer" data-highlighter={highlighter ?? 'shiki'}>{code}</div>
  ),
}))

import { AssistantMessage } from './AssistantMessage'

const REPLY = 'Here is the code:\n\n```ts\nconst a = 1\n```\n\nDone.'

describe('AssistantMessage', () => {
  it('renders a streaming reply incrementally with the shared highlighter', () => {
    const { container } = render(<AssistantMessage content={REPLY} isStreaming incremental />)
    expect(container.querySelector('[data-streaming-block]')).not.toBeNull()
    expect(screen.getByTestId('code-viewer')).toHaveAttribute('data-highlighter', 'shiki')
  })

  it('renders a committed reply in full with Shiki', () => {
    const { container } = render(<AssistantMessage content={REPLY} />)
    expect(container.querySelector('[data-streaming-block]')).toBeNull()
    expect(screen.getByTestId('code-viewer')).toHaveAttribute('data-highlighter', 'shiki')
  })
})
