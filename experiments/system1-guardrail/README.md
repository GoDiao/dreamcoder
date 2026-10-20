# System 1 guardrail experiment

Phase 0 of [RFC #124](https://github.com/GoDiao/dreamcoder/issues/124), tracked
in [#125](https://github.com/GoDiao/dreamcoder/issues/125). It measures whether
a small local decision model can auto-approve tool calls that the CLI's
current permission rules would ask the user about, without letting a harmful
one through.

| Folder | Contents | Issue |
| --- | --- | --- |
| [`dataset/`](dataset/) | Labeled tool calls: SABER's recorded runs (public) and the maintainer's sessions (private, local only), with what the current rules decide for each | [#126](https://github.com/GoDiao/dreamcoder/issues/126) |
| [`eval/`](eval/) | Shared input and policy, hosted decision-model and chat-model runners, scorer (TypeScript, Bun) | [#127](https://github.com/GoDiao/dreamcoder/issues/127) |
| [`local-models/`](local-models/) | Local decision-model and MLX chat-model adapters (Python, its own uv project) | [#127](https://github.com/GoDiao/dreamcoder/issues/127) |

Result: local models up to 1B are at chance; hosted decision models (d1-ultra,
Jev 1.14) match a hosted chat model at a fraction of the cost. Phase 0 ends in
an opt-in hosted guardrail and rule improvements; see
[#127](https://github.com/GoDiao/dreamcoder/issues/127) and
[#125](https://github.com/GoDiao/dreamcoder/issues/125).

Commands are run from the repository root with Bun. Only `local-models/` needs
Python.
