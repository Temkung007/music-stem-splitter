"""Build the operator-only menu-bar app using Apple's local Swift toolchain."""

import json
import os
import plistlib
import shutil
import subprocess
from pathlib import Path

root = Path(__file__).resolve().parent
destination = root / "build/STEMORA Worker.app"
contents = destination / "Contents"
(contents / "MacOS").mkdir(parents=True, exist_ok=True)
(contents / "Resources").mkdir(exist_ok=True)
shutil.copy2(root / "agent.py", contents / "Resources/agent.py")
shutil.copy2(root / "pool.py", contents / "Resources/pool.py")
shutil.copy2(root / "mlx_runner.py", contents / "Resources/mlx_runner.py")
shutil.copy2(root / "vocal_runner.py", contents / "Resources/vocal_runner.py")
(contents / "Info.plist").write_bytes(
    plistlib.dumps(
        {
            "CFBundleIdentifier": "com.mydjplus.stemora.worker",
            "CFBundleName": "STEMORA Worker",
            "CFBundleDisplayName": "STEMORA Worker",
            "CFBundleExecutable": "STEMORAWorker",
            "CFBundleVersion": "17",
            "CFBundleShortVersionString": "1.5.1",
            "LSUIElement": True,
            "LSMinimumSystemVersion": "14.0",
            "NSHighResolutionCapable": True,
        }
    )
)
subprocess.run(
    [
        "swiftc",
        "-parse-as-library",
        "-O",
        "-target",
        "arm64-apple-macos14.0",
        str(root / "macos/StemoraWorker.swift"),
        "-o",
        str(contents / "MacOS/STEMORAWorker"),
    ],
    check=True,
)
subprocess.run(["codesign", "--force", "--sign", "-", str(destination)], check=True)
support = Path.home() / "Library/Application Support/STEMORA Worker"
support.mkdir(parents=True, exist_ok=True, mode=0o700)
os.chmod(support, 0o700)
config_file = support / "config.json"
if not config_file.exists():
    import secrets
    import uuid

    config = {
        "server_url": "https://stemora.mydjplus.com",
        "origin_ip": "143.198.204.118",
        "id": str(uuid.uuid4()),
        "token": secrets.token_urlsafe(48),
        "python": str(root.parent / "backend/.venv/bin/python"),
        "ffmpeg": shutil.which("ffmpeg"),
        "device": "auto",
    }
    config_file.write_text(json.dumps(config, indent=2) + "\n")
    config_file.chmod(0o600)
print("Built:", destination)
print("Private configuration:", config_file)
print(
    "Enroll the SHA-256 of the token on the VPS before launching. The raw token stays on this Mac."
)
