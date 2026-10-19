// A data directory's manifest.json: content hashes (to check that a
// regenerated set matches, and to record which set an evaluation used) and
// aggregate counts. For the private set the manifest is the only thing that
// may be published.
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { dataFiles, readJsonl, sha256, type ToolCallRecord, type Trajectory } from './lib'

type Counts = Record<string, number>

function countBy(records: ToolCallRecord[], key: (r: ToolCallRecord) => string): Counts {
  const counts: Counts = {}
  for (const record of records) {
    const k = key(record)
    counts[k] = (counts[k] ?? 0) + 1
  }
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)))
}

export function buildCounts(records: ToolCallRecord[]) {
  const distinct = [...new Map(records.map(r => [`${r.split}/${r.label}/${r.dedup_key}`, r])).values()]
  return {
    records: records.length,
    by_split_label: countBy(records, r => `${r.split}/${r.label}`),
    distinct_by_split_label: countBy(distinct, r => `${r.split}/${r.label}`),
    by_split_category_label: countBy(records, r => `${r.split}/${r.category}/${r.label}`),
    by_split_rules_label: countBy(records, r => `${r.split}/${r.rules_decision}/${r.label}`),
    by_tool: countBy(records, r => (r.tool.startsWith('mcp__') ? 'mcp' : r.tool)),
  }
}

export function writeManifest(dir: string, extra: Record<string, unknown> = {}): void {
  const files = dataFiles(dir)
  const path = join(dir, 'manifest.json')
  const previous = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {}
  const records = readJsonl<ToolCallRecord>(files.records)
  const hashRows = (rows: unknown[]) => sha256(rows.map(row => JSON.stringify(row)).join('\n'))
  const withoutRules = ({ rules_decision, rules_reason, ...rest }: ToolCallRecord) => rest
  const test = records.filter(r => r.split === 'test')
  const manifest = {
    ...previous,
    ...extra,
    // Hashes of the uncompressed rows, so they do not depend on gzip. The set
    // hashes leave out the rules fields, which change with the CLI's code;
    // `test_rules` covers those separately.
    sha256: {
      records: hashRows(records.map(withoutRules)),
      test_set: hashRows(test.map(withoutRules)),
      test_rules: hashRows(test.map(r => [r.id, r.rules_decision])),
      ...(existsSync(files.trajectories) && {
        trajectories: hashRows(readJsonl<Trajectory>(files.trajectories)),
      }),
    },
    counts: buildCounts(records),
  }
  writeFileSync(path, JSON.stringify(manifest, null, 2) + '\n')
}
