"""HTTP privacy, real analysis, playlist editing and portable audio exports."""

import http.cookiejar
import io
import json
import time
import uuid
import zipfile
from pathlib import Path
from urllib.request import HTTPCookieProcessor, build_opener

from test_api import HttpHarness, audio_bytes


class WorkspaceTests(HttpHarness):
    def test_localized_errors_are_request_local(self):
        from concurrent.futures import ThreadPoolExecutor

        def check(locale):
            code, data, headers = self.request(
                "/api/cloud/tracks",
                headers={"Accept-Language": locale},
                opener=build_opener(),
            )
            return locale, code, json.loads(data)["detail"], headers["Content-Language"]

        with ThreadPoolExecutor(max_workers=4) as pool:
            results = list(pool.map(check, ["en", "th"] * 4))
        for locale, code, detail, content_language in results:
            self.assertEqual(code, 401)
            self.assertEqual(content_language, locale)
            self.assertEqual(
                detail, "Please log in." if locale == "en" else "กรุณาเข้าสู่ระบบ"
            )

    def test_free_quota_includes_stems_and_keeps_users_separate(self):
        import os
        import sqlite3
        from contextlib import contextmanager

        other = self.other_user()
        _, user, _ = self.json("/api/auth/me", opener=other)
        _, summary, _ = self.json("/api/cloud/summary", opener=other)
        self.assertEqual(summary["quota_bytes"], 200_000_000)
        key = f"users/{user['id']}/quota-test-fixture"

        @contextmanager
        def fixture_database():
            if os.environ.get("STEMORA_TEST_DATABASE") == "postgresql":
                import psycopg

                with psycopg.connect(
                    options=self.database_environment["PGOPTIONS"]
                ) as connection:
                    yield connection, "%s"
            else:
                with sqlite3.connect(
                    Path(self.directory.name) / "workspace.sqlite3"
                ) as connection:
                    yield connection, "?"

        with fixture_database() as (db, mark):
            db.execute(
                "INSERT INTO assets VALUES(" + ",".join([mark] * 4) + ")",
                (key, user["id"], "quota-fixture", 199_999_999),
            )
        try:
            code, _, _ = self.request(
                "/api/cloud/tracks", {}, "quota.wav", audio_bytes(1.37), opener=other
            )
            self.assertEqual(code, 413)
            self.assertEqual(self.json("/api/cloud/tracks", opener=other)[1], [])
            code, data, _ = self.request(
                "/api/separate",
                {"engine": "dsp", "stems_mode": "2stems"},
                "quota.wav",
                audio_bytes(1),
                opener=other,
            )
            self.assertEqual(code, 202)
            identity = json.loads(data)["task_id"]
            for _ in range(200):
                _, body, _ = self.request(
                    "/api/tasks/" + identity,
                    headers={"Accept-Language": "en"},
                    opener=other,
                )
                task = json.loads(body)
                if task["status"] in {"completed", "failed"}:
                    break
                time.sleep(0.1)
            self.assertEqual(task["status"], "failed")
            self.assertIn("not enough storage", task["message"])
            folder = Path(self.directory.name) / "separated" / identity
            self.assertEqual(list(folder.glob("*.wav")), [])
            self.assertEqual(list(folder.glob("*.zip")), [])
            own_summary = self.json("/api/cloud/summary")[1]
            self.assertLess(own_summary["used_bytes"], 199_999_999)
            self.assertEqual(self.track(1.43)["status"], "ready")
        finally:
            with fixture_database() as (db, mark):
                db.execute("DELETE FROM assets WHERE object_key=" + mark, (key,))

    def test_concurrent_playlist_updates_keep_one_revision(self):
        from concurrent.futures import ThreadPoolExecutor

        _, playlist, _ = self.json("/api/playlists", {"name": "Concurrent edit"})

        def update(index):
            return self.json(
                f"/api/playlists/{playlist['id']}",
                {**playlist, "name": f"Concurrent edit {index}"},
                method="PUT",
            )[0]

        with ThreadPoolExecutor(max_workers=2) as pool:
            codes = list(pool.map(update, range(2)))
        self.assertEqual(sorted(codes), [200, 409])

    def test_duplicate_account_returns_conflict(self):
        code, _, _ = self.json(
            "/api/auth/register",
            {
                "email": self.user["email"],
                "password": "test-password-123",
                "name": "Duplicate",
            },
        )
        self.assertEqual(code, 409)

    def json(self, path, body=None, method=None, opener=None):
        code, data, headers = self.request(
            path, json_body=body, method=method, opener=opener
        )
        return code, json.loads(data), headers

    def track(self, seconds=2):
        code, body, _ = self.request(
            "/api/cloud/tracks", {}, "Song.wav", audio_bytes(seconds)
        )
        self.assertEqual(code, 202, body)
        track = json.loads(body)
        for _ in range(600):
            _, track, _ = self.json("/api/cloud/tracks/" + track["id"])
            if track["status"] not in {"queued", "analyzing"}:
                break
            time.sleep(0.1)
        self.assertEqual(track["status"], "ready", track["message"])
        return track

    def other_user(self):
        opener = build_opener(HTTPCookieProcessor(http.cookiejar.CookieJar()))
        code, user, _ = self.json(
            "/api/auth/register",
            {
                "email": f"{uuid.uuid4()}@example.test",
                "password": "another-password-123",
                "name": "Another DJ",
            },
            opener=opener,
        )
        self.assertEqual(code, 201, user)
        self.test_user_ids.append(user["id"])
        return opener

    def test_authentication_and_csrf(self):
        anonymous = build_opener()
        for path in [
            "/api/cloud/tracks",
            "/api/tasks",
            "/api/playlists",
            "/api/cloud/summary",
        ]:
            self.assertEqual(self.json(path, opener=anonymous)[0], 401)
        self.assertEqual(
            self.json(
                "/api/auth/login",
                {"email": "test@example.test", "password": "wrong-password-123"},
            )[0],
            401,
        )
        code, _, _ = self.request(
            "/api/playlists",
            json_body={"name": "CSRF"},
            headers={"X-Stemora-Request": "0"},
        )
        self.assertEqual(code, 403)
        code, _, _ = self.request(
            "/api/playlists",
            json_body={"name": "Origin"},
            headers={"Origin": "https://untrusted.example"},
        )
        self.assertEqual(code, 403)
        _, user, _ = self.json("/api/auth/me")
        self.assertNotIn("password", user)

    def test_private_audio_and_stems(self):
        track = self.track(2.1)
        self.assertNotIn("object_key", track)
        self.assertEqual(len(track["peaks"]), 160)
        self.assertTrue(0 <= track["energy"] <= 100)
        other = self.other_user()
        self.assertEqual(
            self.json("/api/cloud/tracks/" + track["id"], opener=other)[0], 404
        )
        self.assertEqual(self.request(track["audio_url"], opener=other)[0], 404)
        self.assertEqual(self.json("/api/cloud/tracks", opener=other)[1], [])
        code, data, headers = self.request(
            track["audio_url"], headers={"Range": "bytes=0-15"}
        )
        self.assertEqual(code, 206)
        self.assertEqual(data[:4], b"RIFF")
        self.assertEqual(len(data), 16)
        code, body, _ = self.request(
            f"/api/cloud/tracks/{track['id']}/separate",
            {"engine": "dsp", "stems_mode": "2stems"},
        )
        self.assertEqual(code, 202, body)
        task = self.wait_task(json.loads(body)["task_id"])
        self.assertEqual(self.json("/api/tasks/" + task["id"], opener=other)[0], 404)
        self.assertEqual(
            self.request(f"/api/download-all/{task['id']}", opener=other)[0], 404
        )
        self.assertEqual(
            self.request(task["stems"]["vocals"]["url"], opener=other)[0], 404
        )
        self.assertEqual(self.request(task["stems"]["vocals"]["url"])[0], 200)
        _, summary, _ = self.json("/api/cloud/summary")
        self.assertGreater(
            summary["used_bytes"],
            sum(t["size_bytes"] for t in self.json("/api/cloud/tracks")[1]),
        )

    def test_duplicate_and_trash_restore(self):
        track = self.track(2.2)
        code, _, _ = self.request(
            "/api/cloud/tracks", {}, "duplicate.wav", audio_bytes(2.2)
        )
        self.assertEqual(code, 409)
        self.assertEqual(
            self.json(f"/api/cloud/tracks/{track['id']}", method="DELETE")[0], 200
        )
        self.assertEqual(self.request(track["audio_url"])[0], 404)
        _, trash, _ = self.json("/api/cloud/tracks?trash=true")
        self.assertIn(track["id"], [t["id"] for t in trash])
        self.assertEqual(
            self.json(f"/api/cloud/tracks/{track['id']}/restore", {})[0], 200
        )
        self.assertEqual(self.request(track["audio_url"])[0], 200)

    def test_playlist_revision_versions_exports_and_privacy(self):
        a = self.track(2.3)
        b = self.track(2.4)
        code, playlist, _ = self.json(
            "/api/playlists",
            {
                "name": "My private set",
                "items": [{"track_id": a["id"]}, {"track_id": b["id"]}],
            },
        )
        self.assertEqual(code, 201, playlist)
        other = self.other_user()
        for path in [
            f"/api/playlists/{playlist['id']}",
            f"/api/playlists/{playlist['id']}/export",
        ]:
            self.assertEqual(self.request(path, opener=other)[0], 404)
        self.assertEqual(
            self.json(
                "/api/playlists",
                {"name": "Stolen track", "items": [{"track_id": a["id"]}]},
                opener=other,
            )[0],
            422,
        )
        stale = dict(playlist)
        playlist["items"].reverse()
        code, updated, _ = self.json(
            f"/api/playlists/{playlist['id']}", playlist, method="PUT"
        )
        self.assertEqual(code, 200, updated)
        self.assertEqual(updated["revision"], 2)
        self.assertEqual(
            self.json(f"/api/playlists/{playlist['id']}", stale, method="PUT")[0], 409
        )
        _, versions, _ = self.json(f"/api/playlists/{playlist['id']}/versions")
        self.assertEqual(versions[0]["revision"], 1)
        code, restored, _ = self.json(
            f"/api/playlists/{playlist['id']}/versions/restore",
            {"version": 1, "revision": 2},
        )
        self.assertEqual(code, 200, restored)
        self.assertEqual(restored["items"][0]["track_id"], a["id"])
        code, data, _ = self.request(
            f"/api/playlists/{playlist['id']}/export?format=zip"
        )
        self.assertEqual(code, 200)
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            files = archive.namelist()
            self.assertEqual(len(files), 3)
            m3u = archive.read("playlist.m3u8").decode()
            self.assertIn("#EXTM3U", m3u)
            for filename in files:
                if filename.endswith(".wav"):
                    self.assertIn(filename, m3u)
        self.assertEqual(
            self.request(f"/api/playlists/{playlist['id']}/export?format=csv")[0], 200
        )
        self.assertEqual(
            self.json(f"/api/playlists/{playlist['id']}/duplicate", {})[0], 201
        )
        self.assertEqual(
            self.json(f"/api/playlists/{playlist['id']}", method="DELETE")[0], 200
        )
        self.assertEqual(
            self.request(f"/api/playlists/{playlist['id']}/export")[0], 404
        )
        self.assertEqual(
            self.json(f"/api/playlists/{playlist['id']}/restore", {})[0], 200
        )

    def test_composer_uses_real_owned_tracks_and_preserves_locks(self):
        songs = [self.track(2.5 + i / 10) for i in range(3)]
        for index, track in enumerate(songs):
            code, _, _ = self.json(
                f"/api/cloud/tracks/{track['id']}",
                {
                    "title": f"Track {index}",
                    "artist": "DJ Test",
                    "genre": "House",
                    "bpm": 118 + index * 2,
                    "musical_key": "C major",
                    "energy": 30 + index * 30,
                },
                method="PATCH",
            )
            self.assertEqual(code, 200)
        code, playlist, _ = self.json(
            "/api/playlists/compose",
            {
                "name": "Build up",
                "prompt": "ค่อยเพิ่มพลัง 1 นาที",
                "track_ids": [t["id"] for t in songs],
                "target_minutes": 1,
                "genre": "House",
            },
        )
        self.assertEqual(code, 200, playlist)
        self.assertEqual(
            [i["track_id"] for i in playlist["items"]], [t["id"] for t in songs]
        )
        playlist["items"][0]["locked"] = True
        _, saved, _ = self.json(
            f"/api/playlists/{playlist['id']}", playlist, method="PUT"
        )
        code, rebuilt, _ = self.json(
            "/api/playlists/compose",
            {
                "name": "Closing",
                "target_minutes": 1,
                "profile": "closing",
                "track_ids": [t["id"] for t in songs],
                "playlist_id": saved["id"],
                "revision": saved["revision"],
            },
        )
        self.assertEqual(code, 200, rebuilt)
        self.assertEqual(rebuilt["items"][0]["track_id"], songs[0]["id"])
        self.assertTrue(rebuilt["items"][0]["locked"])
        self.assertEqual(len({i["track_id"] for i in rebuilt["items"]}), 3)

    def test_session_revocation_on_password_change(self):
        first = self.other_user()
        _, user, _ = self.json("/api/auth/me", opener=first)
        second = build_opener(HTTPCookieProcessor(http.cookiejar.CookieJar()))
        self.assertEqual(
            self.json(
                "/api/auth/login",
                {"email": user["email"], "password": "another-password-123"},
                opener=second,
            )[0],
            200,
        )
        self.assertEqual(
            self.json(
                "/api/auth/password",
                {
                    "current_password": "another-password-123",
                    "new_password": "new-strong-password-123",
                },
                opener=first,
            )[0],
            200,
        )
        self.assertEqual(self.json("/api/auth/me", opener=second)[0], 401)
        self.assertEqual(self.json("/api/auth/me", opener=first)[0], 200)
        self.assertEqual(self.json("/api/auth/logout", {}, opener=first)[0], 200)
        self.assertEqual(self.json("/api/auth/me", opener=first)[0], 401)

    def test_playlist_disguised_as_audio_is_rejected(self):
        fixture = Path(self.directory.name) / "incoming" / "public-fixture.wav"
        fixture.write_bytes(audio_bytes(2))
        try:
            code, _, _ = self.request(
                "/api/cloud/tracks",
                {},
                "disguised.wav",
                b"ffconcat version 1.0\nfile public-fixture.wav\n",
            )
            self.assertEqual(code, 422)
        finally:
            fixture.unlink(missing_ok=True)

    def test_next_replacement_and_lock_protection(self):
        tracks = [self.track(3.1 + i / 10) for i in range(3)]
        _, playlist, _ = self.json(
            "/api/playlists",
            {"name": "Next song test", "items": [{"track_id": tracks[0]["id"]}]},
        )
        code, added, _ = self.json(
            f"/api/playlists/{playlist['id']}/suggest",
            {"revision": playlist["revision"], "action": "next"},
        )
        self.assertEqual(code, 200, added)
        self.assertEqual(len(added["items"]), 2)
        self.assertNotEqual(
            added["items"][0]["track_id"], added["items"][1]["track_id"]
        )
        original_id = added["items"][1]["track_id"]
        code, replaced, _ = self.json(
            f"/api/playlists/{playlist['id']}/suggest",
            {"revision": added["revision"], "action": "replace", "index": 1},
        )
        self.assertEqual(code, 200, replaced)
        self.assertNotEqual(replaced["items"][1]["track_id"], original_id)
        replaced["items"][0]["locked"] = True
        _, saved, _ = self.json(
            f"/api/playlists/{playlist['id']}", replaced, method="PUT"
        )
        self.assertEqual(
            self.json(
                f"/api/playlists/{playlist['id']}/suggest",
                {"revision": saved["revision"], "action": "replace", "index": 0},
            )[0],
            409,
        )
