import { describe, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { baselineCases, validateBaselineCases } from './cases'

describe('baselineCases', () => {
  test('have valid metadata', () => {
    expect(() => validateBaselineCases()).not.toThrow()
  })

  test('use unique ids', () => {
    const ids = baselineCases.map((testCase) => testCase.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  test('point at existing fixtures with package manifests', () => {
    for (const testCase of baselineCases) {
      expect(existsSync(testCase.fixture)).toBe(true)
      expect(existsSync(join(testCase.fixture, 'package.json'))).toBe(true)
    }
  })

  test('require real model capability', () => {
    for (const testCase of baselineCases) {
      expect(testCase.requiredCapabilities).toContain('model')
    }
  })

  test('define enough first-wave product baseline cases', () => {
    expect(baselineCases.map((testCase) => testCase.id)).toEqual([
      'failing-unit',
      'multi-file-api',
      'failure-recovery',
      'workspace-search-edit',
      'permission-artifact',
      'cross-module-refactor',
    ])
  })

  test('pin changed-file expectations for every case', () => {
    for (const testCase of baselineCases) {
      expect(testCase.verify.requiredFiles?.length ?? 0).toBeGreaterThan(0)
      expect(testCase.verify.expectedFiles?.length ?? 0).toBeGreaterThan(0)
      for (const file of testCase.verify.requiredFiles ?? []) {
        expect(testCase.verify.expectedFiles).toContain(file)
      }
    }
  })
})
