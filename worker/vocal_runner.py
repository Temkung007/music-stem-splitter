"""Offline, persistent Mel-Band RoFormer inference for trusted operator Macs.

The pinned, verified checkpoint is loaded strictly. Long songs use bounded
8-second inference with 50% overlap, reflected context and weighted overlap-add.
"""

import contextlib
import json
import os
import sys
import time
import traceback
from pathlib import Path

import mlx.core as mx
import numpy as np
import soundfile as sf
from mlx_audio.sts.models.mel_roformer import MelRoFormer, MelRoFormerConfig

os.umask(0o077)
mx.set_cache_limit(256 * 1024 * 1024)
model = None
loaded = None
CHUNK = 352800
STEP = CHUNK // 2


def separate(mix, infer, progress=lambda value: None):
    """Weighted overlap-add with context on both ends; shape [2, samples]."""
    if mix.ndim != 2 or mix.shape[0] != 2 or not mix.shape[1]:
        raise ValueError("Expected stereo audio")
    if not np.isfinite(mix).all():
        raise ValueError("Non-finite input")
    length = mix.shape[1]
    padded = np.pad(mix, ((0, 0), (STEP, STEP)), mode="reflect" if length > 1 else "edge")
    count = (padded.shape[1] - CHUNK + STEP - 1) // STEP + 1
    padded = np.pad(padded, ((0, 0), (0, (count - 1) * STEP + CHUNK - padded.shape[1])))
    output = np.zeros_like(padded, dtype=np.float32)
    weight = np.zeros(padded.shape[1], dtype=np.float32)
    window = np.hanning(CHUNK + 1)[:-1].astype(np.float32)
    for index in range(count):
        start = index * STEP
        chunk = padded[:, start:start + CHUNK]
        voice = np.zeros_like(chunk) if np.max(np.abs(chunk)) < 1e-8 else np.asarray(infer(chunk), dtype=np.float32)
        if voice.shape != chunk.shape or not np.isfinite(voice).all():
            raise ValueError("Invalid vocal output")
        output[:, start:start + CHUNK] += voice * window
        weight[start:start + CHUNK] += window
        progress((index + 1) / count)
    region = slice(STEP, STEP + length)
    if not np.all(weight[region] > 0):
        raise ValueError("Uncovered audio samples")
    return output[:, region] / weight[region]


def main():
    global model, loaded
    for line in sys.stdin:
        message = json.loads(line)
        folder = Path(message["folder"]).resolve()
        result = folder / "vocal-result.json"
        started = time.monotonic()
        try:
            with contextlib.redirect_stdout(sys.stderr):
                path = Path(message["weights"]).resolve()
                if loaded != str(path):
                    model = MelRoFormer(MelRoFormerConfig.kim_vocal_2())
                    weights = model.sanitize(dict(mx.load(str(path / "model.safetensors"))))
                    model.load_weights(list(weights.items()), strict=True)
                    model.eval()
                    mx.eval(model.parameters())
                    loaded = str(path)
                mix, rate = sf.read(message["source"], dtype="float32", always_2d=True)
                if rate != 44100 or mix.shape[1] != 2 or mix.shape[0] > 600 * 44100:
                    raise ValueError("Expected canonical stereo 44.1 kHz, at most 10 minutes")
                mix = mix.T

                def infer(chunk):
                    voice = model(mx.array(chunk)[None, ...])[0]
                    mx.eval(voice)
                    return np.asarray(voice)

                def progress(value):
                    temp = folder / "vocal-progress.tmp"
                    temp.write_text(json.dumps({"progress": 20 + int(value * 65)}))
                    temp.replace(folder / "vocal-progress.json")

                voice = separate(mix, infer, progress)
                stems = {"vocals": voice, "no_vocals": mix - voice}
                peak = max(float(np.max(np.abs(audio))) for audio in stems.values())
                gain = min(1.0, 0.99 / max(peak, 1e-12))
                output = folder / "raw/mel-roformer/source"
                output.mkdir(parents=True, exist_ok=True)
                for name, audio in stems.items():
                    sf.write(output / (name + ".wav"), (audio * gain).T, 44100, subtype="PCM_16")
            answer = {"ok": True, "model": "kim-vocal-2", "output_gain": gain,
                      "seconds": time.monotonic() - started, "chunk_samples": CHUNK, "overlap": 0.5}
        except Exception:
            traceback.print_exc(file=sys.stderr)
            answer = {"ok": False}
        temp = result.with_suffix(".tmp")
        temp.write_text(json.dumps(answer))
        temp.replace(result)


if __name__ == "__main__":
    main()
