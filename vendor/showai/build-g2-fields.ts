import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const root = import.meta.dir
export const G2_FIELDS_PATH = join(root, 'resources/catalog/g2-fields.json')

type Dataset = { fields: string[] } | { fields: null }
export type G2FieldSpec = Record<string, Record<string, Dataset>>

function isRecordList(value: unknown): value is Record<string, unknown>[] {
  return Array.isArray(value) && value.length > 0 && value.every((item) => item !== null && typeof item === 'object' && !Array.isArray(item))
}

export function buildG2Fields(): G2FieldSpec {
  const catalog = JSON.parse(readFileSync(join(root, 'resources/catalog/g2.json'), 'utf8')) as {
    kind: string
    defaultData: { datasets: Record<string, unknown> }
    examples?: { data?: { datasets?: Record<string, unknown> } }[]
  }[]
  const spec: G2FieldSpec = {}
  for (const entry of catalog) {
    const sample = join(root, 'src/components/blocks/g2/samples', `${entry.kind.replace(/^g2-/, '')}.js`)
    const literals = existsSync(sample)
      ? new Set([...readFileSync(sample, 'utf8').matchAll(/["'`]([^"'`\n]{1,60})["'`]/g)].map((match) => match[1]))
      : null
    const datasets = entry.examples?.[0]?.data?.datasets ?? entry.defaultData.datasets
    spec[entry.kind] = Object.fromEntries(
      Object.entries(datasets).map(([key, value]) => {
        if (!literals || !isRecordList(value)) return [key, { fields: null }]
        const keys = [...new Set(value.flatMap((record) => Object.keys(record)))]
        return [key, { fields: keys.filter((field) => literals.has(field)) }]
      }),
    )
  }
  return spec
}

if (import.meta.main) {
  writeFileSync(G2_FIELDS_PATH, `${JSON.stringify(buildG2Fields(), null, 2)}\n`)
}
