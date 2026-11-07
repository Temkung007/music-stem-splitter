use std::sync::Arc;
use tauri::{AppHandle, Manager};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use crate::sync::SyncManager;

pub fn start_local_handshake_server(app_handle: AppHandle, manager: Arc<SyncManager>) {
    tauri::async_runtime::spawn(async move {
        let listener = match TcpListener::bind("127.0.0.1:48231").await {
            Ok(l) => l,
            Err(e) => {
                eprintln!("Failed to bind local handshake server on 127.0.0.1:48231: {}", e);
                return;
            }
        };

        loop {
            let (mut socket, _) = match listener.accept().await {
                Ok(conn) => conn,
                Err(_) => continue,
            };

            let app_handle = app_handle.clone();
            let manager = Arc::clone(&manager);

            tokio::spawn(async move {
                let mut buf = vec![0u8; 8192];
                let n = match socket.read(&mut buf).await {
                    Ok(n) if n > 0 => n,
                    _ => return,
                };

                let request = String::from_utf8_lossy(&buf[..n]);
                let first_line = request.lines().next().unwrap_or("");
                let parts: Vec<&str> = first_line.split_whitespace().collect();
                if parts.len() < 2 {
                    return;
                }

                let method = parts[0];
                let path = parts[1];

                let cors_headers = "Access-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: GET, POST, OPTIONS\r\nAccess-Control-Allow-Headers: Content-Type, Authorization\r\n";

                if method == "OPTIONS" {
                    let resp = format!(
                        "HTTP/1.1 204 No Content\r\n{}Content-Length: 0\r\nConnection: close\r\n\r\n",
                        cors_headers
                    );
                    let _ = socket.write_all(resp.as_bytes()).await;
                    return;
                }

                if path == "/ping" || path.starts_with("/ping?") {
                    let st = manager.status.lock().await;
                    let body = serde_json::json!({
                        "status": "ok",
                        "app": "STEMORA Connect",
                        "version": env!("CARGO_PKG_VERSION"),
                        "has_token": st.has_token,
                        "user_name": st.user_name,
                        "server_url": st.server_url
                    })
                    .to_string();

                    let resp = format!(
                        "HTTP/1.1 200 OK\r\n{}Content-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                        cors_headers,
                        body.len(),
                        body
                    );
                    let _ = socket.write_all(resp.as_bytes()).await;
                    return;
                }

                if path.starts_with("/pair") {
                    let mut token = String::new();
                    let mut server_url = String::new();

                    if let Some(pos) = path.find('?') {
                        let query = &path[pos + 1..];
                        for pair in query.split('&') {
                            let mut kv = pair.splitn(2, '=');
                            if let (Some(k), Some(v)) = (kv.next(), kv.next()) {
                                let decoded = urlencoding::decode(v).unwrap_or_default().to_string();
                                if k == "token" {
                                    token = decoded;
                                } else if k == "server" || k == "server_url" {
                                    server_url = decoded;
                                }
                            }
                        }
                    }

                    if token.is_empty() {
                        if let Some(body_start) = request.find("\r\n\r\n") {
                            let body_str = &request[body_start + 4..];
                            if let Ok(val) = serde_json::from_str::<serde_json::Value>(body_str) {
                                if let Some(t) = val.get("token").and_then(|v| v.as_str()) {
                                    token = t.to_string();
                                }
                                if let Some(s) = val
                                    .get("server_url")
                                    .or_else(|| val.get("server"))
                                    .and_then(|v| v.as_str())
                                {
                                    server_url = s.to_string();
                                }
                            }
                        }
                    }

                    if !token.is_empty() {
                        {
                            let mut cfg = manager.config.lock().await;
                            cfg.token = token.trim().to_string();
                            if !server_url.trim().is_empty() {
                                cfg.server_url = server_url.trim().to_string();
                            }
                            let _ = SyncManager::save_config_to_disk(&cfg);

                            let mut st = manager.status.lock().await;
                            st.has_token = true;
                            st.server_url = cfg.server_url.clone();
                            st.error_message = None;
                        }

                        // Bring window to front
                        if let Some(window) = app_handle.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.unminimize();
                            let _ = window.set_focus();
                        }

                        // Trigger sync immediately in background
                        let mgr = Arc::clone(&manager);
                        tauri::async_runtime::spawn(async move {
                            let _ = mgr.execute_sync().await;
                        });

                        let body = serde_json::json!({
                            "success": true,
                            "message": "Connected and paired successfully"
                        })
                        .to_string();

                        let resp = format!(
                            "HTTP/1.1 200 OK\r\n{}Content-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                            cors_headers,
                            body.len(),
                            body
                        );
                        let _ = socket.write_all(resp.as_bytes()).await;
                        return;
                    }
                }

                // Default 404
                let resp = format!(
                    "HTTP/1.1 404 Not Found\r\n{}Content-Length: 0\r\nConnection: close\r\n\r\n",
                    cors_headers
                );
                let _ = socket.write_all(resp.as_bytes()).await;
            });
        }
    });
}
