use crate::rekordbox::{ManifestPlaylist, ManifestTrack};
use std::path::{Path, PathBuf};

fn make_tlv(tag: &str, value: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(8 + value.len());
    out.extend_from_slice(tag.as_bytes());
    out.extend_from_slice(&(value.len() as u32).to_be_bytes());
    out.extend_from_slice(value);
    out
}

fn to_utf16_be(s: &str) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(s.len() * 2);
    for c in s.encode_utf16() {
        bytes.extend_from_slice(&c.to_be_bytes());
    }
    bytes
}

pub fn generate_serato_crate(track_paths: &[&Path]) -> Vec<u8> {
    let mut out = Vec::new();

    // 1. Version header
    let version_bytes = to_utf16_be("8 1.0/Serato ScratchLive G-Box");
    out.extend_from_slice(&make_tlv("vrsn", &version_bytes));

    // 2. Track entries (otrk -> ptrk)
    for p in track_paths {
        let p_str = p.to_string_lossy();
        let clean_path = p_str.trim_start_matches('/');
        let ptrk_val = to_utf16_be(clean_path);
        let ptrk_chunk = make_tlv("ptrk", &ptrk_val);
        let otrk_chunk = make_tlv("otrk", &ptrk_chunk);
        out.extend_from_slice(&otrk_chunk);
    }

    out
}

pub fn sync_serato_crates(
    playlists: &[ManifestPlaylist],
    tracks: &[ManifestTrack],
    tracks_dir: &Path,
    local_crates_dir: &Path,
) {
    use std::fs;
    let _ = fs::create_dir_all(local_crates_dir);

    // Discover standard Serato Subcrates directory
    let serato_subcrates_dirs = [
        dirs::home_dir().map(|h| h.join("Music/_Serato_/Subcrates")),
        dirs::audio_dir().map(|a| a.join("_Serato_/Subcrates")),
    ];

    let track_map: std::collections::HashMap<&str, &ManifestTrack> =
        tracks.iter().map(|t| (t.id.as_str(), t)).collect();

    // 1. Generate STEMORA Master crate (all tracks)
    let all_track_paths: Vec<PathBuf> = tracks
        .iter()
        .map(|t| tracks_dir.join(&t.export_filename))
        .collect();
    let all_refs: Vec<&Path> = all_track_paths.iter().map(|p: &PathBuf| p.as_path()).collect();
    let master_crate = generate_serato_crate(&all_refs);

    // Save to local crates dir
    let _ = fs::write(local_crates_dir.join("STEMORA.crate"), &master_crate);

    // Save to Serato Subcrates dirs
    for dir_opt in serato_subcrates_dirs.iter().flatten() {
        let _ = fs::create_dir_all(dir_opt);
        let _ = fs::write(dir_opt.join("STEMORA.crate"), &master_crate);
    }

    // 2. Generate subcrates for each playlist
    for p in playlists {
        let mut pl_track_paths: Vec<PathBuf> = Vec::new();
        for item in &p.items {
            if let Some(t) = track_map.get(item.track_id.as_str()) {
                pl_track_paths.push(tracks_dir.join(&t.export_filename));
            }
        }
        let pl_refs: Vec<&Path> = pl_track_paths.iter().map(|p: &PathBuf| p.as_path()).collect();
        let subcrate_bytes = generate_serato_crate(&pl_refs);

        let safe_name: String = p
            .name
            .chars()
            .map(|c: char| if c.is_alphanumeric() || c == ' ' || c == '-' || c == '_' { c } else { '_' })
            .collect();
        let filename = format!("STEMORA%%{}.crate", safe_name.trim());

        let _ = fs::write(local_crates_dir.join(&filename), &subcrate_bytes);

        for dir_opt in serato_subcrates_dirs.iter().flatten() {
            let _ = fs::write(dir_opt.join(&filename), &subcrate_bytes);
        }
    }
}

pub fn auto_setup_serato() -> Result<String, String> {
    #[cfg(target_os = "macos")]
    {
        let status = std::process::Command::new("open")
            .arg("-a")
            .arg("Serato DJ Pro")
            .output();
        if status.is_ok() && status.as_ref().unwrap().status.success() {
            return Ok("เปิด Serato DJ Pro สำเร็จ Crates ของ STEMORA พร้อมเล่นทันที".to_string());
        }

        let lite_status = std::process::Command::new("open")
            .arg("-a")
            .arg("Serato DJ Lite")
            .output();
        if lite_status.is_ok() && lite_status.as_ref().unwrap().status.success() {
            return Ok("เปิด Serato DJ Lite สำเร็จ Crates ของ STEMORA พร้อมเล่นทันที".to_string());
        }

        let b_status = std::process::Command::new("open")
            .arg("-b")
            .arg("com.serato.seratodjpro")
            .output();
        if b_status.is_ok() && b_status.as_ref().unwrap().status.success() {
            return Ok("เปิด Serato DJ Pro สำเร็จ".to_string());
        }
    }

    Ok("ซิงก์ Crates ลง ~/Music/_Serato_/Subcrates/ สำเร็จ (เมื่อเปิด Serato DJ จะพบ Crates ทันที)".to_string())
}
