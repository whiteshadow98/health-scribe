#!/bin/zsh
# After v2 training: fuse, convert to WebLLM format, serve locally and run the browser test.
cd "$(dirname "$0")"
S=/private/tmp/claude-501/-Users-shubham-Desktop/e62802e2-8100-4d43-9b5d-85e96ec008d3/scratchpad
until grep -q "TRAINING_EXITED" train-v2.log; do sleep 30; done
if ! grep -q "Saved final" train-v2.log; then echo "V2_FAILED" > post-v2.log; exit 1; fi
{
  rm -rf models/fused-v2 models/mlc-v2
  .venv/bin/python -m mlx_lm fuse --model models/base-1.5b --adapter-path adapters/v2 --save-path models/fused-v2
  .venv/bin/python mlc_convert.py convert --hf models/fused-v2 --official models/official-mlc --out models/mlc-v2
  mkdir -p $S/serve/v2/resolve && ln -sfn $PWD/models/mlc-v2 $S/serve/v2/resolve/main
  curl -sf -o /dev/null http://127.0.0.1:8123/harness.html || (nohup python3 $S/serve/server.py $S/serve >/dev/null 2>&1 &)
  sleep 3
  cd $S/e2e && node browser_eval.mjs finetuned http://127.0.0.1:8123/v2 quantity v2
} > post-v2.log 2>&1
echo "POST_V2_DONE" >> $PWD/post-v2.log
