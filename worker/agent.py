"""STEMORA operator worker. No inbound listener, arbitrary commands, or customer credentials."""

import argparse
import contextlib
import hashlib
import http.client
import ipaddress
import json
import os
import re
import shutil
import signal
import socket
import ssl
import subprocess
import sys
import threading
import time
import traceback
import uuid
import wave
from pathlib import Path
from urllib.parse import urlsplit

import certifi

# Demucs 4.0.1's CLI omits clip=none even though its audio API supports it.
# Write float intermediates without per-stem gain; the export stage applies one
# shared headroom gain across all files.
CPU_RUNNER = """import demucs.separate as module
original_save = module.save_audio
def save_unscaled(*args, **kwargs):
    kwargs["clip"] = "none"
    return original_save(*args, **kwargs)
module.save_audio = save_unscaled
module.main()
"""

ROOT = Path.home() / "Library/Application Support/STEMORA Worker"
MODES = {
    "4stems": ["vocals", "drums", "bass", "other"],
    "2stems": ["vocals", "no_vocals"],
}


def atomic_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temp = path.with_suffix(".tmp")
    temp.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")
    temp.chmod(0o600)
    temp.replace(path)


class APIError(Exception):
    def __init__(self, status):
        self.status = status
        super().__init__(f"Worker API returned {status}")


class API:
    def __init__(self, config):
        self.url = urlsplit(config["server_url"].rstrip("/"))
        if self.url.path or self.url.query or self.url.fragment or self.url.username:
            raise ValueError("Server URL must be a plain HTTPS origin")
        if self.url.scheme != "https" and not (
            self.url.scheme == "http"
            and self.url.hostname in {"localhost", "127.0.0.1"}
        ):
            raise ValueError("HTTPS is required")
        self.token = config["token"]
        self.origin_ip = config.get("origin_ip")
        if self.origin_ip:
            ipaddress.ip_address(self.origin_ip)

    def connection(self):
        if self.url.scheme == "http":
            return http.client.HTTPConnection(
                self.url.hostname, self.url.port, timeout=60
            )
        context = ssl.create_default_context(cafile=certifi.where())
        connection = http.client.HTTPSConnection(
            self.url.hostname, self.url.port, timeout=60, context=context
        )
        if self.origin_ip:
            # Direct origin routing retains the public hostname, SNI and certificate validation.
            connection.sock = context.wrap_socket(
                socket.create_connection(
                    (self.origin_ip, self.url.port or 443), timeout=60
                ),
                server_hostname=self.url.hostname,
            )
        return connection

    def request(self, path, body=None, method="POST", lease=None, destination=None):
        headers = {
            "Authorization": "Bearer " + self.token,
            "User-Agent": "STEMORA-Worker/1.0",
            "Accept-Language": "en",
        }
        if lease:
            headers["X-Stemora-Lease"] = lease
        if body is not None and not isinstance(body, bytes):
            body = json.dumps(body).encode()
            headers["Content-Type"] = "application/json"
        elif isinstance(body, bytes):
            headers["Content-Type"] = "application/octet-stream"
        for attempt in range(3):
            connection = None
            try:
                # Establishing TCP/TLS can also time out. Keep it inside the
                # retry boundary so an upload retries its identical bytes and
                # offset instead of releasing the job and repeating inference.
                connection = self.connection()
                # http.client deliberately does not follow redirects with worker credentials.
                connection.request(
                    method, "/api/worker" + path, body=body, headers=headers
                )
                response = connection.getresponse()
                if not 200 <= response.status < 300:
                    raise APIError(response.status)
                if destination:
                    total = 0
                    with destination.open("wb") as output:
                        while block := response.read(1024 * 1024):
                            total += len(block)
                            if total > 50_000_000:
                                raise ValueError("Source exceeds worker limit")
                            output.write(block)
                    return total
                raw = response.read(2_000_001)
                if len(raw) > 2_000_000:
                    raise ValueError("Worker response exceeds limit")
                return json.loads(raw)
            except APIError as error:
                if error.status < 500 or attempt == 2:
                    raise
            except (OSError, http.client.HTTPException):
                if attempt == 2:
                    raise
            finally:
                if connection is not None:
                    connection.close()
            time.sleep(1 + attempt)


class Worker:
    def __init__(self, config, root, control_root=None, slot=0):
        self.config, self.root = config, root
        self.control_root = control_root or root
        self.slot = slot
        self.pooled = control_root is not None
        self.api = API(config)
        self.stop = threading.Event()
        self.lost = threading.Event()
        self.job = None
        self.child = None
        self.progress = 5
        self.phase = "preparing"
        self.device = config.get("device", "auto")
        if self.device == "auto":
            import torch

            self.device = (
                "cuda"
                if torch.cuda.is_available()
                else "mps"
                if torch.backends.mps.is_available()
                else "cpu"
            )
        if self.device not in {"mps", "cuda", "cpu"}:
            raise ValueError("Invalid processing device")
        self.active_device = self.device
        self.mlx_process = None
        self.mlx_log = None
        self.engine_kind = None
        self.vocal_ready = None

    def paused(self):
        try:
            control = json.loads((self.control_root / "control.json").read_text())
        except (OSError, ValueError):
            control = {}
        hour = time.localtime().tm_hour
        start, end = control.get("start_hour", 0), control.get("end_hour", 0)
        scheduled = start == end or (
            start <= hour < end if start < end else hour >= start or hour < end
        )
        return bool(control.get("paused", False)) or not scheduled

    def parallelism(self):
        if not self.pooled:
            return 1
        try:
            data = json.loads((self.control_root / "pool-control.json").read_text())
            if time.time() - data.get("updated_at", 0) > 15:
                return 0  # Coordinator stopped; finish existing jobs without claiming more.
            return max(0, min(4, int(data["parallelism"])))
        except (OSError, ValueError, KeyError, TypeError):
            return 0

    def accepting(self):
        return not self.paused() and self.parallelism() > 0

    @property
    def results_root(self):
        return self.control_root / "results"

    @contextlib.contextmanager
    def result_lock(self, identity):
        import fcntl

        locks = self.control_root / "result-locks"
        locks.mkdir(exist_ok=True, mode=0o700)
        with (locks / (identity + ".lock")).open("a") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            yield

    def status(self, state, message):
        atomic_json(
            self.root / "status.json",
            {
                "state": state,
                "message": message,
                "device": self.active_device,
                "filename": self.job["filename"] if self.job else "",
                "progress": self.progress if self.job else 0,
                "task_id": self.job["id"] if self.job else None,
                "phase": self.phase,
                "slot": self.slot,
                "updated_at": time.time(),
            },
        )

    def refresh_queue(self):
        path = self.root / "queue.json"
        try:
            snapshot = self.api.request("/queue", method="GET")
            snapshot.update(updated_at=time.time(), stale=False)
            atomic_json(path, snapshot)
        except Exception:
            try:
                snapshot = json.loads(path.read_text())
            except (OSError, ValueError):
                snapshot = {"counts": {}, "items": [], "updated_at": 0}
            snapshot.update(stale=True, checked_at=time.time())
            atomic_json(path, snapshot)

    def watch_queue(self):
        while not self.stop.is_set():
            self.refresh_queue()
            self.stop.wait(10)

    def heartbeat(self):
        last_success = time.monotonic()
        while not self.stop.is_set():
            try:
                body = {
                    "device": self.active_device,
                    "accepting": self.accepting(),
                    "phase": self.phase,
                    "progress": min(95, max(5, self.progress)),
                }
                job = self.job
                if job:
                    body.update(task_id=job["id"], lease=job["lease"])
                self.api.request("/heartbeat", body)
                last_success = time.monotonic()
            except APIError as error:
                if error.status in {401, 403, 409} and self.job:
                    self.lost.set()
            except Exception:
                if time.monotonic() - last_success > 90 and self.job:
                    self.lost.set()
            self.stop.wait(20)

    def execute(self, command, log_path, timeout=1800):
        started = time.monotonic()
        with log_path.open("wb") as log:
            self.child = subprocess.Popen(
                command,
                stdout=log,
                stderr=log,
                env={
                    **os.environ,
                    "PYTORCH_ENABLE_MPS_FALLBACK": "1",
                    "OMP_NUM_THREADS": "4",
                },
            )
            while self.child.poll() is None:
                if (
                    self.stop.is_set()
                    or self.lost.is_set()
                    or time.monotonic() - started > timeout
                ):
                    self.child.terminate()
                    try:
                        self.child.wait(timeout=5)
                    except subprocess.TimeoutExpired:
                        self.child.kill()
                        self.child.wait()
                    raise RuntimeError("Job interrupted or timed out")
                if self.phase == "separating":
                    try:
                        with log_path.open("rb") as stream:
                            stream.seek(max(0, log_path.stat().st_size - 2048))
                            matches = re.findall(rb"(\d+)%\|", stream.read())
                        if matches:
                            self.progress = max(
                                self.progress,
                                min(85, 20 + int(matches[-1]) * 65 // 100),
                            )
                    except OSError:
                        pass
                    self.status("working", "กำลังแยกเสียง")
                self.stop.wait(1)
            return self.child.returncode

    def quality(self):
        try:
            return json.loads((self.control_root / "control.json").read_text()).get(
                "quality", "standard"
            )
        except (OSError, ValueError):
            return "standard"

    def close_engine(self):
        if self.mlx_process is not None:
            if self.mlx_process.poll() is None:
                self.mlx_process.terminate()
                try:
                    self.mlx_process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    self.mlx_process.kill()
                    self.mlx_process.wait()
            self.mlx_process = None
        if self.mlx_log:
            self.mlx_log.close()
            self.mlx_log = None

    def profiles(self):
        if self.vocal_ready is None:
            python = self.config.get("vocal_python", "")
            weights = Path(self.config.get("vocal_weights", "/nonexistent"))
            self.vocal_ready = False
            if python and Path(python).is_file() and (weights / "model.safetensors").is_file():
                try:
                    # Pinned safe-tensor checkpoint; do not advertise a half-installed engine.
                    self.vocal_ready = hashlib.sha256((weights / "model.safetensors").read_bytes()).hexdigest() == "312c38e5b698f8dfaa4d6064e8f79010744825828917871a9d22673a43eb7fe5"
                    if self.vocal_ready:
                        self.vocal_ready = subprocess.run(
                            [python, "-c", "from mlx_audio.sts.models.mel_roformer import MelRoFormer"],
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=60,
                        ).returncode == 0
                except (OSError, subprocess.TimeoutExpired):
                    self.vocal_ready = False
        return ["stems-standard", "vocals-pro"] if self.vocal_ready else ["stems-standard"]

    def run_vocals(self, source, folder):
        if "vocals-pro" not in self.profiles():
            raise RuntimeError("Vocal engine is unavailable; this job must not be downgraded")
        canonical = folder / "mixture.wav"
        if self.execute([self.config.get("ffmpeg", "ffmpeg"), "-y", "-nostdin", "-v", "error",
                         "-i", str(source), "-ar", "44100", "-ac", "2", "-c:a", "pcm_f32le", str(canonical)], folder / "decode.log"):
            raise RuntimeError("Audio decoding failed")
        if self.engine_kind != "vocals" or self.mlx_process is None or self.mlx_process.poll() is not None:
            self.close_engine()
            self.mlx_log = (self.root / "vocal-engine.log").open("wb")
            self.mlx_process = subprocess.Popen(
                [self.config["vocal_python"], str(Path(__file__).with_name("vocal_runner.py"))],
                stdin=subprocess.PIPE, stdout=self.mlx_log, stderr=self.mlx_log,
                env={**os.environ, "HF_HUB_OFFLINE": "1"},
            )
            self.engine_kind = "vocals"
        result = folder / "vocal-result.json"
        result.unlink(missing_ok=True)
        self.mlx_process.stdin.write((json.dumps({"source": str(canonical), "folder": str(folder),
                                                  "weights": self.config["vocal_weights"]}) + "\n").encode())
        self.mlx_process.stdin.flush()
        self.active_device = "mlx"
        started = time.monotonic()
        while not result.exists():
            if self.stop.is_set() or self.lost.is_set() or time.monotonic() - started > 1800:
                self.close_engine()
                raise RuntimeError("Job interrupted or timed out")
            if self.mlx_process.poll() is not None:
                self.close_engine()
                raise RuntimeError("Vocal engine stopped")
            try:
                self.progress = max(self.progress, min(85, json.loads((folder / "vocal-progress.json").read_text())["progress"]))
            except (OSError, ValueError, KeyError):
                pass
            self.status("working", "กำลังแยกเสียงร้องด้วย GPU")
            self.stop.wait(0.5)
        canonical.unlink(missing_ok=True)
        if not json.loads(result.read_text()).get("ok"):
            raise RuntimeError("Vocal separation failed")
        return True

    def run_mlx(self, source, folder, model):
        python = self.config.get("mlx_python")
        script = Path(__file__).with_name("mlx_runner.py")
        if not python or not Path(python).is_file() or not script.is_file():
            return False
        if self.engine_kind != "demucs" or self.mlx_process is None or self.mlx_process.poll() is not None:
            self.close_engine()
            self.mlx_log = (self.root / "mlx-engine.log").open("wb")
            self.mlx_process = subprocess.Popen(
                [python, str(script)],
                stdin=subprocess.PIPE,
                stdout=self.mlx_log,
                stderr=self.mlx_log,
                env={**os.environ, "DEMUCS_MLX_NO_DOWNLOAD": "1"},
            )
        self.engine_kind = "demucs"
        result = folder / "mlx-result.json"
        result.unlink(missing_ok=True)
        self.mlx_log.seek(0)
        self.mlx_log.truncate()
        self.mlx_process.stdin.write(
            (
                json.dumps(
                    {
                        "source": str(source),
                        "folder": str(folder),
                        "mode": self.job["stems_mode"],
                        "model": model,
                    }
                )
                + "\n"
            ).encode()
        )
        self.mlx_process.stdin.flush()
        self.active_device = "mlx"
        self.status("working", "กำลังแยกเสียงด้วย GPU")
        started = time.monotonic()
        while not result.exists():
            if (
                self.stop.is_set()
                or self.lost.is_set()
                or time.monotonic() - started > 1800
            ):
                self.close_engine()
                raise RuntimeError("Job interrupted or timed out")
            if self.mlx_process.poll() is not None:
                self.close_engine()
                return False
            self.stop.wait(0.5)
        return json.loads(result.read_text()).get("ok", False)

    def cache_valid(self, folder, job):
        try:
            data = json.loads((folder / "ready.json").read_text())
            if (
                data["source_sha256"] != job["source_sha256"]
                or data["mode"] != job["stems_mode"]
                or data.get("processing_profile", "stems-standard") != job.get("processing_profile", "stems-standard")
            ):
                return False
            if set(data["files"]) != set(MODES[job["stems_mode"]]):
                return False
            for name, digest in data["files"].items():
                path = folder / (name + ".wav")
                if (
                    path.is_symlink()
                    or hashlib.sha256(path.read_bytes()).hexdigest() != digest
                ):
                    return False
            return True
        except (OSError, ValueError, KeyError):
            return False

    def prune_cache(self, current):
        cache = self.results_root
        cache.mkdir(exist_ok=True, mode=0o700)
        entries = []
        for folder in cache.iterdir():
            if folder == current or folder.is_symlink() or not folder.is_dir():
                continue
            try:
                uuid.UUID(folder.name)
            except ValueError:
                continue
            try:
                with self.result_lock(folder.name):
                    size = sum(p.stat().st_size for p in folder.rglob("*") if p.is_file())
                    entries.append((folder.stat().st_mtime, size, folder))
            except (BlockingIOError, OSError):
                continue
        total = sum(x[1] for x in entries)
        for modified, size, folder in sorted(entries):
            if time.time() - modified > 86400 or total > 800_000_000:
                try:
                    with self.result_lock(folder.name):
                        shutil.rmtree(folder)
                        total -= size
                except BlockingIOError:
                    # Another slot is actively using this verified cache.
                    continue

    def prepare_results(self, job, folder):
        suffix = Path(job["filename"]).suffix.lower()
        if suffix not in {".mp3", ".wav", ".flac", ".m4a", ".aac", ".ogg"}:
            raise ValueError("Unsupported source type")
        source = folder / ("source" + suffix)
        size = self.api.request(
            f"/jobs/{job['id']}/source",
            method="GET",
            lease=job["lease"],
            destination=source,
        )
        if (
            size != job["source_bytes"]
            or hashlib.sha256(source.read_bytes()).hexdigest() != job["source_sha256"]
        ):
            raise ValueError("Source checksum mismatch")
        self.phase, self.progress = "separating", 20
        model = "htdemucs_ft" if self.quality() == "high" else "htdemucs"
        raw = folder / "raw"
        if job.get("processing_profile") == "vocals-pro":
            model = "mel-roformer"
            mlx = self.run_vocals(source, folder)
        else:
            mlx = self.config.get("backend") == "mlx" and self.run_mlx(source, folder, model)
        if not mlx:
            if self.stop.is_set() or self.lost.is_set():
                raise RuntimeError("Worker lease lost")
            self.status("working", "กำลังใช้ตัวประมวลผลสำรอง")
            devices = [self.device, "cpu"] if self.device != "cpu" else ["cpu"]
            for device in devices:
                self.active_device = device
                command = [
                    sys.executable,
                    "-c",
                    CPU_RUNNER,
                    "-n",
                    model,
                    "-d",
                    device,
                    "--shifts",
                    "2" if model == "htdemucs_ft" else "1",
                    "--overlap",
                    "0.5" if model == "htdemucs_ft" else "0.25",
                    "--float32",
                    "-j",
                    "1",
                    "-o",
                    str(raw),
                ]
                if job["stems_mode"] == "2stems":
                    command.extend(["--two-stems", "vocals"])
                command.append(str(source))
                if self.execute(command, folder / "separate.log") == 0:
                    break
            else:
                raise RuntimeError("Separation failed on available devices")
        export_gain = 1.0
        if not mlx:
            import soundfile as sf
            peak = 0.0
            for name in MODES[job["stems_mode"]]:
                for block in sf.blocks(raw / model / "source" / (name + ".wav"), blocksize=65536):
                    value = float(abs(block).max())
                    if not (0 <= value < float("inf")):
                        raise ValueError("Non-finite worker output")
                    peak = max(peak, value)
            export_gain = min(1.0, 0.99 / max(peak, 1e-12))
        self.phase, self.progress = "uploading", 88
        self.status("working", "กำลังเตรียมแทร็คส่งกลับ Cloud")
        for name in MODES[job["stems_mode"]]:
            original = raw / model / "source" / (name + ".wav")
            normalized = folder / (name + ".wav")
            if self.execute(
                [
                    self.config.get("ffmpeg", "ffmpeg"),
                    "-y",
                    "-nostdin",
                    "-v",
                    "error",
                    "-protocol_whitelist",
                    "file,pipe",
                    "-i",
                    str(original),
                    "-af",
                    f"volume={export_gain:.12g}",
                    "-ac",
                    "2",
                    "-ar",
                    "44100",
                    "-c:a",
                    "pcm_s16le",
                    "-map_metadata",
                    "-1",
                    "-fflags",
                    "+bitexact",
                    "-flags:a",
                    "+bitexact",
                    str(normalized),
                ],
                folder / "convert.log",
                timeout=120,
            ):
                raise RuntimeError("Result conversion failed")
            with wave.open(str(normalized)) as audio:
                if (
                    audio.getnchannels(),
                    audio.getsampwidth(),
                    audio.getframerate(),
                ) != (2, 2, 44100):
                    raise ValueError("Invalid canonical WAV")
                if abs(audio.getnframes() / 44100 - job["duration"]) > 0.25:
                    raise ValueError("Result duration mismatch")
        atomic_json(
            folder / "ready.json",
            {
                "source_sha256": job["source_sha256"],
                "mode": job["stems_mode"],
                "processing_profile": job.get("processing_profile", "stems-standard"),
                "model": model,
                "device": self.active_device,
                "files": {
                    name: hashlib.sha256(
                        (folder / (name + ".wav")).read_bytes()
                    ).hexdigest()
                    for name in MODES[job["stems_mode"]]
                },
            },
        )
        source.unlink(missing_ok=True)
        shutil.rmtree(raw)

    def send_request(self, path, body, **kwargs):
        started = time.monotonic()
        while True:
            if self.stop.is_set() or self.lost.is_set():
                raise RuntimeError("Worker lease lost")
            try:
                return self.api.request(path, body, **kwargs)
            except (OSError, http.client.HTTPException, APIError) as error:
                if isinstance(error, APIError) and error.status < 500:
                    raise
                if time.monotonic() - started > 300:
                    raise
                self.status("working", "รอเชื่อมต่อ · เก็บผลไว้ส่งต่อแล้ว")
                self.stop.wait(5)

    def upload_results(self, job, folder):
        self.phase, self.progress = "uploading", 88
        self.status("working", "กำลังส่งแทร็คกลับ Cloud")
        lease_hash = hashlib.sha256(job["lease"].encode()).hexdigest()
        try:
            upload = json.loads((folder / "upload.json").read_text())
        except (OSError, ValueError):
            upload = {}
        if upload.get("lease_hash") != lease_hash:
            upload = {"lease_hash": lease_hash, "offsets": {}}
        expected = sum(
            (folder / (name + ".wav")).stat().st_size
            for name in MODES[job["stems_mode"]]
        )
        uploaded = 0
        for name in MODES[job["stems_mode"]]:
            path = folder / (name + ".wav")
            offset = upload["offsets"].get(name, 0)
            if not isinstance(offset, int) or not 0 <= offset <= path.stat().st_size:
                raise ValueError("Invalid saved upload offset")
            uploaded += offset
            with path.open("rb") as audio:
                audio.seek(offset)
                while chunk := audio.read(4_000_000):
                    answer = self.send_request(
                        f"/jobs/{job['id']}/files/{name}.wav?offset={offset}",
                        chunk,
                        method="PUT",
                        lease=job["lease"],
                    )
                    offset += len(chunk)
                    if answer["offset"] != offset:
                        raise ValueError("Upload offset mismatch")
                    upload["offsets"][name] = offset
                    atomic_json(folder / "upload.json", upload)
                    uploaded += len(chunk)
                    self.progress = min(98, 88 + uploaded * 10 // max(1, expected))
                    self.status("working", "กำลังส่งแทร็คกลับ Cloud")
        self.progress = 99
        self.status("working", "กำลังบันทึกผลใน Cloud")
        self.send_request(f"/jobs/{job['id']}/complete", {"lease": job["lease"]})
        self.status("completed", "ส่งแทร็คกลับ Cloud แล้ว")

    def run_one(self):
        parallelism = self.parallelism()
        if self.slot >= parallelism:
            return False
        result = self.api.request("/claim", {"profiles": self.profiles(), "parallelism": parallelism, "slot": self.slot})
        job = result.get("job")
        if not job:
            return False
        if (
            str(uuid.UUID(job["id"])) != job["id"]
            or job["stems_mode"] not in MODES
            or not 0 < job["duration"] <= 600
            or job.get("processing_profile", "stems-standard") not in self.profiles()
            or (job.get("processing_profile") == "vocals-pro" and job["stems_mode"] != "2stems")
        ):
            raise ValueError("Invalid job description")
        self.job, self.phase, self.progress = job, "preparing", 10
        self.lost.clear()
        folder = self.results_root / job["id"]
        try:
            with self.result_lock(job["id"]):
                self.prune_cache(folder)
                if folder.is_symlink():
                    raise ValueError("Invalid result directory")
                if self.cache_valid(folder, job):
                    self.active_device = json.loads((folder / "ready.json").read_text())[
                        "device"
                    ]
                    self.status("working", "ใช้ผลที่แยกไว้แล้ว · กำลังส่งต่อ")
                    os.utime(folder, None)
                else:
                    if folder.exists():
                        shutil.rmtree(folder)
                    folder.mkdir(mode=0o700)
                    self.status("working", "กำลังรับเพลงจากคิว")
                    self.prepare_results(job, folder)
                self.upload_results(job, folder)
                shutil.rmtree(folder)
        except Exception:
            try:
                self.api.request(f"/jobs/{job['id']}/release", {"lease": job["lease"]})
            except Exception:
                pass
            raise
        finally:
            self.job = None
        return True

    def run(self, once=False, watch=True, manage_awake=True):
        thread = threading.Thread(target=self.heartbeat, daemon=True)
        thread.start()
        queue_thread = threading.Thread(target=self.watch_queue, daemon=True)
        if watch:
            queue_thread.start()
        awake = None
        try:
            while not self.stop.is_set():
                try:
                    if self.paused() or self.slot >= self.parallelism():
                        self.close_engine()
                        if awake:
                            awake.terminate()
                            awake.wait(timeout=5)
                            awake = None
                        self.status("paused", "พักรับงาน · งานใหม่จะรอในคิว")
                    else:
                        if manage_awake and awake is None and sys.platform == "darwin":
                            awake = subprocess.Popen(
                                ["/usr/bin/caffeinate", "-i", "-w", str(os.getpid())]
                            )
                        self.status("ready", "พร้อมรับงานจาก STEMORA")
                        if self.run_one():
                            if once:
                                return
                            continue
                    if once:
                        return
                except APIError as error:
                    self.status(
                        "error",
                        "เชื่อมต่อไม่ได้ ตรวจสิทธิ์เครื่องประมวลผล"
                        if error.status in {401, 403}
                        else "เชื่อมต่อไม่ได้ กำลังลองใหม่",
                    )
                    if once:
                        raise
                except Exception:
                    traceback.print_exc()
                    self.status("error", "งานถูกขัดจังหวะ ระบบเก็บคิวไว้และจะลองใหม่")
                    if once:
                        raise
                self.stop.wait(5)
        finally:
            self.stop.set()
            self.close_engine()
            if awake:
                awake.terminate()
                awake.wait(timeout=5)
            thread.join(timeout=3)
            if watch:
                queue_thread.join(timeout=3)
            self.status("stopped", "หยุดรับงานแล้ว")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", type=Path, default=ROOT / "config.json")
    parser.add_argument("--once", action="store_true")
    parser.add_argument("--slot", type=int, choices=range(4))
    args = parser.parse_args()
    os.umask(0o077)
    control_root = args.config.parent
    root = control_root if args.slot is None else control_root / "slots" / str(args.slot)
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    # Only one agent can claim work for this computer, including app relaunches.
    import fcntl

    with (root / "agent.lock").open("w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        config = json.loads(args.config.read_text())
        if args.slot is None and not args.once:
            from pool import WorkerPool
            worker = WorkerPool(config, root, Worker)
        else:
            worker = Worker(config, root, control_root if args.slot is not None else None, args.slot or 0)
        signal.signal(signal.SIGTERM, lambda *_: worker.stop.set())
        signal.signal(signal.SIGINT, lambda *_: worker.stop.set())
        if args.slot is not None:
            worker.run(watch=False, manage_awake=False)
        elif args.once:
            worker.run(once=True)
        else:
            worker.run()


if __name__ == "__main__":
    main()
