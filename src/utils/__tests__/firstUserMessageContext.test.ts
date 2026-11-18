import { describe, expect, test } from 'bun:test'
import { formatUserContext } from '../api.js'
import { getClaudeMds, getClaudeMdsForSubagent, type MemoryFileInfo } from '../claudemd.js'

const projectFile = { path: '/repo/CLAUDE.md', type: 'Project', content: 'Commit messages in English.' } as MemoryFileInfo
const memoryIndex = { path: '/mem/MEMORY.md', type: 'AutoMem', content: '- [Uses npm](npm.md)' } as MemoryFileInfo

describe('context attached to the first user message', () => {
  test('is presented as automatic context, not as possibly irrelevant', () => {
    const text = formatUserContext({ claudeMd: getClaudeMds([projectFile]), currentDate: "Today's date is 2026-11-18." })

    expect(text).not.toContain('may or may not be relevant')
    expect(text).not.toContain('should not respond to this context')
    expect(text).toContain('attached automatically')
    expect(text).toContain("It is not part of the user's message")
    expect(text).toStartWith('<system-reminder>\n')
    expect(text).toEndWith('\n</system-reminder>\n')
    expect(text).not.toMatch(/\n {2,}\S/)
  })

  test("instruction files yield to the user's own messages", () => {
    const text = getClaudeMds([projectFile])

    expect(text).toContain("the user's messages take precedence")
    expect(text).not.toContain('follow them exactly as written')
  })

  test('the memory index is not placed under the instruction preface', () => {
    const text = getClaudeMds([projectFile, memoryIndex])
    const memoryAt = text.indexOf('/mem/MEMORY.md')
    const indexPrefaceAt = text.indexOf('The memory index below is not an instruction file')

    expect(indexPrefaceAt).toBeGreaterThan(text.indexOf('Commit messages in English.'))
    expect(indexPrefaceAt).toBeLessThan(memoryAt)
  })

  test('with only a memory index there is no instruction preface', () => {
    const text = getClaudeMds([memoryIndex])

    expect(text).not.toContain('Codebase and user instructions')
    expect(text).toContain('/mem/MEMORY.md')
  })

  test('subagents get the instruction files without the memory index', () => {
    const text = getClaudeMdsForSubagent([projectFile, memoryIndex])

    expect(text).toContain('Commit messages in English.')
    expect(text).not.toContain('MEMORY.md')
  })
})
