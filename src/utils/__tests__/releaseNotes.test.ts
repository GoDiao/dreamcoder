import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { checkForReleaseNotesSync, getChangelogSection, getReleaseHighlights } from '../releaseNotes.js'

const SAMPLE = `# Changelog

## [Unreleased]

## [1.2.0] — 2026-01-02

### Added

- **Shiny feature** (#12): does a thing. More words.
- A plain entry without a title. It has two sentences.
  - a nested detail that is not a highlight

### Fixed

- \`--flag\` works again.

## [1.1.0] — 2026-01-01

- **Old thing**: not part of 1.2.0.
`

describe('releaseNotes', () => {
  it('reads one version section and stops at the next heading', () => {
    const section = getChangelogSection('1.2.0', SAMPLE)
    expect(section.startsWith('### Added')).toBe(true)
    expect(section).not.toContain('Old thing')
    expect(getChangelogSection('9.9.9', SAMPLE)).toBe('')
  })

  it('turns top-level entries into short highlights', () => {
    expect(getReleaseHighlights('1.2.0', SAMPLE)).toEqual([
      'Shiny feature',
      'A plain entry without a title.',
      '--flag works again.',
    ])
  })

  it('shows notes once per version', () => {
    const version = JSON.parse(readFileSync(path.join(import.meta.dir, '../../../package.json'), 'utf-8')).version
    expect(checkForReleaseNotesSync('0.0.1', version).hasReleaseNotes).toBe(true)
    expect(checkForReleaseNotesSync(version, version).hasReleaseNotes).toBe(false)
  })
})
