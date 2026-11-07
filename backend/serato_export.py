"""
Serato DJ Pro Crate Generator (Binary TLV format)
Generates native .crate files compatible with Serato DJ Pro & Serato DJ Lite.
"""
from pathlib import Path


def make_tlv(tag: str, val_bytes: bytes) -> bytes:
    return tag.encode("ascii") + len(val_bytes).to_bytes(4, "big") + val_bytes


def generate_serato_crate(track_paths: list[str]) -> bytes:
    """
    Builds a Serato .crate binary buffer.
    - Header: vrsn (UTF-16BE: '8 1.0/Serato ScratchLive G-Box')
    - Entries: otrk containing ptrk (UTF-16BE path relative to drive root without leading slash)
    """
    out = bytearray()
    version_bytes = "8 1.0/Serato ScratchLive G-Box".encode("utf-16-be")
    out.extend(make_tlv("vrsn", version_bytes))

    for path_str in track_paths:
        clean_path = path_str.lstrip("/")
        ptrk_val = clean_path.encode("utf-16-be")
        ptrk_chunk = make_tlv("ptrk", ptrk_val)
        otrk_chunk = make_tlv("otrk", ptrk_chunk)
        out.extend(otrk_chunk)

    return bytes(out)
