#!/bin/zsh
# Trains v3 from scratch on the full data, then fuses, converts and runs the browser test.
cd "$(dirname "$0")"
S=/private/tmp/claude-501/-Users-shubham-Desktop/e62802e2-8100-4d43-9b5d-85e96ec008d3/scratchpad
.venv/bin/python -m mlx_lm lora -c lora_config_v3.yaml --iters 1500 2>&1 | grep --line-buffered -E "Iter|Error|error|Traceback|Saved final" > train-v3.log
echo "TRAINING_EXITED" >> train-v3.log
if ! grep -q "Saved final" train-v3.log; then echo "V3_FAILED" > post-v3.log; exit 1; fi
{
  rm -rf models/fused-v3 models/mlc-v3
  .venv/bin/python -m mlx_lm fuse --model models/base-1.5b --adapter-path adapters/v3 --save-path models/fused-v3
  .venv/bin/python mlc_convert.py convert --hf models/fused-v3 --official models/official-mlc --out models/mlc-v3
  mkdir -p $S/serve/v3/resolve && ln -sfn $PWD/models/mlc-v3 $S/serve/v3/resolve/main
  curl -sf -o /dev/null http://127.0.0.1:8123/harness.html || (nohup python3 $S/serve/server.py $S/serve >/dev/null 2>&1 &)
  sleep 3
  cd $S/e2e && node browser_eval.mjs finetuned http://127.0.0.1:8123/v3 quantity v3
} > post-v3.log 2>&1
echo "POST_V3_DONE" >> $PWD/post-v3.log
