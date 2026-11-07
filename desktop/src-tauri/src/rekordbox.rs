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
        let encoded_path = urlencoding::encode(&path_str);
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
