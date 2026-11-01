import { cp, readFile, rm, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'

export const BUNDLED_CATALOG_FILE = 'catalog.json'

export type LocalizedText = { en: string; zh: string }

export type BundledLicense = {
  id: string
  file: string | null
  copyright: string
}

export type BundledSource = { repo: string; commit: string; path: string }

export function bundledDirCandidates(
  dirname: string,
  appRoot: string | undefined = process.env.CLAUDE_APP_ROOT,
  cwd: string = process.cwd(),
): string[] {
  return [
    ...(appRoot
      ? [resolve(appRoot, '..', dirname), resolve(appRoot, '..', '..', dirname), resolve(appRoot, dirname)]
      : []),
    resolve(cwd, 'desktop', dirname),
    resolve(cwd, dirname),
  ]
}

export async function fileExists(path: string): Promise<boolean> {
  return stat(path).then(info => info.isFile(), () => false)
}

export async function directoryExists(path: string): Promise<boolean> {
  return stat(path).then(info => info.isDirectory(), () => false)
}

export async function resolveBundledDir(candidates: string[], catalogFile: string, label: string): Promise<string> {
  for (const candidate of candidates) {
    if (await fileExists(join(candidate, catalogFile))) return candidate
  }
  throw new Error(`The ${label} catalog was not found.`)
}

export async function copyFolderOrClean(source: string, dir: string, finish: () => Promise<void>): Promise<void> {
  try {
    await cp(source, dir, { recursive: true, errorOnExist: true, force: false })
    await finish()
  } catch (error) {
    await rm(dir, { recursive: true, force: true })
    throw error
  }
}

export async function readBundledCatalog<K extends string, R>(
  dir: string,
  key: K,
  label: string,
): Promise<{ version: 1 } & Record<K, R[]>> {
  const catalog: unknown = JSON.parse(await readFile(join(dir, BUNDLED_CATALOG_FILE), 'utf-8'))
  const record = catalog as Record<string, unknown> | null
  if (!record || record.version !== 1 || !Array.isArray(record[key])) {
    throw new Error(`The ${label} catalog is not valid.`)
  }
  return record as { version: 1 } & Record<K, R[]>
}
