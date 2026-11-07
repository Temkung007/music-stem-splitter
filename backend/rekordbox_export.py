"""Pioneer DJ rekordbox XML library generator for Stemora playlists."""

import json
import urllib.parse
import xml.etree.ElementTree as ET
from pathlib import Path
from xml.dom import minidom

from audio_analysis import camelot


def generate_rekordbox_xml(
    playlists_data: list[dict], tracks_data: list[dict] | dict[str, dict]
) -> str:
    """Generate a fully compliant Pioneer DJ rekordbox XML file.

    Follows the rekordbox 6/7 XML specification with Collection, Playlists,
    tempo grids, and tonality (Camelot notation).
    """
    root = ET.Element("DJ_PLAYLISTS", Version="1.0.0")
    ET.SubElement(
        root, "PRODUCT", Name="rekordbox", Version="6.0.0", Company="Pioneer DJ"
    )

    if isinstance(tracks_data, list):
        tracks_by_id = {t["id"]: t for t in tracks_data}
    else:
        tracks_by_id = dict(tracks_data)

    # Build unique track entries in order of appearance
    track_id_map: dict[str, str] = {}
    ordered_tracks: list[tuple[str, dict]] = []

    for playlist in playlists_data:
        items = playlist.get("items", [])
        if isinstance(items, str):
            try:
                items = json.loads(items)
            except Exception:
                items = []
        for item in items:
            tid = item.get("track_id") if isinstance(item, dict) else str(item)
            if tid in tracks_by_id and tid not in track_id_map:
                seq_id = str(len(track_id_map) + 1)
                track_id_map[tid] = seq_id
                ordered_tracks.append((seq_id, tracks_by_id[tid]))

    # If any tracks were not in playlists, append them to collection
    for tid, track in tracks_by_id.items():
        if tid not in track_id_map:
            seq_id = str(len(track_id_map) + 1)
            track_id_map[tid] = seq_id
            ordered_tracks.append((seq_id, track))

    collection = ET.SubElement(root, "COLLECTION", Entries=str(len(ordered_tracks)))

    for seq_id, track in ordered_tracks:
        filename = (
            track.get("export_filename")
            or track.get("filename")
            or f"{track.get('title', 'track')}.mp3"
        )
        ext = Path(filename).suffix.lower()
        kind_map = {
            ".mp3": "MP3 File",
            ".wav": "WAV File",
            ".aif": "AIFF File",
            ".aiff": "AIFF File",
            ".flac": "FLAC File",
            ".m4a": "M4A File",
            ".aac": "AAC File",
            ".ogg": "OGG File",
        }
        kind = kind_map.get(ext, "Audio File")

        bpm_val = track.get("bpm")
        bpm_str = f"{float(bpm_val):.2f}" if bpm_val else "0.00"

        raw_key = track.get("musical_key")
        cam_key = camelot(raw_key) if raw_key else ""
        tonality = cam_key if cam_key else (raw_key or "")

        duration = int(track.get("duration") or 0)
        size_bytes = str(int(track.get("size_bytes") or 0))

        comments_parts = []
        if cam_key:
            comments_parts.append(f"Key: {cam_key}")
        if track.get("energy"):
            comments_parts.append(f"Energy: {track['energy']}%")
        comments_parts.append("Stemora DJ Workspace")
        comments = " | ".join(comments_parts)

        # URI encoded relative path
        location = f"file://localhost/{urllib.parse.quote(filename, safe='/')}"

        date_added = ""
        created_at = track.get("created_at")
        if created_at:
            date_added = str(created_at)[:10]

        track_elem = ET.SubElement(
            collection,
            "TRACK",
            TrackID=seq_id,
            Name=str(track.get("title") or "Untitled"),
            Artist=str(track.get("artist") or ""),
            Composer="",
            Album=str(track.get("album") or ""),
            Grouping="",
            Genre=str(track.get("genre") or ""),
            Kind=kind,
            Size=size_bytes,
            TotalTime=str(duration),
            DiscNumber="1",
            TrackNumber=str(track.get("order") or seq_id),
            Year=str(track.get("year") or ""),
            AverageBpm=bpm_str,
            DateAdded=date_added,
            BitRate="320" if ext == ".mp3" else "1411",
            SampleRate="44100",
            Comments=comments,
            PlayCount="0",
            Rating="0",
            Location=location,
            Remixer="",
            Tonality=tonality,
            Label="",
            Mix="",
        )

        if bpm_val and float(bpm_val) > 0:
            analysis_raw = track.get("analysis")
            intro_sec = "0.000"
            if analysis_raw:
                try:
                    if isinstance(analysis_raw, str):
                        analysis_raw = json.loads(analysis_raw)
                    intro = analysis_raw.get("intro_seconds")
                    if intro is not None and float(intro) >= 0:
                        intro_sec = f"{float(intro):.3f}"
                except Exception:
                    pass
            ET.SubElement(
                track_elem,
                "TEMPO",
                Inizio=intro_sec,
                Bpm=bpm_str,
                Metro="4/4",
                Battito="1",
            )
            # Add initial cue position at first beat
            ET.SubElement(
                track_elem,
                "POSITION",
                Mark="0",
                Num="-1",
                Name="Start",
                Kind="0",
                Start=intro_sec,
            )

    # 2. PLAYLISTS SECTION
    playlists_elem = ET.SubElement(root, "PLAYLISTS")
    root_node = ET.SubElement(playlists_elem, "NODE", Type="0", Name="ROOT")
    stemora_node = ET.SubElement(root_node, "NODE", Type="0", Name="STEMORA")

    for pl in playlists_data:
        items = pl.get("items", [])
        if isinstance(items, str):
            try:
                items = json.loads(items)
            except Exception:
                items = []

        valid_items = [
            item
            for item in items
            if (item.get("track_id") if isinstance(item, dict) else str(item))
            in track_id_map
        ]

        pl_node = ET.SubElement(
            stemora_node,
            "NODE",
            Name=str(pl.get("name") or "Playlist"),
            Type="1",
            KeyType="0",
            Entries=str(len(valid_items)),
        )

        for item in valid_items:
            tid = item.get("track_id") if isinstance(item, dict) else str(item)
            ET.SubElement(pl_node, "TRACK", Key=track_id_map[tid])

    rough_str = ET.tostring(root, encoding="utf-8")
    parsed = minidom.parseString(rough_str)
    return parsed.toprettyxml(indent="  ", encoding="utf-8").decode("utf-8")
