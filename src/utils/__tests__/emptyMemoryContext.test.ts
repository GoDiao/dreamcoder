import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
} from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  getCachedClaudeMdContent,
  setCachedClaudeMdContent,
} from '../../bootstrap/state.js'
import { getSubagentUserContext, getUserContext } from '../../context.js'
import { getAutoMemPath } from '../../memdir/paths.js'
import { clearMemoryFileCaches } from '../claudemd.js'

const envNames = [
  'CLAUDE_COWORK_MEMORY_PATH_OVERRIDE',
  'CLAUDE_CODE_DISABLE_AUTO_MEMORY',
  'CLAUDE_CODE_DISABLE_CLAUDE_MDS',
  'CLAUDE_CODE_SIMPLE',
] as const

let memoryDir: string
let originalEnv: Map<string, string | undefined>
let originalCachedClaudeMd: string | null

function clearContextCaches() {
  getAutoMemPath.cache.clear?.()
  clearMemoryFileCaches()
  getUserContext.cache.clear?.()
}

beforeEach(() => {
  originalEnv = new Map(envNames.map(name => [name, process.env[name]]))
  originalCachedClaudeMd = getCachedClaudeMdContent()

  memoryDir = mkdtempSync(join(tmpdir(), 'dreamcoder-memory-test-'))

  process.env.CLAUDE_COWORK_MEMORY_PATH_OVERRIDE = memoryDir
  process.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY = '0'
  process.env.CLAUDE_CODE_DISABLE_CLAUDE_MDS = '0'
  process.env.CLAUDE_CODE_SIMPLE = '0'

  clearContextCaches()
})

afterEach(() => {
  for (const name of envNames) {
    const originalValue = originalEnv.get(name)

    if (originalValue === undefined) {
      delete process.env[name]
    } else {
      process.env[name] = originalValue
    }
  }

  clearContextCaches()
  setCachedClaudeMdContent(originalCachedClaudeMd)
  rmSync(memoryDir, { recursive: true, force: true })
})

describe('empty auto-memory in the main session', () => {
  test('reports an empty memory when MEMORY.md does not exist', async () => {
    const context = await getUserContext()
    const text = context.claudeMd ?? ''

    expect(text).toContain('MEMORY.md is currently empty')
  })

  test('reports an empty memory when MEMORY.md contains only whitespace', async () => {
    writeFileSync(join(memoryDir, 'MEMORY.md'), '  \n  ')

    const context = await getUserContext()
    const text = context.claudeMd ?? ''

    expect(text).toContain('MEMORY.md is currently empty')
  })

  test('loads a non-empty MEMORY.md without reporting it as empty', async () => {
    writeFileSync(
      join(memoryDir, 'MEMORY.md'),
      '- [Testing preference](testing.md) — Use Bun',
    )

    const context = await getUserContext()
    const text = context.claudeMd ?? ''

    expect(text).toContain('Use Bun')
    expect(text).not.toContain('MEMORY.md is currently empty')
  })

  test('does not report an unreadable memory as empty', async () => {
    mkdirSync(join(memoryDir, 'MEMORY.md'))

    const context = await getUserContext()
    const text = context.claudeMd ?? ''

    expect(text).not.toContain('MEMORY.md is currently empty')
  })

  test('does not include the main session memory notice in subagent context', async () => {
    const context = await getSubagentUserContext()
    const text = context.claudeMd ?? ''

    expect(text).not.toContain('MEMORY.md is currently empty')
  })

  test('does not report an empty memory when auto-memory is disabled', async () => {
    process.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY = '1'

    const context = await getUserContext()
    const text = context.claudeMd ?? ''

    expect(text).not.toContain('MEMORY.md is currently empty')
  })
})
