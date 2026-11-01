import { afterEach, describe, expect, it, spyOn } from 'bun:test'
import { artifactService } from '../services/artifactService.js'
import { conversationService } from '../services/conversationService.js'
import { sessionStateStore } from '../session/state/store.js'
import { handleRawCliMessage } from '../ws/handler.js'

describe('artifact_written hook in the WebSocket handler', () => {
  afterEach(() => {
    spyOn(artifactService, 'registerWrittenPath').mockRestore()
  })

  it('registers the written path with the session that wrote it', () => {
    const register = spyOn(artifactService, 'registerWrittenPath').mockResolvedValue(null)

    handleRawCliMessage('session-1', { type: 'system', subtype: 'artifact_written', path: '/repo/dc_artifacts/a/index.html', tool_name: 'Write' })

    expect(register).toHaveBeenCalledWith('/repo/dc_artifacts/a/index.html', 'session-1')
  })

  it('ignores an event without a path and other system messages', () => {
    const register = spyOn(artifactService, 'registerWrittenPath').mockResolvedValue(null)

    handleRawCliMessage('session-1', { type: 'system', subtype: 'artifact_written', tool_name: 'Write' })
    handleRawCliMessage('session-1', { type: 'system', subtype: 'status' })

    expect(register).not.toHaveBeenCalled()
  })

  it('logs a failed registration instead of throwing', async () => {
    const warn = spyOn(console, 'warn').mockImplementation(() => undefined)
    spyOn(artifactService, 'registerWrittenPath').mockRejectedValue(new Error('disk full'))

    handleRawCliMessage('session-1', { type: 'system', subtype: 'artifact_written', path: '/repo/dc_artifacts/a/index.html' })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})

describe('artifact turn tracking in the WebSocket handler', () => {
  const sessionId = 'turn-tracking-session'

  afterEach(() => {
    spyOn(artifactService, 'beginTurn').mockRestore()
    spyOn(artifactService, 'endTurn').mockRestore()
    spyOn(conversationService, 'getSessionWorkDir').mockRestore()
    sessionStateStore.dispose(sessionId)
  })

  it('begins a turn when the session starts one and ends it when the turn goes idle', () => {
    spyOn(conversationService, 'getSessionWorkDir').mockReturnValue('/repo')
    const begin = spyOn(artifactService, 'beginTurn').mockResolvedValue(undefined)
    const end = spyOn(artifactService, 'endTurn').mockResolvedValue(undefined)

    sessionStateStore.apply(sessionId, { type: 'turn_started', at: 1 })
    expect(begin).toHaveBeenCalledWith(sessionId, '/repo')
    expect(end).not.toHaveBeenCalled()

    sessionStateStore.apply(sessionId, { type: 'turn_ended' })
    expect(end).toHaveBeenCalledWith(sessionId, '/repo')
  })

  it('tracks nothing for a session without a work directory', () => {
    spyOn(conversationService, 'getSessionWorkDir').mockReturnValue('')
    const begin = spyOn(artifactService, 'beginTurn').mockResolvedValue(undefined)
    const end = spyOn(artifactService, 'endTurn').mockResolvedValue(undefined)

    sessionStateStore.apply(sessionId, { type: 'turn_started', at: 1 })
    sessionStateStore.apply(sessionId, { type: 'turn_ended' })

    expect(begin).not.toHaveBeenCalled()
    expect(end).not.toHaveBeenCalled()
  })
})
