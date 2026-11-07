pub mod local_server;
pub mod rekordbox;
pub mod serato;
pub mod sync;

use serde::{Deserialize, Serialize};
use std::sync::Arc;
use sync::{SyncManager, SyncStatus};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{TrayIconBuilder, TrayIconEvent},
    Manager, State,
};

struct AppState {
    manager: Arc<SyncManager>,
}

#[tauri::command]
async fn get_status(state: State<'_, AppState>) -> Result<SyncStatus, String> {
    let st = state.manager.status.lock().await;
    Ok(st.clone())
}

#[tauri::command]
async fn trigger_sync(state: State<'_, AppState>) -> Result<SyncStatus, String> {
    state.manager.execute_sync().await
}

#[tauri::command]
async fn save_settings(
    state: State<'_, AppState>,
    server_url: String,
    token: String,
    sync_dir: String,
) -> Result<(), String> {
    let mut cfg = state.manager.config.lock().await;
    cfg.server_url = server_url.trim().to_string();
    cfg.token = token.trim().to_string();
    cfg.sync_dir = sync_dir.trim().to_string();

    SyncManager::save_config_to_disk(&cfg)?;

    let mut st = state.manager.status.lock().await;
    st.server_url = cfg.server_url.clone();
    st.has_token = !cfg.token.is_empty();
    st.sync_dir = cfg.sync_dir.clone();
    st.error_message = None;

    Ok(())
}

#[tauri::command]
async fn toggle_auto_sync(state: State<'_, AppState>, enabled: bool) -> Result<bool, String> {
    let mut cfg = state.manager.config.lock().await;
    cfg.auto_sync = enabled;
    let _ = SyncManager::save_config_to_disk(&cfg);

    let mut st = state.manager.status.lock().await;
    st.auto_sync = enabled;

    Ok(enabled)
}

#[tauri::command]
async fn open_sync_folder(state: State<'_, AppState>) -> Result<(), String> {
    let cfg = state.manager.config.lock().await;
    let path = std::path::PathBuf::from(&cfg.sync_dir);
    let _ = std::fs::create_dir_all(&path);
    open::that(&path).map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_xml_path(state: State<'_, AppState>) -> Result<String, String> {
    let cfg = state.manager.config.lock().await;
    let path = std::path::PathBuf::from(&cfg.sync_dir).join("rekordbox.xml");
    Ok(path.to_string_lossy().to_string())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateInfo {
    pub has_update: bool,
    pub current_version: String,
    pub latest_version: String,
    pub release_notes: String,
    pub download_url: String,
}

fn is_version_newer(latest: &str, current: &str) -> bool {
    let parse = |v: &str| -> Vec<u32> {
        v.trim_start_matches('v')
            .split('.')
            .filter_map(|s| s.parse::<u32>().ok())
            .collect()
    };
    let l_parts = parse(latest);
    let c_parts = parse(current);
    l_parts > c_parts
}

#[tauri::command]
async fn check_desktop_update(state: State<'_, AppState>) -> Result<UpdateInfo, String> {
    let cfg = state.manager.config.lock().await;
    let url = format!("{}/api/sync/desktop/version", cfg.server_url.trim_end_matches('/'));
    let current_ver = env!("CARGO_PKG_VERSION").to_string();

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(6))
        .build()
        .map_err(|e| e.to_string())?;

    let res = client.get(&url).send().await.map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        return Err(format!("Server returned HTTP {}", res.status()));
    }

    let val: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
    let latest_ver = val.get("latest_version").and_then(|v| v.as_str()).unwrap_or("1.0.1").to_string();
    let release_notes = val.get("release_notes").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let mut dl_url = val.get("download_url").and_then(|v| v.as_str()).unwrap_or("").to_string();
    if dl_url.starts_with('/') {
        dl_url = format!("{}{}", cfg.server_url.trim_end_matches('/'), dl_url);
    }

    let has_update = is_version_newer(&latest_ver, &current_ver);

    Ok(UpdateInfo {
        has_update,
        current_version: current_ver,
        latest_version: latest_ver,
        release_notes,
        download_url: dl_url,
    })
}

#[tauri::command]
async fn open_download_page(download_url: Option<String>, state: State<'_, AppState>) -> Result<(), String> {
    let url = match download_url {
        Some(u) if !u.trim().is_empty() => u,
        _ => {
            let cfg = state.manager.config.lock().await;
            format!("{}/download/STEMORA-Connect-macOS.dmg", cfg.server_url.trim_end_matches('/'))
        }
    };
    open::that(&url).map_err(|e| e.to_string())
}

#[tauri::command]
async fn disconnect_account(state: State<'_, AppState>) -> Result<(), String> {
    let mut cfg = state.manager.config.lock().await;
    cfg.token = String::new();
    let _ = SyncManager::save_config_to_disk(&cfg);

    let mut st = state.manager.status.lock().await;
    st.has_token = false;
    st.user_name = None;
    st.total_tracks = 0;
    st.total_playlists = 0;
    st.error_message = None;

    Ok(())
}

#[tauri::command]
async fn auto_setup_rekordbox(state: State<'_, AppState>) -> Result<String, String> {
    let cfg = state.manager.config.lock().await;
    let xml_path = std::path::PathBuf::from(&cfg.sync_dir).join("rekordbox.xml");
    
    // Auto configure settings & symlink
    let res = rekordbox::auto_configure_rekordbox(&xml_path)?;

    // Open/activate Pioneer rekordbox
    #[cfg(target_os = "macos")]
    {
        let status = std::process::Command::new("open")
            .arg("-b")
            .arg("com.pioneerdj.rekordboxdj")
            .output();
        if status.is_err() || !status.as_ref().unwrap().status.success() {
            let _ = std::process::Command::new("open")
                .arg("-a")
                .arg("rekordbox")
                .output();
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = open::that(&xml_path);
    }

    Ok(format!("{} และเปิด rekordbox สำเร็จ", res))
}

#[tauri::command]
async fn auto_setup_serato(_state: State<'_, AppState>) -> Result<String, String> {
    serato::auto_setup_serato()
}

#[tauri::command]
async fn open_browser_login(state: State<'_, AppState>) -> Result<(), String> {
    let cfg = state.manager.config.lock().await;
    let url = format!("{}/?tab=playlists&connect=desktop", cfg.server_url.trim_end_matches('/'));
    open::that(&url).map_err(|e| e.to_string())
}

pub fn run() {
    let sync_manager = Arc::new(SyncManager::new());
    let bg_manager = Arc::clone(&sync_manager);
    let local_srv_manager = Arc::clone(&sync_manager);

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(AppState {
            manager: sync_manager,
        })
        .setup(move |app| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_size(tauri::Size::Logical(tauri::LogicalSize {
                    width: 380.0,
                    height: 590.0,
                }));
            }

            // Start local HTTP handshake server for 1-click web pairing
            local_server::start_local_handshake_server(app.handle().clone(), local_srv_manager);

            // Setup Tray Menu
            let quit_i = MenuItem::with_id(app, "quit", "Quit STEMORA Connect", true, None::<&str>)?;
            let sync_i = MenuItem::with_id(app, "sync", "Sync Now", true, None::<&str>)?;
            let open_i = MenuItem::with_id(app, "open_folder", "Open Music Folder", true, None::<&str>)?;
            let show_i = MenuItem::with_id(app, "show", "Open STEMORA Connect", true, None::<&str>)?;

            let menu = Menu::with_items(app, &[&show_i, &sync_i, &open_i, &quit_i])?;

            let _tray = TrayIconBuilder::new()
                .menu(&menu)
                .tooltip("STEMORA Connect")
                .on_menu_event(move |app_handle, event| match event.id.as_ref() {
                    "quit" => {
                        app_handle.exit(0);
                    }
                    "sync" => {
                        let state = app_handle.state::<AppState>();
                        let mgr = Arc::clone(&state.manager);
                        tauri::async_runtime::spawn(async move {
                            let _ = mgr.execute_sync().await;
                        });
                    }
                    "open_folder" => {
                        let state = app_handle.state::<AppState>();
                        let mgr = Arc::clone(&state.manager);
                        tauri::async_runtime::spawn(async move {
                            let cfg = mgr.config.lock().await;
                            let _ = open::that(&cfg.sync_dir);
                        });
                    }
                    "show" => {
                        if let Some(window) = app_handle.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click { .. } = event {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            if window.is_visible().unwrap_or(false) {
                                let _ = window.hide();
                            } else {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                    }
                })
                .build(app)?;

            // Background watch loop
            tauri::async_runtime::spawn(async move {
                // Immediate sync on launch if configured
                let has_token = {
                    let cfg = bg_manager.config.lock().await;
                    !cfg.token.trim().is_empty()
                };
                if has_token {
                    let _ = bg_manager.execute_sync().await;
                }

                loop {
                    tokio::time::sleep(tokio::time::Duration::from_secs(15)).await;
                    let (auto_sync, has_token) = {
                        let cfg = bg_manager.config.lock().await;
                        (cfg.auto_sync, !cfg.token.trim().is_empty())
                    };

                    if auto_sync && has_token {
                        let _ = bg_manager.execute_sync().await;
                    }
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_status,
            trigger_sync,
            save_settings,
            toggle_auto_sync,
            open_sync_folder,
            get_xml_path,
            open_browser_login,
            check_desktop_update,
            open_download_page,
            disconnect_account,
            auto_setup_rekordbox,
            auto_setup_serato
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
