# Health Scribe

Private, on-device health logging by voice. Speak or type messy daily notes (food, symptoms, activity, sleep) and a small AI model running entirely in your browser turns them into structured logs you can ask questions about.

Your notes, voice and health data never leave your device. There is no server, no account and no analytics.

**Status:** Early prototype, in development.

Live app: https://whiteshadow98.github.io/health-scribe/

## Requirements

- Android 12+ with a recent version of Chrome (WebGPU support)
- About 1.2 GB of free storage for the on-device models (downloaded once)

## Development

```bash
npm install
npm run dev
npm run build
```

Pushing to `main` deploys to GitHub Pages via GitHub Actions.
