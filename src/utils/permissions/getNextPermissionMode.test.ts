import { describe, expect, test } from 'bun:test'
import { getEmptyToolPermissionContext } from '../../Tool.js'
import { getNextPermissionMode } from './getNextPermissionMode.js'

describe('permission mode cycle', () => {
  test('places Auto between Plan and Bypass', () => {
    const context = getEmptyToolPermissionContext()
    expect(getNextPermissionMode({ ...context, mode: 'plan' })).toBe('auto')
    expect(getNextPermissionMode({
      ...context,
      mode: 'auto',
      isBypassPermissionsModeAvailable: true,
    })).toBe('bypassPermissions')
    expect(getNextPermissionMode({
      ...context,
      mode: 'auto',
      isBypassPermissionsModeAvailable: false,
    })).toBe('default')
  })
})
