import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import {
  ARTIFACT_MANIFEST_FILE,
  ARTIFACT_ORIGIN_FILE,
  ARTIFACTS_DIRNAME,
  DESIGN_SYSTEMS_FOLDER,
  getGlobalArtifactsDir,
  isSafeArtifactName,
  listFileStamps,
  newArtifactId,
  readArtifactEntry,
  scanArtifactsDir,
  type ArtifactOrigin,
} from './artifacts.js'
import { isSameOrInsidePathForPlatform } from './windowsDrivePath.js'
import { directoryExists } from './bundledContent.js'
import { pathExists } from './file.js'

async function filesMatch(source: string, copy: string, ignored: readonly string[]): Promise<boolean> {
  const [expected, actual] = await Promise.all([listFileStamps(source), listFileStamps(copy)])
  for (const file of ignored) {
    expected.delete(file)
    actual.delete(file)
  }
  if (expected.size !== actual.size) return false
  for (const [file, stamp] of expected) {
    if (actual.get(file)?.size !== stamp.size) return false
  }
  return true
}

export async function uniqueName(artifactsDir: string, name: string): Promise<string> {
  const taken = (candidate: string) => pathExists(join(artifactsDir, candidate))
  if (!(await taken(name))) return name
  for (let suffix = 2; ; suffix++) {
    const candidate = `${name}-${suffix}`
    if (!(await taken(candidate))) return candidate
  }
}

async function rewriteManifestId(artifactDir: string): Promise<void> {
  const file = join(artifactDir, ARTIFACT_MANIFEST_FILE)
  const manifest = JSON.parse(await readFile(file, 'utf-8')) as Record<string, unknown>
  await writeFile(file, JSON.stringify({ ...manifest, id: newArtifactId() }, null, 2), 'utf-8')
}

async function carryDesignSystem(source: string, destArtifactsDir: string): Promise<void> {
  const sourceArtifactsDir = dirname(source)
  const reference = (await readArtifactEntry(sourceArtifactsDir, basename(source)))?.manifest?.designSystem
  if (!reference) return
  const from = resolve(sourceArtifactsDir, reference)
  const to = resolve(destArtifactsDir, reference)
  if (!isSameOrInsidePathForPlatform(from, join(sourceArtifactsDir, DESIGN_SYSTEMS_FOLDER))) return
  if (!isSameOrInsidePathForPlatform(to, join(destArtifactsDir, DESIGN_SYSTEMS_FOLDER))) return
  if (!(await directoryExists(from))) return
  await cp(from, to, { recursive: true, force: false, errorOnExist: false })
}

export type CopyArtifactOptions = {
  source: string
  destArtifactsDir: string
  removeSource: boolean
  origin?: ArtifactOrigin
}

export async function copyArtifactFolder(options: CopyArtifactOptions): Promise<{ name: string; dir: string }> {
  const source = resolve(options.source)
  const name = source.split(/[\\/]/).pop() ?? ''
  if (!isSafeArtifactName(name)) throw new Error(`"${name}" is not an artifact name.`)
  if (!(await directoryExists(source))) throw new Error('The artifact was not found.')
  const destArtifactsDir = resolve(options.destArtifactsDir)
  if (isSameOrInsidePathForPlatform(source, destArtifactsDir)) throw new Error('The artifact is already in this directory.')

  await mkdir(destArtifactsDir, { recursive: true })
  const newName = await uniqueName(destArtifactsDir, name)
  const target = join(destArtifactsDir, newName)
  const dropOrigin = !options.origin
  try {
    await cp(source, target, {
      recursive: true,
      errorOnExist: true,
      force: false,
      filter: path => !(dropOrigin && path.endsWith(ARTIFACT_ORIGIN_FILE)),
    })
    if (!(await filesMatch(source, target, [ARTIFACT_ORIGIN_FILE]))) throw new Error('The copy does not match the original.')
    await carryDesignSystem(source, destArtifactsDir)
    if (!options.removeSource) await rewriteManifestId(target)
    if (options.origin) await writeFile(join(target, ARTIFACT_ORIGIN_FILE), JSON.stringify(options.origin), 'utf-8')
  } catch (error) {
    await rm(target, { recursive: true, force: true })
    throw error
  }
  if (options.removeSource) await rm(source, { recursive: true, force: true })
  return { name: newName, dir: target }
}

export async function moveArtifactsToGlobalStore(
  workDir: string,
  origin: { projectRoot: string | null; branch: string | null },
): Promise<Array<{ name: string; dir: string }>> {
  const moved: Array<{ name: string; dir: string }> = []
  for (const entry of await scanArtifactsDir(join(workDir, ARTIFACTS_DIRNAME))) {
    moved.push(
      await copyArtifactFolder({
        source: entry.dir,
        destArtifactsDir: getGlobalArtifactsDir(),
        removeSource: true,
        origin: { workDir, ...origin },
      }),
    )
  }
  return moved
}
