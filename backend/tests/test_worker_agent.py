"""Worker transport failures must retry the same upload, not the entire song."""

import importlib.util
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

spec = importlib.util.spec_from_file_location(
    "stemora_agent", Path(__file__).resolve().parents[2] / "worker/agent.py"
)
agent = importlib.util.module_from_spec(spec)
spec.loader.exec_module(agent)


class WorkerTransportTests(unittest.TestCase):
    def test_long_upload_heartbeat_stays_within_server_contract(self):
        import tempfile
        with tempfile.TemporaryDirectory() as folder:
            worker=agent.Worker({"server_url":"https://stemora.example","token":"test-only","device":"cpu"},Path(folder))
            worker.job={"id":"test-job","lease":"test-lease"}
            worker.progress=99
            worker.phase="uploading"
            def response(*args):
                worker.stop.set()
                return {"ok":True}
            worker.api.request=Mock(side_effect=response)
            worker.heartbeat()
            body=worker.api.request.call_args.args[1]
            self.assertEqual(body['progress'],95)
            self.assertEqual(body['phase'],'uploading')
            self.assertEqual(body['task_id'],'test-job')

    def api(self):
        return agent.API(
            {"server_url": "https://stemora.example", "token": "test-only"}
        )

    def connection(self, status=200):
        connection = Mock()
        response = connection.getresponse.return_value
        response.status = status
        response.read.return_value = b'{"offset":4}'
        return connection

    @patch.object(agent.time, "sleep")
    def test_connect_timeout_retries_identical_upload(self, sleep):
        api = self.api()
        connection = self.connection()
        api.connection = Mock(side_effect=[TimeoutError("connect"), connection])
        self.assertEqual(
            api.request(
                "/jobs/test/files/vocals.wav?offset=0",
                b"wav!",
                method="PUT",
                lease="lease",
            ),
            {"offset": 4},
        )
        self.assertEqual(api.connection.call_count, 2)
        args, kwargs = connection.request.call_args
        self.assertEqual(
            args, ("PUT", "/api/worker/jobs/test/files/vocals.wav?offset=0")
        )
        self.assertEqual(kwargs["body"], b"wav!")
        self.assertEqual(kwargs["headers"]["X-Stemora-Lease"], "lease")
        connection.close.assert_called_once()

    @patch.object(agent.time, "sleep")
    def test_response_timeout_replays_same_chunk(self, sleep):
        api = self.api()
        first, second = self.connection(), self.connection()
        first.getresponse.side_effect = TimeoutError("response")
        api.connection = Mock(side_effect=[first, second])
        api.request("/jobs/test/files/vocals.wav?offset=4000000", b"wav!", method="PUT")
        self.assertEqual(first.request.call_args, second.request.call_args)
        first.close.assert_called_once()
        second.close.assert_called_once()

    @patch.object(agent.time, "sleep")
    def test_connect_failure_has_bounded_retries(self, sleep):
        api = self.api()
        api.connection = Mock(side_effect=TimeoutError("connect"))
        with self.assertRaises(TimeoutError):
            api.request("/heartbeat", {})
        self.assertEqual(api.connection.call_count, 3)

    @patch.object(agent.time, "sleep")
    def test_revoked_lease_is_not_retried(self, sleep):
        api = self.api()
        api.connection = Mock(return_value=self.connection(409))
        with self.assertRaises(agent.APIError):
            api.request("/jobs/test/files/vocals.wav?offset=0", b"wav!", method="PUT")
        api.connection.assert_called_once()
        sleep.assert_not_called()


class WorkerResultCacheTests(unittest.TestCase):
    def setUp(self):
        import tempfile
        import uuid

        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.job = {
            "id": str(uuid.uuid4()),
            "filename": "fixture.wav",
            "stems_mode": "2stems",
            "duration": 1,
            "source_sha256": "source-digest",
            "lease": "first-lease",
        }
        self.worker = agent.Worker(
            {
                "server_url": "https://stemora.example",
                "token": "test-only",
                "device": "cpu",
            },
            self.root,
        )
        self.folder = self.root / "results" / self.job["id"]
        self.folder.mkdir(parents=True)
        self.prepare()

    def prepare(self):
        for name in agent.MODES["2stems"]:
            (self.folder / (name + ".wav")).write_bytes((name * 5).encode())
        agent.atomic_json(
            self.folder / "ready.json",
            {
                "source_sha256": self.job["source_sha256"],
                "mode": "2stems",
                "device": "cpu",
                "files": {
                    n: agent.hashlib.sha256(
                        (self.folder / (n + ".wav")).read_bytes()
                    ).hexdigest()
                    for n in agent.MODES["2stems"]
                },
            },
        )

    def sender(self, path, body, **kwargs):
        if "/files/" in path:
            offset = int(path.rsplit("=", 1)[1])
            return {"offset": offset + len(body)}
        return {"status": "completed"}

    def test_cache_does_not_cross_ai_profiles(self):
        self.assertTrue(self.worker.cache_valid(self.folder, self.job))
        upgraded = {**self.job, "processing_profile": "vocals-pro"}
        self.assertFalse(self.worker.cache_valid(self.folder, upgraded))

    def test_incomplete_vocal_runtime_does_not_advertise_capability(self):
        self.assertEqual(self.worker.profiles(), ["stems-standard"])

    def test_restart_reuses_verified_stems_without_inference(self):
        worker = self.worker
        worker.api.request = Mock(return_value={"job": self.job})
        worker.prepare_results = Mock(
            side_effect=AssertionError("must not run inference again")
        )
        worker.send_request = Mock(side_effect=self.sender)
        self.assertTrue(worker.run_one())
        worker.prepare_results.assert_not_called()
        self.assertFalse(self.folder.exists())

    def test_partial_upload_resumes_same_lease_and_resets_new_lease(self):
        w = self.worker
        w.job = self.job
        calls = []

        def fail_second(path, body, **kwargs):
            calls.append(path)
            if "no_vocals.wav" in path:
                raise TimeoutError("network offline")
            return self.sender(path, body, **kwargs)

        w.send_request = Mock(side_effect=fail_second)
        with self.assertRaises(TimeoutError):
            w.upload_results(self.job, self.folder)
        self.assertTrue(w.cache_valid(self.folder, self.job))
        w.send_request = Mock(side_effect=self.sender)
        w.upload_results(self.job, self.folder)
        self.assertFalse(
            any("/vocals.wav" in c.args[0] for c in w.send_request.call_args_list)
        )
        new_job = {**self.job, "lease": "new-lease"}
        w.send_request.reset_mock()
        w.upload_results(new_job, self.folder)
        self.assertTrue(
            any(
                "/vocals.wav?offset=0" in c.args[0]
                for c in w.send_request.call_args_list
            )
        )

    def test_tampering_or_different_source_rejects_cache(self):
        self.assertTrue(self.worker.cache_valid(self.folder, self.job))
        self.assertFalse(
            self.worker.cache_valid(self.folder, {**self.job, "source_sha256": "other"})
        )
        (self.folder / "vocals.wav").write_bytes(b"tampered")
        self.assertFalse(self.worker.cache_valid(self.folder, self.job))

    def test_network_failure_keeps_results_for_next_claim(self):
        w = self.worker
        w.api.request = Mock(side_effect=[{"job": self.job}, {"ok": True}])
        w.upload_results = Mock(side_effect=TimeoutError("network offline"))
        with self.assertRaises(TimeoutError):
            w.run_one()
        self.assertTrue(w.cache_valid(self.folder, self.job))
        self.assertIsNone(w.job)


class WorkerQueueSnapshotTests(unittest.TestCase):
    def test_refresh_and_network_failure_keep_last_private_snapshot(self):
        import json
        import tempfile
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            worker = agent.Worker({"server_url":"https://stemora.example", "token":"test-only", "device":"cpu"}, root)
            worker.api.request = Mock(return_value={"counts":{"waiting":2,"processing":0,"preparing":0}, "items":[{"id":"test","filename":"queued.wav"}]})
            worker.refresh_queue()
            first = json.loads((root/"queue.json").read_text())
            self.assertFalse(first["stale"])
            self.assertEqual((root/"queue.json").stat().st_mode & 0o777, 0o600)
            worker.api.request.assert_called_once_with("/queue", method="GET")
            worker.api.request = Mock(side_effect=TimeoutError("offline"))
            worker.refresh_queue()
            failed = json.loads((root/"queue.json").read_text())
            self.assertTrue(failed["stale"])
            self.assertEqual(failed["items"], first["items"])
            self.assertEqual(failed["updated_at"], first["updated_at"])
