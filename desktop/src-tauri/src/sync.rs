use crate::rekordbox::{generate_rekordbox_xml, SyncManifest};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::Mutex;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    pub server_url: String,
    pub token: String,
    pub sync_dir: String,
    pub auto_sync: bool,
}

impl Default for AppConfig {
    fn default() -> Self {
        let default_dir = dirs::audio_dir()
            .or_else(dirs::home_dir)
            .map(|d| d.join("STEMORA"))
            .unwrap_or_else(|| PathBuf::from("STEMORA"));

        Self {
            server_url: "https://stemora.mydjplus.com".to_string(),
            token: String::new(),
            sync_dir: default_dir.to_string_lossy().to_string(),
            auto_sync: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncStatus {
    pub is_syncing: bool,
    pub auto_sync: bool,
    pub has_token: bool,
    pub server_url: String,
    pub sync_dir: String,
    pub user_name: Option<String>,
    pub last_synced: Option<String>,
    pub total_tracks: usize,
    pub total_playlists: usize,
    pub last_downloaded: usize,
    pub error_message: Option<String>,
}

pub struct SyncManager {
    pub config: Arc<Mutex<AppConfig>>,
    pub status: Arc<Mutex<SyncStatus>>,
    client: reqwest::Client,
}

impl SyncManager {
    pub fn new() -> Self {
        let config = Self::load_config();
        let mut user_name = None;
        let mut total_tracks = 0;
        let mut total_playlists = 0;
        let manifest_file = PathBuf::from(&config.sync_dir).join("manifest.json");
        if let Ok(data) = fs::read_to_string(&manifest_file) {
            if let Ok(cached) = serde_json::from_str::<SyncManifest>(&data) {
                user_name = Some(cached.user_name);
                total_tracks = cached.tracks.len();
                total_playlists = cached.playlists.len();
            }
        }

        let status = SyncStatus {
            is_syncing: false,
            auto_sync: config.auto_sync,
            has_token: !config.token.trim().is_empty(),
            server_url: config.server_url.clone(),
            sync_dir: config.sync_dir.clone(),
            user_name,
            last_synced: None,
            total_tracks,
            total_playlists,
            last_downloaded: 0,
            error_message: None,
        };

        Self {
            config: Arc::new(Mutex::new(config)),
            status: Arc::new(Mutex::new(status)),
            client: reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(60))
                .user_agent("STEMORA-Connect-Desktop/1.0")
                .build()
                .unwrap_or_default(),
        }
    }

    fn config_path() -> PathBuf {
        dirs::config_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("stemora")
            .join("connect_config.json")
    }

    pub fn load_config() -> AppConfig {
        let path = Self::config_path();
        if path.exists() {
            if let Ok(content) = fs::read_to_string(&path) {
                if let Ok(config) = serde_json::from_str::<AppConfig>(&content) {
                    return config;
                }
            }
        }
        AppConfig::default()
    }

    pub fn save_config_to_disk(config: &AppConfig) -> Result<(), String> {
        let path = Self::config_path();
        if let Some(parent) = path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        let content = serde_json::to_string_pretty(config).map_err(|e| e.to_string())?;
        fs::write(path, content).map_err(|e| e.to_string())
    }

    pub async fn execute_sync(&self) -> Result<SyncStatus, String> {
        let (server_url, token, sync_dir) = {
            let cfg = self.config.lock().await;
            (cfg.server_url.clone(), cfg.token.clone(), cfg.sync_dir.clone())
        };

        if token.trim().is_empty() {
            let mut st = self.status.lock().await;
            st.error_message = Some("กรุณาใส่ Sync Token เพื่อเริ่มเชื่อมต่อ".to_string());
            return Err("Sync token is required".to_string());
        }

        {
            let mut st = self.status.lock().await;
            st.is_syncing = true;
            st.error_message = None;
        }

        let base_path = PathBuf::from(&sync_dir);
        let tracks_dir = base_path.join("tracks");
        if let Err(e) = fs::create_dir_all(&tracks_dir) {
            let mut st = self.status.lock().await;
            st.is_syncing = false;
            st.error_message = Some(format!("ไม่สามารถสร้างโฟลเดอร์ปลายทางได้: {}", e));
            return Err(e.to_string());
        }

        // 1. Fetch manifest
        let manifest_url = format!("{}/api/sync/manifest", server_url.trim_end_matches('/'));
        let resp = self
            .client
            .get(&manifest_url)
            .header("Authorization", format!("Bearer {}", token.trim()))
            .send()
            .await
            .map_err(|e| format!("เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ: {}", e))?;

        if !resp.status().is_success() {
            let err_text = resp
                .text()
                .await
                .unwrap_or_else(|_| "Unknown error".to_string());
            let mut st = self.status.lock().await;
            st.is_syncing = false;
            st.error_message = Some(format!("เซิร์ฟเวอร์ปฏิเสธการเชื่อมต่อ: {}", err_text));
            return Err(err_text);
        }

        let manifest: SyncManifest = resp
            .json()
            .await
            .map_err(|e| format!("ข้อมูลตอบกลับไม่ถูกต้อง: {}", e))?;

        // 2. Download missing tracks
        let mut downloaded_count = 0;
        for track in &manifest.tracks {
            let dest_file = tracks_dir.join(&track.export_filename);
            let exists_and_matches = if dest_file.exists() {
                if let Ok(metadata) = fs::metadata(&dest_file) {
                    track.size_bytes == 0 || metadata.len() as i64 == track.size_bytes
                } else {
                    false
                }
            } else {
                false
            };

            if !exists_and_matches {
                let download_url = format!(
                    "{}{}?token={}&download=true",
                    server_url.trim_end_matches('/'),
                    track.download_url,
                    token.trim()
                );

                if let Ok(track_resp) = self.client.get(&download_url).send().await {
                    if track_resp.status().is_success() {
                        if let Ok(bytes) = track_resp.bytes().await {
                            let temp_dest = dest_file.with_extension("part");
                            if fs::write(&temp_dest, &bytes).is_ok() {
                                let _ = fs::rename(&temp_dest, &dest_file);
                                downloaded_count += 1;
                            }
                        }
                    }
                }
            }
        }

        // 3. Generate rekordbox.xml
        let xml_path = base_path.join("rekordbox.xml");
        let xml_content =
            generate_rekordbox_xml(&manifest.playlists, &manifest.tracks, &tracks_dir);
        if let Err(e) = fs::write(&xml_path, xml_content) {
            let mut st = self.status.lock().await;
            st.is_syncing = false;
            st.error_message = Some(format!("ไม่สามารถเขียนไฟล์ rekordbox.xml: {}", e));
            return Err(e.to_string());
        }

        // 3.1 Generate .m3u8 Playlists
        let playlists_dir = base_path.join("playlists");
        crate::rekordbox::generate_m3u8_playlists(
            &manifest.playlists,
            &manifest.tracks,
            &tracks_dir,
            &playlists_dir,
        );

        // 3.2 Generate Serato Crates
        let crates_dir = base_path.join("crates");
        crate::serato::sync_serato_crates(
            &manifest.playlists,
            &manifest.tracks,
            &tracks_dir,
            &crates_dir,
        );

        // 3.3 Auto configure Pioneer rekordbox
        let _ = crate::rekordbox::auto_configure_rekordbox(&xml_path);

        // 3.3 Cache local manifest
        if let Ok(manifest_json) = serde_json::to_string_pretty(&manifest) {
            let _ = fs::write(base_path.join("manifest.json"), manifest_json);
        }

        // 4. Update status
        let updated_status = {
            let mut st = self.status.lock().await;
            st.is_syncing = false;
            st.user_name = Some(manifest.user_name);
            st.last_synced = Some(Utc::now().to_rfc3339());
            st.total_tracks = manifest.tracks.len();
            st.total_playlists = manifest.playlists.len();
            st.last_downloaded = downloaded_count;
            st.error_message = None;
            st.clone()
        };

        Ok(updated_status)
    }
}
