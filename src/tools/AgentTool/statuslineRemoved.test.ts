import { describe, expect, test } from 'bun:test'
import { getBuiltInAgents } from './builtInAgents.js'

describe('status line setup', () => {
  test('is not offered: the DreamCoder app has no status line', () => {
    expect(getBuiltInAgents().map(agent => agent.agentType)).not.toContain('statusline-setup')
  })
})
