import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SettingsService } from '../services/settingsService.js'
import { handleSettingsApi } from '../api/settings.js'
import { resetSettingsCache } from '../../utils/settings/settingsCache.js'

let directory: string
let originalConfig: string | undefined
let originalLegacy: string | undefined

beforeEach(async () => {
  originalConfig = process.env.DREAMCODER_CONFIG_DIR
  originalLegacy = process.env.DREAMCODER_LEGACY_TERMINAL_CONFIG_PATH
  directory = await mkdtemp(join(tmpdir(), 'dreamcoder-terminal-migration-'))
  process.env.DREAMCODER_CONFIG_DIR = directory
  process.env.DREAMCODER_LEGACY_TERMINAL_CONFIG_PATH = join(directory, 'terminal-config.json')
})

afterEach(async () => {
  mock.restore()
  if (originalConfig === undefined) delete process.env.DREAMCODER_CONFIG_DIR
  else process.env.DREAMCODER_CONFIG_DIR = originalConfig
  if (originalLegacy === undefined) delete process.env.DREAMCODER_LEGACY_TERMINAL_CONFIG_PATH
  else process.env.DREAMCODER_LEGACY_TERMINAL_CONFIG_PATH = originalLegacy
  resetSettingsCache()
  await rm(directory, { recursive: true, force: true })
})

async function saveLegacy(value: unknown) {
  await writeFile(process.env.DREAMCODER_LEGACY_TERMINAL_CONFIG_PATH!, JSON.stringify(value))
}

async function savedSettings() {
  return JSON.parse(await readFile(join(directory, 'settings.json'), 'utf8'))
}

async function requestSettings(method: string, pathname: string, body?: Record<string, unknown>) {
  const url = new URL(pathname, 'http://localhost')
  const request = new Request(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  return handleSettingsApi(request, url, url.pathname.split('/').filter(Boolean))
}

describe('terminal settings migration', () => {
  it('imports an existing bash path once and preserves the other settings', async () => {
    const service = new SettingsService()
    await service.updateUserSettings({ theme: 'dark', desktopTerminal: { startupShell: 'pwsh', customShellPath: '/shell' } })
    await saveLegacy({ bash_path: ' C:\\Git\\bash.exe ' })
    const result = await service.getUserSettings()
    expect(result).toEqual({ theme: 'dark', desktopTerminal: { startupShell: 'pwsh', customShellPath: '/shell', bashPath: 'C:\\Git\\bash.exe' } })
    expect(await savedSettings()).toEqual(result)
    await writeFile(process.env.DREAMCODER_LEGACY_TERMINAL_CONFIG_PATH!, 'invalid json')
    expect(await new SettingsService().getUserSettings()).toEqual(result)
  })

  it.each([null, '/new/bash'])('keeps an explicitly saved bashPath of %s', async (bashPath) => {
    await writeFile(join(directory, 'settings.json'), JSON.stringify({ desktopTerminal: { bashPath } }))
    await saveLegacy({ bash_path: '/old/bash' })
    expect(await new SettingsService().getUserSettings()).toEqual({ desktopTerminal: { bashPath } })
  })

  it('does not create settings when the old file is absent', async () => {
    expect(await new SettingsService().getUserSettings()).toEqual({})
    await expect(readFile(join(directory, 'settings.json'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('imports a cleared legacy path as null', async () => {
    await saveLegacy({ bash_path: '  ' })
    expect(await new SettingsService().getUserSettings()).toEqual({ desktopTerminal: { bashPath: null } })
  })

  it('reads the shell-supplied legacy location independently of the active config directory', async () => {
    process.env.DREAMCODER_LEGACY_TERMINAL_CONFIG_PATH = join(directory, 'tauri-terminal-config.json')
    await saveLegacy({ bash_path: '/legacy/bash' })
    expect(await new SettingsService().getUserSettings()).toEqual({ desktopTerminal: { bashPath: '/legacy/bash' } })
  })

  it('serializes migration with concurrent settings updates', async () => {
    await saveLegacy({ bash_path: '/legacy/bash' })
    await Promise.all([
      new SettingsService().getUserSettings(),
      new SettingsService().updateUserSettings({ theme: 'dark' }),
    ])
    expect(await savedSettings()).toEqual({ theme: 'dark', desktopTerminal: { bashPath: '/legacy/bash' } })
  })

  it.each(['', '{', 'null', '[]', '{"bash_path":42}'])('skips invalid legacy content %j without blocking settings or marking migration complete', async (contents) => {
    const warn = spyOn(console, 'warn').mockImplementation(() => {})
    const settings = { theme: 'dark', desktopTerminal: { startupShell: 'fish', customShellPath: '' } }
    await writeFile(join(directory, 'settings.json'), JSON.stringify(settings))
    await writeFile(process.env.DREAMCODER_LEGACY_TERMINAL_CONFIG_PATH!, contents)

    expect(await new SettingsService().getUserSettings()).toEqual(settings)
    expect(await savedSettings()).toEqual(settings)
    expect(await readFile(process.env.DREAMCODER_LEGACY_TERMINAL_CONFIG_PATH!, 'utf8')).toBe(contents)
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining(process.env.DREAMCODER_LEGACY_TERMINAL_CONFIG_PATH!),
      expect.any(Error),
    )

    await saveLegacy({ bash_path: '/fixed/bash' })
    expect(await new SettingsService().getUserSettings()).toEqual({
      ...settings,
      desktopTerminal: { ...settings.desktopTerminal, bashPath: '/fixed/bash' },
    })
  })

  it('keeps settings and permissions APIs usable with a malformed legacy file', async () => {
    spyOn(console, 'warn').mockImplementation(() => {})
    await writeFile(join(directory, 'settings.json'), JSON.stringify({ theme: 'dark' }))
    await saveLegacy({ bash_path: 42 })

    const settings = await requestSettings('GET', '/api/settings/user')
    expect(settings.status).toBe(200)
    expect(await settings.json()).toEqual({ theme: 'dark' })
    const permissions = await requestSettings('GET', '/api/permissions/mode')
    expect(permissions.status).toBe(200)
    expect(await permissions.json()).toEqual({ mode: 'default' })

    const update = await requestSettings('PUT', '/api/settings/user', { theme: 'light' })
    expect(update.status).toBe(200)
    expect(await savedSettings()).toEqual({ theme: 'light' })
    const reset = await requestSettings('PUT', '/api/settings/user', { desktopTerminal: { bashPath: null } })
    expect(reset.status).toBe(200)
    expect(await savedSettings()).toEqual({ theme: 'light', desktopTerminal: { bashPath: null } })
    expect(JSON.parse(await readFile(process.env.DREAMCODER_LEGACY_TERMINAL_CONFIG_PATH!, 'utf8'))).toEqual({ bash_path: 42 })
  })
})
