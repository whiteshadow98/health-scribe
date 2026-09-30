"""Uploads a converted model folder to Hugging Face so the app can download it.

  python publish_hf.py --folder models/mlc-v2 --repo whiteshadow98/health-scribe-qwen2.5-1.5b-q4f16_1-MLC

Reads HF_TOKEN from training/.env. The repo is public because WebLLM downloads it without
authentication. It contains only model weights trained on synthetic notes, no personal data.
"""

from __future__ import annotations

import argparse
import os
from pathlib import Path

from dotenv import load_dotenv
from huggingface_hub import HfApi

ROOT = Path(__file__).resolve().parent
load_dotenv(ROOT / ".env")

MODEL_CARD = """---
license: apache-2.0
base_model: Qwen/Qwen2.5-1.5B-Instruct
language:
  - en
  - hi
tags:
  - mlc-llm
  - web-llm
  - health
  - structured-extraction
---

# Health Scribe: Qwen2.5 1.5B (q4f16_1, MLC)

A LoRA fine-tune of [Qwen2.5-1.5B-Instruct](https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct) for
[Health Scribe](https://github.com/whiteshadow98/health-scribe), a private health journal that runs entirely in the
browser with [WebLLM](https://github.com/mlc-ai/web-llm).

It does two narrow jobs:

1. **Note to JSON.** Turns an informal daily note (English, Hinglish, voice-dictated, typo-heavy) into structured
   JSON: food, drink and medicine with amounts, activities, symptoms with severity, sleep and times.
2. **Question to query plan.** Turns a question about the log ("does chai give me acidity?", "am I getting enough
   protein?") into a small JSON query that app code answers.

Weights are quantized to `q4f16_1` in the same layout as `mlc-ai/Qwen2.5-1.5B-Instruct-q4f16_1-MLC`, so the prebuilt
WebLLM Qwen2 WebGPU library runs them unchanged.

## Training data

About 1,000 synthetic notes (roughly 80% set in India: regional foods, Indian medicine brands, Hinglish) and about
1,100 synthetic questions, written and labeled by Claude (Anthropic) following a fixed labeling rulebook, plus
label-preserving augmentations. No real user data was used.

## Limitations

Not a medical device and not medical advice. It extracts what a note says; it does not diagnose. Labels follow
the app's conventions (for example breakfast is logged at 08:00 when no time is given).
"""


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--folder", required=True)
    parser.add_argument("--repo", required=True)
    args = parser.parse_args()

    folder = ROOT / args.folder
    (folder / "README.md").write_text(MODEL_CARD)
    api = HfApi(token=os.environ["HF_TOKEN"])
    api.create_repo(args.repo, repo_type="model", private=False, exist_ok=True)
    api.upload_folder(folder_path=str(folder), repo_id=args.repo, repo_type="model", commit_message="Upload Health Scribe model")
    print(f"https://huggingface.co/{args.repo}")


if __name__ == "__main__":
    main()
