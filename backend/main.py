"""STEMORA: local audio separation, explicit processing modes, and stem delivery."""

import asyncio
import importlib.util
import json
import logging
import math
import re
import unicodedata
import os
import shutil
import struct
import subprocess
import sys
import tempfile
import threading
import uuid
import wave
import zipfile
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path

import worker_jobs
import processing_quota
from auth import current_user, mutation_guard, rate_limit
from auth import router as auth_router
from client_uploads import cleanup_stages
from client_uploads import create_router as create_client_upload_router
from cloud import USER_QUOTA, recover_interrupted, track_for
from cloud import router as cloud_router
from database import connect, lock_writes
from fastapi import (
    BackgroundTasks,
    Depends,
    FastAPI,
    File,
    Form,
    HTTPException,
    Request,
    UploadFile,
)
from fastapi.responses import FileResponse, JSONResponse
from i18n import LocalizedJSONResponse, language, preferred_language
from playlists import router as playlists_router
from starlette.background import BackgroundTask
from starlette.exceptions import HTTPException as StarletteHTTPException
from storage import storage

logger = logging.getLogger("stemora")


@asynccontextmanager
async def lifespan(app):
    recover_interrupted()
    cleanup_stages()
    await asyncio.to_thread(worker_jobs.maintenance)

    async def clean_uploads():
        while True:
            await asyncio.sleep(30)
            try:
                cleanup_stages()
                await asyncio.to_thread(worker_jobs.maintenance)
            except Exception:
                logger.exception("Temporary upload and worker cleanup will retry")

    cleanup_task = asyncio.create_task(clean_uploads())
    try:
        yield
    finally:
        cleanup_task.cancel()
        try:
            await cleanup_task
        except asyncio.CancelledError:
            pass


app = FastAPI(
    title="STEMORA API",
    version="3.0.0",
    lifespan=lifespan,
    default_response_class=LocalizedJSONResponse,
)
app.include_router(auth_router)
app.include_router(cloud_router)
app.include_router(playlists_router)


@app.exception_handler(StarletteHTTPException)
async def localized_error(request: Request, error: StarletteHTTPException):
    return LocalizedJSONResponse(
        {"detail": error.detail}, status_code=error.status_code, headers=error.headers
    )


@app.middleware("http")
async def private_workspace(request: Request, call_next):
    locale = preferred_language(request.headers.get("accept-language"))
    token = language.set(locale)
    try:
        try:
            if (
                request.url.path.startswith("/api/")
                and request.url.path != "/api/health"
                and not request.url.path.startswith("/api/auth/")
                and not request.url.path.startswith("/api/worker/")
            ):
                current_user(request)
                if request.method not in {"GET", "HEAD", "OPTIONS"}:
                    mutation_guard(request)
            response = await call_next(request)
        except HTTPException as error:
            response = LocalizedJSONResponse(
                {"detail": error.detail}, status_code=error.status_code
            )
        response.headers["Cache-Control"] = "private, no-store"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Content-Language"] = locale
        response.headers["Vary"] = ", ".join(
            filter(None, [response.headers.get("Vary"), "Accept-Language"])
        )
        return response
    finally:
        language.reset(token)


BASE_DIR = Path(os.environ.get("STEMORA_DATA_DIR", Path(__file__).resolve().parent))
UPLOAD_DIR, OUTPUT_DIR = BASE_DIR / "uploads", BASE_DIR / "separated"
for directory in (UPLOAD_DIR, OUTPUT_DIR):
    directory.mkdir(parents=True, exist_ok=True)
MAX_BYTES = 50_000_000
MAX_DURATION = 600
EXTENSIONS = {".mp3", ".wav", ".flac", ".m4a", ".aac", ".ogg"}
MODES = {
    "4stems": ["vocals", "drums", "bass", "other"],
    "2stems": ["vocals", "no_vocals"],
}
MODELS = {"htdemucs", "htdemucs_ft"}
TASKS: dict[str, dict] = {}
WORKER = asyncio.Semaphore(1)


def save_task(task: dict):
    folder = OUTPUT_DIR / task["id"]
    folder.mkdir(exist_ok=True)
    temporary = folder / "task.tmp"
    temporary.write_text(json.dumps(task, ensure_ascii=False))
    temporary.replace(folder / "task.json")


for manifest in OUTPUT_DIR.glob("*/task.json"):
    try:
        task = json.loads(manifest.read_text())
        if task["status"] in {"queued", "processing"}:
            processing_quota.refund(task["id"])
            task.update(status="failed", message="เซิร์ฟเวอร์หยุดระหว่างประมวลผล กรุณาเริ่มใหม่")
            save_task(task)
        TASKS[task["id"]] = task
    except (ValueError, KeyError, OSError):
        logger.warning("Could not restore %s", manifest)


def get_device():
    try:
        import torch

        if torch.cuda.is_available():
            return "cuda"
        if torch.backends.mps.is_available():
            return "mps"
    except ImportError:
        pass
    return "cpu"


def demucs_available():
    return importlib.util.find_spec("demucs") is not None


@app.get("/api/health")
def health():
    try:
        with connect() as db:
            db.execute("SELECT 1").fetchone()
    except Exception:
        return JSONResponse(
            {"status": "unavailable", "database_available": False}, status_code=503
        )
    return {
        "status": "online",
        "database_available": True,
        "demucs_available": demucs_available(),
        "ffmpeg_available": shutil.which("ffmpeg") is not None
        and shutil.which("ffprobe") is not None,
        "device": get_device(),
        "max_bytes": MAX_BYTES,
        "max_duration": MAX_DURATION,
        **worker_jobs.summary(),
    }


def probe(path: Path):
    result = subprocess.run(
        [
            "ffprobe",
            "-protocol_whitelist",
            "file,pipe",
            "-v",
            "error",
            "-select_streams",
            "a:0",
            "-show_entries",
            "stream=sample_rate,channels:format=duration,format_name",
            "-of",
            "json",
            str(path),
        ],
        capture_output=True,
        timeout=30,
        check=True,
    )
    data = json.loads(result.stdout)
    if not data.get("streams"):
        raise ValueError("ไม่พบแทร็คเสียงในไฟล์")
    if not set(data["format"].get("format_name", "").split(",")).intersection(
        {"mp3", "wav", "flac", "mov", "mp4", "m4a", "aac", "ogg"}
    ):
        raise ValueError("รองรับไฟล์เสียงโดยตรงเท่านั้น")
    duration = float(data["format"]["duration"])
    if not math.isfinite(duration) or duration <= 0 or duration > MAX_DURATION:
        raise ValueError("รองรับเพลงความยาวไม่เกิน 10 นาที")
    return {"duration": duration, "sample_rate": int(data["streams"][0]["sample_rate"])}


def waveform(path: Path, count=140):
    result = subprocess.run(
        [
            "ffmpeg",
            "-v",
            "error",
            "-i",
            str(path),
            "-ac",
            "1",
            "-ar",
            "1000",
            "-f",
            "f32le",
            "-",
        ],
        capture_output=True,
        check=True,
        timeout=60,
    )
    samples = [abs(v[0]) for v in struct.iter_unpack("f", result.stdout)]
    peaks = [
        max(
            samples[i * len(samples) // count : (i + 1) * len(samples) // count],
            default=0,
        )
        for i in range(count)
    ]
    maximum = max(peaks, default=0) or 1
    return [round(p / maximum, 3) for p in peaks]


def dsp_separate(path: Path, folder: Path, mode: str):
    # These are frequency/spatial previews, not isolated instruments.
    filters = {
        "vocals": "stereotools=mlev=1:slev=0.1,highpass=f=250,lowpass=f=4000",
        "bass": "lowpass=f=180",
        "drums": "equalizer=f=80:width_type=o:width=1:g=4,equalizer=f=10000:width_type=o:width=1:g=3,equalizer=f=1000:width_type=o:width=2:g=-10",
        "other": "stereotools=mlev=0.4:slev=1,highpass=f=180",
        "no_vocals": "stereotools=mlev=0.15:slev=1",
    }
    for name in MODES[mode]:
        subprocess.run(
            [
                "ffmpeg",
                "-v",
                "error",
                "-y",
                "-i",
                str(path),
                "-ac",
                "2",
                "-ar",
                "44100",
                "-af",
                filters[name],
                "-c:a",
                "pcm_s16le",
                str(folder / f"{name}.wav"),
            ],
            capture_output=True,
            check=True,
            timeout=180,
        )


def make_demo(folder: Path, mode: str):
    """Generate actual separate synth parts; the demo does not claim AI separation."""
    rate, seconds = 22050, 12
    parts = {
        name: bytearray()
        for name in ["vocals", "drums", "bass", "other", "no_vocals", "original"]
    }
    notes = [261.63, 329.63, 392, 440, 392, 329.63, 293.66, 329.63]
    for i in range(rate * seconds):
        t = i / rate
        beat = t % 0.5
        envelope = min(1, t * 8, (seconds - t) * 8)
        lead = (
            0.19
            * math.sin(2 * math.pi * notes[int(t * 2) % 8] * t)
            * math.exp(-5 * beat)
        )
        bass = (
            0.24
            * math.sin(2 * math.pi * [65.406, 55, 43.654, 49][int(t / 3)] * t)
            * math.exp(-3 * beat)
        )
        kick = (
            0.3
            * math.sin(2 * math.pi * (55 * beat + 6 * (1 - math.exp(-30 * beat))))
            * math.exp(-24 * beat)
        )
        hat = 0.045 * math.sin(2 * math.pi * 7231 * t) * math.exp(-65 * (t % 0.25))
        pad = 0.055 * sum(
            math.sin(2 * math.pi * f * t) for f in (130.813, 164.814, 196)
        )
        values = {
            "vocals": lead,
            "drums": kick + hat,
            "bass": bass,
            "other": pad,
            "no_vocals": kick + hat + bass + pad,
            "original": lead + kick + hat + bass + pad,
        }
        for key, value in values.items():
            sample = struct.pack("<h", int(max(-1, min(1, value * envelope)) * 32767))
            parts[key].extend(sample * 2)
    for name in [*MODES[mode], "original"]:
        with wave.open(str(folder / f"{name}.wav"), "wb") as output:
            output.setparams((2, 2, rate, 0, "NONE", "not compressed"))
            output.writeframes(parts[name])


def new_task(filename, mode, engine, model="htdemucs", owner_id=None):
    if (
        owner_id
        and sum(
            1
            for task in TASKS.values()
            if task.get("owner_id") == owner_id
            and task["status"] in {"queued", "processing"}
        )
        >= 3
    ):
        raise HTTPException(429, "มีงานแยกเสียงรออยู่มากเกินไป กรุณารอให้งานเดิมเสร็จก่อน")
    task_id = str(uuid.uuid4())
    task = {
        "id": task_id,
        "owner_id": owner_id,
        "filename": filename,
        "stems_mode": mode,
        "engine": engine,
        "model_name": model,
        "status": "queued",
        "progress": 5,
        "message": "รอประมวลผล",
        "stems": {},
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    TASKS[task_id] = task
    save_task(task)
    return task


async def run_demucs(task: dict, source: Path, raw: Path):
    preferred = get_device()
    devices = [preferred, "cpu"] if preferred != "cpu" else ["cpu"]
    for device in devices:
        task["device"] = device
        if device != preferred:
            task["message"] = "กำลังปรับการประมวลผลและลองแยกเสียงอีกครั้ง"
        cmd = [
            sys.executable,
            "-m",
            "demucs.separate",
            "-n",
            task["model_name"],
            "-d",
            device,
            "-o",
            str(raw),
        ]
        if task["stems_mode"] == "2stems":
            cmd.extend(["--two-stems", "vocals"])
        cmd.append(str(source))
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.PIPE,
            env={**os.environ, "PYTORCH_ENABLE_MPS_FALLBACK": "1"},
        )
        try:
            _, stderr = await asyncio.wait_for(proc.communicate(), timeout=1800)
        except (asyncio.TimeoutError, asyncio.CancelledError):
            proc.kill()
            await proc.wait()
            raise ValueError("AI หยุดทำงานหรือใช้เวลาเกิน 30 นาที กรุณาลองไฟล์ที่สั้นลง")
        if proc.returncode == 0:
            return
        logger.error(
            "Demucs failed on %s: %s", device, stderr.decode(errors="replace")[-2000:]
        )
    raise ValueError("AI ประมวลผลไม่สำเร็จ กรุณาลองใหม่หรือติดต่อผู้ดูแล")


def task_out_files(task_id):
    folder = OUTPUT_DIR / task_id
    return [*folder.glob("*.wav"), *folder.glob("*.zip")]


async def process(task_id: str, source: Path | None = None):
    task = TASKS[task_id]
    folder = OUTPUT_DIR / task_id
    raw = OUTPUT_DIR / f"{task_id}_raw"
    try:
        async with WORKER:
            task.update(status="processing", progress=15, message="กำลังเตรียมแทร็คเสียง")
            save_task(task)
            if task["engine"] == "demo":
                await asyncio.to_thread(make_demo, folder, task["stems_mode"])
                source = folder / "original.wav"
            elif task["engine"] == "demucs":
                task.update(progress=30, message="กำลังแยกเสียงด้วย AI อาจใช้เวลาสักครู่")
                await run_demucs(task, source, raw)
                for name in MODES[task["stems_mode"]]:
                    shutil.move(
                        str(raw / task["model_name"] / source.stem / f"{name}.wav"),
                        str(folder / f"{name}.wav"),
                    )
            else:
                task.update(progress=30, message="กำลังแยกย่านเสียงด้วย DSP (ไม่ใช่ AI)")
                await asyncio.to_thread(
                    dsp_separate, source, folder, task["stems_mode"]
                )
            task.update(progress=85, message="กำลังสร้าง waveform และเตรียมดาวน์โหลด")
            task.update(await asyncio.to_thread(probe, source))
            stems = {}
            for name in MODES[task["stems_mode"]]:
                path = folder / f"{name}.wav"
                if not path.is_file():
                    raise ValueError("ประมวลผลแทร็คไม่ครบ กรุณาลองใหม่")
                stems[name] = {
                    "filename": path.name,
                    "url": f"/api/stems/{task_id}/{path.name}",
                    "peaks": await asyncio.to_thread(waveform, path),
                    "size_bytes": path.stat().st_size,
                }
            archive = folder / "stems.zip"

            def pack():
                with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as bundle:
                    for name in stems:
                        bundle.write(folder / f"{name}.wav", f"{name}.wav")

            await asyncio.to_thread(pack)
            # Originals stay in the music library; generated stems live in private object storage.
            keys = [
                (
                    f"users/{task['owner_id']}/stems/{task_id}/{stem['filename']}",
                    stem["size_bytes"],
                )
                for stem in stems.values()
            ]
            keys.append(
                (
                    f"users/{task['owner_id']}/stems/{task_id}/stems.zip",
                    archive.stat().st_size,
                )
            )
            with connect() as db:
                lock_writes(db)
                used = db.execute(
                    "SELECT COALESCE(SUM(size_bytes),0) FROM (SELECT size_bytes FROM tracks WHERE user_id=? UNION ALL SELECT size_bytes FROM assets WHERE user_id=?) AS quota_rows",
                    (task["owner_id"], task["owner_id"]),
                ).fetchone()[0]
                if used + sum(size for _, size in keys) > USER_QUOTA:
                    raise ValueError("พื้นที่จัดเก็บไม่พอสำหรับแทร็คผลลัพธ์ กรุณาติดต่อผู้ดูแลเพื่อเพิ่มพื้นที่")
                db.executemany(
                    "INSERT INTO assets VALUES(?,?,?,?)",
                    [(key, task["owner_id"], task_id, size) for key, size in keys],
                )
            for stem in stems.values():
                key = f"users/{task['owner_id']}/stems/{task_id}/{stem['filename']}"
                await asyncio.to_thread(storage.put, folder / stem["filename"], key)
                stem["object_key"] = key
            archive_key = f"users/{task['owner_id']}/stems/{task_id}/stems.zip"
            await asyncio.to_thread(storage.put, archive, archive_key)
            task["archive_key"] = archive_key
            task.update(
                status="completed",
                progress=100,
                message="แทร็คของคุณพร้อมแล้ว",
                stems=stems,
            )
    except Exception as error:
        processing_quota.refund(task_id)
        logger.exception("Task %s failed", task_id)
        task.update(
            status="failed",
            progress=0,
            message=str(error)
            if isinstance(error, ValueError)
            else "ไม่สามารถประมวลผลเสียงได้ กรุณาตรวจสอบไฟล์แล้วลองใหม่",
        )
    finally:
        if task["status"] == "failed":
            with connect() as db:
                failed_keys = [
                    row[0]
                    for row in db.execute(
                        "SELECT object_key FROM assets WHERE task_id=?", (task_id,)
                    ).fetchall()
                ]
            for key in failed_keys:
                try:
                    await asyncio.to_thread(storage.delete, key)
                except Exception:
                    logger.warning("Object cleanup will need retry for %s", task_id)
            with connect() as db:
                db.execute("DELETE FROM assets WHERE task_id=?", (task_id,))
        save_task(task)
        if task["status"] in {"completed", "failed"}:
            for path in task_out_files(task_id):
                path.unlink(missing_ok=True)
        if source and source.parent == UPLOAD_DIR:
            source.unlink(missing_ok=True)
        shutil.rmtree(raw, ignore_errors=True)


@app.post("/api/separate", status_code=202)
async def separate(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    stems_mode: str = Form("4stems"),
    model_name: str = Form("htdemucs"),
    engine: str = Form("demucs"),
    user=Depends(current_user),
    storage_mode: str = Form("cloud"),
    request_id: str = Form(""),
):
    if (
        stems_mode not in MODES
        or model_name not in MODELS
        or engine not in {"demucs", "dsp", "worker"}
    ):
        raise HTTPException(422, "ตัวเลือกการแยกเสียงไม่ถูกต้อง")
    if not (shutil.which("ffmpeg") and shutil.which("ffprobe")):
        raise HTTPException(503, "กรุณาติดตั้ง FFmpeg ก่อนใช้งาน")
    if engine == "demucs" and not demucs_available():
        raise HTTPException(503, "ยังไม่ได้ติดตั้ง AI เลือกโหมด DSP หรือติดตั้ง AI ก่อน")
    filename = Path((file.filename or "audio").replace("\\", "/")).name
    if Path(filename).suffix.lower() not in EXTENSIONS:
        raise HTTPException(415, "รองรับเฉพาะ MP3, WAV, FLAC, M4A, AAC และ OGG")
    temporary = UPLOAD_DIR / f"{uuid.uuid4()}{Path(filename).suffix.lower()}"
    try:
        size = 0
        with temporary.open("wb") as output:
            while chunk := await file.read(1024 * 1024):
                size += len(chunk)
                if size > MAX_BYTES:
                    raise HTTPException(413, "ไฟล์ต้องมีขนาดไม่เกิน 50 MB")
                output.write(chunk)
        if size == 0:
            raise HTTPException(422, "ไฟล์นี้ไม่มีข้อมูลเสียง")
        try:
            metadata = await asyncio.to_thread(probe, temporary)
        except ValueError as error:
            raise HTTPException(422, str(error)) from error
        except (subprocess.SubprocessError, KeyError) as error:
            raise HTTPException(
                422, "ไฟล์เสียงเสียหายหรืออ่านไม่ได้ กรุณาเลือกไฟล์ใหม่"
            ) from error
        if engine == "worker":
            rate_limit("worker-enqueue:" + user["id"], 30)
            result = await asyncio.to_thread(
                worker_jobs.enqueue,
                filename,
                stems_mode,
                metadata,
                temporary,
                user["id"],
                storage_mode,
                request_id,
            )
            temporary.unlink(missing_ok=True)
            return result
        task = new_task(filename, stems_mode, engine, model_name, user["id"])
        try:
            with connect() as db:
                lock_writes(db)
                processing_quota.reserve(db, task["id"], user["id"], metadata["duration"], charged=True)
        except Exception:
            TASKS.pop(task["id"], None)
            shutil.rmtree(OUTPUT_DIR / task["id"], ignore_errors=True)
            raise
        task.update(metadata)
        save_task(task)
        background_tasks.add_task(process, task["id"], temporary)
        return {"task_id": task["id"], "filename": filename, "status": "queued"}
    except Exception:
        temporary.unlink(missing_ok=True)
        raise
    finally:
        await file.close()


@app.post("/api/demo-audio", status_code=202)
def demo(
    background_tasks: BackgroundTasks,
    stems_mode: str = Form("4stems"),
    user=Depends(current_user),
):
    if stems_mode not in MODES:
        raise HTTPException(422, "โหมดไม่ถูกต้อง")
    if not (shutil.which("ffmpeg") and shutil.which("ffprobe")):
        raise HTTPException(503, "กรุณาติดตั้ง FFmpeg ก่อนใช้งาน")
    task = new_task("Midnight in motion.wav", stems_mode, "demo", owner_id=user["id"])
    background_tasks.add_task(process, task["id"])
    return {"task_id": task["id"], "filename": task["filename"], "status": "queued"}


def owned_task(task_id, user_id):
    remote = worker_jobs.get(task_id, user_id)
    if remote:
        return remote
    task = TASKS.get(task_id)
    if not task or task.get("owner_id") != user_id or task.get("status") in {"deleted", "deleting"}:
        raise HTTPException(404, "ไม่พบงานนี้ กรุณาเริ่มใหม่")
    return task


def public_task(task):
    result = {
        k: v
        for k, v in task.items()
        if k not in {"owner_id", "model_name", "archive_key", "device", "client_id"}
    }
    result["stems"] = {
        name: {k: v for k, v in stem.items() if k != "object_key"}
        for name, stem in task["stems"].items()
    }
    return result


def validate_client_wav(path):
    """Accept only the bounded, canonical stereo PCM16 WAV produced by our worker."""
    try:
        with path.open("rb") as source:
            header = source.read(44)
        if len(header) != 44:
            raise ValueError
        if (
            header[:4] != b"RIFF"
            or header[8:16] != b"WAVEfmt "
            or header[36:40] != b"data"
            or struct.unpack_from("<IHHIIHH", header, 16)
            != (16, 1, 2, 44100, 176400, 4, 16)
        ):
            raise ValueError
        size = path.stat().st_size
        frames = struct.unpack_from("<I", header, 40)[0] // 4
        if (
            not 0 < frames <= 44100 * MAX_DURATION
            or size != 44 + frames * 4
            or struct.unpack_from("<I", header, 4)[0] != size - 8
            or struct.unpack_from("<I", header, 40)[0] != size - 44
        ):
            raise ValueError
        return frames
    except (OSError, ValueError, struct.error) as error:
        raise HTTPException(
            422, "แทร็คต้องเป็น WAV stereo 44.1 kHz 16-bit ที่สมบูรณ์และยาวไม่เกิน 10 นาที"
        ) from error


@app.post("/api/client-stems", dependencies=[Depends(mutation_guard)])
async def import_client_stems(
    files: list[UploadFile] = File(...),
    filename: str = Form(...),
    client_id: str = Form(...),
    stems_mode: str = Form("4stems"),
    user=Depends(current_user),
):
    """Persist client results without starting a separation job or storing a duplicate ZIP."""
    rate_limit("client-stems:" + user["id"], 30)
    try:
        client_id = str(uuid.UUID(client_id))
    except ValueError as error:
        raise HTTPException(422, "รหัสผลลัพธ์ไม่ถูกต้อง") from error
    expected = MODES.get(stems_mode)
    if (
        not expected
        or len(files) != len(expected)
        or {file.filename for file in files} != {name + ".wav" for name in expected}
    ):
        raise HTTPException(422, "กรุณาส่งแทร็คให้ครบตามรูปแบบที่เลือก")
    filename = Path(filename.replace("\\", "/")).name[:220]
    if not filename:
        raise HTTPException(422, "กรุณาระบุชื่อเพลง")

    def existing():
        for item in TASKS.values():
            if (
                item.get("owner_id") == user["id"]
                and item.get("client_id") == client_id
            ):
                if item["status"] == "completed":
                    return public_task(item)
                raise HTTPException(409, "กำลังบันทึกผลลัพธ์นี้ กรุณารอสักครู่")
        return None

    previous = existing()
    if previous:
        return previous
    task = None
    keys = []
    reserved = False
    with tempfile.TemporaryDirectory(
        prefix="client-stems-", dir=UPLOAD_DIR
    ) as incoming:
        folder = Path(incoming)
        try:
            total = 0
            lengths = set()
            for file in files:
                path = folder / file.filename
                with path.open("wb") as output:
                    while chunk := await file.read(1024 * 1024):
                        total += len(chunk)
                        if total > USER_QUOTA:
                            raise HTTPException(
                                413, "พื้นที่จัดเก็บไม่พอสำหรับแทร็คผลลัพธ์ กรุณาดาวน์โหลดเก็บในเครื่อง"
                            )
                        output.write(chunk)
                lengths.add(validate_client_wav(path))
            if len(lengths) != 1:
                raise HTTPException(422, "ความยาวของแทร็คต้องเท่ากันทุกไฟล์")
            previous = existing()
            if previous:
                return previous
            task = new_task(filename, stems_mode, "webgpu", owner_id=user["id"])
            task.update(
                client_id=client_id,
                status="processing",
                duration=lengths.pop() / 44100,
                sample_rate=44100,
            )
            save_task(task)
            keys = [
                (
                    f"users/{user['id']}/stems/{task['id']}/{name}.wav",
                    (folder / (name + ".wav")).stat().st_size,
                )
                for name in expected
            ]
            with connect() as db:
                lock_writes(db)
                used = db.execute(
                    "SELECT COALESCE(SUM(size_bytes),0) FROM (SELECT size_bytes FROM tracks WHERE user_id=? UNION ALL SELECT size_bytes FROM assets WHERE user_id=?) AS quota_rows",
                    (user["id"], user["id"]),
                ).fetchone()[0]
                if used + total > USER_QUOTA:
                    raise HTTPException(
                        413, "พื้นที่จัดเก็บไม่พอสำหรับแทร็คผลลัพธ์ กรุณาดาวน์โหลดเก็บในเครื่อง"
                    )
                db.executemany(
                    "INSERT INTO assets VALUES(?,?,?,?)",
                    [(key, user["id"], task["id"], size) for key, size in keys],
                )
            reserved = True
            stems = {}
            for name, (key, size) in zip(expected, keys):
                path = folder / (name + ".wav")
                peaks = await asyncio.to_thread(waveform, path)
                await asyncio.to_thread(storage.put, path, key)
                stems[name] = {
                    "filename": path.name,
                    "url": f"/api/stems/{task['id']}/{path.name}",
                    "peaks": peaks,
                    "size_bytes": size,
                    "object_key": key,
                }
            task.update(
                status="completed",
                progress=100,
                message="แทร็คของคุณพร้อมแล้ว",
                stems=stems,
            )
            save_task(task)
            return public_task(task)
        except Exception as error:
            if reserved:
                for key, _ in keys:
                    try:
                        await asyncio.to_thread(storage.delete, key)
                    except Exception:
                        logger.exception("Client stem cleanup failed")
                with connect() as db:
                    db.execute("DELETE FROM assets WHERE task_id=?", (task["id"],))
            if task:
                TASKS.pop(task["id"], None)
                shutil.rmtree(OUTPUT_DIR / task["id"], ignore_errors=True)
            if isinstance(error, HTTPException):
                raise
            logger.exception("Client stem import failed")
            raise HTTPException(
                503, "บันทึกเข้า cloud ไม่สำเร็จ ผลลัพธ์ยังดาวน์โหลดจากเครื่องได้"
            ) from error
        finally:
            for file in files:
                await file.close()


@app.get("/api/processing-allowance")
def processing_allowance(user=Depends(current_user)):
    return processing_quota.allowance(user["id"])


@app.get("/api/tasks")
def list_tasks(user=Depends(current_user)):
    legacy = [
        public_task(t)
        for t in sorted(
            list(TASKS.values()), key=lambda task: task["created_at"], reverse=True
        )
        if t.get("owner_id") == user["id"] and t.get("status") not in {"deleted", "deleting"}
    ]
    return [
        public_task(t)
        for t in sorted(
            legacy + worker_jobs.list_for(user["id"]),
            key=lambda task: task["created_at"],
            reverse=True,
        )
    ]


@app.get("/api/tasks/{task_id}")
def task_status(task_id: str, user=Depends(current_user)):
    return public_task(owned_task(task_id, user["id"]))


def stem_download_name(source: str, stem: str) -> str:
    # Internal object names/URLs stay stable, including completed older jobs.
    title = unicodedata.normalize("NFC", str(source)).replace("\\", "/").split("/")[-1]
    title = re.sub(r"\.[^.]+$", "", title)
    title = re.sub(r'[\x00-\x1f\x7f<>:"/\\|?*]', "_", title).strip(" .").encode("utf-8")[:180].decode("utf-8", "ignore").rstrip(" .") or "Track"
    label = {"vocals": "Acapella", "no_vocals": "Instrumental", "drums": "Drums", "bass": "Bass", "other": "Other Instruments"}.get(Path(stem).stem, "Stem")
    return f"{title} ({label}).wav"


@app.get("/api/stems/{task_id}/{filename}")
def stream_stem(task_id: str, filename: str, user=Depends(current_user)):
    task = owned_task(task_id, user["id"])
    stem = next(
        (s for s in task.get("stems", {}).values() if s["filename"] == filename), None
    )
    if task["status"] != "completed" or not stem:
        raise HTTPException(404, "ไม่พบแทร็คนี้")
    try:
        path = storage.materialize(stem["object_key"])
    except Exception as error:
        raise HTTPException(503, "ไฟล์ยังไม่พร้อม กรุณาลองใหม่") from error
    return FileResponse(path, media_type="audio/wav", filename=stem_download_name(task["filename"], filename))


@app.get("/api/download-all/{task_id}")
def download_all(task_id: str, user=Depends(current_user)):
    task = owned_task(task_id, user["id"])
    if task["status"] == "completed" and task.get("stems"):
        rate_limit("client-zip:" + user["id"], 30)
        # A transient download ZIP never duplicates the user's persistent cloud quota.
        handle, name = tempfile.mkstemp(
            prefix="client-download-", suffix=".zip", dir=storage.cache
        )
        os.close(handle)
        path = Path(name)
        try:
            with zipfile.ZipFile(path, "w", zipfile.ZIP_STORED) as bundle:
                for stem in task["stems"].values():
                    bundle.write(
                        storage.materialize(stem["object_key"]), stem_download_name(task["filename"], stem["filename"])
                    )
            return FileResponse(
                path,
                media_type="application/zip",
                filename=f"{Path(task['filename']).stem}_stems.zip",
                background=BackgroundTask(path.unlink, missing_ok=True),
            )
        except Exception as error:
            path.unlink(missing_ok=True)
            raise HTTPException(503, "ไฟล์ยังไม่พร้อม กรุณาลองใหม่") from error
    if task["status"] != "completed" or not task.get("archive_key"):
        raise HTTPException(404, "ไฟล์ยังไม่พร้อมดาวน์โหลด")
    try:
        path = storage.materialize(task["archive_key"])
    except Exception as error:
        raise HTTPException(503, "ไฟล์ยังไม่พร้อม กรุณาลองใหม่") from error
    return FileResponse(
        path,
        media_type="application/zip",
        filename=f"{Path(task['filename']).stem}_stems.zip",
    )


app.include_router(create_client_upload_router(import_client_stems, TASKS, public_task))
app.include_router(worker_jobs.create_router(validate_client_wav, waveform))
# Protect legacy manifest and object transitions across concurrent requests.
LEGACY_TRASH_LOCK = threading.RLock()

def worker_owned(task_id, owner):
    with connect() as db:
        return bool(db.execute("SELECT id FROM stem_jobs WHERE id=? AND owner_id=?", (task_id, owner)).fetchone())

def legacy_owned_for_trash(task_id, owner):
    task = TASKS.get(task_id)
    if not task or task.get("owner_id") != owner:
        raise HTTPException(404, "ไม่พบงานนี้")
    return task

@app.get("/api/worker-trash")
def all_stem_trash(user=Depends(current_user)):
    result = worker_jobs.list_trash(user=user)
    result.extend({"id": t["id"], "filename": t["filename"], "status": t["status"]}
        for t in list(TASKS.values()) if t.get("owner_id") == user["id"] and t.get("status") in {"deleted", "deleting"})
    return result

@app.post("/api/tasks/{task_id}/trash", dependencies=[Depends(mutation_guard)])
def trash_stem(task_id: str, user=Depends(current_user)):
    if worker_owned(task_id, user["id"]):
        return worker_jobs.trash_job(task_id, user=user)
    with LEGACY_TRASH_LOCK:
        task = legacy_owned_for_trash(task_id, user["id"])
        if task["status"] in {"queued", "processing", "deleting"}:
            raise HTTPException(409, "กรุณารอให้งานเสร็จก่อนย้ายไปถังขยะ")
        if task["status"] != "deleted":
            task["trash_previous_status"] = task["status"]
            task["status"] = "deleted"
            save_task(task)
    return {"ok": True}

@app.post("/api/tasks/{task_id}/restore", dependencies=[Depends(mutation_guard)])
def restore_stem(task_id: str, user=Depends(current_user)):
    if worker_owned(task_id, user["id"]):
        return worker_jobs.restore_job(task_id, user=user)
    with LEGACY_TRASH_LOCK:
        task = legacy_owned_for_trash(task_id, user["id"])
        if task["status"] != "deleted":
            raise HTTPException(404, "ไม่พบงานในถังขยะ")
        previous = task.pop("trash_previous_status", "failed")
        if previous not in {"completed", "failed", "cancelled"}:
            raise HTTPException(409, "ไม่สามารถกู้คืนนี้ได้")
        task["status"] = previous
        save_task(task)
    return {"ok": True}

@app.delete("/api/tasks/{task_id}/purge", dependencies=[Depends(mutation_guard)])
def purge_stem(task_id: str, user=Depends(current_user)):
    if worker_owned(task_id, user["id"]):
        return worker_jobs.purge_job(task_id, user=user)
    with LEGACY_TRASH_LOCK:
        task = legacy_owned_for_trash(task_id, user["id"])
        if task["status"] not in {"deleted", "deleting"}:
            raise HTTPException(404, "ไม่พบงานในถังขยะ")
        task["status"] = "deleting"
        save_task(task)
        with connect() as db:
            keys = [row[0] for row in db.execute("SELECT object_key FROM assets WHERE task_id=? AND user_id=?", (task_id, user["id"])).fetchall()]
        try:
            for key in keys:
                worker_jobs.discard_input(key)
        except Exception as error:
            logger.warning("Legacy result deletion pending for %s", task_id)
            raise HTTPException(503, "ลบไฟล์ยังไม่ครบ กรุณาลองลบอีกครั้ง") from error
        with connect() as db:
            lock_writes(db)
            db.execute("DELETE FROM assets WHERE task_id=? AND user_id=?", (task_id, user["id"]))
        shutil.rmtree(OUTPUT_DIR / task_id, ignore_errors=True)
        TASKS.pop(task_id, None)
    return {"ok": True}

app.include_router(worker_jobs.user_router)


@app.post("/api/cloud/tracks/{track_id}/separate", status_code=202)
async def separate_library_track(
    track_id: str,
    background_tasks: BackgroundTasks,
    stems_mode: str = Form("4stems"),
    engine: str = Form("demucs"),
    user=Depends(current_user),
    storage_mode: str = Form("cloud"),
    request_id: str = Form(""),
):
    track = track_for(track_id, user["id"])
    try:
        path = await asyncio.to_thread(storage.materialize, track["object_key"])
    except Exception as error:
        raise HTTPException(503, "ไฟล์ยังไม่พร้อม กรุณาลองใหม่") from error
    upload = UploadFile(filename=track["filename"], file=path.open("rb"))
    return await separate(
        background_tasks, upload, stems_mode, "htdemucs", engine, user, storage_mode, request_id
    )
