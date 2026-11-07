"""Bounded, process-isolated operator slots with one shared machine identity."""

import json
import os
import re
import signal
import subprocess
import sys
import time
from pathlib import Path


def command(*args):
    return subprocess.check_output(
        args, text=True, stderr=subprocess.DEVNULL, timeout=3
    ).strip()


def hardware_limit(memory_bytes, chip, cores):
    gib = memory_bytes / 1024**3
    limit = 1 if gib < 12 else 2 if gib < 24 else 3 if gib < 48 else 4
    # Base Apple GPUs and small CPUs benefit from a more conservative ceiling.
    if not any(kind in chip.lower() for kind in ("pro", "max", "ultra")):
        limit = min(limit, 2)
    return min(limit, 1 if cores < 8 else 4)


def hardware():
    try:
        memory = int(command("/usr/sbin/sysctl", "-n", "hw.memsize"))
        chip = command("/usr/sbin/sysctl", "-n", "machdep.cpu.brand_string")
    except (OSError, ValueError, subprocess.SubprocessError):
        memory, chip = 8 * 1024**3, "Unknown processor"
    cores = os.cpu_count() or 1
    return {
        "memory_gb": round(memory / 1024**3),
        "chip": chip,
        "cores": cores,
        "hardware_limit": hardware_limit(memory, chip, cores),
    }


def memory_state():
    try:
        pressure = int(
            command("/usr/sbin/sysctl", "-n", "kern.memorystatus_vm_pressure_level")
        )
        match = re.search(
            r"System-wide memory free percentage:\s*(\d+)%",
            command("/usr/bin/memory_pressure", "-Q"),
        )
        return {"pressure": pressure, "free_percent": int(match[1]) if match else None}
    except (OSError, ValueError, subprocess.SubprocessError):
        return {"pressure": None, "free_percent": None}


def capacity(limit, requested, memory):
    if (
        not isinstance(requested, int)
        or isinstance(requested, bool)
        or not 0 <= requested <= 4
    ):
        requested = 0
    chosen = min(limit, requested or limit)
    free, pressure = memory.get("free_percent"), memory.get("pressure")
    if pressure is None or free is None:
        return min(chosen, 1), "อ่านสถานะ RAM ไม่ได้ · รับครั้งละ 1 งาน"
    if pressure >= 4 or free < 10:
        return 0, "พักรับงานใหม่ชั่วคราว · RAM กำลังตึง"
    if pressure > 1 or free < 25:
        return min(chosen, 1), "ลดการรับงานใหม่เหลือ 1 งาน · รอ RAM ว่าง"
    return chosen, ""


class WorkerPool:
    def __init__(self, config, root, worker_type):
        self.config, self.root = config, root
        self.observer = worker_type(config, root)
        self.stop = self.observer.stop
        self.spec = hardware()
        self.children = {}
        self.logs = {}
        self.restarts = {}
        self.memory = memory_state()
        self.target = None
        self.reduced_at = 0

    def write(self, name, data):
        # Only the coordinator writes these files; child statuses live per-slot.
        target = self.root / name
        temp = target.with_suffix(".tmp")
        temp.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")
        temp.chmod(0o600)
        temp.replace(target)

    def read(self, path):
        try:
            return json.loads(path.read_text())
        except (OSError, ValueError):
            return {}

    def update_capacity(self):
        control = self.read(self.root / "control.json")
        requested = control.get("parallel_jobs", 0)
        desired, reason = capacity(self.spec["hardware_limit"], requested, self.memory)
        now = time.monotonic()
        if self.target is None or desired < self.target:
            self.target = desired
            self.reduced_at = now
        elif desired > self.target and now - self.reduced_at >= 20:
            self.target = desired
        if desired > self.target:
            reason = "รอ RAM นิ่งก่อนเพิ่มงานใหม่"
        self.write(
            "pool-control.json", {"parallelism": self.target, "updated_at": time.time()}
        )
        return {
            **self.spec,
            **self.memory,
            "requested": requested,
            "parallelism": self.target,
            "reason": reason,
        }

    def start_child(self, slot):
        folder = self.root / "slots" / str(slot)
        folder.mkdir(parents=True, exist_ok=True, mode=0o700)
        old = self.children.get(slot)
        if old:
            try:
                os.killpg(old.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
        if slot in self.logs:
            self.logs[slot].close()
        (folder / "status.json").unlink(missing_ok=True)
        logfile = (folder / "agent.log").open("ab")
        self.logs[slot] = logfile
        self.restarts[slot] = time.monotonic()
        self.children[slot] = subprocess.Popen(
            [
                sys.executable,
                str(Path(__file__).with_name("agent.py")),
                "--config",
                str(self.root / "config.json"),
                "--slot",
                str(slot),
            ],
            stdin=subprocess.DEVNULL,
            stdout=logfile,
            stderr=logfile,
            start_new_session=True,
        )

    def snapshot(self, settings):
        active, errors = [], []
        for slot, child in self.children.items():
            data = self.read(self.root / "slots" / str(slot) / "status.json")
            if (
                child.poll() is None
                and data.get("state") == "working"
                and data.get("task_id")
            ):
                active.append({**data, "slot": slot})
            elif data.get("state") == "error" and slot < self.target:
                errors.append(data)
        paused = self.observer.paused()
        if active:
            state, message = (
                "working",
                f"กำลังทำ {len(active)} งาน · รับได้ {self.target} งานพร้อมกัน",
            )
            if paused:
                message += " · พักรับงานใหม่"
        elif paused:
            state, message = "paused", "พักรับงาน · งานใหม่จะรอในคิว"
        elif settings["reason"]:
            state, message = "ready", settings["reason"]
        elif errors:
            state, message = "error", errors[0]["message"]
        else:
            state, message = "ready", f"พร้อมรับงาน · สูงสุด {self.target} งานพร้อมกัน"
        self.write(
            "status.json",
            {
                "state": state,
                "message": message,
                "active_jobs": active,
                "capacity": settings,
                "filename": active[0]["filename"] if len(active) == 1 else "",
                "task_id": active[0]["task_id"] if len(active) == 1 else None,
                "device": "mlx",
                "progress": active[0]["progress"] if len(active) == 1 else 0,
                "updated_at": time.time(),
            },
        )
        return active

    def run(self):
        import threading

        watcher = threading.Thread(target=self.observer.watch_queue, daemon=True)
        watcher.start()
        awake = None
        refreshed = 0
        try:
            while not self.stop.is_set():
                if time.monotonic() - refreshed > 5:
                    self.memory = memory_state()
                    refreshed = time.monotonic()
                settings = self.update_capacity()
                for slot in range(self.spec["hardware_limit"]):
                    if slot not in self.children or (
                        self.children[slot].poll() is not None
                        and time.monotonic() - self.restarts[slot] >= 15
                    ):
                        self.start_child(slot)
                active = self.snapshot(settings)
                should_stay_awake = bool(active) or (
                    not self.observer.paused() and self.target > 0
                )
                if should_stay_awake and awake is None and sys.platform == "darwin":
                    awake = subprocess.Popen(
                        ["/usr/bin/caffeinate", "-i", "-w", str(os.getpid())]
                    )
                elif not should_stay_awake and awake:
                    awake.terminate()
                    awake.wait(timeout=5)
                    awake = None
                self.stop.wait(2)
        finally:
            self.stop.set()
            for child in self.children.values():
                try:
                    os.killpg(child.pid, signal.SIGTERM)
                except ProcessLookupError:
                    pass
            for child in self.children.values():
                try:
                    child.wait(timeout=15)
                except subprocess.TimeoutExpired:
                    try:
                        os.killpg(child.pid, signal.SIGKILL)
                    except ProcessLookupError:
                        pass
                    child.wait()
            if awake:
                awake.terminate()
                awake.wait(timeout=5)
            watcher.join(timeout=3)
            for logfile in self.logs.values():
                logfile.close()
            self.write(
                "status.json",
                {
                    "state": "stopped",
                    "message": "หยุดรับงานแล้ว",
                    "active_jobs": [],
                    "task_id": None,
                    "updated_at": time.time(),
                },
            )
