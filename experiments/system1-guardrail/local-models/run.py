"""Score a run's inputs with a local model (decision model or MLX chat model).

    uv run --project experiments/system1-guardrail/local-models \
        experiments/system1-guardrail/local-models/run.py --run <name> [--threads 8] [--batch N --device mps]

Julia-1 and Laya use the default dependency group; the other models need
`--no-default-groups --group decide` (see pyproject.toml).

The inputs come from ../eval/export.ts, so the text is the same one the
hosted candidates get. Each record is one yes/no (`noul`) question. A state
longer than the model's room is cut in the middle (in the model's own tokens,
keeping the request at the start and the call at the end) instead of the
runtime's default of dropping the end, and the cut is recorded.

Weights are read from the local Hugging Face cache; nothing is downloaded.
By default records are scored one at a time on the CPU and each latency is
recorded. --batch N scores N records per forward pass (optionally on
--device mps) for throughput; batched runs record no latency.
"""
import argparse
import json
import os
import time
from pathlib import Path

os.environ.setdefault('HF_HUB_OFFLINE', '1')
os.environ.setdefault('USE_TF', '0')

import torch  # noqa: E402
from huggingface_hub.constants import HF_HUB_CACHE  # noqa: E402

RUNS = Path(__file__).resolve().parent.parent / 'eval' / 'runs'

# Pinned to the cached snapshots the experiment was run with.
CHECKPOINTS = {
    'julia-1': ('SupersonicLabs/Julia-1', 'a85b127321d580d65176c89ced8273f305745d85'),
    'laya': ('convaiinnovations/laya', '7b928d828b7b0e022f929d9bd2e44165aa270148'),
    # These three need the `decide` dependency group (newer transformers):
    #   uv run --no-default-groups --group decide ...
    'vela-0.3b': ('vllm-sr/Vela-2.0-0.3B', 'd6f03aa9baca4f9017fa8f8e9c2764d3bed3f409'),
    'gliner-decide': ('fastino/GLiNER2.5-Decide', '9d1bfb848cd16d93ee56ccbc59cd92bf0f284d90'),
    'd1-omni-600m': ('LiquidAI/d1-omni-600M', '02b55d7076f15129e59ab3f94783f32c4b088674'),
    # Local chat model (MLX, Apple Silicon), exported with --chat.
    'gemma-3-1b': ('mlx-community/gemma-3-1b-it-qat-4bit', '15fed4eafb456c6fcb2a1165f19ac609670ed14b'),
}
# Julia-1: its native 8,192-token limit with a 512-token question head, as in
# its model card. Laya: its config (512 tokens, 192 for the question).
JULIA_MAX, JULIA_HEAD = 8192, 512


class Julia:
    def __init__(self, path, device):
        from julia import load_model
        self.engine = load_model(path, device=device, max_length=JULIA_MAX, head_length=JULIA_HEAD)
        self.tok = self.engine.tokenizer
        self.max_len, self.head_max = JULIA_MAX, JULIA_HEAD

    def score(self, state, question):
        out = self.engine.predict(state=state, questions={'decision': question})
        return out['answers']['decision']['noul']

    def score_batch(self, states, question):
        # The rows predict_typed builds for one noul question: options false, true.
        options = [question['criteria']['false'], question['criteria']['true']]
        rows = [dict(state=s, question=question['instructions'], type='noul', options=options) for s in states]
        return [torch.tensor(z).softmax(-1)[1].item() for z in self.engine.logits(rows)]


class Laya:
    def __init__(self, path, device):
        import laya
        self.agent = laya.load(path, device=device)
        self.tok = self.agent.tok
        self.max_len = int(self.agent.cfg.get('max_len', 512))
        self.head_max = int(self.agent.cfg.get('head_max_len', 192))

    def score(self, state, question):
        out = self.agent.predict(state, {'decision': question})
        return out['answers']['decision']['noul']

    def score_batch(self, states, question):
        out = self.agent.predict_batch(states, {'decision': question}, batch_size=len(states))
        return [r['answers']['decision']['noul'] for r in out]


class SystemOne:
    """Vela and d1: Jev-style `system_one(state, questions)` from the model's own code."""

    def __init__(self, path, device, max_len):
        from transformers import AutoModel, AutoTokenizer
        # The models' cards ask for fp32 on the CPU.
        self.model = AutoModel.from_pretrained(path, trust_remote_code=True).to(device).eval()
        self.tok = AutoTokenizer.from_pretrained(path)
        self.max_len, self.head_max = max_len, max_len

    def score(self, state, question):
        with torch.inference_mode():
            return self.model.system_one(state, {'decision': question})['answers']['decision']['noul']


class Gliner:
    """GLiNER2.5-Decide: a two-label classification with the question as its prompt.

    Its encoder (DeBERTa-v3-large) was trained on 512 positions, so the state
    is fitted to that like Laya's.
    """

    def __init__(self, path, device):
        from gliner2 import AutoExtractor
        from transformers import AutoTokenizer
        self.model = AutoExtractor.from_pretrained(path)
        self.model.to(device)
        self.tok = AutoTokenizer.from_pretrained(path)
        self.max_len, self.head_max = 512, 512

    def score(self, state, question):
        task = {'decision': {'labels': {'true': question['criteria']['true'], 'false': question['criteria']['false']},
                             'prompt': question['instructions']}}
        out = self.model.classify_text(state, task, include_confidence=True)['decision']
        # The confidence is for the chosen label of two.
        return out['confidence'] if out['label'] == 'true' else 1 - out['confidence']


class MlxChat:
    """A local chat model given the chat baseline's prompt.

    Instead of generating the JSON answer, the reply is prefilled with
    `{"ask":` and P(ask) is read from the next token: ` true` against ` false`.
    One forward pass per record, batched by mlx-lm's BatchGenerator on the
    Apple GPU (`--device` is ignored).
    """
    PREFILL = '{"ask":'

    def __init__(self, path):
        from mlx_lm import load as mlx_load
        self.model, self.wrapper = mlx_load(path)
        self.tok = self.wrapper._tokenizer
        self.max_len, self.head_max = 32768, 32768
        base = self.tok.encode(self.PREFILL, add_special_tokens=False)
        def first_token(word):
            # The first token after the prefill when the reply goes on with
            # ` true` / ` false` (the space may merge into the word's token).
            ids = self.tok.encode(self.PREFILL + ' ' + word, add_special_tokens=False)
            if ids[:len(base)] != base:
                raise ValueError(f'prefill tokenizes differently before {word!r}')
            return ids[len(base)]
        self.true_id, self.false_id = first_token('true'), first_token('false')

    def prompt(self, state, question):
        messages = [{'role': 'system', 'content': question['instructions']}, {'role': 'user', 'content': state}]
        text = self.tok.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
        return self.tok.encode(text + self.PREFILL, add_special_tokens=False)

    def score(self, state, question):
        return self.score_batch([state], question)[0]

    def score_batch(self, states, question):
        import mlx.core as mx
        from mlx_lm.generate import BatchGenerator
        gen = BatchGenerator(self.model, stop_tokens=[], prefill_batch_size=len(states),
                             completion_batch_size=len(states))
        uids = gen.insert([self.prompt(s, question) for s in states], [1] * len(states))
        scores = {}
        while responses := gen.next_generated():
            for r in responses:
                if r.uid not in scores:
                    pair = mx.array([r.logprobs[self.true_id], r.logprobs[self.false_id]])
                    scores[r.uid] = mx.softmax(pair)[0].item()
        gen.close()
        return [scores[uid] for uid in uids]


def load(name, path, device):
    if name == 'gemma-3-1b':
        return MlxChat(path)
    if name == 'julia-1':
        return Julia(path, device)
    if name == 'laya':
        return Laya(path, device)
    if name == 'vela-0.3b':
        return SystemOne(path, device, 8192)
    if name == 'd1-omni-600m':
        return SystemOne(path, device, 16384)
    return Gliner(path, device)


def encode(tok, text):
    return tok(text, add_special_tokens=False)['input_ids']


def head_tokens(tok, question):
    """Tokens of the question and options, as both runtimes lay them out."""
    head = len(encode(tok, f"noul question: {question['instructions']}"))
    options = sum(len(encode(tok, ' ' + text)) + 1 for text in (question['criteria'] or {}).values())
    return head, options


def fit(tok, state, room):
    """Cut the middle of `state` to `room` tokens, keeping 30% at the start and 70% at the end."""
    ids = encode(tok, state)
    if len(ids) <= room:
        return state, len(ids), False
    marker = ' [... cut ...] '
    keep = room - len(encode(tok, marker)) - 2
    head = int(keep * 0.3)
    text = tok.decode(ids[:head]) + marker + tok.decode(ids[len(ids) - (keep - head):])
    return text, len(ids), True


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--run', required=True)
    parser.add_argument('--threads', type=int, default=8)
    parser.add_argument('--device', default='cpu')
    parser.add_argument('--batch', type=int, default=0)
    args = parser.parse_args()
    torch.set_num_threads(args.threads)

    run = RUNS / args.run
    meta = json.loads((run / 'meta.json').read_text())
    repo, revision = CHECKPOINTS[meta['model']]
    # The cache holds only the files the runtime needs, not the whole repo, so
    # the snapshot directory is used directly.
    path = Path(HF_HUB_CACHE) / f"models--{repo.replace('/', '--')}" / 'snapshots' / revision
    if not (path / 'model.safetensors').exists():
        raise SystemExit(f'{repo}@{revision} is not in the local cache')
    path = str(path)
    model = load(meta['model'], path, args.device)
    inputs = [json.loads(line) for line in (run / 'inputs.jsonl').read_text().splitlines() if line]

    first = inputs[0]
    question = {'type': 'noul', 'instructions': first['instructions'], 'criteria': first['criteria']}
    head, options = head_tokens(model.tok, question)
    # Margin for [CLS]/[SEP] and differences in how each runtime counts its head.
    room = model.max_len - min(head + options, model.head_max) - 8
    question_cut = head + options > model.head_max

    predictions, cut = [], 0

    def record(row, noul, latency, tokens, truncated, error=None):
        p_ask = None if noul is None else (noul if row['yes'] == 'ask' else 1 - noul)
        prediction = dict(id=row['id'], p_ask=p_ask, decision=None)
        if error is not None:  # a failed record counts as ask in the scorer
            prediction['error'] = error[:300]
        if latency is not None:
            prediction['latency_ms'] = latency
        prediction.update(state_tokens=tokens, truncated=truncated)
        predictions.append(prediction)
        if len(predictions) % 1000 == 0:
            print(f'{args.run}: {len(predictions)}/{len(inputs)}', flush=True)

    step = max(1, args.batch)
    for start in range(0, len(inputs), step):
        rows = inputs[start:start + step]
        # Every row of a run has the same question.
        question = {'type': 'noul', 'instructions': rows[0]['instructions'], 'criteria': rows[0]['criteria']}
        fitted = [fit(model.tok, row['state'], room) for row in rows]
        cut += sum(f[2] for f in fitted)
        if args.batch == 0:
            row, (state, tokens, truncated) = rows[0], fitted[0]
            started = time.perf_counter()
            try:
                noul, error = float(model.score(state, question)), None
            except Exception as e:
                noul, error = None, str(e)
            record(row, noul, round((time.perf_counter() - started) * 1000, 1), tokens, truncated, error)
            continue
        try:
            scores = model.score_batch([f[0] for f in fitted], question)
            for row, (_, tokens, truncated), noul in zip(rows, fitted, scores):
                record(row, float(noul), None, tokens, truncated)
        except Exception as e:
            for row, (_, tokens, truncated) in zip(rows, fitted):
                record(row, None, None, tokens, truncated, str(e))

    with open(run / 'predictions.jsonl', 'w') as out:
        for prediction in predictions:
            out.write(json.dumps(prediction) + '\n')
    meta.update(threads=args.threads, device=args.device, batch=args.batch, state_room_tokens=room, question_tokens=head + options,
                question_cut=question_cut, truncated_records=cut)
    (run / 'meta.json').write_text(json.dumps(meta, indent=2) + '\n')
    failed = sum(p['p_ask'] is None for p in predictions)
    print(json.dumps(dict(run=args.run, records=len(predictions), failed=failed, truncated=cut,
                          question_tokens=head + options, question_cut=question_cut, room=room)))


if __name__ == '__main__':
    main()
