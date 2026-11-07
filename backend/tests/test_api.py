"""Real HTTP + FFmpeg tests, isolated from the user's library. No model download needed."""

import http.cookiejar
import importlib.util
import io
import json
import math
import os
import shutil
import socket
import struct
import subprocess
import sys
import tempfile
import time
import unittest
import wave
import zipfile
from pathlib import Path
from unittest.mock import AsyncMock, patch
from urllib.error import HTTPError, URLError
from urllib.request import HTTPCookieProcessor, Request, build_opener, urlopen

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))


def audio_bytes(seconds=1, rate=8000):
    output = io.BytesIO()
    with wave.open(output, "wb") as audio:
        audio.setparams((1, 2, rate, 0, "NONE", "not compressed"))
        audio.writeframes(
            b"".join(
                struct.pack("<h", int(5000 * math.sin(2 * math.pi * 330 * i / rate)))
                for i in range(int(rate * seconds))
            )
        )
    return output.getvalue()


@unittest.skipUnless(
    shutil.which("ffmpeg") and shutil.which("ffprobe"), "FFmpeg is required"
)
class HttpHarness(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.directory = tempfile.TemporaryDirectory(prefix="stemora-tests-")
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            cls.port = sock.getsockname()[1]
        cls.base = f"http://127.0.0.1:{cls.port}"
        cls.fixture = audio_bytes()
        cls.database_environment = {"DATABASE_DRIVER": "sqlite"}
        cls.pg_schema = None
        if os.environ.get("STEMORA_TEST_DATABASE") == "postgresql":
            import uuid

            import psycopg
            from psycopg import sql

            cls.pg_schema = "test_" + uuid.uuid4().hex
            with psycopg.connect() as connection:
                connection.execute(
                    sql.SQL("CREATE SCHEMA {}").format(sql.Identifier(cls.pg_schema))
                )
            cls.database_environment = {
                "DATABASE_DRIVER": "postgresql",
                "PGOPTIONS": "-c search_path=" + cls.pg_schema,
            }
        cls.launch()
        cls.opener = build_opener(HTTPCookieProcessor(http.cookiejar.CookieJar()))
        request = Request(
            cls.base + "/api/auth/register",
            data=json.dumps(
                {
                    "email": "test@example.test",
                    "password": "test-password-123",
                    "name": "Test DJ",
                }
            ).encode(),
            headers={"Content-Type": "application/json", "X-Stemora-Request": "1"},
        )
        with cls.opener.open(request) as response:
            cls.user = json.load(response)
        cls.test_user_ids = [cls.user["id"]]

    @classmethod
    def launch(cls):
        cls.server = subprocess.Popen(
            [
                sys.executable,
                "-m",
                "uvicorn",
                "main:app",
                "--app-dir",
                str(BACKEND),
                "--host",
                "127.0.0.1",
                "--port",
                str(cls.port),
            ],
            env={
                **os.environ,
                "STEMORA_DATA_DIR": cls.directory.name,
                "STORAGE_DRIVER": os.environ.get("STEMORA_TEST_STORAGE", "local"),
                "AI_BASE_URL": "",
                "AI_PROVIDER": "ollama",
                "GEMINI_API_KEY": "",
                "COOKIE_SECURE": "0",
                "ALLOW_REGISTRATION": "1",
                **cls.database_environment,
                **getattr(cls, "extra_environment", {}),
            },
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        deadline = time.monotonic() + 90
        while time.monotonic() < deadline:
            try:
                with urlopen(cls.base + "/api/health", timeout=1) as response:
                    if response.status == 200:
                        return
            except (URLError, OSError):
                time.sleep(0.1)
        cls.server.terminate()
        raise RuntimeError("Test server did not start")

    @classmethod
    def tearDownClass(cls):
        cls.server.terminate()
        cls.server.wait(timeout=10)
        cls.directory.cleanup()
        if cls.pg_schema:
            import psycopg
            from psycopg import sql

            with psycopg.connect() as connection:
                connection.execute(
                    sql.SQL("DROP SCHEMA {} CASCADE").format(
                        sql.Identifier(cls.pg_schema)
                    )
                )
        if os.environ.get("STEMORA_TEST_STORAGE") == "s3":
            import boto3
            from botocore.config import Config

            client = boto3.client(
                "s3",
                endpoint_url=os.environ["S3_ENDPOINT"],
                aws_access_key_id=os.environ["S3_ACCESS_KEY"],
                aws_secret_access_key=os.environ["S3_SECRET_KEY"],
                region_name=os.environ.get("S3_REGION", "garage"),
                config=Config(
                    signature_version="s3v4", s3={"addressing_style": "path"}
                ),
            )
            for user_id in cls.test_user_ids:
                for page in client.get_paginator("list_objects_v2").paginate(
                    Bucket=os.environ["S3_BUCKET"], Prefix=f"users/{user_id}/"
                ):
                    objects = [
                        {"Key": entry["Key"]} for entry in page.get("Contents", [])
                    ]
                    if objects:
                        client.delete_objects(
                            Bucket=os.environ["S3_BUCKET"], Delete={"Objects": objects}
                        )

    def request(
        self,
        path,
        fields=None,
        filename=None,
        content=None,
        headers=None,
        json_body=None,
        method=None,
        opener=None,
    ):
        body = None
        request_headers = {"X-Stemora-Request": "1", **(headers or {})}
        if fields is not None:
            boundary = "stemora_test_boundary"
            segments = []
            for key, value in fields.items():
                segments.append(
                    f'--{boundary}\r\nContent-Disposition: form-data; name="{key}"\r\n\r\n{value}\r\n'.encode()
                )
            if filename is not None:
                segments.append(
                    f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{filename}"\r\nContent-Type: application/octet-stream\r\n\r\n'.encode()
                    + (content or b"")
                    + b"\r\n"
                )
            body = b"".join(segments) + f"--{boundary}--\r\n".encode()
            request_headers = {
                **request_headers,
                "Content-Type": f"multipart/form-data; boundary={boundary}",
            }
        if json_body is not None:
            body = json.dumps(json_body).encode()
            request_headers["Content-Type"] = "application/json"
        try:
            response = (opener or self.opener).open(
                Request(
                    self.base + path, data=body, headers=request_headers, method=method
                ),
                timeout=60,
            )
        except HTTPError as error:
            response = error
        with response:
            return response.status, response.read(), response.headers

    def wait_task(self, task_id):
        for _ in range(200):
            status, body, _ = self.request(f"/api/tasks/{task_id}")
            self.assertEqual(status, 200)
            task = json.loads(body)
            if task["status"] in ("completed", "failed"):
                self.assertEqual(task["status"], "completed", task["message"])
                return task
            time.sleep(0.1)
        self.fail("Task timed out")

    def submit(self, mode="4stems"):
        code, body, _ = self.request(
            "/api/separate",
            {"engine": "dsp", "stems_mode": mode},
            "เพลงทดสอบ.wav",
            self.fixture,
        )
        self.assertEqual(code, 202, body)
        return self.wait_task(json.loads(body)["task_id"])


class ApiTests(HttpHarness):
    def test_invalid_options(self):
        for option_patch in (
            {"stems_mode": "invalid"},
            {"model_name": "../../outside"},
            {"engine": "unknown"},
        ):
            with self.subTest(patch=option_patch):
                code, _, _ = self.request(
                    "/api/separate",
                    {"engine": "dsp", **option_patch},
                    "track.wav",
                    self.fixture,
                )
                self.assertEqual(code, 422)

    def test_bad_files(self):
        for name, data, expected in [
            ("file.exe", self.fixture, 415),
            ("empty.wav", b"", 422),
            ("fake.mp3", b"not audio", 422),
        ]:
            with self.subTest(name=name):
                code, _, _ = self.request(
                    "/api/separate", {"engine": "dsp"}, name, data
                )
                self.assertEqual(code, expected)
        self.assertEqual(list((Path(self.directory.name) / "uploads").iterdir()), [])

    def test_oversized_file(self):
        code, _, _ = self.request(
            "/api/separate",
            {"engine": "dsp"},
            "large.wav",
            b"0" * (50 * 1024 * 1024 + 1),
        )
        self.assertEqual(code, 413)
        self.assertEqual(list((Path(self.directory.name) / "uploads").iterdir()), [])

    def test_long_audio(self):
        code, _, _ = self.request(
            "/api/separate", {"engine": "dsp"}, "long.wav", audio_bytes(601, 1000)
        )
        self.assertEqual(code, 422)

    def test_two_stems_and_downloads(self):
        task = self.submit("2stems")
        self.assertEqual(set(task["stems"]), {"vocals", "no_vocals"})
        self.assertEqual(task["engine"], "dsp")
        code, content, _ = self.request(f"/api/download-all/{task['id']}")
        self.assertEqual(code, 200)
        with zipfile.ZipFile(io.BytesIO(content)) as archive:
            self.assertEqual(set(archive.namelist()), {'เพลงทดสอบ (Instrumental).wav', 'เพลงทดสอบ (Acapella).wav'})
            with wave.open(io.BytesIO(archive.read("เพลงทดสอบ (Acapella).wav"))) as audio:
                self.assertAlmostEqual(
                    audio.getnframes() / audio.getframerate(), 1, places=2
                )
        url = task["stems"]["vocals"]["url"]
        code, data, headers = self.request(url, headers={"Range": "bytes=0-15"})
        self.assertEqual(code, 206)
        from urllib.parse import unquote
        self.assertIn("เพลงทดสอบ (Acapella).wav", unquote(headers["Content-Disposition"]))
        self.assertEqual(data[:4], b"RIFF")
        self.assertEqual(len(data), 16)
        self.assertTrue(headers["Content-Range"].startswith("bytes 0-15/"))
        self.assertEqual(self.request(f"/api/stems/{task['id']}/task.json")[0], 404)
        self.assertEqual(list((Path(self.directory.name) / "uploads").iterdir()), [])

    def test_four_stems_and_waveforms(self):
        task = self.submit()
        self.assertEqual(set(task["stems"]), {"vocals", "drums", "bass", "other"})
        for stem in task["stems"].values():
            self.assertEqual(len(stem["peaks"]), 140)
            self.assertTrue(all(0 <= peak <= 1 for peak in stem["peaks"]))
            self.assertGreater(stem["size_bytes"], 44)
        self.assertAlmostEqual(task["duration"], 1, places=2)

    def test_demo_respects_mode(self):
        code, body, _ = self.request("/api/demo-audio", {"stems_mode": "2stems"})
        self.assertEqual(code, 202)
        task = self.wait_task(json.loads(body)["task_id"])
        self.assertEqual(task["engine"], "demo")
        self.assertEqual(set(task["stems"]), {"vocals", "no_vocals"})
        self.assertEqual(task["duration"], 12)

    def test_missing_task(self):
        for path in (
            "/api/tasks/missing",
            "/api/stems/missing/vocals.wav",
            "/api/download-all/missing",
        ):
            self.assertEqual(self.request(path)[0], 404)

    def test_z_history_survives_restart(self):
        task = self.submit()
        type(self).server.terminate()
        type(self).server.wait(timeout=10)
        type(self).launch()
        restored = json.loads(self.request(f"/api/tasks/{task['id']}")[1])
        self.assertEqual(restored["status"], "completed")
        self.assertEqual(restored["stems"], task["stems"])
        self.assertEqual(self.request(f"/api/download-all/{task['id']}")[0], 200)


class AcceleratorTests(unittest.IsolatedAsyncioTestCase):
    async def test_gpu_failure_retries_same_model_on_cpu(self):
        with (
            tempfile.TemporaryDirectory() as directory,
            patch.dict(os.environ, {"STEMORA_DATA_DIR": directory}),
        ):
            spec = importlib.util.spec_from_file_location(
                "stemora_isolated", BACKEND / "main.py"
            )
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
            failed = AsyncMock(returncode=1)
            failed.communicate.return_value = (b"", b"unsupported MPS operation")
            succeeded = AsyncMock(returncode=0)
            succeeded.communicate.return_value = (b"", b"")
            task = {"model_name": "htdemucs", "stems_mode": "2stems"}
            with (
                patch.object(module, "get_device", return_value="mps"),
                patch.object(
                    module.asyncio,
                    "create_subprocess_exec",
                    side_effect=[failed, succeeded],
                ) as spawn,
            ):
                await module.run_demucs(task, Path("input.wav"), Path(directory))
            self.assertEqual(spawn.await_count, 2)
            calls = spawn.call_args_list
            self.assertEqual(calls[0].args[calls[0].args.index("-d") + 1], "mps")
            self.assertEqual(calls[1].args[calls[1].args.index("-d") + 1], "cpu")
            self.assertEqual(task["device"], "cpu")
            self.assertIn("--two-stems", calls[1].args)
            self.assertEqual(calls[0].kwargs["env"]["PYTORCH_ENABLE_MPS_FALLBACK"], "1")


if __name__ == "__main__":
    unittest.main()
