import { describe, expect, test } from 'bun:test'
import { createStreamState, translateCliOutput } from '../session/translate.js'
import { createSessionState, reduceSessionState } from '../session/state/reducer.js'

function streamEvent(event: Record<string, unknown>) {
  return { type: 'stream_event', event }
}

describe('a stream the CLI retries', () => {
  test('drops what the failed attempt streamed and tells the clients', () => {
    const stream = createStreamState()
    translateCliOutput(streamEvent({ type: 'message_start' }), stream)
    translateCliOutput(streamEvent({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'toolu_1', name: 'Write' } }), stream)
    translateCliOutput(streamEvent({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"file_pa' } }), stream)

    const retracted = translateCliOutput({ type: 'system', subtype: 'stream_retracted', uuid: 'u1' }, stream)

    expect(retracted.messages).toEqual([{ type: 'reply_retracted' }])
    expect(retracted.events).toEqual([{ type: 'turn_activity_reported', activity: 'thinking' }])
    expect(stream.activeBlockTypes.size).toBe(0)
    expect(stream.activeToolBlocks.size).toBe(0)
    expect(stream.streamedToolUseIds.size).toBe(0)
    expect(stream.hasReceivedStreamEvents).toBe(false)
  })

  test('the turn goes back to thinking', () => {
    const running = reduceSessionState(createSessionState('s1'), { type: 'turn_started', at: 1 }).state
    const streaming = reduceSessionState(running, { type: 'turn_activity_reported', activity: 'streaming' }).state

    const event = translateCliOutput({ type: 'system', subtype: 'stream_retracted', uuid: 'u1' }, createStreamState()).events[0]!

    expect(reduceSessionState(streaming, event).state.turn.activity).toBe('thinking')
  })
})
