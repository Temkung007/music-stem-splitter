"""Bounded, resumable client-result uploads that fit CDN request limits."""

import asyncio
import json
import os
import shutil
import time
from pathlib import Path
from uuid import UUID
from weakref import WeakValueDictionary

from auth import current_user, mutation_guard, rate_limit
from cloud import USER_QUOTA
from database import DATA, connect
from fastapi import APIRouter, Depends, HTTPException, Query, Request, UploadFile
from pydantic import BaseModel, Field

ROOT = DATA / "client-incoming"
ROOT.mkdir(mode=0o700, exist_ok=True)
CHUNK_BYTES = 4_000_000
TTL = 2 * 60 * 60
LOCKS = WeakValueDictionary()
MODES = {
    "4stems": {"vocals.wav", "drums.wav", "bass.wav", "other.wav"},
    "2stems": {"vocals.wav", "no_vocals.wav"},
}


class ClientFile(BaseModel):
    name: str
    size_bytes: int = Field(gt=44, le=200_000_000)


class ClientUpload(BaseModel):
    client_id: UUID
    filename: str = Field(min_length=1, max_length=220)
    stems_mode: str
    files: list[ClientFile] = Field(min_length=2, max_length=4)


def cleanup_stages():
    for meta in ROOT.glob("*/*/upload.json"):
        try:
            if time.time() - meta.stat().st_mtime > TTL:
                lock = LOCKS.get(str(meta.parent))
                if lock and lock.locked():
                    continue
                shutil.rmtree(meta.parent)
                LOCKS.pop(str(meta.parent), None)
        except FileNotFoundError:
            pass


def session_path(user_id, client_id):
    return ROOT / user_id / str(client_id)


def read_session(folder):
    try:
        meta = folder / "upload.json"
        if time.time() - meta.stat().st_mtime > TTL:
            raise HTTPException(410, "การอัปโหลดหมดอายุ กรุณากดบันทึกอีกครั้ง")
        return json.loads(meta.read_text())
    except FileNotFoundError as error:
        raise HTTPException(404, "ไม่พบการอัปโหลดนี้") from error


def create_router(importer, tasks, public_task):
    router = APIRouter(
        prefix="/api/client-stems/uploads", dependencies=[Depends(mutation_guard)]
    )

    def completed(user_id, client_id):
        return next(
            (
                public_task(task)
                for task in tasks.values()
                if task.get("owner_id") == user_id
                and task.get("client_id") == str(client_id)
                and task["status"] == "completed"
            ),
            None,
        )

    @router.post("")
    async def initialize(body: ClientUpload, user=Depends(current_user)):
        rate_limit("client-upload-init:" + user["id"], 60)
        found = completed(user["id"], body.client_id)
        if found:
            return {"completed": found}
        expected = MODES.get(body.stems_mode)
        names = [file.name for file in body.files]
        if not expected or set(names) != expected or len(names) != len(expected):
            raise HTTPException(422, "กรุณาส่งแทร็คให้ครบตามรูปแบบที่เลือก")
        total = sum(file.size_bytes for file in body.files)
        with connect() as db:
            used = db.execute(
                "SELECT COALESCE(SUM(size_bytes),0) FROM (SELECT size_bytes FROM tracks WHERE user_id=? UNION ALL SELECT size_bytes FROM assets WHERE user_id=?) AS quota_rows",
                (user["id"], user["id"]),
            ).fetchone()[0]
        if used + total > USER_QUOTA:
            raise HTTPException(
                413, "พื้นที่จัดเก็บไม่พอสำหรับแทร็คผลลัพธ์ กรุณาดาวน์โหลดเก็บในเครื่อง"
            )
        cleanup_stages()
        folder = session_path(user["id"], body.client_id)
        lock = LOCKS.setdefault(str(folder), asyncio.Lock())
        async with lock:
            filename = Path(body.filename.replace("\\", "/")).name
            meta = {
                "client_id": str(body.client_id),
                "filename": filename,
                "stems_mode": body.stems_mode,
                "files": {file.name: file.size_bytes for file in body.files},
            }
            if not filename:
                raise HTTPException(422, "กรุณาระบุชื่อเพลง")
            if folder.exists():
                if read_session(folder) != meta:
                    raise HTTPException(409, "ข้อมูลอัปโหลดไม่ตรงกัน กรุณาเริ่มแยกเสียงใหม่")
            else:
                owner = ROOT / user["id"]
                owner.mkdir(mode=0o700, exist_ok=True)
                if len(list(owner.glob("*/upload.json"))) >= 3:
                    raise HTTPException(429, "มีการอัปโหลดค้างอยู่มากเกินไป กรุณารอสักครู่")
                folder.mkdir(mode=0o700)
                (folder / "upload.json").write_text(json.dumps(meta))
            os.utime(folder / "upload.json", None)
            offsets = {
                name: (folder / name).stat().st_size if (folder / name).exists() else 0
                for name in names
            }
        return {
            "upload_id": str(body.client_id),
            "offsets": offsets,
            "chunk_bytes": CHUNK_BYTES,
        }

    @router.put("/{client_id}/{filename}")
    async def chunk(
        client_id: UUID,
        filename: str,
        request: Request,
        offset: int = Query(ge=0),
        user=Depends(current_user),
    ):
        rate_limit("client-upload-chunk:" + user["id"], 1000)
        folder = session_path(user["id"], client_id)
        meta = read_session(folder)
        if filename not in meta["files"]:
            raise HTTPException(404, "ไม่พบแทร็คนี้")
        data = bytearray()
        async for part in request.stream():
            data.extend(part)
            if len(data) > CHUNK_BYTES:
                raise HTTPException(413, "ชิ้นส่วนอัปโหลดใหญ่เกินกำหนด")
        if not data or offset + len(data) > meta["files"][filename]:
            raise HTTPException(422, "ขนาดชิ้นส่วนอัปโหลดไม่ถูกต้อง")
        lock = LOCKS.setdefault(str(folder), asyncio.Lock())
        async with lock:
            read_session(folder)
            path = folder / filename
            size = path.stat().st_size if path.exists() else 0
            if offset > size:
                raise HTTPException(409, "ตำแหน่งอัปโหลดไม่ถูกต้อง กรุณากดบันทึกอีกครั้ง")
            overlap = min(len(data), size - offset)
            if overlap:
                with path.open("rb") as previous:
                    previous.seek(offset)
                    if previous.read(overlap) != data[:overlap]:
                        raise HTTPException(409, "ข้อมูลชิ้นส่วนไม่ตรงกัน กรุณากดบันทึกอีกครั้ง")
            if overlap < len(data):
                with path.open("ab") as output:
                    output.write(data[overlap:])
            os.utime(folder / "upload.json", None)
            return {"offset": max(size, offset + len(data))}

    @router.post("/{client_id}/complete")
    async def complete(client_id: UUID, user=Depends(current_user)):
        found = completed(user["id"], client_id)
        if found:
            return found
        folder = session_path(user["id"], client_id)
        read_session(folder)
        lock = LOCKS.setdefault(str(folder), asyncio.Lock())
        async with lock:
            found = completed(user["id"], client_id)
            if found:
                return found
            meta = read_session(folder)
            for name, size in meta["files"].items():
                if (
                    not (folder / name).is_file()
                    or (folder / name).stat().st_size != size
                ):
                    raise HTTPException(409, "อัปโหลดแทร็คยังไม่ครบ กรุณากดบันทึกอีกครั้ง")
            files = [
                UploadFile(file=(folder / name).open("rb"), filename=name)
                for name in meta["files"]
            ]
            try:
                result = await importer(
                    files=files,
                    filename=meta["filename"],
                    client_id=str(client_id),
                    stems_mode=meta["stems_mode"],
                    user=user,
                )
            finally:
                for file in files:
                    await file.close()
            shutil.rmtree(folder)
            return result

    @router.delete("/{client_id}")
    async def discard(client_id: UUID, user=Depends(current_user)):
        folder = session_path(user["id"], client_id)
        if not folder.exists():
            return {"ok": True}
        lock = LOCKS.setdefault(str(folder), asyncio.Lock())
        async with lock:
            shutil.rmtree(folder, ignore_errors=True)
        return {"ok": True}

    return router
