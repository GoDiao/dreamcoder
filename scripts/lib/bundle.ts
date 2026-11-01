import { mkdir, readdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'

export async function readIfExists(path: string): Promise<string | null> {
  return readFile(path, 'utf-8').catch(() => null)
}

export function sourceCommit(dir: string): string {
  const commit = Bun.spawnSync(['git', '-C', dir, 'rev-parse', 'HEAD']).stdout.toString().trim()
  if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error('Could not read the commit of the source checkout')
  return commit
}

export async function clearSubfolders(outDir: string): Promise<void> {
  await mkdir(outDir, { recursive: true })
  for (const entry of await readdir(outDir, { withFileTypes: true })) {
    if (entry.isDirectory()) await rm(join(outDir, entry.name), { recursive: true, force: true })
  }
}

export function parseLicense(text: string): { id: string; copyright: string } {
  const copyright = /^\s*Copyright\b.*$/m.exec(text)?.[0].trim()
  if (!copyright) throw new Error('The license has no copyright line')
  if (/^\s*MIT License/i.test(text)) return { id: 'MIT', copyright }
  if (/Apache License\s+Version 2\.0/i.test(text)) return { id: 'Apache-2.0', copyright }
  throw new Error('The license is not MIT or Apache-2.0')
}

export function holderOf(copyright: string): string {
  return copyright.replace(/^Copyright\s*(?:\(c\)|©)?\s*(?:\d{4}(?:\s*[-,]\s*\d{4})*)?\s*/i, '').trim()
}

export function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : undefined
}
