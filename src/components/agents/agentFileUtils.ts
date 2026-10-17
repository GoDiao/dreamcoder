import { constants as fsConstants } from 'fs'
import { copyFile, mkdir, open, unlink } from 'fs/promises'
import { join } from 'path'
import type { SettingSource } from 'src/utils/settings/constants.js'
import { getManagedFilePath } from 'src/utils/settings/managedPath.js'
import type { AgentMemoryScope } from '../../tools/AgentTool/agentMemory.js'
import {
  clearAgentDefinitionsCache,
  type AgentDefinition,
  isBuiltInAgent,
  isPluginAgent,
} from '../../tools/AgentTool/loadAgentsDir.js'
import { getCwd } from '../../utils/cwd.js'
import type { EffortValue } from '../../utils/effort.js'
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js'
import { getErrnoCode } from '../../utils/errors.js'
import { AGENT_PATHS } from './types.js'

/**
 * Formats agent data as markdown file content
 */
export function formatAgentAsMarkdown(
  agentType: string,
  whenToUse: string,
  tools: string[] | undefined,
  systemPrompt: string,
  color?: string,
  model?: string,
  memory?: AgentMemoryScope,
  effort?: EffortValue,
): string {
  // For YAML double-quoted strings, we need to escape:
  // - Backslashes: \ -> \\
  // - Double quotes: " -> \"
  // - Newlines: \n -> \\n (so yaml reads it as literal backslash-n, not newline)
  const escapedWhenToUse = whenToUse
    .replace(/\\/g, '\\\\') // Escape backslashes first
    .replace(/"/g, '\\"') // Escape double quotes
    .replace(/\n/g, '\\\\n') // Escape newlines as \\n so yaml preserves them as \n

  // Omit tools field entirely when tools is undefined or ['*'] (all tools allowed)
  const isAllTools =
    tools === undefined || (tools.length === 1 && tools[0] === '*')
  const toolsLine = isAllTools ? '' : `\ntools: ${tools.join(', ')}`
  const modelLine = model ? `\nmodel: ${model}` : ''
  const effortLine = effort !== undefined ? `\neffort: ${effort}` : ''
  const colorLine = color ? `\ncolor: ${color}` : ''
  const memoryLine = memory ? `\nmemory: ${memory}` : ''

  return `---
name: ${agentType}
description: "${escapedWhenToUse}"${toolsLine}${modelLine}${effortLine}${colorLine}${memoryLine}
---

${systemPrompt}
`
}

/**
 * Gets the directory path for an agent location
 */
function getAgentDirectoryPath(location: SettingSource): string {
  switch (location) {
    case 'flagSettings':
      throw new Error(`Cannot get directory path for ${location} agents`)
    case 'userSettings':
      return join(getClaudeConfigHomeDir(), AGENT_PATHS.AGENTS_DIR)
    case 'projectSettings':
      return join(getCwd(), AGENT_PATHS.FOLDER_NAME, AGENT_PATHS.AGENTS_DIR)
    case 'policySettings':
      return join(
        getManagedFilePath(),
        AGENT_PATHS.FOLDER_NAME,
        AGENT_PATHS.AGENTS_DIR,
      )
    case 'localSettings':
      return join(getCwd(), AGENT_PATHS.FOLDER_NAME, AGENT_PATHS.AGENTS_DIR)
  }
}

function getRelativeAgentDirectoryPath(location: SettingSource): string {
  switch (location) {
    case 'projectSettings':
      return join('.', AGENT_PATHS.FOLDER_NAME, AGENT_PATHS.AGENTS_DIR)
    default:
      return getAgentDirectoryPath(location)
  }
}

/**
 * Gets the file path for a new agent based on its name
 * Used when creating new agent files
 */
export function getNewAgentFilePath(agent: {
  source: SettingSource
  agentType: string
}): string {
  const dirPath = getAgentDirectoryPath(agent.source)
  return join(dirPath, `${agent.agentType}.md`)
}

/**
 * Gets the actual file path for an agent (handles filename vs agentType mismatch)
 * Always use this for existing agents to get their real file location
 */
export function getActualAgentFilePath(agent: AgentDefinition): string {
  if (agent.source === 'built-in') {
    return 'Built-in'
  }
  if (agent.source === 'plugin') {
    throw new Error('Cannot get file path for plugin agents')
  }

  const dirPath = getAgentDirectoryPath(agent.source)
  const filename = agent.filename || agent.agentType
  return join(dirPath, `${filename}.md`)
}

function isInheritedAgent(agent: AgentDefinition): boolean {
  return 'inheritedFromClaudeCode' in agent && !!agent.inheritedFromClaudeCode
}

/**
 * The agent as DreamCoder's own copy: what an inherited agent becomes once it
 * is edited, since edits land in DreamCoder's directory.
 */
export function asOwnAgentCopy<T extends AgentDefinition>(agent: T): T {
  if (!isInheritedAgent(agent) || agent.source === 'built-in' || agent.source === 'plugin') {
    return agent
  }
  return {
    ...agent,
    inheritedFromClaudeCode: undefined,
    baseDir: getAgentDirectoryPath(agent.source),
  }
}

/**
 * Path of the file to edit for an agent. An inherited agent is first copied,
 * unless a copy already exists, into DreamCoder's directory, which then
 * overrides Claude Code's file; Claude Code's file is never edited.
 */
export async function prepareAgentFileForEditing(
  agent: AgentDefinition,
): Promise<string> {
  const filePath = getActualAgentFilePath(agent)
  if (isInheritedAgent(agent) && agent.baseDir) {
    const filename = agent.filename || agent.agentType
    await mkdir(getAgentDirectoryPath(agent.source as SettingSource), {
      recursive: true,
    })
    try {
      await copyFile(
        join(agent.baseDir, `${filename}.md`),
        filePath,
        fsConstants.COPYFILE_EXCL,
      )
    } catch (e: unknown) {
      if (getErrnoCode(e) !== 'EEXIST') throw e
    }
    clearAgentDefinitionsCache()
  }
  return filePath
}

/**
 * Gets the relative file path for a new agent based on its name
 * Used for displaying where new agent files will be created
 */
export function getNewRelativeAgentFilePath(agent: {
  source: SettingSource | 'built-in'
  agentType: string
}): string {
  if (agent.source === 'built-in') {
    return 'Built-in'
  }
  const dirPath = getRelativeAgentDirectoryPath(agent.source)
  return join(dirPath, `${agent.agentType}.md`)
}

/**
 * Gets the actual relative file path for an agent (handles filename vs agentType mismatch)
 */
export function getActualRelativeAgentFilePath(agent: AgentDefinition): string {
  if (isBuiltInAgent(agent)) {
    return 'Built-in'
  }
  if (isPluginAgent(agent)) {
    return `Plugin: ${agent.plugin || 'Unknown'}`
  }
  if (agent.source === 'flagSettings') {
    return 'CLI argument'
  }

  const dirPath = getRelativeAgentDirectoryPath(agent.source)
  const filename = agent.filename || agent.agentType
  return join(dirPath, `${filename}.md`)
}

/**
 * Ensures the directory for an agent location exists
 */
async function ensureAgentDirectoryExists(
  source: SettingSource,
): Promise<string> {
  const dirPath = getAgentDirectoryPath(source)
  await mkdir(dirPath, { recursive: true })
  return dirPath
}

/**
 * Saves an agent to the filesystem
 * @param checkExists - If true, throws error if file already exists
 */
export async function saveAgentToFile(
  source: SettingSource | 'built-in',
  agentType: string,
  whenToUse: string,
  tools: string[] | undefined,
  systemPrompt: string,
  checkExists = true,
  color?: string,
  model?: string,
  memory?: AgentMemoryScope,
  effort?: EffortValue,
): Promise<void> {
  if (source === 'built-in') {
    throw new Error('Cannot save built-in agents')
  }

  await ensureAgentDirectoryExists(source)
  const filePath = getNewAgentFilePath({ source, agentType })

  const content = formatAgentAsMarkdown(
    agentType,
    whenToUse,
    tools,
    systemPrompt,
    color,
    model,
    memory,
    effort,
  )
  try {
    await writeFileAndFlush(filePath, content, checkExists ? 'wx' : 'w')
  } catch (e: unknown) {
    if (getErrnoCode(e) === 'EEXIST') {
      throw new Error(`Agent file already exists: ${filePath}`)
    }
    throw e
  }
  clearAgentDefinitionsCache()
}

/**
 * Updates an existing agent file
 */
export async function updateAgentFile(
  agent: AgentDefinition,
  newWhenToUse: string,
  newTools: string[] | undefined,
  newSystemPrompt: string,
  newColor?: string,
  newModel?: string,
  newMemory?: AgentMemoryScope,
  newEffort?: EffortValue,
): Promise<void> {
  if (agent.source === 'built-in') {
    throw new Error('Cannot update built-in agents')
  }

  // An agent inherited from Claude Code is never edited in place: the path is
  // DreamCoder's own directory, so this saves a copy that overrides it.
  const filePath = getActualAgentFilePath(agent)
  if (isInheritedAgent(agent)) {
    await mkdir(getAgentDirectoryPath(agent.source as SettingSource), {
      recursive: true,
    })
  }

  const content = formatAgentAsMarkdown(
    agent.agentType,
    newWhenToUse,
    newTools,
    newSystemPrompt,
    newColor,
    newModel,
    newMemory,
    newEffort,
  )

  await writeFileAndFlush(filePath, content)
  clearAgentDefinitionsCache()
}

/**
 * Deletes an agent file
 */
export async function deleteAgentFromFile(
  agent: AgentDefinition,
): Promise<void> {
  if (agent.source === 'built-in') {
    throw new Error('Cannot delete built-in agents')
  }
  if (isInheritedAgent(agent)) {
    throw new Error(
      "This agent is inherited from Claude Code and is read-only. Delete it in Claude Code's agents directory.",
    )
  }

  const filePath = getActualAgentFilePath(agent)

  try {
    await unlink(filePath)
  } catch (e: unknown) {
    const code = getErrnoCode(e)
    if (code !== 'ENOENT') {
      throw e
    }
  }
  clearAgentDefinitionsCache()
}

async function writeFileAndFlush(
  filePath: string,
  content: string,
  flag: 'w' | 'wx' = 'w',
): Promise<void> {
  const handle = await open(filePath, flag)
  try {
    await handle.writeFile(content, { encoding: 'utf-8' })
    await handle.datasync()
  } finally {
    await handle.close()
  }
}
