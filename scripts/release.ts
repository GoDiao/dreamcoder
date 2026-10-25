#!/usr/bin/env bun

// Bumps the app version everywhere it is declared and checks that CHANGELOG.md
// has a section for it. Commit the result on a release branch and merge it via a
// pull request; pushing the `v<version>` tag on main then runs the Release
// workflow, which builds the installers into a draft release whose notes come
// from that CHANGELOG section.

import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dir, '..')
const USAGE = 'Usage: bun run scripts/release.ts <patch|minor|major|x.y.z> [--dry]'

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
  { path: 'desktop/src-tauri/tauri.conf.json', update: replaceJsonVersion, updated: jsonVersionSet },
  {
    path: 'desktop/src-tauri/Cargo.toml',
    update: (content: string, version: string) =>
      content.replace(/^version\s*=\s*"[^"]*"/m, `version = "${version}"`),
    updated: (content: string, version: string) =>
      content.match(/^version\s*=\s*"([^"]*)"/m)?.[1] === version,
  },
  {
    // Only the app's own entry; the dependency versions stay as locked.
    path: 'desktop/src-tauri/Cargo.lock',
    update: (content: string, version: string) =>
      content.replace(/(name = "dreamcoder-desktop"\r?\nversion = )"[^"]*"/, `$1"${version}"`),
    updated: (content: string, version: string) =>
      content.match(/name = "dreamcoder-desktop"\r?\nversion = "([^"]*)"/)?.[1] === version,
  },
]

function getCurrentVersion(): string {
  const desktopPackage = JSON.parse(
    readFileSync(path.join(root, 'desktop/package.json'), 'utf-8'),
  )
  return desktopPackage.version
}

function bumpVersion(current: string, bump: string): string {
  if (/^\d+\.\d+\.\d+$/.test(bump)) {
    return bump
  }

  const [major, minor, patch] = current.split('.').map(Number)

  switch (bump) {
    case 'patch':
      return `${major}.${minor}.${patch + 1}`
    case 'minor':
      return `${major}.${minor + 1}.0`
    case 'major':
      return `${major + 1}.0.0`
    default:
      console.error(`Invalid bump type: ${bump}`)
      console.error(USAGE)
      process.exit(1)
  }
}

const args = process.argv.slice(2)
const dryRun = args.includes('--dry')
const bumpArg = args.find((a) => a !== '--dry')

if (!bumpArg) {
  console.error(USAGE)
  process.exit(1)
}

const current = getCurrentVersion()
const next = bumpVersion(current, bumpArg)
const changelog = readFileSync(path.join(root, 'CHANGELOG.md'), 'utf-8')
const hasChangelogSection = changelog.split('\n').some((line) => line.startsWith(`## [${next}]`))

console.log(`\n  Version: ${current} → ${next}`)
console.log(`  Tag:     v${next}`)
console.log(`  CHANGELOG section "## [${next}]": ${hasChangelogSection ? 'present' : 'missing'}`)
console.log(`  Dry run: ${dryRun}\n`)

if (dryRun) {
  console.log('Files that would be updated:')
  for (const file of VERSION_FILES) {
    console.log(`  - ${file.path}`)
  }
  process.exit(0)
}

// Compute and check every file before writing any, so a failure leaves nothing half-bumped.
const updates = VERSION_FILES.map((file) => {
  const filePath = path.join(root, file.path)
  const content = file.update(readFileSync(filePath, 'utf-8'), next)
  if (!file.updated(content, next)) {
    console.error(`  Could not set the version in ${file.path}; nothing was written.`)
    process.exit(1)
  }
  return { file, filePath, content }
})

for (const { file, filePath, content } of updates) {
  writeFileSync(filePath, content)
  console.log(`  Updated: ${file.path}`)
}

if (!hasChangelogSection) {
  console.warn(`\n  CHANGELOG.md has no "## [${next}]" section yet. The Release workflow`)
  console.warn('  takes the release notes from it and fails without one.')
}

console.log('\n  Next: commit on a release branch and open a pull request. After it merges,')
console.log(`  tag main with: git tag -a v${next} -m "DreamCoder v${next}" && git push origin v${next}\n`)
