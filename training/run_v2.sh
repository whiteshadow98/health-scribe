#!/bin/zsh
# Waits for the v1 browser test to finish (GPU memory), then trains v2.
cd "$(dirname "$0")"
E2E=/private/tmp/claude-501/-Users-shubham-Desktop/e62802e2-8100-4d43-9b5d-85e96ec008d3/scratchpad/e2e
while pgrep -f "browser_eval.mjs" >/dev/null || ! [ -f $E2E/browser-finetuned.json ]; do sleep 20; done
.venv/bin/python -m mlx_lm lora -c lora_config_v2.yaml --iters 1200 2>&1 | grep --line-buffered -E "Iter|Error|error|Traceback|Saved final" > train-v2.log
echo "TRAINING_EXITED" >> train-v2.log
