import * as fs from 'fs'
import * as path from 'path'
import { sendToTeam, setTeamMembership, type TeamRole } from '../ws/handler.js'
import type { ServerMessage, TeamMemberStatus } from '../ws/protocol.js'
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js'

function getTeamsDir(): string {
  const configDir = getClaudeConfigHomeDir()
  return path.join(configDir, 'teams')
}

export class TeamWatcher {
  private intervalId: ReturnType<typeof setInterval> | null = null
  private lastSnapshots = new Map<string, string>()

  start(intervalMs = 3000): void {
    if (this.intervalId) return
    this.check()
    this.intervalId = setInterval(() => this.check(), intervalMs)
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId)
      this.intervalId = null
    }
  }

  checkNow(): void {
    this.check()
  }

  reset(): void {
    this.lastSnapshots.clear()
  }

  private check(): void {
    const teamsDir = getTeamsDir()

    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(teamsDir, { withFileTypes: true })
    } catch {
      for (const [name] of this.lastSnapshots) {
        this.deleteTeam(name)
      }
      this.lastSnapshots.clear()
      return
    }

    const currentTeamNames = new Set<string>()

    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const teamName = entry.name
      currentTeamNames.add(teamName)

      const configPath = path.join(teamsDir, teamName, 'config.json')
      let content: string
      try {
        content = fs.readFileSync(configPath, 'utf-8')
      } catch {
        continue
      }

      const lastContent = this.lastSnapshots.get(teamName)
      setTeamMembership(teamName, this.extractSessionRoles(content))

      if (lastContent === undefined) {
        this.lastSnapshots.set(teamName, content)
        this.broadcast({ type: 'team_created', teamName })
      } else if (content !== lastContent) {
        this.lastSnapshots.set(teamName, content)
        try {
          const config = JSON.parse(content)
          const members = this.extractMemberStatuses(config)
          const inboxMembers = this.discoverInboxMembers(teamsDir, teamName, config)
          const subagentMembers = this.discoverSubagentMembers(teamsDir, config)
          const allMembers = [...members, ...inboxMembers, ...subagentMembers]
          this.broadcast({ type: 'team_update', teamName, members: allMembers })
        } catch {
          const recovered = this.recoverPartialMembers(content)
          if (recovered.length > 0) {
            this.broadcast({ type: 'team_update', teamName, members: recovered })
          }
        }
      }
    }

    for (const [name] of this.lastSnapshots) {
      if (!currentTeamNames.has(name)) {
        this.lastSnapshots.delete(name)
        this.deleteTeam(name)
      }
    }
  }

  extractSessionRoles(content: string): Map<string, TeamRole> {
    const roles = new Map<string, TeamRole>()
    let config: Record<string, unknown>
    try {
      config = JSON.parse(content) as Record<string, unknown>
    } catch {
      return roles
    }
    const members = Array.isArray(config.members) ? config.members as Array<Record<string, unknown>> : []
    for (const member of members) {
      if (typeof member?.sessionId === 'string' && member.sessionId) roles.set(member.sessionId, 'member')
    }
    if (typeof config.leadSessionId === 'string' && config.leadSessionId) roles.set(config.leadSessionId, 'lead')
    return roles
  }

  private deleteTeam(teamName: string): void {
    this.broadcast({ type: 'team_deleted', teamName })
    setTeamMembership(teamName, new Map())
  }

  extractMemberStatuses(config: Record<string, unknown>): TeamMemberStatus[] {
    const members = config.members
    if (!Array.isArray(members)) return []

    return members.map((m: Record<string, unknown>) => {
      const status = this.deriveStatus(m.isActive as boolean | undefined)
      return {
        agentId: (m.agentId as string) || '',
        role: (m.name as string) || (m.agentType as string) || 'member',
        status,
        currentTask: (m.currentTask as string) || undefined,
      }
    })
  }

  private deriveStatus(isActive: boolean | undefined): TeamMemberStatus['status'] {
    if (isActive === false) return 'idle'
    return 'running'
  }

  private discoverInboxMembers(
    teamsDir: string,
    teamName: string,
    config: Record<string, unknown>,
  ): TeamMemberStatus[] {
    const inboxDir = path.join(teamsDir, teamName, 'inboxes')
    const configMembers = Array.isArray(config.members) ? config.members : []
    const configNames = new Set(
      configMembers.map((m: Record<string, unknown>) => m.name as string),
    )

    try {
      const files = fs.readdirSync(inboxDir)
      const extra: TeamMemberStatus[] = []

      for (const file of files) {
        if (!file.endsWith('.json')) continue
        const name = file.replace(/\.json$/, '')
        if (name === 'team-lead' || configNames.has(name)) continue

        extra.push({
          agentId: `${name}@${teamName}`,
          role: name,
          status: 'running',
        })
      }

      return extra
    } catch {
      return []
    }
  }

  private discoverSubagentMembers(
    teamsDir: string,
    config: Record<string, unknown>,
  ): TeamMemberStatus[] {
    const leadSessionId =
      typeof config.leadSessionId === 'string' ? config.leadSessionId : null
    const teamName = typeof config.name === 'string' ? config.name : 'team'
    if (!leadSessionId) return []

    const configMembers = Array.isArray(config.members) ? config.members : []
    const configNames = new Set(
      configMembers.map((m: Record<string, unknown>) => m.name as string),
    )
    const projectsDir = path.join(path.dirname(teamsDir), 'projects')

    try {
      const projectEntries = fs.readdirSync(projectsDir, { withFileTypes: true })
      const extra = new Map<string, TeamMemberStatus>()

      for (const entry of projectEntries) {
        if (!entry.isDirectory()) continue
        const subagentsDir = path.join(
          projectsDir,
          entry.name,
          leadSessionId,
          'subagents',
        )

        let files: string[]
        try {
          files = fs.readdirSync(subagentsDir)
        } catch {
          continue
        }

        for (const file of files) {
          if (!file.endsWith('.jsonl')) continue
          const inferredName = this.extractSubagentName(
            path.join(subagentsDir, file),
          )
          if (
            inferredName &&
            inferredName !== 'team-lead' &&
            !configNames.has(inferredName) &&
            !extra.has(inferredName)
          ) {
            extra.set(inferredName, {
              agentId: `${inferredName}@${teamName}`,
              role: inferredName,
              status: 'running',
            })
          }
        }
      }

      return [...extra.values()]
    } catch {
      return []
    }
  }

  private recoverPartialMembers(rawContent: string): TeamMemberStatus[] {
    const members: TeamMemberStatus[] = []
    const agentIdRegex = /"agentId"\s*:\s*"([^"]+)"/g
    const nameRegex = /"(?:agentType|name)"\s*:\s*"([^"]+)"/g
    const isActiveRegex = /"isActive"\s*:\s*(true|false)/g

    const agentIds: string[] = []
    const names: string[] = []
    const activeStates: (boolean | undefined)[] = []

    let match: RegExpExecArray | null
    while ((match = agentIdRegex.exec(rawContent)) !== null) {
      agentIds.push(match[1]!)
    }
    while ((match = nameRegex.exec(rawContent)) !== null) {
      names.push(match[1]!)
    }
    while ((match = isActiveRegex.exec(rawContent)) !== null) {
      activeStates.push(match[1] === 'true')
    }

    for (let i = 0; i < agentIds.length; i++) {
      members.push({
        agentId: agentIds[i]!,
        role: names[i] || 'member',
        status: this.deriveStatus(activeStates[i]),
      })
    }

    return members
  }

  private extractSubagentName(filePath: string): string | null {
    try {
      const head = fs.readFileSync(filePath, 'utf-8').slice(0, 8192)
      const lines = head.split('\n').filter((line) => line.trim().length > 0)

      for (const line of lines) {
        try {
          const entry = JSON.parse(line) as Record<string, unknown>
          if (typeof entry.agentName === 'string' && entry.agentName.trim()) {
            return entry.agentName
          }
          if (typeof entry.agentId === 'string' && entry.agentId.includes('@')) {
            return entry.agentId.split('@')[0] ?? null
          }
        } catch {
        }
      }

      // The last line of the head may be cut off before JSON.parse can read it.
      return head.match(/"agentName"\s*:\s*"([^"]+)"/)?.[1] ?? null
    } catch {
      return null
    }
  }

  private broadcast(message: ServerMessage & { teamName: string }): void {
    sendToTeam(message.teamName, message)
  }
}

export const teamWatcher = new TeamWatcher()
