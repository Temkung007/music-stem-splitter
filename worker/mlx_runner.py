"""Private stdio inference helper; one MLX model stays warm between jobs."""

import contextlib
import gc
import json
import os
import sys
import traceback
from pathlib import Path

import mlx.core as mx
from demucs_mlx import Separator, save_audio
from demucs_mlx.audio import load_audio

mx.set_cache_limit(512 * 1024 * 1024)
os.umask(0o077)
separator = None
loaded = None
for line in sys.stdin:
    message = json.loads(line)
    folder = Path(message["folder"]).resolve()
    result = folder / "mlx-result.json"
    try:
        model = message["model"]
        if model not in {"htdemucs", "htdemucs_ft"}:
            raise ValueError("Unsupported model")
        with contextlib.redirect_stdout(sys.stderr):
            if loaded != model:
                separator = None
                gc.collect()
                separator = Separator(
                    model=model, shifts=2 if model == "htdemucs_ft" else 1,
                    overlap=0.5 if model == "htdemucs_ft" else 0.25,
                    seed=0, progress=True,
                )
                loaded = model
            # Match Demucs' public inference API: normalize the full mixture,
            # then restore its level after inference (model-internal normalization
            # alone does not replace this step).
            mix, _ = load_audio(message["source"], sr=separator.samplerate, dtype="float32")
            reference = mx.mean(mix, axis=0)
            mean = mx.mean(reference)
            scale = mx.std(reference, ddof=1) + 1e-8
            if not bool(mx.isfinite(mean).item()) or not bool(mx.isfinite(scale).item()):
                raise ValueError("Non-finite input audio")
            _, estimates = separator.separate_tensor((mix - mean) / scale, return_mx=True)
            stems = {name: audio * scale + mean for name, audio in estimates.items()}
            output = folder / "raw" / model / "source"
            output.mkdir(parents=True, exist_ok=True)
            if message["mode"] == "2stems":
                stems = {
                    "vocals": stems["vocals"],
                    "no_vocals": stems["drums"] + stems["bass"] + stems["other"],
                }
            # One shared gain retains the relative level of vocals/accompaniment.
            # Per-stem rescaling can otherwise change the mix balance.
            peak = max(float(mx.max(mx.abs(audio)).item()) for audio in stems.values())
            gain = min(1.0, 0.99 / max(peak, 1e-12))
            for name, audio in stems.items():
                save_audio(
                    audio * gain,
                    str(output / (name + ".wav")),
                    samplerate=separator.samplerate,
                    bits_per_sample=16,
                    clip="none",
                )
        answer = {"ok": True, "model": model, "shifts": separator.shifts, "overlap": separator.overlap, "output_gain": gain}
    except Exception:
        traceback.print_exc(file=sys.stderr)
        answer = {"ok": False}
    temp = result.with_suffix(".tmp")
    temp.write_text(json.dumps(answer))
    temp.replace(result)
