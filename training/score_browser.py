"""Scores predictions produced by the in-browser evaluation (WebGPU, same prompts and
JSON constraints as the app) against the test labels.

  python score_browser.py browser-generic.json browser-finetuned.json

If data/parse_eval.jsonl was filtered by the independent relabel pass, only notes still
in it are scored, so both models are compared on the same trusted subset.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from common import DATA, read_jsonl, sanitize_log, sanitize_plan, score_log, summarize_scores


def load(text: str):
    try:
        return json.loads(text), True
    except (json.JSONDecodeError, TypeError):
        return {}, False


def strip_quantities(log: dict) -> dict:
    """For comparing models trained before quantities existed: drop quantity/unit on both sides."""
    return {**log, "intake": [{k: v for k, v in i.items() if k not in ("quantity", "unit")} for i in log.get("intake", [])]}


def score_file(path: Path, ignore_quantity: bool) -> dict:
    run = json.loads(path.read_text())
    refs = {r["id"]: r for r in read_jsonl(DATA / "parse_eval.jsonl")}
    rows, valid, secs = [], 0, []
    for p in run["parse"]:
        if p["id"] not in refs:
            continue
        data, ok = load(p["text"])
        valid += ok
        secs.append(p["secs"])
        pred, ref = sanitize_log(data), refs[p["id"]]["label"]
        if ignore_quantity:
            pred, ref = strip_quantities(pred), strip_quantities(ref)
        rows.append(score_log(pred, ref))
    summary = summarize_scores(rows)
    summary["valid_json_%"] = round(100 * valid / len(rows), 1)
    summary["seconds_per_note_mac"] = round(sum(secs) / len(secs), 2)

    plan_refs = {r["id"]: r["plan"] for r in read_jsonl(DATA / "plan_eval.jsonl")}
    run["plan"] = [p for p in run["plan"] if p["id"] in plan_refs]
    correct = {"kind": 0, "trigger": 0, "subject": 0, "days": 0, "all": 0}
    for p in run["plan"]:
        pred, ref = sanitize_plan(load(p["text"])[0]), plan_refs[p["id"]]
        for k in ("kind", "trigger", "subject", "days"):
            correct[k] += pred[k] == ref[k]
        correct["all"] += all(pred[k] == ref[k] for k in ("kind", "trigger", "subject", "days"))
    n = len(run["plan"])
    return {"mode": run["mode"], "parse": summary, "plan": {f"plan_{k}_%": round(100 * v / n, 1) for k, v in correct.items()}}


def main() -> None:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    results = [score_file(Path(p), "--ignore-quantity" in sys.argv) for p in args]
    keys = list(results[0]["parse"]) + list(results[0]["plan"])
    print(f"{'metric':32}" + "".join(f"{r['mode']:>14}" for r in results))
    for k in keys:
        vals = [r["parse"].get(k, r["plan"].get(k)) for r in results]
        print(f"{k:32}" + "".join(f"{v:>14}" for v in vals))
    out = Path(__file__).parent / "results" / "browser_comparison.json"
    out.parent.mkdir(exist_ok=True)
    out.write_text(json.dumps(results, indent=1))


if __name__ == "__main__":
    main()
