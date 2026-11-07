use quick_xml::escape::escape;
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ManifestPlaylistItem {
    pub track_id: String,
    #[serde(default)]
    pub note: String,
    #[serde(default)]
    pub locked: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ManifestPlaylist {
    pub id: String,
    pub name: String,
    pub revision: i64,
    pub updated_at: String,
    pub items: Vec<ManifestPlaylistItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ManifestTrack {
    pub id: String,
    pub title: String,
    pub artist: String,
    #[serde(default)]
    pub genre: String,
    pub bpm: Option<f64>,
    pub musical_key: Option<String>,
    pub camelot: Option<String>,
    pub energy: Option<i32>,
    pub duration: f64,
    pub size_bytes: i64,
    pub sha256: Option<String>,
    pub export_filename: String,
    pub download_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncManifest {
    pub user_id: String,
    pub user_name: String,
    pub synced_at: String,
    pub playlists: Vec<ManifestPlaylist>,
    pub tracks: Vec<ManifestTrack>,
}

pub fn generate_rekordbox_xml(
    playlists: &[ManifestPlaylist],
    tracks: &[ManifestTrack],
    tracks_dir: &Path,
) -> String {
    let mut lines = Vec::new();
    lines.push(r#"<?xml version="1.0" encoding="UTF-8"?>"#.to_string());
    lines.push(r#"<DJ_PLAYLISTS Version="1.0.0">"#.to_string());
    lines.push(r#"  <PRODUCT Name="rekordbox" Version="6.0.0" Company="Pioneer DJ"/>"#.to_string());

    let mut track_id_to_key = std::collections::HashMap::new();
    let mut track_xml_entries = Vec::new();

    for (index, t) in tracks.iter().enumerate() {
        let key = (index + 1).to_string();
        track_id_to_key.insert(&t.id, key.clone());

        let local_path = tracks_dir.join(&t.export_filename);
        let path_str = local_path.to_string_lossy().to_string();
        let encoded_path = path_str
            .split('/')
            .map(|segment| urlencoding::encode(segment).to_string())
            .collect::<Vec<_>>()
            .join("/");
        let location = if encoded_path.starts_with('/') {
            format!("file://localhost{}", encoded_path)
        } else {
            format!("file://localhost/{}", encoded_path)
        };

        let title = escape(&t.title);
        let artist = escape(&t.artist);
        let genre = escape(if t.genre.is_empty() { "Electronic" } else { &t.genre });
        let duration = t.duration.round() as i64;
        let size = t.size_bytes;
        let bpm = t.bpm.unwrap_or(128.0);
        let tonality = escape(t.camelot.as_deref().unwrap_or(""));
        let raw_comment = match (t.camelot.as_deref(), t.energy) {
            (Some(c), Some(e)) if !c.is_empty() => {
                format!("Key: {} | Energy: {}% | STEMORA Connect", c, e)
            }
            (Some(c), None) if !c.is_empty() => format!("Key: {} | STEMORA Connect", c),
            _ => "STEMORA Connect".to_string(),
        };
        let comments = escape(&raw_comment);

        track_xml_entries.push(format!(
            r#"    <TRACK TrackID="{}" Name="{}" Artist="{}" Genre="{}" TotalTime="{}" Size="{}" BitRate="320" SampleRate="44100" Comments="{}" Location="{}" AverageBpm="{:.2}" Tonality="{}">
      <TEMPO Inizio="0.000" Bpm="{:.2}" Metro="4/4" Battito="1"/>
      <POSITION Mark="0" Num="-1" Name="Start" Kind="0" Start="0.000"/>
    </TRACK>"#,
            key, title, artist, genre, duration, size, comments, location, bpm, tonality, bpm
        ));
    }

    lines.push(format!(r#"  <COLLECTION Entries="{}">"#, tracks.len()));
    lines.extend(track_xml_entries);
    lines.push(r#"  </COLLECTION>"#.to_string());

    lines.push(r#"  <PLAYLISTS>"#.to_string());
    lines.push(r#"    <NODE Type="0" Name="ROOT">"#.to_string());
    lines.push(format!(
        r#"      <NODE Name="STEMORA" Type="0" Count="{}">"#,
        playlists.len()
    ));

    for p in playlists {
        let p_name = escape(&p.name);
        lines.push(format!(
            r#"        <NODE Name="{}" Type="1" KeyType="0" Entries="{}">"#,
            p_name,
            p.items.len()
        ));
        for item in &p.items {
            if let Some(track_key) = track_id_to_key.get(&item.track_id) {
                lines.push(format!(r#"          <TRACK Key="{}"/>"#, track_key));
            }
        }
        lines.push(r#"        </NODE>"#.to_string());
    }

    lines.push(r#"      </NODE>"#.to_string());
    lines.push(r#"    </NODE>"#.to_string());
    lines.push(r#"  </PLAYLISTS>"#.to_string());
    lines.push(r#"</DJ_PLAYLISTS>"#.to_string());

    lines.join("\n")
}

pub fn generate_m3u8_playlists(
    playlists: &[ManifestPlaylist],
    tracks: &[ManifestTrack],
    tracks_dir: &Path,
    playlists_dir: &Path,
) {
    use std::fs;
    let _ = fs::create_dir_all(playlists_dir);

    let track_map: std::collections::HashMap<&str, &ManifestTrack> =
        tracks.iter().map(|t| (t.id.as_str(), t)).collect();

    for p in playlists {
        let mut lines = Vec::new();
        lines.push("#EXTM3U".to_string());
        for item in &p.items {
            if let Some(t) = track_map.get(item.track_id.as_str()) {
                let duration = t.duration.round() as i64;
                lines.push(format!("#EXTINF:{},{} - {}", duration, t.artist, t.title));
                let track_path = tracks_dir.join(&t.export_filename);
                lines.push(track_path.to_string_lossy().to_string());
            }
        }
        let safe_name: String = p
            .name
            .chars()
            .map(|c| if c.is_alphanumeric() || c == ' ' || c == '-' || c == '_' { c } else { '_' })
            .collect();
        let filename = format!("{}.m3u8", safe_name.trim());
        let _ = fs::write(playlists_dir.join(filename), lines.join("\n"));
    }
}

pub fn auto_configure_rekordbox(xml_path: &Path) -> Result<String, String> {
    use std::fs;
    let xml_path_str = xml_path.to_string_lossy().to_string();

    // 1. Setup fallback symlink on macOS
    #[cfg(target_os = "macos")]
    if let Some(home) = dirs::home_dir() {
        let default_rb_dir = home.join("Library/rekordbox/rekordbox");
        let _ = fs::create_dir_all(&default_rb_dir);
        let link_target = default_rb_dir.join("rekordbox.xml");
        let _ = fs::remove_file(&link_target);
        #[cfg(unix)]
        let _ = std::os::unix::fs::symlink(xml_path, &link_target);
    }

    // 2. Discover Rekordbox settings file
    let candidate_dirs = [
        dirs::home_dir().map(|h| h.join("Library/Application Support/Pioneer/rekordbox6")),
        dirs::home_dir().map(|h| h.join("Library/Application Support/Pioneer/rekordbox7")),
        dirs::home_dir().map(|h| h.join("Library/Application Support/Pioneer/rekordbox")),
        dirs::config_dir().map(|c| c.join("Pioneer/rekordbox6")),
        dirs::config_dir().map(|c| c.join("Pioneer/rekordbox7")),
        dirs::config_dir().map(|c| c.join("Pioneer/rekordbox")),
    ];

    let mut configured_count = 0;

    for dir_opt in candidate_dirs.into_iter().flatten() {
        let settings_file = dir_opt.join("rekordbox3.settings");
        if settings_file.exists() {
            if let Ok(content) = fs::read_to_string(&settings_file) {
                let mut updated = content;

                // Set showRbXml = 1
                if updated.contains(r#"name="showRbXml""#) {
                    let re = regex_lite_replace_val(&updated, "showRbXml", "1");
                    updated = re;
                } else if updated.contains("</PIONEER>") {
                    updated = updated.replace("</PIONEER>", "  <VALUE name=\"showRbXml\" val=\"1\"/>\n</PIONEER>");
                }

                // Set RekordboxXmlChecked = 1
                if updated.contains(r#"name="RekordboxXmlChecked""#) {
                    let re = regex_lite_replace_val(&updated, "RekordboxXmlChecked", "1");
                    updated = re;
                } else if updated.contains("</PIONEER>") {
                    updated = updated.replace("</PIONEER>", "  <VALUE name=\"RekordboxXmlChecked\" val=\"1\"/>\n</PIONEER>");
                }

                // Set bridgeImportedLibraryFile = xml_path
                if updated.contains(r#"name="bridgeImportedLibraryFile""#) {
                    let re = regex_lite_replace_val(&updated, "bridgeImportedLibraryFile", &xml_path_str);
                    updated = re;
                } else if updated.contains("</PIONEER>") {
                    let tag = format!("  <VALUE name=\"bridgeImportedLibraryFile\" val=\"{}\"/>\n</PIONEER>", xml_path_str);
                    updated = updated.replace("</PIONEER>", &tag);
                }

                if fs::write(&settings_file, updated).is_ok() {
                    configured_count += 1;
                }
            }
        }
    }

    if configured_count > 0 {
        Ok(format!("ตั้งค่า rekordbox {} รายการสำเร็จ", configured_count))
    } else {
        Ok("เตรียมไฟล์ฐานข้อมูล rekordbox.xml สำเร็จ".to_string())
    }
}

fn regex_lite_replace_val(source: &str, key: &str, new_val: &str) -> String {
    let pattern = format!(r#"name="{key}""#);
    if let Some(pos) = source.find(&pattern) {
        if let Some(val_pos) = source[pos..].find("val=\"") {
            let start = pos + val_pos + 5;
            if let Some(end_quote) = source[start..].find('"') {
                let mut result = String::with_capacity(source.len() + new_val.len());
                result.push_str(&source[..start]);
                result.push_str(new_val);
                result.push_str(&source[start + end_quote..]);
                return result;
            }
        }
    }
    source.to_string()
}
