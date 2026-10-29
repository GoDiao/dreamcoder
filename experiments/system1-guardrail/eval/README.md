# Evaluation

Scores candidates on the [`../dataset/`](../dataset/) records that the CLI's
current permission rules would ask about ([#127](https://github.com/GoDiao/dreamcoder/issues/127)).
Results and the decision are on #127 and
[#125](https://github.com/GoDiao/dreamcoder/issues/125).

Every candidate gets the same text for a record and the same policy, so
differences come from the model:

| File | Role |
| --- | --- |
| [`input.ts`](input.ts) | Renders a record: the user's request, the call, and recent steps. Views `command`, `recent1`, `recent2`, `calls` (calls without outputs) and `full`, with an optional character budget. |
| [`policy.ts`](policy.ts) | The shared policy, the yes/no phrasings for decision models, and the chat models' system prompt and answer schema. |
| [`chat.ts`](chat.ts) | Chat models through OpenRouter: `estimate`, `run` (real time, for small samples), `submit` / `fetch` (Batch API, resumable). |
| [`decisions.ts`](decisions.ts) | Decision models through OpenRouter's Decisions endpoint (Jev, d1-ultra, Mercury Decide, Clef, Kev, Solar Decide). |
| [`export.ts`](export.ts) | Writes the inputs for a local model; [`../local-models/`](../local-models/) scores them. |
| [`score.ts`](score.ts) | AUROC, calibration, false-allow rate and coverage at thresholds set on a dev run, per category and injection, and latency. |
| [`lib.ts`](lib.ts) | Which records are scored, run files, and the spending ledger. |

## Running

Run from the repository root. Hosted models read `OPENROUTER_API_KEY` from
the environment and never print it; load it per command. Only the public
SABER set may be sent to a hosted model.

```bash
# chat model, Batch API (half price, answers within 24 hours)
bun experiments/system1-guardrail/eval/chat.ts submit --model anthropic/claude-haiku-5.5 --split test --view full --budget 1500
bun experiments/system1-guardrail/eval/chat.ts fetch --run saber-test-claude-haiku-5.5-full-b1500

# decision model, real time
bun experiments/system1-guardrail/eval/decisions.ts --model liquid/d1-ultra --split test --view full --budget 1500

# local model: export, then score with ../local-models
bun experiments/system1-guardrail/eval/export.ts --model laya --split test --view full --budget 1500
uv run --project experiments/system1-guardrail/local-models experiments/system1-guardrail/local-models/run.py --run saber-test-laya-full-b1500-q0

# score a test run with thresholds from the matching dev run
bun experiments/system1-guardrail/eval/score.ts --run saber-test-d1-ultra-full-b1500-q0 --dev-run saber-dev-d1-ultra-full-b1500-q0 --match-fa 0.01
bun experiments/system1-guardrail/eval/score.ts --rules
```

Run names are printed by each command. `--exact-only` scores only exactly
matched harmful labels; `--limit N` takes the same N records for every
candidate.

## Files and money

- Runs are written to `runs/<name>/` (gitignored): `meta.json` (model, view,
  prompt hash, dataset hashes), `predictions.jsonl` with a probability per
  record, and `score.json`.
- Every hosted run records its provider-reported cost in `runs/ledger.jsonl`.
  A run that would take the total over `--cap` (default $8, counting batches
  still in flight) is refused. A key or credit limit stops a run instead of
  writing failures.
- Decision-model runs default to 64 calls in flight; OpenRouter's paid models
  have no platform request cap, and 64 ran without rate limiting.
