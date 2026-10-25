import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  appModeLocations,
  clearPortableEnvForRestart,
  currentAppMode,
  detectPortableDir,
  determineStartupPortableDir,
  dirHasPortableData,
  readAppModeConfig,
  setAppMode,
  type AppModeLocations,
} from './appMode'

let root = ''
let locations: AppModeLocations

function writeMode(dir: string, value: unknown) {
  mkdirSync(dir, { recursive: true })
  writeFileSync(path.join(dir, 'app-mode.json'), JSON.stringify(value))
}

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'electron-app-mode-'))
  locations = appModeLocations(path.join(root, 'app', 'DreamCoder.exe'), path.join(root, 'userdata'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('app mode locations', () => {
  it('uses the portable folder next to the executable and the app data dir', () => {
    expect(locations).toEqual({
      defaultPortableDir: path.join(root, 'app/CLAUDE_CONFIG_DIR'),
      systemConfigDir: path.join(root, 'userdata'),
    })
  })
})

describe('portable data detection', () => {
  it('needs a directory with known config files or folders', () => {
    expect(dirHasPortableData(locations.defaultPortableDir)).toBe(false)
    mkdirSync(path.join(locations.defaultPortableDir, 'skills'), { recursive: true })
    expect(dirHasPortableData(locations.defaultPortableDir)).toBe(true)
    expect(detectPortableDir(locations)).toEqual({ defaultPortableDir: locations.defaultPortableDir, hasData: true })
  })
})

describe('startup portable dir', () => {
  it('finds data in the portable folder next to the executable', () => {
    const portableDir = path.join(root, 'app/CLAUDE_CONFIG_DIR')
    mkdirSync(portableDir, { recursive: true })
    writeFileSync(path.join(portableDir, 'settings.json'), '{}')
    expect(determineStartupPortableDir({}, locations)).toBe(portableDir)
  })

  it('leaves an explicit config dir alone', () => {
    writeMode(locations.defaultPortableDir, { mode: 'portable' })
    expect(determineStartupPortableDir({ DREAMCODER_CONFIG_DIR: '/explicit' }, locations)).toBeNull()
  })

  it('follows app-mode.json next to the executable first', () => {
    writeMode(locations.defaultPortableDir, { mode: 'portable', portable_dir: '/elsewhere' })
    expect(determineStartupPortableDir({}, locations)).toBe('/elsewhere')
    writeFileSync(path.join(locations.defaultPortableDir, 'settings.json'), '{}')
    expect(determineStartupPortableDir({}, locations)).toBe(locations.defaultPortableDir)
    writeMode(locations.defaultPortableDir, { mode: 'default' })
    expect(determineStartupPortableDir({}, locations)).toBeNull()
  })

  it('falls back to the system app-mode.json, then to data next to the executable', () => {
    writeMode(locations.systemConfigDir, { mode: 'portable', portable_dir: '/chosen' })
    expect(determineStartupPortableDir({}, locations)).toBe('/chosen')
    writeMode(locations.systemConfigDir, { mode: 'default' })
    expect(determineStartupPortableDir({}, locations)).toBeNull()
    rmSync(locations.systemConfigDir, { recursive: true })
    mkdirSync(path.join(locations.defaultPortableDir, 'projects'), { recursive: true })
    expect(determineStartupPortableDir({}, locations)).toBe(locations.defaultPortableDir)
  })
})

describe('current app mode', () => {
  it('reports where the config dir came from', () => {
    expect(currentAppMode({}, locations)).toEqual({
      mode: 'default',
      portableDir: locations.defaultPortableDir,
      defaultPortableDir: locations.defaultPortableDir,
      configDirSource: 'system',
    })
    expect(currentAppMode({ DREAMCODER_CONFIG_DIR: '/env' }, locations)).toMatchObject({ mode: 'portable', portableDir: '/env', configDirSource: 'environment' })
    expect(currentAppMode({ DREAMCODER_CONFIG_DIR: '/p', DREAMCODER_APP_PORTABLE_DIR: '1' }, locations)).toMatchObject({ configDirSource: 'portable' })
  })
})

describe('setting the app mode', () => {
  it('writes portable mode to the active, target and system dirs', () => {
    const target = path.join(root, 'portable-target')
    setAppMode({}, locations, { mode: 'portable', portableDir: ` ${target} ` })
    const expected = { mode: 'portable', portable_dir: target }
    expect(readAppModeConfig(locations.systemConfigDir)).toEqual(expected)
    expect(readAppModeConfig(target)).toEqual(expected)
    expect(JSON.parse(readFileSync(path.join(target, 'app-mode.json'), 'utf8'))).toEqual(expected)
  })

  it('stores no portable_dir for the default portable folder and switches back to default', () => {
    const env = { DREAMCODER_CONFIG_DIR: locations.defaultPortableDir }
    setAppMode(env, locations, { mode: 'portable', portableDir: null })
    expect(readAppModeConfig(locations.defaultPortableDir)).toEqual({ mode: 'portable', portable_dir: null })
    setAppMode(env, locations, { mode: 'default', portableDir: null })
    expect(readAppModeConfig(locations.defaultPortableDir)).toEqual({ mode: 'default', portable_dir: null })
    expect(readAppModeConfig(locations.systemConfigDir)).toEqual({ mode: 'default', portable_dir: null })
  })

  it('rejects a portable path that is a file', () => {
    const file = path.join(root, 'not-a-dir')
    writeFileSync(file, '')
    expect(() => setAppMode({}, locations, { mode: 'portable', portableDir: file })).toThrow('not a directory')
  })
})

describe('restart', () => {
  it('drops only a config dir that portable mode set', () => {
    const portable: NodeJS.ProcessEnv = { DREAMCODER_CONFIG_DIR: '/p', DREAMCODER_APP_PORTABLE_DIR: '1' }
    clearPortableEnvForRestart(portable)
    expect(portable).toEqual({})
    const explicit: NodeJS.ProcessEnv = { DREAMCODER_CONFIG_DIR: '/env' }
    clearPortableEnvForRestart(explicit)
    expect(explicit).toEqual({ DREAMCODER_CONFIG_DIR: '/env' })
  })
})
