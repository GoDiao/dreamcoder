import { afterEach, describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { getRipgrepTarget, installRipgrep, RIPGREP_TARGETS, RIPGREP_VERSION } from './prepare-ripgrep.js'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

function checksum(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex')
}

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'prepare-ripgrep-'))
  tempDirs.push(root)
  const basename = `ripgrep-${RIPGREP_VERSION}-test`
  await mkdir(path.join(root, basename))
  const binary = Buffer.from('fixture-ripgrep')
  await writeFile(path.join(root, basename, 'rg'), binary)
  const archivePath = path.join(root, 'release.tar.gz')
  const proc = Bun.spawn(['tar', '-czf', archivePath, '-C', root, basename], { stderr: 'pipe' })
  if (await proc.exited !== 0) throw new Error(await new Response(proc.stderr).text())
  const archive = await readFile(archivePath)
  return {
    root,
    binary,
    archive,
    destination: path.join(root, 'vendor', 'rg'),
    target: { platform: 'arm64-darwin', archiveTarget: 'test', archiveSha256: checksum(archive), binarySha256: checksum(binary) },
  }
}

describe('ripgrep preparation', () => {
  test('covers the five release platforms and uses static Linux binaries for GNU targets', () => {
    expect(Object.keys(RIPGREP_TARGETS)).toHaveLength(5)
    expect(getRipgrepTarget('aarch64-unknown-linux-gnu')).toBe(RIPGREP_TARGETS['aarch64-unknown-linux-musl'])
    expect(getRipgrepTarget('x86_64-unknown-linux-gnu')).toBe(RIPGREP_TARGETS['x86_64-unknown-linux-musl'])
    expect(() => getRipgrepTarget('unknown')).toThrow('Unsupported ripgrep target')
  })

  test('verifies and extracts a release, then skips downloading only when binary bytes match', async () => {
    const f = await fixture()
    let downloads = 0
    const download = async (url: string) => {
      expect(url).toBe(`https://github.com/BurntSushi/ripgrep/releases/download/${RIPGREP_VERSION}/ripgrep-${RIPGREP_VERSION}-test.tar.gz`)
      downloads++
      return f.archive
    }
    await installRipgrep(f.target, f.destination, download)
    expect(await readFile(f.destination)).toEqual(f.binary)
    await chmod(f.destination, 0o644)
    await installRipgrep(f.target, f.destination, download)
    expect(downloads).toBe(1)
    if (process.platform !== 'win32') expect((await stat(f.destination)).mode & 0o777).toBe(0o755)
    await writeFile(f.destination, 'corrupt')
    await installRipgrep(f.target, f.destination, download)
    expect(downloads).toBe(2)
    expect(await readFile(f.destination)).toEqual(f.binary)
    expect(await readdir(path.dirname(f.destination))).toEqual(['rg'])
  })

  test('rejects an archive checksum mismatch without replacing an existing binary', async () => {
    const f = await fixture()
    await mkdir(path.dirname(f.destination))
    await writeFile(f.destination, 'old')
    await expect(installRipgrep(f.target, f.destination, async () => Buffer.from('corrupt'))).rejects.toThrow('archive checksum mismatch')
    expect(await readFile(f.destination, 'utf8')).toBe('old')
  })

  test('rejects extracted bytes that do not match and removes staging files', async () => {
    const f = await fixture()
    f.target.binarySha256 = '0'.repeat(64)
    await expect(installRipgrep(f.target, f.destination, async () => f.archive)).rejects.toThrow('binary checksum mismatch')
    expect(await readdir(path.dirname(f.destination))).toEqual([])
  })

  test('surfaces a download failure without installing a binary', async () => {
    const f = await fixture()
    await expect(installRipgrep(f.target, f.destination, async () => { throw new Error('offline') })).rejects.toThrow('offline')
    expect(await Bun.file(f.destination).exists()).toBe(false)
  })

  test('surfaces an extraction failure and removes staging files', async () => {
    const f = await fixture()
    const invalidArchive = Buffer.from('not an archive')
    f.target.archiveSha256 = checksum(invalidArchive)
    await expect(installRipgrep(f.target, f.destination, async () => invalidArchive)).rejects.toThrow('extraction failed')
    expect(await readdir(path.dirname(f.destination))).toEqual([])
  })
})
