"""Scores a model on the held-out test notes (and test questions) with mlx-lm.

  python evaluate.py --model models/base-1.5b --fewshot            # the generic model, prompted like the app does today
  python evaluate.py --model models/base-1.5b --adapter adapters/v1  # base + fine-tuned LoRA adapter
  python evaluate.py --model models/fused-1.5b                      # fused fine-tuned model

Greedy decoding, no JSON grammar (the browser adds one), so invalid JSON counts as an empty log.
Results go to results/<name>.json with per-note predictions for inspection.
"""

from __future__ import annotations

import argparse
import json
import time
from datetime import datetime
from pathlib import Path

from mlx_lm import generate, load
from mlx_lm.sample_utils import make_sampler

from common import (
    DATA,
    PARSE_SYSTEM,
    PLAN_SYSTEM,
    PROMPTS,
    ROOT,
    describe_when,
    parse_user_message,
    read_jsonl,
    sanitize_log,
    sanitize_plan,
    score_log,
    summarize_scores,
    to_app_json,
)

FEWSHOT_WHEN = datetime(2026, 1, 12, 21, 30)
PLAN_FEWSHOT = [
    ("How often do I get headaches after drinking alcohol?", {"kind": "after", "trigger": "alcohol", "subject": "headache", "window_hours": 12, "days": 0}),
    ("how many times did I have coffee this week", {"kind": "frequency", "trigger": "", "subject": "coffee", "window_hours": 6, "days": 7}),
    ("Does bad sleep make my back pain worse?", {"kind": "sleep", "trigger": "", "subject": "back pain", "window_hours": 6, "days": 0}),
]


def parse_messages(note: str, when: datetime, fewshot: bool) -> list[dict]:
    messages = [{"role": "system", "content": PARSE_SYSTEM}]
    if fewshot:
        messages += [
            {"role": "user", "content": f"Note written {describe_when(FEWSHOT_WHEN)}:\n{PROMPTS['parse_example_note']}"},
            {"role": "assistant", "content": to_app_json(PROMPTS["parse_example_output"])},
        ]
    messages.append({"role": "user", "content": parse_user_message(note, when)})
    return messages


def plan_messages(question: str, fewshot: bool) -> list[dict]:
    messages = [{"role": "system", "content": PLAN_SYSTEM}]
    if fewshot:
        for q, plan in PLAN_FEWSHOT:
            messages += [{"role": "user", "content": q}, {"role": "assistant", "content": to_app_json(plan)}]
    messages.append({"role": "user", "content": question})
    return messages


def run(model, tokenizer, messages: list[dict], max_tokens: int) -> str:
    prompt = tokenizer.apply_chat_template(messages, add_generation_prompt=True, tokenize=False)
    return generate(model, tokenizer, prompt=prompt, max_tokens=max_tokens, sampler=make_sampler(temp=0.0))


def try_json(text: str):
    text = text.strip()
    if text.startswith("```"):
        text = text.strip("`").removeprefix("json").strip()
    try:
        return json.loads(text), True
    except json.JSONDecodeError:
        return {}, False


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True)
    parser.add_argument("--adapter")
    parser.add_argument("--fewshot", action="store_true", help="Include the app's in-prompt examples (for the generic model)")
    parser.add_argument("--name", help="Name for the results file")
    parser.add_argument("--limit", type=int, default=0)
    args = parser.parse_args()

    model, tokenizer = load(args.model, adapter_path=args.adapter)
    name = args.name or (Path(args.adapter).name if args.adapter else Path(args.model).name) + ("-fewshot" if args.fewshot else "")

    notes = read_jsonl(DATA / "parse_eval.jsonl")
    if args.limit:
        notes = notes[: args.limit]
    rows, details, valid_json, start = [], [], 0, time.time()
    for i, ex in enumerate(notes, 1):
        out = run(model, tokenizer, parse_messages(ex["note"], datetime.fromisoformat(ex["written_at"]), args.fewshot), 700)
        data, ok = try_json(out)
        valid_json += ok
        pred = sanitize_log(data)
        score = score_log(pred, ex["label"])
        rows.append(score)
        details.append({"note": ex["note"], "expected": ex["label"], "predicted": pred, "raw": out if not ok else None, "exact": score["exact"]})
        if i % 20 == 0:
            print(f"  {i}/{len(notes)} notes, {time.time() - start:.0f}s")
    summary = summarize_scores(rows)
    summary["valid_json_%"] = round(100 * valid_json / len(notes), 1)
    summary["seconds_per_note"] = round((time.time() - start) / len(notes), 2)

    plan_summary = {}
    plan_path = DATA / "plan_eval.jsonl"
    if plan_path.exists():
        questions = read_jsonl(plan_path)
        correct = {"kind": 0, "trigger": 0, "subject": 0, "days": 0, "all": 0}
        for ex in questions:
            data, _ = try_json(run(model, tokenizer, plan_messages(ex["question"], args.fewshot), 120))
            pred, ref = sanitize_plan(data), ex["plan"]
            for k in ("kind", "trigger", "subject", "days"):
                correct[k] += pred[k] == ref[k]
            correct["all"] += all(pred[k] == ref[k] for k in ("kind", "trigger", "subject", "days"))
        plan_summary = {f"plan_{k}_%": round(100 * v / len(questions), 1) for k, v in correct.items()}

    result = {"name": name, "parse": summary, "plan": plan_summary}
    out_dir = ROOT / "results"
    out_dir.mkdir(exist_ok=True)
    (out_dir / f"{name}.json").write_text(json.dumps({**result, "details": details}, indent=1, ensure_ascii=False))
    print(json.dumps(result, indent=1))


if __name__ == "__main__":
    main()
