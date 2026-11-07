// STEMORA Connect - Desktop UI Controller
(function () {
  const invoke = window.__TAURI__?.core?.invoke || window.__TAURI__?.tauri?.invoke;

  // DOM Elements
  const pulseDot = document.getElementById("pulse-dot");
  const statusBadge = document.getElementById("status-badge");
  const lastSyncTime = document.getElementById("last-sync-time");
  const userName = document.getElementById("user-name");
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
      pulseDot.className = "pulse-dot error";
      statusBadge.textContent = "SYNC ERROR";
      statusBadge.style.color = "var(--danger)";
    } else if (!status.has_token) {
      msgBanner.textContent = "เชื่อมต่อบัญชีของคุณเพื่อเริ่มซิงก์เพลงลง rekordbox";
      msgBanner.classList.remove("hidden");
      pulseDot.className = "pulse-dot";
      statusBadge.textContent = "SETUP REQUIRED";
      statusBadge.style.color = "var(--text-muted)";
    } else if (status.is_syncing) {
      msgBanner.classList.add("hidden");
      pulseDot.className = "pulse-dot active";
      statusBadge.textContent = "SYNCING…";
      statusBadge.style.color = "var(--lime)";
      spinIcon.classList.add("spinning");
      syncBtnText.textContent = "กำลังซิงก์ข้อมูล…";
      syncNowBtn.disabled = true;
    } else {
      msgBanner.classList.add("hidden");
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

    if (loginCtaCard) {
      if (!status.has_token) {
        loginCtaCard.classList.remove("hidden");
        syncNowBtn.style.display = "none";
      } else {
        loginCtaCard.classList.add("hidden");
        syncNowBtn.style.display = "";
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
      refresh();
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

  openFolderBtn.addEventListener("click", async () => {
    if (invoke) await invoke("open_sync_folder");
  });

  autoSyncToggle.addEventListener("change", async (e) => {
    if (invoke) {
      await invoke("toggle_auto_sync", { enabled: e.target.checked });
      refresh();
    }
  });

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
  });

  closeGuideBtn.addEventListener("click", () => {
    guideModal.classList.add("hidden");
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
  });

  closeSettingsBtn.addEventListener("click", () => {
    settingsModal.classList.add("hidden");
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
      refresh();
      syncNow();
    } catch (err) {
      alert("บันทึกไม่สำเร็จ: " + err);
    }
  });

  // Initial load & Polling
  refresh();
  setInterval(refresh, 5000);
})();
