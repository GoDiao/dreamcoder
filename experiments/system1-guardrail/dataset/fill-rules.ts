// Fill `rules_decision` and `rules_reason` on every record of a data
// directory by running the CLI's permission pipeline (see rules.ts), then
// write the directory's manifest.
//
//   bun --preload ./preload.ts experiments/system1-guardrail/dataset/fill-rules.ts \
//     [--data <dir>] [--mode default] [--settings <settings.json>] [--map-path from=to]
//
// --settings takes the permission rules (permissions.allow/deny/ask) from a
// settings file. Without it no user rules apply. --map-path defaults to
// moving SABER's /home/user out of macOS's /home automount (see rules.ts);
// with a map, HOME must be set to the mapped home so `~` resolves as it did
// in SABER's workspace:
//
//   HOME=/system1-saber-home/user bun --preload ./preload.ts .../fill-rules.ts
import { execFileSync } from 'child_process'
import { readFileSync } from 'fs'
import { join } from 'path'
import { dataFiles, parseFlags, readJsonl, type ToolCallRecord, writeJsonl } from './lib'
import { writeManifest } from './manifest'
import { DEFAULT_RULES_CONFIG, type RulesConfig, rulesDecision } from './rules'

const flags = parseFlags(process.argv.slice(2))
const dir = flags.get('data') ?? join(import.meta.dir, 'data/saber')
const config: RulesConfig = { ...DEFAULT_RULES_CONFIG }
if (flags.has('mode')) config.mode = flags.get('mode') as RulesConfig['mode']
const mapPath = flags.get('map-path') ?? '/home/user=/system1-saber-home/user'
config.pathMap = mapPath === 'none' ? [] : [mapPath.split('=') as [string, string]]
if (flags.has('settings')) {
  const permissions = JSON.parse(readFileSync(flags.get('settings')!, 'utf8')).permissions ?? {}
  config.allow = permissions.allow ?? []
  config.deny = permissions.deny ?? []
  config.ask = permissions.ask ?? []
}

const files = dataFiles(dir)
const records = readJsonl<ToolCallRecord>(files.records)
const started = performance.now()
for (const [i, record] of records.entries()) {
  const { decision, reason } = await rulesDecision(record, config)
  record.rules_decision = decision
  record.rules_reason = reason
  if ((i + 1) % 10000 === 0) {
    console.error(`${i + 1}/${records.length} (${((performance.now() - started) / 1000).toFixed(0)}s)`)
  }
}
writeJsonl(files.records, records)
const git = (...args: string[]) =>
  execFileSync('git', ['-C', import.meta.dir, ...args], { encoding: 'utf8' }).trim()
const cliCommit = git('rev-parse', 'HEAD')
const cliDirty = git('status', '--porcelain', '--', join(import.meta.dir, '../../../src')) !== ''
writeManifest(dir, {
  rules_config: {
    ...config,
    // Counts only: the private set's rules could name private paths.
    allow: config.allow.length,
    deny: config.deny.length,
    ask: config.ask.length,
    cli_commit: cliCommit,
    cli_src_dirty: cliDirty,
  },
})
console.log(`filled ${records.length} records in ${dir}`)
process.exit(0)
