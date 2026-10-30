import { writeFile } from 'node:fs/promises'
import path from 'node:path'

const EXPORT_EXTENSIONS = new Set(['.md', '.markdown', '.json'])

export function validateExportPath(target: string): string {
  if (!path.isAbsolute(target)) throw new Error('Export path must be absolute')
  if (!EXPORT_EXTENSIONS.has(path.extname(target).toLowerCase())) throw new Error('Exports must be .md or .json files')
  return target
}

export async function writeSessionExport(target: string, contents: string) {
  const file = validateExportPath(target)
  try {
    await writeFile(file, contents, 'utf8')
  } catch (error) {
    throw new Error(`Could not write ${file}: ${error instanceof Error ? error.message : String(error)}`)
  }
}
