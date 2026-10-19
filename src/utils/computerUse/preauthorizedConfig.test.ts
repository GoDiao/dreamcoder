import { describe, expect, test } from 'bun:test'
import { resolveStoredComputerUseConfig } from './preauthorizedConfig.js'

describe('resolveStoredComputerUseConfig', () => {
  test('is off by default', () => {
    expect(resolveStoredComputerUseConfig()).toEqual({ enabled: false, driverPath: null })
  })

  test('keeps an explicit enabled state', () => {
    expect(resolveStoredComputerUseConfig({ enabled: true })).toEqual({
      enabled: true,
      driverPath: null,
    })
  })

  test('ignores fields of the Python-based implementation', () => {
    expect(
      resolveStoredComputerUseConfig({
        enabled: true,
        mode: 'uia_tree',
        authorizedApps: [{ bundleId: 'com.apple.Safari', displayName: 'Safari' }],
        pythonPath: '/usr/bin/python3',
      } as never),
    ).toEqual({ enabled: true, driverPath: null })
  })

  test('normalizes the custom driver path', () => {
    expect(resolveStoredComputerUseConfig({ driverPath: '  /opt/cua-driver  ' }).driverPath).toBe(
      '/opt/cua-driver',
    )
    expect(resolveStoredComputerUseConfig({ driverPath: '   ' }).driverPath).toBeNull()
  })
})
