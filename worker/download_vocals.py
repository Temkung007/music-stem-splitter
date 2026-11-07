"""Fetch only pinned safe-tensor assets; never execute remote model code."""
import hashlib
import json
import ssl
import urllib.request
from pathlib import Path

import certifi

REVISION = "64cbfcb004e39430e5f584552c05949440ec39ce"
FILES = {
    "model.safetensors": "312c38e5b698f8dfaa4d6064e8f79010744825828917871a9d22673a43eb7fe5",
    "config.json": "3300eacac960ab46933ef6df6b838eb35de1f0321db9242c1b06e6d2a6a62b58",
    "LICENSE": "1aa245b55067df5c63c847894e7040f76fa79ddde83e9e5ed8a5c29ef1865c14",
    "README.md": "2bcb814963a9f0057259ee7736dea03c1346586d4124eebd75673fef13b30f55",
}


def install(root):
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    context = ssl.create_default_context(cafile=certifi.where())
    for name, digest in FILES.items():
        target = root / name
        if target.exists() and hashlib.sha256(target.read_bytes()).hexdigest() == digest:
            continue
        temp = target.with_suffix(".download")
        url = f"https://huggingface.co/mlx-community/mel-roformer-kim-vocal-2-mlx/resolve/{REVISION}/{name}"
        with urllib.request.urlopen(url, context=context, timeout=120) as response, temp.open("wb") as output:
            while block := response.read(4 * 1024 * 1024):
                output.write(block)
        if hashlib.sha256(temp.read_bytes()).hexdigest() != digest:
            temp.unlink()
            raise ValueError("Model checksum mismatch")
        temp.replace(target)
    (root / "manifest.json").write_text(json.dumps({"revision": REVISION, "sha256": FILES}, indent=2))


if __name__ == "__main__":
    install(Path.home() / "Library/Application Support/STEMORA Worker/models-vocals/kim-vocal-2")
