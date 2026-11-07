"""Real HTTP queue/lease/privacy/restart tests. No neural inference is mocked into production."""

import hashlib
import http.cookiejar
import io
import json
import secrets
import sqlite3
import uuid
import zipfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import HTTPCookieProcessor, Request, build_opener

from test_api import HttpHarness
from test_client_stems import stereo_wav


class WorkerQueueHelpers:
    extra_environment = {"STEMORA_WORKER_ENABLED": "1"}

    def db(self, sql, params=()):
        if self.database_environment["DATABASE_DRIVER"] == "postgresql":
            import psycopg

            with psycopg.connect(options="-c search_path=" + self.pg_schema) as db:
                db.execute(sql.replace("?", "%s"), params)
        else:
            with sqlite3.connect(Path(self.directory.name) / "workspace.sqlite3") as db:
                db.execute(sql, params)

    def worker(self):
        identity, token = str(uuid.uuid4()), secrets.token_urlsafe(48)
        self.db(
            "INSERT INTO workers(id,name,token_hash,created_at) VALUES(?,?,?,?)",
            (
                identity,
                "Test worker",
                hashlib.sha256(token.encode()).hexdigest(),
                "2026-10-30",
            ),
        )
        return identity, token

    def api(self, path, token=None, body=None, method="POST", lease=None):
        if path == "/claim" and body == {}:
            body = {"profiles": ["stems-standard", "vocals-pro"]}
        headers = {"Accept-Language": "en"}
        if token:
            headers["Authorization"] = "Bearer " + token
        if lease:
            headers["X-Stemora-Lease"] = lease
        if body is not None and not isinstance(body, bytes):
            body = json.dumps(body).encode()
            headers["Content-Type"] = "application/json"
        try:
            response = build_opener().open(
                Request(
                    self.base + "/api/worker" + path,
                    data=body,
                    method=method,
                    headers=headers,
                ),
                timeout=60,
            )
        except HTTPError as error:
            response = error
        with response:
            raw = response.read()
            return response.status, json.loads(raw) if "json" in response.headers.get(
                "Content-Type", ""
            ) else raw

    def enqueue(self, mode="2stems"):
        code, raw, _ = self.request(
            "/api/separate",
            fields={"engine": "worker", "stems_mode": mode},
            filename="Queue song.wav",
            content=self.fixture,
        )
        self.assertEqual(code, 202, raw)
        task = json.loads(raw)["task_id"]
        self.addCleanup(self.request, "/api/tasks/" + task + "/cancel", method="POST")
        return task

    def upload_results(self, token, job):
        names = (
            ["vocals", "no_vocals"]
            if job["stems_mode"] == "2stems"
            else ["vocals", "drums", "bass", "other"]
        )
        for name in names:
            raw = stereo_wav(frames=44100)
            path = f"/jobs/{job['id']}/files/{name}.wav?offset=0"
            self.assertEqual(
                self.api(path, token, raw, "PUT", job["lease"]),
                (200, {"offset": len(raw)}),
            )
            # Retrying a chunk must not append duplicate bytes.
            self.assertEqual(
                self.api(path, token, raw, "PUT", job["lease"]),
                (200, {"offset": len(raw)}),
            )
        return self.api(f"/jobs/{job['id']}/complete", token, {"lease": job["lease"]})


class WorkerQueueTests(WorkerQueueHelpers, HttpHarness):
    def test_mixed_fleet_routes_profiles_without_downgrade(self):
        vocal, full = self.enqueue(), self.enqueue("4stems")
        old_id, old = self.worker()
        new_id, new = self.worker()
        with ThreadPoolExecutor(2) as pool:
            first = pool.submit(self.api, "/claim", old, {"profiles":["stems-standard"]})
            second = pool.submit(self.api, "/claim", new, {"profiles":["vocals-pro"]})
            old_job, new_job = first.result()[1]["job"], second.result()[1]["job"]
        self.assertEqual(old_job["id"], full)
        self.assertEqual(new_job["id"], vocal)
        self.assertEqual(new_job["processing_profile"], "vocals-pro")
        snapshot = self.api("/queue", new, method="GET")[1]
        self.assertEqual(snapshot["counts"]["processing"], 2)
        fleet = {w["id"]:w for w in snapshot["workers"]}
        self.assertTrue({old_id,new_id} <= set(fleet))
        for w in (fleet[old_id], fleet[new_id]):
            self.assertEqual(set(w), {"id","name","online","accepting","device","on_this_worker","busy","active_jobs"})
            self.assertTrue(w["busy"])
            self.assertTrue(w["online"])
        self.assertNotIn("processing_profile", json.loads(self.request("/api/tasks/"+vocal)[1]))
        self.assertEqual(self.api("/claim", old, {"profiles":["unknown"]})[0], 422)

    def test_old_worker_cannot_claim_new_vocal_job(self):
        task = self.enqueue()
        _, token = self.worker()
        # Omitted profiles represent an older installed app.
        self.assertIsNone(self.api("/claim", token)[1]["job"])
        self.assertEqual(self.api("/claim", token, {"profiles":["vocals-pro"]})[1]["job"]["id"], task)

    def test_operator_queue_counts_order_privacy_and_auth(self):
        self.assertEqual(self.api("/queue", method="GET")[0], 401)
        self.assertEqual(self.api("/queue", "invalid", method="GET")[0], 401)
        first, second, staging = self.enqueue(), self.enqueue(), self.enqueue()
        self.db("UPDATE stem_jobs SET status='staging' WHERE id=?", (staging,))
        _, token = self.worker()
        job = self.api("/claim", token, {})[1]["job"]
        self.assertEqual(job["id"], first)
        code, snapshot = self.api("/queue", token, method="GET")
        self.assertEqual(code, 200)
        self.assertEqual(snapshot["counts"], {"waiting":1, "processing":1, "preparing":1})
        by_id = {item["id"]:item for item in snapshot["items"]}
        self.assertEqual(by_id[second]["position"], 1)
        self.assertTrue(by_id[first]["on_this_worker"])
        self.assertIsNone(by_id[staging]["position"])
        for item in by_id.values():
            self.assertGreaterEqual(item["waiting_seconds"], 0)
            self.assertEqual(set(item), {"id","filename","status","position","waiting_seconds","duration","stems_mode","progress","on_this_worker","worker_name"})
        _, other = self.worker()
        foreign_snapshot = self.api("/queue", other, method="GET")[1]
        self.assertFalse(next(x for x in foreign_snapshot["items"] if x["id"]==first)["on_this_worker"])
        self.request("/api/tasks/"+first+"/cancel", method="POST")
        snapshot = self.api("/queue", token, method="GET")[1]
        self.assertEqual(snapshot["counts"]["processing"], 0)
        self.assertNotIn(first, {item["id"] for item in snapshot["items"]})

    def test_staging_request_can_be_recovered_and_cancelled(self):
        ident = str(uuid.uuid4())
        code, raw, _ = self.request("/api/separate", fields={"engine":"worker", "stems_mode":"2stems", "request_id":ident}, filename="staging.wav", content=self.fixture)
        self.assertEqual(code, 202, raw)
        task = json.loads(raw)["task_id"]
        self.db("UPDATE stem_jobs SET status='staging' WHERE id=?", (task,))
        self.assertEqual(json.loads(self.request("/api/separation-requests/"+ident)[1])["task"]["status"], "queued")
        self.assertEqual(json.loads(self.request("/api/tasks/"+task)[1])["status"], "queued")
        self.assertEqual(json.loads(self.request("/api/tasks/"+task+"/cancel", method="POST")[1])["status"], "cancelled")
        self.assertEqual(json.loads(self.request("/api/tasks/"+task)[1])["status"], "cancelled")

    def test_upload_request_is_idempotent_concurrent_and_recoverable(self):
        ident = str(uuid.uuid4())
        path = "/api/separation-requests/" + ident
        self.assertIsNone(json.loads(self.request(path)[1])["task"])
        before = json.loads(self.request("/api/cloud/summary")[1])["used_bytes"]
        def submit():
            code, raw, _ = self.request("/api/separate", fields={"engine":"worker", "stems_mode":"2stems", "request_id":ident}, filename="request.wav", content=self.fixture)
            self.assertEqual(code, 202, raw)
            return json.loads(raw)["task_id"]
        with ThreadPoolExecutor(2) as pool:
            ids = list(pool.map(lambda _: submit(), range(2)))
        self.assertEqual(ids[0], ids[1])
        task = ids[0]
        self.addCleanup(self.request, "/api/tasks/" + task + "/cancel", method="POST")
        self.assertEqual(json.loads(self.request(path)[1])["task"]["task_id"], task)
        once = json.loads(self.request("/api/cloud/summary")[1])["used_bytes"]
        self.assertGreater(once, before)
        self.assertEqual(submit(), task)
        self.assertEqual(json.loads(self.request("/api/cloud/summary")[1])["used_bytes"], once)
        self.assertEqual(self.request("/api/separate", fields={"engine":"worker", "stems_mode":"4stems", "request_id":ident}, filename="request.wav", content=self.fixture)[0], 409)
        stranger = build_opener(HTTPCookieProcessor(http.cookiejar.CookieJar()))
        self.assertEqual(self.request(path, opener=stranger)[0], 401)
        code, raw, _ = self.request("/api/auth/register", json_body={"email":uuid.uuid4().hex+"@example.test", "password":"test-password-123", "name":"Other account"}, opener=stranger)
        self.assertIn(code, (200, 201))
        self.test_user_ids.append(json.loads(raw)["id"])
        self.assertIsNone(json.loads(self.request(path, opener=stranger)[1])["task"])
        self.assertEqual(self.request("/api/separation-requests/not-valid")[0], 422)
        _, token = self.worker()
        job = self.api("/claim", token, {})[1]["job"]
        self.assertEqual(job["id"], task)
        self.assertEqual(self.upload_results(token, job)[0], 200)
        # Completion releases the input bytes, but the request still recovers.
        self.assertEqual(submit(), task)
        self.assertEqual(json.loads(self.request(path)[1])["task"]["status"], "completed")

    def test_download_mode_works_with_full_cloud_and_private_results(self):
        key = "users/" + self.user["id"] + "/full-cloud"
        used = json.loads(self.request("/api/cloud/summary")[1])["used_bytes"]
        self.db("INSERT INTO assets VALUES(?,?,?,?)", (key, self.user["id"], "quota-test", 200_000_000 - used))
        self.addCleanup(self.db, "DELETE FROM assets WHERE object_key=?", (key,))
        self.assertEqual(self.request("/api/separate", fields={"engine": "worker", "stems_mode": "2stems", "storage_mode": "cloud"}, filename="full.wav", content=self.fixture)[0], 413)
        ids = []
        for index in range(2):
            code, raw, _ = self.request("/api/separate", fields={"engine": "worker", "stems_mode": "2stems", "storage_mode": "download"}, filename=f"download-{index}.wav", content=self.fixture)
            self.assertEqual(code, 202, raw)
            ids.append(json.loads(raw)["task_id"])
        _, token = self.worker()
        for task in ids:
            job = self.api("/claim", token, {})[1]["job"]
            self.assertEqual(job["id"], task)
            self.assertEqual(self.upload_results(token, job)[0], 200)
            result = json.loads(self.request("/api/tasks/" + task)[1])
            self.assertEqual(result["storage_mode"], "download")
            self.assertGreater(result["expires_at"], 0)
            self.assertNotIn("temporary_bytes", result)
            url = result["stems"]["vocals"]["url"]
            self.assertEqual(self.request(url)[1], stereo_wav(frames=44100))
            stranger = build_opener(HTTPCookieProcessor(http.cookiejar.CookieJar()))
            self.assertEqual(self.request(url, opener=stranger)[0], 401)
            archive = self.request("/api/download-all/" + task)[1]
            with zipfile.ZipFile(io.BytesIO(archive)) as bundle:
                self.assertEqual(bundle.read(result["filename"].rsplit(".", 1)[0] + " (Acapella).wav"), stereo_wav(frames=44100))
            self.assertEqual(self.request(f"/api/tasks/{task}/trash", method="POST")[0], 200)
            self.assertEqual(self.request(f"/api/tasks/{task}/restore", method="POST")[0], 200)
            self.assertEqual(self.request(url)[0], 200)
            self.assertEqual(self.request(f"/api/tasks/{task}/trash", method="POST")[0], 200)
            self.assertEqual(self.request(f"/api/tasks/{task}/purge", method="DELETE")[0], 200)
            self.assertEqual(self.request(url)[0], 404)
        summary = json.loads(self.request("/api/cloud/summary")[1])
        self.assertEqual(summary["quota_bytes"], 200_000_000)
        self.assertEqual(summary["used_bytes"], 200_000_000)

    def test_temporary_results_expire_even_before_cleanup_and_release_budget(self):
        code, raw, _ = self.request("/api/separate", fields={"engine": "worker", "stems_mode": "2stems", "storage_mode": "download"}, filename="expire.wav", content=self.fixture)
        self.assertEqual(code, 202, raw)
        task = json.loads(raw)["task_id"]
        _, token = self.worker()
        job = self.api("/claim", token, {})[1]["job"]
        self.assertEqual(self.upload_results(token, job)[0], 200)
        result = json.loads(self.request("/api/tasks/" + task)[1])
        url = result["stems"]["vocals"]["url"]
        spec = {**job, "expires_at": 1, "temporary_bytes": 2_000_000_000}
        for private in ("lease", "source_bytes", "source_sha256", "chunk_bytes"):
            spec.pop(private, None)
        self.db("UPDATE stem_jobs SET spec=? WHERE id=?", (json.dumps(spec), task))
        self.assertEqual(json.loads(self.request("/api/tasks/" + task)[1])["status"], "expired")
        self.assertEqual(self.request(url)[0], 404)
        self.assertEqual(self.request("/api/download-all/" + task)[0], 404)
        object_folder = Path(self.directory.name) / "objects" / "users" / self.user["id"] / "temporary-stems" / task
        # The worker poll invokes the same cleanup loop used at startup/every 30s.
        self.api("/claim", token, {})
        if self.database_environment["DATABASE_DRIVER"] == "sqlite":
            self.assertFalse(list(object_folder.rglob("*.wav")))
        self.assertEqual(json.loads(self.request("/api/tasks/" + task)[1])["status"], "expired")
        self.assertEqual(self.request("/api/separate", fields={"engine": "worker", "stems_mode": "2stems", "storage_mode": "download"}, filename="next.wav", content=self.fixture)[0], 202)
        new_job = self.api("/claim", token, {})[1]["job"]
        self.request("/api/tasks/" + new_job["id"] + "/cancel", method="POST")

    def test_download_scratch_limit_is_separate_from_cloud_quota(self):
        code, raw, _ = self.request("/api/separate", fields={"engine": "worker", "stems_mode": "2stems", "storage_mode": "download"}, filename="scratch.wav", content=self.fixture)
        self.assertEqual(code, 202, raw)
        task = json.loads(raw)["task_id"]
        self.addCleanup(self.request, "/api/tasks/" + task + "/cancel", method="POST")
        spec = json.loads(self.request("/api/tasks/" + task)[1])
        spec["temporary_bytes"] = 2_000_000_000
        self.db("UPDATE stem_jobs SET spec=? WHERE id=?", (json.dumps(spec), task))
        self.assertEqual(self.request("/api/separate", fields={"engine": "worker", "stems_mode": "2stems", "storage_mode": "download"}, filename="scratch-full.wav", content=self.fixture)[0], 429)
        self.assertEqual(self.request("/api/separate", fields={"engine": "worker", "stems_mode": "2stems", "storage_mode": "wrong"}, filename="invalid.wav", content=self.fixture)[0], 422)

    def test_all_history_includes_jobs_beyond_fifty(self):
        ids = [str(uuid.uuid4()) for _ in range(53)]
        def remove():
            for ident in ids:
                self.db("DELETE FROM stem_jobs WHERE id=?", (ident,))
        self.addCleanup(remove)
        for ident in ids:
            spec = {"id": ident, "filename": "test.wav", "engine": "worker", "stems_mode": "2stems", "created_at": "2026-01-01T00:00:00Z"}
            self.db("INSERT INTO stem_jobs (id,owner_id,spec,source_key,source_bytes,source_sha256,status,message,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)", (ident,self.user["id"],json.dumps(spec),"",0,"","failed","test",spec["created_at"],0))
        jobs = json.loads(self.request("/api/tasks")[1])
        self.assertTrue(set(ids).issubset({item["id"] for item in jobs}))

    def test_trash_restore_private_completed_results(self):
        task = self.enqueue()
        _, token = self.worker()
        job = self.api("/claim", token, {})[1]["job"]
        self.assertEqual(self.upload_results(token, job)[0], 200)
        stem = next(iter(json.loads(self.request("/api/tasks/" + task)[1])["stems"].values()))
        before = json.loads(self.request("/api/cloud/summary")[1])["used_bytes"]
        self.assertEqual(self.request("/api/tasks/" + task + "/trash", method="POST")[0], 200)
        self.assertEqual(self.request("/api/tasks/" + task)[0], 404)
        self.assertEqual(self.request(stem["url"])[0], 404)
        self.assertIn(task, {x["id"] for x in json.loads(self.request("/api/worker-trash")[1])})
        self.assertEqual(json.loads(self.request("/api/cloud/summary")[1])["used_bytes"], before)
        self.assertEqual(self.request("/api/tasks/" + task + "/restore", method="POST")[0], 200)
        self.assertEqual(self.request(stem["url"])[0], 200)
        self.assertEqual(self.request("/api/tasks/" + task + "/trash", method="POST")[0], 200)
        self.assertEqual(self.request("/api/tasks/" + task + "/purge", method="DELETE")[0], 200)
        self.assertEqual(self.request(stem["url"])[0], 404)
        self.assertLess(json.loads(self.request("/api/cloud/summary")[1])["used_bytes"], before)
        self.assertEqual(self.request("/api/tasks/" + task + "/restore", method="POST")[0], 404)

    def test_complete_private_quota_zip_and_idempotent_commit(self):
        before = json.loads(self.request("/api/cloud/summary")[1])["used_bytes"]
        task = self.enqueue()
        self.assertIn(
            task, {item["id"] for item in json.loads(self.request("/api/tasks")[1])}
        )
        identity, token = self.worker()
        code, answer = self.api("/claim", token, {})
        self.assertEqual(code, 200)
        job = answer["job"]
        self.assertEqual(job["id"], task)
        self.assertFalse(
            {"owner_id", "source_key", "model_name", "token_hash"} & job.keys()
        )
        self.assertEqual(
            self.api(f"/jobs/{task}/source", token, method="GET", lease=job["lease"]),
            (200, self.fixture),
        )
        self.assertEqual(
            self.api(
                "/heartbeat",
                token,
                {
                    "task_id": task,
                    "lease": job["lease"],
                    "progress": 40,
                    "phase": "separating",
                    "device": "test",
                    "accepting": True,
                },
            )[0],
            200,
        )
        self.assertTrue(json.loads(self.request("/api/health")[1])["worker_online"])
        self.assertEqual(self.upload_results(token, job)[0], 200)
        self.assertEqual(
            self.api(f"/jobs/{task}/complete", token, {"lease": job["lease"]})[0], 200
        )
        result = json.loads(self.request("/api/tasks/" + task)[1])
        self.assertEqual(result["status"], "completed")
        self.assertEqual(result["engine"], "worker")
        self.assertFalse(
            {"owner_id", "lease", "lease_hash", "worker_id", "source_key"}
            & result.keys()
        )
        for stem in result["stems"].values():
            self.assertNotIn("object_key", stem)
            self.assertEqual(self.request(stem["url"])[1], stereo_wav(44100))
            self.assertEqual(self.request(stem["url"], opener=build_opener())[0], 401)
        raw = self.request("/api/download-all/" + task)[1]
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
            self.assertIsNone(archive.testzip())
            self.assertEqual(set(archive.namelist()), {"Queue song (Acapella).wav", "Queue song (Instrumental).wav"})
        self.assertEqual(
            json.loads(self.request("/api/cloud/summary")[1])["used_bytes"] - before,
            2 * len(stereo_wav(44100)),
        )
        self.assertEqual(
            self.api(f"/jobs/{task}/source", token, method="GET", lease=job["lease"])[
                0
            ],
            409,
        )

        other = build_opener(HTTPCookieProcessor(http.cookiejar.CookieJar()))
        self.assertEqual(
            self.request(
                "/api/auth/register",
                json_body={
                    "email": uuid.uuid4().hex + "@example.test",
                    "password": "test-password-123",
                    "name": "Other DJ",
                },
                opener=other,
            )[0],
            201,
        )
        for endpoint in [
            "/api/tasks/" + task,
            "/api/download-all/" + task,
            result["stems"]["vocals"]["url"],
        ]:
            self.assertEqual(self.request(endpoint, opener=other)[0], 404)
        self.assertEqual(
            self.request("/api/tasks/" + task + "/cancel", method="POST", opener=other)[
                0
            ],
            404,
        )

    def test_auth_ownership_chunk_bounds_validation_cancel_and_revoke(self):
        task = self.enqueue()
        identity, token = self.worker()
        _, other = self.worker()
        self.assertEqual(self.api("/claim", body={})[0], 401)
        self.assertEqual(self.api("/claim", "bad-token", {})[0], 401)
        job = self.api("/claim", token, {})[1]["job"]
        self.assertEqual(
            self.api(f"/jobs/{task}/source", other, method="GET", lease=job["lease"])[
                0
            ],
            409,
        )
        self.assertEqual(
            self.api(f"/jobs/{task}/complete", token, {"lease": job["lease"]})[0], 422
        )
        self.assertEqual(
            self.api(
                f"/jobs/{task}/files/unknown.wav?offset=0",
                token,
                b"bad",
                "PUT",
                job["lease"],
            )[0],
            422,
        )
        self.assertEqual(
            self.api(
                f"/jobs/{task}/files/vocals.wav?offset=1",
                token,
                b"bad",
                "PUT",
                job["lease"],
            )[0],
            409,
        )
        self.assertEqual(
            self.api(
                f"/jobs/{task}/files/vocals.wav?offset=0",
                token,
                b"x" * 4_000_001,
                "PUT",
                job["lease"],
            )[0],
            413,
        )
        self.assertEqual(
            self.api(
                f"/jobs/{task}/files/vocals.wav?offset=0",
                token,
                b"bad",
                "PUT",
                job["lease"],
            )[0],
            200,
        )
        self.assertEqual(
            self.api(
                f"/jobs/{task}/files/vocals.wav?offset=0",
                token,
                b"BAD",
                "PUT",
                job["lease"],
            )[0],
            409,
        )
        before = json.loads(self.request("/api/cloud/summary")[1])["used_bytes"]
        self.assertEqual(
            self.request(
                "/api/tasks/" + task + "/cancel", opener=build_opener(), method="POST"
            )[0],
            401,
        )
        self.assertEqual(
            self.request(
                "/api/tasks/" + task + "/cancel",
                headers={"X-Stemora-Request": ""},
                method="POST",
            )[0],
            403,
        )
        self.assertEqual(
            self.request("/api/tasks/" + task + "/cancel", method="POST")[0], 200
        )
        self.assertLess(
            json.loads(self.request("/api/cloud/summary")[1])["used_bytes"], before
        )
        self.assertEqual(
            self.api("/heartbeat", token, {"task_id": task, "lease": job["lease"]})[0],
            409,
        )
        self.db("UPDATE workers SET enabled=0 WHERE id=?", (identity,))
        self.assertEqual(self.api("/claim", token, {})[0], 401)

    def test_queue_survives_restart_and_expired_lease_is_fenced(self):
        task = self.enqueue("4stems")
        type(self).server.terminate()
        type(self).server.wait(timeout=10)
        type(self).launch()
        self.assertEqual(
            json.loads(self.request("/api/tasks/" + task)[1])["status"], "queued"
        )
        _, first = self.worker()
        _, second = self.worker()
        job = self.api("/claim", first, {})[1]["job"]
        self.db("UPDATE stem_jobs SET lease_until=0 WHERE id=?", (task,))
        replacement = self.api("/claim", second, {})[1]["job"]
        self.assertEqual(job["id"], replacement["id"])
        self.assertNotEqual(job["lease"], replacement["lease"])
        self.assertEqual(
            self.api(
                f"/jobs/{task}/files/vocals.wav?offset=0",
                first,
                stereo_wav(44100),
                "PUT",
                job["lease"],
            )[0],
            409,
        )
        self.assertEqual(
            self.api(f"/jobs/{task}/complete", first, {"lease": job["lease"]})[0], 409
        )
        self.assertEqual(self.upload_results(second, replacement)[0], 200)
        self.assertEqual(
            len(json.loads(self.request("/api/tasks/" + task)[1])["stems"]), 4
        )

    def test_concurrent_claims_quota_reservation_and_retry_limit(self):
        first_task, second_task = self.enqueue(), self.enqueue()
        _, first = self.worker()
        _, second = self.worker()
        with ThreadPoolExecutor(2) as executor:
            claimed = list(
                executor.map(
                    lambda token: self.api("/claim", token, {})[1]["job"],
                    [first, second],
                )
            )
        self.assertEqual({job["id"] for job in claimed}, {first_task, second_task})
        self.assertIsNone(self.api("/claim", first, {})[1]["job"])
        job = claimed[0]
        retry_task = job["id"]
        for _ in range(3):
            self.api(f"/jobs/{job['id']}/release", first, {"lease": job["lease"]})
            answer = self.api("/claim", first, {})[1]["job"]
            if answer:
                job = answer
        self.assertEqual(
            json.loads(self.request("/api/tasks/" + retry_task)[1])["status"], "failed"
        )
        # Reserved output space prevents another request from consuming its capacity.
        used = json.loads(self.request("/api/cloud/summary")[1])["used_bytes"]
        key = "users/" + self.user["id"] + "/quota-fixture"
        self.db(
            "INSERT INTO assets VALUES(?,?,?,?)",
            (key, self.user["id"], "fixture", 200_000_000 - used),
        )
        try:
            code = self.request(
                "/api/separate",
                fields={"engine": "worker", "stems_mode": "2stems"},
                filename="quota.wav",
                content=self.fixture,
            )[0]
            self.assertEqual(code, 413)
        finally:
            self.db("DELETE FROM assets WHERE object_key=?", (key,))


class WorkerParallelTests(WorkerQueueHelpers, HttpHarness):
    def test_parallel_slots_are_atomic_bounded_and_independently_leased(self):
        tasks = [self.enqueue() for _ in range(3)]
        identity, token = self.worker()
        def claim(slot):
            return self.api("/claim", token, {"profiles":["vocals-pro"],"parallelism":2,"slot":slot})[1]["job"]
        with ThreadPoolExecutor(2) as pool:
            jobs = list(pool.map(claim, [0,1]))
        self.assertEqual({j["id"] for j in jobs}, set(tasks[:2]))
        self.assertEqual({j["worker_slot"] for j in jobs}, {0,1})
        self.assertIsNone(claim(0))
        self.assertIsNone(claim(1))
        self.assertEqual(self.api("/claim",token,{"parallelism":2,"slot":2})[0],422)
        self.assertEqual(self.api("/claim",token,{"parallelism":5})[0],422)
        # An older client cannot add a third job to an already busy machine.
        self.assertIsNone(self.api("/claim",token,{"profiles":["vocals-pro"]})[1]["job"])
        fleet = self.api("/queue", token, method="GET")[1]["workers"]
        self.assertEqual(next(w for w in fleet if w["id"]==identity)["active_jobs"],2)
        self.assertNotIn("worker_slot",json.loads(self.request("/api/tasks/"+jobs[0]["id"])[1]))
        for index,job in enumerate(jobs):
            self.assertEqual(self.api("/heartbeat",token,{"task_id":job["id"],"lease":job["lease"],"progress":40+index})[0],200)
        self.assertEqual(self.api("/heartbeat",token,{"task_id":jobs[0]["id"],"lease":jobs[1]["lease"]})[0],409)
        # Cancelling one slot leaves the other slot valid and lets it receive another job.
        self.request("/api/tasks/"+jobs[0]["id"]+"/cancel",method="POST")
        self.assertEqual(self.api("/heartbeat",token,{"task_id":jobs[1]["id"],"lease":jobs[1]["lease"]})[0],200)
        replacement=claim(jobs[0]["worker_slot"])
        self.assertEqual(replacement["id"],tasks[2])
        self.assertEqual(self.api("/heartbeat",token,{"task_id":jobs[0]["id"],"lease":jobs[0]["lease"]})[0],409)

    def test_duplicate_slot_claims_do_not_take_two_jobs(self):
        tasks = [self.enqueue() for _ in range(2)]
        _, token = self.worker()
        with ThreadPoolExecutor(2) as pool:
            jobs=list(pool.map(lambda _: self.api("/claim",token,{"profiles":["vocals-pro"],"parallelism":2,"slot":0})[1]["job"],range(2)))
        self.assertEqual(sum(j is not None for j in jobs),1)
        self.assertIn(next(j for j in jobs if j)["id"],tasks)



class CustomerQueueStatusTests(WorkerQueueHelpers, HttpHarness):
    def task(self, identity):
        code, raw, _ = self.request('/api/tasks/'+identity)
        self.assertEqual(code,200,raw)
        return json.loads(raw)

    def test_customer_queue_position_is_anonymous_and_owner_scoped(self):
        first, second, foreign = self.enqueue(), self.enqueue(), self.enqueue()
        other=str(uuid.uuid4())
        self.db("INSERT INTO users(id,email,name,password,created_at) SELECT ?,?,'Other account',password,created_at FROM users WHERE id=?",(other,'other@example.test',self.user['id']))
        self.db("UPDATE stem_jobs SET owner_id=? WHERE id=?",(other,foreign))
        self.addCleanup(self.db, "UPDATE stem_jobs SET status='cancelled' WHERE id=?", (foreign,))
        a,b=self.task(first),self.task(second)
        self.assertEqual(a['queue']['position'],1)
        self.assertEqual(b['queue']['position'],2)
        self.assertEqual(a['queue']['waiting'],3)
        self.assertEqual(a['queue']['phase'],'waiting_worker')
        self.assertEqual(set(a['queue']),{'phase','position','waiting','processing','elapsed_seconds','heartbeat_age_seconds','worker_online','checked_at'})
        self.assertGreaterEqual(a['queue']['elapsed_seconds'],0)
        self.assertNotIn(foreign,json.dumps(a['queue']))
        self.assertEqual(self.request('/api/tasks/'+foreign)[0],404)
        history=json.loads(self.request('/api/tasks')[1])
        self.assertNotIn(foreign,{x['id'] for x in history})
        self.assertEqual(next(x for x in history if x['id']==second)['queue']['position'],2)

    def test_phase_heartbeat_and_terminal_status_are_truthful(self):
        import time
        task=self.enqueue();_,token=self.worker()
        self.api('/heartbeat',token,{'device':'test','accepting':True})
        self.assertEqual(self.task(task)['queue']['phase'],'waiting')
        job=self.api('/claim',token,{})[1]['job']
        preparing=self.task(task)['queue']
        self.assertEqual(preparing['phase'],'preparing')
        self.assertIsNone(preparing['position'])
        self.assertLess(preparing['heartbeat_age_seconds'],5)
        self.api('/heartbeat',token,{'task_id':task,'lease':job['lease'],'progress':30,'phase':'separating'})
        self.assertEqual(self.task(task)['queue']['phase'],'separating')
        self.db('UPDATE stem_jobs SET lease_until=? WHERE id=?',(time.time()+90,task))
        delayed=self.task(task)['queue']
        self.assertEqual(delayed['phase'],'reconnecting')
        self.assertGreaterEqual(delayed['heartbeat_age_seconds'],89)
        self.api('/heartbeat',token,{'task_id':task,'lease':job['lease'],'progress':92,'phase':'uploading'})
        self.assertEqual(self.task(task)['queue']['phase'],'uploading')
        self.assertEqual(self.upload_results(token,job)[0],200)
        self.assertNotIn('queue',self.task(task))

    def test_staging_has_no_fake_queue_rank_or_heartbeat(self):
        task=self.enqueue()
        self.db("UPDATE stem_jobs SET status='staging' WHERE id=?",(task,))
        info=self.task(task)
        self.assertEqual(info['status'],'queued')
        self.assertEqual(info['queue']['phase'],'preparing_source')
        self.assertIsNone(info['queue']['position'])
        self.assertIsNone(info['queue']['heartbeat_age_seconds'])
