import { describe, it, expect, beforeEach, afterEach, mock, spyOn } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as fsSyn from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import type { TeamMemberStatus } from '../ws/protocol.js'

let tmpDir: string

async function setupTmpConfigDir(): Promise<string> {
  tmpDir = path.join(
    os.tmpdir(),
    `claude-watcher-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  )
  await fs.mkdir(path.join(tmpDir, 'teams'), { recursive: true })
  process.env.DREAMCODER_CONFIG_DIR = tmpDir
  return tmpDir
}

async function cleanupTmpDir(): Promise<void> {
  if (tmpDir) {
    await fs.rm(tmpDir, { recursive: true, force: true })
  }
  process.env.DREAMCODER_CONFIG_DIR = configDirAtLoad
}

async function writeTeamConfig(
  teamName: string,
  config: Record<string, unknown>,
): Promise<string> {
  const teamDir = path.join(tmpDir, 'teams', teamName)
  await fs.mkdir(teamDir, { recursive: true })
  const configPath = path.join(teamDir, 'config.json')
  await fs.writeFile(configPath, JSON.stringify(config), 'utf-8')
  return configPath
}

function makeTeamConfig(overrides?: Record<string, unknown>) {
  return {
    name: 'test-team',
    description: 'A test team',
    createdAt: 1700000000000,
    leadAgentId: 'agent-lead',
    members: [
      {
        agentId: 'agent-lead',
        name: 'Lead Agent',
        agentType: 'lead',
        model: 'claude-opus-4-7',
        color: '#ff0000',
        joinedAt: 1700000000000,
        tmuxPaneId: '%0',
        cwd: '/tmp/project',
        sessionId: 'session-lead-001',
        isActive: true,
      },
      {
        agentId: 'agent-worker',
        name: 'Worker Agent',
        agentType: 'worker',
        model: 'claude-sonnet-4-20250514',
        color: '#00ff00',
        joinedAt: 1700000001000,
        tmuxPaneId: '%1',
        cwd: '/tmp/project/src',
        sessionId: 'session-worker-001',
        isActive: false,
      },
    ],
    ...overrides,
  }
}

import type { ServerWebSocket } from 'bun'
import { TeamWatcher } from '../services/teamWatcher.js'
import { sessionService } from '../services/sessionService.js'
import {
  __resetWebSocketHandlerStateForTests,
  getSessionState,
  handleWebSocket,
  type WebSocketData,
} from '../ws/handler.js'

// The test run's own config directory (see testPreload.ts), restored after each test.
const configDirAtLoad = process.env.DREAMCODER_CONFIG_DIR

describe('TeamWatcher.extractMemberStatuses', () => {
  let watcher: TeamWatcher

  beforeEach(() => {
    watcher = new TeamWatcher()
  })

  it('should extract member statuses from a valid config', () => {
    const config = makeTeamConfig()
    const statuses = watcher.extractMemberStatuses(config)

    expect(statuses).toHaveLength(2)
    expect(statuses[0]).toEqual({
      agentId: 'agent-lead',
      role: 'Lead Agent',
      status: 'running',
      currentTask: undefined,
    })
    expect(statuses[1]).toEqual({
      agentId: 'agent-worker',
      role: 'Worker Agent',
      status: 'idle',
      currentTask: undefined,
    })
  })

  it('should return running status when isActive is undefined', () => {
    const config = makeTeamConfig()
    delete (config.members[0] as Record<string, unknown>).isActive
    const statuses = watcher.extractMemberStatuses(config)

    expect(statuses[0]!.status).toBe('running')
  })

  it('should return idle status when isActive is false', () => {
    const config = makeTeamConfig()
    const statuses = watcher.extractMemberStatuses(config)

    expect(statuses[1]!.status).toBe('idle')
  })

  it('should prefer member name as role when present', () => {
    const config = makeTeamConfig()
    const statuses = watcher.extractMemberStatuses(config)

    expect(statuses[0]!.role).toBe('Lead Agent')
    expect(statuses[1]!.role).toBe('Worker Agent')
  })

  it('should fall back to name when agentType is missing', () => {
    const config = makeTeamConfig()
    delete (config.members[0] as Record<string, unknown>).agentType
    const statuses = watcher.extractMemberStatuses(config)

    expect(statuses[0]!.role).toBe('Lead Agent')
  })

  it('should fall back to "member" when both agentType and name are missing', () => {
    const config = makeTeamConfig()
    delete (config.members[0] as Record<string, unknown>).agentType
    delete (config.members[0] as Record<string, unknown>).name
    const statuses = watcher.extractMemberStatuses(config)

    expect(statuses[0]!.role).toBe('member')
  })

  it('should return empty array when config has no members', () => {
    const config = { name: 'empty-team' }
    const statuses = watcher.extractMemberStatuses(config)
    expect(statuses).toEqual([])
  })

  it('should return empty array when members is not an array', () => {
    const config = { name: 'bad-team', members: 'not-an-array' }
    const statuses = watcher.extractMemberStatuses(config)
    expect(statuses).toEqual([])
  })

  it('should include currentTask when present in config', () => {
    const config = makeTeamConfig()
    ;(config.members[0] as Record<string, unknown>).currentTask = 'Implementing feature X'
    const statuses = watcher.extractMemberStatuses(config)

    expect(statuses[0]!.currentTask).toBe('Implementing feature X')
  })
})

describe('TeamWatcher polling', () => {
  let watcher: TeamWatcher

  beforeEach(async () => {
    await setupTmpConfigDir()
    watcher = new TeamWatcher()
  })

  afterEach(async () => {
    watcher.stop()
    watcher.reset()
    await cleanupTmpDir()
  })

  it('should detect new team creation via checkNow()', async () => {
    watcher.checkNow()

    await writeTeamConfig('new-team', makeTeamConfig({ name: 'new-team' }))

    watcher.checkNow()

    const updatedConfig = makeTeamConfig({ name: 'new-team', description: 'updated' })
    await writeTeamConfig('new-team', updatedConfig)
    watcher.checkNow()
  })

  it('should detect team config changes', async () => {
    await writeTeamConfig('change-team', makeTeamConfig({ name: 'change-team' }))

    watcher.checkNow()

    const updatedConfig = makeTeamConfig({
      name: 'change-team',
      description: 'updated description',
    })
    await writeTeamConfig('change-team', updatedConfig)

    watcher.checkNow()
  })

  it('should detect team deletion', async () => {
    await writeTeamConfig('doomed-team', makeTeamConfig({ name: 'doomed-team' }))

    watcher.checkNow()

    await fs.rm(path.join(tmpDir, 'teams', 'doomed-team'), { recursive: true, force: true })

    watcher.checkNow()
  })

  it('should handle missing teams directory gracefully', async () => {
    await fs.rm(path.join(tmpDir, 'teams'), { recursive: true, force: true })

    watcher.checkNow()
  })

  it('should handle malformed config.json gracefully', async () => {
    const teamDir = path.join(tmpDir, 'teams', 'bad-json')
    await fs.mkdir(teamDir, { recursive: true })
    await fs.writeFile(path.join(teamDir, 'config.json'), 'not valid json', 'utf-8')

    watcher.checkNow()
  })

  it('should skip directories without config.json', async () => {
    const teamDir = path.join(tmpDir, 'teams', 'no-config')
    await fs.mkdir(teamDir, { recursive: true })

    watcher.checkNow()
  })

  it('should track multiple teams independently', async () => {
    await writeTeamConfig('team-a', makeTeamConfig({ name: 'team-a' }))
    await writeTeamConfig('team-b', makeTeamConfig({ name: 'team-b' }))

    watcher.checkNow()

    await writeTeamConfig('team-a', makeTeamConfig({ name: 'team-a', description: 'changed' }))

    watcher.checkNow()

    await fs.rm(path.join(tmpDir, 'teams', 'team-b'), { recursive: true, force: true })

    watcher.checkNow()
  })

  it('should start and stop polling without errors', async () => {
    watcher.start(50)

    await new Promise((resolve) => setTimeout(resolve, 150))

    watcher.stop()

    watcher.start(50)
    watcher.stop()
  })

  it('should not start duplicate intervals when start() called twice', async () => {
    watcher.start(100)
    watcher.start(100)

    await new Promise((resolve) => setTimeout(resolve, 50))

    watcher.stop()
  })

  it('should handle teams directory appearing after initial check', async () => {
    await fs.rm(path.join(tmpDir, 'teams'), { recursive: true, force: true })

    watcher.checkNow()

    await fs.mkdir(path.join(tmpDir, 'teams'), { recursive: true })
    await writeTeamConfig('late-team', makeTeamConfig({ name: 'late-team' }))

    watcher.checkNow()
  })

  it('reset() should clear internal state', async () => {
    await writeTeamConfig('reset-team', makeTeamConfig({ name: 'reset-team' }))

    watcher.checkNow()

    watcher.reset()
    watcher.checkNow()
  })
})

describe('TeamWatcher subagent names', () => {
  it('should not take a tool name in a transcript for a member', async () => {
    await setupTmpConfigDir()
    const file = path.join(tmpDir, 'agent-a.jsonl')
    await fs.writeFile(
      file,
      JSON.stringify({
        type: 'assistant',
        agentId: 'a2222222222222222',
        message: { content: [{ type: 'tool_use', name: 'Read', input: {} }] },
      }) + '\n',
    )
    const watcher = new TeamWatcher() as unknown as {
      extractSubagentName(filePath: string): string | null
    }
    expect(watcher.extractSubagentName(file)).toBeNull()
    await cleanupTmpDir()
  })
})

describe('TeamWatcher delivery', () => {
  afterEach(() => {
    __resetWebSocketHandlerStateForTests()
    mock.restore()
  })

  function clientSocket(sessionId: string) {
    const sent: Array<{ type: string }> = []
    const ws = {
      data: {
        sessionId,
        connectedAt: Date.now(),
        channel: 'client',
        clientKind: 'desktop',
        sdkToken: null,
        serverPort: 0,
        serverHost: '127.0.0.1',
      },
      send: (payload: string) => {
        sent.push(JSON.parse(payload))
      },
      close: () => {},
    } as unknown as ServerWebSocket<WebSocketData>
    handleWebSocket.open(ws)
    return sent
  }

  it('sends team events only to the sessions of that team and records their role', async () => {
    await setupTmpConfigDir()
    spyOn(sessionService, 'getSessionRestoreInfo').mockResolvedValue(null)
    const lead = clientSocket('session-lead-001')
    const worker = clientSocket('session-worker-001')
    const outsider = clientSocket('session-outsider-001')
    const watcher = new TeamWatcher()

    await writeTeamConfig('delivery-team', makeTeamConfig({ name: 'delivery-team', leadSessionId: 'session-lead-001' }))
    watcher.checkNow()

    expect(lead.map((message) => message.type)).toContain('team_created')
    expect(worker.map((message) => message.type)).toContain('team_created')
    expect(outsider.map((message) => message.type)).not.toContain('team_created')
    expect(getSessionState('session-lead-001')?.team).toEqual({ name: 'delivery-team', role: 'lead' })
    expect(getSessionState('session-worker-001')?.team).toEqual({ name: 'delivery-team', role: 'member' })
    expect(getSessionState('session-outsider-001')?.team).toBeNull()

    await fs.rm(path.join(tmpDir, 'teams', 'delivery-team'), { recursive: true, force: true })
    watcher.checkNow()

    expect(lead.map((message) => message.type)).toContain('team_deleted')
    expect(outsider.map((message) => message.type)).not.toContain('team_deleted')
    expect(getSessionState('session-lead-001')?.team).toBeNull()

    watcher.stop()
    await cleanupTmpDir()
  })
})
