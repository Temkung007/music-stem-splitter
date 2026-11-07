"""Install an independent runtime and the locally built app for this Mac user."""

import json
import os
import plistlib
import shutil
import subprocess
import sys
from datetime import datetime
from pathlib import Path

root = Path(__file__).resolve().parent
support = Path.home() / "Library/Application Support/STEMORA Worker"
support.mkdir(parents=True, exist_ok=True, mode=0o700)
os.chmod(support, 0o700)
runtime = support / "runtime"
uv = shutil.which("uv")
if not uv:
    raise SystemExit(
        "Install uv from its official source before installing the worker."
    )
if not runtime.exists():
    subprocess.run([uv, "venv", "--python", "3.12", str(runtime)], check=True)
python = runtime / "bin/python"
subprocess.run(
    [
        uv,
        "pip",
        "install",
        "--python",
        str(python),
        "-r",
        str(root / "requirements.txt"),
    ],
    check=True,
)
subprocess.run([sys.executable, str(root / "build_macos.py")], check=True)
mlx_runtime = support / "runtime-mlx"
if not mlx_runtime.exists():
    subprocess.run([uv, "venv", "--python", "3.12", str(mlx_runtime)], check=True)
mlx_python = mlx_runtime / "bin/python"
subprocess.run(
    [
        uv,
        "pip",
        "install",
        "--python",
        str(mlx_python),
        "-r",
        str(root / "requirements-mlx.txt"),
    ],
    check=True,
)
for model in ("htdemucs", "htdemucs_ft"):
    subprocess.run(
        [
            str(mlx_python),
            "-m",
            "demucs_mlx.hub",
            "download",
            model,
            "--output-dir",
            str(Path.home() / ".cache/demucs-mlx"),
        ],
        check=True,
    )
vocal_runtime = support / "runtime-vocals"
if not vocal_runtime.exists():
    subprocess.run([uv, "venv", "--python", "3.12", str(vocal_runtime)], check=True)
vocal_python = vocal_runtime / "bin/python"
subprocess.run([uv, "pip", "install", "--python", str(vocal_python), "-r", str(root / "requirements-vocals.txt")], check=True)
subprocess.run([str(vocal_python), str(root / "download_vocals.py")], check=True)
config_path = support / "config.json"
config = json.loads(config_path.read_text())
config.update(python=str(python), ffmpeg=shutil.which("ffmpeg"))
config.update(backend="mlx", mlx_python=str(mlx_python), device="cpu", vocal_python=str(vocal_python), vocal_weights=str(support / "models-vocals/kim-vocal-2"))
if not config["ffmpeg"]:
    raise SystemExit("Install FFmpeg from Homebrew before launching the worker.")
config_path.write_text(json.dumps(config, indent=2) + "\n")
config_path.chmod(0o600)
control = support / "control.json"
if not control.exists():
    control.write_text(
        json.dumps({"paused": True, "parallel_jobs": 0, "quality": "high", "start_hour": 0, "end_hour": 0}) + "\n"
    )
    control.chmod(0o600)
apps = Path.home() / "Applications"
apps.mkdir(exist_ok=True)
destination = apps / "STEMORA Worker.app"
if destination.exists():
    info = plistlib.loads((destination / "Contents/Info.plist").read_bytes())
    assert info["CFBundleIdentifier"] == "com.mydjplus.stemora.worker"
    backups = support / "build-backups"
    backups.mkdir(exist_ok=True, mode=0o700)
    backup = backups / (
        "STEMORA Worker " + datetime.now().strftime("%Y%m%d-%H%M%S") + ".app"
    )
    destination.rename(backup)
shutil.copytree(root / "build/STEMORA Worker.app", destination)
subprocess.run(
    ["codesign", "--verify", "--deep", "--strict", str(destination)], check=True
)
print("Installed:", destination)
print("Worker starts paused until you enable receiving jobs in its menu-bar panel.")
