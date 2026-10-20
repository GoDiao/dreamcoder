import { describe, expect, test } from 'bun:test'
import { AGENT_TEAMS_ENV, applyAgentTeamsSetting } from '../services/agentTeamsEnv.js'

describe('agent teams env', () => {
  test('follows the desktop switch, not the inherited shell value', () => {
    const inherited = { [AGENT_TEAMS_ENV]: '1', PATH: '/bin' }
    applyAgentTeamsSetting(inherited, {})
    expect(inherited).toEqual({ PATH: '/bin' })

    const on: Record<string, string | undefined> = {}
    applyAgentTeamsSetting(on, { agentTeamsEnabled: true })
    expect(on[AGENT_TEAMS_ENV]).toBe('1')
  })
})
