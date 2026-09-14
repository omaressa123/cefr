# Convert the fine-tuned HF checkpoint whisper-verbatim-merged (Whisper-small
# architecture, safetensors fp16) to legacy whisper.cpp ggml format.
#
# Adapted from whisper.cpp's models/convert-pt-to-ggml.py (current master),
# which only handles stock OpenAI `model.pt` checkpoints. Adaptations:
#   1. Loads weights from safetensors (HF `model.*` key names) instead of an
#      OpenAI .pt, and renames every tensor to the ggml names in
#      whisper.cpp src/whisper-arch.h. Two renames differ from the naive
#      mapping and matter: HF `encoder.layer_norm` -> `encoder.ln_post`, but
#      HF `decoder.layer_norm` -> `decoder.ln` (NOT ln_post).
#   2. Hparams are derived from the fine-tuned config (n_vocab=51864, not the
#      stock-small 51865) and asserted against the real tensor shapes.
#   3. The vocab section is written EXPLICITLY for all 51864 ids
#      (vocab.json ids 0..50256 incl. <|endoftext|> at 50256, plus every entry
#      of added_tokens.json at its own id 50257..51863) instead of relying on
#      the C++ loader's synthesized placeholder tokens. This keeps the exact
#      HF id layout: with header n_vocab=51864, whisper.cpp's
#      is_multilingual() is false so special-token ids are NOT shifted by +1,
#      which matches this checkpoint (eot=50256, sot=50257, en=50258,
#      transcribe=50358, notimestamps=50362).
#   4. Mel filters are loaded from a stock openai/whisper checkout (identical
#      80-bin filters for every Whisper model; the fine-tune did not change
#      the feature extractor).
#
# Usage:
#   /tmp/opencode/whisper-env/bin/python scripts/convert_verbatim_hf_to_ggml.py \
#       --model whisper-verbatim-merged \
#       --whisper-repo /tmp/opencode/openai-whisper \
#       --out /tmp/opencode/whisper-models/ggml-verbatim-small-f16.bin
#
# Then quantize with the whisper.cpp build from this session:
#   /tmp/opencode/whisper.cpp/build/bin/whisper-quantize <baseline> <out> q5_0

from __future__ import annotations

import argparse
import json
import struct
from pathlib import Path

import numpy as np
from safetensors.torch import load_file


def bytes_to_unicode():
    # ref: https://github.com/openai/gpt-2/blob/master/src/encoder.py
    bs = list(range(ord("!"), ord("~") + 1)) + list(range(ord("¡"), ord("¬") + 1)) + list(range(ord("®"), ord("ÿ") + 1))
    cs = bs[:]
    n = 0
    for b in range(2**8):
        if b not in bs:
            bs.append(b)
            cs.append(2**8 + n)
            n += 1
    cs = [chr(n) for n in cs]
    return dict(zip(bs, cs))


def hf_to_ggml_name(hf: str) -> str:
    """Map an HF Whisper tensor name to its whisper.cpp ggml tensor name."""
    if hf == "model.encoder.conv1.weight":
        return "encoder.conv1.weight"
    if hf == "model.encoder.conv1.bias":
        return "encoder.conv1.bias"
    if hf == "model.encoder.conv2.weight":
        return "encoder.conv2.weight"
    if hf == "model.encoder.conv2.bias":
        return "encoder.conv2.bias"
    if hf == "model.encoder.embed_positions.weight":
        return "encoder.positional_embedding"
    if hf == "model.encoder.layer_norm.weight":
        return "encoder.ln_post.weight"
    if hf == "model.encoder.layer_norm.bias":
        return "encoder.ln_post.bias"
    if hf == "model.decoder.embed_tokens.weight":
        return "decoder.token_embedding.weight"
    if hf == "model.decoder.embed_positions.weight":
        return "decoder.positional_embedding"
    if hf == "model.decoder.layer_norm.weight":
        return "decoder.ln.weight"
    if hf == "model.decoder.layer_norm.bias":
        return "decoder.ln.bias"

    # encoder.layers.N.* / decoder.layers.N.self_attn.* share one scheme
    for sys_prefix, hf_mid in (("encoder", "model.encoder.layers."),
                               ("decoder", "model.decoder.layers.")):
        if hf.startswith(hf_mid):
            rest = hf[len(hf_mid):]  # "3.self_attn.q_proj.weight"
            layer, _, tail = rest.partition(".")
            table = {
                "self_attn.q_proj.weight": f"{sys_prefix}.blocks.{layer}.attn.query.weight",
                "self_attn.q_proj.bias": f"{sys_prefix}.blocks.{layer}.attn.query.bias",
                "self_attn.k_proj.weight": f"{sys_prefix}.blocks.{layer}.attn.key.weight",
                "self_attn.v_proj.weight": f"{sys_prefix}.blocks.{layer}.attn.value.weight",
                "self_attn.v_proj.bias": f"{sys_prefix}.blocks.{layer}.attn.value.bias",
                "self_attn.out_proj.weight": f"{sys_prefix}.blocks.{layer}.attn.out.weight",
                "self_attn.out_proj.bias": f"{sys_prefix}.blocks.{layer}.attn.out.bias",
                "self_attn_layer_norm.weight": f"{sys_prefix}.blocks.{layer}.attn_ln.weight",
                "self_attn_layer_norm.bias": f"{sys_prefix}.blocks.{layer}.attn_ln.bias",
                "fc1.weight": f"{sys_prefix}.blocks.{layer}.mlp.0.weight",
                "fc1.bias": f"{sys_prefix}.blocks.{layer}.mlp.0.bias",
                "fc2.weight": f"{sys_prefix}.blocks.{layer}.mlp.2.weight",
                "fc2.bias": f"{sys_prefix}.blocks.{layer}.mlp.2.bias",
                "final_layer_norm.weight": f"{sys_prefix}.blocks.{layer}.mlp_ln.weight",
                "final_layer_norm.bias": f"{sys_prefix}.blocks.{layer}.mlp_ln.bias",
            }
            if tail in table:
                return table[tail]

    # decoder cross-attention has its own ggml names
    if hf.startswith("model.decoder.layers."):
        rest = hf[len("model.decoder.layers."):]
        layer, _, tail = rest.partition(".")
        table = {
            "encoder_attn.q_proj.weight": f"decoder.blocks.{layer}.cross_attn.query.weight",
            "encoder_attn.q_proj.bias": f"decoder.blocks.{layer}.cross_attn.query.bias",
            "encoder_attn.k_proj.weight": f"decoder.blocks.{layer}.cross_attn.key.weight",
            "encoder_attn.v_proj.weight": f"decoder.blocks.{layer}.cross_attn.value.weight",
            "encoder_attn.v_proj.bias": f"decoder.blocks.{layer}.cross_attn.value.bias",
            "encoder_attn.out_proj.weight": f"decoder.blocks.{layer}.cross_attn.out.weight",
            "encoder_attn.out_proj.bias": f"decoder.blocks.{layer}.cross_attn.out.bias",
            "encoder_attn_layer_norm.weight": f"decoder.blocks.{layer}.cross_attn_ln.weight",
            "encoder_attn_layer_norm.bias": f"decoder.blocks.{layer}.cross_attn_ln.bias",
        }
        if tail in table:
            return table[tail]

    raise KeyError(f"no ggml mapping for HF tensor {hf!r}")


def main() -> None:
    ap = argparse.ArgumentParser(description="Convert whisper-verbatim-merged HF checkpoint to ggml")
    ap.add_argument("--model", required=True, help="HF checkpoint dir (safetensors)")
    ap.add_argument("--whisper-repo", required=True, help="openai/whisper checkout (for mel_filters.npz)")
    ap.add_argument("--out", required=True, help="output ggml .bin path")
    args = ap.parse_args()

    model_dir = Path(args.model)
    cfg = json.loads((model_dir / "config.json").read_text())
    n_vocab = int(cfg["vocab_size"])
    hparams = {
        "n_vocab": n_vocab,
        "n_audio_ctx": int(cfg["max_source_positions"]),
        "n_audio_state": int(cfg["d_model"]),
        "n_audio_head": int(cfg["encoder_attention_heads"]),
        "n_audio_layer": int(cfg["encoder_layers"]),
        "n_text_ctx": int(cfg["max_target_positions"]),
        "n_text_state": int(cfg["d_model"]),
        "n_text_head": int(cfg["decoder_attention_heads"]),
        "n_text_layer": int(cfg["decoder_layers"]),
        "n_mels": int(cfg["num_mel_bins"]),
    }
    print("hparams:", hparams)

    print("loading safetensors ...")
    sd = load_file(str(model_dir / "model.safetensors"))
    assert sd["model.decoder.embed_tokens.weight"].shape[0] == n_vocab, "embed rows != vocab_size"

    # rename to ggml names (KeyError here = fine-tune added an unexpected tensor)
    ggml_vars: dict[str, object] = {}
    for k, v in sd.items():
        ggml_vars[hf_to_ggml_name(k)] = v
    print(f"renamed {len(ggml_vars)} tensors, no unmapped keys")

    # mel filters (identical for every Whisper model)
    with np.load(Path(args.whisper_repo) / "whisper" / "assets" / "mel_filters.npz") as f:
        filters = f[f"mel_{hparams['n_mels']}"].astype(np.float32)
    print("mel filters:", filters.shape)

    # explicit full vocab: vocab.json ids + added_tokens.json ids, byte-level for 0..50256
    byte_encoder = bytes_to_unicode()
    byte_decoder = {v: k for k, v in byte_encoder.items()}
    vocab_json = json.loads((model_dir / "vocab.json").read_text())
    added = json.loads((model_dir / "added_tokens.json").read_text())
    id_to_bytes: dict[int, bytes] = {}
    for tok, idx in vocab_json.items():
        id_to_bytes[int(idx)] = bytes(byte_decoder[c] for c in tok)
    for tok, idx in added.items():
        id_to_bytes[int(idx)] = tok.encode("utf-8")
    assert len(id_to_bytes) == n_vocab, f"vocab covers {len(id_to_bytes)} ids, expected {n_vocab}"
    assert sorted(id_to_bytes) == list(range(n_vocab)), "vocab ids are not contiguous 0..n_vocab-1"
    assert id_to_bytes[50256] == b"<|endoftext|>", "eot id mismatch"
    print(f"vocab: {len(id_to_bytes)} explicit tokens, eot@50256 ok")

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    use_f16 = True
    with out.open("wb") as fout:
        fout.write(struct.pack("i", 0x67676D6C))  # magic: ggml
        for k in ("n_vocab", "n_audio_ctx", "n_audio_state", "n_audio_head",
                  "n_audio_layer", "n_text_ctx", "n_text_state", "n_text_head",
                  "n_text_layer", "n_mels"):
            fout.write(struct.pack("i", hparams[k]))
        fout.write(struct.pack("i", 1 if use_f16 else 0))

        fout.write(struct.pack("i", filters.shape[0]))
        fout.write(struct.pack("i", filters.shape[1]))
        for i in range(filters.shape[0]):
            for j in range(filters.shape[1]):
                fout.write(struct.pack("f", float(filters[i][j])))

        fout.write(struct.pack("i", n_vocab))
        for i in range(n_vocab):
            tok = id_to_bytes[i]
            fout.write(struct.pack("i", len(tok)))
            fout.write(tok)

        # same ftype policy as convert-pt-to-ggml.py: small tensors stay f32
        f32_names = {"encoder.conv1.bias", "encoder.conv2.bias",
                     "encoder.positional_embedding", "decoder.positional_embedding"}
        for name in sorted(ggml_vars):
            t = ggml_vars[name].to("cpu").numpy()
            if name in ("encoder.conv1.bias", "encoder.conv2.bias"):
                t = t.reshape(t.shape[0], 1)
            n_dims = len(t.shape)
            if n_dims < 2 or name in f32_names:
                t = t.astype(np.float32)
                ftype = 0
            else:
                t = t.astype(np.float16)
                ftype = 1
            print(f"  {name} {t.shape} ftype={ftype}")
            s = name.encode("utf-8")
            fout.write(struct.pack("iii", n_dims, len(s), ftype))
            for i in range(n_dims):
                fout.write(struct.pack("i", t.shape[n_dims - 1 - i]))
            fout.write(s)
            t.tofile(fout)

    print(f"Done. Output file: {out} ({out.stat().st_size / 1e6:.1f} MB)")


if __name__ == "__main__":
    main()
