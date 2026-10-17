import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../api/teams', () => ({
  teamsApi: {
    getMemberTranscript: vi.fn(),
  },
}))

import { teamsApi } from '../api/teams'
import { useChatStore } from './chatStore'
import { useTeamStore } from './teamStore'

const SESSION_ID = 'member-session-1'

describe('teamStore member transcript', () => {
  beforeEach(() => {
    vi.mocked(teamsApi.getMemberTranscript).mockReset()
    useChatStore.setState({ sessions: {} })
    useTeamStore.setState({
      activeTeam: {
        name: 'review-team',
        members: [{ agentId: 'reviewer@review-team', role: 'reviewer', status: 'idle', sessionId: SESSION_ID }],
      },
    })
  })

  it('fills the member session with the transcript items', async () => {
    vi.mocked(teamsApi.getMemberTranscript).mockResolvedValueOnce({
      items: [
        { id: 'u1', type: 'user_text', content: 'Review the parser', transcriptMessageId: 'u1', timestamp: 1000 },
        { id: 'a1:0', type: 'assistant_text', content: 'The parser looks fine.', transcriptMessageId: 'a1', timestamp: 2000 },
      ],
      agentNotifications: {},
      lastTodos: null,
      hasMessagesAfterTaskCompletion: false,
    })

    await useTeamStore.getState().refreshMemberSession(SESSION_ID)

    expect(teamsApi.getMemberTranscript).toHaveBeenCalledWith('review-team', 'reviewer@review-team')
    expect(useChatStore.getState().sessions[SESSION_ID]?.messages).toMatchObject([
      { id: 'u1', type: 'user_text', content: 'Review the parser' },
      { id: 'a1:0', type: 'assistant_text', content: 'The parser looks fine.' },
    ])
  })

  it('keeps a pending message until the transcript contains it', async () => {
    useChatStore.setState({
      sessions: {
        [SESSION_ID]: {
          ...useChatStore.getState().getSession(SESSION_ID),
          messages: [{ id: 'pending-1', type: 'user_text', content: 'Also check the lexer', timestamp: 3000, pending: true }],
        },
      },
    })
    vi.mocked(teamsApi.getMemberTranscript).mockResolvedValueOnce({
      items: [{ id: 'u1', type: 'user_text', content: 'Review the parser', timestamp: 1000 }],
      agentNotifications: {},
      lastTodos: null,
      hasMessagesAfterTaskCompletion: false,
    })

    await useTeamStore.getState().refreshMemberSession(SESSION_ID)

    expect(useChatStore.getState().sessions[SESSION_ID]?.messages).toMatchObject([
      { id: 'u1', content: 'Review the parser' },
      { id: 'pending-1', content: 'Also check the lexer', pending: true },
    ])
  })
})
