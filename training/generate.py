"""Synthetic data generation with Claude as the teacher.

Usage (run from training/ with the venv):
  python generate.py pilot  --task parse --requests 2      # small synchronous run: check quality and real token usage
  python generate.py submit --task parse --split train --requests 400
  python generate.py submit --task parse --split eval  --requests 20
  python generate.py submit --task plan  --split train --requests 40
  python generate.py status                                # show batch progress
  python generate.py collect                               # download finished batches, validate, write data/*.jsonl
  python generate.py relabel --split eval                  # eval only: independent second labeling to catch label mistakes

Nothing personal is ever sent: every note is invented by the teacher.
"""

from __future__ import annotations

import argparse
import json
import random
import sys
import time
from datetime import datetime, timedelta

import anthropic
from anthropic.types.message_create_params import MessageCreateParamsNonStreaming
from anthropic.types.messages.batch_create_params import Request
from dotenv import load_dotenv

from common import (
    DATA,
    PARSED_LOG_SCHEMA,
    QUERY_PLAN_SCHEMA,
    describe_when,
    read_jsonl,
    sanitize_log,
    sanitize_plan,
    score_log,
    write_jsonl,
)
from teacher_prompts import PLAN_TEACHER_SYSTEM, TEACHER_SYSTEM

load_dotenv(DATA.parent / ".env")

MODEL = "claude-opus-5-5"
EFFORT = "medium"
NOTES_PER_REQUEST = 8
QUESTIONS_PER_REQUEST = 25
RAW = DATA / "raw"
BATCHES_FILE = RAW / "batches.json"

# Batch API prices for claude-opus-5-5 (50% of $4 / $20 per million tokens).
PRICE_IN, PRICE_OUT = 2.0 / 1e6, 10.0 / 1e6
SYNC_PRICE_IN, SYNC_PRICE_OUT = 4.0 / 1e6, 20.0 / 1e6

# ---------------------------------------------------------------------------
# Diversity seeds

PERSONAS = [
    "a 24 year old software engineer in Bangalore with acidity problems",
    "a 31 year old nurse in Chicago working night shifts",
    "a 45 year old teacher in London with lower back pain",
    "a 19 year old college student in Pune who drinks a lot of chai and energy drinks",
    "a 38 year old mother of two in Mumbai with migraines",
    "a 52 year old accountant in Delhi managing type 2 diabetes",
    "a 29 year old marathon runner in Boston",
    "a 34 year old designer in Berlin with IBS",
    "a 60 year old retiree in Florida with arthritis in the knees",
    "a 27 year old consultant in Singapore who travels constantly",
    "a 41 year old chef in Hyderabad",
    "a 33 year old new father in Toronto who barely sleeps",
    "a 22 year old gym enthusiast in Gurgaon tracking protein",
    "a 36 year old woman in Sydney with PCOS",
    "a 48 year old truck driver in Texas with heartburn",
    "a 26 year old PhD student in Chennai with anxiety",
    "a 55 year old man in Kolkata with high blood pressure",
    "a 30 year old yoga instructor in Goa",
    "a 39 year old lawyer in New York who drinks wine most nights",
    "a 23 year old barista in Seattle",
    "a 44 year old farmer in Punjab",
    "a 35 year old remote worker in Lisbon with neck pain",
    "a 28 year old woman in Jaipur tracking her period symptoms",
    "a 50 year old woman in Ahmedabad going through menopause",
    "a 32 year old gamer in Noida who sleeps at 4am",
    "a 47 year old pilot in Dubai with jet lag",
    "a 21 year old cricketer in Kochi",
    "a 37 year old vegan in Portland with low iron",
    "a 42 year old sales manager in Kuala Lumpur with frequent colds",
    "a 25 year old call center worker in Manila on rotating shifts",
    "a 58 year old man in Lucknow recovering from a stomach infection",
    "a 31 year old woman in San Francisco who is lactose intolerant",
]

STYLES = [
    "voice dictation transcript: rambling, filler words like um and uh, run-on sentences, no punctuation",
    "very terse shorthand, abbreviations (hrs, w/, b4, bf, tmrw), lowercase",
    "quick typed phone note with a few typos and missing words",
    "a short diary style paragraph with full sentences",
    "a list separated by commas or line breaks",
    "Indian English with some Hindi words mixed in (roti, sabzi, chai, thoda, bahut)",
    "casual texting style with slang",
    "one or two short sentences only",
    "a longer note covering the whole day in order",
    "a note written about something happening right now",
    "a morning note mostly about last night and the morning so far",
    "a late night note summarizing the day, including some things that did not happen",
]

FOCUS = [
    "a symptom with an explicit clock time and a food eaten before it",
    "a symptom that started 'an hour after' or '30 mins after' a timed event",
    "something negated, like no headache today or skipped coffee",
    "a plan for later that should not be logged",
    "medicines by brand name (dolo 650, crocin, pan d, advil, tylenol, zyrtec) with amounts",
    "vitamins or supplements",
    "alcohol with quantities",
    "exercise with durations in hours or fractions ('1.5 hrs', 'half an hour')",
    "sleep given as a time range (from 11:30 to 6)",
    "sleep described without numbers (slept terribly)",
    "a nap in the afternoon",
    "multiple symptoms with different severities",
    "Indian home food (dal, roti, poha, idli, rajma chawal, paratha)",
    "fast food and snacks",
    "only food, no symptoms",
    "mostly mood or stress with little else",
    "a note that is not health related at all (work, errands) apart from maybe one detail",
    "something another person had (my kid had fever) that should not be logged",
    "vague times (in the morning, later, after dinner)",
    "meals referred to as breakfast, lunch, dinner",
    "severity words like slight, pretty bad, unbearable, killing me",
    "typos in food or medicine names",
    "water intake and hydration",
    "period or cycle related notes",
    "a symptom happening right now",
]


def random_when(rng: random.Random) -> datetime:
    day = datetime(2025, 6, 1) + timedelta(days=rng.randrange(0, 480))
    hour = rng.choices(
        [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 0, 1],
        weights=[2, 5, 6, 5, 3, 2, 2, 3, 3, 3, 3, 3, 4, 5, 7, 8, 8, 6, 2, 1],
    )[0]
    return day.replace(hour=hour, minute=rng.choice([0, 5, 10, 15, 20, 30, 40, 45, 50, 55]))


def parse_request_prompt(rng: random.Random, n: int) -> tuple[str, list[str]]:
    persona = rng.choice(PERSONAS)
    styles = rng.sample(STYLES, 3)
    whens = [random_when(rng) for _ in range(n)]
    lines = []
    for i, when in enumerate(whens, 1):
        focus = rng.sample(FOCUS, rng.choice([1, 2]))
        lines.append(f"{i}. Written {describe_when(when)}. Style: {rng.choice(styles)}. Include: {'; '.join(focus)}.")
    prompt = (
        f"Write {n} different health notes by {persona}, one per line below, then label each one.\n"
        "Make them realistic and varied in length (from 8 words to about 80 words). Use a clock time only where it is natural. "
        "Notes should fit the time they were written (a 7am note is about last night and the morning so far).\n\n"
        + "\n".join(lines)
        + "\n\nReturn the notes in the same order. The label must follow the labeling rules exactly, "
        "using the written time for anything that happened 'now'."
    )
    return prompt, [w.isoformat() for w in whens]


PLAN_TOPICS = [
    "food or drink triggers for a symptom", "how often a symptom happens", "how often something is consumed",
    "sleep and how it relates to symptoms", "general check-ins and summaries", "medicine use", "exercise and how it relates to symptoms",
    "questions with time periods (this week, last month, past 3 months)", "voice dictated questions with filler words",
    "short keyword style questions", "questions with typos",
]


def plan_request_prompt(rng: random.Random, n: int) -> str:
    persona = rng.choice(PERSONAS)
    topics = rng.sample(PLAN_TOPICS, 4)
    return (
        f"Write {n} different questions that {persona} might ask about their own health log, and the query plan for each. "
        f"Mix these themes: {', '.join(topics)}. Vary the wording a lot; some casual, some precise. "
        "About half should be 'after' questions. Return question and plan pairs."
    )


PARSE_OUTPUT_SCHEMA = {
    "type": "object",
    "properties": {
        "examples": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {"note": {"type": "string"}, "label": PARSED_LOG_SCHEMA},
                "required": ["note", "label"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["examples"],
    "additionalProperties": False,
}

PLAN_OUTPUT_SCHEMA = {
    "type": "object",
    "properties": {
        "examples": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {"question": {"type": "string"}, "plan": QUERY_PLAN_SCHEMA},
                "required": ["question", "plan"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["examples"],
    "additionalProperties": False,
}

RELABEL_SCHEMA = PARSED_LOG_SCHEMA


def params_for(task: str, prompt: str, effort: str = EFFORT) -> dict:
    system = TEACHER_SYSTEM if task in ("parse", "relabel") else PLAN_TEACHER_SYSTEM
    schema = {"parse": PARSE_OUTPUT_SCHEMA, "plan": PLAN_OUTPUT_SCHEMA, "relabel": RELABEL_SCHEMA}[task]
    return {
        "model": MODEL,
        "max_tokens": 16000,
        # The system prompt is identical for every request, so it is cached.
        "system": [{"type": "text", "text": system, "cache_control": {"type": "ephemeral"}}],
        "messages": [{"role": "user", "content": prompt}],
        "thinking": {"type": "adaptive"},
        "output_config": {"effort": effort, "format": {"type": "json_schema", "schema": schema}},
    }


def build_requests(task: str, split: str, count: int, seed: int, effort: str = EFFORT, per_request: int = NOTES_PER_REQUEST) -> tuple[list[Request], dict]:
    rng = random.Random(seed)
    requests, meta = [], {}
    for i in range(count):
        custom_id = f"{task}-{split}-{seed}-{i}"
        if task == "parse":
            prompt, whens = parse_request_prompt(rng, per_request)
            meta[custom_id] = {"whens": whens}
        else:
            prompt = plan_request_prompt(rng, QUESTIONS_PER_REQUEST)
            meta[custom_id] = {}
        requests.append(Request(custom_id=custom_id, params=MessageCreateParamsNonStreaming(**params_for(task, prompt, effort))))
    return requests, meta


def load_batches() -> list[dict]:
    return json.loads(BATCHES_FILE.read_text()) if BATCHES_FILE.exists() else []


def save_batches(batches: list[dict]) -> None:
    RAW.mkdir(parents=True, exist_ok=True)
    BATCHES_FILE.write_text(json.dumps(batches, indent=2))


def response_json(message) -> dict | None:
    if message.stop_reason in ("refusal", "max_tokens"):
        return None
    text = next((b.text for b in message.content if b.type == "text"), "")
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return None


def usage_cost(usage, batch: bool) -> float:
    pin, pout = (PRICE_IN, PRICE_OUT) if batch else (SYNC_PRICE_IN, SYNC_PRICE_OUT)
    cache_read = getattr(usage, "cache_read_input_tokens", 0) or 0
    cache_write = getattr(usage, "cache_creation_input_tokens", 0) or 0
    return usage.input_tokens * pin + cache_write * pin * 1.25 + cache_read * pin * 0.1 + usage.output_tokens * pout


# ---------------------------------------------------------------------------
# Turning teacher output into training rows


def rows_from_parse(custom_id: str, data: dict, whens: list[str], split: str) -> list[dict]:
    rows = []
    for i, ex in enumerate(data.get("examples", [])[: len(whens)]):
        note = (ex.get("note") or "").strip()
        if not note:
            continue
        label = sanitize_log(ex.get("label"))
        rows.append({"id": f"{custom_id}-{i}", "split": split, "written_at": whens[i], "note": note, "label": label})
    return rows


def rows_from_plan(custom_id: str, data: dict, split: str) -> list[dict]:
    rows = []
    for i, ex in enumerate(data.get("examples", [])):
        q = (ex.get("question") or "").strip()
        if q:
            rows.append({"id": f"{custom_id}-{i}", "split": split, "question": q, "plan": sanitize_plan(ex.get("plan"))})
    return rows


# ---------------------------------------------------------------------------
# Commands


def cmd_pilot(args, client: anthropic.Anthropic) -> None:
    requests, meta = build_requests(args.task, "pilot", args.requests, seed=args.seed, effort=args.effort, per_request=args.per_request)
    total_cost, rows = 0.0, []
    for req in requests:
        start = time.time()
        # Synchronous requests can use server-side fallbacks (the Batches API cannot).
        msg = client.beta.messages.create(
            **req["params"], betas=["server-side-fallback-2026-07-01"], extra_body={"fallbacks": "default"}
        )
        cost = usage_cost(msg.usage, batch=False)
        total_cost += cost
        data = response_json(msg)
        print(
            f"{req['custom_id']}: {time.time() - start:.0f}s stop={msg.stop_reason} in={msg.usage.input_tokens} "
            f"cache_w={msg.usage.cache_creation_input_tokens} cache_r={msg.usage.cache_read_input_tokens} "
            f"out={msg.usage.output_tokens} cost=${cost:.3f}"
        )
        if data is None:
            continue
        if args.task == "parse":
            rows += rows_from_parse(req["custom_id"], data, meta[req["custom_id"]]["whens"], "pilot")
        else:
            rows += rows_from_plan(req["custom_id"], data, "pilot")
    write_jsonl(RAW / f"pilot_{args.task}_{args.effort}_{args.per_request}.jsonl", rows)
    per_item = total_cost / max(len(rows), 1)
    print(f"\n{len(rows)} examples, ${total_cost:.3f} at synchronous prices, ${per_item:.4f} each.")
    print(f"At Batch API prices (half): about ${per_item / 2:.4f} per example.")


def cmd_submit(args, client: anthropic.Anthropic) -> None:
    requests, meta = build_requests(args.task, args.split, args.requests, seed=args.seed, effort=args.effort, per_request=args.per_request)
    batch = client.messages.batches.create(requests=requests)
    batches = load_batches()
    batches.append(
        {"id": batch.id, "task": args.task, "split": args.split, "requests": args.requests, "seed": args.seed, "meta": meta, "collected": False}
    )
    save_batches(batches)
    print(f"Submitted batch {batch.id} with {args.requests} requests ({args.task}/{args.split}).")


def cmd_status(args, client: anthropic.Anthropic) -> None:
    for b in load_batches():
        info = client.messages.batches.retrieve(b["id"])
        c = info.request_counts
        print(
            f"{b['id']} {b['task']}/{b['split']}: {info.processing_status} "
            f"(processing {c.processing}, ok {c.succeeded}, errored {c.errored}, expired {c.expired})"
            + (" collected" if b.get("collected") else "")
        )


def cmd_collect(args, client: anthropic.Anthropic) -> None:
    batches = load_batches()
    for b in batches:
        if b.get("collected"):
            continue
        info = client.messages.batches.retrieve(b["id"])
        if info.processing_status != "ended":
            print(f"{b['id']} still {info.processing_status}")
            continue
        rows, cost, failed = [], 0.0, 0
        for result in client.messages.batches.results(b["id"]):
            if result.result.type != "succeeded":
                failed += 1
                continue
            msg = result.result.message
            cost += usage_cost(msg.usage, batch=True)
            data = response_json(msg)
            if data is None:
                failed += 1
                continue
            cid = result.custom_id
            if b["task"] == "parse":
                rows += rows_from_parse(cid, data, b["meta"][cid]["whens"], b["split"])
            elif b["task"] == "plan":
                rows += rows_from_plan(cid, data, b["split"])
            else:  # relabel
                rows.append({"id": cid.removeprefix("relabel-"), "label2": sanitize_log(data)})
        out = RAW / f"{b['task']}_{b['split']}_{b['id']}.jsonl"
        write_jsonl(out, rows)
        b["collected"] = True
        b["cost"] = round(cost, 2)
        print(f"{b['id']}: {len(rows)} rows -> {out.name}, {failed} failed requests, ${cost:.2f}")
    save_batches(batches)
    merge_outputs()


def cmd_relabel(args, client: anthropic.Anthropic) -> None:
    """Second, independent labeling of eval notes. Only notes where both labels agree are kept."""
    rows = [r for f in sorted(RAW.glob(f"parse_{args.split}_*.jsonl")) for r in read_jsonl(f)]
    requests = []
    for r in rows:
        when = datetime.fromisoformat(r["written_at"])
        prompt = f"Label this note, written {describe_when(when)}, following the labeling rules exactly.\n\nNote:\n{r['note']}"
        requests.append(Request(custom_id=f"relabel-{r['id']}", params=MessageCreateParamsNonStreaming(**params_for("relabel", prompt))))
    batch = client.messages.batches.create(requests=requests)
    batches = load_batches()
    batches.append({"id": batch.id, "task": "relabel", "split": args.split, "requests": len(requests), "meta": {}, "collected": False})
    save_batches(batches)
    print(f"Submitted relabel batch {batch.id} with {len(requests)} notes.")


def merge_outputs() -> None:
    """Writes data/parse_{split}.jsonl and data/plan_{split}.jsonl from everything collected."""
    for split in ("train", "eval"):
        parse_rows = [r for f in sorted(RAW.glob(f"parse_{split}_*.jsonl")) for r in read_jsonl(f)]
        if split == "eval":
            second = {r["id"]: r["label2"] for f in sorted(RAW.glob("relabel_eval_*.jsonl")) for r in read_jsonl(f)}
            if second:
                agreed = [r for r in parse_rows if r["id"] in second and score_log(second[r["id"]], r["label"])["exact"] == 1]
                print(f"eval: {len(agreed)} of {len(parse_rows)} notes had matching independent labels")
                parse_rows = agreed
        if parse_rows:
            write_jsonl(DATA / f"parse_{split}.jsonl", parse_rows)
            print(f"data/parse_{split}.jsonl: {len(parse_rows)} examples")
        plan_rows = [r for f in sorted(RAW.glob(f"plan_{split}_*.jsonl")) for r in read_jsonl(f)]
        if plan_rows:
            write_jsonl(DATA / f"plan_{split}.jsonl", plan_rows)
            print(f"data/plan_{split}.jsonl: {len(plan_rows)} examples")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("pilot")
    p.add_argument("--task", choices=["parse", "plan"], default="parse")
    p.add_argument("--requests", type=int, default=2)
    p.add_argument("--seed", type=int, default=7)
    p.add_argument("--effort", default=EFFORT)
    p.add_argument("--per-request", type=int, default=NOTES_PER_REQUEST)
    s = sub.add_parser("submit")
    s.add_argument("--task", choices=["parse", "plan"], required=True)
    s.add_argument("--split", choices=["train", "eval"], required=True)
    s.add_argument("--requests", type=int, required=True)
    s.add_argument("--seed", type=int)
    s.add_argument("--effort", default=EFFORT)
    s.add_argument("--per-request", type=int, default=NOTES_PER_REQUEST)
    sub.add_parser("status")
    sub.add_parser("collect")
    r = sub.add_parser("relabel")
    r.add_argument("--split", default="eval")
    args = parser.parse_args()
    if getattr(args, "seed", 0) is None:
        # Different default seeds keep train and eval notes apart.
        args.seed = {"train": 1000, "eval": 2000}[args.split] + (0 if args.task == "parse" else 500)

    client = anthropic.Anthropic()
    {"pilot": cmd_pilot, "submit": cmd_submit, "status": cmd_status, "collect": cmd_collect, "relabel": cmd_relabel}[args.cmd](args, client)


if __name__ == "__main__":
    sys.exit(main())
