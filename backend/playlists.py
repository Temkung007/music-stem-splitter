"""Explainable set planning with server-side language understanding."""

import asyncio
import csv
import io
import json
import math
import os
import re
import tempfile
import uuid
import zipfile
from pathlib import Path

import playlist_ai
from audio_analysis import camelot
from auth import current_user, mutation_guard, now, rate_limit
from database import DATA, connect, lock_writes
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse, Response
from i18n import t
from pydantic import BaseModel, Field
from rekordbox_export import generate_rekordbox_xml
from starlette.background import BackgroundTask
from storage import storage

router = APIRouter(prefix="/api/playlists")
LANGUAGE_WORKERS = asyncio.Semaphore(2)


class Item(BaseModel):
    track_id: str
    locked: bool = False
    note: str = Field(default="", max_length=500)


class PlaylistInput(BaseModel):
    name: str = Field(default="Untitled set", min_length=1, max_length=120)
    description: str = Field(default="", max_length=2000)
    prompt: str = Field(default="", max_length=2000)
    target_minutes: int = Field(default=60, ge=1, le=480)
    profile: str = Field(default="build", pattern="^(build|wave|steady|closing)$")
    items: list[Item] = Field(default_factory=list, max_length=300)
    revision: int | None = None


class ComposeInput(BaseModel):
    name: str = Field(default="My next set", min_length=1, max_length=120)
    prompt: str = Field(default="", max_length=2000)
    target_minutes: int = Field(default=60, ge=1, le=480)
    profile: str = Field(default="build", pattern="^(build|wave|steady|closing)$")
    track_ids: list[str] = Field(default_factory=list, max_length=500)
    excluded_ids: list[str] = Field(default_factory=list, max_length=500)
    genre: str = Field(default="", max_length=60)
    bpm_min: float = Field(default=30, ge=30, le=300)
    bpm_max: float = Field(default=300, ge=30, le=300)
    playlist_id: str | None = None
    revision: int | None = None


def playlist_for(playlist_id, user_id, deleted=False):
    with connect() as db:
        row = db.execute(
            "SELECT * FROM playlists WHERE id=? AND user_id=?"
            + ("" if deleted else " AND deleted_at IS NULL"),
            (playlist_id, user_id),
        ).fetchone()
    if not row:
        raise HTTPException(404, "ไม่พบเพลย์ลิสต์นี้")
    return dict(row)


def serialize(row):
    result = dict(row)
    result["items"] = json.loads(result["items"])
    result.pop("user_id", None)
    if result["description"].startswith("จัดจาก BPM"):
        result["description"] = re.sub(
            r"ของ \d+ เพลง", f"ของ {len(result['items'])} เพลง", result["description"]
        )
    if result["description"].startswith("Arranged from the BPM"):
        result["description"] = re.sub(
            r"of \d+ songs", f"of {len(result['items'])} songs", result["description"]
        )
    return result


def validate_items(items, user_id):
    ids = [item.track_id for item in items]
    if len(ids) != len(set(ids)):
        raise HTTPException(422, "เพลย์ลิสต์มีเพลงซ้ำ")
    with connect() as db:
        owned = {
            row[0]
            for row in db.execute(
                "SELECT id FROM tracks WHERE user_id=? AND deleted_at IS NULL AND status='ready'",
                (user_id,),
            ).fetchall()
        }
    if not set(ids).issubset(owned):
        raise HTTPException(422, "บางเพลงยังไม่พร้อมหรือไม่อยู่ในคลังของคุณ")


def save(user_id, body, playlist_id=None):
    if not body.name.strip():
        raise HTTPException(422, "กรุณาระบุชื่อเพลย์ลิสต์")
    validate_items(body.items, user_id)
    timestamp = now()
    with connect() as db:
        lock_writes(db)
        if playlist_id:
            previous = db.execute(
                "SELECT * FROM playlists WHERE id=? AND user_id=? AND deleted_at IS NULL",
                (playlist_id, user_id),
            ).fetchone()
            if not previous:
                raise HTTPException(404, "ไม่พบเพลย์ลิสต์นี้")
            if body.revision != previous["revision"]:
                raise HTTPException(409, "เพลย์ลิสต์ถูกแก้ไขจากอีกหน้าต่างแล้ว กรุณาโหลดใหม่")
            db.execute(
                "INSERT INTO playlist_versions VALUES(?,?,?,?)",
                (
                    playlist_id,
                    previous["revision"],
                    json.dumps(dict(previous), ensure_ascii=False),
                    timestamp,
                ),
            )
            db.execute(
                "UPDATE playlists SET name=?,description=?,prompt=?,target_minutes=?,profile=?,items=?,revision=revision+1,updated_at=? WHERE id=?",
                (
                    body.name.strip(),
                    body.description,
                    body.prompt,
                    body.target_minutes,
                    body.profile,
                    json.dumps(
                        [i.model_dump() for i in body.items], ensure_ascii=False
                    ),
                    timestamp,
                    playlist_id,
                ),
            )
            db.execute(
                "DELETE FROM playlist_versions WHERE playlist_id=? AND revision < ?",
                (playlist_id, max(0, previous["revision"] - 19)),
            )
        else:
            playlist_id = str(uuid.uuid4())
            db.execute(
                "INSERT INTO playlists(id,user_id,name,description,prompt,target_minutes,profile,items,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
                (
                    playlist_id,
                    user_id,
                    body.name.strip(),
                    body.description,
                    body.prompt,
                    body.target_minutes,
                    body.profile,
                    json.dumps(
                        [i.model_dump() for i in body.items], ensure_ascii=False
                    ),
                    timestamp,
                    timestamp,
                ),
            )
    return serialize(playlist_for(playlist_id, user_id))


@router.get("")
def list_playlists(trash: bool = False, user=Depends(current_user)):
    with connect() as db:
        rows = db.execute(
            "SELECT * FROM playlists WHERE user_id=? AND deleted_at IS "
            + ("NOT NULL" if trash else "NULL")
            + " ORDER BY updated_at DESC",
            (user["id"],),
        ).fetchall()
    return [serialize(row) for row in rows]


@router.post("", status_code=201, dependencies=[Depends(mutation_guard)])
def create(body: PlaylistInput, user=Depends(current_user)):
    return save(user["id"], body)


@router.get("/export/rekordbox")
def export_all_rekordbox(user=Depends(current_user)):
    with connect() as db:
        playlists_rows = db.execute(
            "SELECT * FROM playlists WHERE user_id=? AND deleted_at IS NULL ORDER BY updated_at DESC",
            (user["id"],),
        ).fetchall()
        tracks_rows = db.execute(
            "SELECT * FROM tracks WHERE user_id=? AND deleted_at IS NULL AND status='ready'",
            (user["id"],),
        ).fetchall()
    playlists = [dict(r) for r in playlists_rows]
    tracks = [dict(r) for r in tracks_rows]
    xml_content = generate_rekordbox_xml(playlists, tracks)
    return Response(
        xml_content,
        media_type="application/xml",
        headers={
            "Content-Disposition": 'attachment; filename="stemora_rekordbox_library.xml"'
        },
    )


@router.get("/{playlist_id}")
def get(playlist_id: str, user=Depends(current_user)):
    return serialize(playlist_for(playlist_id, user["id"]))


@router.put("/{playlist_id}", dependencies=[Depends(mutation_guard)])
def update(playlist_id: str, body: PlaylistInput, user=Depends(current_user)):
    return save(user["id"], body, playlist_id)


@router.delete("/{playlist_id}", dependencies=[Depends(mutation_guard)])
def delete(playlist_id: str, user=Depends(current_user)):
    playlist_for(playlist_id, user["id"])
    with connect() as db:
        db.execute("UPDATE playlists SET deleted_at=? WHERE id=?", (now(), playlist_id))
    return {"ok": True}


@router.post("/{playlist_id}/restore", dependencies=[Depends(mutation_guard)])
def restore(playlist_id: str, user=Depends(current_user)):
    playlist_for(playlist_id, user["id"], True)
    with connect() as db:
        db.execute("UPDATE playlists SET deleted_at=NULL WHERE id=?", (playlist_id,))
    return serialize(playlist_for(playlist_id, user["id"]))


@router.post(
    "/{playlist_id}/duplicate", status_code=201, dependencies=[Depends(mutation_guard)]
)
def duplicate(playlist_id: str, user=Depends(current_user)):
    original = serialize(playlist_for(playlist_id, user["id"]))
    original["name"] = original["name"][:110] + " · Copy"
    return save(user["id"], PlaylistInput(**original))


@router.get("/{playlist_id}/versions")
def versions(playlist_id: str, user=Depends(current_user)):
    playlist_for(playlist_id, user["id"])
    with connect() as db:
        rows = db.execute(
            "SELECT revision,created_at FROM playlist_versions WHERE playlist_id=? ORDER BY revision DESC LIMIT 20",
            (playlist_id,),
        ).fetchall()
    return [dict(row) for row in rows]


class RestoreVersion(BaseModel):
    version: int
    revision: int


@router.post("/{playlist_id}/versions/restore", dependencies=[Depends(mutation_guard)])
def restore_version(playlist_id: str, body: RestoreVersion, user=Depends(current_user)):
    playlist_for(playlist_id, user["id"])
    with connect() as db:
        row = db.execute(
            "SELECT snapshot FROM playlist_versions WHERE playlist_id=? AND revision=?",
            (playlist_id, body.version),
        ).fetchone()
    if not row:
        raise HTTPException(404, "ไม่พบเวอร์ชันนี้")
    snapshot = json.loads(row[0])
    snapshot["items"] = json.loads(snapshot["items"])
    snapshot["revision"] = body.revision
    return save(user["id"], PlaylistInput(**snapshot), playlist_id)


def compatible(first, second):
    a = camelot(first)
    b = camelot(second)
    if not a or not b:
        return 0.5
    distance = abs(int(a[:-1]) - int(b[:-1]))
    distance = min(distance, 12 - distance)
    return (
        0
        if (distance == 0 or distance == 1 and a[-1] == b[-1])
        else min(1, distance / 4 + 0.25 * (a[-1] != b[-1]))
    )


def targets(profile, position):
    if profile == "steady":
        return 60
    if profile == "closing":
        return 85 - position * 50
    if profile == "wave":
        return 45 + 40 * math.sin(position * math.pi) ** 2
    return 30 + position * 60


async def understand(body, available_genres=()):
    """Only parse the brief; ranking always uses owned tracks and measured data."""
    parameters = body.model_dump()
    assistant = False
    # Local interpretation also supports duration/BPM in short Thai or English briefs.
    minutes = re.search(r"(\d{1,3})\s*(?:นาที|minutes?|mins?)", body.prompt, re.I)
    if minutes:
        parameters["target_minutes"] = max(1, min(480, int(minutes[1])))
    hours = re.search(r"(\d+(?:\.\d+)?)\s*(?:ชั่วโมง|hours?|hrs?)", body.prompt, re.I)
    if hours:
        parameters["target_minutes"] = max(
            1,
            min(480, round(float(hours[1]) * 60) + (int(minutes[1]) if minutes else 0)),
        )
    if not body.genre:
        for genre in sorted(available_genres, key=len, reverse=True):
            if genre and genre.casefold() in body.prompt.casefold():
                parameters["genre"] = genre
                break
    bpm = re.search(r"(\d{2,3})\s*[-–]\s*(\d{2,3})\s*bpm", body.prompt, re.I)
    if bpm:
        parameters["bpm_min"] = max(30, min(300, int(bpm[1])))
        parameters["bpm_max"] = max(parameters["bpm_min"], min(300, int(bpm[2])))
    if re.search(r"ค่อย.*เพิ่ม|build|ไต่", body.prompt, re.I):
        parameters["profile"] = "build"
    elif re.search(r"ปิดงาน|closing|ลดพลัง", body.prompt, re.I):
        parameters["profile"] = "closing"
    elif re.search(r"เป็นช่วง|wave|สลับ.*พลัง", body.prompt, re.I):
        parameters["profile"] = "wave"
    if playlist_ai.configured() and body.prompt.strip():
        try:
            if playlist_ai.provider() == "gemini":
                # Shared paid-provider guard persists across backend restarts.
                maximum = max(
                    1, min(1000, int(os.environ.get("GEMINI_CALLS_PER_15_MIN", "100")))
                )
                rate_limit("playlist-ai:gemini:global", maximum)
            async with LANGUAGE_WORKERS:
                parsed = await asyncio.to_thread(
                    playlist_ai.extract_plan,
                    body.prompt,
                    {
                        "target_minutes": parameters["target_minutes"],
                        "profile": parameters["profile"],
                    },
                )
            parameters.update(playlist_ai.validate_plan(parsed))
            assistant = True
        except Exception:
            # Local interpretation and measured-data planning remain available.
            # Provider errors and credentials never reach the browser.
            pass
    return ComposeInput(**parameters), assistant


@router.post("/compose", dependencies=[Depends(mutation_guard)])
async def compose(body: ComposeInput, user=Depends(current_user)):
    rate_limit("compose:" + user["id"], 30)
    with connect() as db:
        available_genres = [
            row[0]
            for row in db.execute(
                "SELECT DISTINCT genre FROM tracks WHERE user_id=? AND deleted_at IS NULL",
                (user["id"],),
            ).fetchall()
        ]
    body, assistant = await understand(body, available_genres)
    if body.bpm_min > body.bpm_max:
        raise HTTPException(422, "ช่วง BPM ไม่ถูกต้อง")
    previous = playlist_for(body.playlist_id, user["id"]) if body.playlist_id else None
    locked = (
        {
            i: Item(**entry)
            for i, entry in enumerate(json.loads(previous["items"]))
            if entry.get("locked")
        }
        if previous
        else {}
    )
    with connect() as db:
        rows = [
            dict(row)
            for row in db.execute(
                "SELECT * FROM tracks WHERE user_id=? AND status='ready' AND deleted_at IS NULL ORDER BY title,id",
                (user["id"],),
            ).fetchall()
        ]
    all_tracks = {row["id"]: row for row in rows}
    if any(item.track_id not in all_tracks for item in locked.values()):
        raise HTTPException(422, "มีเพลงที่ล็อกไว้ถูกลบจากคลัง กรุณาปลดล็อกก่อน")
    locked_ids = {item.track_id for item in locked.values()}
    candidates = [
        row
        for row in rows
        if row["id"] not in locked_ids
        and row["id"] not in body.excluded_ids
        and (not body.track_ids or row["id"] in body.track_ids)
        and (not body.genre or body.genre.casefold() in row["genre"].casefold())
        and (row["bpm"] is None or body.bpm_min <= row["bpm"] <= body.bpm_max)
    ]
    if not candidates and not locked:
        raise HTTPException(422, "ยังไม่มีเพลงที่พร้อมและตรงกับเงื่อนไข ลองเพิ่มเพลงหรือปรับตัวกรอง")
    available = sum(row["duration"] for row in candidates) + sum(
        all_tracks[item.track_id]["duration"] for item in locked.values()
    )
    target = min(body.target_minutes * 60, available)
    elapsed = 0
    items = []
    last = None
    while (
        (candidates or len(items) <= max(locked, default=-1))
        and (elapsed < target or len(items) <= max(locked, default=-1))
        and len(items) < 300
    ):
        index = len(items)
        if index in locked:
            chosen = all_tracks[locked[index].track_id]
            item = locked[index]
        else:
            if not candidates:
                break
            energy_target = targets(body.profile, elapsed / max(target, 1))

            def score(track):
                energy = (
                    abs(
                        (track["energy"] if track["energy"] is not None else 50)
                        - energy_target
                    )
                    / 100
                )
                tempo = (
                    0
                    if not last or not last["bpm"] or not track["bpm"]
                    else min(
                        abs(last["bpm"] - track["bpm"]),
                        abs(last["bpm"] - track["bpm"] * 2),
                        abs(last["bpm"] * 2 - track["bpm"]),
                    )
                    / 25
                )
                harmonic = (
                    compatible(last["musical_key"], track["musical_key"]) if last else 0
                )
                repeat = (
                    0.1
                    if last and last["artist"] and last["artist"] == track["artist"]
                    else 0
                )
                return energy * 1.6 + tempo * 0.8 + harmonic * 0.65 + repeat

            chosen = min(candidates, key=score)
            candidates.remove(chosen)
            reasons = []
            if last and last["bpm"] and chosen["bpm"]:
                reasons.append(t(f"BPM ต่าง {abs(last['bpm'] - chosen['bpm']):.1f}"))
            if last and last["musical_key"] and chosen["musical_key"]:
                reasons.append(
                    t("คีย์เข้ากัน")
                    if compatible(last["musical_key"], chosen["musical_key"]) == 0
                    else t("ทดลองฟังช่วงเปลี่ยนคีย์")
                )
            reasons.append(
                t(
                    f"พลังงาน {chosen['energy'] if chosen['energy'] is not None else t('ไม่ทราบ')}/100"
                )
            )
            item = Item(track_id=chosen["id"], note=" · ".join(reasons))
        items.append(item)
        elapsed += chosen["duration"]
        last = chosen
    if any(
        item.track_id not in {i.track_id for i in items} for item in locked.values()
    ):
        raise HTTPException(422, "ไม่สามารถรักษาตำแหน่งเพลงที่ล็อกไว้ด้วยจำนวนเพลงปัจจุบัน")
    description = f"จัดจาก BPM คีย์ และพลังงานของ {len(items)} เพลง" + (
        " โดย AI ช่วยอ่านคำสั่ง" if assistant else ""
    )
    if elapsed < body.target_minutes * 60:
        description += " · เพลงในคลังยังสั้นกว่าเวลาที่ขอ"
    payload = PlaylistInput(
        name=body.name,
        prompt=body.prompt,
        target_minutes=body.target_minutes,
        profile=body.profile,
        items=items,
        description=t(description),
        revision=body.revision,
    )
    result = save(user["id"], payload, body.playlist_id)
    result["assistant_used"] = assistant
    return result


def export_entries(playlist, user_id):
    with connect() as db:
        owned = {
            row["id"]: dict(row)
            for row in db.execute(
                "SELECT * FROM tracks WHERE user_id=? AND deleted_at IS NULL",
                (user_id,),
            ).fetchall()
        }
    items = json.loads(playlist["items"])
    if any(item["track_id"] not in owned for item in items):
        raise HTTPException(409, "มีเพลงอยู่ในถังขยะ กรุณากู้คืนหรือนำออกจากเพลย์ลิสต์ก่อนส่งออก")
    entries = []
    for index, item in enumerate(items):
        track = owned[item["track_id"]]
        safe = re.sub(r"[^\w .-]", "_", track["title"])[:100]
        track["export_filename"] = (
            f"{index + 1:03d} {safe}{Path(track['filename']).suffix.lower()}"
        )
        entries.append(track)
    return entries


@router.get("/{playlist_id}/export")
def export(playlist_id: str, format: str = "m3u", user=Depends(current_user)):
    playlist = playlist_for(playlist_id, user["id"])
    entries = export_entries(playlist, user["id"])
    filename = re.sub(r"[^\w .-]", "_", playlist["name"])[:100]
    if format == "csv":
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(
            [
                "Order",
                "Title",
                "Artist",
                "BPM",
                "Key",
                "Camelot",
                "Energy",
                "Duration",
                "Filename",
            ]
        )

        def safe_cell(value):
            value = str(value or "")
            return (
                "'" + value
                if value.lstrip().startswith(("=", "+", "-", "@", "\t", "\r"))
                else value
            )

        for i, track in enumerate(entries):
            writer.writerow(
                [
                    i + 1,
                    *[
                        safe_cell(track[k])
                        for k in ["title", "artist", "bpm", "musical_key"]
                    ],
                    camelot(track["musical_key"]),
                    track["energy"],
                    track["duration"],
                    safe_cell(track["export_filename"]),
                ]
            )
        return Response(
            "\ufeff" + output.getvalue(),
            media_type="text/csv",
            headers={
                "Content-Disposition": f"attachment; filename*=UTF-8''{__import__('urllib.parse', fromlist=['quote']).quote(filename)}.csv"
            },
        )
    m3u = (
        "#EXTM3U\n"
        + "\n".join(
            f"#EXTINF:{int(t['duration'])},{t['artist'].replace(chr(10), ' ').replace(chr(13), ' ')} - {t['title'].replace(chr(10), ' ').replace(chr(13), ' ')}\n{t['export_filename']}"
            for t in entries
        )
        + "\n"
    )
    if format == "m3u":
        return Response(
            m3u,
            media_type="audio/x-mpegurl",
            headers={"Content-Disposition": 'attachment; filename="playlist.m3u8"'},
        )
    if format in ("rekordbox", "rekordbox_xml", "xml"):
        xml_content = generate_rekordbox_xml([playlist], entries)
        quoted = __import__("urllib.parse", fromlist=["quote"]).quote(
            f"{filename}_rekordbox.xml"
        )
        return Response(
            xml_content,
            media_type="application/xml",
            headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quoted}"},
        )
    if format == "rekordbox_zip":
        if sum(t["size_bytes"] for t in entries) > 1024**3:
            raise HTTPException(
                413, "ส่งออก ZIP ได้ครั้งละไม่เกิน 1 GB กรุณาแบ่งเพลย์ลิสต์"
            )
        xml_content = generate_rekordbox_xml([playlist], entries)
        descriptor, name = tempfile.mkstemp(suffix=".zip", dir=DATA)
        os.close(descriptor)
        temporary = Path(name)
        try:
            with zipfile.ZipFile(temporary, "w", zipfile.ZIP_STORED) as archive:
                archive.writestr("rekordbox.xml", xml_content)
                archive.writestr("playlist.m3u8", m3u)
                for track in entries:
                    archive.write(
                        storage.materialize(track["object_key"]),
                        track["export_filename"],
                    )
        except Exception:
            temporary.unlink(missing_ok=True)
            raise HTTPException(503, "เตรียมไฟล์ไม่สำเร็จ กรุณาลองใหม่")
        return FileResponse(
            temporary,
            filename=f"{filename}_rekordbox.zip",
            media_type="application/zip",
            background=BackgroundTask(temporary.unlink, missing_ok=True),
        )
    if format != "zip":
        raise HTTPException(422, "รองรับ m3u, csv, zip หรือ rekordbox")
    if sum(t["size_bytes"] for t in entries) > 1024**3:
        raise HTTPException(413, "ส่งออก ZIP ได้ครั้งละไม่เกิน 1 GB กรุณาแบ่งเพลย์ลิสต์")
    descriptor, name = tempfile.mkstemp(suffix=".zip", dir=DATA)
    os.close(descriptor)
    temporary = Path(name)
    try:
        with zipfile.ZipFile(temporary, "w", zipfile.ZIP_STORED) as archive:
            archive.writestr("playlist.m3u8", m3u)
            for track in entries:
                archive.write(
                    storage.materialize(track["object_key"]), track["export_filename"]
                )
    except Exception:
        temporary.unlink(missing_ok=True)
        raise HTTPException(503, "เตรียมไฟล์ไม่สำเร็จ กรุณาลองใหม่")
    return FileResponse(
        temporary,
        filename=filename + ".zip",
        media_type="application/zip",
        background=BackgroundTask(temporary.unlink, missing_ok=True),
    )


class SuggestionInput(BaseModel):
    revision: int
    action: str = Field(default="next", pattern="^(next|replace)$")
    index: int | None = Field(default=None, ge=0, le=299)


@router.post("/{playlist_id}/suggest", dependencies=[Depends(mutation_guard)])
def suggest(playlist_id: str, body: SuggestionInput, user=Depends(current_user)):
    rate_limit("suggest:" + user["id"], 60)
    playlist = playlist_for(playlist_id, user["id"])
    if playlist["revision"] != body.revision:
        raise HTTPException(409, "เพลย์ลิสต์เปลี่ยนจากอีกหน้าต่างแล้ว กรุณาโหลดใหม่")
    items = [Item(**entry) for entry in json.loads(playlist["items"])]
    index = len(items) if body.action == "next" else body.index
    if index is None or body.action == "replace" and index >= len(items):
        raise HTTPException(422, "ตำแหน่งเพลงไม่ถูกต้อง")
    if body.action == "next" and len(items) >= 300:
        raise HTTPException(422, "เพลย์ลิสต์รองรับไม่เกิน 300 เพลง")
    if body.action == "replace" and items[index].locked:
        raise HTTPException(409, "กรุณาปลดล็อกเพลงก่อนให้ระบบแนะนำเพลงแทน")
    with connect() as db:
        tracks = {
            row["id"]: dict(row)
            for row in db.execute(
                "SELECT * FROM tracks WHERE user_id=? AND status='ready' AND deleted_at IS NULL",
                (user["id"],),
            ).fetchall()
        }
    if any(item.track_id not in tracks for item in items):
        raise HTTPException(422, "มีเพลงถูกย้ายไปถังขยะ กรุณากู้คืนหรือนำออกก่อน")
    used = {item.track_id for item in items}
    candidates = [track for track in tracks.values() if track["id"] not in used]
    if not candidates:
        raise HTTPException(422, "ยังไม่มีเพลงอื่นเหลือให้แนะนำ ลองเพิ่มเพลงในคลัง")
    previous = tracks[items[index - 1].track_id] if index > 0 else None
    following = tracks[items[index + 1].track_id] if index + 1 < len(items) else None
    position = sum(tracks[item.track_id]["duration"] for item in items[:index]) / max(
        60, playlist["target_minutes"] * 60
    )
    energy_target = targets(playlist["profile"], min(1, position))

    def score(track):
        value = (
            abs(
                (track["energy"] if track["energy"] is not None else 50) - energy_target
            )
            / 65
        )
        for neighbor in [previous, following]:
            if not neighbor:
                continue
            if track["bpm"] and neighbor["bpm"]:
                value += (
                    min(
                        abs(track["bpm"] - neighbor["bpm"]),
                        abs(track["bpm"] * 2 - neighbor["bpm"]),
                        abs(track["bpm"] - neighbor["bpm"] * 2),
                    )
                    / 30
                )
            value += compatible(track["musical_key"], neighbor["musical_key"]) * 0.5
            if neighbor["genre"] and track["genre"] != neighbor["genre"]:
                value += 0.15
        return value

    choice = min(candidates, key=lambda track: (score(track), track["id"]))
    note = t(
        f"แนะนำจากจังหวะ คีย์ และพลังงาน {choice['energy'] if choice['energy'] is not None else t('ไม่ทราบ')}/100"
    )
    replacement = Item(track_id=choice["id"], note=note)
    if body.action == "next":
        items.append(replacement)
    else:
        items[index] = replacement
        if index + 1 < len(items) and items[index + 1].note.startswith(
            ("BPM ต่าง", "BPM difference")
        ):
            items[index + 1].note = t("เปลี่ยนเพลงก่อนหน้า · ตรวจฟังช่วงเปลี่ยนเพลง")
    data = serialize(playlist)
    data["items"] = [item.model_dump() for item in items]
    return save(user["id"], PlaylistInput(**data), playlist_id)
