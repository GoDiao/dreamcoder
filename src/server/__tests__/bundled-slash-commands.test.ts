import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { getCwdState, setCwdState } from '../../bootstrap/state.js'
import { clearBundledSkills, getBundledSkills, registerBundledSkill } from '../../skills/bundledSkills.js'
import { clearInstalledPluginsCache } from '../../utils/plugins/installedPluginsManager.js'
import { clearPluginCache } from '../../utils/plugins/pluginLoader.js'
import { resetSettingsCache } from '../../utils/settings/settingsCache.js'
import { listSkillSlashCommands } from '../api/skills.js'

let tmpHome: string
let originalHome: string | undefined
let originalUserProfile: string | undefined
let originalConfigDir: string | undefined
let originalCwdState: string

const prompt = async () => []

beforeEach(async () => {
  tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'bundled-slash-'))
  originalHome = process.env.HOME
  originalUserProfile = process.env.USERPROFILE
  originalConfigDir = process.env.DREAMCODER_CONFIG_DIR
  originalCwdState = getCwdState()
  process.env.HOME = tmpHome
  process.env.USERPROFILE = tmpHome
  process.env.DREAMCODER_CONFIG_DIR = path.join(tmpHome, '.claude')
  setCwdState(tmpHome)
  clearInstalledPluginsCache()
  clearPluginCache('bundled-slash-setup')
  resetSettingsCache()
  clearBundledSkills()
})

afterEach(async () => {
  clearBundledSkills()
  clearInstalledPluginsCache()
  clearPluginCache('bundled-slash-teardown')
  resetSettingsCache()
  if (originalHome === undefined) delete process.env.HOME
  else process.env.HOME = originalHome
  if (originalUserProfile === undefined) delete process.env.USERPROFILE
  else process.env.USERPROFILE = originalUserProfile
  if (originalConfigDir === undefined) delete process.env.DREAMCODER_CONFIG_DIR
  else process.env.DREAMCODER_CONFIG_DIR = originalConfigDir
  setCwdState(originalCwdState)
  await fs.rm(tmpHome, { recursive: true, force: true })
})

describe('slash commands from bundled skills', () => {
  it('lists the bundled skills a user can invoke, with their descriptions and argument hints', async () => {
    const commands = await listSkillSlashCommands(tmpHome)
    const design = commands.find(command => command.name === 'design')
    expect(design?.argumentHint).toBe('[artifact folder or request]')
    expect(design?.description).toContain('Design mode')
    expect(commands.map(command => command.name)).toContain('artifacts')
  })

  it('leaves out skills that are disabled, hidden from users or not invocable', async () => {
    registerBundledSkill({ name: 'on', description: 'enabled', getPromptForCommand: prompt })
    registerBundledSkill({ name: 'off', description: 'disabled', isEnabled: () => false, getPromptForCommand: prompt })
    registerBundledSkill({ name: 'model-only', description: 'no menu', userInvocable: false, getPromptForCommand: prompt })
    const names = (await listSkillSlashCommands(tmpHome)).map(command => command.name)
    expect(names).toContain('on')
    expect(names).not.toContain('off')
    expect(names).not.toContain('model-only')
  })

  it('lets the bundled skill win over a disk skill with the same name', async () => {
    const skillDir = path.join(tmpHome, '.claude', 'skills', 'design')
    await fs.mkdir(skillDir, { recursive: true })
    await fs.writeFile(path.join(skillDir, 'SKILL.md'), '---\ndescription: from disk\n---\n\n# Disk')
    const commands = (await listSkillSlashCommands(tmpHome)).filter(command => command.name === 'design')
    expect(commands).toHaveLength(1)
    expect(commands[0]!.description).toContain('Design mode')
  })

  it('still lists disk skills that have no bundled twin', async () => {
    const skillDir = path.join(tmpHome, '.claude', 'skills', 'only-on-disk')
    await fs.mkdir(skillDir, { recursive: true })
    await fs.writeFile(path.join(skillDir, 'SKILL.md'), '---\ndescription: disk only\n---\n\n# Disk')
    expect((await listSkillSlashCommands(tmpHome)).map(command => command.name)).toContain('only-on-disk')
  })

  it('registers the bundled skills once however often the list is built', async () => {
    await listSkillSlashCommands(tmpHome)
    const registered = getBundledSkills().length
    await listSkillSlashCommands(tmpHome)
    await listSkillSlashCommands(tmpHome)
    expect(registered).toBeGreaterThan(0)
    expect(getBundledSkills()).toHaveLength(registered)
    const names = (await listSkillSlashCommands(tmpHome)).map(command => command.name)
    expect(new Set(names).size).toBe(names.length)
  })

  it('does not register again when the process already has bundled skills', async () => {
    registerBundledSkill({ name: 'only-one', description: 'x', getPromptForCommand: prompt })
    const names = (await listSkillSlashCommands(tmpHome)).map(command => command.name)
    expect(names).toContain('only-one')
    expect(names).not.toContain('design')
    expect(getBundledSkills()).toHaveLength(1)
  })
})
