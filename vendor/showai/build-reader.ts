import { build, transform, type Plugin } from 'esbuild'
import { readFile, rm } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

const root = import.meta.dir
const styles = join(root, 'src/portable/cdn-styles.ts')
const AUTHORING_FIELDS = ['examples', 'propsSchema', 'scenarios', 'effects']

const cssModules: Plugin = {
  name: 'showai-css-modules',
  setup(builder) {
    builder.onLoad({ filter: /\.css$/ }, async (args) => {
      const source = await readFile(args.path, 'utf8')
      const imports: string[] = []
      const body = source.replace(/@import\s+(?:url\()?["']([^"']+)["']\)?\s*;/g, (_, path: string) => {
        imports.push(path)
        return ''
      })
      const { code: css } = await transform(body, { loader: 'css', minify: true })
      return {
        contents: [
          `import { registerStyle } from ${JSON.stringify(styles)};`,
          ...imports.map((path) => `import ${JSON.stringify(path)};`),
          `registerStyle(${JSON.stringify(css)});`,
        ].join('\n'),
        loader: 'js',
        resolveDir: dirname(args.path),
      }
    })
  },
}

const readingCatalogs: Plugin = {
  name: 'showai-reading-catalogs',
  setup(builder) {
    builder.onLoad({ filter: /[/\\]resources[/\\]catalog[/\\][^/\\]+\.json$/ }, async (args) => {
      const data: unknown = JSON.parse(await readFile(args.path, 'utf8'))
      const reading = /-documentation\.json$/.test(args.path)
        ? {}
        : Array.isArray(data)
          ? data.map((item: Record<string, unknown>) =>
              Object.fromEntries(Object.entries(item).filter(([key]) => !AUTHORING_FIELDS.includes(key))))
          : data
      return { contents: JSON.stringify(reading), loader: 'json' }
    })
  },
}

export async function buildReader(outdir: string) {
  await rm(outdir, { recursive: true, force: true })
  return build({
    entryPoints: { reader: join(root, 'src/portable/cdn.tsx') },
    absWorkingDir: root,
    bundle: true,
    splitting: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    jsx: 'automatic',
    minify: true,
    outdir,
    entryNames: '[name]',
    chunkNames: 'chunks/[name]-[hash]',
    define: { 'process.env.NODE_ENV': '"production"' },
    plugins: [cssModules, readingCatalogs],
    legalComments: 'linked',
    logLevel: 'warning',
  })
}

if (import.meta.main) {
  const outdir = process.argv[2]
  if (!outdir) throw new Error('usage: bun build-reader.ts <outdir>')
  await buildReader(resolve(outdir))
}
