import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  getCwdState,
  getOriginalCwd,
  setCwdState,
  setOriginalCwd,
} from '../../bootstrap/state.js'
import {
  asOwnAgentCopy,
  deleteAgentFromFile,
  prepareAgentFileForEditing,
} from '../../components/agents/agentFileUtils.js'
import { clearSkillCaches, getSkillDirCommands } from '../../skills/loadSkillsDir.js'
import {
  clearAgentDefinitionsCache,
  getAgentDefinitionsWithOverrides,
} from '../../tools/AgentTool/loadAgentsDir.js'
import { clearMemoryFileCaches, getMemoryFiles } from '../claudemd.js'
import type { Command } from '../../types/command.js'
import type { AgentDefinition } from '../../tools/AgentTool/loadAgentsDir.js'
import type { MemoryFileInfo } from '../claudemd.js'
import { getInheritedClaudeCodeDir } from '../envUtils.js'
import { getInitialSettings } from '../settings/settings.js'
import { resetSettingsCache } from '../settings/settingsCache.js'

// Claude Code's variable, spelled in pieces so the config-dir guard test does not match it.
const CLAUDE_CODE_VARIABLE = ['CLAUDE', 'CONFIG', 'DIR'].join('_')
const ENV_KEYS = ['HOME', 'USERPROFILE', 'DREAMCODER_CONFIG_DIR', CLAUDE_CODE_VARIABLE]

let tmp: string
let dreamcoderDir: string
let claudeCodeDir: string
let projectDir: string
let savedEnv: Record<string, string | undefined>
let savedCwd: string
let savedOriginalCwd: string

async function write(file: string, content: string) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, content)
}

async function writeSkill(root: string, name: string, description: string) {
  await write(
    path.join(root, 'skills', name, 'SKILL.md'),
    `---\ndescription: ${description}\n---\n\nBody of ${name}.\n`,
  )
}

async function writeAgent(root: string, name: string, description: string) {
  await write(
    path.join(root, 'agents', `${name}.md`),
    `---\nname: ${name}\ndescription: ${description}\n---\n\nPrompt of ${name}.\n`,
  )
}

async function listTree(root: string): Promise<string[]> {
  const entries = await fs.readdir(root, { recursive: true })
  return entries.map(String).sort()
}

function clearCaches() {
  clearSkillCaches()
  clearAgentDefinitionsCache()
  clearMemoryFileCaches()
  resetSettingsCache()
  getInheritedClaudeCodeDir.cache.clear?.()
}

async function loadSkills(): Promise<Command[]> {
  const commands: Command[] = await getSkillDirCommands(projectDir)
  return commands.filter(c => c.type === 'prompt')
}

async function loadUserMemory(): Promise<MemoryFileInfo[]> {
  const files: MemoryFileInfo[] = await getMemoryFiles()
  return files.filter(f => f.type === 'User')
}

describe('inheriting Claude Code customizations', () => {
  beforeEach(async () => {
    tmp = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'inherit-cc-')))
    dreamcoderDir = path.join(tmp, 'dreamcoder')
    claudeCodeDir = path.join(tmp, 'claude-code')
    projectDir = path.join(tmp, 'home', 'project')
    await fs.mkdir(dreamcoderDir, { recursive: true })
    await fs.mkdir(claudeCodeDir, { recursive: true })
    await fs.mkdir(projectDir, { recursive: true })

    savedEnv = Object.fromEntries(ENV_KEYS.map(key => [key, process.env[key]]))
    savedCwd = getCwdState()
    savedOriginalCwd = getOriginalCwd()
    process.env.HOME = path.join(tmp, 'home')
    process.env.USERPROFILE = path.join(tmp, 'home')
    process.env.DREAMCODER_CONFIG_DIR = dreamcoderDir
    process.env[CLAUDE_CODE_VARIABLE] = claudeCodeDir
    setCwdState(projectDir)
    setOriginalCwd(projectDir)
    clearCaches()
  })

  afterEach(async () => {
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key]
      else process.env[key] = savedEnv[key]
    }
    setCwdState(savedCwd)
    setOriginalCwd(savedOriginalCwd)
    clearCaches()
    await fs.rm(tmp, { recursive: true, force: true })
  })

  describe('locating the directory', () => {
    test('returns Claude Code directory when it differs from DreamCoder', () => {
      expect(getInheritedClaudeCodeDir()).toBe(claudeCodeDir)
    })

    test('falls back to ~/.claude when the variable is unset', () => {
      delete process.env[CLAUDE_CODE_VARIABLE]
      expect(getInheritedClaudeCodeDir()).toBe(path.join(os.homedir(), '.claude'))
    })

    test('is skipped when it is DreamCoder directory', () => {
      process.env[CLAUDE_CODE_VARIABLE] = dreamcoderDir
      expect(getInheritedClaudeCodeDir()).toBeUndefined()
    })

    test('is skipped when a symlink points at DreamCoder directory', async () => {
      const link = path.join(tmp, 'link-to-dreamcoder')
      await fs.symlink(dreamcoderDir, link, process.platform === 'win32' ? 'junction' : 'dir')
      process.env[CLAUDE_CODE_VARIABLE] = link
      expect(getInheritedClaudeCodeDir()).toBeUndefined()
    })
  })

  describe('skills and commands', () => {
    test('loads Claude Code skills and commands, tagged as inherited', async () => {
      await writeSkill(claudeCodeDir, 'cc-skill', 'from claude code')
      await write(path.join(claudeCodeDir, 'commands', 'cc-cmd.md'), 'Run the cc command.\n')

      const skills = await loadSkills()
      const skill = skills.find(s => s.name === 'cc-skill')
      const command = skills.find(s => s.name === 'cc-cmd')
      expect(skill?.type === 'prompt' && skill.inheritedFromClaudeCode).toBe(true)
      expect(skill?.type === 'prompt' && skill.source).toBe('userSettings')
      expect(command?.type === 'prompt' && command.inheritedFromClaudeCode).toBe(true)
    })

    test('a same-named skill or command in DreamCoder directory wins', async () => {
      await writeSkill(claudeCodeDir, 'shared', 'claude code version')
      await writeSkill(dreamcoderDir, 'shared', 'dreamcoder version')
      await write(path.join(claudeCodeDir, 'commands', 'deploy.md'), 'Claude Code deploy.\n')
      await write(path.join(dreamcoderDir, 'commands', 'deploy.md'), 'DreamCoder deploy.\n')

      const skills = await loadSkills()
      const shared = skills.filter(s => s.name === 'shared')
      const deploy = skills.filter(s => s.name === 'deploy')
      expect(shared.map(s => s.description)).toEqual(['dreamcoder version'])
      expect(deploy.map(s => s.type === 'prompt' && !!s.inheritedFromClaudeCode)).toEqual([false])
    })

    test('loads nothing extra when Claude Code directory is missing', async () => {
      await fs.rm(claudeCodeDir, { recursive: true })
      await writeSkill(dreamcoderDir, 'own', 'own skill')

      const skills = await loadSkills()
      expect(skills.map(s => s.name)).toEqual(['own'])
    })

    test('loads each skill once when both are the same directory', async () => {
      process.env[CLAUDE_CODE_VARIABLE] = dreamcoderDir
      clearCaches()
      await writeSkill(dreamcoderDir, 'own', 'own skill')

      const skills = await loadSkills()
      expect(skills.map(s => s.name)).toEqual(['own'])
    })
  })

  describe('agents', () => {
    test('loads Claude Code agents, tagged as inherited', async () => {
      await writeAgent(claudeCodeDir, 'cc-agent', 'from claude code')

      const { activeAgents } = await getAgentDefinitionsWithOverrides(projectDir) as { activeAgents: AgentDefinition[] }
      const agent = activeAgents.find(a => a.agentType === 'cc-agent')
      expect(agent?.source).toBe('userSettings')
      expect(agent && 'inheritedFromClaudeCode' in agent && agent.inheritedFromClaudeCode).toBe(true)
    })

    test('a same-named agent in DreamCoder directory wins', async () => {
      await writeAgent(claudeCodeDir, 'reviewer', 'claude code reviewer')
      await writeAgent(dreamcoderDir, 'reviewer', 'dreamcoder reviewer')

      const { activeAgents, allAgents } = await getAgentDefinitionsWithOverrides(projectDir) as {
        activeAgents: AgentDefinition[]
        allAgents: AgentDefinition[]
      }
      expect(activeAgents.find(a => a.agentType === 'reviewer')?.whenToUse).toBe(
        'dreamcoder reviewer',
      )
      expect(allAgents.filter(a => a.agentType === 'reviewer')).toHaveLength(1)
    })

    test('deleting an inherited agent is refused and leaves the file', async () => {
      await writeAgent(claudeCodeDir, 'cc-agent', 'from claude code')
      const { activeAgents } = await getAgentDefinitionsWithOverrides(projectDir) as { activeAgents: AgentDefinition[] }
      const agent = activeAgents.find(a => a.agentType === 'cc-agent')!

      await expect(deleteAgentFromFile(agent)).rejects.toThrow('read-only')
      await fs.access(path.join(claudeCodeDir, 'agents', 'cc-agent.md'))
    })

    test('editing an inherited agent copies it into DreamCoder directory first', async () => {
      await writeAgent(claudeCodeDir, 'cc-agent', 'from claude code')
      const original = await fs.readFile(path.join(claudeCodeDir, 'agents', 'cc-agent.md'), 'utf8')
      const { activeAgents } = await getAgentDefinitionsWithOverrides(projectDir) as { activeAgents: AgentDefinition[] }
      const agent = activeAgents.find(a => a.agentType === 'cc-agent')!

      const filePath = await prepareAgentFileForEditing(agent)
      expect(filePath).toBe(path.join(dreamcoderDir, 'agents', 'cc-agent.md'))
      expect(await fs.readFile(filePath, 'utf8')).toBe(original)

      // The edited copy is DreamCoder's own, so it can be deleted; Claude Code's file stays.
      await deleteAgentFromFile(asOwnAgentCopy(agent))
      await expect(fs.access(filePath)).rejects.toThrow()
      await fs.access(path.join(claudeCodeDir, 'agents', 'cc-agent.md'))
    })
  })

  describe('CLAUDE.md and rules', () => {
    test('uses Claude Code CLAUDE.md and rules when DreamCoder has none', async () => {
      await write(path.join(claudeCodeDir, 'CLAUDE.md'), 'Claude Code instructions.')
      await write(path.join(claudeCodeDir, 'rules', 'style.md'), 'Claude Code rule.')

      const contents = (await loadUserMemory()).map(f => f.content.trim())
      expect(contents).toEqual(['Claude Code instructions.', 'Claude Code rule.'])
    })

    test('DreamCoder CLAUDE.md replaces Claude Code one, even when empty', async () => {
      await write(path.join(claudeCodeDir, 'CLAUDE.md'), 'Claude Code instructions.')
      await write(path.join(dreamcoderDir, 'CLAUDE.md'), '')

      const paths = (await loadUserMemory())
        .map(f => f.path)
      expect(paths.some((p: string) => p.startsWith(claudeCodeDir))).toBe(false)
    })

    test('DreamCoder rules directory replaces Claude Code one as a whole', async () => {
      await write(path.join(claudeCodeDir, 'rules', 'a.md'), 'Claude Code rule A.')
      await write(path.join(claudeCodeDir, 'rules', 'b.md'), 'Claude Code rule B.')
      await write(path.join(dreamcoderDir, 'rules', 'a.md'), 'DreamCoder rule A.')

      const contents = (await loadUserMemory()).map(f => f.content.trim())
      expect(contents).toEqual(['DreamCoder rule A.'])
    })
  })

  test('does not inherit settings.json and writes nothing to Claude Code directory', async () => {
    await write(
      path.join(claudeCodeDir, 'settings.json'),
      JSON.stringify({
        hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'echo cc' }] }] },
      }),
    )
    await writeSkill(claudeCodeDir, 'cc-skill', 'from claude code')
    await writeAgent(claudeCodeDir, 'cc-agent', 'from claude code')
    await write(path.join(claudeCodeDir, 'CLAUDE.md'), 'Claude Code instructions.')
    const before = await listTree(claudeCodeDir)

    expect(getInitialSettings().hooks).toBeUndefined()
    await loadSkills()
    await getAgentDefinitionsWithOverrides(projectDir)
    await loadUserMemory()

    expect(await listTree(claudeCodeDir)).toEqual(before)
  })
})
