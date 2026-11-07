"""Operator-only health snapshots; public customer responses contain no diagnostics."""
import json
import shutil
import time
from datetime import datetime
from database import DATA, connect
from storage import storage

ROOT = DATA / "operations"
LABELS = {
    "api": "เว็บหรือ API ติดต่อไม่ได้", "database": "ฐานข้อมูลติดต่อไม่ได้", "storage": "พื้นที่ Cloud ติดต่อไม่ได้",
    "disk": "พื้นที่เซิร์ฟเวอร์ใกล้เต็ม", "workers": "มีเพลงรอ แต่เครื่องประมวลผลออฟไลน์", "queue": "มีเพลงรอคิวนานกว่า 15 นาที",
    "failures": "มีงานไม่สำเร็จหลายรายการในช่วง 30 นาที", "lease": "มีงานที่เครื่องประมวลผลขาดการติดต่อ",
    "backup": "ยังไม่มี Backup ที่ตรวจสอบผ่านในช่วง 36 ชั่วโมง", "monitor": "ระบบตรวจสุขภาพไม่ได้อัปเดต กรุณาตรวจเซิร์ฟเวอร์",
}


def read_json(path):
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError):
        return {}


def snapshot():
    now = time.time()
    result = {"checked_at": now, "api": True}
    disk = shutil.disk_usage(DATA)
    result.update(disk_percent=(disk.total - disk.free) * 100 / disk.total, disk_free=disk.free)
    try:
        with connect() as db:
            db.execute("SELECT 1").fetchone()
            oldest = db.execute("SELECT MIN(created_at) FROM stem_jobs WHERE status='queued'").fetchone()[0]
            result.update(database=True, waiting=db.execute("SELECT COUNT(*) FROM stem_jobs WHERE status='queued'").fetchone()[0], workers_online=db.execute("SELECT COUNT(*) FROM workers WHERE enabled=1 AND last_seen>?", (now-90,)).fetchone()[0], failed_recent=db.execute("SELECT COUNT(*) FROM stem_jobs WHERE status='failed' AND updated_at>?", (now-1800,)).fetchone()[0], expired_leases=db.execute("SELECT COUNT(*) FROM stem_jobs WHERE status='processing' AND lease_until<?", (now-120,)).fetchone()[0], oldest_wait=now-datetime.fromisoformat(oldest.replace("Z", "+00:00")).timestamp() if oldest else 0)
    except Exception:
        result["database"] = False
    try:
        if storage.client:
            storage.client.head_bucket(Bucket=storage.bucket)
        else:
            assert storage.root.is_dir()
        result["storage"] = True
    except Exception:
        result["storage"] = False
    backup = read_json(ROOT / "backup.json")
    result.update(backup_at=backup.get("completed_at",0), backup_verified=backup.get("verified",False), backup_failed_at=backup.get("failed_at",0))
    return result


def evaluate(data, now=None):
    now = now or time.time()
    alerts = []
    for name in ["api", "database", "storage"]:
        if not data.get(name): alerts.append(name)
    if data.get("disk_percent", 0) >= 85 or data.get("disk_free", 10**12) < 2_000_000_000: alerts.append("disk")
    if data.get("waiting", 0) and not data.get("workers_online", 0): alerts.append("workers")
    if data.get("oldest_wait", 0) > 900: alerts.append("queue")
    if data.get("failed_recent", 0) >= 3: alerts.append("failures")
    if data.get("expired_leases", 0): alerts.append("lease")
    if not data.get("backup_verified") or now-data.get("backup_at", 0) > 36*3600 or data.get("backup_failed_at",0) > data.get("backup_at",0): alerts.append("backup")
    return alerts


def operator_alerts():
    state = read_json(ROOT / "monitor.json")
    codes = state.get("alerts", [])
    if time.time()-state.get("checked_at", 0) > 360: codes = [*codes, "monitor"]
    return [LABELS[code] for code in dict.fromkeys(codes) if code in LABELS]
