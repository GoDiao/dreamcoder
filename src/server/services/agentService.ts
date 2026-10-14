import * as fs from 'fs/promises'
import * as path from 'path'
import * as os from 'os'
import YAML from 'yaml'
import { ApiError } from '../middleware/errorHandler.js'

export type AgentDefinition = {
  name: string
  description?: string
  model?: string
  tools?: string[]
  systemPrompt?: string
  color?: string
}

export class AgentService {
  private getAgentsDir(): string {
    const configDir =
      process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude')
    return path.join(configDir, 'agents')
  }

  async listAgents(): Promise<AgentDefinition[]> {
    const dir = this.getAgentsDir()

    try {
      await fs.access(dir)
    } catch {
      return []
    }

    const entries = await fs.readdir(dir, { withFileTypes: true })
    const agents: AgentDefinition[] = []

    for (const entry of entries) {
      if (!entry.isFile()) continue
      const ext = path.extname(entry.name)
      if (ext !== '.yaml' && ext !== '.yml' && ext !== '.md') continue

      try {
        const agent = await this.loadAgentFile(path.join(dir, entry.name))
        if (agent) agents.push(agent)
      } catch {
      }
    }

    return agents
  }

  async getAgent(name: string): Promise<AgentDefinition | null> {
    const filePath = await this.findAgentFile(name)
    if (!filePath) return null
    return this.loadAgentFile(filePath)
  }

  async createAgent(agent: AgentDefinition): Promise<void> {
    if (!agent.name) {
      throw ApiError.badRequest('Agent name is required')
    }

    const existing = await this.findAgentFile(agent.name)
    if (existing) {
      throw ApiError.conflict(`Agent already exists: ${agent.name}`)
    }

    const dir = this.getAgentsDir()
    await fs.mkdir(dir, { recursive: true })

    const filePath = path.join(dir, `${this.sanitizeName(agent.name)}.yaml`)
    await this.writeAgentFile(filePath, agent)
  }

  async updateAgent(
    name: string,
    updates: Partial<AgentDefinition>,
  ): Promise<void> {
    const filePath = await this.findAgentFile(name)
    if (!filePath) {
      throw ApiError.notFound(`Agent not found: ${name}`)
    }

    const current = await this.loadAgentFile(filePath)
    if (!current) {
      throw ApiError.notFound(`Agent not found: ${name}`)
    }

    const merged: AgentDefinition = { ...current, ...updates, name: current.name }
    await this.writeAgentFile(filePath, merged)
  }

  async deleteAgent(name: string): Promise<void> {
    const filePath = await this.findAgentFile(name)
    if (!filePath) {
      throw ApiError.notFound(`Agent not found: ${name}`)
    }
    await fs.unlink(filePath)
  }

  private async findAgentFile(name: string): Promise<string | null> {
    const dir = this.getAgentsDir()
    const safeName = this.sanitizeName(name)
    const candidates = [
      path.join(dir, `${safeName}.yaml`),
      path.join(dir, `${safeName}.yml`),
      path.join(dir, `${safeName}.md`),
    ]

    for (const candidate of candidates) {
      try {
        await fs.access(candidate)
        return candidate
      } catch {
      }
    }

    return null
  }

  private async loadAgentFile(
    filePath: string,
  ): Promise<AgentDefinition | null> {
    const raw = await fs.readFile(filePath, 'utf-8')
    const ext = path.extname(filePath)

    if (ext === '.md') {
      return this.parseMarkdownFrontmatter(raw, filePath)
    }

    const data = YAML.parse(raw) as Record<string, unknown>
    if (!data || typeof data !== 'object') return null

    return this.toAgentDefinition(data, filePath)
  }

  private parseMarkdownFrontmatter(
    content: string,
    filePath: string,
  ): AgentDefinition | null {
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---/)
    if (!fmMatch) return null

    const data = YAML.parse(fmMatch[1]) as Record<string, unknown>
    if (!data || typeof data !== 'object') return null

    const body = content.slice(fmMatch[0].length).trim()
    if (body && !data.systemPrompt) {
      data.systemPrompt = body
    }

    return this.toAgentDefinition(data, filePath)
  }

  private toAgentDefinition(
    data: Record<string, unknown>,
    filePath: string,
  ): AgentDefinition {
    const baseName = path.basename(filePath).replace(/\.(yaml|yml|md)$/, '')
    return {
      name: typeof data.name === 'string' ? data.name : baseName,
      description:
        typeof data.description === 'string' ? data.description : undefined,
      model: typeof data.model === 'string' ? data.model : undefined,
      tools: Array.isArray(data.tools)
        ? (data.tools as string[])
        : undefined,
      systemPrompt:
        typeof data.systemPrompt === 'string' ? data.systemPrompt : undefined,
      color: typeof data.color === 'string' ? data.color : undefined,
    }
  }

  private async writeAgentFile(
    filePath: string,
    agent: AgentDefinition,
  ): Promise<void> {
    const ext = path.extname(filePath)

    const data: Record<string, unknown> = { name: agent.name }
    if (agent.description !== undefined) data.description = agent.description
    if (agent.model !== undefined) data.model = agent.model
    if (agent.tools !== undefined) data.tools = agent.tools
    if (agent.color !== undefined) data.color = agent.color

    if (ext === '.md') {
      const yamlStr = YAML.stringify(data)
      let content = `---\n${yamlStr}---\n`
      if (agent.systemPrompt) {
        content += `\n${agent.systemPrompt}\n`
      }
      await fs.writeFile(filePath, content, 'utf-8')
      return
    }

    if (agent.systemPrompt !== undefined) data.systemPrompt = agent.systemPrompt
    const yamlStr = YAML.stringify(data)
    await fs.writeFile(filePath, yamlStr, 'utf-8')
  }

  private sanitizeName(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
  }
}
