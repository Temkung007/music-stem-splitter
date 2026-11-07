"""Real HTTP tests for authenticated, bounded client-result imports and exports."""

import io
import json
import sqlite3
import struct
import uuid
import wave
import zipfile
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, build_opener

from test_api import HttpHarness


def stereo_wav(frames=441):
    output = io.BytesIO()
    with wave.open(output, "wb") as audio:
        audio.setparams((2, 2, 44100, 0, "NONE", "not compressed"))
        audio.writeframes(struct.pack("<hh", 1234, -5678) * frames)
    return output.getvalue()


class ClientStemsTests(HttpHarness):
    def upload(self, files=None, mode="2stems", client_id=None, opener=None, csrf=True):
        files = (
            files
            if files is not None
            else [(name + ".wav", stereo_wav()) for name in ["vocals", "no_vocals"]]
        )
        boundary = "stemora-client-stems-boundary"
        parts = []
        for key, value in {
            "filename": "../My song.mp3",
            "stems_mode": mode,
            "client_id": client_id or str(uuid.uuid4()),
        }.items():
            parts.append(
                f'--{boundary}\r\nContent-Disposition: form-data; name="{key}"\r\n\r\n{value}\r\n'.encode()
            )
        for name, value in files:
            parts.append(
                f'--{boundary}\r\nContent-Disposition: form-data; name="files"; filename="{name}"\r\nContent-Type: audio/wav\r\n\r\n'.encode()
                + value
                + b"\r\n"
            )
        body = b"".join(parts) + f"--{boundary}--\r\n".encode()
        headers = {
            "Content-Type": f"multipart/form-data; boundary={boundary}",
            "Accept-Language": "en",
        }
        if csrf:
            headers["X-Stemora-Request"] = "1"
        try:
            response = (opener or self.opener).open(
                Request(self.base + "/api/client-stems", data=body, headers=headers),
                timeout=30,
            )
        except HTTPError as error:
            response = error
        with response:
            return response.status, json.load(response)

    def test_private_import_export_quota_and_idempotency(self):
        summary = json.loads(self.request("/api/cloud/summary")[1])
        client_id = str(uuid.uuid4())
        code, task = self.upload(client_id=client_id)
        self.assertEqual(code, 200, task)
        self.assertEqual(task["engine"], "webgpu")
        self.assertEqual(task["status"], "completed")
        self.assertEqual(task["filename"], "My song.mp3")
        self.assertEqual(set(task["stems"]), {"vocals", "no_vocals"})
        self.assertNotIn("client_id", task)
        self.assertNotIn("model_name", task)
        after = json.loads(self.request("/api/cloud/summary")[1])
        self.assertEqual(
            after["used_bytes"] - summary["used_bytes"], len(stereo_wav()) * 2
        )
        self.assertEqual(self.upload(client_id=client_id)[1]["id"], task["id"])
        self.assertEqual(
            json.loads(self.request("/api/cloud/summary")[1])["used_bytes"],
            after["used_bytes"],
        )
        for stem in task["stems"].values():
            self.assertNotIn("object_key", stem)
            self.assertEqual(self.request(stem["url"])[1], stereo_wav())
            self.assertEqual(self.request(stem["url"], opener=build_opener())[0], 401)
        code, archive, _ = self.request("/api/download-all/" + task["id"])
        self.assertEqual(code, 200)
        with zipfile.ZipFile(io.BytesIO(archive)) as bundle:
            self.assertIsNone(bundle.testzip())
            self.assertEqual(set(bundle.namelist()), {'My song (Instrumental).wav', 'My song (Acapella).wav'})
            self.assertEqual(bundle.read("My song (Acapella).wav"), stereo_wav())
        self.assertEqual(
            json.loads(self.request("/api/cloud/summary")[1])["used_bytes"],
            after["used_bytes"],
        )
        self.assertFalse(
            list((Path(self.directory.name) / "cache").glob("client-download-*.zip"))
        )
        code, other, _ = self.request(
            "/api/auth/register",
            json_body={
                "email": str(uuid.uuid4()) + "@example.test",
                "password": "test-password-123",
                "name": "Other DJ",
            },
            opener=build_opener(),
        )
        self.assertEqual(code, 201)
        # A separate cookie jar is needed to verify authenticated cross-user access.
        import http.cookiejar
        from urllib.request import HTTPCookieProcessor

        other_opener = build_opener(HTTPCookieProcessor(http.cookiejar.CookieJar()))
        self.request(
            "/api/auth/login",
            json_body={
                "email": json.loads(other)["email"],
                "password": "test-password-123",
            },
            opener=other_opener,
        )
        for path in [
            "/api/tasks/" + task["id"],
            "/api/download-all/" + task["id"],
            task["stems"]["vocals"]["url"],
        ]:
            self.assertEqual(self.request(path, opener=other_opener)[0], 404)

    def test_legacy_trash_restore_purge_and_ownership(self):
        import http.cookiejar
        from urllib.request import HTTPCookieProcessor
        code, task = self.upload()
        self.assertEqual(code, 200)
        ident = task["id"]
        before = json.loads(self.request("/api/cloud/summary")[1])["used_bytes"]
        other = build_opener(HTTPCookieProcessor(http.cookiejar.CookieJar()))
        self.assertEqual(self.request("/api/auth/register", json_body={"email": str(uuid.uuid4()) + "@example.test", "password": "test-password-123", "name": "Other"}, opener=other)[0], 201)
        self.assertEqual(self.request(f"/api/tasks/{ident}/trash", method="POST", opener=other)[0], 404)
        self.assertEqual(self.request(f"/api/tasks/{ident}/trash", method="POST")[0], 200)
        self.assertEqual(self.request(f"/api/tasks/{ident}")[0], 404)
        self.assertEqual(self.request(task["stems"]["vocals"]["url"])[0], 404)
        self.assertIn(ident, {entry["id"] for entry in json.loads(self.request("/api/worker-trash")[1])})
        self.assertNotIn(ident, {entry["id"] for entry in json.loads(self.request("/api/worker-trash", opener=other)[1])})
        self.assertEqual(self.request(f"/api/tasks/{ident}/restore", method="POST", opener=other)[0], 404)
        self.assertEqual(self.request(f"/api/tasks/{ident}/purge", method="DELETE", opener=other)[0], 404)
        self.assertEqual(self.request(f"/api/tasks/{ident}/restore", method="POST")[0], 200)
        self.assertEqual(self.request(task["stems"]["vocals"]["url"])[0], 200)
        self.assertEqual(self.request(f"/api/tasks/{ident}/trash", method="POST")[0], 200)
        self.assertEqual(self.request(f"/api/tasks/{ident}/purge", method="DELETE")[0], 200)
        self.assertEqual(self.request(f"/api/tasks/{ident}")[0], 404)
        self.assertEqual(json.loads(self.request("/api/cloud/summary")[1])["used_bytes"], before - len(stereo_wav()) * 2)

    def test_rejects_bad_headers_stem_sets_durations_and_csrf(self):
        valid = stereo_wav()
        for files, mode in [
            ([("vocals.wav", valid)] * 2, "2stems"),
            ([("../vocals.wav", valid), ("no_vocals.wav", valid)], "2stems"),
            ([("vocals.wav", b"not wave"), ("no_vocals.wav", valid)], "2stems"),
            ([("vocals.wav", valid[:-2]), ("no_vocals.wav", valid)], "2stems"),
            ([("vocals.wav", stereo_wav(442)), ("no_vocals.wav", valid)], "2stems"),
            ([("vocals.wav", valid), ("no_vocals.wav", valid)], "4stems"),
        ]:
            self.assertEqual(self.upload(files, mode)[0], 422)
        self.assertEqual(self.upload(client_id="invalid")[0], 422)
        self.assertEqual(self.upload(csrf=False)[0], 403)
        self.assertEqual(self.upload(opener=build_opener())[0], 401)

    def test_four_stems_and_storage_rejection_leave_no_partial_task(self):
        code, task = self.upload(
            [
                (name + ".wav", stereo_wav())
                for name in ["vocals", "drums", "bass", "other"]
            ],
            "4stems",
        )
        self.assertEqual(code, 200, task)
        self.assertEqual(len(task["stems"]), 4)
        self.assertEqual(task["duration"], 0.01)
        if self.database_environment["DATABASE_DRIVER"] != "sqlite":
            self.skipTest("Quota fixture uses the isolated SQLite test database")
        key = "users/" + self.user["id"] + "/client-quota-fixture"
        with sqlite3.connect(Path(self.directory.name) / "workspace.sqlite3") as db:
            db.execute(
                "INSERT INTO assets VALUES(?,?,?,?)",
                (key, self.user["id"], "quota-fixture", 200_000_000),
            )
        before = len(json.loads(self.request("/api/tasks")[1]))
        try:
            code, body = self.upload()
            self.assertEqual(code, 413, body)
            self.assertIn("Download", body["detail"])
            self.assertEqual(len(json.loads(self.request("/api/tasks")[1])), before)
        finally:
            with sqlite3.connect(Path(self.directory.name) / "workspace.sqlite3") as db:
                db.execute("DELETE FROM assets WHERE object_key=?", (key,))
        self.assertFalse(
            list((Path(self.directory.name) / "uploads").glob("client-stems-*"))
        )

    def test_z_saved_client_results_survive_restart(self):
        client_id = str(uuid.uuid4())
        code, task = self.upload(client_id=client_id)
        self.assertEqual(code, 200)
        type(self).server.terminate()
        type(self).server.wait(timeout=10)
        type(self).launch()
        self.assertEqual(
            json.loads(self.request("/api/tasks/" + task["id"])[1])["engine"], "webgpu"
        )
        self.assertEqual(self.upload(client_id=client_id)[1]["id"], task["id"])
        self.assertEqual(self.request("/api/download-all/" + task["id"])[0], 200)
