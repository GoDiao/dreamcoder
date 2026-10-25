import path from 'node:path'

const desktopRoot = path.resolve(import.meta.dir, '..')
const outdir = path.join(desktopRoot, 'electron-dist')

for (const [entry, naming] of [['main.ts', 'main.cjs'], ['preload.ts', 'preload.cjs']] as const) {
  const result = await Bun.build({
    entrypoints: [path.join(desktopRoot, 'electron', entry)],
    outdir,
    naming,
    target: 'node',
    format: 'cjs',
    external: ['electron'],
  })
  if (!result.success) {
    for (const log of result.logs) console.error(log)
    throw new Error(`[build-electron] failed to bundle ${entry}`)
  }
}

const manifest = await Bun.file(path.join(desktopRoot, 'package.json')).json()
await Bun.write(path.join(outdir, 'package.json'), JSON.stringify({
  name: manifest.name,
  productName: 'DreamCoder',
  version: manifest.version,
  description: manifest.description,
  author: manifest.author,
  license: manifest.license,
  main: 'main.cjs',
}, null, 2))

console.log(`[build-electron] wrote ${outdir}`)
