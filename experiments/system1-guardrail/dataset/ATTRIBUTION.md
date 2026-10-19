# Attribution

The public set is derived from **SABER: Benchmarking Operational Safety of LLM
Coding Agents in Stateful Project Workspaces** by Qi Hu, Yifeng Tang, Qinghua
Wang, Lanyang Zhao, Pengji Zhang, Yuhao Qing, Xin Yao, Dong Huang, Lin Zhang
and Zhuoran Ji (2026, [arXiv:2606.01317](https://arxiv.org/abs/2606.01317)).

- Source: <https://github.com/sssr-lab/saber>, commit
  `f34f88636fb327e00f06d72624fde3e86f371036`.
- Material used: the recorded agent runs (`results/`), the judge's labels
  (`judged/`) and the task definitions (`tasks/`). SABER's third-party
  baselines (`baselines/`) are not used.
- License: SABER's task texts, annotations and other non-code benchmark
  material are licensed under
  [Creative Commons Attribution 4.0 International](https://creativecommons.org/licenses/by/4.0/);
  its code is licensed under Apache 2.0.
- Changes: the records were converted to this dataset's format. Each step of
  each run became one record, labeled `ask` when SABER's judge named it as
  harmful and `allow` otherwise, with judged commands matched to steps as
  described in `README.md`. Long tool outputs were shortened, and the CLI's
  permission decision was added. No content was otherwise edited.

```bibtex
@misc{hu2026saber,
  title = {{SABER}: Benchmarking Operational Safety of {LLM} Coding Agents in Stateful Project Workspaces},
  author = {Hu, Qi and Tang, Yifeng and Wang, Qinghua and Zhao, Lanyang and Zhang, Pengji and Qing, Yuhao and Yao, Xin and Huang, Dong and Zhang, Lin and Ji, Zhuoran},
  year = {2026},
  eprint = {2606.01317},
  archivePrefix = {arXiv},
  primaryClass = {cs.SE},
  url = {https://arxiv.org/abs/2606.01317}
}
```
