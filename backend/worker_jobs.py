"""Durable pull queue. Workers receive only leased audio jobs over authenticated HTTPS."""

import hashlib
import hmac
import json
import logging
import os
import secrets
import shutil
import time
import uuid
from datetime import datetime, timezone
from typing import Literal

from auth import current_user, mutation_guard, rate_limit
from cloud import USER_QUOTA
from database import DATA, connect, lock_writes
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from storage import storage
from processing_quota import reserve as reserve_processing

logger = logging.getLogger("stemora.worker")
ENABLED = os.environ.get("STEMORA_WORKER_ENABLED", "0") == "1"
LEASE_SECONDS = 180
CHUNK = 4_000_000
# Separate, bounded scratch storage. It never counts against the music library.
TEMP_TTL = 24 * 60 * 60
TEMP_USER_BYTES = 2_000_000_000
TEMP_GLOBAL_BYTES = 10_000_000_000
TEMP_MAX_RESULT_BYTES = (600 * 44100 * 4 + 4096) * 4
INCOMING = DATA / "worker-incoming"
INCOMING.mkdir(exist_ok=True)
STEMS = {
    "4stems": ["vocals", "drums", "bass", "other"],
    "2stems": ["vocals", "no_vocals"],
}
PHASES = {
    "preparing": "กำลังเตรียมเพลงจากคิว",
    "separating": "กำลังแยกเสียงด้วย AI อาจใช้เวลาสักครู่",
    "uploading": "กำลังบันทึกแทร็คในพื้นที่ส่วนตัวของคุณ",
}


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def discard_input(key):
    if not key:
        return
    storage.delete(key)
    if storage.client:
        (storage.cache / digest(key)).unlink(missing_ok=True)


def quota_used(db, owner):
    return db.execute(
        "SELECT COALESCE(SUM(size_bytes),0) FROM (SELECT size_bytes FROM tracks WHERE user_id=? UNION ALL SELECT size_bytes FROM assets WHERE user_id=?) AS quota_rows",
        (owner, owner),
    ).fetchone()[0]


def worker_identity(request: Request):
    authorization = request.headers.get("authorization", "")
    if not authorization.startswith("Bearer ") or len(authorization) > 200:
        raise HTTPException(401, "Worker authentication required")
    token = authorization[7:]
    with connect() as db:
        row = db.execute(
            "SELECT * FROM workers WHERE token_hash=? AND enabled=1", (digest(token),)
        ).fetchone()
    if not row:
        raise HTTPException(401, "Worker authentication required")
    return row


def summary():
    with connect() as db:
        online = db.execute(
            "SELECT COUNT(*) FROM workers WHERE enabled=1 AND accepting=1 AND last_seen>?",
            (time.time() - 90,),
        ).fetchone()[0]
    return {
        "worker_enabled": ENABLED,
        "worker_online": bool(online),
        "default_engine": "worker" if ENABLED else "webgpu",
    }


def is_temporary(row):
    return json.loads(row["spec"]).get("storage_mode", "cloud") == "download"


def result_keys(row):
    return [stem["object_key"] for stem in json.loads(row["result"]).get("stems", {}).values()]


def temporary_used(db, owner=None):
    rows = db.execute("SELECT owner_id,spec,status FROM stem_jobs WHERE status<>'expired'").fetchall()
    return sum(
        spec.get("temporary_bytes", 0)
        for row in rows
        if (owner is None or row["owner_id"] == owner)
        and (spec := json.loads(row["spec"])).get("storage_mode") == "download"
    )


def queue_context(db):
    """One anonymous queue snapshot per customer request; never expose other jobs."""
    now = time.time()
    rows = db.execute("SELECT id,status FROM stem_jobs WHERE status IN ('staging','queued','processing') ORDER BY created_at,id").fetchall()
    waiting = [row["id"] for row in rows if row["status"] == "queued"]
    online = db.execute("SELECT COUNT(*) FROM workers WHERE enabled=1 AND accepting=1 AND last_seen>?", (now - 90,)).fetchone()[0]
    return {"now": now, "positions": {identity: index + 1 for index, identity in enumerate(waiting)},
            "waiting": len(waiting), "processing": sum(row["status"] == "processing" for row in rows), "worker_online": bool(online)}


def customer_queue(row, context):
    now = context["now"]
    created = datetime.fromisoformat(row["created_at"].replace("Z", "+00:00")).timestamp()
    age = max(0, int(now - (row["lease_until"] - LEASE_SECONDS))) if row["status"] == "processing" else None
    if row["status"] == "staging":
        phase = "preparing_source"
    elif row["status"] == "queued":
        phase = "waiting" if context["worker_online"] else "waiting_worker"
    elif age is not None and age > 60:
        phase = "reconnecting"
    elif row["message"] == PHASES["uploading"] or row["progress"] >= 88:
        phase = "uploading"
    elif row["message"] == PHASES["separating"] or row["progress"] >= 20:
        phase = "separating"
    else:
        phase = "preparing"
    return {"phase": phase, "position": context["positions"].get(row["id"]),
            "waiting": context["waiting"], "processing": context["processing"],
            "elapsed_seconds": max(0, int(now - created)), "heartbeat_age_seconds": age,
            "worker_online": context["worker_online"], "checked_at": now}


def public(row, context=None):
    task = json.loads(row["spec"])
    task.pop("temporary_bytes", None)
    task.pop("processing_profile", None)
    task.pop("worker_slot", None)
    task.pop("trash_previous_status", None)
    task.update(
        status=row["status"], progress=row["progress"], message=row["message"], stems={}
    )
    if row["status"] == "staging":
        task["status"] = "queued"
    if task.get("storage_mode") == "download" and task.get("expires_at", 0) <= time.time():
        task.update(status="expired", progress=0, message="ผลลัพธ์ชั่วคราวหมดอายุแล้ว กรุณาแยกเพลงใหม่")
    elif row["status"] == "completed":
        task.update(json.loads(row["result"]))
    if task["status"] in {"queued", "processing"} and context:
        task["queue"] = customer_queue(row, context)
    return task


def get(task_id, owner):
    with connect() as db:
        row = db.execute(
            "SELECT * FROM stem_jobs WHERE id=? AND owner_id=? AND status NOT IN ('deleted','deleting')", (task_id, owner)
        ).fetchone()
        context = queue_context(db) if row and row["status"] in {"staging", "queued", "processing"} else None
    return public(row, context) if row else None


def list_for(owner):
    with connect() as db:
        rows = db.execute(
            "SELECT * FROM stem_jobs WHERE owner_id=? AND status NOT IN ('deleted','deleting') ORDER BY created_at DESC", (owner,)
        ).fetchall()
        context = queue_context(db) if any(row["status"] in {"staging", "queued", "processing"} for row in rows) else None
    return [public(row, context) for row in rows]


def request_task_id(owner, request_id):
    try:
        parsed = str(uuid.UUID(request_id))
    except (ValueError, TypeError, AttributeError):
        raise HTTPException(422, "รหัสส่งไฟล์ไม่ถูกต้อง") from None
    return str(uuid.uuid5(uuid.NAMESPACE_URL, "stemora-upload:" + owner + ":" + parsed))


def enqueue(filename, mode, metadata, source, owner, storage_mode="cloud", request_id=""):
    if not ENABLED:
        raise HTTPException(503, "ระบบคิวแยกเสียงยังไม่พร้อม")
    if storage_mode not in {"cloud", "download"}:
        raise HTTPException(422, "ตัวเลือกการแยกเสียงไม่ถูกต้อง")
    task_id = request_task_id(owner, request_id) if request_id else str(uuid.uuid4())
    created = datetime.now(timezone.utc).isoformat()
    spec = {
        "id": task_id,
        "filename": filename,
        "engine": "worker",
        "stems_mode": mode,
        "created_at": created,
        **metadata,
        "storage_mode": storage_mode,
        "processing_profile": "vocals-pro" if mode == "2stems" else "stems-standard",
    }
    key = f"users/{owner}/worker-input/{task_id}/source"
    size = source.stat().st_size
    sha = hashlib.sha256(source.read_bytes()).hexdigest()
    estimate = (int(metadata["duration"] * 44100 + 1) * 4 + 44) * len(STEMS[mode])
    if storage_mode == "download":
        spec.update(expires_at=time.time() + TEMP_TTL, temporary_bytes=size + estimate + 16384)
    with connect() as db:
        lock_writes(db)
        existing = db.execute("SELECT * FROM stem_jobs WHERE id=? AND owner_id=?", (task_id, owner)).fetchone()
        if existing:
            old = json.loads(existing["spec"])
            if (existing["source_sha256"] != sha or old["stems_mode"] != mode
                or old.get("storage_mode", "cloud") != storage_mode or old["filename"] != filename
                or existing["status"] in {"deleted", "deleting", "expired", "expiring"}):
                raise HTTPException(409, "รหัสส่งไฟล์นี้ถูกใช้กับงานอื่นแล้ว กรุณาเลือกไฟล์ใหม่")
            return {"task_id": task_id, "filename": old["filename"], "status": "queued" if existing["status"] == "staging" else existing["status"]}
        reserve_processing(db, task_id, owner, metadata["duration"])
        count = db.execute(
            "SELECT COUNT(*) FROM stem_jobs WHERE owner_id=? AND status IN ('staging','queued','processing')",
            (owner,),
        ).fetchone()[0]
        if count >= 10:
            raise HTTPException(429, "มีงานแยกเสียงรออยู่มากเกินไป กรุณารอให้งานเดิมเสร็จก่อน")
        if storage_mode == "download":
            if (temporary_used(db, owner) + spec["temporary_bytes"] > TEMP_USER_BYTES
                or temporary_used(db) + spec["temporary_bytes"] > TEMP_GLOBAL_BYTES):
                raise HTTPException(429, "พื้นที่ชั่วคราวมีงานรออยู่มาก กรุณารอหรือลบผลลัพธ์ชั่วคราวก่อน")
            if shutil.disk_usage(DATA).free < 2_000_000_000:
                raise HTTPException(503, "พื้นที่ประมวลผลชั่วคราวยังไม่พร้อม กรุณาลองอีกครั้งภายหลัง")
        else:
            if quota_used(db, owner) + size + estimate > USER_QUOTA:
                raise HTTPException(413, "พื้นที่ Cloud ไม่พอ เลือกแยกเพื่อดาวน์โหลดโดยไม่บันทึก Cloud ได้")
            db.execute("INSERT INTO assets VALUES(?,?,?,?)", (key, owner, task_id, size))
            db.execute(
                "INSERT INTO assets VALUES(?,?,?,?)",
                (f"users/{owner}/worker-reservation/{task_id}", owner, task_id, estimate),
            )
        db.execute(
            "INSERT INTO stem_jobs(id,owner_id,spec,source_key,source_bytes,source_sha256,status,message,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
            (
                task_id,
                owner,
                json.dumps(spec),
                key,
                size,
                sha,
                "staging",
                "กำลังเตรียมเพลงจากคิว",
                created,
                time.time(),
            ),
        )
    try:
        storage.put(source, key)
        with connect() as db:
            lock_writes(db)
            current = db.execute("SELECT status FROM stem_jobs WHERE id=?", (task_id,)).fetchone()
            if current and current["status"] == "staging":
                db.execute(
                    "UPDATE stem_jobs SET status='queued',message=?,updated_at=? WHERE id=? AND status='staging'",
                    ("รอคิวแยกเสียง เปิดหน้านี้ใหม่เพื่อรับผลได้", time.time(), task_id),
                )
        if not current or current["status"] != "staging":
            discard_input(key)
    except Exception:
        with connect() as db:
            db.execute("DELETE FROM processing_usage WHERE job_id=?", (task_id,))
            db.execute("DELETE FROM assets WHERE task_id=?", (task_id,))
            db.execute(
                "UPDATE stem_jobs SET status='failed',message=?,updated_at=? WHERE id=?",
                ("ส่งเพลงเข้าคิวไม่สำเร็จ กรุณาลองใหม่", time.time(), task_id),
            )
        storage.delete(key)
        raise
    return {"task_id": task_id, "filename": filename, "status": "queued"}


def leased(db, task_id, worker, lease, allow_complete=False):
    row = db.execute("SELECT * FROM stem_jobs WHERE id=?", (task_id,)).fetchone()
    if (
        not row
        or row["worker_id"] != worker["id"]
        or not hmac.compare_digest(row["lease_hash"] or "", digest(lease))
    ):
        raise HTTPException(409, "Worker lease is no longer valid")
    if allow_complete and row["status"] == "completed":
        return row
    if (is_temporary(row) and json.loads(row["spec"])["expires_at"] <= time.time()) or row["status"] != "processing" or row["lease_until"] < time.time():
        raise HTTPException(409, "Worker lease is no longer valid")
    return row


def stage(row):
    return INCOMING / row["id"] / row["lease_hash"]


def maintenance():
    """Requeue interrupted work and release abandoned/terminal input reservations."""
    now = time.time()
    with connect() as db:
        lock_writes(db)
        expiring = []
        for row in db.execute("SELECT * FROM stem_jobs WHERE status<>'expired'").fetchall():
            spec = json.loads(row["spec"])
            if spec.get("storage_mode") == "download" and spec.get("expires_at", 0) <= now:
                db.execute("UPDATE stem_jobs SET status='expiring',lease_until=0 WHERE id=?", (row["id"],))
                expiring.append(row)
    for row in expiring:
        try:
            for key in set(result_keys(row) + [row["source_key"]]):
                discard_input(key)
            shutil.rmtree(INCOMING / row["id"], ignore_errors=True)
            with connect() as db:
                lock_writes(db)
                db.execute("UPDATE stem_jobs SET status='expired',source_key='',source_bytes=0,result='{}',progress=0,message=?,updated_at=? WHERE id=? AND status='expiring'", ("ผลลัพธ์ชั่วคราวหมดอายุแล้ว กรุณาแยกเพลงใหม่", now, row["id"]))
        except Exception:
            logger.warning("Temporary result cleanup pending for %s", row["id"])
    with connect() as db:
        lock_writes(db)
        # Failed infrastructure work and unstarted cancelled/expired jobs refund minutes.
        db.execute("DELETE FROM processing_usage WHERE job_id IN (SELECT id FROM stem_jobs WHERE status='failed') OR (charged=0 AND job_id IN (SELECT id FROM stem_jobs WHERE status IN ('cancelled','expired','deleted')))")
        expired = db.execute(
            "SELECT * FROM stem_jobs WHERE status='processing' AND lease_until<?",
            (now,),
        ).fetchall()
        for row in expired:
            retry = row["attempts"] < 3
            if not retry:
                db.execute("DELETE FROM processing_usage WHERE job_id=?", (row["id"],))
            db.execute(
                "UPDATE stem_jobs SET status=?,progress=5,message=?,lease_until=0,updated_at=? WHERE id=?",
                (
                    "queued" if retry else "failed",
                    "เครื่องประมวลผลขาดการเชื่อมต่อ กำลังรอรับงานใหม่"
                    if retry
                    else "ประมวลผลไม่สำเร็จหลายครั้ง กรุณาเริ่มใหม่",
                    now,
                    row["id"],
                ),
            )
        db.execute(
            "UPDATE stem_jobs SET status='failed',message=?,updated_at=? WHERE status='staging' AND updated_at<?",
            ("ส่งเพลงเข้าคิวไม่สำเร็จ กรุณาลองใหม่", now, now - 600),
        )
        terminal = db.execute(
            "SELECT * FROM stem_jobs WHERE status IN ('completed','failed','cancelled') AND source_key<>''"
        ).fetchall()
        for row in terminal:
            db.execute(
                "DELETE FROM assets WHERE object_key IN (?,?)",
                (
                    row["source_key"],
                    f"users/{row['owner_id']}/worker-reservation/{row['id']}",
                ),
            )
    for row in terminal:
        try:
            discard_input(row["source_key"])
            shutil.rmtree(INCOMING / row["id"], ignore_errors=True)
            with connect() as db:
                db.execute(
                    "UPDATE stem_jobs SET source_key='',source_bytes=0 WHERE id=?",
                    (row["id"],),
                )
                if is_temporary(row) and row["status"] in {"failed", "cancelled"}:
                    spec = json.loads(row["spec"])
                    spec["temporary_bytes"] = 0
                    db.execute("UPDATE stem_jobs SET spec=? WHERE id=?", (json.dumps(spec), row["id"]))
        except Exception:
            logger.warning("Worker input cleanup pending for %s", row["id"])
    # Stale attempts cannot upload or commit after a new lease is issued.
    for folder in INCOMING.iterdir():
        if folder.is_dir():
            for attempt in folder.iterdir():
                with connect() as db:
                    lock_writes(db)
                    live = db.execute(
                        "SELECT lease_hash FROM stem_jobs WHERE id=? AND status='processing'",
                        (folder.name,),
                    ).fetchone()
                    if not live or attempt.name != live["lease_hash"]:
                        shutil.rmtree(attempt, ignore_errors=True)


class Heartbeat(BaseModel):
    task_id: str | None = None
    lease: str = Field(default="", max_length=100)
    device: str = Field(default="", max_length=80)
    progress: int = Field(default=15, ge=5, le=95)
    phase: str = "preparing"
    accepting: bool = True


class Claim(BaseModel):
    parallelism: int = Field(default=1, ge=1, le=4)
    slot: int = Field(default=0, ge=0, le=3)
    # Older computers may only process the legacy Demucs profile.
    profiles: list[Literal["stems-standard", "vocals-pro"]] = Field(
        default_factory=lambda: ["stems-standard"], min_length=1, max_length=2
    )


class Lease(BaseModel):
    lease: str = Field(min_length=32, max_length=100)


def create_router(validate_wav, waveform):
    router = APIRouter(prefix="/api/worker", dependencies=[Depends(worker_identity)])

    @router.get("/queue")
    def queue(worker=Depends(worker_identity)):
        rate_limit("worker-queue:" + worker["id"], 180)
        now = time.time()
        with connect() as db:
            rows = db.execute("SELECT * FROM stem_jobs WHERE status IN ('staging','queued','processing') ORDER BY created_at,id").fetchall()
            fleet = db.execute("SELECT id,name,last_seen,device,accepting FROM workers WHERE enabled=1 ORDER BY name,id").fetchall()
        names = {machine["id"]: machine["name"] for machine in fleet}
        counts = {"waiting": 0, "processing": 0, "preparing": 0}
        items = []
        position = 0
        for row in rows:
            spec = json.loads(row["spec"])
            key = {"queued":"waiting", "processing":"processing", "staging":"preparing"}[row["status"]]
            counts[key] += 1
            if row["status"] == "queued":
                position += 1
            created = datetime.fromisoformat(row["created_at"].replace("Z", "+00:00"))
            items.append({
                "id": row["id"], "filename": spec["filename"], "status": row["status"],
                "position": position if row["status"] == "queued" else None,
                "waiting_seconds": max(0, int(now - created.timestamp())),
                "duration": spec.get("duration", 0), "stems_mode": spec["stems_mode"],
                "progress": row["progress"],
                "on_this_worker": row["status"] == "processing" and row["worker_id"] == worker["id"],
                "worker_name": names.get(row["worker_id"], "") if row["status"] == "processing" else "",
            })
        from operations import operator_alerts
        return {"alerts": operator_alerts(), "counts": counts, "items": items, "snapshot_at": now, "workers": [
            {"id": machine["id"], "name": machine["name"],
             "online": bool(machine["last_seen"] and machine["last_seen"] > now - 90),
             "accepting": bool(machine["accepting"]), "device": machine["device"] or "",
             "on_this_worker": machine["id"] == worker["id"],
             "busy": any(row["status"] == "processing" and row["worker_id"] == machine["id"] for row in rows),
             "active_jobs": sum(row["status"] == "processing" and row["worker_id"] == machine["id"] for row in rows)}
            for machine in fleet]}

    @router.post("/heartbeat")
    def heartbeat(body: Heartbeat, worker=Depends(worker_identity)):
        with connect() as db:
            lock_writes(db)
            db.execute(
                "UPDATE workers SET last_seen=?,device=?,accepting=? WHERE id=?",
                (time.time(), body.device, int(body.accepting), worker["id"]),
            )
            if body.task_id:
                row = leased(db, body.task_id, worker, body.lease)
                progress = max(row["progress"], body.progress)
                db.execute(
                    "UPDATE stem_jobs SET lease_until=?,progress=?,message=?,updated_at=? WHERE id=?",
                    (
                        time.time() + LEASE_SECONDS,
                        progress,
                        PHASES.get(body.phase, PHASES["preparing"]),
                        time.time(),
                        body.task_id,
                    ),
                )
        return {"ok": True, "lease_seconds": LEASE_SECONDS}

    @router.post("/claim")
    def claim(body: Claim = Claim(), worker=Depends(worker_identity)):
        rate_limit("worker-claim:" + worker["id"], 600)
        if body.slot >= body.parallelism:
            raise HTTPException(422, "Slot exceeds worker parallelism")
        maintenance()
        with connect() as db:
            lock_writes(db)
            db.execute(
                "UPDATE workers SET last_seen=? WHERE id=?", (time.time(), worker["id"])
            )
            busy = db.execute(
                "SELECT spec FROM stem_jobs WHERE status='processing' AND worker_id=?",
                (worker["id"],),
            ).fetchall()
            # Atomic per-machine capacity and per-slot exclusivity. Old clients
            # omit these fields and continue to receive one task at a time.
            if len(busy) >= body.parallelism or any(
                json.loads(active["spec"]).get("worker_slot", 0) == body.slot for active in busy
            ):
                return {"job": None}
            # The transaction lock makes selection + assignment atomic across machines.
            # Skip jobs this runtime cannot run, without downgrading their AI.
            row = next((candidate for candidate in db.execute(
                "SELECT * FROM stem_jobs WHERE status='queued' ORDER BY created_at,id"
            ).fetchall() if json.loads(candidate["spec"]).get("processing_profile", "stems-standard") in body.profiles), None)
            if not row:
                return {"job": None}
            db.execute("UPDATE processing_usage SET charged=1 WHERE job_id=?", (row["id"],))
            lease = secrets.token_urlsafe(36)
            spec = json.loads(row["spec"])
            spec["worker_slot"] = body.slot
            db.execute(
                "UPDATE stem_jobs SET status='processing',spec=?,worker_id=?,lease_hash=?,lease_until=?,attempts=attempts+1,progress=10,message=?,updated_at=? WHERE id=?",
                (
                    json.dumps(spec),
                    worker["id"],
                    digest(lease),
                    time.time() + LEASE_SECONDS,
                    PHASES["preparing"],
                    time.time(),
                    row["id"],
                ),
            )
            job = spec
            job.update(
                lease=lease,
                source_bytes=row["source_bytes"],
                source_sha256=row["source_sha256"],
                chunk_bytes=CHUNK,
            )
        return {"job": job}

    @router.get("/jobs/{task_id}/source")
    def source(task_id: str, request: Request, worker=Depends(worker_identity)):
        with connect() as db:
            row = leased(
                db, task_id, worker, request.headers.get("x-stemora-lease", "")
            )
        return FileResponse(
            storage.materialize(row["source_key"]),
            media_type="application/octet-stream",
        )

    @router.put("/jobs/{task_id}/files/{filename}")
    async def upload(
        task_id: str,
        filename: str,
        request: Request,
        offset: int = 0,
        worker=Depends(worker_identity),
    ):
        data = bytearray()
        async for block in request.stream():
            if len(data) + len(block) > CHUNK:
                raise HTTPException(413, "Worker chunk exceeds limit")
            data.extend(block)
        if offset < 0 or not data:
            raise HTTPException(422, "Invalid worker offset")
        with connect() as db:
            lock_writes(db)
            row = leased(
                db, task_id, worker, request.headers.get("x-stemora-lease", "")
            )
            spec = json.loads(row["spec"])
            if filename not in [name + ".wav" for name in STEMS[spec["stems_mode"]]]:
                raise HTTPException(422, "Invalid worker stem")
            folder = stage(row)
            folder.mkdir(parents=True, exist_ok=True)
            path = folder / filename
            size = path.stat().st_size if path.exists() else 0
            if offset > size or offset + len(data) > 600 * 44100 * 4 + 44:
                raise HTTPException(409, "Invalid worker offset")
            total = sum(p.stat().st_size for p in folder.glob("*.wav"))
            growth = max(0, offset + len(data) - size)
            if total + growth > (min(TEMP_MAX_RESULT_BYTES, spec["temporary_bytes"]) if is_temporary(row) else USER_QUOTA):
                raise HTTPException(413, "Worker results exceed quota")
            with path.open("r+b" if path.exists() else "w+b") as stream:
                stream.seek(offset)
                overlap = min(len(data), size - offset)
                if overlap and stream.read(overlap) != data[:overlap]:
                    raise HTTPException(409, "Worker retry differs from stored bytes")
                stream.seek(size)
                stream.write(data[overlap:])
                stream.flush()
            return {"offset": max(size, offset + len(data))}

    @router.post("/jobs/{task_id}/complete")
    def complete(task_id: str, body: Lease, worker=Depends(worker_identity)):
        keys = []
        committed = False
        try:
            with connect() as db:
                lock_writes(db)
                row = leased(db, task_id, worker, body.lease, allow_complete=True)
                if row["status"] == "completed":
                    return {"status": "completed", "task_id": task_id}
                spec = json.loads(row["spec"])
                names = STEMS[spec["stems_mode"]]
                folder = stage(row)
                frames = {validate_wav(folder / (name + ".wav")) for name in names}
                if (
                    len(frames) != 1
                    or abs(next(iter(frames)) / 44100 - spec["duration"]) > 0.25
                ):
                    raise HTTPException(
                        422, "Worker result duration does not match source"
                    )
                keys = [
                    (
                        f"users/{row['owner_id']}/{'temporary-stems' if is_temporary(row) else 'stems'}/{task_id}/{row['lease_hash']}/{name}.wav",
                        (folder / (name + ".wav")).stat().st_size,
                    )
                    for name in names
                ]
                reserved = db.execute(
                    "SELECT COALESCE(SUM(size_bytes),0) FROM assets WHERE task_id=?",
                    (task_id,),
                ).fetchone()[0]
                if not is_temporary(row) and (
                    quota_used(db, row["owner_id"])
                    - reserved
                    + sum(size for _, size in keys)
                    > USER_QUOTA
                ):
                    raise HTTPException(413, "พื้นที่ไม่พอสำหรับผลลัพธ์ กรุณาลดพื้นที่ก่อน")
                if is_temporary(row) and sum(size for _, size in keys) > spec["temporary_bytes"]:
                    raise HTTPException(413, "Worker results exceed temporary reservation")
                stems = {}
                for name, (key, size) in zip(names, keys):
                    path = folder / (name + ".wav")
                    peaks = waveform(path)
                    storage.put(path, key)
                    stems[name] = {
                        "filename": path.name,
                        "url": f"/api/stems/{task_id}/{path.name}",
                        "peaks": peaks,
                        "size_bytes": size,
                        "object_key": key,
                    }
                result = {
                    "stems": stems,
                    "duration": next(iter(frames)) / 44100,
                    "sample_rate": 44100,
                }
                db.execute("DELETE FROM assets WHERE task_id=?", (task_id,))
                if not is_temporary(row):
                    db.executemany(
                        "INSERT INTO assets VALUES(?,?,?,?)",
                        [(key, row["owner_id"], task_id, size) for key, size in keys],
                    )
                else:
                    spec.update(expires_at=time.time() + TEMP_TTL, temporary_bytes=sum(size for _, size in keys))
                    db.execute("UPDATE stem_jobs SET spec=? WHERE id=?", (json.dumps(spec), task_id))
                db.execute(
                    "UPDATE stem_jobs SET status='completed',progress=100,message=?,result=?,updated_at=? WHERE id=?",
                    ("แทร็คของคุณพร้อมแล้ว", json.dumps(result), time.time(), task_id),
                )
            committed = True
        finally:
            if keys and not committed:
                for key, _ in keys:
                    try:
                        storage.delete(key)
                    except Exception:
                        logger.warning("Worker output cleanup pending for %s", task_id)
        # Completion is idempotent even if this HTTP response is lost.
        try:
            discard_input(row["source_key"])
            shutil.rmtree(INCOMING / task_id, ignore_errors=True)
            with connect() as db:
                db.execute(
                    "UPDATE stem_jobs SET source_key='',source_bytes=0 WHERE id=?",
                    (task_id,),
                )
        except Exception:
            logger.warning("Worker input cleanup pending for %s", task_id)
        return {"status": "completed", "task_id": task_id}

    @router.post("/jobs/{task_id}/release")
    def release(task_id: str, body: Lease, worker=Depends(worker_identity)):
        with connect() as db:
            lock_writes(db)
            row = leased(db, task_id, worker, body.lease)
            retry = row["attempts"] < 3
            db.execute(
                "UPDATE stem_jobs SET status=?,progress=5,message=?,lease_until=0,updated_at=? WHERE id=?",
                (
                    "queued" if retry else "failed",
                    "กำลังรอรับงานใหม่" if retry else "ประมวลผลไม่สำเร็จหลายครั้ง กรุณาเริ่มใหม่",
                    time.time(),
                    task_id,
                ),
            )
        return {"ok": True}

    return router


user_router = APIRouter()


@user_router.get("/api/separation-requests/{request_id}")
def recover_request(request_id: str, user=Depends(current_user)):
    task = get(request_task_id(user["id"], request_id), user["id"])
    return {"task": {"task_id": task["id"], "filename": task["filename"], "status": task["status"]} if task else None}


@user_router.post("/api/tasks/{task_id}/cancel", dependencies=[Depends(mutation_guard)])
def cancel(task_id: str, user=Depends(current_user)):
    with connect() as db:
        lock_writes(db)
        row = db.execute(
            "SELECT * FROM stem_jobs WHERE id=? AND owner_id=?", (task_id, user["id"])
        ).fetchone()
        if not row:
            raise HTTPException(404, "ไม่พบงานนี้ กรุณาเริ่มใหม่")
        if row["status"] in {"staging", "queued", "processing"}:
            db.execute(
                "UPDATE stem_jobs SET status='cancelled',message=?,progress=0,lease_until=0,updated_at=? WHERE id=?",
                ("ยกเลิกงานแล้ว", time.time(), task_id),
            )
    maintenance()
    return {
        "status": "cancelled"
        if row["status"] in {"staging", "queued", "processing", "cancelled"}
        else row["status"]
    }


@user_router.get("/api/worker-trash")
def list_trash(user=Depends(current_user)):
    with connect() as db:
        rows = db.execute("SELECT * FROM stem_jobs WHERE owner_id=? AND status IN ('deleted','deleting') ORDER BY updated_at DESC", (user["id"],)).fetchall()
    result = []
    for row in rows:
        item = json.loads(row["spec"])
        item.pop("trash_previous_status", None)
        result.append({"id": row["id"], "filename": item["filename"], "status": row["status"]})
    return result


@user_router.post("/api/tasks/{task_id}/trash", dependencies=[Depends(mutation_guard)])
def trash_job(task_id: str, user=Depends(current_user)):
    with connect() as db:
        lock_writes(db)
        row = db.execute("SELECT * FROM stem_jobs WHERE id=? AND owner_id=?", (task_id, user["id"])).fetchone()
        if not row:
            raise HTTPException(404, "ไม่พบงานนี้")
        if row["status"] in {"staging", "queued", "processing", "deleting", "expiring"}:
            raise HTTPException(409, "กรุณายกเลิกงานก่อนย้ายไปถังขยะ")
        if row["status"] != "deleted":
            spec = json.loads(row["spec"])
            spec["trash_previous_status"] = row["status"]
            db.execute("UPDATE stem_jobs SET status='deleted',spec=?,updated_at=? WHERE id=?", (json.dumps(spec), time.time(), task_id))
    return {"ok": True}


@user_router.post("/api/tasks/{task_id}/restore", dependencies=[Depends(mutation_guard)])
def restore_job(task_id: str, user=Depends(current_user)):
    with connect() as db:
        lock_writes(db)
        row = db.execute("SELECT * FROM stem_jobs WHERE id=? AND owner_id=? AND status='deleted'", (task_id, user["id"])).fetchone()
        if not row:
            raise HTTPException(404, "ไม่พบงานนี้")
        spec = json.loads(row["spec"])
        previous = spec.pop("trash_previous_status", "failed")
        if previous not in {"completed", "failed", "cancelled", "expired"}:
            raise HTTPException(409, "ไม่สามารถกู้คืนนี้ได้")
        db.execute("UPDATE stem_jobs SET status=?,spec=?,updated_at=? WHERE id=?", (previous, json.dumps(spec), time.time(), task_id))
    return {"ok": True}


@user_router.delete("/api/tasks/{task_id}/purge", dependencies=[Depends(mutation_guard)])
def purge_job(task_id: str, user=Depends(current_user)):
    with connect() as db:
        lock_writes(db)
        row = db.execute("SELECT * FROM stem_jobs WHERE id=? AND owner_id=? AND status IN ('deleted','deleting')", (task_id, user["id"])).fetchone()
        if not row:
            raise HTTPException(404, "ไม่พบงานในถังขยะ")
        db.execute("UPDATE stem_jobs SET status='deleting',updated_at=? WHERE id=?", (time.time(), task_id))
        keys = [r[0] for r in db.execute("SELECT object_key FROM assets WHERE task_id=? AND user_id=?", (task_id, user["id"])).fetchall()]
    if is_temporary(row):
        keys.extend(result_keys(row) + [row["source_key"]])
    try:
        for key in set(keys):
            discard_input(key)
    except Exception as error:
        logger.warning("Worker result deletion pending for %s", task_id)
        raise HTTPException(503, "ลบไฟล์ยังไม่ครบ กรุณาลองลบอีกครั้ง") from error
    with connect() as db:
        lock_writes(db)
        row = db.execute("SELECT id FROM stem_jobs WHERE id=? AND owner_id=? AND status='deleting'", (task_id, user["id"])).fetchone()
        if not row:
            raise HTTPException(409, "งานนี้เปลี่ยนสถานะแล้ว")
        db.execute("DELETE FROM assets WHERE task_id=? AND user_id=?", (task_id, user["id"]))
        db.execute("DELETE FROM stem_jobs WHERE id=? AND owner_id=?", (task_id, user["id"]))
    shutil.rmtree(INCOMING / task_id, ignore_errors=True)
    return {"ok": True}
