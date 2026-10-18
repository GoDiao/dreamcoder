import { afterEach, describe, expect, test } from 'bun:test'
import { homedir } from 'os'
import { join } from 'path'
import { isInGlobalClaudeFolder } from '../../components/permissions/FilePermissionDialog/permissionOptions.js'
import {
  checkPathSafetyForAutoEdit,
  getClaudeSkillScope,
  getConfigFolderPermissionPattern,
  getConfigFolderRulePrefix,
  isInConfigFolder,
} from '../permissions/filesystem.js'
import { getConfigDirForDisplay } from '../envUtils.js'

const originalConfigDir = process.env.DREAMCODER_CONFIG_DIR

afterEach(() => {
  if (originalConfigDir === undefined) delete process.env.DREAMCODER_CONFIG_DIR
  else process.env.DREAMCODER_CONFIG_DIR = originalConfigDir
})

// Paths are only computed, never created.
describe("permissions for DreamCoder's config folder", () => {
  test('under the home directory, rules use the ~/ form', () => {
    process.env.DREAMCODER_CONFIG_DIR = join(homedir(), '.dreamcoder-permissions-test')

    expect(getConfigFolderRulePrefix()).toBe('~/.dreamcoder-permissions-test/')
    expect(getConfigFolderPermissionPattern()).toBe('~/.dreamcoder-permissions-test/**')
    expect(getConfigDirForDisplay()).toBe('~/.dreamcoder-permissions-test')
  })

  test('outside the home directory, rules use an absolute pattern', () => {
    process.env.DREAMCODER_CONFIG_DIR = '/opt/portable-test/CLAUDE_CONFIG_DIR'

    expect(getConfigFolderRulePrefix()).toBe('//opt/portable-test/CLAUDE_CONFIG_DIR/')
    expect(getConfigDirForDisplay()).toBe('/opt/portable-test/CLAUDE_CONFIG_DIR')
  })

  test('settings.json in the config folder asks for permission and offers the folder option', () => {
    const configDir = join(homedir(), '.dreamcoder-permissions-test')
    process.env.DREAMCODER_CONFIG_DIR = configDir
    const settingsPath = join(configDir, 'settings.json')

    expect(isInConfigFolder(settingsPath)).toBe(true)
    expect(isInGlobalClaudeFolder(settingsPath)).toBe(true)
    expect(checkPathSafetyForAutoEdit(settingsPath, [settingsPath]).safe).toBe(false)
  })

  test("a portable config folder is protected even though it is not named like one", () => {
    process.env.DREAMCODER_CONFIG_DIR = '/opt/portable-test/CLAUDE_CONFIG_DIR'
    const hookPath = '/opt/portable-test/CLAUDE_CONFIG_DIR/hooks/run.sh'

    expect(checkPathSafetyForAutoEdit(hookPath, [hookPath]).safe).toBe(false)
  })

  test("Claude Code's folder is no longer DreamCoder's, but stays protected", () => {
    process.env.DREAMCODER_CONFIG_DIR = join(homedir(), '.dreamcoder-permissions-test')
    const claudeCodeSettings = join(homedir(), '.claude', 'settings.json')

    expect(isInGlobalClaudeFolder(claudeCodeSettings)).toBe(false)
    expect(checkPathSafetyForAutoEdit(claudeCodeSettings, [claudeCodeSettings]).safe).toBe(false)
  })

  test('a .dreamcoder folder anywhere is a dangerous directory', () => {
    process.env.DREAMCODER_CONFIG_DIR = join(homedir(), '.dreamcoder-permissions-test')
    const path = '/opt/some-repo/.dreamcoder/settings.json'

    expect(checkPathSafetyForAutoEdit(path, [path]).safe).toBe(false)
  })

  test('a skill in the config folder gets a narrowed rule', () => {
    const configDir = join(homedir(), '.dreamcoder-permissions-test')
    process.env.DREAMCODER_CONFIG_DIR = configDir

    expect(getClaudeSkillScope(join(configDir, 'skills', 'my-skill', 'SKILL.md'))).toEqual({
      skillName: 'my-skill',
      pattern: '~/.dreamcoder-permissions-test/skills/my-skill/**',
    })
  })
})
