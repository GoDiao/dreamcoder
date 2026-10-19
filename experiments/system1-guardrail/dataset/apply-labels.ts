// Merge a labels file into a data directory's records and update its
// manifest. Each line of the labels file is {id, label, note?}; records not
// listed keep their label.
//
//   bun experiments/system1-guardrail/dataset/apply-labels.ts \
//     --labels experiments/system1-guardrail/dataset/private/labels.jsonl \
//     --source model:claude-opus-5-5 [--data experiments/system1-guardrail/dataset/private]
import { join } from 'path'
import {
  dataFiles,
  type Label,
  parseFlags,
  readJsonl,
  type ToolCallRecord,
  writeJsonl,
} from './lib'
import { writeManifest } from './manifest'

const flags = parseFlags(process.argv.slice(2))
const dir = flags.get('data') ?? join(import.meta.dir, 'private')
const labelsPath = flags.get('labels')
const source = flags.get('source')
if (!labelsPath || !source) throw new Error('--labels and --source are required')

const labels = new Map(
  readJsonl<{ id: string; label: Label; note?: string | null }>(labelsPath).map(l => [l.id, l]),
)
const files = dataFiles(dir)
const records = readJsonl<ToolCallRecord>(files.records)
let applied = 0
for (const record of records) {
  const entry = labels.get(record.id)
  if (!entry) continue
  record.label = entry.label
  record.label_source = source as ToolCallRecord['label_source']
  if (entry.note) record.meta.label_note = entry.note
  applied++
}
if (applied !== labels.size) throw new Error(`${labels.size - applied} labels match no record`)
writeJsonl(files.records, records)
writeManifest(dir)
console.log(`applied ${applied} labels`)
