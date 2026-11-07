"""Measured audio descriptors. Estimates remain editable by the DJ."""

import json
import math
import subprocess
from pathlib import Path

import numpy as np

MAJOR = np.array(
    [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
)
MINOR = np.array(
    [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]
)
NOTES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
CAMELOT_MAJOR = {
    "B": 1,
    "F#": 2,
    "C#": 3,
    "G#": 4,
    "D#": 5,
    "A#": 6,
    "F": 7,
    "C": 8,
    "G": 9,
    "D": 10,
    "A": 11,
    "E": 12,
}
CAMELOT_MINOR = {
    "G#": 1,
    "D#": 2,
    "A#": 3,
    "F": 4,
    "C": 5,
    "G": 6,
    "D": 7,
    "A": 8,
    "E": 9,
    "B": 10,
    "F#": 11,
    "C#": 12,
}


def camelot(key):
    if not key:
        return None
    note, mode = key.split(" ")
    return f"{(CAMELOT_MINOR if mode == 'minor' else CAMELOT_MAJOR)[note]}{'A' if mode == 'minor' else 'B'}"


def audio_metadata(path: Path, max_duration=1800):
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
            "stream=sample_rate:format=duration,format_name:format_tags=title,artist,genre",
            "-of",
            "json",
            str(path),
        ],
        capture_output=True,
        check=True,
        timeout=30,
    )
    data = json.loads(result.stdout)
    if not data.get("streams"):
        raise ValueError("ไม่พบข้อมูลเสียงในไฟล์")
    if not set(data["format"].get("format_name", "").split(",")).intersection(
        {"mp3", "wav", "flac", "mov", "mp4", "m4a", "aac", "ogg"}
    ):
        raise ValueError("รองรับไฟล์เสียงโดยตรงเท่านั้น")
    duration = float(data["format"]["duration"])
    if not math.isfinite(duration) or duration <= 0 or duration > max_duration:
        raise ValueError("รองรับเพลงความยาวไม่เกิน 30 นาที")
    tags = {k.lower(): v for k, v in data["format"].get("tags", {}).items()}
    return {
        "duration": duration,
        "title": tags.get("title", path.stem)[:200],
        "artist": tags.get("artist", "")[:120],
        "genre": tags.get("genre", "")[:60],
    }


def analyze(path: Path):
    import librosa

    sr = 11025
    result = subprocess.run(
        [
            "ffmpeg",
            "-v",
            "error",
            "-i",
            str(path),
            "-t",
            "120",
            "-ac",
            "1",
            "-ar",
            str(sr),
            "-f",
            "f32le",
            "-",
        ],
        capture_output=True,
        check=True,
        timeout=90,
    )
    y = np.frombuffer(result.stdout, dtype="<f4").copy()
    if len(y) < sr:
        raise ValueError("เพลงต้องยาวอย่างน้อย 1 วินาทีเพื่อวิเคราะห์")
    count = 160
    peaks = [
        float(np.max(np.abs(chunk))) if len(chunk) else 0
        for chunk in np.array_split(y, count)
    ]
    maximum = max(peaks) or 1
    rms = float(np.sqrt(np.mean(y**2)))
    if rms < 1e-5:
        return {
            "bpm": None,
            "musical_key": None,
            "bpm_confidence": 0,
            "key_confidence": 0,
            "energy": 0,
            "peaks": [0] * count,
            "analysis": {
                "seconds_analyzed": round(len(y) / sr, 1),
                "estimated": True,
                "note": "ไม่พบเสียงที่มีความดังเพียงพอ",
            },
        }
    onset = librosa.onset.onset_strength(y=y, sr=sr, hop_length=256)
    tempo, beats = librosa.beat.beat_track(
        onset_envelope=onset, sr=sr, hop_length=256, start_bpm=120, trim=False
    )
    bpm = float(np.asarray(tempo).ravel()[0])
    if not math.isfinite(bpm) or bpm <= 0:
        bpm = None
    confidence = (
        min(1.0, len(beats) / max(1, (len(y) / sr) * (bpm or 120) / 60))
        if np.std(onset) > 0.05
        else 0
    )
    if confidence < 0.15:
        bpm = None
    chroma = librosa.feature.chroma_stft(y=y, sr=sr, n_fft=4096, hop_length=512).mean(
        axis=1
    )
    correlations = []
    for mode, template in [("major", MAJOR), ("minor", MINOR)]:
        for i in range(12):
            value = float(np.corrcoef(chroma, np.roll(template, i))[0, 1])
            correlations.append(
                (value if math.isfinite(value) else -1, f"{NOTES[i]} {mode}")
            )
    correlations.sort(reverse=True)
    key_confidence = max(0, min(1, correlations[0][0]))
    key = correlations[0][1] if key_confidence >= 0.35 else None
    # A relative energy score, not a genre/mood classifier or loudness standard.
    energy = int(
        np.clip(
            30
            + 24 * math.log10(max(rms, 1e-5) / 0.02)
            + min(25, float(np.mean(onset)) * 3),
            0,
            100,
        )
    )
    return {
        "bpm": round(bpm, 1) if bpm else None,
        "musical_key": key,
        "bpm_confidence": round(confidence, 2),
        "key_confidence": round(key_confidence, 2),
        "energy": energy,
        "peaks": [round(p / maximum, 3) for p in peaks],
        "analysis": {
            "seconds_analyzed": round(len(y) / sr, 1),
            "estimated": True,
            "intro_seconds": round(
                float(librosa.frames_to_time(beats[0], sr=sr, hop_length=256)), 2
            )
            if len(beats)
            else None,
            "note": "BPM คีย์ และพลังงานเป็นค่าประมาณ แก้ไขได้ตามการฟังจริง",
        },
    }
