"""Chunk uploads: privacy, resumability, exact bytes and batches above CDN limits."""

import http.cookiejar
import json
import os
import struct
import time
import uuid
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import HTTPCookieProcessor, Request, build_opener

from test_api import HttpHarness
from test_client_stems import stereo_wav


class ClientUploadTests(HttpHarness):
    def test_partial_upload_survives_restart_and_expired_stage_is_replaced(self):
        _, _, files, identity = self.begin()
        self.assertEqual(
            self.chunk(identity, "vocals.wav", files["vocals.wav"][:100])[0], 200
        )
        type(self).server.terminate()
        type(self).server.wait(timeout=10)
        type(self).launch()
        self.assertEqual(self.begin(files, identity)[1]["offsets"]["vocals.wav"], 100)
        meta = (
            Path(self.directory.name)
            / "client-incoming"
            / self.user["id"]
            / identity
            / "upload.json"
        )
        os.utime(meta, (time.time() - 7201, time.time() - 7201))
        self.assertEqual(self.begin(files, identity)[1]["offsets"]["vocals.wav"], 0)
        self.request(f"/api/client-stems/uploads/{identity}", method="DELETE")

    def begin(self, files=None, client_id=None, opener=None):
        files = files or {
            name: stereo_wav() for name in ["vocals.wav", "no_vocals.wav"]
        }
        identity = client_id or str(uuid.uuid4())
        code, raw, _ = self.request(
            "/api/client-stems/uploads",
            json_body={
                "client_id": identity,
                "filename": "Chunked test.wav",
                "stems_mode": "2stems",
                "files": [
                    {"name": name, "size_bytes": len(data)}
                    for name, data in files.items()
                ],
            },
            opener=opener,
        )
        return code, json.loads(raw), files, identity

    def chunk(self, identity, name, data, offset=0, opener=None, csrf=True):
        headers = {"Content-Type": "application/octet-stream", "Accept-Language": "en"}
        if csrf:
            headers["X-Stemora-Request"] = "1"
        try:
            response = (opener or self.opener).open(
                Request(
                    self.base
                    + f"/api/client-stems/uploads/{identity}/{name}?offset={offset}",
                    data=data,
                    headers=headers,
                    method="PUT",
                ),
                timeout=60,
            )
        except HTTPError as error:
            response = error
        with response:
            return response.status, json.load(response)

    def complete(self, identity, opener=None):
        code, raw, _ = self.request(
            f"/api/client-stems/uploads/{identity}/complete",
            json_body={},
            opener=opener,
        )
        return code, json.loads(raw)

    def test_resume_retry_and_idempotent_complete(self):
        code, started, files, identity = self.begin()
        self.assertEqual(code, 200)
        self.assertLessEqual(started["chunk_bytes"], 4_000_000)
        self.assertEqual(self.complete(identity)[0], 409)
        raw = files["vocals.wav"]
        self.assertEqual(
            self.chunk(identity, "vocals.wav", raw[:100])[1]["offset"], 100
        )
        self.assertEqual(
            self.chunk(identity, "vocals.wav", raw[:100])[1]["offset"], 100
        )
        # Retry that overlaps an interrupted write appends only the missing suffix.
        self.assertEqual(
            self.chunk(identity, "vocals.wav", raw[:200])[1]["offset"], 200
        )
        resumed = self.begin(files, identity)[1]
        self.assertEqual(resumed["offsets"]["vocals.wav"], 200)
        self.assertEqual(self.chunk(identity, "vocals.wav", raw[200:], 200)[0], 200)
        self.assertEqual(
            self.chunk(identity, "no_vocals.wav", files["no_vocals.wav"])[0], 200
        )
        code, task = self.complete(identity)
        self.assertEqual(code, 200, task)
        self.assertEqual(task["engine"], "webgpu")
        self.assertEqual(self.complete(identity)[1]["id"], task["id"])
        self.assertEqual(self.begin(files, identity)[1]["completed"]["id"], task["id"])
        self.assertEqual(self.request(task["stems"]["vocals"]["url"])[1], raw)

    def test_auth_csrf_ownership_and_chunk_validation(self):
        _, _, files, identity = self.begin()
        self.assertEqual(self.chunk(identity, "vocals.wav", b"abc", csrf=False)[0], 403)
        self.assertEqual(
            self.chunk(identity, "vocals.wav", b"abc", opener=build_opener())[0], 401
        )
        self.assertEqual(self.chunk(identity, "drums.wav", b"abc")[0], 404)
        self.assertEqual(
            self.chunk(identity, "vocals.wav", b"abc", offset=99999)[0], 422
        )
        self.assertEqual(self.chunk(identity, "vocals.wav", b"abc", offset=1)[0], 409)
        self.assertEqual(
            self.chunk(identity, "vocals.wav", files["vocals.wav"][:100])[0], 200
        )
        self.assertEqual(
            self.chunk(identity, "vocals.wav", b"different", offset=0)[0], 409
        )
        other = build_opener(HTTPCookieProcessor(http.cookiejar.CookieJar()))
        self.request(
            "/api/auth/register",
            json_body={
                "email": str(uuid.uuid4()) + "@example.test",
                "name": "Another DJ",
                "password": "test-password-123",
            },
            opener=other,
        )
        self.assertEqual(
            self.chunk(identity, "vocals.wav", b"abc", opener=other)[0], 404
        )
        self.assertEqual(self.complete(identity, opener=other)[0], 404)
        self.assertEqual(
            self.request(f"/api/client-stems/uploads/{identity}", method="DELETE")[0],
            200,
        )
        self.assertEqual(self.chunk(identity, "vocals.wav", b"abc")[0], 404)

    def test_z_large_batch_uses_small_requests(self):
        # 120 MB of canonical synthetic PCM exceeds Free/Pro CDN request limits.
        # No single request in this test is larger than four million bytes.
        size = 60_000_000
        header = bytearray(stereo_wav()[:44])
        struct.pack_into("<I", header, 4, size - 8)
        struct.pack_into("<I", header, 40, size - 44)
        identity = str(uuid.uuid4())
        code, raw, _ = self.request(
            "/api/client-stems/uploads",
            json_body={
                "client_id": identity,
                "filename": "Large synthetic PCM.wav",
                "stems_mode": "2stems",
                "files": [
                    {"name": name, "size_bytes": size}
                    for name in ["vocals.wav", "no_vocals.wav"]
                ],
            },
        )
        self.assertEqual(code, 200, raw)
        zero = bytes(4_000_000)
        for name in ["vocals.wav", "no_vocals.wav"]:
            self.assertEqual(self.chunk(identity, name, zero + b"x")[0], 413)
            for offset in range(0, size, len(zero)):
                data = bytes(header) + zero[44:] if offset == 0 else zero
                self.assertEqual(
                    self.chunk(identity, name, data, offset)[1]["offset"],
                    offset + len(data),
                )
        code, task = self.complete(identity)
        self.assertEqual(code, 200, task)
        self.assertEqual(
            sum(stem["size_bytes"] for stem in task["stems"].values()), size * 2
        )
        summary = json.loads(self.request("/api/cloud/summary")[1])
        self.assertGreaterEqual(summary["used_bytes"], 120_000_000)
        self.assertLessEqual(summary["used_bytes"], 200_000_000)
