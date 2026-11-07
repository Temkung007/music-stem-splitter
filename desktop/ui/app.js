// STEMORA Connect - Desktop UI Controller (v1.0.1)
(function () {
  const invoke = window.__TAURI__?.core?.invoke || window.__TAURI__?.tauri?.invoke;

  // DOM Elements
  const pulseDot = document.getElementById("pulse-dot");
  const statusBadge = document.getElementById("status-badge");
  const lastSyncTime = document.getElementById("last-sync-time");
  const userName = document.getElementById("user-name");
  const disconnectBtn = document.getElementById("disconnect-btn");
  const totalPlaylists = document.getElementById("total-playlists");
  const totalTracks = document.getElementById("total-tracks");
  const syncNowBtn = document.getElementById("sync-now-btn");
  const syncBtnText = document.getElementById("sync-btn-text");
  const spinIcon = document.querySelector(".spin-icon");
  const openFolderBtn = document.getElementById("open-folder-btn");
  const autoSyncToggle = document.getElementById("auto-sync-toggle");
  const msgBanner = document.getElementById("msg-banner");
  const loginCtaCard = document.getElementById("login-cta-card");
  const browserLoginBtn = document.getElementById("browser-login-btn");

  // Updates UI
  const checkUpdateBtn = document.getElementById("check-update-btn");
  const updateNotifyDot = document.getElementById("update-notify-dot");
  const updateCard = document.getElementById("update-card");
  const updateCardVer = document.getElementById("update-card-ver");
  const updateCardNotes = document.getElementById("update-card-notes");
  const downloadUpdateBtn = document.getElementById("download-update-btn");
  const dismissUpdateBtn = document.getElementById("dismiss-update-btn");

  const updateModal = document.getElementById("update-modal");
  const closeUpdateBtn = document.getElementById("close-update-btn");
  const modalUpdateVerBadge = document.getElementById("modal-update-ver-badge");
  const modalUpdateNotesText = document.getElementById("modal-update-notes-text");
  const modalUpdateDlBtn = document.getElementById("modal-update-dl-btn");
  const modalUpdateDismissBtn = document.getElementById("modal-update-dismiss-btn");

  const settingsCheckUpdateBtn = document.getElementById("settings-check-update-btn");
  const settingsUpdateMsg = document.getElementById("settings-update-msg");

  // Modals
  const guideBtn = document.getElementById("guide-btn");
  const guideModal = document.getElementById("guide-modal");
  const closeGuideBtn = document.getElementById("close-guide-btn");
  const xmlPathDisplay = document.getElementById("xml-path-display");
  const copyXmlPathBtn = document.getElementById("copy-xml-path-btn");

  const settingsBtn = document.getElementById("settings-btn");
  const settingsModal = document.getElementById("settings-modal");
  const closeSettingsBtn = document.getElementById("close-settings-btn");
  const settingsForm = document.getElementById("settings-form");
  const tokenInput = document.getElementById("token-input");
  const serverInput = document.getElementById("server-input");
  const dirInput = document.getElementById("dir-input");

  let currentXmlPath = "";
  let latestUpdateInfo = null;

  function formatRelativeTime(isoString) {
    if (!isoString) return "ยังไม่เคยซิงก์";
    const then = new Date(isoString);
    const now = new Date();
    const diffSec = Math.floor((now - then) / 1000);
    if (diffSec < 10) return "เมื่อสักครู่";
    if (diffSec < 60) return `${diffSec} วินาทีที่แล้ว`;
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin} นาทีที่แล้ว`;
    return then.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  function renderStatus(status) {
    if (status.error_message) {
      msgBanner.textContent = status.error_message;
      msgBanner.classList.remove("hidden");
      msgBanner.style.display = "block";
      pulseDot.className = "pulse-dot error";
      statusBadge.textContent = "SYNC ERROR";
      statusBadge.style.color = "var(--danger)";
    } else if (!status.has_token) {
      msgBanner.textContent = "เชื่อมต่อบัญชีของคุณเพื่อเริ่มซิงก์เพลงลง rekordbox";
      msgBanner.classList.remove("hidden");
      msgBanner.style.display = "block";
      pulseDot.className = "pulse-dot";
      statusBadge.textContent = "SETUP REQUIRED";
      statusBadge.style.color = "var(--text-muted)";
    } else if (status.is_syncing) {
      msgBanner.classList.add("hidden");
      msgBanner.style.display = "none";
      pulseDot.className = "pulse-dot active";
      statusBadge.textContent = "SYNCING…";
      statusBadge.style.color = "var(--lime)";
      spinIcon.classList.add("spinning");
      syncBtnText.textContent = "กำลังซิงก์ข้อมูล…";
      syncNowBtn.disabled = true;
    } else {
      msgBanner.classList.add("hidden");
      msgBanner.style.display = "none";
      pulseDot.className = "pulse-dot active";
      statusBadge.textContent = "LIVE SYNC ACTIVE";
      statusBadge.style.color = "var(--lime)";
      spinIcon.classList.remove("spinning");
      syncBtnText.textContent = "ซิงก์กับ rekordbox ทันที";
      syncNowBtn.disabled = false;
    }

    userName.textContent = status.user_name || (status.has_token ? "เชื่อมต่อแล้ว" : "ยังไม่ได้เข้าสู่ระบบ");
    totalPlaylists.textContent = status.total_playlists || 0;
    totalTracks.textContent = status.total_tracks || 0;
    lastSyncTime.textContent = formatRelativeTime(status.last_synced);
    autoSyncToggle.checked = status.auto_sync;

    // Login CTA Card vs. Connected Controls
    if (loginCtaCard) {
      if (status.has_token) {
        // HIDE login card completely when user is already logged in
        loginCtaCard.classList.add("hidden");
        loginCtaCard.style.display = "none";
        syncNowBtn.style.display = "";
        if (disconnectBtn) {
          disconnectBtn.classList.remove("hidden");
          disconnectBtn.style.display = "inline";
        }
      } else {
        // SHOW login card when user is NOT logged in
        loginCtaCard.classList.remove("hidden");
        loginCtaCard.style.display = "flex";
        syncNowBtn.style.display = "none";
        if (disconnectBtn) {
          disconnectBtn.classList.add("hidden");
          disconnectBtn.style.display = "none";
        }
      }
    }

    serverInput.value = status.server_url;
    dirInput.value = status.sync_dir;
  }

  async function refresh() {
    if (!invoke) return;
    try {
      const status = await invoke("get_status");
      renderStatus(status);
    } catch (err) {
      console.error("Failed to get status:", err);
    }
  }

  async function syncNow() {
    if (!invoke) return;
    spinIcon.classList.add("spinning");
    syncBtnText.textContent = "กำลังซิงก์…";
    syncNowBtn.disabled = true;

    try {
      const updated = await invoke("trigger_sync");
      renderStatus(updated);
    } catch (err) {
      msgBanner.textContent = String(err);
      msgBanner.classList.remove("hidden");
      msgBanner.style.display = "block";
      refresh();
    }
  }

  // Check for Updates
  async function checkForUpdates(showModalIfAvailable = false, showFeedbackIfCurrent = false) {
    if (!invoke) return;
    try {
      const res = await invoke("check_desktop_update");
      latestUpdateInfo = res;

      if (res.has_update) {
        if (updateNotifyDot) {
          updateNotifyDot.classList.remove("hidden");
          updateNotifyDot.style.display = "block";
        }
        if (updateCard) {
          updateCardVer.textContent = "v" + res.latest_version;
          updateCardNotes.textContent = res.release_notes || "มีเวอร์ชันใหม่พร้อมให้ดาวน์โหลดและติดตั้ง";
          updateCard.classList.remove("hidden");
          updateCard.style.display = "block";
        }
        if (showModalIfAvailable && updateModal) {
          modalUpdateVerBadge.textContent = "v" + res.latest_version;
          modalUpdateNotesText.textContent = res.release_notes || "ปรับปรุงระบบและความเสถียร";
          updateModal.classList.remove("hidden");
          updateModal.style.display = "flex";
        }
        if (settingsUpdateMsg) {
          settingsUpdateMsg.textContent = `🚀 พบเวอร์ชันใหม่ v${res.latest_version}`;
          settingsUpdateMsg.style.color = "var(--lime)";
          settingsUpdateMsg.classList.remove("hidden");
          settingsUpdateMsg.style.display = "block";
        }
      } else {
        if (updateNotifyDot) {
          updateNotifyDot.classList.add("hidden");
          updateNotifyDot.style.display = "none";
        }
        if (updateCard) {
          updateCard.classList.add("hidden");
          updateCard.style.display = "none";
        }
        if (showFeedbackIfCurrent && settingsUpdateMsg) {
          settingsUpdateMsg.textContent = `✓ คุณกำลังใช้เวอร์ชันล่าสุดแล้ว (v${res.current_version})`;
          settingsUpdateMsg.style.color = "var(--lime)";
          settingsUpdateMsg.classList.remove("hidden");
          settingsUpdateMsg.style.display = "block";
          setTimeout(() => {
            settingsUpdateMsg.classList.add("hidden");
            settingsUpdateMsg.style.display = "none";
          }, 4000);
        } else if (showModalIfAvailable) {
          alert(`คุณกำลังใช้เวอร์ชันล่าสุดแล้ว (v${res.current_version})`);
        }
      }
    } catch (err) {
      console.warn("Failed to check for updates:", err);
      if (showFeedbackIfCurrent && settingsUpdateMsg) {
        settingsUpdateMsg.textContent = "ไม่สามารถตรวจสอบอัปเดตได้: " + err;
        settingsUpdateMsg.style.color = "var(--danger)";
        settingsUpdateMsg.classList.remove("hidden");
        settingsUpdateMsg.style.display = "block";
      }
    }
  }

  function downloadUpdate() {
    if (!invoke) return;
    const url = latestUpdateInfo?.download_url || "https://stemora.mydjplus.com/download/STEMORA-Connect-macOS.dmg";
    invoke("open_download_page", { downloadUrl: url }).catch(console.error);
    if (updateModal) {
      updateModal.classList.add("hidden");
      updateModal.style.display = "none";
    }
  }

  // Event Listeners
  syncNowBtn.addEventListener("click", syncNow);

  if (browserLoginBtn) {
    browserLoginBtn.addEventListener("click", async () => {
      if (invoke) {
        try {
          await invoke("open_browser_login");
        } catch (e) {
          console.error("Failed to open browser login:", e);
        }
      }
    });
  }

  if (disconnectBtn) {
    disconnectBtn.addEventListener("click", async () => {
      if (!confirm("คุณต้องการออกจากระบบ / สลับบัญชีใหม่ใน STEMORA Connect ใช่หรือไม่?")) {
        return;
      }
      if (invoke) {
        try {
          await invoke("disconnect_account");
          await refresh();
        } catch (err) {
          alert("ไม่สามารถออกจากระบบได้: " + err);
        }
      }
    });
  }

  openFolderBtn.addEventListener("click", async () => {
    if (invoke) await invoke("open_sync_folder");
  });

  autoSyncToggle.addEventListener("change", async (e) => {
    if (invoke) {
      await invoke("toggle_auto_sync", { enabled: e.target.checked });
      refresh();
    }
  });

  // Updates Event Listeners
  if (checkUpdateBtn) {
    checkUpdateBtn.addEventListener("click", () => checkForUpdates(true, false));
  }
  if (downloadUpdateBtn) {
    downloadUpdateBtn.addEventListener("click", downloadUpdate);
  }
  if (dismissUpdateBtn) {
    dismissUpdateBtn.addEventListener("click", () => {
      updateCard.classList.add("hidden");
      updateCard.style.display = "none";
    });
  }
  if (modalUpdateDlBtn) {
    modalUpdateDlBtn.addEventListener("click", downloadUpdate);
  }
  if (closeUpdateBtn) {
    closeUpdateBtn.addEventListener("click", () => {
      updateModal.classList.add("hidden");
      updateModal.style.display = "none";
    });
  }
  if (modalUpdateDismissBtn) {
    modalUpdateDismissBtn.addEventListener("click", () => {
      updateModal.classList.add("hidden");
      updateModal.style.display = "none";
    });
  }
  if (settingsCheckUpdateBtn) {
    settingsCheckUpdateBtn.addEventListener("click", () => checkForUpdates(false, true));
  }

  // Guide Modal
  guideBtn.addEventListener("click", async () => {
    if (invoke) {
      try {
        currentXmlPath = await invoke("get_xml_path");
        xmlPathDisplay.textContent = currentXmlPath;
      } catch (e) {
        console.error(e);
      }
    }
    guideModal.classList.remove("hidden");
    guideModal.style.display = "flex";
  });

  closeGuideBtn.addEventListener("click", () => {
    guideModal.classList.add("hidden");
    guideModal.style.display = "none";
  });

  copyXmlPathBtn.addEventListener("click", () => {
    if (navigator.clipboard && currentXmlPath) {
      navigator.clipboard.writeText(currentXmlPath);
      copyXmlPathBtn.textContent = "คัดลอกแล้ว!";
      setTimeout(() => (copyXmlPathBtn.textContent = "คัดลอก"), 2000);
    }
  });

  // Settings Modal
  settingsBtn.addEventListener("click", () => {
    settingsModal.classList.remove("hidden");
    settingsModal.style.display = "flex";
  });

  closeSettingsBtn.addEventListener("click", () => {
    settingsModal.classList.add("hidden");
    settingsModal.style.display = "none";
  });

  settingsForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!invoke) return;

    try {
      await invoke("save_settings", {
        serverUrl: serverInput.value,
        token: tokenInput.value,
        syncDir: dirInput.value,
      });
      settingsModal.classList.add("hidden");
      settingsModal.style.display = "none";
      refresh();
      syncNow();
    } catch (err) {
      alert("บันทึกไม่สำเร็จ: " + err);
    }
  });

  // Initial load & Polling
  refresh();
  setInterval(refresh, 5000);

  // Background check for updates on startup
  setTimeout(() => checkForUpdates(false, false), 1500);
})();
