import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import type { CanUseToolFn } from '../../hooks/useCanUseTool.js'
import { runToolUse } from '../../services/tools/toolExecution.js'
import type { ToolUseContext } from '../../Tool.js'
import { normalizeToolInput } from '../../utils/api.js'
import { createAssistantMessage } from '../../utils/messages.js'
import { FileReadTool } from '../FileReadTool/FileReadTool.js'
import { FileWriteTool } from '../FileWriteTool/FileWriteTool.js'
import { agentContext, allow, turn } from '../testing/agentContext.js'
import { NO_READ_BACK_NOTE } from './constants.js'
import { FileEditTool } from './FileEditTool.js'
import type { FileEditOutput } from './types.js'

let dir: string
let context: ToolUseContext

beforeEach(async () => {
  dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'edit-matching-')))
  context = agentContext()
})

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

async function readFile(name: string, content: string): Promise<string> {
  const filePath = path.join(dir, name)
  await fs.writeFile(filePath, content)
  await FileReadTool.call({ file_path: filePath }, context)
  return filePath
}

async function edit(filePath: string, oldString: string, newString: string, replaceAll = false) {
  const input = { file_path: filePath, old_string: oldString, new_string: newString, replace_all: replaceAll }
  const validation = await FileEditTool.validateInput(input, context)
  if (!validation.result) return validation
  const { data } = await FileEditTool.call(input, context, allow, turn)
  return { result: true as const, text: String(FileEditTool.mapToolResultToToolResultBlockParam(data, 'tool-1').content) }
}

describe('Edit with an old_string that differs from the file in form', () => {
  it('fixes indentation in a CRLF file and keeps its line endings', async () => {
    const filePath = await readFile('main.go', 'func f() {\r\n\tif x {\r\n\t\treturn 1\r\n\t}\r\n}\r\n')
    const outcome = await edit(filePath, '    if x {\n        return 1\n    }', '    if y {\n        return 2\n    }')
    expect(outcome.result).toBe(true)
    expect(await fs.readFile(filePath, 'utf8')).toBe('func f() {\r\n\tif y {\r\n\t\treturn 2\r\n\t}\r\n}\r\n')
  })

  it('accepts line number prefixes copied from a read', async () => {
    const filePath = await readFile('a.py', 'def f():\n    return 1\n')
    const outcome = await edit(filePath, '1\tdef f():\n2\t    return 1', '1\tdef f():\n2\t    return 2')
    expect(outcome.result).toBe(true)
    expect(await fs.readFile(filePath, 'utf8')).toBe('def f():\n    return 2\n')
  })

  it('accepts whitespace missing from the end of lines', async () => {
    const filePath = await readFile('notes.txt', 'alpha  \nbeta\n')
    const outcome = await edit(filePath, 'alpha\nbeta', 'alpha\ngamma')
    expect(outcome.result).toBe(true)
    expect(await fs.readFile(filePath, 'utf8')).toBe('alpha\ngamma\n')
  })

  it('accepts escapes written out', async () => {
    const filePath = await readFile('a.js', 'log("a")\nlog("b")\n')
    const outcome = await edit(filePath, 'log(\\"a\\")\\nlog(\\"b\\")', 'log(\\"c\\")')
    expect(outcome.result).toBe(true)
    expect(await fs.readFile(filePath, 'utf8')).toBe('log("c")\n')
  })

  it('replaces every occurrence when line number prefixes come with replace_all', async () => {
    const filePath = await readFile('a.txt', 'x = 1\ny = 2\nx = 1\n')
    const outcome = await edit(filePath, '1\tx = 1', '1\tx = 0', true)
    expect(outcome.result).toBe(true)
    expect(await fs.readFile(filePath, 'utf8')).toBe('x = 0\ny = 2\nx = 0\n')
  })

  it('reports several candidates with the existing message and leaves the file alone', async () => {
    const content = '    a()\n    b()\n        a()\n        b()\n'
    const filePath = await readFile('a.txt', content)
    const outcome = await edit(filePath, '  a()\n  b()', 'c()')
    expect(outcome).toMatchObject({
      result: false,
      errorCode: 9,
      message:
        'Found 2 matches of the string to replace, but replace_all is false. To replace all occurrences, set replace_all to true. To replace only one occurrence, please provide more context to uniquely identify the instance.\nString:   a()\n  b()',
    })
    expect(await fs.readFile(filePath, 'utf8')).toBe(content)
  })

  it('refuses to edit when the matched lines also occur as text earlier in the file', async () => {
    const content = 'xa\nbz\na\nb\n'
    const filePath = await readFile('a.txt', content)
    const outcome = await edit(filePath, 'a \nb', 'c')
    expect(outcome).toMatchObject({ result: false, errorCode: 9 })
    expect(await fs.readFile(filePath, 'utf8')).toBe(content)
  })

  it('reports indentation without one mapping as not found with the existing message', async () => {
    const content = 'if a:\n    if b:\n        return 1\n'
    const filePath = await readFile('a.py', content)
    const outcome = await edit(filePath, '  if b:\n    return 1', '  if b:\n    return 2')
    expect(outcome).toMatchObject({ result: false, errorCode: 8, message: 'String to replace not found in file.\nString:   if b:\n    return 1' })
    expect(await fs.readFile(filePath, 'utf8')).toBe(content)
  })
})

describe('the Edit input the user approves', () => {
  const approved = (input: Record<string, unknown>) => {
    const observed = { ...input }
    FileEditTool.backfillObservableInput!(observed)
    FileEditTool.resolveApprovalInput!(observed)
    return observed
  }

  it('is not matched against the file while the reply streams in', async () => {
    const filePath = await readFile('a.py', 'def f():\n    return 1\n')
    const input = { file_path: filePath, old_string: '\treturn 1', new_string: '\treturn 2', replace_all: false }
    const streamed = { ...input }
    FileEditTool.backfillObservableInput!(streamed)
    expect(streamed).toEqual(input)
  })

  it('shows the text that will be written', async () => {
    const filePath = await readFile('main.go', 'func f() {\n\tif x {\n\t\treturn 1\n\t}\n}\n')
    const input = { file_path: filePath, old_string: '    if x {\n        return 1\n    }', new_string: '    if y {\n        return 2\n    }', replace_all: false }
    expect(approved(input)).toEqual({ file_path: filePath, old_string: '\tif x {\n\t\treturn 1\n\t}', new_string: '\tif y {\n\t\treturn 2\n\t}', replace_all: false })
  })

  it('shows written-out escapes as the characters that will be written', async () => {
    const filePath = await readFile('build.sh', 'echo "done"\n')
    const input = { file_path: filePath, old_string: 'echo \\"done\\"', new_string: '# echo \\"done\\"\\nrm -rf build', replace_all: false }
    expect(approved(input)).toMatchObject({ old_string: 'echo "done"', new_string: '# echo "done"\nrm -rf build' })
  })

  it('shows every occurrence rewritten with replace_all', async () => {
    const filePath = await readFile('a.txt', 'x = 1\ny = 2\nx = 1\n')
    const input = { file_path: filePath, old_string: '1\tx = 1', new_string: '1\tx = 0', replace_all: true }
    expect(approved(input)).toMatchObject({ old_string: 'x = 1', new_string: 'x = 0' })
  })

  it('leaves it alone when it matches several places', async () => {
    const filePath = await readFile('a.txt', '    a()\n    b()\n        a()\n        b()\n')
    const input = { file_path: filePath, old_string: '  a()\n  b()', new_string: 'c()', replace_all: false }
    expect(approved(input)).toEqual(input)
  })

  it('matches each edit against the file as the earlier edits of the same reply left it', async () => {
    const filePath = await readFile('a.ts', 'class Old {\n    total(xs) {\n        return sum(xs)\n    }\n}\nclass Box {\n}\n')
    const copy = { file_path: filePath, old_string: 'class Box {\n}', new_string: 'class Box {\n  total(xs) {\n      return sum(xs)\n  }\n}', replace_all: false }
    const change = { file_path: filePath, old_string: '  total(xs) {\n      return sum(xs)\n  }', new_string: '  total(xs) {\n      return sum(xs) * 2\n  }', replace_all: false }
    const received = [copy, change].map(input => normalizeToolInput(FileEditTool, input))
    for (const input of received) {
      expect(await edit(input.file_path, input.old_string, input.new_string)).toMatchObject({ result: true })
    }
    expect(await fs.readFile(filePath, 'utf8')).toBe('class Old {\n    total(xs) {\n        return sum(xs)\n    }\n}\nclass Box {\n  total(xs) {\n      return sum(xs) * 2\n  }\n}\n')
  })
})

describe('an Edit carried out by the tool runner', () => {
  type Decide = (observed: Record<string, unknown>) => Record<string, unknown> | undefined

  async function runEdit(input: Record<string, unknown>, decide: Decide, userModified = false) {
    const toolUse = { type: 'tool_use', id: 'toolu_1', name: FileEditTool.name, input }
    const assistant = createAssistantMessage({ content: [toolUse as never] }) as Parameters<typeof runToolUse>[1]
    const approvals: Record<string, unknown>[] = []
    const canUseTool = (async (_tool: unknown, observed: Record<string, unknown>) => {
      approvals.push({ ...observed })
      return { behavior: 'allow', updatedInput: decide(observed), userModified }
    }) as unknown as CanUseToolFn
    const runContext = { ...context, options: { ...context.options, tools: [FileEditTool, FileReadTool] } } as ToolUseContext
    const texts: string[] = []
    for await (const update of runToolUse(toolUse as never, assistant, canUseTool, runContext)) {
      const content = (update.message as { message?: { content?: unknown } } | undefined)?.message?.content
      if (Array.isArray(content)) {
        for (const block of content as Array<{ type: string; content?: unknown }>) {
          if (block.type === 'tool_result') texts.push(String(block.content))
        }
      }
    }
    return { approvals, text: texts.join('\n') }
  }

  it.each<[string, Decide]>([
    ['as shown', () => undefined],
    ['through a fresh copy of what was shown', observed => ({ ...observed })],
  ])('writes the shown text and leaves the note out when it differs from new_string, approved %s', async (_how, decide) => {
    const filePath = await readFile('a.py', 'def f():\n    return 1\n')
    const outcome = await runEdit({ file_path: filePath, old_string: '\treturn 1', new_string: '\treturn 2', replace_all: false }, decide)
    expect(outcome.approvals).toEqual([expect.objectContaining({ old_string: '    return 1', new_string: '    return 2' })])
    expect(await fs.readFile(filePath, 'utf8')).toBe('def f():\n    return 2\n')
    expect(outcome.text).toBe(`The file ${filePath} has been updated successfully.`)
  })

  it.each<[string, Decide, string]>([
    ['new_string', observed => ({ ...observed, new_string: '    return 3' }), 'def f():\n    return 3\n'],
    ['old_string', observed => ({ ...observed, old_string: 'return 1' }), 'def f():\n        return 2\n'],
  ])('writes the edit as the user approved it after changing its %s', async (_field, decide, written) => {
    const filePath = await readFile('a.py', 'def f():\n    return 1\n')
    const outcome = await runEdit({ file_path: filePath, old_string: '        return 1', new_string: '        return 2', replace_all: false }, decide, true)
    expect(outcome.approvals).toEqual([expect.objectContaining({ old_string: '    return 1', new_string: '    return 2' })])
    expect(await fs.readFile(filePath, 'utf8')).toBe(written)
    expect(outcome.text).not.toContain(NO_READ_BACK_NOTE)
  })
})

describe('what Edit and Write say after they succeed', () => {
  const edited: FileEditOutput = { filePath: '/repo/a.ts', oldString: 'a', newString: 'b', originalFile: 'a', structuredPatch: [], userModified: false, replaceAll: false }
  const editText = (data: FileEditOutput) => String(FileEditTool.mapToolResultToToolResultBlockParam(data, 'tool-1').content)

  it('tells the model not to read the file back after an edit', async () => {
    const filePath = await readFile('a.txt', 'one\ntwo\n')
    expect(await edit(filePath, 'one', 'uno')).toEqual({ result: true, text: `The file ${filePath} has been updated successfully. ${NO_READ_BACK_NOTE}` })
    expect(editText({ ...edited, replaceAll: true })).toBe(`The file /repo/a.ts has been updated. All occurrences were successfully replaced. ${NO_READ_BACK_NOTE}`)
  })

  it('leaves the note out when the written text differs from new_string', async () => {
    const filePath = await readFile('a.py', 'def f():\n    return 1\n')
    const outcome = await edit(filePath, 'def f():\n\treturn 1', 'def f():\n\treturn 2')
    expect(await fs.readFile(filePath, 'utf8')).toBe('def f():\n    return 2\n')
    expect(outcome).toEqual({ result: true, text: `The file ${filePath} has been updated successfully.` })
  })

  it('leaves the note out when the user changed the edit before accepting it', () => {
    expect(editText({ ...edited, userModified: true })).not.toContain(NO_READ_BACK_NOTE)
  })

  it('tells the model not to read the file back after a write', async () => {
    const filePath = path.join(dir, 'new.txt')
    const writeText = async (content: string) => {
      const { data } = await FileWriteTool.call({ file_path: filePath, content }, context, allow, turn)
      return String(FileWriteTool.mapToolResultToToolResultBlockParam(data, 'tool-1').content)
    }
    expect(await writeText('first\n')).toBe(`File created successfully at: ${filePath}. ${NO_READ_BACK_NOTE}`)
    expect(await writeText('second\n')).toBe(`The file ${filePath} has been updated successfully. ${NO_READ_BACK_NOTE}`)
  })
})
