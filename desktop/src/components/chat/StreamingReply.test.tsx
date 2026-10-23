import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'

vi.mock('../../api/sessions', () => ({
  sessionsApi: new Proxy({}, { get: () => () => new Promise(() => {}) }),
}))

vi.mock('./CodeViewer', () => ({
  CodeViewer: ({ code, highlighter }: { code: string; highlighter?: string }) => (
    <div data-testid="code-viewer" data-highlighter={highlighter ?? 'shiki'}>{code}</div>
  ),
}))

import { StreamingReply } from './StreamingReply'
import { MessageList } from './MessageList'
import { useChatStore, type PerSessionState } from '../../stores/chatStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useTabStore } from '../../stores/tabStore'
import { SCENARIO_SESSION_ID, installScenarioSession } from './streamingRenderScenario'

const REPLY = 'Here is the code:\n\n```ts\nconst a = 1\n```\n\nDone.'

function patchSession(update: Partial<PerSessionState>) {
  useChatStore.setState((state) => ({
    sessions: {
      ...state.sessions,
      [SCENARIO_SESSION_ID]: { ...state.sessions[SCENARIO_SESSION_ID]!, ...update },
    },
  }))
}

describe('reply highlighting from streaming to committed', () => {
  const initialChatState = useChatStore.getInitialState()
  const initialTabState = useTabStore.getInitialState()

  beforeEach(() => {
    useSettingsStore.setState({ locale: 'en' })
    useChatStore.setState(initialChatState, true)
    useTabStore.setState(initialTabState, true)
    installScenarioSession()
  })

  afterEach(() => {
    cleanup()
  })

  it('renders the streaming reply incrementally with the lightweight highlighter', () => {
    patchSession({ chatState: 'streaming', streamingText: REPLY })
    const { container } = render(<StreamingReply sessionId={SCENARIO_SESSION_ID} />)

    expect(container.querySelector('[data-streaming-block]')).not.toBeNull()
    expect(screen.getByTestId('code-viewer')).toHaveAttribute('data-highlighter', 'prism')
  })

  it('renders a committed reply in the transcript in full with Shiki', () => {
    const session = useChatStore.getState().sessions[SCENARIO_SESSION_ID]!
    patchSession({
      messages: [
        ...session.messages,
        { id: 'committed', type: 'assistant_text', content: REPLY, timestamp: 2_000_000 },
      ],
    })
    const { container } = render(<MessageList sessionId={SCENARIO_SESSION_ID} />)

    expect(container.querySelector('[data-streaming-block]')).toBeNull()
    expect(screen.getByTestId('code-viewer')).toHaveAttribute('data-highlighter', 'shiki')
  })
})
