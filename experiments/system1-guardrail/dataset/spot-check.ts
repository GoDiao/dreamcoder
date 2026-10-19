// Pick SABER labels for a human spot check and write them as Markdown to
// runs/spot-check.md (gitignored). Half the sample is `ask` labels whose step
// was matched loosely (the judge shortened or described the command), the
// rest is drawn evenly from the other `ask` and `allow` labels of the test
// split. The order is fixed by hash, so re-running gives the same sample.
//
//   bun experiments/system1-guardrail/dataset/spot-check.ts [--n 50]
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { loadRecords, parseFlags, sha256, type ToolCallRecord } from './lib'

const flags = parseFlags(process.argv.slice(2))
const n = Number(flags.get('n') ?? 50)
const records = loadRecords(join(import.meta.dir, 'data/saber')).filter(r => r.split === 'test')
const byHash = (list: ToolCallRecord[]) =>
  [...list].sort((a, b) => sha256(a.id).localeCompare(sha256(b.id)))
const loose = (r: ToolCallRecord) => r.meta.judge_match === 'lead' || r.meta.judge_match === 'fragments'

const picked = [
  ...byHash(records.filter(r => r.label === 'ask' && loose(r))).slice(0, Math.ceil(n / 2)),
  ...byHash(records.filter(r => r.label === 'ask' && !loose(r))).slice(0, Math.floor(n / 4)),
  ...byHash(records.filter(r => r.label === 'allow')).slice(0, n - Math.ceil(n / 2) - Math.floor(n / 4)),
]

const clip = (text: string, max = 1500) => (text.length > max ? `${text.slice(0, max)}\n[...]` : text)
const fence = (text: string) => '````\n' + text + '\n````'
const sections = picked.map((r, i) => {
  const steps = (r.context.steps ?? [])
    .map((s, j) => `**Step ${j + 1}** \`${s.tool}\`\n${fence(clip(JSON.stringify(s.input)))}\n${fence(clip(s.output, 800))}`)
    .join('\n\n')
  return [
    `## ${i + 1}. ${r.id}`,
    `- label: **${r.label}** (${r.meta.judge_match ?? 'unflagged'}), rules: ${r.rules_decision}, category: ${r.category}`,
    r.meta.judge_note ? `- judge: ${r.meta.judge_note}` : null,
    `- user request: ${r.context.user_request}`,
    `- verdict: [ ] agree  [ ] disagree  note:`,
    `\n**Call** \`${r.tool}\`\n${fence(clip(JSON.stringify(r.input, null, 1), 3000))}`,
    steps ? `<details><summary>${r.context.prior_steps} earlier steps</summary>\n\n${steps}\n</details>` : null,
  ]
    .filter(Boolean)
    .join('\n')
})

const out = join(import.meta.dir, 'runs')
mkdirSync(out, { recursive: true })
writeFileSync(join(out, 'spot-check.md'), `# SABER label spot check (${picked.length})\n\n${sections.join('\n\n')}\n`)
console.log(`wrote ${picked.length} records to ${join(out, 'spot-check.md')}`)
