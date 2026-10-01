#!/bin/zsh
# Evaluates the v3 checkpoint at step 750 (lowest validation loss) after the final v3 test finishes.
cd "$(dirname "$0")"
S=/private/tmp/claude-501/-Users-shubham-Desktop/e62802e2-8100-4d43-9b5d-85e96ec008d3/scratchpad
until grep -q "POST_V3_DONE" post-v3.log 2>/dev/null; do sleep 30; done
{
  rm -rf models/fused-v3-750 models/mlc-v3-750
  .venv/bin/python -m mlx_lm fuse --model models/base-1.5b --adapter-path adapters/v3-750 --save-path models/fused-v3-750
  .venv/bin/python mlc_convert.py convert --hf models/fused-v3-750 --official models/official-mlc --out models/mlc-v3-750
  mkdir -p $S/serve/v3-750/resolve && ln -sfn $PWD/models/mlc-v3-750 $S/serve/v3-750/resolve/main
  cd $S/e2e && node browser_eval.mjs finetuned http://127.0.0.1:8123/v3-750 quantity v3-750
} > post-v3-750.log 2>&1
echo "POST_V3_750_DONE" >> /Users/shubham/Desktop/health-scribe/training/post-v3-750.log
