"""User-owned music library and private audio objects."""

import asyncio
import hashlib
import json
import logging
import os
import subprocess
import uuid
import wave
from pathlib import Path

import playlist_ai
from audio_analysis import NOTES, analyze, audio_metadata, camelot
from auth import current_user, mutation_guard, now, rate_limit
from database import DATA, INTEGRITY_ERRORS, connect, lock_writes
from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from storage import storage

router = APIRouter(prefix="/api/cloud")
logger = logging.getLogger("stemora.cloud")
INCOMING = DATA / "incoming"
INCOMING.mkdir(exist_ok=True)
ANALYZER = asyncio.Semaphore(1)
MAX_TRACK_BYTES = 100_000_000
USER_QUOTA = int(os.environ.get("USER_STORAGE_BYTES", str(200_000_000)))
EXTENSIONS = {".mp3", ".wav", ".flac", ".m4a", ".aac", ".ogg"}


# Recovery is explicit: retain stored objects and let the user retry analysis.
def recover_interrupted():
    with connect() as db:
        db.execute(
            "UPDATE tracks SET status='failed',message='งานถูกขัดจังหวะ กดลองวิเคราะห์อีกครั้ง' WHERE status IN ('queued','analyzing')"
        )


def track_for(track_id, user_id, include_deleted=False):
    with connect() as db:
        row = db.execute(
            "SELECT * FROM tracks WHERE id=? AND user_id=?"
            + ("" if include_deleted else " AND deleted_at IS NULL"),
            (track_id, user_id),
        ).fetchone()
    if not row:
        raise HTTPException(404, "ไม่พบเพลงนี้")
    return dict(row)


def public_track(row):
    track = dict(row)
    for field in ["tags", "peaks", "analysis"]:
        track[field] = json.loads(track[field])
    track["camelot"] = camelot(track["musical_key"])
    track["audio_url"] = f"/api/cloud/tracks/{track['id']}/audio"
    return {
        k: v for k, v in track.items() if k not in {"object_key", "sha256", "user_id"}
    }


async def process_track(track_id, source=None):
    try:
        async with ANALYZER:
            with connect() as db:
                track = dict(
                    db.execute(
                        "SELECT * FROM tracks WHERE id=?", (track_id,)
                    ).fetchone()
                )
                db.execute(
                    "UPDATE tracks SET status='analyzing', message='กำลังวิเคราะห์เสียง' WHERE id=?",
                    (track_id,),
                )
            if source is not None:
                await asyncio.to_thread(storage.put, source, track["object_key"])
            else:
                source = await asyncio.to_thread(
                    storage.materialize, track["object_key"]
                )
            features = await asyncio.to_thread(analyze, source)
            with connect() as db:
                db.execute(
                    "UPDATE tracks SET status='ready',message='',bpm=?,musical_key=?,bpm_confidence=?,key_confidence=?,energy=?,peaks=?,analysis=? WHERE id=?",
                    (
                        features["bpm"],
                        features["musical_key"],
                        features["bpm_confidence"],
                        features["key_confidence"],
                        features["energy"],
                        json.dumps(features["peaks"]),
                        json.dumps(features["analysis"], ensure_ascii=False),
                        track_id,
                    ),
                )
    except Exception:
        logger.exception("Analysis failed: %s", track_id)
        with connect() as db:
            db.execute(
                "UPDATE tracks SET status='failed',message='วิเคราะห์ไม่สำเร็จ ตรวจสอบไฟล์แล้วลองอีกครั้ง' WHERE id=?",
                (track_id,),
            )
    finally:
        if source and source.parent == INCOMING:
            source.unlink(missing_ok=True)


def reserve(user_id, filename, digest, size, metadata):
    track_id = str(uuid.uuid4())
    key = f"users/{user_id}/tracks/{track_id}/original{Path(filename).suffix.lower()}"
    try:
        with connect() as db:
            lock_writes(db)
            existing = db.execute(
                "SELECT id,status,deleted_at FROM tracks WHERE user_id=? AND sha256=?",
                (user_id, digest),
            ).fetchone()
            if existing:
                if existing["status"] == "failed" and existing["deleted_at"] is None:
                    db.execute(
                        "UPDATE tracks SET status='queued',message='' WHERE id=?",
                        (existing["id"],),
                    )
                    return existing["id"]
                raise HTTPException(409, "เพลงนี้มีอยู่ในคลังหรือถังขยะแล้ว")
            used = db.execute(
                "SELECT COALESCE(SUM(size_bytes),0) FROM (SELECT size_bytes FROM tracks WHERE user_id=? UNION ALL SELECT size_bytes FROM assets WHERE user_id=?) AS quota_rows",
                (user_id, user_id),
            ).fetchone()[0]
            if used + size > USER_QUOTA:
                raise HTTPException(413, "พื้นที่จัดเก็บเต็ม กรุณาติดต่อผู้ดูแลเพื่อเพิ่มพื้นที่")
            active = db.execute(
                "SELECT COUNT(*) FROM tracks WHERE user_id=? AND status IN ('queued','analyzing')",
                (user_id,),
            ).fetchone()[0]
            if active >= 8:
                raise HTTPException(429, "มีเพลงรอวิเคราะห์มากเกินไป กรุณารอสักครู่")
            db.execute(
                "INSERT INTO tracks(id,user_id,filename,title,artist,genre,object_key,sha256,size_bytes,duration,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
                (
                    track_id,
                    user_id,
                    filename,
                    metadata["title"],
                    metadata["artist"],
                    metadata["genre"],
                    key,
                    digest,
                    size,
                    metadata["duration"],
                    now(),
                ),
            )
    except INTEGRITY_ERRORS as error:
        raise HTTPException(409, "เพลงนี้มีอยู่ในคลังหรือถังขยะแล้ว") from error
    return track_id


@router.get("/summary")
def summary(user=Depends(current_user)):
    with connect() as db:
        counts = db.execute(
            "SELECT COUNT(*) total, COALESCE(SUM(size_bytes),0) used_bytes, SUM(CASE WHEN status='ready' AND deleted_at IS NULL THEN 1 ELSE 0 END) ready FROM tracks WHERE user_id=?",
            (user["id"],),
        ).fetchone()
        asset_bytes = db.execute(
            "SELECT COALESCE(SUM(size_bytes),0) FROM assets WHERE user_id=?",
            (user["id"],),
        ).fetchone()[0]
        counts = dict(counts)
        counts["used_bytes"] += asset_bytes
        playlists = db.execute(
            "SELECT COUNT(*) FROM playlists WHERE user_id=? AND deleted_at IS NULL",
            (user["id"],),
        ).fetchone()[0]
    try:
        status = storage.health()
    except Exception:
        status = {"driver": storage.driver, "ready": False}
    assistant = playlist_ai.ready()
    return {
        **dict(counts),
        "quota_bytes": USER_QUOTA,
        "playlists": playlists,
        "storage": status,
        "assistant": assistant,
        "assistant_configured": playlist_ai.configured(),
    }


@router.get("/tracks")
def list_tracks(trash: bool = False, user=Depends(current_user)):
    with connect() as db:
        rows = db.execute(
            "SELECT * FROM tracks WHERE user_id=? AND deleted_at IS "
            + ("NOT NULL" if trash else "NULL")
            + " ORDER BY created_at DESC",
            (user["id"],),
        ).fetchall()
    return [public_track(row) for row in rows]


@router.get("/tracks/{track_id}")
def get_track(track_id: str, user=Depends(current_user)):
    return public_track(track_for(track_id, user["id"]))


@router.post("/tracks", status_code=202, dependencies=[Depends(mutation_guard)])
async def upload(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    user=Depends(current_user),
):
    rate_limit("upload:" + user["id"], 60)
    filename = Path((file.filename or "audio").replace("\\", "/")).name[:220]
    extension = Path(filename).suffix.lower()
    if extension not in EXTENSIONS:
        raise HTTPException(415, "รองรับ MP3, WAV, FLAC, M4A, AAC และ OGG")
    path = INCOMING / f"{uuid.uuid4()}{extension}"
    digest = hashlib.sha256()
    size = 0
    try:
        with path.open("wb") as output:
            while chunk := await file.read(1024 * 1024):
                size += len(chunk)
                if size > MAX_TRACK_BYTES:
                    raise HTTPException(413, "เพลงต้องมีขนาดไม่เกิน 100 MB")
                digest.update(chunk)
                output.write(chunk)
        if not size:
            raise HTTPException(422, "ไฟล์ไม่มีข้อมูล")
        try:
            metadata = await asyncio.to_thread(audio_metadata, path)
        except ValueError as error:
            raise HTTPException(422, str(error)) from error
        except (subprocess.SubprocessError, KeyError) as error:
            raise HTTPException(422, "ไฟล์เสียหายหรือไม่ใช่ไฟล์เสียง") from error
        if metadata["title"] == path.stem:
            metadata["title"] = Path(filename).stem
        track_id = reserve(user["id"], filename, digest.hexdigest(), size, metadata)
        background_tasks.add_task(process_track, track_id, path)
        return public_track(track_for(track_id, user["id"]))
    except Exception:
        path.unlink(missing_ok=True)
        raise
    finally:
        await file.close()


class TrackPatch(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    artist: str = Field(default="", max_length=120)
    genre: str = Field(default="", max_length=60)
    tags: list[str] = Field(default_factory=list, max_length=20)
    bpm: float | None = Field(default=None, ge=30, le=300)
    musical_key: str | None = Field(default=None, max_length=10)
    energy: int | None = Field(default=None, ge=0, le=100)


@router.patch("/tracks/{track_id}", dependencies=[Depends(mutation_guard)])
def edit_track(track_id: str, body: TrackPatch, user=Depends(current_user)):
    track = track_for(track_id, user["id"])
    if not body.title.strip():
        raise HTTPException(422, "กรุณาระบุชื่อเพลง")
    if body.musical_key and body.musical_key not in {
        f"{n} {m}" for n in NOTES for m in ["major", "minor"]
    }:
        raise HTTPException(422, "คีย์เพลงไม่ถูกต้อง")
    tags = [t.strip()[:40] for t in body.tags if t.strip()]
    analysis = json.loads(track["analysis"])
    analysis["manually_edited"] = True
    with connect() as db:
        db.execute(
            "UPDATE tracks SET title=?,artist=?,genre=?,tags=?,bpm=?,musical_key=?,energy=?,analysis=? WHERE id=?",
            (
                body.title.strip(),
                body.artist.strip(),
                body.genre.strip(),
                json.dumps(tags, ensure_ascii=False),
                body.bpm,
                body.musical_key,
                body.energy,
                json.dumps(analysis, ensure_ascii=False),
                track_id,
            ),
        )
    return public_track(track_for(track_id, user["id"]))


@router.delete("/tracks/{track_id}", dependencies=[Depends(mutation_guard)])
def trash_track(track_id: str, user=Depends(current_user)):
    track = track_for(track_id, user["id"])
    if track["status"] in {"queued", "analyzing"}:
        raise HTTPException(409, "กรุณารอวิเคราะห์เสร็จก่อนย้ายไปถังขยะ")
    with connect() as db:
        db.execute("UPDATE tracks SET deleted_at=? WHERE id=?", (now(), track_id))
    return {"ok": True}


@router.post("/tracks/{track_id}/restore", dependencies=[Depends(mutation_guard)])
def restore_track(track_id: str, user=Depends(current_user)):
    track_for(track_id, user["id"], True)
    with connect() as db:
        db.execute("UPDATE tracks SET deleted_at=NULL WHERE id=?", (track_id,))
    return public_track(track_for(track_id, user["id"]))


@router.post("/tracks/{track_id}/analyze", dependencies=[Depends(mutation_guard)])
def retry_analysis(
    track_id: str, background_tasks: BackgroundTasks, user=Depends(current_user)
):
    track = track_for(track_id, user["id"])
    if track["status"] in {"queued", "analyzing"}:
        raise HTTPException(409, "กำลังวิเคราะห์เพลงนี้อยู่")
    rate_limit("analyze:" + user["id"], 30)
    with connect() as db:
        db.execute(
            "UPDATE tracks SET status='queued',message='รอวิเคราะห์' WHERE id=?",
            (track_id,),
        )
    background_tasks.add_task(process_track, track_id)
    return {"ok": True}


@router.get("/tracks/{track_id}/audio")
def stream(track_id: str, download: bool = False, user=Depends(current_user)):
    track = track_for(track_id, user["id"])
    try:
        path = storage.materialize(track["object_key"])
    except Exception as error:
        raise HTTPException(503, "ไฟล์ยังไม่พร้อม กรุณาลองใหม่") from error
    return FileResponse(
        path,
        filename=track["filename"],
        content_disposition_type="attachment" if download else "inline",
        headers={"Cache-Control": "private, no-store"},
    )


def make_library_demo(path, bpm, note, energy):
    import numpy as np

    rate = 22050
    duration = 16
    t = np.arange(rate * duration) / rate
    beat = 60 / bpm
    position = t % beat
    frequency = 440 * 2 ** ((note - 69) / 12)
    sound = 0.13 * np.sin(2 * np.pi * frequency * t) * np.exp(
        -position * 4
    ) + 0.08 * np.sin(2 * np.pi * frequency / 2 * t)
    sound += (
        energy
        * 0.30
        * np.sin(2 * np.pi * (52 * position + 5 * (1 - np.exp(-position * 30))))
        * np.exp(-position * 28)
    )
    sound += (
        energy * 0.025 * np.sin(2 * np.pi * 7103 * t) * np.exp(-(t % (beat / 2)) * 70)
    )
    sound *= np.minimum(np.minimum(t * 8, (duration - t) * 8), 1)
    with wave.open(str(path), "wb") as out:
        out.setparams((1, 2, rate, 0, "NONE", "not compressed"))
        out.writeframes((np.clip(sound, -1, 1) * 32767).astype("<i2").tobytes())


@router.post("/demo", status_code=202, dependencies=[Depends(mutation_guard)])
async def demo_library(background_tasks: BackgroundTasks, user=Depends(current_user)):
    rate_limit("demo:" + user["id"], 2)
    identifiers = []
    for title, artist, genre, bpm, note, energy in [
        ("Bangkok Midnight", "Nova Skyline", "Tech House", 126, 60, 0.85),
        ("Phuket Sunset Groove", "DJ Sunburst", "Melodic House", 122, 65, 0.72),
        ("Chao Phraya Deep", "Aqua Resonance", "Deep House", 124, 62, 0.78),
        ("Neon Silom", "Cyberpulse", "Nu-Disco / Synth", 120, 57, 0.68),
        ("Thonglor Afterhours", "K-Rhythm", "Afro House / Peak", 128, 64, 0.92),
    ]:
        path = INCOMING / f"{uuid.uuid4()}.wav"
        await asyncio.to_thread(make_library_demo, path, bpm, note, energy)
        try:
            digest = hashlib.sha256(path.read_bytes()).hexdigest()
            track_id = reserve(
                user["id"],
                title + ".wav",
                digest,
                path.stat().st_size,
                {
                    "title": title,
                    "artist": artist,
                    "genre": genre,
                    "duration": 16,
                },
            )
            identifiers.append(track_id)
            background_tasks.add_task(process_track, track_id, path)
        except HTTPException as error:
            path.unlink(missing_ok=True)
            if error.status_code != 409:
                raise

    async def seed_playlist_after(track_ids, uid):
        await asyncio.sleep(3)
        try:
            with connect() as db:
                existing = db.execute("SELECT COUNT(*) FROM playlists WHERE user_id=? AND deleted_at IS NULL", (uid,)).fetchone()[0]
                if existing == 0 and track_ids:
                    pid = str(uuid.uuid4())
                    ts = datetime.now(timezone.utc).isoformat()
                    items = [{"track_id": tid, "note": f"Camelot transition {idx+1}", "locked": False} for idx, tid in enumerate(track_ids)]
                    db.execute(
                        "INSERT INTO playlists(id, user_id, name, description, prompt, target_minutes, profile, items, revision, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)",
                        (pid, uid, "Weekend Club Peak (Rekordbox Ready)", "เซ็ตเพลงทดสอบระบบ 5 เพลง คัดสรรคีย์และ BPM พร้อมเปิดใน Pioneer DJ rekordbox", "จัดเพลงปาร์ตี้พลังงานสูง 5 เพลง", 60, "build", json.dumps(items, ensure_ascii=False), ts, ts)
                    )
        except Exception:
            logger.exception("Failed to auto-seed playlist for user: %s", uid)

    if identifiers:
        background_tasks.add_task(seed_playlist_after, identifiers, user["id"])

    return {
        "track_ids": identifiers,
        "message": "เพิ่มเพลงทดสอบระบบ 5 เพลงสำหรับทดลองระบบพร้อมเปิดใน rekordbox แล้ว",
    }
