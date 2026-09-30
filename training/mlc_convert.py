"""Converts a Qwen2.5 checkpoint (Hugging Face safetensors) to WebLLM's q4f16_1 format.

This replaces `mlc_llm convert_weight`, whose macOS build does not run on this machine.
It writes files in exactly the layout of the official mlc-ai/Qwen2.5-*-Instruct-q4f16_1-MLC
repos, so the app can reuse WebLLM's prebuilt Qwen2 WebGPU library.

  python mlc_convert.py verify  --hf models/base-1.5b --official models/official-mlc
  python mlc_convert.py convert --hf models/fused-1.5b --official models/official-mlc --out models/mlc-1.5b

`verify` quantizes the original weights and checks the result against official shards
byte for byte. `convert` reuses the official tensor-cache.json layout (same names, shapes,
offsets and shard split) and fills it with the new weights.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import struct
import sys
from pathlib import Path

import numpy as np

GROUP = 32  # elements per scale
PER_WORD = 8  # 4-bit values per uint32
MAX_INT = 7


def load_safetensors(folder: Path) -> dict[str, np.ndarray]:
    """Loads every tensor as float32 (bf16/f16/f32 supported), without extra dependencies."""
    tensors: dict[str, np.ndarray] = {}
    for path in sorted(folder.glob("*.safetensors")):
        raw = path.read_bytes()
        header_len = struct.unpack("<Q", raw[:8])[0]
        header = json.loads(raw[8 : 8 + header_len])
        base = 8 + header_len
        for name, info in header.items():
            if name == "__metadata__":
                continue
            start, end = info["data_offsets"]
            buf = raw[base + start : base + end]
            if info["dtype"] == "BF16":
                arr = (np.frombuffer(buf, dtype=np.uint16).astype(np.uint32) << 16).view(np.float32)
            elif info["dtype"] == "F16":
                arr = np.frombuffer(buf, dtype=np.float16).astype(np.float32)
            elif info["dtype"] == "F32":
                arr = np.frombuffer(buf, dtype=np.float32).copy()
            else:
                raise ValueError(f"{name}: unsupported dtype {info['dtype']}")
            tensors[name] = arr.reshape(info["shape"])
    return tensors


def quantize(weight: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Symmetric 4-bit group quantization along the input dimension (q4f16_1).

    Matches MLC bit for bit, including its float16 arithmetic: the scale is
    fp16(max_abs * fp16(1/7)), and each value is round_half_even(fp16(fp16(w / scale) + 7)).
    """
    out_dim, in_dim = weight.shape
    w = weight.astype(np.float16).reshape(out_dim, in_dim // GROUP, GROUP)
    max_abs = np.abs(w).max(axis=2).astype(np.float32)
    scale = (max_abs * np.float32(np.float16(1 / MAX_INT))).astype(np.float16)
    divisor = np.where(scale == 0, np.float16(1), scale)[:, :, None].astype(np.float32)
    scaled = (w.astype(np.float32) / divisor).astype(np.float16)
    shifted = (scaled.astype(np.float32) + MAX_INT).astype(np.float16).astype(np.float32)
    q = np.clip(np.round(shifted), 0, 2 * MAX_INT).astype(np.uint32).reshape(out_dim, in_dim // PER_WORD, PER_WORD)
    packed = np.zeros((out_dim, in_dim // PER_WORD), dtype=np.uint32)
    for i in range(PER_WORD):
        packed |= q[:, :, i] << np.uint32(4 * i)
    return packed, scale


def mlc_tensors(hf: dict[str, np.ndarray], num_layers: int) -> dict[str, np.ndarray]:
    """Maps Hugging Face names to MLC names, merging q/k/v and gate/up like MLC does."""
    out: dict[str, np.ndarray] = {}

    def add_quantized(name: str, weight: np.ndarray):
        out[f"{name}.q_weight"], out[f"{name}.q_scale"] = quantize(weight)

    add_quantized("model.embed_tokens", hf["model.embed_tokens.weight"])
    for i in range(num_layers):
        p = f"model.layers.{i}"
        out[f"{p}.input_layernorm.weight"] = hf[f"{p}.input_layernorm.weight"].astype(np.float16)
        out[f"{p}.post_attention_layernorm.weight"] = hf[f"{p}.post_attention_layernorm.weight"].astype(np.float16)
        qkv = np.concatenate([hf[f"{p}.self_attn.{x}_proj.weight"] for x in "qkv"], axis=0)
        add_quantized(f"{p}.self_attn.c_attn", qkv)
        out[f"{p}.self_attn.c_attn.bias"] = np.concatenate([hf[f"{p}.self_attn.{x}_proj.bias"] for x in "qkv"]).astype(np.float16)
        add_quantized(f"{p}.self_attn.o_proj", hf[f"{p}.self_attn.o_proj.weight"])
        gate_up = np.concatenate([hf[f"{p}.mlp.gate_proj.weight"], hf[f"{p}.mlp.up_proj.weight"]], axis=0)
        add_quantized(f"{p}.mlp.gate_up_proj", gate_up)
        add_quantized(f"{p}.mlp.down_proj", hf[f"{p}.mlp.down_proj.weight"])
    out["model.norm.weight"] = hf["model.norm.weight"].astype(np.float16)
    return out


def tensor_bytes(arr: np.ndarray, record: dict) -> bytes:
    expected = {"uint32": np.uint32, "float16": np.float16}[record["dtype"]]
    if arr.dtype != expected or list(arr.shape) != record["shape"]:
        raise ValueError(f"{record['name']}: got {arr.dtype} {list(arr.shape)}, expected {record['dtype']} {record['shape']}")
    data = np.ascontiguousarray(arr).tobytes()
    if len(data) != record["nbytes"]:
        raise ValueError(f"{record['name']}: {len(data)} bytes, expected {record['nbytes']}")
    return data


def build_shard(shard: dict, tensors: dict[str, np.ndarray]) -> bytes:
    buf = bytearray(shard["nbytes"])
    for rec in shard["records"]:
        data = tensor_bytes(tensors[rec["name"]], rec)
        buf[rec["byteOffset"] : rec["byteOffset"] + len(data)] = data
    return bytes(buf)


def num_layers_of(config_dir: Path) -> int:
    return json.loads((config_dir / "config.json").read_text())["num_hidden_layers"]


def cmd_verify(args) -> int:
    official = Path(args.official)
    index = json.loads((official / "tensor-cache.json").read_text())
    tensors = mlc_tensors(load_safetensors(Path(args.hf)), num_layers_of(Path(args.hf)))
    ok = True
    for shard in index["records"]:
        path = official / shard["dataPath"]
        if not path.exists():
            continue
        ours = build_shard(shard, tensors)
        theirs = path.read_bytes()
        same = ours == theirs
        ok &= same
        print(f"{shard['dataPath']}: {'identical' if same else 'DIFFERENT'}")
        if not same:
            for rec in shard["records"]:
                a = ours[rec["byteOffset"] : rec["byteOffset"] + rec["nbytes"]]
                b = theirs[rec["byteOffset"] : rec["byteOffset"] + rec["nbytes"]]
                if a != b:
                    dt = np.uint32 if rec["dtype"] == "uint32" else np.float16
                    x, y = np.frombuffer(a, dt), np.frombuffer(b, dt)
                    print(f"  {rec['name']}: {int((x != y).sum())} of {x.size} values differ")
    print("All checked shards match." if ok else "Mismatch found.")
    return 0 if ok else 1


def cmd_convert(args) -> int:
    official, out = Path(args.official), Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    index = json.loads((official / "tensor-cache.json").read_text())
    tensors = mlc_tensors(load_safetensors(Path(args.hf)), num_layers_of(Path(args.hf)))
    for shard in index["records"]:
        data = build_shard(shard, tensors)
        (out / shard["dataPath"]).write_bytes(data)
        shard["md5sum"] = hashlib.md5(data).hexdigest()
        print(f"wrote {shard['dataPath']}")
    (out / "tensor-cache.json").write_text(json.dumps(index))
    for name in ("mlc-chat-config.json", "tokenizer.json", "vocab.json", "merges.txt", "tokenizer_config.json"):
        src = official / name
        if src.exists():
            shutil.copy(src, out / name)
    print(f"Done: {out}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="cmd", required=True)
    for name in ("verify", "convert"):
        p = sub.add_parser(name)
        p.add_argument("--hf", required=True)
        p.add_argument("--official", required=True)
        if name == "convert":
            p.add_argument("--out", required=True)
    args = parser.parse_args()
    return cmd_verify(args) if args.cmd == "verify" else cmd_convert(args)


if __name__ == "__main__":
    sys.exit(main())
