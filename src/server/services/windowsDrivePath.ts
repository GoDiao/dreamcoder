import * as path from 'node:path'

export function normalizeDriveRootPathForPlatform(
  filePath: string,
  platform: NodeJS.Platform = process.platform,
): string {
  if (platform !== 'win32') return filePath

  const driveRootMatch = filePath.match(/^([a-zA-Z]):$/)
  if (!driveRootMatch) return filePath

  return `${driveRootMatch[1]}:\\`
}

export function isSameOrInsidePathForPlatform(
  targetPath: string,
  rootPath: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  const pathApi = platform === 'win32' ? path.win32 : path
  const normalize = (filePath: string) => {
    const resolved = pathApi.resolve(normalizeDriveRootPathForPlatform(filePath, platform))
    return platform === 'win32' ? resolved.toLowerCase() : resolved
  }
  const target = normalize(targetPath)
  const root = normalize(rootPath)
  const relative = pathApi.relative(root, target)

  return relative === '' || (!!relative && !relative.startsWith('..') && !pathApi.isAbsolute(relative))
}
