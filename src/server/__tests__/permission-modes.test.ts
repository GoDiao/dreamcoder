import { describe, expect, test } from 'bun:test'
import {
  isDefaultPermissionMode,
  permissionModeCliArgs,
  permissionModeFromTranscriptEntries,
} from '../services/permissionModes.js'
import { DEFAULT_PERMISSION_MODES, PERMISSION_MODES } from '../ws/protocol.js'

describe('permission modes', () => {
  test('the default for new sessions can be any mode but dontAsk', () => {
    expect([...DEFAULT_PERMISSION_MODES].sort()).toEqual(PERMISSION_MODES.filter((mode) => mode !== 'dontAsk').sort())
    expect(isDefaultPermissionMode('dontAsk')).toBe(false)
    expect(isDefaultPermissionMode('plan')).toBe(true)
  })

  test('Bypass starts the CLI with --dangerously-skip-permissions, other modes with --permission-mode', () => {
    expect(permissionModeCliArgs('bypassPermissions')).toEqual(['--dangerously-skip-permissions'])
    expect(permissionModeCliArgs('plan')).toEqual(['--permission-mode', 'plan'])
    expect(permissionModeCliArgs(undefined)).toEqual(['--permission-mode', 'default'])
  })

  test('the latest mode record wins, whether a permission-mode entry or a user message', () => {
    expect(
      permissionModeFromTranscriptEntries([
        { type: 'permission-mode', permissionMode: 'bypassPermissions' },
        { type: 'user', permissionMode: 'default' },
        { type: 'assistant' },
      ]),
    ).toBe('default')
    expect(
      permissionModeFromTranscriptEntries([
        { type: 'user', permissionMode: 'default' },
        { type: 'permission-mode', permissionMode: 'acceptEdits' },
        { type: 'user' },
      ]),
    ).toBe('acceptEdits')
  })

  test('falls back to the mode on the last user message', () => {
    expect(
      permissionModeFromTranscriptEntries([
        { type: 'user', permissionMode: 'plan' },
        { type: 'assistant' },
        { type: 'user', permissionMode: 'acceptEdits' },
        { type: 'user' },
      ]),
    ).toBe('acceptEdits')
  })

  test('ignores unknown modes and returns null when nothing is recorded', () => {
    expect(permissionModeFromTranscriptEntries([{ type: 'permission-mode', permissionMode: 'auto' }])).toBeNull()
    expect(permissionModeFromTranscriptEntries([])).toBeNull()
  })
})
