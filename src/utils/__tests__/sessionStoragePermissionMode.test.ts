import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'

import {
  reAppendSessionMetadata,
  resetProjectForTesting,
  savePermissionMode,
  setSessionFileForTesting,
} from '../sessionStorage.js'

async function permissionModeEntries(filePath: string): Promise<string[]> {
  const content = await fs.readFile(filePath, 'utf-8').catch(() => '')
  return content
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { type: string; permissionMode?: string })
    .filter((entry) => entry.type === 'permission-mode')
    .map((entry) => entry.permissionMode!)
}

describe('savePermissionMode', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'session-permission-mode-'))
    resetProjectForTesting()
  })

  afterEach(async () => {
    resetProjectForTesting()
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it('writes a permission-mode entry in Claude Code\'s format when the session file exists', async () => {
    const filePath = path.join(tmpDir, 'session.jsonl')
    setSessionFileForTesting(filePath)

    savePermissionMode('plan')

    expect(await permissionModeEntries(filePath)).toEqual(['plan'])
  })

  it('writes a change made before the file exists once, and does not re-append it later', async () => {
    const filePath = path.join(tmpDir, 'session.jsonl')
    savePermissionMode('acceptEdits')

    setSessionFileForTesting(filePath)
    reAppendSessionMetadata()
    reAppendSessionMetadata()

    expect(await permissionModeEntries(filePath)).toEqual(['acceptEdits'])
  })
})
