import { afterEach, beforeEach, expect, it, spyOn } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { agentContext } from '../../tools/testing/agentContext.js'
import * as tokenEstimation from '../tokenEstimation.js'
import { createPostCompactFileAttachments } from './compact.js'

let dir: string
let countTokens: ReturnType<typeof spyOn<typeof tokenEstimation, 'countTokensWithAPI'>>

beforeEach(async () => {
  dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'post-compact-restore-')))
  countTokens = spyOn(tokenEstimation, 'countTokensWithAPI').mockResolvedValue(null)
})

afterEach(async () => {
  countTokens.mockRestore()
  await fs.rm(dir, { recursive: true, force: true })
})

it('refers to a file over the per-file limit instead of restoring part of it', async () => {
  const filePath = path.join(dir, 'big.ts')
  await fs.writeFile(filePath, Array.from({ length: 1000 }, (_, i) => `export const value${i} = ${i}`).join('\n'))
  const [restored] = await createPostCompactFileAttachments({ [filePath]: { content: '', timestamp: 1 } }, agentContext(), 1)
  expect(restored?.attachment).toMatchObject({ type: 'compact_file_reference', filename: filePath })
})
