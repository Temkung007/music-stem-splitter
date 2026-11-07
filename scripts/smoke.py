"""Local/staging HTTP smoke test. Creates a private disposable account; no credentials printed."""

import argparse
import http.cookiejar
import io
import ipaddress
import json
import math
import secrets
import socket
import struct
import time
import uuid
import wave
import zipfile
from urllib.error import HTTPError
from urllib.parse import urlsplit
from urllib.request import HTTPCookieProcessor, Request, build_opener, urlopen

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--url", default="http://localhost:8080")
parser.add_argument("--language", choices=["th", "en"], default="th")
parser.add_argument(
    "--require-assistant",
    action="store_true",
    help="Fail if the language provider was not used",
)
parser.add_argument(
    "--origin-ip",
    help="Connect to this origin IP while keeping HTTPS hostname validation",
)
parser.add_argument(
    "--audio-ai", action="store_true", help="Also run real four-stem AI separation"
)
args = parser.parse_args()
base = args.url.rstrip("/")
if args.origin_ip:
    origin_ip = str(ipaddress.ip_address(args.origin_ip))
    hostname = urlsplit(base).hostname
    system_resolver = socket.getaddrinfo

    def resolve_origin(host, port, *positional, **keywords):
        return system_resolver(
            origin_ip if host == hostname else host, port, *positional, **keywords
        )

    socket.getaddrinfo = resolve_origin
client = build_opener(HTTPCookieProcessor(http.cookiejar.CookieJar()))


def call(path, body=None, method=None, headers=None):
    request_headers = {
        "X-Stemora-Request": "1",
        "Accept-Language": args.language,
        **(headers or {}),
    }
    if body is not None:
        request_headers["Content-Type"] = "application/json"
        body = json.dumps(body).encode()
    with client.open(
        Request(base + path, data=body, headers=request_headers, method=method),
        timeout=120,
    ) as response:
        data = response.read()
        return response.status, json.loads(
            data
        ) if response.headers.get_content_type() == "application/json" else data


with urlopen(base, timeout=30) as response:
    assert response.status == 200
registration = {
    "email": f"smoke-{uuid.uuid4()}@example.test",
    "password": secrets.token_urlsafe(24),
    "name": "Deployment smoke test",
}
status, user = call("/api/auth/register", registration)
assert status == 201
output = io.BytesIO()
with wave.open(output, "wb") as audio:
    audio.setparams((1, 2, 8000, 0, "NONE", "not compressed"))
    audio.writeframes(
        b"".join(
            struct.pack("<h", int(5000 * math.sin(2 * math.pi * 330 * i / 8000)))
            for i in range(16000)
        )
    )
boundary = "stemora_smoke_boundary"
body = (
    f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="Smoke tone.wav"\r\nContent-Type: audio/wav\r\n\r\n'.encode()
    + output.getvalue()
    + f"\r\n--{boundary}--\r\n".encode()
)
with client.open(
    Request(
        base + "/api/cloud/tracks",
        data=body,
        headers={
            "X-Stemora-Request": "1",
            "Accept-Language": args.language,
            "Content-Type": f"multipart/form-data; boundary={boundary}",
        },
    ),
    timeout=30,
) as response:
    assert response.status == 202
    track = json.load(response)
for _ in range(600):
    _, track = call("/api/cloud/tracks/" + track["id"])
    if track["status"] not in {"queued", "analyzing"}:
        break
    time.sleep(0.2)
assert track["status"] == "ready", track["message"]
assert len(track["peaks"]) == 160
status, audio = call(track["audio_url"], headers={"Range": "bytes=0-15"})
assert status == 206 and audio[:4] == b"RIFF"
status, playlist = call(
    "/api/playlists/compose",
    {
        "name": "Deployment validation",
        "prompt": "จัดเซ็ต 1 นาที ค่อยเพิ่มพลัง",
        "target_minutes": 1,
    },
)
assert status == 200 and playlist["items"][0]["track_id"] == track["id"]
if args.require_assistant:
    assert playlist.get("assistant_used") is True, "The language provider was not used"
_, archive = call(f"/api/playlists/{playlist['id']}/export?format=zip")
with zipfile.ZipFile(io.BytesIO(archive)) as bundle:
    assert "playlist.m3u8" in bundle.namelist() and len(bundle.namelist()) == 2
_, summary = call("/api/cloud/summary")
assert summary["storage"]["driver"] == "s3" and summary["storage"]["ready"]
assert summary["quota_bytes"] == 200_000_000
if args.require_assistant:
    assert summary["assistant"] is True, (
        "The language provider metadata probe did not pass"
    )
if args.audio_ai:
    status, queued = call(f"/api/cloud/tracks/{track['id']}/separate", method="POST")
    assert status == 202
    for _ in range(600):
        _, task = call("/api/tasks/" + queued["task_id"])
        if task["status"] in {"completed", "failed"}:
            break
        time.sleep(2)
    assert task["status"] == "completed", task.get("message")
    assert task["engine"] == "demucs" and len(task["stems"]) == 4
    for stem in task["stems"].values():
        code, sample = call(stem["url"], headers={"Range": "bytes=0-15"})
        assert code == 206 and sample[:4] == b"RIFF"
    _, stems_zip = call("/api/download-all/" + task["id"])
    with zipfile.ZipFile(io.BytesIO(stems_zip)) as bundle:
        assert len(bundle.namelist()) == 4
try:
    urlopen(base + "/api/cloud/tracks", timeout=10)
    raise AssertionError("Anonymous music access must be rejected")
except HTTPError as error:
    assert error.code == 401
print(
    json.dumps(
        {
            "gateway": "passed",
            "connection": "origin" if args.origin_ip else "public gateway",
            "private_upload_analysis": "passed",
            "audio_range": "passed",
            "playlist_zip": "passed",
            "storage": "s3",
            "language": args.language,
            "quota_bytes": summary["quota_bytes"],
            "assistant_used": playlist.get("assistant_used", False),
            "anonymous_access": "rejected",
            "audio_ai": "passed" if args.audio_ai else "not requested",
        }
    )
)
