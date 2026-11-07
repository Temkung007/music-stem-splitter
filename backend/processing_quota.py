"""Atomic daily allowance of source-audio minutes; distinct from cloud storage."""
import math
import os
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo
from fastapi import HTTPException
from database import connect, lock_writes


def limits(now=None):
    name = os.environ.get("PROCESSING_QUOTA_TIMEZONE", "Asia/Bangkok")
    zone = timezone(timedelta(hours=7)) if name == "Asia/Bangkok" else ZoneInfo(name)
    current = (now or datetime.now(timezone.utc)).astimezone(zone)
    reset = datetime.combine(current.date() + timedelta(days=1), datetime.min.time(), zone)
    return current.date().isoformat(), max(0, int(os.environ.get("DAILY_PROCESSING_MINUTES", "60"))) * 60, reset.isoformat()


def allowance(user, db=None, now=None):
    if db is None:
        with connect() as connection:
            return allowance(user, connection, now)
    day, total, reset = limits(now)
    used = float(db.execute("SELECT COALESCE(SUM(seconds),0) FROM processing_usage WHERE user_id=? AND day=?", (user, day)).fetchone()[0])
    return {"day": day, "limit_minutes": total / 60, "used_minutes": round(used / 60, 2), "remaining_minutes": round(max(0, total - used) / 60, 2) if total else None, "resets_at": reset, "timezone": os.environ.get("PROCESSING_QUOTA_TIMEZONE", "Asia/Bangkok")}


def reserve(db, job, user, seconds, charged=False):
    # Caller holds lock_writes in the transaction that creates the queue item.
    seconds = float(seconds)
    if not math.isfinite(seconds) or seconds <= 0:
        raise HTTPException(422, "ระยะเวลาเพลงไม่ถูกต้อง")
    if db.execute("SELECT job_id FROM processing_usage WHERE job_id=?", (job,)).fetchone():
        return
    day, total, _ = limits()
    used = float(db.execute("SELECT COALESCE(SUM(seconds),0) FROM processing_usage WHERE user_id=? AND day=?", (user, day)).fetchone()[0])
    if total and used + seconds > total + 0.001:
        raise HTTPException(429, "โควตาแยกเสียงวันนี้ไม่พอ กรุณารอรอบใหม่ หรือเลือกแยกบนอุปกรณ์ของคุณ")
    db.execute("INSERT INTO processing_usage VALUES(?,?,?,?,?)", (job, user, day, seconds, int(charged)))


def refund(job):
    with connect() as db:
        lock_writes(db)
        db.execute("DELETE FROM processing_usage WHERE job_id=?", (job,))
