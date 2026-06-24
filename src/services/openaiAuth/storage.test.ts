import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import * as fs from 'fs'
import * as fsp from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import {
  clearOpenAIOAuthTokenCache,
  deleteOpenAIOAuthTokens,
  getOpenAIOAuthTokens,
  getOpenAIOAuthTokensAsync,
  saveOpenAIOAuthTokens,
} from './storage.js'
import { plainTextStorage } from '../../utils/secureStorage/plainTextStorage.js'
import type { OpenAIOAuthTokens } from './types.js'

describe('OpenAI OAuth desktop token file storage', () => {
  let tmpDir: string
  let tokenPath: string
  let originalTokenFile: string | undefined
  let originalConfigDir: string | undefined
  let originalHome: string | undefined
  let originalUserProfile: string | undefined
  let originalCwd: string

  beforeEach(async () => {
    tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'openai-oauth-storage-'))
    tokenPath = path.join(tmpDir, 'openai-oauth.json')
    originalTokenFile = process.env.OPENAI_CODEX_OAUTH_FILE
    originalConfigDir = process.env.CLAUDE_CONFIG_DIR
    originalHome = process.env.HOME
    originalUserProfile = process.env.USERPROFILE
    originalCwd = process.cwd()
    process.env.CLAUDE_CONFIG_DIR = tmpDir
    process.env.HOME = tmpDir
    process.env.USERPROFILE = tmpDir
    process.env.OPENAI_CODEX_OAUTH_FILE = tokenPath
    clearOpenAIOAuthTokenCache()
  })

  afterEach(async () => {
    plainTextStorage.delete()
    if (originalTokenFile === undefined) {
      delete process.env.OPENAI_CODEX_OAUTH_FILE
    } else {
      process.env.OPENAI_CODEX_OAUTH_FILE = originalTokenFile
    }
    if (originalConfigDir === undefined) {
      delete process.env.CLAUDE_CONFIG_DIR
    } else {
      process.env.CLAUDE_CONFIG_DIR = originalConfigDir
    }
    if (originalHome === undefined) {
      delete process.env.HOME
    } else {
      process.env.HOME = originalHome
    }
    if (originalUserProfile === undefined) {
      delete process.env.USERPROFILE
    } else {
      process.env.USERPROFILE = originalUserProfile
    }
    process.chdir(originalCwd)
    clearOpenAIOAuthTokenCache()
    await fsp.rm(tmpDir, { recursive: true, force: true })
  })

  function seedSecureStorage(tokens: OpenAIOAuthTokens): void {
    delete process.env.OPENAI_CODEX_OAUTH_FILE
    clearOpenAIOAuthTokenCache()
    expect(
      plainTextStorage.update({ openaiCodexOauth: tokens }).success,
    ).toBe(true)
    process.env.OPENAI_CODEX_OAUTH_FILE = tokenPath
    clearOpenAIOAuthTokenCache()
  }

  function unsetTokenFileOverride(): void {
    delete process.env.OPENAI_CODEX_OAUTH_FILE
    clearOpenAIOAuthTokenCache()
  }

  test('reads desktop token file synchronously', async () => {
    await fsp.writeFile(
      tokenPath,
      JSON.stringify({
        accessToken: 'desktop-access',
        refreshToken: 'desktop-refresh',
        expiresAt: 4_100_000_000_000,
        idToken: 'desktop-id-token',
        email: 'user@example.com',
        accountId: 'acct_desktop',
      }),
      'utf-8',
    )

    const tokens = getOpenAIOAuthTokens()

    expect(tokens).toMatchObject({
      accessToken: 'desktop-access',
      refreshToken: 'desktop-refresh',
      expiresAt: 4_100_000_000_000,
      idToken: 'desktop-id-token',
      email: 'user@example.com',
      accountId: 'acct_desktop',
    })
  })

  test('reads desktop token file asynchronously', async () => {
    await fsp.writeFile(
      tokenPath,
      JSON.stringify({
        accessToken: 'async-access',
        refreshToken: 'async-refresh',
        expiresAt: 4_100_000_000_000,
        email: null,
        accountId: null,
      }),
      'utf-8',
    )

    const tokens = await getOpenAIOAuthTokensAsync()

    expect(tokens?.accessToken).toBe('async-access')
    expect(tokens?.refreshToken).toBe('async-refresh')
  })

  test('writes refreshed tokens back to the desktop token file', async () => {
    const result = saveOpenAIOAuthTokens({
      accessToken: 'fresh-access',
      refreshToken: 'fresh-refresh',
      expiresAt: 4_100_000_000_000,
      idToken: 'fresh-id-token',
      email: 'fresh@example.com',
      accountId: 'acct_fresh',
    })

    expect(result).toEqual({ success: true })
    const raw = JSON.parse(
      fs.readFileSync(tokenPath, 'utf-8'),
    ) as Record<string, unknown>
    expect(raw).toMatchObject({
      accessToken: 'fresh-access',
      refreshToken: 'fresh-refresh',
      idToken: 'fresh-id-token',
      email: 'fresh@example.com',
      accountId: 'acct_fresh',
    })
    if (process.platform !== 'win32') {
      expect(fs.statSync(tokenPath).mode & 0o777).toBe(0o600)
    }
  })

  test('file-backed save clears legacy secure storage tokens', async () => {
    seedSecureStorage({
      accessToken: 'secure-access',
      refreshToken: 'secure-refresh',
      expiresAt: 4_100_000_000_000,
    })

    const result = saveOpenAIOAuthTokens({
      accessToken: 'file-access',
      refreshToken: 'file-refresh',
      expiresAt: 4_100_000_000_123,
    })

    expect(result).toEqual({ success: true })
    expect(getOpenAIOAuthTokens()?.accessToken).toBe('file-access')

    unsetTokenFileOverride()
    expect(getOpenAIOAuthTokens()).toBeNull()
    await expect(getOpenAIOAuthTokensAsync()).resolves.toBeNull()
  })

  test('deletes the desktop token file when the env override is set', async () => {
    await fsp.writeFile(
      tokenPath,
      JSON.stringify({
        accessToken: 'desktop-access',
        refreshToken: 'desktop-refresh',
        expiresAt: 4_100_000_000_000,
      }),
      'utf-8',
    )

    expect(deleteOpenAIOAuthTokens()).toBe(true)
    expect(fs.existsSync(tokenPath)).toBe(false)
  })

  test('returns null from both getters when env override is set but file is missing', async () => {
    seedSecureStorage({
      accessToken: 'secure-access',
      refreshToken: 'secure-refresh',
      expiresAt: 4_100_000_000_000,
    })

    expect(getOpenAIOAuthTokens()).toBeNull()
    await expect(getOpenAIOAuthTokensAsync()).resolves.toBeNull()
  })

  test('returns null from both getters when env override file contains corrupt json', async () => {
    seedSecureStorage({
      accessToken: 'secure-access',
      refreshToken: 'secure-refresh',
      expiresAt: 4_100_000_000_000,
    })
    await fsp.writeFile(tokenPath, '{ definitely-not-json', 'utf-8')

    expect(getOpenAIOAuthTokens()).toBeNull()
    await expect(getOpenAIOAuthTokensAsync()).resolves.toBeNull()
  })

  test('does not fall back to secure storage after deleting env override file', async () => {
    seedSecureStorage({
      accessToken: 'secure-access',
      refreshToken: 'secure-refresh',
      expiresAt: 4_100_000_000_000,
    })
    await fsp.writeFile(
      tokenPath,
      JSON.stringify({
        accessToken: 'desktop-access',
        refreshToken: 'desktop-refresh',
        expiresAt: 4_100_000_000_000,
      }),
      'utf-8',
    )

    expect(deleteOpenAIOAuthTokens()).toBe(true)
    expect(getOpenAIOAuthTokens()).toBeNull()
    await expect(getOpenAIOAuthTokensAsync()).resolves.toBeNull()

    unsetTokenFileOverride()
    expect(getOpenAIOAuthTokens()).toBeNull()
    await expect(getOpenAIOAuthTokensAsync()).resolves.toBeNull()
  })

  test('reloads sync tokens when OPENAI_CODEX_OAUTH_FILE changes without clearing cache', async () => {
    const tokenPathA = path.join(tmpDir, 'openai-oauth-a.json')
    const tokenPathB = path.join(tmpDir, 'openai-oauth-b.json')
    await fsp.writeFile(
      tokenPathA,
      JSON.stringify({
        accessToken: 'access-a',
        refreshToken: 'refresh-a',
        expiresAt: 4_100_000_000_001,
      }),
      'utf-8',
    )
    await fsp.writeFile(
      tokenPathB,
      JSON.stringify({
        accessToken: 'access-b',
        refreshToken: 'refresh-b',
        expiresAt: 4_100_000_000_002,
      }),
      'utf-8',
    )

    process.env.OPENAI_CODEX_OAUTH_FILE = tokenPathA
    expect(getOpenAIOAuthTokens()?.accessToken).toBe('access-a')

    process.env.OPENAI_CODEX_OAUTH_FILE = tokenPathB
    expect(getOpenAIOAuthTokens()?.accessToken).toBe('access-b')
  })

  test('prefers env-pinned file authority when OPENAI_CODEX_OAUTH_FILE matches the secure-storage sentinel', async () => {
    const sentinelPath = '__secure-storage__'
    seedSecureStorage({
      accessToken: 'secure-access',
      refreshToken: 'secure-refresh',
      expiresAt: 4_100_000_000_000,
    })

    process.chdir(tmpDir)
    process.env.OPENAI_CODEX_OAUTH_FILE = sentinelPath
    await fsp.writeFile(
      path.join(tmpDir, sentinelPath),
      JSON.stringify({
        accessToken: 'file-access',
        refreshToken: 'file-refresh',
        expiresAt: 4_100_000_000_123,
      }),
      'utf-8',
    )
    clearOpenAIOAuthTokenCache()

    expect(getOpenAIOAuthTokens()).toMatchObject({
      accessToken: 'file-access',
      refreshToken: 'file-refresh',
      expiresAt: 4_100_000_000_123,
    })
    await expect(getOpenAIOAuthTokensAsync()).resolves.toMatchObject({
      accessToken: 'file-access',
      refreshToken: 'file-refresh',
      expiresAt: 4_100_000_000_123,
    })
  })

  test('cleans up tmp file if desktop token rename fails', async () => {
    const renameSyncSpy = spyOn(fs, 'renameSync').mockImplementation(() => {
      const error = new Error('rename failed') as NodeJS.ErrnoException
      error.code = 'EXDEV'
      throw error
    })

    const result = saveOpenAIOAuthTokens({
      accessToken: 'fresh-access',
      refreshToken: 'fresh-refresh',
      expiresAt: 4_100_000_000_000,
    })

    renameSyncSpy.mockRestore()

    expect(result.success).toBe(false)
    const tmpFiles = (await fsp.readdir(tmpDir)).filter((name) =>
      name.startsWith('openai-oauth.json.tmp.'),
    )
    expect(tmpFiles).toEqual([])
  })
})
