"use client";
import { translateClient as tr } from "@/lib/i18n";

import { LanguageSwitcher, useLocale } from "@/components/locale-provider";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  ArrowRight,
  ArrowUpRight,
  AudioLines,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleHelp,
  Clock3,
  Cloud,
  ListMusic,
  Settings,
  LogOut,
  FileAudio,
  FolderOpen,
  Layers3,
  LoaderCircle,
  Mic2,
  Plus,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Upload,
  Trash2,
  X,
} from "lucide-react";
import { BlurFade } from "@/components/magicui/blur-fade";
import { BorderBeam } from "@/components/magicui/border-beam";
import { SoundPreview } from "@/components/sound-preview";
import { Brand } from "@/components/brand";
import { StemStorageChoice } from "@/components/stem-storage-choice";
import { StemJobStatus } from "@/components/stem-job-status";
import { StemBatch } from "@/components/stem-batch";
import { AuthBoundary, useAuth } from "@/components/auth-boundary";
import { MusicLibrary } from "@/components/music-library";
import { DjPlaylists } from "@/components/dj-playlists";
import { AccountPanel } from "@/components/account-panel";
import { Modal, Notice } from "@/components/workspace-ui";
import { queueSeparation } from "@/lib/separation-upload";
import { apiFetch } from "@/lib/api";
import { useClientStems } from "@/hooks/use-client-stems";
import {
  StemMixer,
  formatTime,
  type Task,
} from "@/components/stem-mixer";

type Health = {
  demucs_available: boolean;
  ffmpeg_available: boolean;
  device: string;
  worker_enabled?: boolean;
  worker_online?: boolean;
  default_engine?: string;
};
type View = "studio" | "library" | "guide" | "cloud" | "playlists" | "account";
const ACCEPT = ".mp3,.wav,.flac,.m4a,.aac,.ogg";
async function responseData(response: Response) {
  const data = await response.json().catch(() => null);
  if (!response.ok)
    throw new Error(
      typeof data?.detail === "string"
        ? data.detail
        : tr("เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาลองอีกครั้ง"),
    );
  if (!data)
    throw new Error(tr("เซิร์ฟเวอร์ตอบกลับไม่ถูกต้อง กรุณาลองอีกครั้ง"));
  return data;
}

function Workspace() {
  const { t: tr, locale } = useLocale();

  const { user, logout } = useAuth();
  const [view, setCurrentView] = useState<View>("studio");
  const [batchOpen, setBatchOpen] = useState(false);
  useEffect(() => { window.scrollTo({ top: 0 }); }, [view]);
  const [playlistDirty, setPlaylistDirty] = useState(false);
  const [leaveNotice, setLeaveNotice] = useState(false);
  const onPlaylistDirty = useCallback((dirty: boolean) => {
    setPlaylistDirty(dirty);
    if (!dirty) setLeaveNotice(false);
  }, []);
  function setView(next: View) {
    if (playlistDirty && next !== "playlists") {
      setLeaveNotice(true);
      return;
    }
    setLeaveNotice(false);
    setCurrentView(next);
  }
  const [playlistSeed, setPlaylistSeed] = useState<string[]>([]);
  const [libraryTrackId, setLibraryTrackId] = useState<string | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [connected, setConnected] = useState<boolean | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState("4stems");
  const [engine, setEngine] = useState("webgpu");
  const [storageMode, setStorageMode] = useState("download");
  const [model, setModel] = useState("htdemucs");
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  function uploadId(key: string) {
    const name = `stemora-pending-upload:${user.id}`;
    try {
      const old = JSON.parse(localStorage.getItem(name) || "null");
      if (old?.key === key && typeof old.id === "string") return old.id as string;
    } catch { /* Replace invalid local state. */ }
    const id = crypto.randomUUID();
    localStorage.setItem(name, JSON.stringify({key, id}));
    return id;
  }
  const [taskId, setTaskId] = useState<string | null>(null);
  const [task, setTask] = useState<Task | null>(null);
  const local = useClientStems(setTask);
  const [history, setHistory] = useState<Task[]>([]);
  const [error, setError] = useState("");
  const [pollError, setPollError] = useState("");
  const [historyError, setHistoryError] = useState("");
  const [historyUnavailable, setHistoryUnavailable] = useState(false);
  const [pollRetry, setPollRetry] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const engineSelected = useRef(false);
  const fileUrl = useRef<string | null>(null);
  const fileCheck = useRef(0);
  const [fileDuration, setFileDuration] = useState<number | null>(null);
  const [checkingFile, setCheckingFile] = useState(false);
  const busy =
    uploading ||
    local.running ||
    local.saving ||
    task?.status === "queued" ||
    task?.status === "processing";
  const blocking = uploading || local.running || local.saving ||
    ((task?.status === "queued" || task?.status === "processing") && task.engine !== "worker");
  const completed = task?.status === "completed";
  const available = connected && health?.ffmpeg_available;

  const refresh = useCallback(async () => {
    try {
      const result = await responseData(
        await apiFetch("/api/health", { signal: AbortSignal.timeout(8000) }),
      );
      setHealth(result);
      if (!engineSelected.current) {
        setEngine(result.default_engine || "webgpu");
        engineSelected.current = true;
      }
      setConnected(true);
    } catch {
      setConnected(false);
    }
    try {
      setHistory(
        await responseData(
          await apiFetch("/api/tasks", { signal: AbortSignal.timeout(8000) }),
        ),
      );
      setHistoryUnavailable(false);
    } catch {
      setHistoryUnavailable(true);
    }
  }, []);
  useEffect(() => {
    const startup = setTimeout(() => {
      void refresh();
      const saved = localStorage.getItem("stemora-active-task");
      if (saved) setTaskId(saved);
    }, 0);
    const interval = setInterval(() => void refresh(), 20000);
    return () => {
      clearTimeout(startup);
      clearInterval(interval);
      if (fileUrl.current) URL.revokeObjectURL(fileUrl.current);
    };
  }, [refresh]);

  useEffect(() => {
    if (!taskId) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let failures = 0;
    async function poll() {
      try {
        const response = await apiFetch(`/api/tasks/${taskId}`, {
          signal: AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(10000),
          ]),
        });
        if (response.status === 404) {
          localStorage.removeItem("stemora-active-task");
          setTaskId(null);
          setTask(null);
          throw new Error(tr("ไม่พบงานเดิม กรุณาเลือกไฟล์เพื่อเริ่มใหม่"));
        }
        const data: Task = await responseData(response);
        if (controller.signal.aborted) return;
        setTask(data);
        setPollError("");
        failures = 0;
        if (["completed", "failed", "cancelled", "expired", "expiring"].includes(data.status)) {
          void refresh();
          return;
        }
      } catch (cause) {
        if (controller.signal.aborted) return;
        failures++;
        setPollError(
          cause instanceof Error && cause.message === tr("ไม่พบงานเดิม กรุณาเลือกไฟล์เพื่อเริ่มใหม่") ? cause.message : tr("ตรวจสถานะไม่ได้ชั่วคราว กำลังเชื่อมต่ออีกครั้ง…"),
        );
      }
      timer = setTimeout(poll, Math.min(15000, 1500 * Math.max(1, failures)));
    }
    void poll();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [taskId, pollRetry, refresh, tr]);

  function selectFile(candidate?: File) {
    if (!candidate || busy) return;
    const check = ++fileCheck.current;
    setError("");
    setFile(null);
    setFileDuration(null);
    setCheckingFile(false);
    if (!/\.(mp3|wav|flac|m4a|aac|ogg)$/i.test(candidate.name)) {
      setError(
        tr("ไฟล์นี้ยังไม่รองรับ เลือก MP3, WAV, FLAC, M4A, AAC หรือ OGG"),
      );
      return;
    }
    if (candidate.size === 0 || candidate.size > 50_000_000) {
      setError(
        candidate.size === 0
          ? tr("ไฟล์นี้ไม่มีข้อมูล กรุณาเลือกไฟล์ใหม่")
          : tr("ไฟล์ใหญ่เกิน 50 MB กรุณาเลือกไฟล์ที่เล็กลง"),
      );
      return;
    }
    setFile(candidate);
    setCheckingFile(true);
    if (fileUrl.current) URL.revokeObjectURL(fileUrl.current);
    fileUrl.current = URL.createObjectURL(candidate);
    const audio = new Audio();
    const timeout = setTimeout(() => {
      if (fileCheck.current === check) setCheckingFile(false);
      audio.removeAttribute("src");
      audio.load();
    }, 5000);
    audio.preload = "metadata";
    audio.onloadedmetadata = () => {
      clearTimeout(timeout);
      if (fileCheck.current !== check) return;
      setCheckingFile(false);
      if (Number.isFinite(audio.duration)) {
        if (audio.duration > 600) {
          setFile(null);
          setError(tr("รองรับเพลงความยาวไม่เกิน 10 นาที กรุณาตัดไฟล์ก่อน"));
        } else setFileDuration(audio.duration);
      }
      audio.removeAttribute("src");
      audio.load();
    };
    audio.onerror = () => {
      clearTimeout(timeout);
      if (fileCheck.current === check) setCheckingFile(false);
    }; // Server validates codecs the browser cannot read.
    audio.src = fileUrl.current;
  }
  function newSession() {
    setView("studio");
    if (blocking) return;
    local.clear();
    setTask(null);
    setTaskId(null);
    setFile(null);
    setFileDuration(null);
    setError("");
    setPollError("");
    localStorage.removeItem("stemora-active-task");
  }
  async function start(demo = false) {
    if (busy || (!demo && !file)) return;
    setError("");
    setPollError("");
    setTask(null);
    setTaskId(null);
    setView("studio");
    localStorage.removeItem("stemora-active-task");
    if (!demo && engine === "webgpu" && file) {
      await local.run(file, mode);
      return;
    }
    local.clear();
    setUploading(true);
    setUploadProgress(0);
    const form = new FormData();
    form.append("stems_mode", mode);
    form.append("storage_mode", storageMode);
    if (!demo && file) {
      form.append("file", file);
      form.append("engine", engine);
      form.append("model_name", model);
    }
    try {
      const data = !demo && engine === "worker" && file
        ? await queueSeparation(form, uploadId(JSON.stringify([file.name, file.size, file.lastModified, mode, engine, storageMode])), setUploadProgress)
        : await responseData(await apiFetch(demo ? "/api/demo-audio" : "/api/separate", {method: "POST", body: form, signal: AbortSignal.timeout(120000)}));
      localStorage.removeItem(`stemora-pending-upload:${user.id}`);
      localStorage.setItem("stemora-active-task", data.task_id);
      setTaskId(data.task_id);
      setTask({
        id: data.task_id,
        filename: data.filename,
        stems_mode: mode,
        engine: demo ? "demo" : engine,
        status: "queued",
        progress: 5,
        message: tr("รอประมวลผล"),
        stems: {},
        created_at: new Date().toISOString(),
      });
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : tr("ส่งไฟล์ไม่สำเร็จ กรุณาลองอีกครั้ง"),
      );
    } finally {
      setUploading(false);
    }
  }
  async function trashTask(item: Task) {
    try {
      setHistoryError("");
      if (["queued", "processing"].includes(item.status) && item.engine === "worker")
        await responseData(await apiFetch(`/api/tasks/${item.id}/cancel`, { method: "POST" }));
      await responseData(await apiFetch(`/api/tasks/${item.id}/trash`, { method: "POST" }));
      if (taskId === item.id) {
        setTask(null); setTaskId(null); localStorage.removeItem("stemora-active-task");
      }
      await refresh();
      window.dispatchEvent(new Event("stemora:tasks-changed"));
    } catch (cause) {
      setHistoryError(cause instanceof Error ? cause.message : tr("ทำรายการไม่สำเร็จ กรุณาตรวจสอบข้อมูลแล้วลองอีกครั้ง"));
    }
  }
  function openTask(item: Task) {
    if (blocking && item.id !== taskId) return;
    local.clear();
    setTask(item);
    setTaskId(item.id);
    setView("studio");
    setError("");
    setPollError("");
    localStorage.setItem("stemora-active-task", item.id);
  }
  const viewTitle =
    view === "cloud"
      ? tr("Music library")
      : view === "playlists"
        ? tr("Set builder")
        : view === "account"
          ? tr("Your workspace")
          : view === "studio"
            ? tr("Stem studio")
            : view === "library"
              ? tr("Stem archive")
              : tr("Getting started");
  return (
    <div className="app-shell">
      <a className="skip-link" href="#workspace-content">{tr("ข้ามไปยังเนื้อหา")}</a>
      <aside className="sidebar">
        <a
          className="brand-link"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setView("studio");
          }}
          aria-label={tr("STEMORA หน้าสตูดิโอ")}
        >
          <Brand />
        </a>
        <div className="workspace-label">{tr("YOUR WORKSPACE")}</div>
        <nav aria-label={tr("เมนูหลัก")}>
          {(
            [
              { key: "cloud", label: tr("คลังเพลงส่วนตัว"), Icon: Cloud },
              {
                key: "playlists",
                label: tr("จัดเซ็ตและ Playlist"),
                Icon: ListMusic,
              },
              {
                key: "studio",
                label: tr("สตูดิโอแยกเสียง"),
                Icon: SlidersHorizontal,
              },
              { key: "library", label: tr("งานแยกเสียง"), Icon: FolderOpen },
            ] as const
          ).map(({ key, label, Icon }) => (
            <button
              key={key}
              className={`nav-item ${view === key ? "nav-active" : ""}`}
              onClick={() => {
                if (key === "playlists") setPlaylistSeed([]);
                setView(key);
              }}
              aria-current={view === key ? "page" : undefined}
            >
              <Icon size={18} />
              {label}
              {key === "studio" ? (
                busy ? (
                  <span className="nav-dot" />
                ) : null
              ) : key === "library" ? (
                <span className="nav-count">
                  {history.length}
                </span>
              ) : null}
            </button>
          ))}
        </nav>
        <div className="sidebar-note">
          <span className="sidebar-note-label"><Sparkles size={15} /> {tr("สร้างได้มากกว่าเสียงเดิม")}</span>
          <p>{tr("แยกเสียง จัดเซ็ต และเก็บเพลงไว้ในที่เดียว")}</p>
          <button onClick={() => setView("guide")}>
            {tr("คู่มือเริ่มต้น")} <ArrowUpRight size={14} />
          </button>
        </div>
        <div className="sidebar-bottom">
          <button
            className={`nav-item ${view === "account" ? "nav-active" : ""}`}
            onClick={() => setView("account")}
          >
            <Settings size={18} /> {tr("บัญชีและพื้นที่จัดเก็บ")}
          </button>
          <button
            className="nav-item"
            disabled={local.running || local.saving}
            onClick={() => {
              if (playlistDirty) setLeaveNotice(true);
              else void logout();
            }}
          >
            <LogOut size={18} /> {tr("ออกจากระบบ")}
          </button>
          <button
            className={`nav-item ${view === "guide" ? "nav-active" : ""}`}
            onClick={() => setView("guide")}
          >
            <CircleHelp size={18} /> {tr("วิธีใช้งาน")}
          </button>
          <div className="local-profile">
            <div className="profile-avatar">{user.name.slice(0, 1).toUpperCase()}</div>
            <div>
              <strong>{user.name}</strong>
              <small>{tr("คลังเพลงส่วนตัว")}</small>
            </div>
            <span className="status-dot" />
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="mobile-brand">
            <Brand compact />
          </div>
          <div className="breadcrumb">
            {tr("Workspace")} <ChevronRight size={14} />
            <strong>{viewTitle}</strong>
          </div>
          <div className="topbar-right">
            <LanguageSwitcher />
            <button
              className={`connection ${connected === false || health?.ffmpeg_available === false ? "offline" : ""}`}
              onClick={() => void refresh()}
              title={tr("ตรวจสอบการเชื่อมต่ออีกครั้ง")}
            >
              <span className="status-dot" />
              {connected === null
                ? tr("กำลังเชื่อมต่อ")
                : connected === false
                  ? tr("เซิร์ฟเวอร์ออฟไลน์")
                  : !health?.ffmpeg_available
                    ? tr("ต้องติดตั้ง FFmpeg")
                    : tr("ระบบพร้อมใช้งาน")}
            </button>
            <button className="local-badge" onClick={() => setView("account")}>
              {tr("PRIVATE")}
            </button>
          </div>
        </header>
        <nav className="mobile-nav" aria-label={tr("เมนูมือถือ")}>
          <button
            className={view === "cloud" ? "selected" : ""}
            onClick={() => setView("cloud")}
          >
            {tr("คลังเพลง")}
          </button>
          <button
            className={view === "playlists" ? "selected" : ""}
            onClick={() => {
              setPlaylistSeed([]);
              setView("playlists");
            }}
          >
            {tr("Playlist")}
          </button>
          <button
            className={view === "account" ? "selected" : ""}
            onClick={() => setView("account")}
          >
            {tr("บัญชี")}
          </button>
          <button
            className={view === "studio" ? "selected" : ""}
            onClick={() => setView("studio")}
          >
            {tr("สตูดิโอ")}
          </button>
          <button
            className={view === "library" ? "selected" : ""}
            onClick={() => setView("library")}
          >
            {tr("งานแยกเสียง")}
          </button>
          <button
            className={view === "guide" ? "selected" : ""}
            onClick={() => setView("guide")}
          >
            {tr("วิธีใช้งาน")}
          </button>
        </nav>
        <main id="workspace-content" tabIndex={-1}>
          <BlurFade key={view} duration={0.25} blur="3px" offset={4} className="page-heading">
            <div>
              <div className="eyebrow">STEMORA WORKSPACE <span>/</span> {view === "studio" ? "01" : view === "cloud" ? "02" : view === "playlists" ? "03" : "04"}</div>
              <h1>
                {viewTitle}
              </h1>
              <p>
                {view === "cloud"
                  ? tr("เก็บทุกเสียงไว้ด้วยกัน พร้อมสำหรับเซ็ตถัดไป")
                  : view === "playlists"
                    ? tr("วางเส้นทางพลังงาน แล้วจัดจังหวะในแบบของคุณ")
                    : view === "account"
                      ? tr("จัดการบัญชีและพื้นที่สร้างสรรค์ของคุณ")
                      : view === "studio"
                        ? tr(
                            "เปลี่ยนเพลงที่คุณชอบ ให้เป็นเสียงในแบบของคุณ",
                          )
                        : view === "library"
                          ? tr("กลับมาฟัง มิกซ์ และดาวน์โหลดผลงานของคุณได้เสมอ")
                          : tr("จากเพลงหนึ่งเพลง สู่ความเป็นไปได้อีกมากมาย")}
              </p>
            </div>
            {view === "cloud" ||
            view === "playlists" ||
            view === "account" ? null : view === "studio" &&
              !completed &&
              !busy ? (
              <div className="studio-heading-actions">
              {health?.worker_enabled && <button className="secondary-button" aria-expanded={batchOpen} aria-controls="batch-separation" onClick={() => setBatchOpen(!batchOpen)}><Layers3 size={15} />{tr("แยกหลายเพลง")}</button>}
              <button
                className="secondary-button demo-top"
                disabled={!available}
                onClick={() => void start(true)}
              >
                <PlayIcon /> {tr("ลองเพลงตัวอย่าง")} <ArrowUpRight size={15} />
              </button>
              </div>
            ) : (
              <button
                className="secondary-button"
                disabled={blocking}
                onClick={newSession}
              >
                <Plus size={17} /> {tr("เริ่มเพลงใหม่")}
              </button>
            )}
          </BlurFade>
          {leaveNotice && (
            <Notice
              text={tr(
                "มีการแก้ไขเซ็ตที่ยังไม่บันทึก กรุณาบันทึกหรือย้อนค่าก่อนเปลี่ยนหน้าหรือออกจากระบบ",
              )}
              dismiss={() => setLeaveNotice(false)}
            />
          )}
          {view === "cloud" && (
            <MusicLibrary
              onSeparate={(id) => {
                if (busy) {
                  setView("studio");
                  return;
                }
                setLibraryTrackId(id);
              }}
              onPlaylist={(ids) => {
                setPlaylistSeed(ids);
                setView("playlists");
              }}
            />
          )}
          {view === "playlists" && (
            <DjPlaylists seed={playlistSeed} onDirtyChange={onPlaylistDirty} />
          )}
          {view === "account" && <AccountPanel />}
          {view === "studio" && (
            <>
              {health?.worker_enabled && batchOpen && !busy && !completed && <div id="batch-separation"><StemBatch onQueued={() => void refresh()} /></div>}
              <div className="steps" aria-label={tr("ขั้นตอนการทำงาน")}>
                {[
                  tr("เลือกเพลงของคุณ"),
                  tr("แยกเสียง"),
                  tr("มิกซ์และดาวน์โหลด"),
                ].map((label, index) => (
                  <div
                    key={label}
                    className={`step ${(completed ? 2 : busy ? 1 : 0) === index ? "step-active" : ""}`}
                  >
                    <span>
                      {(completed ? 2 : busy ? 1 : 0) > index ? (
                        <Check size={12} />
                      ) : (
                        `0${index + 1}`
                      )}
                    </span>
                    {label}
                    {index < 2 && <div className="step-line" />}
                  </div>
                ))}
              </div>
              {(error || local.error) && (
                <div className="error-message" role="alert">
                  {tr(error || local.error)}
                  <button
                    className="icon-button"
                    onClick={() => {
                      setError("");
                      local.dismissError();
                    }}
                    aria-label={tr("ปิดข้อความ")}
                  >
                    <X size={16} />
                  </button>
                </div>
              )}
              {pollError && (
                <div className="error-message" role="alert">
                  {pollError}
                  <button
                    onClick={() => {
                      setPollRetry((value) => value + 1);
                    }}
                  >
                    {tr("เชื่อมต่ออีกครั้ง")}
                  </button>
                  <button
                    onClick={() => {
                      setTask(null);
                      setTaskId(null);
                      setPollError("");
                      localStorage.removeItem("stemora-active-task");
                    }}
                  >
                    {tr("กลับไปเลือกเพลง")}
                  </button>
                </div>
              )}
              {completed ? (
                <>
                  {task.local && local.result && (
                    <div className="local-result-banner panel" role="status">
                      <div>
                        <strong>
                          {tr(
                            local.saved
                              ? "บันทึกใน cloud แล้ว"
                              : "แยกเสียงเสร็จบนอุปกรณ์ของคุณ",
                          )}
                        </strong>
                        <p>
                          {tr(
                            local.saved
                              ? "เปิดผลงานนี้จากงานแยกเสียงได้ในครั้งถัดไป"
                              : "ดาวน์โหลดได้ทันที ผลลัพธ์ในเครื่องจะหายเมื่อปิดหรือโหลดแท็บใหม่ หากต้องการเก็บไว้ให้บันทึกเข้า cloud",
                          )}
                        </p>
                        {!local.saved && (
                          <small>
                            {tr("ใช้พื้นที่ cloud {0} MB", {
                              0: (
                                local.result.files.reduce(
                                  (total, file) => total + file.size_bytes,
                                  0,
                                ) / 1_000_000
                              ).toFixed(1),
                            })}
                          </small>
                        )}
                      </div>
                      <button
                        className="primary-button small"
                        disabled={local.saving || local.saved}
                        onClick={async () => {
                          const saved = await local.save();
                          if (saved) void refresh();
                        }}
                      >
                        {local.saving ? (
                          <LoaderCircle size={17} className="spin" />
                        ) : local.saved ? (
                          <Check size={17} />
                        ) : (
                          <Cloud size={17} />
                        )}
                        {tr(
                          local.saving
                            ? "กำลังบันทึกเข้า cloud…"
                            : local.saved
                              ? "บันทึกแล้ว"
                              : "บันทึกเข้า cloud",
                        )}
                        {local.saving && ` ${local.saveProgress}%`}
                      </button>
                    </div>
                  )}
                  {task.storage_mode === "download" && <p className="stem-temporary-notice" role="status">{tr("ผลลัพธ์ชั่วคราว ไม่ใช้พื้นที่ Cloud · ดาวน์โหลดก่อน {0}", {0: new Date((task.expires_at || 0) * 1000).toLocaleString(locale === "th" ? "th-TH" : "en-US")})}</p>}
                  <StemMixer key={task.id} task={task} />
                </>
              ) : busy ? (
                <section className={`processing panel ${task?.engine === "worker" ? "processing-worker" : ""}`} aria-live={task?.engine === "worker" ? "off" : "polite"}>
                  <div className="processing-art">
                    {task?.engine === "worker" && task.status === "queued" ? <Clock3 size={44} /> : <AudioLines size={44} />}
                    <div className="orbit" />
                  </div>
                  <span className="eyebrow">{tr("FINDING EVERY LAYER")}</span>
                  {task?.engine === "worker" && !uploading ? <>
                    <p className="processing-file">{task.filename}</p>
                    <StemJobStatus task={task} connectionIssue={!!pollError} />
                  </> : <>
                  <h2>
                    {uploading
                      ? uploadProgress === 100 ? tr("อัปโหลดครบแล้ว กำลังตรวจและส่งเข้าคิว…") : `${tr("กำลังส่งเพลงของคุณ")} ${uploadProgress}%`
                      : task?.local
                        ? tr("กำลังแยกเสียงบนอุปกรณ์ของคุณ")
                        : tr("กำลังเตรียมเสียงสำหรับคุณ")}
                  </h2>
                  <p className="processing-file">
                    {task?.filename || file?.name}
                  </p>
                  <div className="progress-label">
                    <span>
                      {uploading
                        ? tr("กำลังอัปโหลดและตรวจสอบไฟล์…")
                        : tr(task?.message || "")}
                    </span>
                    <strong>
                      {uploading ? "…" : `${task?.progress || 5}%`}
                    </strong>
                  </div>
                  <progress
                    max="100"
                    value={uploading ? undefined : task?.progress}
                  />
                  </>}
                  <p>
                    {tr(
                      task?.local
                        ? "เปิดคลังเพลงในเว็บนี้ได้ระหว่างรอ กรุณาเปิดแท็บนี้ไว้ GPU บนอุปกรณ์กำลังทำงาน"
                        : task?.engine === "worker"
                          ? (locale === "th" ? "ดูผลได้ในงานแยกเสียง" : "Find your results in Stem jobs")
                          : "คุณเปิดคลังเพลงได้ระหว่างรอ งานจะประมวลผลต่อบนเซิร์ฟเวอร์",
                    )}
                  </p>
                  {task?.local && (
                    <button className="secondary-button" onClick={local.cancel}>
                      <X size={16} />
                      {tr("ยกเลิกการแยกเสียง")}
                    </button>
                  )}
                  {task?.engine === "worker" && !uploading && (
                    <button className="secondary-button" onClick={async () => {
                      try {
                        await responseData(await apiFetch(`/api/tasks/${task.id}/cancel`, { method: "POST" }));
                        setPollRetry((value) => value + 1);
                      } catch (cause) { setError((cause as Error).message); }
                    }}>
                      <X size={16} />{tr("ยกเลิกงานในคิว")}
                    </button>
                  )}
                </section>
              ) : (
                <div className="studio-grid">
                  <section className="panel studio-panel song-input-panel">
                    <div className="song-input">
                    <div className="section-heading">
                      <div className="section-number">01</div>
                      <div>
                        <h2>{tr("เพิ่มเพลงของคุณ")}</h2>
                        <p>{tr(engine === "worker" ? "เลือกเพลง แล้วกลับมาฟังผลได้เมื่อพร้อม" : "เลือกไฟล์ แล้วแยกเสียงบนอุปกรณ์ของคุณ")}</p>
                      </div>
                      <Upload size={19} />
                    </div>
                    <input
                      ref={input}
                      type="file"
                      accept={ACCEPT}
                      className="visually-hidden"
                      tabIndex={-1}
                      onChange={(e) => {
                        selectFile(e.target.files?.[0]);
                        e.target.value = "";
                      }}
                    />
                    <div
                      className={`dropzone ${dragging ? "dragging" : ""} ${file ? "has-file" : ""}`}
                      onDragOver={(e) => {
                        e.preventDefault();
                        setDragging(true);
                      }}
                      onDragLeave={(e) => {
                        if (!e.currentTarget.contains(e.relatedTarget as Node))
                          setDragging(false);
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        setDragging(false);
                        if (e.dataTransfer.files.length > 1)
                          setError(tr("กรุณาเลือกเพลงครั้งละ 1 ไฟล์"));
                        else selectFile(e.dataTransfer.files[0]);
                      }}
                    >
                      {file && <BorderBeam duration={8} size={120} colorFrom="#d7f98b" colorTo="#22c55e" />}
                      <div className="upload-art">
                        <div className="upload-art-ring" />
                        <div className="upload-art-front">
                          {file ? (
                            <FileAudio size={28} />
                          ) : (
                            <AudioLines size={28} />
                          )}
                          <span>
                            <Plus size={12} />
                          </span>
                        </div>
                      </div>
                      <h3>
                        {file
                          ? file.name
                          : dragging
                            ? tr("วางเพลงของคุณได้เลย")
                            : tr("ลากเพลงของคุณมาวางที่นี่")}
                      </h3>
                      <p>
                        {file
                          ? `${(file.size / 1024 / 1024).toFixed(1)} MB${fileDuration ? ` · ${formatTime(fileDuration)}` : ""}`
                          : tr("ให้เสียงที่ซ่อนอยู่ ได้ออกมาเป็นตัวเอง")}
                      </p>
                      <button
                        className="file-button"
                        onClick={() => input.current?.click()}
                      >
                        <FolderOpen size={16} />
                        {file
                          ? tr("เปลี่ยนไฟล์เพลง")
                          : tr("เลือกไฟล์จากเครื่อง")}
                        <ArrowUpRight size={14} />
                      </button>
                      <div className="formats">
                        <span className="format-tag">MP3</span>
                        <span className="format-tag">WAV</span>
                        <span className="format-tag">FLAC</span>
                        <span className="format-tag">M4A</span>
                        <span className="format-tag">AAC</span>
                        <span className="format-tag">OGG</span>
                        <span className="format-divider">·</span>
                        <span>{tr("สูงสุด 50 MB / 10 นาที")}</span>
                      </div>
                    </div>
                    <div className="upload-demo-link">
                      <span>{tr("ยังไม่มีไฟล์เพลง?")}</span>
                      <button disabled={!available} onClick={() => void start(true)}><PlayIcon /> {tr("ลองเพลงตัวอย่าง")}</button>
                    </div>
                    <SoundPreview />
                    </div>
                  </section>
                  <section className="panel studio-panel separation-settings-panel">
                    <div className="separation-settings">
                    <div className="section-heading"><div className="section-number">02</div><div><h2>{tr("เลือกผลลัพธ์ & ตั้งค่า")}</h2><p>{tr("พร้อมฟัง มิกซ์ และดาวน์โหลด")}</p></div><SlidersHorizontal size={19} /></div>
                    <div
                      className="mode-options"
                      role="group"
                      aria-label={tr("รูปแบบการแยกเสียง")}
                    >
                      {[
                        {
                          id: "4stems",
                          title: tr("4 Stems"),
                          text: tr("เสียงร้อง · กลอง · เบส · ดนตรี"),
                          stems: ["Vocals", "Drums", "Bass", "Other"],
                          Icon: Layers3,
                        },
                        {
                          id: "2stems",
                          title: tr("Vocal + Instrumental"),
                          text: tr("เสียงร้อง · ดนตรีประกอบ"),
                          stems: ["Vocals", "Inst"],
                          Icon: Mic2,
                        },
                      ].map((option) => (
                        <button
                          key={option.id}
                          className={`mode-card ${mode === option.id ? "mode-selected" : ""}`}
                          aria-pressed={mode === option.id}
                          onClick={() => setMode(option.id)}
                        >
                          <div className="mode-top">
                            <div className="mode-title-group">
                              <option.Icon size={19} />
                              <strong>{option.title}</strong>
                            </div>
                            <span className="radio-dot">
                              {mode === option.id && <span />}
                            </span>
                          </div>
                          <small className="mode-desc">{option.text}</small>
                          <div className="mode-stems-badges">
                            {option.stems.map((s) => (
                              <span key={s} className={`mode-stem-badge mode-stem-${s.toLowerCase()}`}>
                                {s}
                              </span>
                            ))}
                          </div>
                        </button>
                      ))}
                    </div>
                    <details className="processing-options" open>
                    <summary>{tr("ตัวเลือกการประมวลผล AI & คุณภาพ")}</summary>
                    <div className="engine-setting">
                      <div>
                        <SlidersHorizontal size={16} />
                        <label htmlFor="engine">{tr("การประมวลผล")}</label>
                      </div>
                      <select
                        id="engine"
                        value={engine}
                        onChange={(e) => { engineSelected.current = true; setEngine(e.target.value); }}
                      >
                        {health?.worker_enabled && <option value="worker">{tr("แยกเสียงให้ฉัน (Cloud Worker AI)")}</option>}
                        <option value="webgpu">
                          {tr("บนอุปกรณ์ของฉัน · WebGPU (ฟรี & ความลับ 100%)")}
                        </option>
                        <option value="demucs">
                          {tr("บนเซิร์ฟเวอร์ · Demucs v4 AI")}
                          {health && !health.demucs_available
                            ? tr(" · ยังไม่ติดตั้ง")
                            : ""}
                        </option>
                        <option value="dsp">{tr("DSP · กรองย่านเสียง")}</option>
                      </select>
                    </div>
                    {engine === "demucs" && health?.demucs_available && (
                      <div className="engine-setting">
                        <label htmlFor="model">{tr("ระดับความละเอียด")}</label>
                        <select
                          id="model"
                          value={model}
                          onChange={(e) => setModel(e.target.value)}
                        >
                          <option value="htdemucs">
                            {tr("มาตรฐาน · เร็วกว่า")}
                          </option>
                          <option value="htdemucs_ft">
                            {tr("ละเอียด · ใช้เวลามากขึ้น")}
                          </option>
                        </select>
                      </div>
                    )}
                    </details>
                    {engine === "worker" && <StemStorageChoice value={storageMode} onChange={setStorageMode} disabled={uploading} />}
                    {engine === "worker" ? (
                      <p className="engine-hint gpu-device-hint" role="status">
                        <strong>{tr(health?.worker_online ? "พร้อมรับเพลงของคุณ" : "รับเพลงเข้าคิวไว้ก่อนได้")}</strong>
                        <span>{tr(health?.worker_online ? "ปิดหน้าเว็บแล้วกลับมาดูผลได้" : "เพลงจะเริ่มอัตโนมัติเมื่อระบบพร้อม")}</span>
                      </p>
                    ) : engine === "webgpu" ? (
                      <p
                        className={`engine-hint gpu-device-hint ${local.support === "unsupported" ? "gpu-unavailable" : ""}`}
                        role="status"
                      >
                        <strong>
                          {tr(
                            local.support === "checking"
                              ? "กำลังตรวจสอบ GPU ของอุปกรณ์…"
                              : local.support === "ready"
                                ? "GPU พร้อมใช้งาน · ประมวลผลบนอุปกรณ์"
                                : "อุปกรณ์นี้ยังใช้ WebGPU ไม่ได้",
                          )}
                        </strong>
                        <span>
                          {tr(
                            local.support === "unsupported"
                              ? "ลอง Chrome หรือ Edge รุ่นล่าสุดบนคอมพิวเตอร์ หรือเลือกประมวลผลบนเซิร์ฟเวอร์"
                              : "ครั้งแรกดาวน์โหลดไฟล์ AI ประมาณ 96 MB และเก็บบนอุปกรณ์ เพลงจะไม่ถูกอัปโหลดจนกว่าจะกดบันทึกเข้า cloud",
                          )}
                        </span>
                      </p>
                    ) : engine === "demucs" &&
                      health &&
                      !health.demucs_available ? (
                      <p className="engine-hint">
                        {tr("ยังไม่ติดตั้ง AI บนเครื่องนี้")}{" "}
                        <button onClick={() => setView("guide")}>
                          {tr("ดูวิธีติดตั้ง")}
                        </button>{" "}
                        {tr("หรือเลือก DSP เพื่อทดลองกรองย่านเสียง")}
                      </p>
                    ) : engine === "dsp" ? (
                      <p className="engine-hint">
                        {tr(
                          "DSP กรองความถี่และตำแหน่งเสียง อาจมีเสียงอื่นปะปน ไม่ใช่การแยกเครื่องดนตรีด้วย AI",
                        )}
                      </p>
                    ) : (
                      <p className="engine-hint">
                        {tr(
                          "ประมวลผลในพื้นที่ส่วนตัวของคุณ การใช้ครั้งแรกอาจต้องดาวน์โหลดไฟล์ที่จำเป็น",
                        )}
                      </p>
                    )}
                    {(task?.status === "failed" || task?.status === "cancelled" || task?.status === "expired" || task?.status === "expiring") && (
                      <p className="error-message" role="alert">
                        {tr(task.message)}
                      </p>
                    )}
                    <button
                      className="primary-button separate-button"
                      disabled={
                        !file ||
                        checkingFile ||
                        (engine === "webgpu"
                          ? local.support !== "ready"
                          : !available) ||
                        (engine === "demucs" && !health?.demucs_available)
                      }
                      onClick={() => void start()}
                    >
                      {checkingFile ? (
                        <LoaderCircle size={18} className="spin" />
                      ) : (
                        <Sparkles size={18} />
                      )}{" "}
                      {checkingFile
                        ? tr("กำลังตรวจสอบไฟล์")
                        : tr("แยกเสียงเพลง")}
                      <ArrowRight size={18} />
                    </button>
                    <p className="privacy-note">
                      <ShieldCheck size={14} />{" "}
                      {tr(
                        engine === "webgpu"
                          ? "ประมวลผลในเครื่อง บันทึกเข้า cloud เมื่อคุณเลือก"
                          : "เข้าถึงแทร็คได้เฉพาะบัญชีของคุณ",
                      )}
                    </p>
                    </div>
                  </section>
                </div>
              )}
              {!busy && !completed && (
                <div className="studio-bottom">
                  <section className="recent-stems panel">
                    <header><h2>{tr("งานล่าสุด")}</h2><button className="text-button" onClick={() => setView("library")}>{tr("ดูทั้งหมด")} <ArrowUpRight size={14} /></button></header>
                    {history.length ? history.slice(0, 3).map((item) => (
                      <button key={item.id} className="recent-stem" onClick={() => { setTaskId(item.id); setView("studio"); }}>
                        <span className="recent-stem-icon"><FileAudio size={18} /></span>
                        <span><strong>{item.filename}</strong><small>{tr(item.status === "completed" ? "พร้อมดาวน์โหลด" : item.status === "queued" ? "กำลังรอคิว" : item.status === "processing" ? "กำลังแยกเสียง" : item.status === "failed" ? "ไม่สำเร็จ" : item.status === "cancelled" ? "ยกเลิกแล้ว" : "หมดอายุแล้ว")}</small></span>
                        <ArrowRight size={16} />
                      </button>
                    )) : <div className="recent-empty"><AudioLines size={23} /><p>{tr("เพลงแรกของคุณ เริ่มได้จากด้านบน")}</p></div>}
                  </section>
                  <section className="workflow-card panel">
                    <span className="eyebrow">YOUR NEXT MOVE</span>
                    <h2>{tr("เตรียมพร้อมสำหรับเซ็ตถัดไป")}</h2>
                    <button onClick={() => setView("cloud")}><Cloud size={20} /><span><strong>{tr("คลังเพลงส่วนตัว")}</strong><small>{tr("ทุกเพลงของคุณ อยู่ด้วยกัน")}</small></span><ArrowUpRight size={17} /></button>
                    <button onClick={() => { setPlaylistSeed([]); setView("playlists"); }}><ListMusic size={20} /><span><strong>{tr("จัดเซ็ตและ Playlist")}</strong><small>{tr("ให้ AI ช่วยเรียงจังหวะถัดไป")}</small></span><ArrowUpRight size={17} /></button>
                  </section>
                </div>
              )}
              <div className="workspace-footer"><span>STEMORA</span><span><ShieldCheck size={13} /> {tr("พื้นที่ส่วนตัวสำหรับเสียงของคุณ")}</span></div>
            </>
          )}
          {view === "library" && health?.worker_enabled && <StemBatch onQueued={() => void refresh()} />}
          {view === "library" && (
            <section className="panel library-panel">
              <div className="section-heading">
                <FolderOpen size={21} />
                <div>
                  <h2>{tr("เพลงทั้งหมด")}</h2>
                  <p>{tr("งานทั้งหมดของบัญชีคุณ")}</p>
                </div>
                <button className="text-button" onClick={() => void refresh()}>
                  {tr("รีเฟรช")}
                </button>
              </div>
              {historyError && <p role="alert" className="batch-error">{historyError}</p>}
              {!history.length ? (
                <div className="empty-state">
                  <FolderOpen size={36} />
                  <h3>{tr("พื้นที่สำหรับเสียงของคุณ")}</h3>
                  <p>{tr("เริ่มแยกเพลงแรก แล้วกลับมามิกซ์ต่อได้ที่นี่")}</p>
                  <button className="primary-button small" onClick={newSession}>
                    {tr("ไปที่สตูดิโอ")} <ArrowRight size={16} />
                  </button>
                </div>
              ) : (
                <div className="library-list">
                  {history.map((item) => (
                    <div key={item.id} className="stem-history-row">
                    <button
                      className="library-item"
                      disabled={!!blocking && item.id !== taskId}
                      onClick={() => openTask(item)}
                    >
                      <div className="library-icon">
                        <FileAudio size={22} />
                      </div>
                      <div className="library-name">
                        <strong>{item.filename}</strong>
                        <small>
                          {new Date(item.created_at).toLocaleDateString(
                            locale === "th" ? "th-TH" : "en-US",
                            { day: "numeric", month: "short", year: "numeric" },
                          )}{" "}
                          ·{" "}
                          {item.engine === "demo"
                            ? tr("เพลงตัวอย่าง")
                            : item.engine === "dsp"
                              ? "DSP"
                              : tr("แยกเสียงด้วย AI")}{" "}
                          · {item.stems_mode === "4stems" ? 4 : 2} {tr("stems")}
                        </small>
                        <StemJobStatus task={item} compact connectionIssue={historyUnavailable} />
                      </div>
                      <span className={`task-badge ${item.status}`}>
                        {item.status === "completed" ? (
                          <CheckCircle2 size={13} />
                        ) : (
                          <Clock3 size={13} />
                        )}{" "}
                        {item.status === "completed"
                          ? tr("พร้อมมิกซ์")
                          : item.status === "cancelled"
                            ? tr("ยกเลิกแล้ว")
                          : item.status === "expired" || item.status === "expiring"
                            ? tr("หมดอายุแล้ว")
                          : item.status === "failed"
                            ? tr("ไม่สำเร็จ")
                            : item.status === "queued" ? tr("รอคิว") : tr("กำลังประมวลผล")}
                      </span>
                      <ChevronRight size={17} />
                    </button>
                    <button className="stem-history-delete" aria-label={`${locale === "th" ? "ลบงาน" : "Delete job"} ${item.filename}`} title={locale === "th" ? "ย้ายไปถังขยะ" : "Move to trash"} disabled={["queued", "processing"].includes(item.status) && item.engine !== "worker"} onClick={() => void trashTask(item)}><Trash2 size={18} /></button>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}
          {view === "guide" && (
            <div className="guide-grid">
              <section className="panel guide-panel">
                <span className="eyebrow">
                  {tr("FROM A SONG TO YOUR NEXT IDEA")}
                </span>
                <h2>{tr("สามขั้นตอน สู่เสียงที่เป็นคุณ")}</h2>
                {[
                  {
                    title: tr("เลือกเพลง"),
                    text: tr(
                      "ลากไฟล์เพลงมาวาง หรือเลือกจากเครื่อง รองรับ 6 รูปแบบ ขนาดไม่เกิน 50 MB และความยาวไม่เกิน 10 นาที",
                    ),
                  },
                  {
                    title: tr("เลือกสิ่งที่อยากแยก"),
                    text: tr(
                      "4 Stems สำหรับมิกซ์เสียงร้อง กลอง เบส และเครื่องดนตรี หรือ 2 Stems สำหรับเสียงร้องกับดนตรีประกอบ",
                    ),
                  },
                  {
                    title: tr("ฟัง ปรับ แล้วดาวน์โหลด"),
                    text: tr(
                      "กดเล่นเพื่อฟังพร้อมกัน ใช้ M ปิดเสียง และ S ฟังเฉพาะแทร็คที่เลือก ปรับความดังได้ถึง 150% คลิก waveform เพื่อเลื่อนตำแหน่ง และดาวน์โหลด WAV หรือ ZIP",
                    ),
                  },
                ].map((item, index) => (
                  <div className="guide-step" key={item.title}>
                    <span>0{index + 1}</span>
                    <div>
                      <h3>{item.title}</h3>
                      <p>{item.text}</p>
                    </div>
                  </div>
                ))}
                <button
                  className="primary-button small"
                  onClick={() => setView("studio")}
                >
                  {tr("เริ่มสร้างสรรค์")} <ArrowRight size={16} />
                </button>
              </section>
              <section className="panel guide-panel">
                <span className="eyebrow">{tr("UNDER THE HOOD")}</span>
                <h2>{tr("เลือกเครื่องมือให้เหมาะกับงาน")}</h2>
                <h3>{tr("แยกเสียงด้วย AI")}</h3>
                <p>
                  {tr(
                    "โหมด WebGPU ใช้ GPU บนอุปกรณ์ของคุณ ดาวน์โหลดไฟล์ประมวลผลครั้งแรกแล้วเก็บไว้ใช้ซ้ำ กรุณาเปิดแท็บไว้ระหว่างแยกเสียง ฟังและดาวน์โหลดได้ทันที หรือกดบันทึกเข้า cloud ภายในโควตาของบัญชี",
                  )}
                </p>
                <p>
                  {tr(
                    "แยกเสียงร้องและเครื่องดนตรีด้วย AI ผลลัพธ์ขึ้นอยู่กับต้นฉบับ การใช้งานครั้งแรกต้องเชื่อมต่ออินเทอร์เน็ตเพื่อดาวน์โหลดไฟล์ที่จำเป็น",
                  )}
                </p>
                <p>
                  {tr(
                    "เลือกความละเอียดให้เหมาะกับงาน แล้วตรวจฟังผลลัพธ์ในมิกเซอร์ ก่อนนำไปใช้งานจริง",
                  )}
                </p>
                <h3>{tr("DSP preview")}</h3>
                <p>
                  {tr(
                    "กรองย่านความถี่และตำแหน่งเสียง เหมาะสำหรับทดลองฟัง ไม่สามารถแยกเครื่องดนตรีได้เหมือน AI และไม่รับประกันการตัดเสียงร้อง",
                  )}
                </p>
                <h3>{tr("เพลงตัวอย่าง")}</h3>
                <p>
                  {tr(
                    "เพลงซินธ์สร้างขึ้นเพื่อทดลองมิกเซอร์ มีแทร็คแยกตั้งแต่ต้น ไม่ได้ผ่านการแยกด้วย AI",
                  )}
                </p>
                <h3>{tr("พื้นที่จัดเก็บ")}</h3>
                <p>
                  {tr(
                    "เพลงที่เพิ่มในคลังจะเก็บในพื้นที่ส่วนตัว และเปิดใช้งานได้หลังเข้าสู่ระบบ เพลงในถังขยะกู้คืนได้ ส่วนไฟล์ที่อัปโหลดตรงเข้าสูตรูดิโอจะใช้เพื่อแยกแทร็คและเก็บเฉพาะผลลัพธ์",
                  )}
                </p>
              </section>
            </div>
          )}
          {libraryTrackId && (
            <Modal
              title={tr("แยกเสียงจากคลังเพลง")}
              close={() => setLibraryTrackId(null)}
            >
              <div className="workspace-form">
                <label>
                  {tr("รูปแบบแทร็ค")}
                  <select
                    value={mode}
                    onChange={(e) => setMode(e.target.value)}
                  >
                    <option value="4stems">
                      {tr("เสียงร้อง กลอง เบส และดนตรี")}
                    </option>
                    <option value="2stems">
                      {tr("เสียงร้องและดนตรีประกอบ")}
                    </option>
                  </select>
                </label>
                <details className="processing-options">
                <summary>{tr("ตัวเลือกการประมวลผล")}</summary>
                <label>
                  {tr("การประมวลผล")}
                  <select
                    value={engine}
                    onChange={(e) => { engineSelected.current = true; setEngine(e.target.value); }}
                  >
                    {health?.worker_enabled && <option value="worker">{tr("แยกเสียงให้ฉัน")}</option>}
                    <option value="webgpu">
                      {tr("บนอุปกรณ์ของฉัน · WebGPU")}
                    </option>
                    <option value="demucs">
                      {tr("บนเซิร์ฟเวอร์ · AI")}
                      {health && !health.demucs_available
                        ? tr(" · ยังไม่พร้อม")
                        : ""}
                    </option>
                    <option value="dsp">{tr("กรองย่านเสียง")}</option>
                  </select>
                </label>
                </details>
                {engine === "worker" && <StemStorageChoice value={storageMode} onChange={setStorageMode} disabled={uploading} />}
                <p className="subtle-copy">
                  {engine === "webgpu"
                    ? tr(
                        "ดาวน์โหลดเพลงจากคลังมาแยกบนอุปกรณ์ ผลลัพธ์จะเก็บในเครื่องก่อน จนกว่าจะกดบันทึกเข้า cloud",
                      )
                    : engine === "worker"
                      ? tr("แยกเสียงให้อัตโนมัติ ปิดหน้าเว็บแล้วกลับมาดูผลได้")
                    : engine === "dsp"
                      ? tr("การกรองย่านเสียงอาจมีเสียงอื่นปะปน")
                      : tr("ผลลัพธ์จะบันทึกในงานแยกเสียงของบัญชีคุณ")}
                </p>
                {engine === "webgpu" && local.support !== "ready" && (
                  <p className="engine-hint" role="status">
                    {tr(
                      local.support === "checking"
                        ? "กำลังตรวจสอบ GPU ของอุปกรณ์…"
                        : "ลอง Chrome หรือ Edge รุ่นล่าสุดบนคอมพิวเตอร์ หรือเลือกประมวลผลบนเซิร์ฟเวอร์",
                    )}
                  </p>
                )}
                <button
                  className="primary-button"
                  disabled={
                    uploading ||
                    (engine === "webgpu" && local.support !== "ready") ||
                    (engine === "demucs" && !health?.demucs_available)
                  }
                  onClick={async () => {
                    setUploading(true);
                    setError("");
                    try {
                      if (engine === "webgpu") {
                        const metadata = await responseData(
                          await apiFetch(`/api/cloud/tracks/${libraryTrackId}`),
                        );
                        if (metadata.size_bytes > 50_000_000)
                          throw new Error(
                            tr("ไฟล์ใหญ่เกิน 50 MB กรุณาเลือกไฟล์ที่เล็กลง"),
                          );
                        if (metadata.duration > 600)
                          throw new Error(
                            tr(
                              "รองรับเพลงความยาวไม่เกิน 10 นาที กรุณาตัดไฟล์ก่อน",
                            ),
                          );
                        const audio = await apiFetch(
                          `/api/cloud/tracks/${libraryTrackId}/audio`,
                          { signal: AbortSignal.timeout(120000) },
                        );
                        if (!audio.ok) {
                          await responseData(audio);
                          return;
                        }
                        const source = new File(
                          [await audio.blob()],
                          metadata.filename,
                          { type: "audio/wav" },
                        );
                        setLibraryTrackId(null);
                        setTaskId(null);
                        setTask(null);
                        setView("studio");
                        localStorage.removeItem("stemora-active-task");
                        setUploading(false);
                        await local.run(source, mode);
                        return;
                      }
                      local.clear();
                      const form = new FormData();
                      form.append("stems_mode", mode);
    form.append("storage_mode", storageMode);
                      form.append("engine", engine);
                      const path = `/api/cloud/tracks/${libraryTrackId}/separate`;
                      const result = engine === "worker"
                        ? await queueSeparation(form, uploadId(JSON.stringify([libraryTrackId, mode, engine, storageMode])), setUploadProgress, path)
                        : await responseData(await apiFetch(path, {method: "POST", body: form}));
                      localStorage.removeItem(`stemora-pending-upload:${user.id}`);
                      setTask(null);
                      setTaskId(result.task_id);
                      localStorage.setItem(
                        "stemora-active-task",
                        result.task_id,
                      );
                      setLibraryTrackId(null);
                      setView("studio");
                    } catch (cause) {
                      setError((cause as Error).message);
                    } finally {
                      setUploading(false);
                    }
                  }}
                >
                  <Sparkles size={16} />{" "}
                  {uploading ? tr("กำลังเตรียมเพลง…") : tr("เริ่มแยกเสียง")}
                </button>
                {error && (
                  <div className="error-message" role="alert">
                    {tr(error)}
                  </div>
                )}
              </div>
            </Modal>
          )}
        </main>
      </div>
    </div>
  );
}
function PlayIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M5 3.5 12 8l-7 4.5z" fill="currentColor" />
    </svg>
  );
}

export default function Home() {
  return (
    <AuthBoundary>
      <Workspace />
    </AuthBoundary>
  );
}
