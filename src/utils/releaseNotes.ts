// DreamCoder's own release notes, read from the repository's CHANGELOG.md.
// The text import is inlined when the CLI is bundled, so the notes always match
// the version that was built and nothing is fetched at startup.
import changelog from '../../CHANGELOG.md' with { type: 'text' }

export const CHANGELOG_URL = 'https://github.com/GoDiao/dreamcoder/blob/main/CHANGELOG.md'

const MAX_HIGHLIGHT_LENGTH = 72

/** The body of the `## [version]` section, without its heading, or '' if there is none. */
export function getChangelogSection(version: string, content: string = changelog): string {
  const lines = content.replace(/\r\n/g, '\n').split('\n')
  const start = lines.findIndex(line => line.startsWith(`## [${version}]`))
  if (start < 0) return ''
  const end = lines.findIndex((line, index) => index > start && line.startsWith('## ['))
  return lines
    .slice(start + 1, end < 0 ? undefined : end)
    .join('\n')
    .trim()
}

/**
 * One short line per top-level entry of a version's section: the bold title
 * when the entry has one (`- **Title** (#1): ...`), otherwise its first sentence.
 */
export function getReleaseHighlights(version: string, content: string = changelog): string[] {
  return getChangelogSection(version, content)
    .split('\n')
    .filter(line => line.startsWith('- '))
    .map(line => {
      const entry = line.slice(2).trim()
      const title = entry.match(/^\*\*(.+?)\*\*/)?.[1]
      const text = (title ?? entry.split(/(?<=\.)\s/)[0] ?? entry).replace(/`/g, '')
      return text.length <= MAX_HIGHLIGHT_LENGTH ? text : `${text.slice(0, MAX_HIGHLIGHT_LENGTH - 1)}…`
    })
}

/** Release notes are worth showing once per version, until the user has seen them. */
export function checkForReleaseNotesSync(
  lastSeenVersion: string | null | undefined,
  currentVersion: string = MACRO.VERSION,
): { hasReleaseNotes: boolean; releaseNotes: string[] } {
  const releaseNotes = getReleaseHighlights(currentVersion)
  return {
    hasReleaseNotes: lastSeenVersion !== currentVersion && releaseNotes.length > 0,
    releaseNotes,
  }
}
