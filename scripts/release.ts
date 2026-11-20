#!/usr/bin/env bun

// Bumps the app version everywhere it is declared and checks that CHANGELOG.md
// has a section for it. Commit the result on a release branch and merge it via a
// pull request; pushing the `v<version>` tag on main then runs the Release
// workflow, which builds the installers into a draft release whose notes come
// from that CHANGELOG section.

import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { fetchModelsDevSnapshot, MODELS_DEV_SNAPSHOT_PATH } from './update-models-dev.js'

const root = path.resolve(import.meta.dir, '..')
const USAGE = 'Usage: bun run scripts/release.ts <patch|minor|major|x.y.z|x.y.z-pre.N> [--dry]'

const replaceJsonVersion = (content: string, version: string) =>
  content.replace(/"version":\s*"[^"]*"/, `"version": "${version}"`)
const jsonVersionSet = (content: string, version: string) =>
  content.match(/"version":\s*"([^"]*)"/)?.[1] === version

// Each `updated` checks that the version landed where `update` writes it,
// so a pattern that stops matching (a renamed crate, CRLF line endings) fails
// loudly instead of being reported as updated.
const VERSION_FILES = [
  { path: 'package.json', update: replaceJsonVersion, updated: jsonVersionSet },
  { path: 'desktop/package.json', update: replaceJsonVersion, updated: jsonVersionSet },
]

function getCurrentVersion(): string {
  const desktopPackage = JSON.parse(
    readFileSync(path.join(root, 'desktop/package.json'), 'utf-8'),
  )
  return desktopPackage.version
}

const VERSION_PATTERN = /^\d+\.\d+\.\d+(-[0-9A-Za-z]+(\.[0-9A-Za-z]+)*)?$/

export function isPrerelease(version: string): boolean {
  return version.includes('-')
}

export function bumpVersion(current: string, bump: string): string {
  if (VERSION_PATTERN.test(bump)) {
    return bump
  }

  if (!['patch', 'minor', 'major'].includes(bump)) {
    throw new Error(`Invalid bump type: ${bump}`)
  }

  if (isPrerelease(current)) {
    throw new Error(`${current} is a pre-release; give the next version explicitly, e.g. 0.8.0 or 0.8.0-beta.2`)
  }

  const [major, minor, patch] = current.split('.').map(Number)

  switch (bump) {
    case 'patch':
      return `${major}.${minor}.${patch + 1}`
    case 'minor':
      return `${major}.${minor + 1}.0`
    default:
      return `${major + 1}.0.0`
  }
}

export async function releaseFileUpdates(
  next: string,
  fetchSnapshot: () => Promise<string> = fetchModelsDevSnapshot,
): Promise<{ path: string; content: string }[]> {
  const versionUpdates = VERSION_FILES.map((file) => {
    const content = file.update(readFileSync(path.join(root, file.path), 'utf-8'), next)
    if (!file.updated(content, next)) throw new Error(`Could not set the version in ${file.path}`)
    return { path: file.path, content }
  })
  return [...versionUpdates, { path: MODELS_DEV_SNAPSHOT_PATH, content: await fetchSnapshot() }]
}

if (import.meta.main) {
  await main()
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const dryRun = args.includes('--dry')
  const bumpArg = args.find((a) => a !== '--dry')

  if (!bumpArg) {
    console.error(USAGE)
    process.exit(1)
  }

  const current = getCurrentVersion()
  let next: string
  try {
    next = bumpVersion(current, bumpArg)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    console.error(USAGE)
    process.exit(1)
  }
  const changelog = readFileSync(path.join(root, 'CHANGELOG.md'), 'utf-8')
  const hasChangelogSection = changelog.split('\n').some((line) => line.startsWith(`## [${next}]`))

  console.log(`\n  Version: ${current} → ${next}`)
  console.log(`  Tag:     v${next}`)
  console.log(`  CHANGELOG section "## [${next}]": ${hasChangelogSection ? 'present' : 'missing'}`)
  console.log(`  Dry run: ${dryRun}\n`)

  if (dryRun) {
    console.log('Files that would be updated:')
    for (const file of [...VERSION_FILES.map((entry) => entry.path), MODELS_DEV_SNAPSHOT_PATH]) {
      console.log(`  - ${file}`)
    }
    process.exit(0)
  }

  // Compute and check every file before writing any, so a failure leaves nothing half-bumped.
  let updates: Awaited<ReturnType<typeof releaseFileUpdates>>
  try {
    updates = await releaseFileUpdates(next)
  } catch (error) {
    console.error(`  ${error instanceof Error ? error.message : String(error)}; nothing was written.`)
    process.exit(1)
  }

  for (const update of updates) {
    writeFileSync(path.join(root, update.path), update.content)
    console.log(`  Updated: ${update.path}`)
  }

  if (!hasChangelogSection) {
    console.warn(`\n  CHANGELOG.md has no "## [${next}]" section yet. The Release workflow`)
    console.warn('  takes the release notes from it and fails without one.')
  }

  console.log('\n  Next: commit on a release branch and open a pull request. After it merges,')
  console.log(`  tag main with: git tag -a v${next} -m "DreamCoder v${next}" && git push origin v${next}\n`)
}
