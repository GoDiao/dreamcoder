# Local models

Adapters for models that run on the maintainer's machine
([#127](https://github.com/GoDiao/dreamcoder/issues/127)). None of them
separated harmful from safe calls (AUROC 0.38–0.56); see #127 for why.

| Name in `run.py` | Model | Kind | Dependency group |
| --- | --- | --- | --- |
| `julia-1` | SupersonicLabs/Julia-1 (144M) | decision encoder | `julia-laya` (default) |
| `laya` | convaiinnovations/laya (421M, English) | decision encoder | `julia-laya` (default) |
| `vela-0.3b` | vllm-sr/Vela-2.0-0.3B | decision encoder | `decide` |
| `gliner-decide` | fastino/GLiNER2.5-Decide | decision encoder | `decide` |
| `d1-omni-600m` | LiquidAI/d1-omni-600M (LFM Open License) | decision encoder | `decide` |
| `gemma-3-1b` | mlx-community/gemma-3-1b-it-qat-4bit | chat model, MLX (Apple Silicon) | `decide` |

This is its own uv project, so nobody needs Python unless they run these
models. Julia-1 needs transformers below 5.1 and d1-omni needs 5.15 or later,
so the models are split into two dependency groups that cannot be installed
together; switching groups reinstalls from the uv cache.

Weights are read from the local Hugging Face cache at the revisions pinned in
`run.py`, with `HF_HUB_OFFLINE=1`; nothing is downloaded at run time. Fetch a
model once with `huggingface_hub.snapshot_download(repo, revision=...)`.

## Running

Export the inputs with [`../eval/export.ts`](../eval/export.ts) first (`--chat`
for `gemma-3-1b`), then from the repository root:

```bash
uv run --project experiments/system1-guardrail/local-models experiments/system1-guardrail/local-models/run.py --run saber-test-laya-full-b1500-q0 --threads 4
```

```bash
uv run --no-default-groups --group decide --project experiments/system1-guardrail/local-models experiments/system1-guardrail/local-models/run.py --run saber-dev-gemma-3-1b-full-b1500-chat-n200 --batch 8
```

- By default records are scored one at a time on the CPU, and each call's
  latency is recorded. `--batch N` (with `--device mps` for the torch models)
  is faster and records no latency.
- A state longer than the model's window is cut in the middle, in the model's
  own tokens, keeping the request and the call; the count of cut records goes
  into the run's `meta.json`.
- `gemma-3-1b` gets the chat models' system prompt; its reply is prefilled with
  `{"ask":` and the score is the probability of ` true` against ` false`.
