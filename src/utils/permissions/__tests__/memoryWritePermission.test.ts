import { afterEach, describe, expect, test } from 'bun:test'
import { homedir } from 'os'
import { join } from 'path'
import { getAutoMemPath } from '../../../memdir/paths.js'
import { checkEditableInternalPath, checkPathSafetyForAutoEdit } from '../filesystem.js'

const originalConfigDir = process.env.DREAMCODER_CONFIG_DIR
const originalOverride = process.env.CLAUDE_COWORK_MEMORY_PATH_OVERRIDE

function restore(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}

afterEach(() => {
  restore('DREAMCODER_CONFIG_DIR', originalConfigDir)
  restore('CLAUDE_COWORK_MEMORY_PATH_OVERRIDE', originalOverride)
  getAutoMemPath.cache.clear?.()
})

describe('memory writes in the directory the server sets', () => {
  const configDir = join(homedir(), '.dreamcoder-memory-permission-test')
  const memoryDir = join(configDir, 'projects', '-Users-alice-app', 'memory')

  function useServerMemoryDir() {
    process.env.DREAMCODER_CONFIG_DIR = configDir
    process.env.CLAUDE_COWORK_MEMORY_PATH_OVERRIDE = memoryDir + '/'
    getAutoMemPath.cache.clear?.()
  }

  test('a memory file there is allowed without asking, although the folder is protected', () => {
    useServerMemoryDir()
    const memoryFile = join(memoryDir, 'feedback_bun.md')

    expect(checkPathSafetyForAutoEdit(memoryFile, [memoryFile]).safe).toBe(false)
    expect(checkEditableInternalPath(memoryFile, {}).behavior).toBe('allow')
  })

  test('the memory index there is allowed too', () => {
    useServerMemoryDir()

    expect(checkEditableInternalPath(join(memoryDir, 'MEMORY.md'), {}).behavior).toBe('allow')
  })

  test('a file next to the memory directory still goes through the normal checks', () => {
    useServerMemoryDir()

    expect(checkEditableInternalPath(join(configDir, 'settings.json'), {}).behavior).toBe('passthrough')
    expect(checkEditableInternalPath(join(memoryDir, '..', 'settings.json'), {}).behavior).toBe('passthrough')
  })
})
