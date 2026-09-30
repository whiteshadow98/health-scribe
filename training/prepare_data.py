"""Builds the fine-tuning dataset (chat format for mlx-lm) from the teacher's examples.

  python prepare_data.py            # writes data/mlx/{train,valid}.jsonl

Two tasks are mixed into one model:
  - note -> parsed log JSON   (system prompt: parse_system, same user text as the app)
  - question -> query plan    (system prompt: plan_system)

Augmentation creates label-preserving variants of training notes for free:
swapping a food or drink for another of the same kind (in both the note and the label),
moving the note to another date, adding small typos, and lowercasing.
Eval notes are never augmented or used for training.
"""

from __future__ import annotations

import random
import re
from datetime import datetime, timedelta

from common import (
    DATA,
    PARSE_SYSTEM,
    PLAN_SYSTEM,
    parse_user_message,
    read_jsonl,
    to_app_json,
    write_jsonl,
)

SEED = 42
VALID_FRACTION = 0.05

SWAPS = {
    "beverage": [
        "coffee", "black coffee", "latte", "cappuccino", "espresso", "cold brew", "chai", "green tea", "black tea",
        "masala chai", "orange juice", "coconut water", "buttermilk", "lassi", "beer", "red wine", "whisky", "coke",
        "diet coke", "red bull", "protein shake", "smoothie", "milk", "lemonade", "kombucha", "hot chocolate",
    ],
    "food": [
        "oatmeal", "toast", "eggs", "omelette", "poha", "upma", "idli", "dosa", "paratha", "aloo paratha", "roti",
        "dal", "rice", "rajma chawal", "biryani", "paneer tikka", "chole bhature", "khichdi", "samosa", "maggi",
        "pizza", "burger", "fries", "pasta", "chicken sandwich", "salad", "sushi", "ramen", "tacos", "banana",
        "apple", "yogurt", "granola", "cheesecake", "ice cream", "chocolate", "cookies", "chips", "popcorn",
        "fried chicken", "fish curry", "butter chicken", "noodles", "momos", "pav bhaji", "vada pav", "dhokla",
    ],
    "medication": [
        "ibuprofen", "paracetamol", "advil", "tylenol", "crocin", "dolo 650", "aspirin", "cetirizine", "pan d",
        "omeprazole", "digene", "eno", "vitamin d", "vitamin b12", "multivitamin", "iron tablet", "magnesium",
        "melatonin", "probiotic", "zinc", "fish oil", "antacid",
    ],
}

KEYBOARD_NEIGHBORS = dict(zip("qwertyuiopasdfghjklzxcvbnm", "wqeryutoipsadgfhkjlxzvcnbm"))


def word_pattern(text: str) -> re.Pattern:
    return re.compile(rf"(?<![a-z0-9]){re.escape(text)}(?![a-z0-9])", re.IGNORECASE)


def protected_spans(note: str, label: dict) -> list[tuple[int, int]]:
    """Character ranges that must not get typos: anything that appears in the label, and numbers."""
    spans = []
    terms = [i["item"] for i in label["intake"]] + [a["type"] for a in label["activities"]]
    terms += [s["type"] for s in label["symptoms"]] + [s["location"] for s in label["symptoms"]]
    prefixes = {w[:4].lower() for term in terms for w in term.split() if len(w) > 2}
    # Protect every word that starts like a labeled word, which also covers misspellings ("paracetmol").
    spans += [(m.start(), m.end()) for m in re.finditer(r"[A-Za-z]+", note) if m.group(0)[:4].lower() in prefixes]
    spans += [(m.start(), m.end()) for m in re.finditer(r"\d[\d:.,]*\s*(am|pm|hrs?|hours?|mins?|minutes?)?", note, re.IGNORECASE)]
    return spans


def add_typos(note: str, label: dict, rng: random.Random) -> str:
    spans = protected_spans(note, label)
    words = [m for m in re.finditer(r"[A-Za-z]{5,}", note) if not any(a < m.end() and m.start() < b for a, b in spans)]
    if not words:
        return note
    chars = list(note)
    for m in rng.sample(words, min(len(words), rng.choice([1, 1, 2]))):
        pos = rng.randrange(m.start() + 1, m.end() - 1)
        kind = rng.choice(["drop", "swap", "neighbor"])
        if kind == "drop":
            chars[pos] = ""
        elif kind == "swap":
            chars[pos], chars[pos + 1] = chars[pos + 1], chars[pos]
        else:
            c = chars[pos].lower()
            chars[pos] = KEYBOARD_NEIGHBORS.get(c, c)
    return "".join(chars)


def swap_items(note: str, label: dict, rng: random.Random) -> tuple[str, dict] | None:
    """Replaces one or two intake items with others of the same category, in the note and the label."""
    label = {**label, "intake": [dict(i) for i in label["intake"]]}
    candidates = [i for i, item in enumerate(label["intake"]) if len(word_pattern(item["item"]).findall(note)) == 1]
    if not candidates:
        return None
    used = {i["item"] for i in label["intake"]}
    for idx in rng.sample(candidates, min(len(candidates), rng.choice([1, 2]))):
        item = label["intake"][idx]
        options = [o for o in SWAPS[item["category"]] if o not in used]
        new = rng.choice(options)
        match = word_pattern(item["item"]).search(note)
        original = match.group(0)
        replacement = new.capitalize() if original[:1].isupper() else new
        note = note[: match.start()] + replacement + note[match.end() :]
        item["item"] = new
        used.add(new)
    return note, label


def augment(row: dict, rng: random.Random) -> dict | None:
    note, label = row["note"], row["label"]
    changed = False
    if rng.random() < 0.7:
        swapped = swap_items(note, label, rng)
        if swapped:
            note, label = swapped
            changed = True
    if rng.random() < 0.4:
        typo_note = add_typos(note, label, rng)
        changed |= typo_note != note
        note = typo_note
    if rng.random() < 0.2:
        note, changed = note.lower(), True
    when = datetime.fromisoformat(row["written_at"]) + timedelta(days=rng.randrange(-200, 200))
    if not changed:
        return None
    return {**row, "id": row["id"] + "-aug", "note": note, "label": label, "written_at": when.isoformat()}


def parse_example(row: dict) -> dict:
    when = datetime.fromisoformat(row["written_at"])
    return {
        "messages": [
            {"role": "system", "content": PARSE_SYSTEM},
            {"role": "user", "content": parse_user_message(row["note"], when)},
            {"role": "assistant", "content": to_app_json(row["label"])},
        ]
    }


def plan_example(row: dict) -> dict:
    return {
        "messages": [
            {"role": "system", "content": PLAN_SYSTEM},
            {"role": "user", "content": row["question"]},
            {"role": "assistant", "content": to_app_json(row["plan"])},
        ]
    }


def dedupe(rows: list[dict], key: str) -> list[dict]:
    seen, out = set(), []
    for r in rows:
        k = re.sub(r"\W+", " ", r[key].lower()).strip()
        if k not in seen:
            seen.add(k)
            out.append(r)
    return out


def main() -> None:
    rng = random.Random(SEED)
    parse_rows = dedupe(read_jsonl(DATA / "parse_train.jsonl"), "note")
    plan_path = DATA / "plan_train.jsonl"
    plan_rows = dedupe(read_jsonl(plan_path), "question") if plan_path.exists() else []

    # Keep eval notes out of training even if the teacher wrote a near-duplicate.
    eval_notes = {re.sub(r"\W+", " ", r["note"].lower()).strip() for r in read_jsonl(DATA / "parse_eval.jsonl")} if (DATA / "parse_eval.jsonl").exists() else set()
    parse_rows = [r for r in parse_rows if re.sub(r"\W+", " ", r["note"].lower()).strip() not in eval_notes]

    rng.shuffle(parse_rows)
    n_valid = max(1, int(len(parse_rows) * VALID_FRACTION))
    valid_parse, train_parse = parse_rows[:n_valid], parse_rows[n_valid:]
    augmented = [a for a in (augment(r, rng) for r in train_parse) if a]

    rng.shuffle(plan_rows)
    n_valid_plan = max(1, int(len(plan_rows) * VALID_FRACTION)) if plan_rows else 0
    valid_plan, train_plan = plan_rows[:n_valid_plan], plan_rows[n_valid_plan:]

    train = [parse_example(r) for r in train_parse + augmented] + [plan_example(r) for r in train_plan]
    valid = [parse_example(r) for r in valid_parse] + [plan_example(r) for r in valid_plan]
    rng.shuffle(train)
    write_jsonl(DATA / "mlx/train.jsonl", train)
    write_jsonl(DATA / "mlx/valid.jsonl", valid)
    write_jsonl(DATA / "augmented_examples.jsonl", augmented[:50])
    print(f"parse: {len(train_parse)} original + {len(augmented)} augmented train, {len(valid_parse)} valid")
    print(f"plan:  {len(train_plan)} train, {len(valid_plan)} valid")
    print(f"total: {len(train)} train, {len(valid)} valid -> data/mlx/")


if __name__ == "__main__":
    main()
