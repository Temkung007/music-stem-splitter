"""Hardware ceilings, memory backoff and independent per-job cache ownership."""

import importlib.util
import json
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

spec = importlib.util.spec_from_file_location(
    "pool", Path(__file__).resolve().parents[2] / "worker/pool.py"
)
pool = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pool)
agent_spec = importlib.util.spec_from_file_location(
    "agent", Path(__file__).resolve().parents[2] / "worker/agent.py"
)
agent = importlib.util.module_from_spec(agent_spec)
agent_spec.loader.exec_module(agent)


class WorkerPoolTests(unittest.TestCase):
    def test_hardware_ceilings_and_explicit_choice(self):
        for gb, chip, cores, expected in [
            (8, "Apple M1", 8, 1),
            (16, "Apple M5", 10, 2),
            (32, "Apple M5", 10, 2),
            (24, "Apple M4 Pro", 12, 3),
            (64, "Apple M4 Max", 16, 4),
            (64, "Unknown", 4, 1),
        ]:
            self.assertEqual(pool.hardware_limit(gb * 1024**3, chip, cores), expected)
        normal = {"pressure": 1, "free_percent": 50}
        self.assertEqual(pool.capacity(2, 0, normal)[0], 2)
        self.assertEqual(pool.capacity(2, 1, normal)[0], 1)
        self.assertEqual(pool.capacity(2, 4, normal)[0], 2)

    def test_memory_pressure_stops_new_claims_and_recovers_slowly(self):
        self.assertEqual(pool.capacity(4, 0, {"pressure": 2, "free_percent": 40})[0], 1)
        self.assertEqual(pool.capacity(4, 0, {"pressure": 1, "free_percent": 20})[0], 1)
        self.assertEqual(pool.capacity(4, 0, {"pressure": 4, "free_percent": 40})[0], 0)
        self.assertEqual(pool.capacity(4, 0, {"pressure": 1, "free_percent": 5})[0], 0)
        self.assertEqual(
            pool.capacity(4, 0, {"pressure": None, "free_percent": None})[0], 1
        )
        with (
            tempfile.TemporaryDirectory() as folder,
            patch.object(pool, "hardware", return_value={"hardware_limit": 2}),
            patch.object(
                pool, "memory_state", return_value={"pressure": 1, "free_percent": 50}
            ),
        ):
            root = Path(folder)
            observer = Mock()
            observer.stop = threading.Event()
            manager = pool.WorkerPool({}, root, Mock(return_value=observer))
            self.assertEqual(manager.update_capacity()["parallelism"], 2)
            manager.memory = {"pressure": 2, "free_percent": 30}
            self.assertEqual(manager.update_capacity()["parallelism"], 1)
            manager.memory = {"pressure": 1, "free_percent": 50}
            self.assertEqual(manager.update_capacity()["parallelism"], 1)
            manager.reduced_at -= 21
            self.assertEqual(manager.update_capacity()["parallelism"], 2)
            self.assertEqual((root / "pool-control.json").stat().st_mode & 0o777, 0o600)

    def test_shared_cache_pruning_skips_another_active_slot(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / "slots/0").mkdir(parents=True)
            (root / "slots/1").mkdir()
            config = {
                "server_url": "https://stemora.example",
                "token": "test-only",
                "device": "cpu",
            }
            first = agent.Worker(config, root / "slots/0", root, 0)
            second = agent.Worker(config, root / "slots/1", root, 1)
            import os
            import time
            import uuid

            identity = str(uuid.uuid4())
            cached = root / "results" / identity
            cached.mkdir(parents=True)
            (cached / "ready.json").write_text("{}")
            os.utime(cached, (time.time() - 90000,) * 2)
            with first.result_lock(identity):
                second.prune_cache(root / "results" / "current")
                self.assertTrue(cached.exists())
            second.prune_cache(root / "results" / "current")
            self.assertFalse(cached.exists())

    def test_pool_gate_never_claims_disabled_slot(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / "pool-control.json").write_text(json.dumps({"parallelism": 1}))
            worker = agent.Worker(
                {
                    "server_url": "https://stemora.example",
                    "token": "test-only",
                    "device": "cpu",
                },
                root / "slots/1",
                root,
                1,
            )
            worker.api.request = Mock()
            self.assertFalse(worker.run_one())
            worker.api.request.assert_not_called()

    def test_stale_coordinator_blocks_new_claims(self):
        import time

        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            worker = agent.Worker(
                {
                    "server_url": "https://stemora.example",
                    "token": "test-only",
                    "device": "cpu",
                },
                root / "slots/0",
                root,
                0,
            )
            (root / "pool-control.json").write_text(
                json.dumps({"parallelism": 2, "updated_at": time.time()})
            )
            self.assertEqual(worker.parallelism(), 2)
            (root / "pool-control.json").write_text(
                json.dumps({"parallelism": 2, "updated_at": time.time() - 30})
            )
            worker.api.request = Mock()
            self.assertFalse(worker.run_one())
            worker.api.request.assert_not_called()

    def test_lowering_capacity_keeps_both_running_jobs_visible(self):
        with (
            tempfile.TemporaryDirectory() as folder,
            patch.object(pool, "hardware", return_value={"hardware_limit": 2}),
            patch.object(
                pool, "memory_state", return_value={"pressure": 1, "free_percent": 50}
            ),
        ):
            root = Path(folder)
            observer = Mock()
            observer.stop = threading.Event()
            observer.paused.return_value = False
            manager = pool.WorkerPool({}, root, Mock(return_value=observer))
            manager.target = 1
            for slot in (0, 1):
                child = Mock()
                child.poll.return_value = None
                manager.children[slot] = child
                path = root / "slots" / str(slot)
                path.mkdir(parents=True)
                (path / "status.json").write_text(
                    json.dumps(
                        {
                            "state": "working",
                            "task_id": str(slot),
                            "filename": f"Job {slot}.wav",
                            "progress": 40,
                            "device": "mlx",
                        }
                    )
                )
            active = manager.snapshot({"reason": "RAM pressure", "parallelism": 1})
            self.assertEqual(len(active), 2)
            data = json.loads((root / "status.json").read_text())
            self.assertEqual(data["state"], "working")
            self.assertEqual(len(data["active_jobs"]), 2)
            for child in manager.children.values():
                child.terminate.assert_not_called()
