"""Validates hand-written training chunks (data/raw/session/chunk_*.jsonl) and merges them.

  python validate_session.py

Each row must survive the same sanitizer the app uses without changes, have a valid
written_at, and name intake items that appear in the note (allowing for typo fixes).
Valid rows are merged into data/raw/parse_train_session.jsonl, which generate.py's
merge step and prepare_data.py pick up as training data.
"""

from __future__ import annotations

import difflib
import re
from datetime import datetime

from common import DATA, read_jsonl, sanitize_log, write_jsonl
from generate import merge_outputs

SESSION = DATA / "raw" / "session"


def grounded(item: str, note: str) -> bool:
    """True if some word of the item appears in the note, allowing typo fixes and abbreviations."""
    words = [w for w in re.findall(r"[a-z0-9]+", item.lower()) if len(w) > 2 or any(c.isdigit() for c in w)]
    tokens = re.findall(r"[a-z0-9]+", note.lower())
    for w in words:
        if w in tokens or any(len(t) >= 3 and w.startswith(t) for t in tokens):  # "vit" -> "vitamin"
            return True
        if difflib.get_close_matches(w, tokens, n=1, cutoff=0.7):  # "shwarma" -> "shawarma"
            return True
        if len(w) >= 4 and any(t[:3] == w[:3] and difflib.SequenceMatcher(None, w, t).ratio() >= 0.6 for t in tokens):
            return True  # "idlys" -> "idli"
    return not words


def main() -> None:
    rows, problems = [], 0
    for path in sorted(SESSION.glob("chunk_*.jsonl")):
        for r in read_jsonl(path):
            issues = []
            try:
                datetime.fromisoformat(r["written_at"])
            except (KeyError, ValueError):
                issues.append("bad written_at")
            if sanitize_log(r["label"]) != r["label"]:
                issues.append(f"label changed by sanitizer: {sanitize_log(r['label'])}")
            for i in r["label"]["intake"]:
                if not grounded(i["item"], r["note"]):
                    issues.append(f"intake item not in note: {i['item']}")
            if issues:
                problems += 1
                print(f"{path.name} {r.get('id')}: " + "; ".join(issues))
                continue
            rows.append({**r, "split": "train"})
    ids = [r["id"] for r in rows]
    assert len(ids) == len(set(ids)), "duplicate ids"
    write_jsonl(DATA / "raw" / "parse_train_session.jsonl", rows)
    print(f"{len(rows)} valid rows, {problems} with problems")
    merge_outputs()


if __name__ == "__main__":
    main()
