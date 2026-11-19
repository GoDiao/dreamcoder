import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createFileStateCacheWithSizeLimit } from '../../utils/fileStateCache.js'
import { type CliModelRules, MODEL_RULES_ENV_KEY } from '../../utils/model/modelRules.js'
import * as pdf from '../../utils/pdf.js'
import { FileReadTool } from './FileReadTool.js'

const ENV_KEYS = [MODEL_RULES_ENV_KEY, 'CLAUDE_CODE_SIMPLE'] as const

const base: CliModelRules = {
  contextWindow: 131_072,
  thinkingWhenOn: 'omit',
  thinkingWhenOff: 'omit',
  effortLevels: [],
  pdf: false,
  image: true,
  nativeWebSearch: false,
  structuredOutput: false,
}

let saved: Record<string, string | undefined>
let dir: string
let pdfPath: string

async function read(model: string, pages?: string) {
  const context = {
    readFileState: createFileStateCacheWithSizeLimit(10),
    options: { mainLoopModel: model },
  }
  return FileReadTool.call({ file_path: pdfPath, ...(pages && { pages }) } as never, context as never)
}

beforeEach(async () => {
  saved = Object.fromEntries(ENV_KEYS.map(key => [key, process.env[key]]))
  process.env.CLAUDE_CODE_SIMPLE = '1'
  process.env[MODEL_RULES_ENV_KEY] = JSON.stringify({
    models: {
      'pdf-model': { ...base, pdf: true },
      'text-only': { ...base, image: false },
    },
    fallback: base,
    defaultEffort: 'medium',
  })
  dir = await mkdtemp(join(tmpdir(), 'read-pdf-rules-'))
  pdfPath = join(dir, 'doc.pdf')
  await writeFile(pdfPath, '%PDF-1.4\n%%EOF\n')
})

afterEach(async () => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key]
    else process.env[key] = saved[key]
  }
  await rm(dir, { recursive: true, force: true })
})

describe('reading a PDF under model rules', () => {
  test('a model with pdf support gets the whole document', async () => {
    const result = await read('pdf-model')
    expect(result.data.type).toBe('pdf')
  })

  test('a model without pdf support is told to use the pages parameter', async () => {
    await expect(read('other-model')).rejects.toThrow('Reading full PDFs is not supported with this model')
  })

  test('a model without pdf support is refused before any page is rendered', async () => {
    const extract = spyOn(pdf, 'extractPDFPages')
    try {
      await expect(read('other-model')).rejects.toThrow('Reading full PDFs is not supported with this model')
      expect(extract).not.toHaveBeenCalled()
    } finally {
      extract.mockRestore()
    }
  })

  test('a model without image support cannot read PDF pages', async () => {
    await expect(read('text-only', '1')).rejects.toThrow('This model cannot read PDF files.')
  })
})
