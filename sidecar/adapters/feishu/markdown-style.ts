export const FEISHU_CARD_TABLE_LIMIT = 3

export function optimizeMarkdownForFeishu(text: string, cardVersion = 2): string {
  try {
    let r = _optimizeMarkdownForFeishu(text, cardVersion)
    r = stripInvalidImageKeys(r)
    return r
  } catch {
    return text
  }
}

function _optimizeMarkdownForFeishu(text: string, cardVersion: number): string {
  const MARK = '___CB_'
  const codeBlocks: string[] = []
  let r = text.replace(/```[\s\S]*?```/g, (m) => {
    return `${MARK}${codeBlocks.push(m) - 1}___`
  })

  const hasH1toH3 = /^#{1,3} /m.test(text)
  if (hasH1toH3) {
    r = r.replace(/^#{2,6} (.+)$/gm, '##### $1')
    r = r.replace(/^# (.+)$/gm, '#### $1')
  }

  if (cardVersion >= 2) {
    r = r.replace(/^(#{4,5} .+)\n{1,2}(#{4,5} )/gm, '$1\n<br>\n$2')

    r = r.replace(/^([^|\n].*)\n(\|.+\|)/gm, '$1\n\n$2')

    r = r.replace(/\n\n((?:\|.+\|[^\S\n]*\n?)+)/g, '\n\n<br>\n\n$1')

    r = r.replace(/((?:^\|.+\|[^\S\n]*\n?)+)/gm, (m, _table, offset) => {
      const after = r.slice(offset + m.length).replace(/^\n+/, '')
      if (!after || /^(---|#{4,5} |\*\*)/.test(after)) return m
      return m + '\n<br>\n'
    })

    r = r.replace(/^((?!#{4,5} )(?!\*\*).+)\n\n(<br>)\n\n(\|)/gm, '$1\n$2\n$3')

    r = r.replace(/^(\*\*.+)\n\n(<br>)\n\n(\|)/gm, '$1\n$2\n\n$3')

    r = r.replace(/(\|[^\n]*\n)\n(<br>\n)((?!#{4,5} )(?!\*\*))/gm, '$1$2$3')
  }

  r = r.replace(/\n{3,}/g, '\n\n')

  codeBlocks.forEach((block, i) => {
    const replacement = cardVersion >= 2 ? `\n<br>\n${block}\n<br>\n` : block
    r = r.replace(`${MARK}${i}___`, replacement)
  })

  return r
}

const IMAGE_RE = /!\[([^\]]*)\]\(([^)\s]+)\)/g

function stripInvalidImageKeys(text: string): string {
  if (!text.includes('![')) return text
  return text.replace(IMAGE_RE, (fullMatch, _alt, value) => {
    if (value.startsWith('img_')) return fullMatch
    return ''
  })
}

export type MarkdownTableMatch = {
  index: number
  length: number
  raw: string
}

export function findMarkdownTablesOutsideCodeBlocks(text: string): MarkdownTableMatch[] {
  const codeBlockRanges: Array<{ start: number; end: number }> = []
  const codeBlockRegex = /```[\s\S]*?```/g
  let cbMatch = codeBlockRegex.exec(text)
  while (cbMatch != null) {
    codeBlockRanges.push({
      start: cbMatch.index,
      end: cbMatch.index + cbMatch[0].length,
    })
    cbMatch = codeBlockRegex.exec(text)
  }
  const isInsideCodeBlock = (idx: number): boolean =>
    codeBlockRanges.some((range) => idx >= range.start && idx < range.end)

  const tableRegex = /\|.+\|[\r\n]+\|[-:| ]+\|[\s\S]*?(?=\n\n|\n(?!\|)|$)/g
  const matches: MarkdownTableMatch[] = []
  let tableMatch = tableRegex.exec(text)
  while (tableMatch != null) {
    if (!isInsideCodeBlock(tableMatch.index)) {
      matches.push({
        index: tableMatch.index,
        length: tableMatch[0].length,
        raw: tableMatch[0],
      })
    }
    tableMatch = tableRegex.exec(text)
  }
  return matches
}

export function sanitizeTextForCard(
  text: string,
  tableLimit: number = FEISHU_CARD_TABLE_LIMIT,
): string {
  const matches = findMarkdownTablesOutsideCodeBlocks(text)
  if (matches.length <= tableLimit) return text
  return wrapTablesBeyondLimit(text, matches, Math.max(tableLimit, 0))
}

function wrapTablesBeyondLimit(
  text: string,
  matches: readonly MarkdownTableMatch[],
  keepCount: number,
): string {
  if (matches.length <= keepCount) return text
  let result = text
  for (let i = matches.length - 1; i >= keepCount; i--) {
    const { index, length, raw } = matches[i]!
    const replacement = '```\n' + raw + '\n```'
    result = result.slice(0, index) + replacement + result.slice(index + length)
  }
  return result
}
