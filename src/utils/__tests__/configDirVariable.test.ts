import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync, statSync } from 'fs'
import { join, relative } from 'path'

// DreamCoder reads its config directory from DREAMCODER_CONFIG_DIR only.
// Claude Code's variable is spelled out in pieces so this file does not match itself.
const CLAUDE_VARIABLE = ['CLAUDE', 'CONFIG', 'DIR'].join('_')
// A path segment (`…/CLAUDE_CONFIG_DIR`, `…\\CLAUDE_CONFIG_DIR`) is the portable
// folder's name, not the variable, so a preceding separator is not a match.
const VARIABLE_USE = new RegExp(`(?<![\\\\/])\\b${CLAUDE_VARIABLE}\\b`)

const REPO_ROOT = join(import.meta.dir, '..', '..', '..')
const SCANNED_DIRS = ['src', 'scripts', 'desktop/src', 'desktop/electron', 'desktop/scripts']
const SCANNED_EXTENSIONS = ['.ts', '.tsx', '.rs', '.sh']
const SKIPPED_DIRS = new Set(['node_modules', 'dist', 'target'])

// Each entry is a file and a substring of the one line allowed to use the name.
const ALLOWED: Array<{ file: string; line: string }> = [
  // The portable folder next to the executable keeps its old name.
  { file: 'desktop/electron/appMode.ts', line: 'export const PORTABLE_DIR_NAME' },
  // Locating Claude Code's directory to inherit its customizations.
  { file: 'src/utils/envUtils.ts', line: 'const CLAUDE_CODE_CONFIG_DIR_ENV' },
]

function listFiles(dir: string): string[] {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return []
  }
  return entries.flatMap((name) => {
    if (SKIPPED_DIRS.has(name)) return []
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return listFiles(path)
    return SCANNED_EXTENSIONS.some((ext) => name.endsWith(ext)) ? [path] : []
  })
}

describe('config directory variable', () => {
  test("no code uses Claude Code's config directory variable", () => {
    const uses = SCANNED_DIRS.flatMap((dir) => listFiles(join(REPO_ROOT, dir))).flatMap((path) => {
      const file = relative(REPO_ROOT, path).split('\\').join('/')
      return readFileSync(path, 'utf8')
        .split('\n')
        .flatMap((line, index) => {
          if (!VARIABLE_USE.test(line)) return []
          if (ALLOWED.some((allowed) => allowed.file === file && line.includes(allowed.line))) return []
          return [`${file}:${index + 1}: ${line.trim()}`]
        })
    })

    expect(uses).toEqual([])
  }, 15_000)
})
