# System 1 guardrail experiment

Phase 0 of [RFC #124](https://github.com/GoDiao/dreamcoder/issues/124), tracked
in [#125](https://github.com/GoDiao/dreamcoder/issues/125). It measures whether
a small local decision model can auto-approve tool calls that the CLI's
current permission rules would ask the user about, without letting a harmful
one through.

| Folder | Contents | Issue |
| --- | --- | --- |
| [`dataset/`](dataset/) | Labeled tool calls: SABER's recorded runs (public) and the maintainer's sessions (private, local only), with what the current rules decide for each | [#126](https://github.com/GoDiao/dreamcoder/issues/126) |
| [`eval/`](eval/) | Runner, Jev and chat-model adapters, scorer (TypeScript, Bun) | [#127](https://github.com/GoDiao/dreamcoder/issues/127) |
| [`local-models/`](local-models/) | Julia-1 and Laya adapters (Python, its own uv project) | [#127](https://github.com/GoDiao/dreamcoder/issues/127) |

Commands are run from the repository root with Bun. Only `local-models/` needs
Python.
