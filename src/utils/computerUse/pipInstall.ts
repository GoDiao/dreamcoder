const PIP_MIRROR_ARGS = [
  '-i',
  'https://pypi.tuna.tsinghua.edu.cn/simple/',
  '--trusted-host',
  'pypi.tuna.tsinghua.edu.cn',
]

export function buildPipInstallAttempts(baseArgs: string[]): string[][] {
  return [
    [...baseArgs, ...PIP_MIRROR_ARGS],
    baseArgs,
  ]
}
