import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { createAssistantMessage, createUserMessage } from '../utils/messages.js'
import { pickQuip } from './observer.js'

describe('pickQuip', () => {
  let random: ReturnType<typeof spyOn<Math, 'random'>>

  beforeEach(() => {
    random = spyOn(Math, 'random').mockReturnValue(0)
  })

  afterEach(() => {
    random.mockRestore()
  })

  test('reacts to the text of the last assistant message', () => {
    const messages = [
      createUserMessage({ content: 'why does it crash?' }),
      createAssistantMessage({ content: 'The error is in the parser.' }),
    ]
    expect(pickQuip(messages)).toBe('Found it!')
  })

  test('stays quiet when no assistant message has text', () => {
    expect(pickQuip([createUserMessage({ content: 'hello' })])).toBeUndefined()
  })
})
