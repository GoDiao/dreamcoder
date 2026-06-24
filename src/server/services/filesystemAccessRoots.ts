import * as path from 'node:path'
import {
  isSameOrInsidePathForPlatform,
  normalizeDriveRootPathForPlatform,
} from './windowsDrivePath.js'

const registeredRoots = new Set<string>()

function isWithinRoot(targetPath: string, rootPath: string): boolean {
  return isSameOrInsidePathForPlatform(targetPath, rootPath)
}

export function registerFilesystemAccessRoot(rootPath: string | null | undefined): void {
  if (!rootPath) return
  registeredRoots.add(path.resolve(normalizeDriveRootPathForPlatform(rootPath)))
}

export function isWithinRegisteredFilesystemRoot(targetPath: string): boolean {
  for (const rootPath of registeredRoots) {
    if (isWithinRoot(targetPath, rootPath)) return true
  }
  return false
}

export function clearFilesystemAccessRootsForTests(): void {
  registeredRoots.clear()
}
