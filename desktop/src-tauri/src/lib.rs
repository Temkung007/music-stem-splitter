pub mod rekordbox;
pub mod sync;

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

pub fn run() {
    let sync_manager = Arc::new(SyncManager::new());
    let bg_manager = Arc::clone(&sync_manager);

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(AppState {
            manager: sync_manager,
        })
        .setup(move |app| {
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
            get_xml_path
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
