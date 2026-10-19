import type { LocalCommandResult } from '../../types/command.js'
import { CHANGELOG_URL, getChangelogSection } from '../../utils/releaseNotes.js'

export async function call(): Promise<LocalCommandResult> {
  const section = getChangelogSection(MACRO.VERSION)
  const value = section
    ? `DreamCoder ${MACRO.VERSION}\n\n${section}\n\nFull changelog: ${CHANGELOG_URL}`
    : `See the full changelog at: ${CHANGELOG_URL}`
  return { type: 'text', value }
}
