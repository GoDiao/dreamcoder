import { afterEach, describe, expect, test } from 'bun:test'
import {
  CREDENTIALS_SERVICE_SUFFIX,
  getMacOsKeychainStorageServiceName,
} from '../secureStorage/macOsKeychainHelpers.js'


const originalConfigDir = process.env.DREAMCODER_CONFIG_DIR

afterEach(() => {
  if (originalConfigDir === undefined) delete process.env.DREAMCODER_CONFIG_DIR
  else process.env.DREAMCODER_CONFIG_DIR = originalConfigDir
})

describe('keychain service name', () => {
  test("never uses Claude Code's entries", () => {
    // Default mode: no configured directory. Only the name is computed.
    delete process.env.DREAMCODER_CONFIG_DIR
    const name = getMacOsKeychainStorageServiceName(CREDENTIALS_SERVICE_SUFFIX)

    expect(name.startsWith('DreamCoder')).toBe(true)
    expect(name).not.toContain('Claude Code')
  })

  test('a configured directory gets its own entry', () => {
    process.env.DREAMCODER_CONFIG_DIR = '/opt/keychain-test/config'
    const name = getMacOsKeychainStorageServiceName(CREDENTIALS_SERVICE_SUFFIX)

    expect(name).toMatch(/^DreamCoder.*-credentials-[0-9a-f]{8}$/)
  })
})
