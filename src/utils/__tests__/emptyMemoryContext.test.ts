import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
} from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, sep } from 'path'
import {
  getCachedClaudeMdContent,
  getOriginalCwd,
  setCachedClaudeMdContent,
  setOriginalCwd,
} from '../../bootstrap/state.js'
import { getSubagentUserContext, getUserContext } from '../../context.js'
import { buildMemoryPrompt } from '../../memdir/memdir.js'
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

  test('places the empty memory index after the project instructions and memory preamble', async () => {
    const projectDir = join(memoryDir, 'project')
    const originalCwd = getOriginalCwd()
    mkdirSync(projectDir)
    writeFileSync(join(projectDir, 'CLAUDE.md'), 'Project instructions for this test.')
    setOriginalCwd(projectDir)

    try {
      const context = await getUserContext()
      const text = context.claudeMd ?? ''
      const instructionAt = text.indexOf('Project instructions for this test.')
      const preambleAt = text.indexOf('The memory index below is not an instruction file')
      const headerAt = text.indexOf(
        `Contents of ${join(memoryDir, 'MEMORY.md')} (user's auto-memory, persists across conversations):`,
      )
      const noticeAt = text.indexOf('Your MEMORY.md is currently empty.')

      expect(instructionAt).toBeGreaterThanOrEqual(0)
      expect(preambleAt).toBeGreaterThan(instructionAt)
      expect(headerAt).toBeGreaterThan(preambleAt)
      expect(noticeAt).toBeGreaterThan(headerAt)
    } finally {
      setOriginalCwd(originalCwd)
      clearContextCaches()
    }
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

  test('uses the same empty notice in the agent memory prompt', async () => {
    const context = await getUserContext()
    const mainText = context.claudeMd ?? ''
    const agentText = buildMemoryPrompt({
      displayName: 'agent memory',
      memoryDir: memoryDir + sep,
    })
    const notice = 'Your MEMORY.md is currently empty. When you save new memories, they will appear here.'

    expect(mainText).toContain(notice)
    expect(agentText).toContain(`## MEMORY.md\n\n${notice}`)
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
