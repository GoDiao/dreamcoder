import { createHash } from 'node:crypto'
import { chmod, copyFile, mkdir, mkdtemp, readFile, rename, rm } from 'node:fs/promises'
import path from 'node:path'

export const RIPGREP_VERSION = '15.2.0'

export const RIPGREP_TARGETS = {
  'aarch64-apple-darwin': {
    platform: 'arm64-darwin',
    archiveTarget: 'aarch64-apple-darwin',
    archiveSha256: '3750b2e93f37e0c692657da574d7019a101c0084da05a790c83fd335bad973e4',
    binarySha256: 'a326a1fb48074202e9ad41e4cd1e389eeea372c8c6f7d7e80da81176d5d9430e',
  },
  'x86_64-apple-darwin': {
    platform: 'x64-darwin',
    archiveTarget: 'x86_64-apple-darwin',
    archiveSha256: 'af7825fcc69a2afc7a7aea55fc9af90e26421d8f20fe59df32e233c0b8a231c1',
    binarySha256: '0c9a0066db0d26b640777db88045b0ccdd58509a746700e43e1c4ff8707a5ed0',
  },
  'x86_64-pc-windows-msvc': {
    platform: 'x64-win32',
    archiveTarget: 'x86_64-pc-windows-msvc',
    archiveSha256: '71b2fef860abe467217a538ff31de02f5258807c0129f771846f87bd029aafc5',
    binarySha256: '14231169855ec5205cf5a1b6f1db358ff4aed4247c86b69ce8aae647c77f6680',
  },
  'x86_64-unknown-linux-musl': {
    platform: 'x64-linux',
    archiveTarget: 'x86_64-unknown-linux-musl',
    archiveSha256: '33e15bcf1624b25cdd2a55813a47a2f95dbe126268203e76aa6a585d1e7b149c',
    binarySha256: 'e62198eb19b136b88c330af83647b5a962cb99b6b1f066758568f12de1974849',
  },
  'aarch64-unknown-linux-musl': {
    platform: 'arm64-linux',
    archiveTarget: 'aarch64-unknown-linux-musl',
    archiveSha256: '800b1e7206afe799dfb5a6901f23147cfaabe0e52210538100f61e86e1740915',
    binarySha256: 'c14cdb389f34e504d69e386cfc67d5c5d9a730a990de03ca6910b2a15e30386a',
  },
} as const

type RipgrepTarget = {
  platform: string
  archiveTarget: string
  archiveSha256: string
  binarySha256: string
}

export function getRipgrepTarget(targetTriple: string): RipgrepTarget {
  const releaseTarget = targetTriple.replace(/-unknown-linux-gnu$/, '-unknown-linux-musl')
  if (!Object.hasOwn(RIPGREP_TARGETS, releaseTarget)) {
    throw new Error(`Unsupported ripgrep target: ${targetTriple}`)
  }
  return RIPGREP_TARGETS[releaseTarget as keyof typeof RIPGREP_TARGETS]
}

function sha256(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex')
}

async function matchesChecksum(filename: string, expected: string): Promise<boolean> {
  try {
    return sha256(await readFile(filename)) === expected
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

export function tarCommand(platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env): string {
  if (platform !== 'win32') return 'tar'
  return path.win32.join(env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe')
}

async function downloadArchive(url: string): Promise<Uint8Array> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Ripgrep download failed: ${response.status} ${url}`)
  return new Uint8Array(await response.arrayBuffer())
}

export async function installRipgrep(
  target: RipgrepTarget,
  destination: string,
  download = downloadArchive,
): Promise<void> {
  if (await matchesChecksum(destination, target.binarySha256)) {
    await chmod(destination, 0o755)
    return
  }
  const windows = target.platform.endsWith('-win32')
  const basename = `ripgrep-${RIPGREP_VERSION}-${target.archiveTarget}`
  const archiveName = `${basename}.${windows ? 'zip' : 'tar.gz'}`
  const archive = await download(`https://github.com/BurntSushi/ripgrep/releases/download/${RIPGREP_VERSION}/${archiveName}`)
  if (sha256(archive) !== target.archiveSha256) {
    throw new Error(`Ripgrep archive checksum mismatch: ${archiveName}`)
  }
  await mkdir(path.dirname(destination), { recursive: true })
  const staging = await mkdtemp(path.join(path.dirname(destination), '.ripgrep-'))
  try {
    const archivePath = path.join(staging, archiveName)
    await Bun.write(archivePath, archive)
    const binaryName = windows ? 'rg.exe' : 'rg'
    const entry = `${basename}/${binaryName}`
    const proc = Bun.spawn([tarCommand(), '-xf', archivePath, '-C', staging, entry], {
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const [stderr, exitCode] = await Promise.all([new Response(proc.stderr).text(), proc.exited])
    if (exitCode !== 0) throw new Error(`Ripgrep extraction failed (${exitCode}): ${stderr}`)
    const extracted = path.join(staging, entry)
    if (!await matchesChecksum(extracted, target.binarySha256)) {
      throw new Error(`Ripgrep binary checksum mismatch: ${entry}`)
    }
    await chmod(extracted, 0o755)
    await rename(extracted, destination)
  } finally {
    await rm(staging, { recursive: true, force: true })
  }
}

export function hostRipgrepTarget(): string {
  const host = Object.entries(RIPGREP_TARGETS).find(([, target]) => target.platform === `${process.arch}-${process.platform}`)
  if (!host) throw new Error(`Unsupported ripgrep host: ${process.arch}-${process.platform}`)
  return host[0].replace('-unknown-linux-musl', '-unknown-linux-gnu')
}

export async function prepareRipgrep(repoRoot: string, targetTriple: string): Promise<void> {
  const target = getRipgrepTarget(targetTriple)
  const extension = target.platform.endsWith('-win32') ? '.exe' : ''
  const vendorPath = path.join(repoRoot, 'vendor', 'ripgrep', target.platform, `rg${extension}`)
  await installRipgrep(target, vendorPath)
  const binaries = path.join(repoRoot, 'desktop', 'src-tauri', 'binaries')
  await mkdir(binaries, { recursive: true })
  const bundledPath = path.join(binaries, `rg-${targetTriple}${extension}`)
  if (!await matchesChecksum(bundledPath, target.binarySha256)) {
    await copyFile(vendorPath, bundledPath)
  }
  await chmod(bundledPath, 0o755)
  console.log(`[prepare-ripgrep] ${RIPGREP_VERSION} -> ${vendorPath}, ${bundledPath}`)
}

if (import.meta.main) {
  await prepareRipgrep(
    path.resolve(import.meta.dir, '..'),
    process.env.TAURI_ENV_TARGET_TRIPLE || process.env.CARGO_BUILD_TARGET || hostRipgrepTarget(),
  )
}
