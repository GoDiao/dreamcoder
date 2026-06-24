import { describe, expect, test } from 'bun:test'

import { buildPipInstallAttempts } from './pipInstall.js'
import { installRuntimeDependencies, runPipInstallWithFallback } from './pythonBridge.js'

describe('buildPipInstallAttempts', () => {
  test('tries the configured mirror before falling back to the default index', () => {
    expect(buildPipInstallAttempts(['install', '-r', 'requirements.txt'])).toEqual([
      [
        'install',
        '-r',
        'requirements.txt',
        '-i',
        'https://pypi.tuna.tsinghua.edu.cn/simple/',
        '--trusted-host',
        'pypi.tuna.tsinghua.edu.cn',
      ],
      ['install', '-r', 'requirements.txt'],
    ])
  })
})

describe('pythonBridge runPipInstallWithFallback', () => {
  test('falls back to the default PyPI index after the mirror fails', async () => {
    const calls: string[][] = []

    await runPipInstallWithFallback(
      ['-m', 'pip', 'install', '--upgrade', 'pip'],
      'pip upgrade',
      async args => {
        calls.push(args)
        return {
          code: args.includes('-i') ? 1 : 0,
          stdout: args.includes('-i') ? '' : 'ok',
          stderr: args.includes('-i') ? 'mirror unavailable' : '',
        }
      },
    )

    expect(calls).toEqual([
      [
        '-m',
        'pip',
        'install',
        '--upgrade',
        'pip',
        '-i',
        'https://pypi.tuna.tsinghua.edu.cn/simple/',
        '--trusted-host',
        'pypi.tuna.tsinghua.edu.cn',
      ],
      ['-m', 'pip', 'install', '--upgrade', 'pip'],
    ])
  })

  test('throws the first pip failure when both indexes fail', async () => {
    await expect(runPipInstallWithFallback(
      ['-m', 'pip', 'install', '-r', 'requirements.txt'],
      'python dependency install',
      async args => ({
        code: 1,
        stdout: '',
        stderr: args.includes('-i') ? 'mirror unavailable' : 'official unavailable',
      }),
    )).rejects.toThrow('python dependency install failed with code 1: mirror unavailable')
  })
})

describe('installRuntimeDependencies', () => {
  test('upgrades pip before installing requirements', async () => {
    const calls: string[] = []

    await installRuntimeDependencies('/tmp/requirements.txt', async (args, label) => {
      calls.push(`${label}: ${args.join(' ')}`)
    })

    expect(calls).toEqual([
      'pip upgrade: -m pip install --upgrade pip',
      'python dependency install: -m pip install -r /tmp/requirements.txt',
    ])
  })
})
