"""Shared pieces for the training pipeline: prompts, schemas, sanitizing and scoring.

The prompts come from src/lib/prompts.json so the fine-tuned model is trained on exactly
the instructions the app sends it.
"""

from __future__ import annotations

import json
import re
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent
APP_ROOT = ROOT.parent
DATA = ROOT / "data"

PROMPTS = json.loads((APP_ROOT / "src/lib/prompts.json").read_text())
PARSE_SYSTEM: str = PROMPTS["parse_system"]
PLAN_SYSTEM: str = PROMPTS["plan_system"]

INTAKE_CATEGORIES = ["food", "beverage", "medication"]
SEVERITIES = ["mild", "moderate", "severe"]
QUERY_KINDS = ["after", "frequency", "sleep", "overview", "nutrition"]
UNITS = ["", "bowl", "plate", "cup", "glass", "bottle", "slice", "scoop", "spoon", "peg", "pint", "packet", "serving",
         "tablet", "capsule", "g", "ml", "l"]

# ---------------------------------------------------------------------------
# Schemas for the teacher (Claude structured outputs: every object needs
# additionalProperties false and a full required list).


def _obj(props: dict) -> dict:
    return {"type": "object", "properties": props, "required": list(props), "additionalProperties": False}


PARSED_LOG_SCHEMA = _obj(
    {
        "intake": {
            "type": "array",
            "items": _obj(
                {
                    "item": {"type": "string"},
                    "quantity": {"anyOf": [{"type": "number"}, {"type": "null"}]},
                    "unit": {"type": "string", "enum": UNITS},
                    "category": {"type": "string", "enum": INTAKE_CATEGORIES},
                    "time": {"type": "string"},
                }
            ),
        },
        "activities": {
            "type": "array",
            "items": _obj(
                {
                    "type": {"type": "string"},
                    "duration_mins": {"anyOf": [{"type": "integer"}, {"type": "null"}]},
                    "time": {"type": "string"},
                }
            ),
        },
        "symptoms": {
            "type": "array",
            "items": _obj(
                {
                    "type": {"type": "string"},
                    "severity": {"type": "string", "enum": SEVERITIES},
                    "location": {"type": "string"},
                    "time": {"type": "string"},
                }
            ),
        },
        "sleep_hours": {"anyOf": [{"type": "number"}, {"type": "null"}]},
        "general_notes": {"type": "string"},
    }
)

QUERY_PLAN_SCHEMA = _obj(
    {
        "kind": {"type": "string", "enum": QUERY_KINDS},
        "trigger": {"type": "string"},
        "subject": {"type": "string"},
        "window_hours": {"type": "integer"},
        "days": {"type": "integer"},
    }
)

# ---------------------------------------------------------------------------
# Formatting that must match the app exactly.


def describe_when(when: datetime) -> str:
    """Same text as describeWhen() in src/lib/parse.ts (en-US toLocaleString)."""
    hour = when.hour % 12 or 12
    suffix = "AM" if when.hour < 12 else "PM"
    return f"{when:%A}, {when:%B} {when.day}, {when.year} at {hour}:{when.minute:02d} {suffix}"


def parse_user_message(note: str, when: datetime) -> str:
    return f"Note written {describe_when(when)}:\n{note.strip()}"


def to_app_json(value: dict) -> str:
    """Compact JSON with the app's key order, like JSON.stringify in the browser."""
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


# ---------------------------------------------------------------------------
# Sanitizing (mirrors sanitizeParsedLog in src/lib/schema.ts)

_TIME = re.compile(r"^(\d{1,2}):(\d{2})$")


def _s(v) -> str:
    return v.strip() if isinstance(v, str) else ""


def _time(v) -> str:
    m = _TIME.match(_s(v))
    if not m:
        return ""
    h, mi = int(m.group(1)), int(m.group(2))
    if h > 23 or mi > 59:
        return ""
    return f"{h:02d}:{mi:02d}"


def _num(v, max_value: float):
    if v is None or v == "" or isinstance(v, bool):
        return None
    try:
        n = float(v)
    except (TypeError, ValueError):
        return None
    if n < 0 or n > max_value:
        return None
    n = round(n * 10) / 10
    return int(n) if n == int(n) else n


def _enum(v, allowed, fallback):
    s = _s(v).lower()
    return s if s in allowed else fallback


def _arr(v) -> list[dict]:
    return [x for x in v if isinstance(x, dict)] if isinstance(v, list) else []


def sanitize_log(raw) -> dict:
    obj = raw if isinstance(raw, dict) else {}
    return {
        "intake": [
            {
                "item": _s(i.get("item")),
                "quantity": _num(i.get("quantity"), 5000),
                "unit": _enum(i.get("unit"), UNITS, ""),
                "category": _enum(i.get("category"), INTAKE_CATEGORIES, "food"),
                "time": _time(i.get("time")),
            }
            for i in _arr(obj.get("intake"))
            if _s(i.get("item"))
        ],
        "activities": [
            {"type": _s(a.get("type")), "duration_mins": _int_or_none(_num(a.get("duration_mins"), 24 * 60)), "time": _time(a.get("time"))}
            for a in _arr(obj.get("activities"))
            if _s(a.get("type"))
        ],
        "symptoms": [
            {
                "type": _s(s.get("type")),
                "severity": _enum(s.get("severity"), SEVERITIES, "mild"),
                "location": _s(s.get("location")),
                "time": _time(s.get("time")),
            }
            for s in _arr(obj.get("symptoms"))
            if _s(s.get("type"))
        ],
        "sleep_hours": _num(obj.get("sleep_hours"), 24),
        "general_notes": _s(obj.get("general_notes")),
    }


def _int_or_none(v):
    return None if v is None else int(round(v))


def sanitize_plan(raw) -> dict:
    obj = raw if isinstance(raw, dict) else {}
    kind = obj.get("kind") if obj.get("kind") in QUERY_KINDS else "overview"
    try:
        window = int(obj.get("window_hours"))
    except (TypeError, ValueError):
        window = 6
    try:
        days = int(obj.get("days"))
    except (TypeError, ValueError):
        days = 0
    subject = _s(obj.get("subject")).lower()
    if kind == "nutrition" and not subject:
        subject = "all"
    return {
        "kind": kind,
        "trigger": _s(obj.get("trigger")).lower(),
        "subject": subject,
        "window_hours": window if 0 < window <= 48 else 6,
        "days": days if 0 < days <= 3650 else 0,
    }


# ---------------------------------------------------------------------------
# Scoring parsed logs against a reference

_WORD = re.compile(r"[a-z0-9]+")


def _tokens(s: str) -> set[str]:
    return {w for w in _WORD.findall(s.lower()) if len(w) > 1}


def _name_match(a: str, b: str) -> bool:
    a, b = a.lower().strip(), b.lower().strip()
    if a == b:
        return True
    ta, tb = _tokens(a), _tokens(b)
    if not ta or not tb:
        return False
    # Same item if one name's words are all in the other ("espresso" vs "double espresso").
    return ta <= tb or tb <= ta


def _match_lists(pred: list[dict], ref: list[dict], key: str):
    """Greedy one-to-one matching by name. Returns matched pairs."""
    used: set[int] = set()
    pairs = []
    for r in ref:
        for j, p in enumerate(pred):
            if j not in used and _name_match(p[key], r[key]):
                used.add(j)
                pairs.append((p, r))
                break
    return pairs


# Attributes compared on matched intake items. Quantity/unit are skipped for labels made
# before those fields existed, so old and new results stay comparable.
INTAKE_ATTRS = ("category", "time", "quantity", "unit")


def score_log(pred: dict, ref: dict) -> dict:
    """Counts for precision/recall of items, plus attribute accuracy on matched items."""
    pred, ref = sanitize_log(pred), sanitize_log(ref)
    out: dict[str, float] = {}
    for field, key, attrs in (
        ("intake", "item", INTAKE_ATTRS),
        ("activities", "type", ("duration_mins", "time")),
        ("symptoms", "type", ("severity", "location", "time")),
    ):
        pairs = _match_lists(pred[field], ref[field], key)
        out[f"{field}_tp"] = len(pairs)
        out[f"{field}_pred"] = len(pred[field])
        out[f"{field}_ref"] = len(ref[field])
        for attr in attrs:
            out[f"{field}_{attr}_ok"] = sum(
                1 for p, r in pairs if str(p.get(attr, "")).lower() == str(r.get(attr, "")).lower()
            )
        out[f"{field}_matched"] = len(pairs)
    ps, rs = pred["sleep_hours"], ref["sleep_hours"]
    out["sleep_ok"] = int((ps is None and rs is None) or (ps is not None and rs is not None and abs(ps - rs) <= 0.25))
    strict = all(
        out[f"{f}_tp"] == out[f"{f}_pred"] == out[f"{f}_ref"]
        and all(out[f"{f}_{a}_ok"] == out[f"{f}_matched"] for a in attrs)
        for f, attrs in (("intake", INTAKE_ATTRS), ("activities", ("duration_mins", "time")), ("symptoms", ("severity", "location", "time")))
    )
    out["exact"] = int(strict and out["sleep_ok"] == 1)
    return out


def summarize_scores(rows: list[dict]) -> dict:
    """Aggregates score_log rows into readable percentages."""
    total = {k: sum(r[k] for r in rows) for k in rows[0]} if rows else {}
    n = len(rows)

    def pct(a, b):
        return round(100 * a / b, 1) if b else 100.0

    summary = {"notes": n, "exact_match_%": pct(total.get("exact", 0), n), "sleep_%": pct(total.get("sleep_ok", 0), n)}
    for field, attrs in (("intake", INTAKE_ATTRS), ("activities", ("duration_mins", "time")), ("symptoms", ("severity", "location", "time"))):
        if f"{field}_{attrs[-1]}_ok" not in total:
            continue
        p = pct(total[f"{field}_tp"], total[f"{field}_pred"])
        r = pct(total[f"{field}_tp"], total[f"{field}_ref"])
        f1 = round(2 * p * r / (p + r), 1) if p + r else 0.0
        summary[f"{field}_F1"] = f1
        for a in attrs:
            summary[f"{field}_{a}_%"] = pct(total[f"{field}_{a}_ok"], total[f"{field}_matched"])
    return summary


def read_jsonl(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]


def write_jsonl(path: Path, rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows))
