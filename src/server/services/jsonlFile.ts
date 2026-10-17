import * as fs from 'node:fs/promises'

/**
 * The parsed lines of a JSONL file, in order. A missing file reads as empty;
 * blank and unparseable lines are skipped.
 */
export async function readJsonlFile<T>(filePath: string): Promise<T[]> {
  let content: string
  try {
    content = await fs.readFile(filePath, 'utf-8')
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return []
    }
    throw err
  }

  const entries: T[] = []
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      entries.push(JSON.parse(trimmed) as T)
    } catch {
    }
  }
  return entries
}
