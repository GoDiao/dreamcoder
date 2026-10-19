# Experiments

Validation and experiment code that is not part of the product. Nothing here
is imported by `src/` or `desktop/`, and none of it ships.

- Root `bun test` skips `experiments/**` (see `bunfig.toml`), so experiments
  never run in CI.
- Downloaded data, virtual environments, run outputs and anything private are
  gitignored. Only code, small reference files and aggregate numbers are
  committed.
- Each experiment has its own folder with a README that says how to run it
  and which issue it reports to.

| Folder | Question | Issue |
| --- | --- | --- |
| [`system1-guardrail/`](system1-guardrail/) | Can a small local decision model safely auto-approve tool calls the permission rules would ask about? | [#125](https://github.com/GoDiao/dreamcoder/issues/125) |
