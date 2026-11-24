import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import * as fs from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import { getSettingsFilePathForSource } from '../../utils/settings/settings.js'
import { resetSettingsCache } from '../../utils/settings/settingsCache.js'
import { handleAgentsApi } from '../api/agents.js'

describe('GET /api/agents', () => {
  let workDir: string
  let settingsPath: string
  let previousSettings: string | null

  beforeEach(async () => {
    workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agents-api-'))
    settingsPath = getSettingsFilePathForSource('userSettings')!
    previousSettings = await fs.readFile(settingsPath, 'utf-8').catch(() => null)
    await fs.mkdir(path.dirname(settingsPath), { recursive: true })
    await fs.writeFile(settingsPath, JSON.stringify({ env: { AGENTS_API_PROBE: 'probe-value' } }), 'utf-8')
    resetSettingsCache()
  })

  afterEach(async () => {
    if (previousSettings === null) await fs.rm(settingsPath, { force: true })
    else await fs.writeFile(settingsPath, previousSettings, 'utf-8')
    resetSettingsCache()
    await fs.rm(workDir, { recursive: true, force: true })
  })

  it('includes the system prompt of the Claude Code Guide agent without the user settings', async () => {
    const url = new URL(`http://localhost/api/agents?cwd=${encodeURIComponent(workDir)}`)
    const res = await handleAgentsApi(new Request(url), url, ['api', 'agents'])
    const body = await res.json() as {
      activeAgents: Array<{ agentType: string; systemPrompt?: string }>
    }

    const guide = body.activeAgents.find(agent => agent.agentType === 'claude-code-guide')
    expect(guide?.systemPrompt).toContain('Claude Code')
    expect(guide?.systemPrompt).not.toContain('probe-value')
  })
})
