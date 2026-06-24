import { describe, expect, it } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  isSameOrInsidePathForPlatform,
  normalizeDriveRootPathForPlatform,
} from '../services/windowsDrivePath.js'
import { getRepositoryContext } from '../services/repositoryLaunchService.js'
import { SessionService } from '../services/sessionService.js'
import { sanitizePath } from '../../utils/sessionStoragePortable.js'

describe('Windows drive root path handling', () => {
  it('normalizes drive-relative root inputs to absolute drive roots on Windows', () => {
    expect(normalizeDriveRootPathForPlatform('D:', 'win32')).toBe('D:\\')
    expect(normalizeDriveRootPathForPlatform('d:', 'win32')).toBe('d:\\')
    expect(normalizeDriveRootPathForPlatform('D:\\', 'win32')).toBe('D:\\')
    expect(normalizeDriveRootPathForPlatform('D:\\project', 'win32')).toBe('D:\\project')
    expect(normalizeDriveRootPathForPlatform('D:', 'darwin')).toBe('D:')
  })

  it('recovers sanitized Windows drive-root transcript directories', () => {
    const service = new SessionService()
    expect(service.desanitizePath('D--')).toBe('D:\\')
    expect(service.desanitizePath('D--project')).toBe('D:\\project')
  })

  it('treats absolute Windows drive-root children as inside the selected root', () => {
    expect(isSameOrInsidePathForPlatform('D:\\', 'D:', 'win32')).toBe(true)
    expect(isSameOrInsidePathForPlatform('D:\\child', 'D:', 'win32')).toBe(true)
    expect(isSameOrInsidePathForPlatform('D:\\child', 'D:\\', 'win32')).toBe(true)
    expect(isSameOrInsidePathForPlatform('D:\\project-extra', 'D:\\project', 'win32')).toBe(false)
    expect(isSameOrInsidePathForPlatform('E:\\child', 'D:\\', 'win32')).toBe(false)
  })

  it('keeps realpathed drive roots from resolving to the current drive directory', async () => {
    if (process.platform !== 'win32') return

    const originalConfigDir = process.env.CLAUDE_CONFIG_DIR
    const configDir = await fs.mkdtemp(path.join(os.tmpdir(), 'drive-root-session-'))
    const driveRoot = path.parse(process.cwd()).root
    const sessionId = crypto.randomUUID()

    try {
      process.env.CLAUDE_CONFIG_DIR = configDir
      const projectDir = path.join(configDir, 'projects', sanitizePath(driveRoot))
      await fs.mkdir(projectDir, { recursive: true })
      await fs.writeFile(
        path.join(projectDir, `${sessionId}.jsonl`),
        JSON.stringify({
          type: 'session-meta',
          isMeta: true,
          workDir: driveRoot,
          timestamp: new Date().toISOString(),
        }) + '\n',
        'utf-8',
      )

      const service = new SessionService()
      const { sessions } = await service.listSessions({ limit: 5 })
      const session = sessions.find((item) => item.id === sessionId)
      expect(session?.workDir).toBe(driveRoot)
      expect(session?.projectRoot).toBe(driveRoot)

      const context = await getRepositoryContext(driveRoot)
      expect(context.workDir).toBe(driveRoot)
      expect(context.repoRoot).not.toBe(process.cwd())
    } finally {
      if (originalConfigDir === undefined) {
        delete process.env.CLAUDE_CONFIG_DIR
      } else {
        process.env.CLAUDE_CONFIG_DIR = originalConfigDir
      }
      await fs.rm(configDir, { recursive: true, force: true })
    }
  })
})
