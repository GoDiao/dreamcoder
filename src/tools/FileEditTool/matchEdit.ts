import { stripLineNumberPrefix } from '../../utils/file.js'

const LEFT_SINGLE_CURLY_QUOTE = '\u2018'
const RIGHT_SINGLE_CURLY_QUOTE = '\u2019'
const LEFT_DOUBLE_CURLY_QUOTE = '\u201C'
const RIGHT_DOUBLE_CURLY_QUOTE = '\u201D'
const EM_DASH = '\u2014'
const EN_DASH = '\u2013'

const DESANITIZATIONS: Record<string, string> = {
  '<fnr>': '<function_results>',
  '<n>': '<name>',
  '</n>': '</name>',
  '<o>': '<output>',
  '</o>': '</output>',
  '<e>': '<error>',
  '</e>': '</error>',
  '<s>': '<system>',
  '</s>': '</system>',
  '<r>': '<result>',
  '</r>': '</result>',
  '< META_START >': '<META_START>',
  '< META_END >': '<META_END>',
  '< EOT >': '<EOT>',
  '< META >': '<META>',
  '< SOS >': '<SOS>',
  '\n\nH:': '\n\nHuman:',
  '\n\nA:': '\n\nAssistant:',
}

const MAX_INDENT_WIDTH = 8
const BARE_LINE_NUMBER = /^\s*\d+$/
const ESCAPE_SEQUENCE = /\\([nt"'\\])/g
const ESCAPED_CHARACTERS: Record<string, string> = {
  n: '\n',
  t: '\t',
  '"': '"',
  "'": "'",
  '\\': '\\',
}

export type EditMatch = {
  oldString: string
  newString: string
  matches: number
}

type MatchStrategy = (
  fileContent: string,
  oldString: string,
  newString: string,
) => EditMatch | null

type Lines = { lines: string[]; trailingNewline: boolean }

type Reindent = (indent: string) => string | null

const REPLACE_ALL_STRATEGIES: MatchStrategy[] = [
  matchExact,
  matchDesanitized,
  matchCurlyQuotes,
  matchLineNumberPrefixes,
]

const STRATEGIES: MatchStrategy[] = [
  ...REPLACE_ALL_STRATEGIES,
  matchTrailingWhitespace,
  matchIndentation,
  matchEscapes,
]

export function matchEdit(
  fileContent: string,
  oldString: string,
  newString: string,
  replaceAll: boolean,
): EditMatch {
  if (oldString === '') {
    return { oldString, newString, matches: 1 }
  }
  for (const strategy of replaceAll ? REPLACE_ALL_STRATEGIES : STRATEGIES) {
    const match = strategy(fileContent, oldString, newString)
    if (match) {
      return match
    }
  }
  return { oldString, newString, matches: 0 }
}

function countOccurrences(
  text: string,
  search: string,
  step = search.length,
): number {
  if (search === '') {
    return 0
  }
  let count = 0
  let index = text.indexOf(search)
  while (index !== -1) {
    count++
    index = text.indexOf(search, index + step)
  }
  return count
}

function matchExact(
  fileContent: string,
  oldString: string,
  newString: string,
): EditMatch | null {
  const matches = countOccurrences(fileContent, oldString)
  return matches > 0 ? { oldString, newString, matches } : null
}

function matchDesanitized(
  fileContent: string,
  oldString: string,
  newString: string,
): EditMatch | null {
  const replacements = Object.entries(DESANITIZATIONS).filter(([sanitized]) =>
    oldString.includes(sanitized),
  )
  if (replacements.length === 0) {
    return null
  }
  const desanitize = (text: string) =>
    replacements.reduce(
      (result, [sanitized, original]) => result.replaceAll(sanitized, original),
      text,
    )
  const desanitizedOld = desanitize(oldString)
  const matches = countOccurrences(fileContent, desanitizedOld)
  return matches > 0
    ? { oldString: desanitizedOld, newString: desanitize(newString), matches }
    : null
}

function normalizeQuotes(text: string): string {
  return text
    .replaceAll(LEFT_SINGLE_CURLY_QUOTE, "'")
    .replaceAll(RIGHT_SINGLE_CURLY_QUOTE, "'")
    .replaceAll(LEFT_DOUBLE_CURLY_QUOTE, '"')
    .replaceAll(RIGHT_DOUBLE_CURLY_QUOTE, '"')
}

function matchCurlyQuotes(
  fileContent: string,
  oldString: string,
  newString: string,
): EditMatch | null {
  const normalizedFile = normalizeQuotes(fileContent)
  const normalizedOld = normalizeQuotes(oldString)
  const index = normalizedFile.indexOf(normalizedOld)
  if (index === -1) {
    return null
  }
  const actualOldString = fileContent.substring(index, index + oldString.length)
  return {
    oldString: actualOldString,
    newString: applyQuoteStyle(actualOldString, newString),
    matches: countOccurrences(normalizedFile, normalizedOld),
  }
}

function applyQuoteStyle(actualOldString: string, newString: string): string {
  let result = newString
  if (
    actualOldString.includes(LEFT_DOUBLE_CURLY_QUOTE) ||
    actualOldString.includes(RIGHT_DOUBLE_CURLY_QUOTE)
  ) {
    result = curlQuotes(
      result,
      '"',
      LEFT_DOUBLE_CURLY_QUOTE,
      RIGHT_DOUBLE_CURLY_QUOTE,
    )
  }
  if (
    actualOldString.includes(LEFT_SINGLE_CURLY_QUOTE) ||
    actualOldString.includes(RIGHT_SINGLE_CURLY_QUOTE)
  ) {
    result = curlQuotes(
      result,
      "'",
      LEFT_SINGLE_CURLY_QUOTE,
      RIGHT_SINGLE_CURLY_QUOTE,
    )
  }
  return result
}

function curlQuotes(
  text: string,
  straight: string,
  opening: string,
  closing: string,
): string {
  const chars = [...text]
  return chars
    .map((char, index) => {
      if (char !== straight) {
        return char
      }
      if (straight === "'" && isApostrophe(chars, index)) {
        return closing
      }
      return opensQuote(chars, index) ? opening : closing
    })
    .join('')
}

function isApostrophe(chars: string[], index: number): boolean {
  const previous = chars[index - 1]
  const next = chars[index + 1]
  return (
    previous !== undefined &&
    next !== undefined &&
    /\p{L}/u.test(previous) &&
    /\p{L}/u.test(next)
  )
}

function opensQuote(chars: string[], index: number): boolean {
  if (index === 0) {
    return true
  }
  const previous = chars[index - 1]
  return (
    previous === ' ' ||
    previous === '\t' ||
    previous === '\n' ||
    previous === '\r' ||
    previous === '(' ||
    previous === '[' ||
    previous === '{' ||
    previous === EM_DASH ||
    previous === EN_DASH
  )
}

function matchLineNumberPrefixes(
  fileContent: string,
  oldString: string,
  newString: string,
): EditMatch | null {
  const strippedOld = stripLineNumberPrefixes(oldString)
  if (strippedOld === null) {
    return null
  }
  const matches = countOccurrences(fileContent, strippedOld)
  if (matches === 0) {
    return null
  }
  const strippedNew = stripLineNumberPrefixes(newString)
  if (strippedNew === null && hasLineNumberPrefix(newString)) {
    return null
  }
  return {
    oldString: strippedOld,
    newString: strippedNew ?? newString,
    matches,
  }
}

function hasLineNumberPrefix(text: string): boolean {
  return text.split('\n').some(line => stripLineNumberPrefix(line) !== line)
}

function stripLineNumberPrefixes(text: string): string | null {
  const { lines, trailingNewline } = splitLines(text)
  let hasPrefix = false
  const stripped: string[] = []
  for (const line of lines) {
    const withoutPrefix = stripLineNumberPrefix(line)
    if (withoutPrefix !== line) {
      hasPrefix = true
      stripped.push(withoutPrefix)
    } else if (line === '' || BARE_LINE_NUMBER.test(line)) {
      stripped.push('')
    } else {
      return null
    }
  }
  return hasPrefix ? joinLines(stripped, trailingNewline) : null
}

function splitLines(text: string): Lines {
  const trailingNewline = text.endsWith('\n')
  return {
    lines: (trailingNewline ? text.slice(0, -1) : text).split('\n'),
    trailingNewline,
  }
}

function joinLines(lines: string[], trailingNewline: boolean): string {
  return lines.join('\n') + (trailingNewline ? '\n' : '')
}

function findLineBlocks(
  fileContent: string,
  old: Lines,
  normalize: (line: string) => string,
): string[][] {
  const fileLines = fileContent.split('\n')
  const wanted = old.lines.map(normalize)
  const lastStart =
    fileLines.length - wanted.length - (old.trailingNewline ? 1 : 0)
  const blocks: string[][] = []
  for (let start = 0; start <= lastStart; start++) {
    if (
      wanted.every((line, index) => normalize(fileLines[start + index]!) === line)
    ) {
      blocks.push(fileLines.slice(start, start + wanted.length))
    }
  }
  return blocks
}

function matchLineBlock(
  fileContent: string,
  block: string[],
  blockCount: number,
  trailingNewline: boolean,
  newString: string,
): EditMatch {
  const oldString = joinLines(block, trailingNewline)
  return {
    oldString,
    newString,
    matches: Math.max(blockCount, countOccurrences(fileContent, oldString, 1)),
  }
}

function matchTrailingWhitespace(
  fileContent: string,
  oldString: string,
  newString: string,
): EditMatch | null {
  const old = splitLines(oldString)
  const blocks = findLineBlocks(fileContent, old, line => line.trimEnd())
  const first = blocks[0]
  if (!first) {
    return null
  }
  return matchLineBlock(
    fileContent,
    first,
    blocks.length,
    old.trailingNewline,
    newString,
  )
}

function indentOf(line: string): string {
  return line.slice(0, line.length - withoutIndent(line).length)
}

function withoutIndent(line: string): string {
  return line.replace(/^[ \t]+/, '')
}

function isBlank(line: string): boolean {
  return line.trim() === ''
}

function matchIndentation(
  fileContent: string,
  oldString: string,
  newString: string,
): EditMatch | null {
  const old = splitLines(oldString)
  const candidates = findLineBlocks(fileContent, old, withoutIndent).flatMap(
    block => {
      const reindent = findReindent(old.lines, block)
      return reindent ? [{ block, reindent }] : []
    },
  )
  const first = candidates[0]
  if (!first) {
    return null
  }
  const reindented = reindentLines(newString, first.reindent)
  if (reindented === null) {
    return null
  }
  return matchLineBlock(
    fileContent,
    first.block,
    candidates.length,
    old.trailingNewline,
    reindented,
  )
}

function findReindent(oldLines: string[], fileLines: string[]): Reindent | null {
  const indents = oldLines.flatMap((line, index) =>
    isBlank(line) ? [] : [[indentOf(line), indentOf(fileLines[index]!)] as const],
  )
  const first = indents[0]
  if (!first) {
    return null
  }
  return (
    reindentCandidates(first[0], first[1]).find(reindent =>
      indents.every(([oldIndent, fileIndent]) => reindent(oldIndent) === fileIndent),
    ) ?? null
  )
}

function reindentCandidates(oldIndent: string, fileIndent: string): Reindent[] {
  const candidates: Reindent[] = []
  if (fileIndent.endsWith(oldIndent)) {
    const added = fileIndent.slice(0, fileIndent.length - oldIndent.length)
    candidates.push(indent => added + indent)
  }
  if (oldIndent.endsWith(fileIndent)) {
    const removed = oldIndent.slice(0, oldIndent.length - fileIndent.length)
    candidates.push(indent =>
      indent.startsWith(removed) ? indent.slice(removed.length) : null,
    )
  }
  for (let width = 1; width <= MAX_INDENT_WIDTH; width++) {
    candidates.push(
      indent => spacesToTabs(indent, width),
      indent => tabsToSpaces(indent, width),
    )
  }
  return candidates
}

function spacesToTabs(indent: string, width: number): string | null {
  if (indent.includes('\t')) {
    return null
  }
  return (
    '\t'.repeat(Math.floor(indent.length / width)) +
    ' '.repeat(indent.length % width)
  )
}

function tabsToSpaces(indent: string, width: number): string | null {
  const tabs = indent.lastIndexOf('\t') + 1
  if (indent.slice(0, tabs).includes(' ')) {
    return null
  }
  return ' '.repeat(tabs * width + indent.length - tabs)
}

function reindentLines(text: string, reindent: Reindent): string | null {
  const lines: string[] = []
  for (const line of text.split('\n')) {
    if (isBlank(line)) {
      lines.push(line)
      continue
    }
    const indent = reindent(indentOf(line))
    if (indent === null) {
      return null
    }
    lines.push(indent + withoutIndent(line))
  }
  return lines.join('\n')
}

function matchEscapes(
  fileContent: string,
  oldString: string,
  newString: string,
): EditMatch | null {
  const unescapedOld = unescape(oldString)
  if (unescapedOld === oldString) {
    return null
  }
  const matches = countOccurrences(fileContent, unescapedOld)
  return matches > 0
    ? { oldString: unescapedOld, newString: unescape(newString), matches }
    : null
}

function unescape(text: string): string {
  return text.replace(
    ESCAPE_SEQUENCE,
    (_, character: string) => ESCAPED_CHARACTERS[character]!,
  )
}
