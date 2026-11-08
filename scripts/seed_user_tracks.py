#!/usr/bin/env python3
"""Seed 5 realistic DJ tracks and a sample playlist into user account(s)."""

import argparse
import asyncio
import hashlib
import json
import os
import sys
import tempfile
import uuid
from datetime import datetime, timezone
from pathlib import Path

# Add backend directory to path
root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root / "backend"))

from database import connect, lock_writes
from storage import storage
import audio_analysis
import cloud

TRACKS_DATA = [
    {
        "title": "Bangkok Midnight",
        "artist": "Nova Skyline",
        "genre": "Tech House",
        "bpm": 126.0,
        "note": 60,
        "musical_key": "Am",
        "energy": 85,
    },
    {
        "title": "Phuket Sunset Groove",
        "artist": "DJ Sunburst",
        "genre": "Melodic House",
        "bpm": 122.0,
        "note": 65,
        "musical_key": "Dm",
        "energy": 72,
    },
    {
        "title": "Chao Phraya Deep",
        "artist": "Aqua Resonance",
        "genre": "Deep House",
        "bpm": 124.0,
        "note": 62,
        "musical_key": "Em",
        "energy": 78,
    },
    {
        "title": "Neon Silom",
        "artist": "Cyberpulse",
        "genre": "Nu-Disco / Synth",
        "bpm": 120.0,
        "note": 57,
        "musical_key": "Fm",
        "energy": 68,
    },
    {
        "title": "Thonglor Afterhours",
        "artist": "K-Rhythm",
        "genre": "Afro House / Peak",
        "bpm": 128.0,
        "note": 64,
        "musical_key": "Bm",
        "energy": 92,
    },
]


def now():
    return datetime.now(timezone.utc).isoformat()


def seed_tracks_for_user(user_id: str, user_name: str, user_email: str):
    print(f"\n🎧 Seeding 5 tracks for user: {user_name} ({user_email}) [ID: {user_id}]...")
    
    created_track_ids = []
    
    with tempfile.TemporaryDirectory() as tmpdir:
        tmp_path = Path(tmpdir)
        
        for idx, t_info in enumerate(TRACKS_DATA):
            track_id = str(uuid.uuid4())
            filename = f"{t_info['title']}.wav"
            local_wav = tmp_path / f"track_{idx}.wav"
            
            # Generate synthesized audio with punchy beat, bass and melodic notes
            cloud.make_library_demo(local_wav, t_info["bpm"], t_info["note"], t_info["energy"] / 100.0)
            
            audio_bytes = local_wav.read_bytes()
            size = len(audio_bytes)
            digest = hashlib.sha256(audio_bytes).hexdigest()
            object_key = f"users/{user_id}/tracks/{track_id}/original.wav"
            
            # Upload to S3 storage
            storage.put(local_wav, object_key)
            
            # Extract real peaks or fallback
            try:
                features = audio_analysis.analyze(local_wav)
                peaks = features.get("peaks", [])
                analysis_data = features.get("analysis", {})
                bpm = features.get("bpm") or t_info["bpm"]
                musical_key = features.get("musical_key") or t_info["musical_key"]
                bpm_confidence = features.get("bpm_confidence", 0.95)
                key_confidence = features.get("key_confidence", 0.90)
                energy = features.get("energy", t_info["energy"])
            except Exception as e:
                print(f"  Note: audio analysis fallback ({e})")
                peaks = [int(15 + 40 * abs((i % 20) - 10) / 10) for i in range(160)]
                analysis_data = {"sections": [{"start": 0, "energy": t_info["energy"]}]}
                bpm = t_info["bpm"]
                musical_key = t_info["musical_key"]
                bpm_confidence = 0.95
                key_confidence = 0.90
                energy = t_info["energy"]
            
            # Insert into database
            with connect() as db:
                lock_writes(db)
                # Remove any existing track with same sha256
                db.execute(
                    "DELETE FROM tracks WHERE user_id=? AND sha256=?",
                    (user_id, digest)
                )
                db.execute(
                    """
                    INSERT INTO tracks (
                        id, user_id, filename, title, artist, genre,
                        object_key, sha256, size_bytes, duration,
                        status, message, bpm, musical_key, key_confidence,
                        bpm_confidence, energy, peaks, analysis, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ready', '', ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        track_id,
                        user_id,
                        filename,
                        t_info["title"],
                        t_info["artist"],
                        t_info["genre"],
                        object_key,
                        digest,
                        size,
                        16.0,
                        bpm,
                        musical_key,
                        key_confidence,
                        bpm_confidence,
                        energy,
                        json.dumps(peaks),
                        json.dumps(analysis_data, ensure_ascii=False),
                        now(),
                    ),
                )
            
            created_track_ids.append(track_id)
            print(f"  ✓ [{idx + 1}/5] {t_info['title']} - {t_info['artist']} ({bpm:.1f} BPM, Key: {musical_key}, Energy: {energy})")
    
    # Create or update a Rekordbox-ready DJ set
    playlist_id = str(uuid.uuid4())
    playlist_items = [
        {"track_id": tid, "note": f"Camelot transition {idx+1}", "locked": False}
        for idx, tid in enumerate(created_track_ids)
    ]
    
    with connect() as db:
        lock_writes(db)
        timestamp = now()
        db.execute(
            """
            INSERT INTO playlists (
                id, user_id, name, description, prompt,
                target_minutes, profile, items, revision, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
            """,
            (
                playlist_id,
                user_id,
                "Weekend Club Peak (DJ Ready: rekordbox & Serato)",
                "เซ็ตเพลงทดสอบระบบ 5 เพลง เรียงลำดับ BPM และ Camelot Key สำหรับเปิดใน rekordbox และ Serato DJ ทันที",
                "จัดเพลงปาร์ตี้พลังงานสูง 5 เพลง",
                60,
                "build",
                json.dumps(playlist_items, ensure_ascii=False),
                timestamp,
                timestamp,
            ),
        )
    print(f"  ✓ Created playlist 'Weekend Club Peak (Rekordbox Ready)' with {len(created_track_ids)} tracks.")
    return len(created_track_ids)


def main():
    parser = argparse.ArgumentParser(description="Seed tracks into user library")
    parser.add_argument("--user-id", help="Target user ID")
    parser.add_argument("--email", help="Target user email")
    args = parser.parse_args()
    
    with connect() as db:
        users = db.execute("SELECT id, email, name, created_at FROM users").fetchall()
    
    if not users:
        print("❌ No users found in database.")
        sys.exit(1)
    
    print(f"Found {len(users)} user(s) in database:")
    for u in users:
        print(f"  - ID: {u['id']}, Email: {u['email']}, Name: {u['name']}")
    
    target_users = []
    if args.user_id:
        target_users = [u for u in users if u["id"] == args.user_id]
    elif args.email:
        target_users = [u for u in users if u["email"].lower() == args.email.lower()]
    else:
        # Default: filter out disposable smoke-test users if real users exist
        real_users = [u for u in users if not u["email"].startswith("smoke-")]
        target_users = real_users if real_users else users
    
    if not target_users:
        print("❌ No matching user found.")
        sys.exit(1)
        
    total_added = 0
    for u in target_users:
        count = seed_tracks_for_user(u["id"], u["name"], u["email"])
        total_added += count
        
    print(f"\n🎉 Successfully seeded {total_added} tracks across {len(target_users)} user(s)!")


if __name__ == "__main__":
    main()
