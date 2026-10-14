import { spawn } from 'child_process'
import * as fs from 'fs/promises'
import * as path from 'path'
import * as os from 'os'
import { ApiError } from '../middleware/errorHandler.js'

export type SearchResult = {
  file: string
  line: number
  text: string
  context?: string[]
}

export type SessionSearchResult = {
  sessionId: string
  title: string
  matchCount: number
  matches: Array<{ line: number; text: string }>
}

export class SearchService {
  async searchWorkspace(
    query: string,
    options?: {
      cwd?: string
      maxResults?: number
      glob?: string
      caseSensitive?: boolean
    },
  ): Promise<SearchResult[]> {
    if (!query) {
      throw ApiError.badRequest('Search query is required')
    }

    const cwd = options?.cwd || process.cwd()
    const maxResults = options?.maxResults || 200

    const hasRg = await this.commandExists('rg')
    if (hasRg) {
      try {
        return await this.searchWithRipgrep(query, cwd, maxResults, options)
      } catch {
      }
    }

    const hasGrep = await this.commandExists('grep')
    if (hasGrep) {
      try {
        return await this.searchWithGrep(query, cwd, maxResults, options)
      } catch {
      }
    }

    return this.searchWithFilesystem(query, cwd, maxResults, options)
  }

  async searchSessions(query: string): Promise<SessionSearchResult[]> {
    if (!query) {
      throw ApiError.badRequest('Search query is required')
    }

    const configDir =
      process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude')
    const projectsDir = path.join(configDir, 'projects')

    const results: SessionSearchResult[] = []

    try {
      await fs.access(projectsDir)
    } catch {
      return results
    }

    const entries = await this.walkJsonlFiles(projectsDir)
    const lowerQuery = query.toLowerCase()

    for (const filePath of entries) {
      try {
        const raw = await fs.readFile(filePath, 'utf-8')
        const lines = raw.split('\n').filter(Boolean)

        const matches: Array<{ line: number; text: string }> = []
        let title = path.basename(filePath, '.jsonl')

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]
          if (line.toLowerCase().includes(lowerQuery)) {
            try {
              const obj = JSON.parse(line) as Record<string, unknown>
              const text =
                typeof obj.message === 'string'
                  ? obj.message
                  : typeof obj.content === 'string'
                    ? obj.content
                    : line.slice(0, 200)

              if (i === 0 && typeof obj.title === 'string') {
                title = obj.title
              }

              matches.push({ line: i + 1, text: text.slice(0, 300) })
            } catch {
              matches.push({ line: i + 1, text: line.slice(0, 200) })
            }
          }
        }

        if (matches.length > 0) {
          const sessionId = path.basename(filePath, '.jsonl')
          results.push({
            sessionId,
            title,
            matchCount: matches.length,
            matches: matches.slice(0, 20),
          })
        }
      } catch {
      }
    }

    return results
  }

  private async searchWithRipgrep(
    query: string,
    cwd: string,
    maxResults: number,
    options?: {
      glob?: string
      caseSensitive?: boolean
    },
  ): Promise<SearchResult[]> {
    const args = ['--json', '--max-count', String(maxResults)]

    if (options?.caseSensitive === false) {
      args.push('--ignore-case')
    }

    args.push('-C', '4')

    if (options?.glob) {
      args.push('--glob', options.glob)
    }

    args.push('--', query, cwd)

    const output = await this.runCommand('rg', args)
    return this.parseRipgrepJson(output, maxResults)
  }

  private parseRipgrepJson(
    output: string,
    maxResults: number,
  ): SearchResult[] {
    const results: SearchResult[] = []
    const lines = output.split('\n').filter(Boolean)

    const contextMap = new Map<
      string,
      { file: string; line: number; text: string; context: string[] }
    >()

    for (const line of lines) {
      try {
        const obj = JSON.parse(line) as Record<string, unknown>
        if (obj.type === 'match') {
          const data = obj.data as {
            path?: { text?: string }
            line_number?: number
            lines?: { text?: string }
            submatches?: unknown[]
          }

          const file = data.path?.text || ''
          const lineNum = data.line_number || 0
          const text = (data.lines?.text || '').replace(/\n$/, '')
          const key = `${file}:${lineNum}`

          contextMap.set(key, { file, line: lineNum, text, context: [] })
        } else if (obj.type === 'context') {
          const data = obj.data as {
            path?: { text?: string }
            line_number?: number
            lines?: { text?: string }
          }
          const text = (data.lines?.text || '').replace(/\n$/, '')

          const file = data.path?.text || ''
          for (const [key, entry] of contextMap) {
            if (key.startsWith(file + ':')) {
              entry.context.push(text)
            }
          }
        }
      } catch {
      }
    }

    for (const entry of contextMap.values()) {
      if (results.length >= maxResults) break
      results.push({
        file: entry.file,
        line: entry.line,
        text: entry.text,
        context: entry.context.length > 0 ? entry.context : undefined,
      })
    }

    return results
  }

  private async searchWithGrep(
    query: string,
    cwd: string,
    maxResults: number,
    options?: {
      glob?: string
      caseSensitive?: boolean
    },
  ): Promise<SearchResult[]> {
    const args = ['-rn', '--max-count', String(maxResults)]

    if (options?.caseSensitive === false) {
      args.push('-i')
    }

    if (options?.glob) {
      args.push('--include', options.glob)
    }

    args.push('--', query, cwd)

    const output = await this.runCommand('grep', args)
    return this.parseGrepOutput(output, maxResults)
  }

  private parseGrepOutput(output: string, maxResults: number): SearchResult[] {
    const results: SearchResult[] = []
    const lines = output.split('\n').filter(Boolean)

    for (const line of lines) {
      if (results.length >= maxResults) break

      const match = line.match(/^(.+?):(\d+):(.*)$/)
      if (match) {
        results.push({
          file: match[1],
          line: parseInt(match[2], 10),
          text: match[3],
        })
      }
    }

    return results
  }

  private async searchWithFilesystem(
    query: string,
    cwd: string,
    maxResults: number,
    options?: {
      glob?: string
      caseSensitive?: boolean
    },
  ): Promise<SearchResult[]> {
    const results: SearchResult[] = []
    const needle = options?.caseSensitive === false ? query.toLowerCase() : query

    await this.searchDirectory(cwd, needle, results, maxResults, {
      caseSensitive: options?.caseSensitive !== false,
      glob: options?.glob,
    })

    return results
  }

  private async searchDirectory(
    dir: string,
    needle: string,
    results: SearchResult[],
    maxResults: number,
    options: {
      caseSensitive: boolean
      glob?: string
    },
  ): Promise<void> {
    if (results.length >= maxResults) return

    let entries: import('fs').Dirent[]
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }

    for (const entry of entries) {
      if (results.length >= maxResults) return
      if (entry.name === 'node_modules' || entry.name === '.git') continue

      const fullPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        await this.searchDirectory(fullPath, needle, results, maxResults, options)
        continue
      }

      if (!entry.isFile()) continue
      if (options.glob && !this.matchesSimpleGlob(entry.name, options.glob)) continue

      await this.searchFile(fullPath, needle, results, maxResults, options.caseSensitive)
    }
  }

  private async searchFile(
    filePath: string,
    needle: string,
    results: SearchResult[],
    maxResults: number,
    caseSensitive: boolean,
  ): Promise<void> {
    let content: string
    try {
      const buffer = await fs.readFile(filePath)
      if (buffer.includes(0)) return
      content = buffer.toString('utf8')
    } catch {
      return
    }

    const lines = content.split(/\r?\n/)
    for (let index = 0; index < lines.length && results.length < maxResults; index++) {
      const haystack = caseSensitive ? lines[index] : lines[index].toLowerCase()
      if (!haystack.includes(needle)) continue

      results.push({
        file: filePath,
        line: index + 1,
        text: lines[index],
      })
    }
  }

  private matchesSimpleGlob(fileName: string, glob: string): boolean {
    if (!glob.includes('*')) return fileName === glob
    const escaped = glob.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')
    return new RegExp(`^${escaped}$`).test(fileName)
  }

  private runCommand(cmd: string, args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const proc = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] })
      const chunks: Buffer[] = []

      proc.stdout.on('data', (chunk: Buffer) => chunks.push(chunk))

      proc.on('close', (code) => {
        const output = Buffer.concat(chunks).toString('utf-8')
        if (code === 0 || code === 1) {
          resolve(output)
        } else {
          reject(
            new Error(`Command "${cmd}" exited with code ${code}: ${output}`),
          )
        }
      })

      proc.on('error', (err) => {
        reject(err)
      })
    })
  }

  private commandExists(cmd: string): Promise<boolean> {
    return new Promise((resolve) => {
      const lookup = process.platform === 'win32' ? 'where' : 'which'
      const proc = spawn(lookup, [cmd], { stdio: 'ignore' })
      proc.on('close', (code) => resolve(code === 0))
      proc.on('error', () => resolve(false))
    })
  }

  private async walkJsonlFiles(dir: string): Promise<string[]> {
    const results: string[] = []

    try {
      const entries = await fs.readdir(dir, { withFileTypes: true })
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name)
        if (entry.isDirectory()) {
          const sub = await this.walkJsonlFiles(fullPath)
          results.push(...sub)
        } else if (entry.name.endsWith('.jsonl')) {
          results.push(fullPath)
        }
      }
    } catch {
    }

    return results
  }
}
