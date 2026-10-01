# Health Scribe

Private, on-device health logging by voice. Speak or type messy daily notes (food, symptoms, activity, sleep, in English or Hinglish) and a small AI model running entirely in your browser turns them into structured logs, estimates their nutrition and answers questions about patterns.

Your notes, voice and health data never leave your device. There is no server, no account and no analytics. The only network use is the one-time download of the AI models.

Live app: https://whiteshadow98.github.io/health-scribe/

## What it does

- **Log Entry:** type or tap the mic and speak. Offline speech-to-text (Whisper) and an on-device language model extract food, drink and medicine with amounts, activities, symptoms with severity, sleep and times.
- **History:** a timeline grouped by day with search, filters, edits and nutrition estimates per entry.
- **Insights:** a 7-day nutrition summary against ICMR-NIN daily targets, plus questions like "does chai give me acidity?" or "am I getting enough protein this week?". App code computes every number; the model only interprets the question and writes a short summary.
- **Offline:** installs to the home screen and works in airplane mode after the first model download.
- **Backup:** export and import your data as a JSON file.

## Requirements

- Android 12+ with a recent version of Chrome (WebGPU), or a desktop browser with WebGPU
- About 1.2 GB of free storage for the on-device models (downloaded once)

## How it works

| Piece | Runs where | Notes |
|---|---|---|
| Language model | Browser, WebGPU (WebLLM) | Qwen2.5 1.5B fine-tuned for this app, 4-bit, about 880 MB |
| Speech-to-text | Browser, WebAssembly (transformers.js) | Whisper base.en, about 105 MB |
| Storage | IndexedDB (Dexie) | Only on this device |
| Nutrition | Bundled food table | About 180 common foods, Indian first; estimates per serving |

## The fine-tuned model

The generic Qwen2.5 1.5B model made frequent mistakes on this task (inventing items and sleep, missing times). The app uses a version fine-tuned by knowledge distillation: a large model (Claude) wrote and labeled about 1,000 realistic synthetic notes and 1,100 questions, mostly Indian, following a fixed rulebook, and the small model was trained on them with LoRA on a Mac (MLX). No real user data was used.

Measured on 160 held-out test notes in Chrome under the same conditions as the app:

| | Generic 1.5B | Fine-tuned v2 |
|---|---|---|
| Notes fully correct | 0% | 21% |
| Food and drink found (F1) | 70 | 92 |
| Symptoms found (F1) | 60 | 85 |
| Symptom severity correct | 49% | 86% |
| Sleep correct | 24% | 96% |
| Amounts and units correct | n/a | 95% / 98% |
| Insights questions fully correct | 41% | 91% |

Known weak spot: in long notes, a bare time like "at 6" is sometimes read as morning when the note means evening.

See [`training/`](training/) for the data generator, labeling rules, training config, evaluation and a WebLLM weight converter (`mlc_convert.py`) verified byte-for-byte against the official MLC files.

## Development

```bash
npm install
npm run dev
npm run build
```

Pushing to `main` deploys to GitHub Pages via GitHub Actions.

Nutrition values are approximate and for tracking trends only. Health Scribe is not a medical device and does not give medical advice.
