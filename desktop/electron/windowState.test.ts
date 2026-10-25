import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  hasMeaningfulIntersection,
  isPersistableWindowState,
  readWindowState,
  restorableBounds,
  writeWindowState,
} from './windowState'

const valid = { x: 100, y: 100, width: 1200, height: 800, maximized: false }
const retina = { x: 0, y: 25, width: 1512, height: 957 }
const external = { x: 1512, y: 0, width: 1920, height: 1080 }

let dir = ''

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'electron-window-state-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('window state rules', () => {
  it('rejects sizes below the minimum window', () => {
    expect(isPersistableWindowState(valid)).toBe(true)
    expect(isPersistableWindowState({ ...valid, width: 959 })).toBe(false)
    expect(isPersistableWindowState({ ...valid, height: 639 })).toBe(false)
  })

  it('needs a visible overlap with a display', () => {
    const area = { x: 0, y: 0, width: 1920, height: 1080 }
    expect(hasMeaningfulIntersection(valid, area)).toBe(true)
    expect(hasMeaningfulIntersection({ ...valid, x: -1200 }, area)).toBe(false)
    expect(hasMeaningfulIntersection({ ...valid, x: 1900 }, area)).toBe(false)
  })
})

describe('restoring across displays with different scale factors', () => {
  it('restores the saved bounds unchanged on whichever display shows them', () => {
    expect(restorableBounds(valid, [retina, external])).toEqual({ x: 100, y: 100, width: 1200, height: 800 })
    expect(restorableBounds({ ...valid, x: 1600 }, [retina, external])).toEqual({ x: 1600, y: 100, width: 1200, height: 800 })
  })

  it('skips a state that no display shows', () => {
    expect(restorableBounds({ ...valid, x: -5000 }, [retina, external])).toBeNull()
    expect(restorableBounds({ ...valid, x: 1600 }, [retina])).toBeNull()
  })
})

describe('window state file', () => {
  it('round-trips and ignores missing, broken or too small files', () => {
    const file = path.join(dir, 'nested', 'window-state.json')
    expect(readWindowState(file)).toBeNull()
    writeWindowState(file, valid)
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(valid)
    expect(readWindowState(file)).toEqual(valid)
    writeWindowState(file, { ...valid, width: 10 })
    expect(readWindowState(file)).toEqual(valid)
    writeFileSync(file, JSON.stringify({ ...valid, width: 10 }))
    expect(readWindowState(file)).toBeNull()
    writeFileSync(file, '{')
    expect(readWindowState(file)).toBeNull()
  })
})
