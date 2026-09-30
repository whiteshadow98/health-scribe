"""Adds "quantity" and "unit" to intake items in notes labeled before those fields existed.

  python backfill_quantities.py --dry-run   # print what it would set, for review
  python backfill_quantities.py             # write the updated labels

Amounts are read from the words just before an item's mention ("2 roti", "a glass of lassi",
"200g paneer", "3 cups of filter coffee") or just after it ("tea x2", "chai twice").
Items with no amount get quantity null and unit "". Labels that already have a quantity
field are left alone. Overrides for cases the rules get wrong live in QUANTITY_OVERRIDES.
"""

from __future__ import annotations

import argparse
import difflib
import json
import re
from pathlib import Path

from common import DATA, read_jsonl, write_jsonl

UNIT_WORDS = {
    "bowl": "bowl", "bowls": "bowl", "katori": "bowl", "katoris": "bowl",
    "plate": "plate", "plates": "plate", "thali": "plate",
    "cup": "cup", "cups": "cup", "mug": "cup", "mugs": "cup",
    "glass": "glass", "glasses": "glass",
    "bottle": "bottle", "bottles": "bottle", "botle": "bottle", "botles": "bottle",
    "slice": "slice", "slices": "slice",
    "scoop": "scoop", "scoops": "scoop",
    "spoon": "spoon", "spoons": "spoon", "tbsp": "spoon", "tsp": "spoon", "tablespoon": "spoon", "teaspoon": "spoon",
    "peg": "peg", "pegs": "peg",
    "pint": "pint", "pints": "pint",
    "packet": "packet", "packets": "packet", "pack": "packet", "pkt": "packet",
    "serving": "serving", "servings": "serving",
    "tablet": "tablet", "tablets": "tablet", "tab": "tablet", "tabs": "tablet", "pill": "tablet", "pills": "tablet",
    "capsule": "capsule", "capsules": "capsule",
    "g": "g", "gm": "g", "gms": "g", "gram": "g", "grams": "g",
    "ml": "ml",
    "l": "l", "ltr": "l", "ltrs": "l", "litre": "l", "litres": "l", "liter": "l", "liters": "l",
    "quarter": "serving", "shot": "peg", "shots": "peg", "can": "bottle", "cans": "bottle",
}
# Count words that mean "pieces": they don't set a unit.
PIECE_WORDS = {"piece", "pieces", "pcs", "pc"}
NUMBER_WORDS = {
    "a": 1, "an": 1, "one": 1, "ek": 1, "single": 1, "two": 2, "couple": 2, "three": 3, "teen": 3, "four": 4,
    "five": 5, "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10, "twelve": 12, "dozen": 12, "half": 0.5,
    "aadha": 0.5, "adha": 0.5,
}
FILLER = {"of", "big", "small", "large", "medium", "little", "full", "hot", "cold", "warm", "whole", "tiny", "teeny", "more",
          "extra", "plain", "my", "the", "whole", "sa", "si", "ki", "ka", "ke", "wala", "wali", "bada", "chota"}
STOP = {",", ".", ";", ":", "and", "n", "aur", "&", "+", "with", "w/", "then", "also", "after", "before", "b4", "for", "at", "!"}
TIME_WORDS = {"am", "pm", "baje", "hrs", "hr", "hours", "hour", "mins", "min", "minutes", "days", "day", "k"}

TOKEN = re.compile(r"\d+(?:\.\d+)?|[a-z]+(?:[-'][a-z]+)*|[^\sa-z\d]")
GLUED = re.compile(r"^(\d+(?:\.\d+)?)(g|gm|gms|ml|l|ltr|kg)$")

# Hand-checked fixes for cases the rules misread: (note id, item) -> (quantity, unit).
QUANTITY_OVERRIDES: dict[tuple[str, str], tuple[float | None, str]] = {
    ("session-9-2-1", "combiflam"): (2, ""),  # "one combiflam at 8 and another at 2"
}


def tokenize(note: str) -> list[str]:
    tokens = []
    for t in re.findall(r"\S+", note.lower()):
        glued = GLUED.match(t.strip(".,!;"))
        if glued:
            tokens += [glued.group(1), glued.group(2)]
        else:
            tokens += TOKEN.findall(t)
    return tokens


def word_matches(word: str, token: str) -> bool:
    if word == token or token.startswith(word) or (len(token) >= 3 and word.startswith(token) and len(word) - len(token) <= 3):
        return True
    return len(word) > 3 and difflib.SequenceMatcher(None, word, token).ratio() >= 0.75


def find_mention(tokens: list[str], item: str) -> int | None:
    words = [w for w in re.findall(r"[a-z0-9]+", item.lower()) if len(w) > 1]
    if not words:
        return None
    for w in words[:1] + words[1:]:
        for i, t in enumerate(tokens):
            if word_matches(w, t):
                return i
    return None


def to_number(token: str) -> float | None:
    if re.fullmatch(r"\d+(?:\.\d+)?", token):
        return float(token)
    return NUMBER_WORDS.get(token)


def amount_before(tokens: list[str], idx: int) -> tuple[float | None, str]:
    unit, quantity = "", None
    j = idx - 1
    steps = 0
    while j >= 0 and steps < 6:
        t = tokens[j]
        if t in STOP:
            break
        if t in UNIT_WORDS and not unit:
            unit = UNIT_WORDS[t]
        elif t in PIECE_WORDS or t in FILLER:
            pass
        else:
            n = to_number(t)
            if n is not None:
                prev = tokens[j - 1] if j > 0 else ""
                nxt = tokens[j + 1] if j + 1 < len(tokens) else ""
                # Clock times ("at 9", "~9", "7:30", "9ish") are not amounts.
                if prev in {"at", "by", "around", "bout", "till", "since", "~", ":"} or nxt in TIME_WORDS | {":", "ish"}:
                    break
                if t in {"a", "an"} and nxt in {"little", "bit", "few", "lot", "lil"}:
                    break  # "a little ghee" is a vague amount, not one
                quantity = n
                break
            if unit or t not in NUMBER_WORDS:
                # An unrelated word (a verb or another food): only accept a unit already seen.
                if not unit:
                    break
        j -= 1
        steps += 1
    if quantity is None:
        return None, ""
    return quantity, unit


def amount_after(tokens: list[str], idx: int) -> tuple[float | None, str]:
    window = tokens[idx + 1 : idx + 5]
    for k, t in enumerate(window):
        if t in STOP - {"at"}:
            break
        m = re.fullmatch(r"x(\d+)", t)
        if m:
            return float(m.group(1)), "serving" if int(m.group(1)) > 1 else ""
        if t == "x" and k + 1 < len(window) and window[k + 1].isdigit():
            return float(window[k + 1]), ""
        if t == "twice":
            return 2.0, "serving"
    return None, ""


def backfill_label(note: str, label: dict, note_id: str) -> tuple[dict, list[str]]:
    tokens = tokenize(note)
    log = []
    for item in label["intake"]:
        if "quantity" in item:
            continue
        key = (note_id, item["item"])
        if key in QUANTITY_OVERRIDES:
            q, u = QUANTITY_OVERRIDES[key]
        else:
            idx = find_mention(tokens, item["item"])
            q, u = (None, "")
            if idx is not None:
                q, u = amount_before(tokens, idx)
                if q is None:
                    q, u = amount_after(tokens, idx)
        if q is not None and q == int(q):
            q = int(q)
        # Keep the field order the app uses: item, quantity, unit, category, time.
        rest = {k: item[k] for k in ("category", "time")}
        item.clear()
        item.update({"item": key[1], "quantity": q, "unit": u, **rest})
        if q is not None:
            log.append(f"{q} {u or '·'} {key[1]}")
    return label, log


def process(path: Path, dry_run: bool, show: bool) -> int:
    rows = read_jsonl(path)
    changed = 0
    for r in rows:
        label, log = backfill_label(r["note"], r["label"], r["id"])
        if log and show:
            print(f"{r['id']}: {r['note'][:110]}\n    -> {'; '.join(log)}")
        changed += bool(log)
    if not dry_run:
        write_jsonl(path, rows)
    return changed


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--quiet", action="store_true")
    args = parser.parse_args()
    files = sorted((DATA / "raw" / "session").glob("chunk_*.jsonl")) + [DATA / "parse_eval.jsonl", DATA / "raw" / "parse_eval_sync.jsonl"]
    total = 0
    for f in files:
        total += process(f, args.dry_run, not args.quiet)
    print(f"notes with at least one amount: {total}")


if __name__ == "__main__":
    main()
