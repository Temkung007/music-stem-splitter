"""STEMORA Live Sync Engine for Pioneer DJ rekordbox.

Provides:
- User sync tokens (st_live_...) for persistent CLI / agent authentication
- Manifest endpoint (/api/sync/manifest) with all playlists and ready tracks
- Standalone zero-dependency Python sync client (/api/sync/agent.py)
"""

import hashlib
import json
import re
import secrets
from datetime import datetime, timezone
from pathlib import Path

from audio_analysis import camelot
from auth import current_user, now
from database import connect
from fastapi import APIRouter, Depends, HTTPException, Response

router = APIRouter(prefix="/api/sync")

AGENT_SCRIPT = '''#!/usr/bin/env python3
"""
STEMORA Rekordbox Live Sync Agent
Synchronizes STEMORA playlists and tracks directly with Pioneer DJ rekordbox.
Zero third-party dependencies - runs with standard Python 3 on macOS and Windows.
"""

import argparse
import hashlib
import json
import os
import platform
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from xml.sax.saxutils import escape


def generate_rekordbox_xml(playlists, tracks, local_tracks_dir):
    """Generate Pioneer DJ Rekordbox XML DTD v1.0.0 pointing to local tracks."""
    lines = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<DJ_PLAYLISTS Version="1.0.0">',
        '  <PRODUCT Name="rekordbox" Version="6.0.0" Company="Pioneer DJ"/>',
    ]

    track_entries = []
    track_id_to_key = {}
    for i, t in enumerate(tracks, start=1):
        tid = str(i)
        track_id_to_key[t["id"]] = tid
        filename = t["export_filename"]
        local_path = (local_tracks_dir / filename).resolve()
        quoted_path = urllib.parse.quote(str(local_path))
        if not quoted_path.startswith("/"):
            quoted_path = "/" + quoted_path
        location = f"file://localhost{quoted_path}"

        title = escape(t.get("title") or Path(filename).stem)
        artist = escape(t.get("artist") or "")
        genre = escape(t.get("genre") or "Electronic")
        duration = int(round(float(t.get("duration") or 0)))
        size = int(t.get("size_bytes") or 0)
        bpm = float(t.get("bpm") or 128.0)
        tonality = escape(t.get("camelot") or "")
        energy = t.get("energy")
        comments = escape(
            f"Key: {tonality} | Energy: {energy}% | STEMORA Sync"
            if energy is not None
            else f"Key: {tonality} | STEMORA Sync"
        )

        intro_sec = 0.0
        track_lines = [
            f'    <TRACK TrackID="{tid}" Name="{title}" Artist="{artist}" '
            f'Genre="{genre}" TotalTime="{duration}" Size="{size}" '
            f'BitRate="320" SampleRate="44100" Comments="{comments}" '
            f'Location="{location}" AverageBpm="{bpm:.2f}" Tonality="{tonality}">',
            f'      <TEMPO Inizio="{intro_sec:.3f}" Bpm="{bpm:.2f}" Metro="4/4" Battito="1"/>',
            f'      <POSITION Mark="0" Num="-1" Name="Start" Kind="0" Start="{intro_sec:.3f}"/>',
            "    </TRACK>",
        ]
        track_entries.extend(track_lines)

    lines.append(f'  <COLLECTION Entries="{len(tracks)}">')
    lines.extend(track_entries)
    lines.append("  </COLLECTION>")

    lines.append("  <PLAYLISTS>")
    lines.append('    <NODE Type="0" Name="ROOT">')
    lines.append(f'      <NODE Name="STEMORA" Type="0" Count="{len(playlists)}">')

    for p in playlists:
        p_name = escape(p["name"])
        items = p.get("items") or []
        lines.append(f'        <NODE Name="{p_name}" Type="1" KeyType="0" Entries="{len(items)}">')
        for item in items:
            key = track_id_to_key.get(item["track_id"])
            if key:
                lines.append(f'          <TRACK Key="{key}"/>')
        lines.append("        </NODE>")

    lines.append("      </NODE>")
    lines.append("    </NODE>")
    lines.append("  </PLAYLISTS>")
    lines.append("</DJ_PLAYLISTS>")
    return "\\n".join(lines)


def fetch_manifest(server, token):
    url = f"{server.rstrip('/')}/api/sync/manifest"
    req = urllib.request.Request(
        url,
        headers={
            "Authorization": f"Bearer {token}",
            "User-Agent": "Stemora-Rekordbox-Sync/1.0",
        },
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode("utf-8"))


def download_track(server, token, track, dest_path):
    url = f"{server.rstrip('/')}{track['download_url']}?token={token}&download=true"
    req = urllib.request.Request(url, headers={"User-Agent": "Stemora-Rekordbox-Sync/1.0"})
    temp_path = dest_path.with_suffix(dest_path.suffix + ".part")
    try:
        with urllib.request.urlopen(req, timeout=60) as resp, open(temp_path, "wb") as f:
            while chunk := resp.read(64 * 1024):
                f.write(chunk)
        temp_path.replace(dest_path)
        return True
    except Exception as e:
        if temp_path.exists():
            temp_path.unlink()
        raise e


def notify(title, message):
    if platform.system() == "Darwin":
        cmd = f'display notification "{message}" with title "{title}"'
        try:
            subprocess.run(["osascript", "-e", cmd], check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        except Exception:
            pass


def run_sync(server, token, base_dir):
    base = Path(base_dir).expanduser().resolve()
    tracks_dir = base / "tracks"
    tracks_dir.mkdir(parents=True, exist_ok=True)
    xml_file = base / "rekordbox.xml"

    manifest = fetch_manifest(server, token)
    tracks = manifest.get("tracks", [])
    playlists = manifest.get("playlists", [])

    downloaded = 0
    for i, t in enumerate(tracks, 1):
        target = tracks_dir / t["export_filename"]
        expected_size = t.get("size_bytes", 0)
        if target.exists() and (expected_size == 0 or target.stat().st_size == expected_size):
            continue
        print(f"[{i}/{len(tracks)}] Downloading {t['title']} ({t.get('camelot', '')} | {t.get('bpm', '')} BPM)...")
        download_track(server, token, t, target)
        downloaded += 1

    xml_content = generate_rekordbox_xml(playlists, tracks, tracks_dir)
    xml_file.write_text(xml_content, encoding="utf-8")

    return {
        "user_name": manifest.get("user_name"),
        "total_tracks": len(tracks),
        "total_playlists": len(playlists),
        "downloaded": downloaded,
        "xml_path": str(xml_file),
    }


def main():
    parser = argparse.ArgumentParser(description="STEMORA Rekordbox Live Sync Agent")
    parser.add_argument("--token", required=True, help="STEMORA Sync Token (starts with st_live_)")
    parser.add_argument("--server", default="https://stemora.mydjplus.com", help="STEMORA server URL")
    parser.add_argument("--dir", default="~/Music/STEMORA", help="Target sync directory (default: ~/Music/STEMORA)")
    parser.add_argument("--watch", action="store_true", help="Keep running and sync automatically every interval")
    parser.add_argument("--interval", type=int, default=15, help="Watch interval in seconds (default: 15)")
    args = parser.parse_args()

    print("=" * 60)
    print(" STEMORA Rekordbox Live Sync Agent")
    print(f" Target folder: {Path(args.dir).expanduser().resolve()}")
    print(f" Server:        {args.server}")
    print("=" * 60)

    try:
        res = run_sync(args.server, args.token, args.dir)
        print(f"✓ Connected as: {res['user_name']}")
        print(f"✓ Playlists:    {res['total_playlists']} playlists")
        print(f"✓ Tracks:       {res['total_tracks']} tracks ({res['downloaded']} newly downloaded)")
        print(f"✓ XML Updated:  {res['xml_path']}")
        print("\\nrekordbox Setup (One-time):")
        print("  1. In rekordbox -> Preferences -> View -> Layout -> check 'rekordbox xml'")
        print("  2. In Preferences -> Advanced -> Database -> set 'rekordbox xml' to:")
        print(f"     {res['xml_path']}")
        print("  3. Your STEMORA playlists will appear in rekordbox under 'rekordbox xml > STEMORA'!\\n")
    except Exception as e:
        print(f"Error during sync: {e}", file=sys.stderr)
        if not args.watch:
            sys.exit(1)

    if args.watch:
        print(f"👀 Watching for changes every {args.interval} seconds... (Press Ctrl+C to stop)")
        while True:
            try:
                time.sleep(args.interval)
                res = run_sync(args.server, args.token, args.dir)
                if res["downloaded"] > 0:
                    print(f"[{time.strftime('%X')}] Synced {res['downloaded']} new track(s) -> rekordbox.xml updated!")
                    notify("STEMORA Sync", f"Synced {res['downloaded']} new tracks into rekordbox!")
            except KeyboardInterrupt:
                print("\\n[STEMORA Sync] Stopped by user.")
                break
            except Exception as e:
                print(f"[{time.strftime('%X')}] Sync check warning: {e}", file=sys.stderr)


if __name__ == "__main__":
    main()
'''


@router.get("/agent.py")
def download_agent():
    """Serves the standalone Python sync agent script."""
    return Response(
        AGENT_SCRIPT,
        media_type="text/x-python",
        headers={"Content-Disposition": 'attachment; filename="stemora_sync.py"'},
    )


@router.get("/download")
def download_app():
    """Redirect to the native desktop companion app installer."""
    return Response(
        status_code=307,
        headers={"Location": "/download/STEMORA-Connect-macOS.dmg"},
    )


@router.get("/token")
def get_or_create_token(user=Depends(current_user)):
    """Retrieves or creates the user's persistent sync token."""
    with connect() as db:
        row = db.execute(
            "SELECT token, created_at, last_used_at FROM sync_tokens WHERE user_id=? ORDER BY created_at DESC LIMIT 1",
            (user["id"],),
        ).fetchone()
        if row:
            return {
                "token": row["token"],
                "created_at": row["created_at"],
                "last_used_at": row["last_used_at"],
            }
        token_plaintext = f"st_live_{secrets.token_urlsafe(32)}"
        token_hash = hashlib.sha256(token_plaintext.encode()).hexdigest()
        created = now()
        db.execute(
            "INSERT INTO sync_tokens(token, token_hash, user_id, name, created_at) VALUES(?,?,?,?,?)",
            (token_plaintext, token_hash, user["id"], "rekordbox-sync", created),
        )
        return {"token": token_plaintext, "created_at": created, "last_used_at": None}


@router.post("/token/rotate")
def rotate_token(user=Depends(current_user)):
    """Rotates the user's sync token and invalidates the previous one."""
    with connect() as db:
        db.execute("DELETE FROM sync_tokens WHERE user_id=?", (user["id"],))
        token_plaintext = f"st_live_{secrets.token_urlsafe(32)}"
        token_hash = hashlib.sha256(token_plaintext.encode()).hexdigest()
        created = now()
        db.execute(
            "INSERT INTO sync_tokens(token, token_hash, user_id, name, created_at) VALUES(?,?,?,?,?)",
            (token_plaintext, token_hash, user["id"], "rekordbox-sync", created),
        )
        return {"token": token_plaintext, "created_at": created, "last_used_at": None}


@router.get("/manifest")
def sync_manifest(user=Depends(current_user)):
    """Returns all active playlists and ready tracks with metadata for the client agent."""
    with connect() as db:
        playlists = db.execute(
            "SELECT id, name, items, revision, updated_at FROM playlists WHERE user_id=? AND deleted_at IS NULL ORDER BY updated_at DESC",
            (user["id"],),
        ).fetchall()
        tracks = db.execute(
            "SELECT * FROM tracks WHERE user_id=? AND deleted_at IS NULL AND status='ready'",
            (user["id"],),
        ).fetchall()

    playlists_data = []
    for p in playlists:
        playlists_data.append(
            {
                "id": p["id"],
                "name": p["name"],
                "revision": p["revision"],
                "updated_at": p["updated_at"],
                "items": json.loads(p["items"]),
            }
        )

    tracks_data = []
    for t in tracks:
        t_dict = dict(t)
        filename = t_dict["filename"]
        ext = Path(filename).suffix or ".mp3"
        artist = t_dict.get("artist") or ""
        title = t_dict.get("title") or Path(filename).stem
        export_filename = (
            f"{artist} - {title}{ext}" if artist else filename
        )
        export_filename = re.sub(r'[/\\:*?"<>|]', "_", export_filename)
        tracks_data.append(
            {
                "id": t_dict["id"],
                "title": title,
                "artist": artist,
                "genre": t_dict.get("genre") or "",
                "bpm": t_dict.get("bpm"),
                "musical_key": t_dict.get("musical_key"),
                "camelot": camelot(t_dict.get("musical_key")),
                "energy": t_dict.get("energy"),
                "duration": t_dict.get("duration") or 0,
                "size_bytes": t_dict.get("size_bytes") or 0,
                "sha256": t_dict.get("sha256"),
                "export_filename": export_filename,
                "download_url": f"/api/cloud/tracks/{t_dict['id']}/audio",
            }
        )

    return {
        "user_id": user["id"],
        "user_name": user["name"],
        "synced_at": datetime.now(timezone.utc).isoformat(),
        "playlists": playlists_data,
        "tracks": tracks_data,
    }
