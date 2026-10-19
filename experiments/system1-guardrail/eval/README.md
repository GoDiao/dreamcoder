# Evaluation

Not written yet: this is [#127](https://github.com/GoDiao/dreamcoder/issues/127),
which starts once the test split in [`../dataset/`](../dataset/) is frozen.

Planned: one adapter per candidate in Jev's request shape (state, question,
options), a runner that writes predictions with a probability per option and
the latency to `runs/` (gitignored), and a separate scorer. Each run records
the dataset manifest's `sha256.test_set` and `sha256.test_rules`, so results name the exact set
they were scored on.
