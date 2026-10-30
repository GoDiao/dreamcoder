import { describe, expect, test } from 'bun:test'
import { bumpVersion, isPrerelease } from './release.js'

describe('release version bump', () => {
  test('bumps a stable version by keyword', () => {
    expect(bumpVersion('0.7.0', 'patch')).toBe('0.7.1')
    expect(bumpVersion('0.7.0', 'minor')).toBe('0.8.0')
    expect(bumpVersion('0.7.0', 'major')).toBe('1.0.0')
  })

  test('accepts explicit stable and pre-release versions', () => {
    expect(bumpVersion('0.7.0', '0.8.0')).toBe('0.8.0')
    expect(bumpVersion('0.7.0', '0.8.0-beta.1')).toBe('0.8.0-beta.1')
    expect(bumpVersion('0.8.0-beta.1', '0.8.0-beta.2')).toBe('0.8.0-beta.2')
    expect(bumpVersion('0.8.0-beta.2', '0.8.0')).toBe('0.8.0')
  })

  test('rejects keyword bumps from a pre-release and malformed versions', () => {
    expect(() => bumpVersion('0.8.0-beta.1', 'patch')).toThrow('give the next version explicitly')
    expect(() => bumpVersion('0.7.0', '0.8')).toThrow('Invalid bump type')
    expect(() => bumpVersion('0.7.0', '0.8.0-')).toThrow('Invalid bump type')
    expect(() => bumpVersion('0.7.0', 'v0.8.0')).toThrow('Invalid bump type')
  })

  test('marks versions with a pre-release suffix', () => {
    expect(isPrerelease('0.8.0-beta.1')).toBe(true)
    expect(isPrerelease('0.8.0')).toBe(false)
  })
})
