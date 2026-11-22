import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { getContextWindowForModel } from '../context.js'
import { modelSupportsThinking } from '../thinking.js'

describe('model helpers with USER_TYPE=ant', () => {
  let originalUserType: string | undefined

  beforeEach(() => {
    originalUserType = process.env.USER_TYPE
    process.env.USER_TYPE = 'ant'
  })

  afterEach(() => {
    if (originalUserType === undefined) {
      delete process.env.USER_TYPE
    } else {
      process.env.USER_TYPE = originalUserType
    }
  })

  test('resolve a model that has no internal override', () => {
    expect(getContextWindowForModel('some-custom-model')).toBe(200_000)
    expect(() => modelSupportsThinking('some-custom-model')).not.toThrow()
  })
})
