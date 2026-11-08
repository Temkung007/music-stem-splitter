"use client";

import { useLocale } from "@/components/locale-provider";
import { Fragment, useCallback, useEffect, useState, type FormEvent } from "react";
import {
  ChevronDown,
  ArrowDown,
  ArrowDownToLine,
  ArrowRight,
  ArrowUp,
  Check,
  Clock3,
  Copy,
  Download,
  GripVertical,
  HelpCircle,
  History,
  Laptop,
  Layers,
  ListMusic,
  LoaderCircle,
  LockKeyhole,
  Music2,
  Play,
  Plus,
  RotateCcw,
  RefreshCw,
  Save,
  Sparkles,
  Trash2,
  Unlock,
  X,
  Zap,
} from "lucide-react";
import {
  api,
  jsonRequest,
  type MusicTrack,
  type Playlist,
  type SetItem,
} from "@/lib/api";
import { formatTime } from "@/components/stem-mixer";
import { Modal, Notice } from "@/components/workspace-ui";

function getHarmonicRelation(
  key1?: string | null,
  key2?: string | null,
): { match: boolean; type?: "perfect" | "relative" | "energy" } {
  if (!key1 || !key2) return { match: false };
  const k1 = key1.trim().toUpperCase();
  const k2 = key2.trim().toUpperCase();
  if (k1 === k2) {
    return { match: true, type: "perfect" };
  }
  const match1 = k1.match(/^(\d{1,2})([AB])$/);
  const match2 = k2.match(/^(\d{1,2})([AB])$/);
  if (!match1 || !match2) return { match: false };
  const num1 = parseInt(match1[1], 10);
  const letter1 = match1[2];
  const num2 = parseInt(match2[1], 10);
  const letter2 = match2[2];

  if (num1 === num2 && letter1 !== letter2) {
    return { match: true, type: "relative" };
  }
  if (letter1 === letter2) {
    const diff = (num2 - num1 + 12) % 12;
    if (diff === 1 || diff === 11) {
      return { match: true, type: "energy" };
    }
  }
  return { match: false };
}

export function DjPlaylists({
  seed = [],
  onDirtyChange,
}: {
  seed?: string[];
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const { t: tr, locale } = useLocale();

  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [tracks, setTracks] = useState<MusicTrack[]>([]);
  const [draft, setDraft] = useState<Playlist | null>(null);
  const [dirty, setDirty] = useState(false);
  const [composer, setComposer] = useState(seed.length > 0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState(tr("My next set"));
  const [prompt, setPrompt] = useState("");
  const [minutes, setMinutes] = useState(60);
  const [profile, setProfile] = useState("build");
  const [genre, setGenre] = useState("");
  const [bpmMin, setBpmMin] = useState(30);
  const [bpmMax, setBpmMax] = useState(300);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [trash, setTrash] = useState(false);
  const [showSavedSets, setShowSavedSets] = useState(false);
  const [preview, setPreview] = useState<MusicTrack | null>(null);
  const [versions, setVersions] = useState<
    { revision: number; created_at: string }[] | null
  >(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [showSyncModal, setShowSyncModal] = useState(false);
  const [djGuideTab, setDjGuideTab] = useState<
    "serato" | "rekordbox" | "stems" | "traktor" | "cli"
  >("serato");
  const [syncToken, setSyncToken] = useState<string>("");
  const [tokenLoading, setTokenLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [desktopDetected, setDesktopDetected] = useState<boolean>(false);
  const [pairingSuccess, setPairingSuccess] = useState<boolean>(false);
  const [isPairing, setIsPairing] = useState<boolean>(false);
  const [copiedPath, setCopiedPath] = useState<string | null>(null);

  const copyPath = (text: string) => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text);
      setCopiedPath(text);
      setTimeout(() => setCopiedPath(null), 2000);
    }
  };

  const openDjHub = (
    tab: "serato" | "rekordbox" | "stems" | "traktor" | "cli" = "serato",
  ) => {
    setDjGuideTab(tab);
    void openSyncModal();
  };

  const checkDesktopApp = useCallback(async () => {
    try {
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), 1200);
      const res = await fetch("http://127.0.0.1:48231/ping", {
        mode: "cors",
        signal: controller.signal,
      });
      clearTimeout(id);
      if (res.ok) {
        setDesktopDetected(true);
        return true;
      }
    } catch {
      setDesktopDetected(false);
    }
    return false;
  }, []);

  const pairWithDesktop = async (tokenToUse?: string) => {
    const token = tokenToUse || syncToken;
    if (!token) return;
    setIsPairing(true);
    try {
      const serverUrl = typeof window !== "undefined" ? window.location.origin : "https://stemora.mydjplus.com";
      const res = await fetch("http://127.0.0.1:48231/pair", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          server_url: serverUrl,
        }),
        mode: "cors",
      });
      if (res.ok) {
        setPairingSuccess(true);
        setDesktopDetected(true);
      }
    } catch (err) {
      console.warn("Handshake with desktop app failed:", err);
    } finally {
      setIsPairing(false);
    }
  };

  const openSyncModal = async () => {
    setShowSyncModal(true);
    void checkDesktopApp();
    if (!syncToken) {
      setTokenLoading(true);
      try {
        const res = await api<{ token: string }>("/api/sync/token");
        setSyncToken(res.token);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setTokenLoading(false);
      }
    }
  };

  const rotateSyncToken = async () => {
    setTokenLoading(true);
    try {
      const res = await api<{ token: string }>(
        "/api/sync/token/rotate",
        jsonRequest("POST", {}),
      );
      setSyncToken(res.token);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setTokenLoading(false);
    }
  };

  // Auto-connect when opened from desktop browser login button (?connect=desktop or #stems)
  useEffect(() => {
    if (typeof window !== "undefined") {
      const isStemsHash = window.location.hash === "#stems";
      if (isStemsHash) {
        setDjGuideTab("stems");
      }
      const params = new URLSearchParams(window.location.search);
      if (params.get("connect") === "desktop") {
        setShowSyncModal(true);
        if (isStemsHash) {
          setDjGuideTab("stems");
        }
        void (async () => {
          setTokenLoading(true);
          try {
            const res = await api<{ token: string }>("/api/sync/token");
            setSyncToken(res.token);
            const detected = await checkDesktopApp();
            if (detected) {
              await pairWithDesktop(res.token);
            }
          } catch (err) {
            setError((err as Error).message);
          } finally {
            setTokenLoading(false);
          }
        })();
      } else {
        void checkDesktopApp();
      }
    }
  }, [checkDesktopApp]);
  useEffect(() => {
    onDirtyChange?.(dirty);
    if (!dirty) return;
    const protectDraft = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", protectDraft);
    return () => window.removeEventListener("beforeunload", protectDraft);
  }, [dirty, onDirtyChange]);
  const load = useCallback(async () => {
    try {
      const [sets, songs] = await Promise.all([
        api<Playlist[]>(`/api/playlists?trash=${trash}`),
        api<MusicTrack[]>("/api/cloud/tracks"),
      ]);
      setPlaylists(sets);
      setTracks(songs);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setLoading(false);
    }
  }, [trash]);
  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);
  const lookup = Object.fromEntries(tracks.map((t) => [t.id, t]));
  const ready = tracks.filter((t) => t.status === "ready");
  const duration =
    draft?.items.reduce(
      (sum, item) => sum + (lookup[item.track_id]?.duration || 0),
      0,
    ) || 0;
  function open(item: Playlist) {
    if (dirty) {
      setError(
        tr(
          "มีการแก้ไขที่ยังไม่บันทึก กรุณาบันทึกหรือกดย้อนค่าก่อนเปิดเซ็ตอื่น",
        ),
      );
      return;
    }
    setDraft(item);
    setName(item.name);
    setPrompt(item.prompt);
    setMinutes(item.target_minutes);
    setProfile(item.profile);
    setComposer(false);
    setDirty(false);
    setError("");
    setPreview(null);
  }
  function patchItems(items: SetItem[]) {
    if (!draft) return;
    const refreshed = items.map((item, index) => {
      const oldIndex = draft.items.findIndex(
        (previous) => previous.track_id === item.track_id,
      );
      const oldNeighbor = draft.items[oldIndex - 1]?.track_id;
      const newNeighbor = items[index - 1]?.track_id;
      return oldNeighbor !== newNeighbor &&
        (item.note.startsWith("BPM ต่าง") ||
          item.note.startsWith("BPM difference"))
        ? { ...item, note: tr("ปรับลำดับเอง · ตรวจฟังช่วงเปลี่ยนเพลง") }
        : item;
    });
    setDraft({ ...draft, items: refreshed });
    setDirty(true);
  }
  function move(from: number, to: number) {
    if (!draft || to < 0 || to >= draft.items.length) return;
    const items = [...draft.items];
    const [item] = items.splice(from, 1);
    items.splice(to, 0, item);
    patchItems(items);
  }
  async function persist() {
    if (!draft) return null;
    const result = await api<Playlist>(
      `/api/playlists/${draft.id}`,
      jsonRequest("PUT", draft),
    );
    setDraft(result);
    setDirty(false);
    await load();
    return result;
  }
  async function save() {
    setBusy(true);
    setError("");
    try {
      await persist();
      setMessage(tr("บันทึกเพลย์ลิสต์แล้ว เปิดจากอุปกรณ์อื่นได้"));
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function generate(event?: FormEvent) {
    event?.preventDefault();
    setBusy(true);
    setError("");
    try {
      const current = dirty ? await persist() : draft;
      const result = await api<Playlist>(
        "/api/playlists/compose",
        jsonRequest("POST", {
          name,
          prompt,
          target_minutes: minutes,
          profile,
          genre,
          bpm_min: bpmMin,
          bpm_max: bpmMax,
          track_ids: seed,
          playlist_id: current?.id || null,
          revision: current?.revision || null,
        }),
      );
      setDraft(result);
      setDirty(false);
      setComposer(false);
      setMessage(result.description);
      await load();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function action(path: string, method = "POST") {
    setBusy(true);
    setError("");
    try {
      const result = await api<Playlist | { ok: boolean }>(path, { method });
      if ("id" in result) {
        setDraft(result);
        setDirty(false);
      } else {
        setDraft(null);
        setDirty(false);
      }
      await load();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function createBlank() {
    setBusy(true);
    try {
      const result = await api<Playlist>(
        "/api/playlists",
        jsonRequest("POST", { name: tr("Untitled set"), items: [] }),
      );
      setDraft(result);
      setDirty(false);
      setComposer(false);
      await load();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function showVersions() {
    if (!draft) return;
    try {
      setVersions(await api(`/api/playlists/${draft.id}/versions`));
    } catch (cause) {
      setError((cause as Error).message);
    }
  }
  async function restoreVersion(revision: number) {
    if (!draft) return;
    setBusy(true);
    try {
      const result = await api<Playlist>(
        `/api/playlists/${draft.id}/versions/restore`,
        jsonRequest("POST", { version: revision, revision: draft.revision }),
      );
      setDraft(result);
      setDirty(false);
      setVersions(null);
      setMessage(tr("กู้คืนเวอร์ชันแล้ว"));
      await load();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function suggest(action: "next" | "replace", index?: number) {
    if (!draft) return;
    setBusy(true);
    setError("");
    try {
      const current = dirty ? await persist() : draft;
      if (!current) return;
      const result = await api<Playlist>(
        `/api/playlists/${current.id}/suggest`,
        jsonRequest("POST", { revision: current.revision, action, index }),
      );
      setDraft(result);
      setDirty(false);
      setMessage(
        action === "next"
          ? tr("เพิ่มเพลงแนะนำถัดไปและบันทึกแล้ว")
          : tr("สลับเป็นเพลงแนะนำและบันทึกแล้ว"),
      );
      await load();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function newSet() {
    if (dirty) {
      setError(tr("กรุณาบันทึกหรือย้อนค่าที่แก้ไขก่อนเริ่มเซ็ตใหม่"));
      return;
    }
    setDraft(null);
    setName(tr("My next set"));
    setPrompt("");
    setComposer(true);
    setError("");
  }
  return (
    <div className="playlist-workspace">
      {error && (
        <div className="error-message" role="alert">
          {tr(error)}
          <button onClick={() => setError("")}>{tr("ปิด")}</button>
        </div>
      )}
      {message && <Notice text={tr(message)} dismiss={() => setMessage("")} />}
      <div className="set-layout">
        <aside className="set-list panel">
          <div className="set-list-title">
            <h2>
              <ListMusic size={18} /> {tr("Your sets")}
            </h2>
            <div className="set-list-header-actions">
              <button
                className="icon-button"
                onClick={() => void load()}
                disabled={busy}
                title={tr("รีเฟรช")}
                aria-label={tr("รีเฟรช")}
              >
                <RefreshCw size={15} />
              </button>
              <button
                className="icon-button"
                onClick={newSet}
                aria-label={tr("สร้างเซ็ตใหม่")}
                title={tr("สร้างเซ็ตใหม่")}
                disabled={busy}
              >
                <Plus size={18} />
              </button>
              <button
                className="icon-button set-list-toggle"
                onClick={() => setShowSavedSets(!showSavedSets)}
                aria-expanded={showSavedSets}
                aria-controls="saved-sets"
                aria-label={tr("แสดงเซ็ตที่บันทึก")}
              >
                <ChevronDown size={17} />
              </button>
            </div>
          </div>
          <div id="saved-sets" className={`set-list-content ${showSavedSets ? "is-open" : ""}`}>
          <div className="library-tabs compact">
            <button
              className={!trash ? "selected" : ""}
              onClick={() => setTrash(false)}
            >
              {tr("ทั้งหมด")}
            </button>
            <button
              className={trash ? "selected" : ""}
              onClick={() => setTrash(true)}
            >
              {tr("ถังขยะ")}
            </button>
          </div>
          {loading ? (
            <p className="subtle-copy">{tr("กำลังเปิดเพลย์ลิสต์…")}</p>
          ) : playlists.length === 0 ? (
            <div className="set-list-empty">
              <Music2 size={28} />
              <p>
                {trash
                  ? tr("ยังไม่มีเซ็ตในถังขยะ")
                  : tr("เซ็ตถัดไปของคุณ เริ่มที่นี่")}
              </p>
            </div>
          ) : (
            playlists.map((item) => (
              <button
                className={`set-card ${draft?.id === item.id ? "selected" : ""}`}
                key={item.id}
                onClick={() => open(item)}
              >
                <span className="set-card-icon">
                  <ListMusic size={18} />
                </span>
                <span className="set-card-info">
                  <strong>{item.name}</strong>
                  <div className="set-card-meta">
                    <span className="set-meta-badge">{item.items.length} {tr("เพลง")}</span>
                    <span>•</span>
                    <span className="set-meta-badge">{item.target_minutes} {tr("นาที")}</span>
                  </div>
                </span>
                <ArrowRight size={14} className="set-card-arrow" />
              </button>
            ))
          )}
          <div className="set-list-actions">
            <button
              className="primary-button set-sync-main-btn"
              onClick={() => openDjHub("serato")}
              type="button"
            >
              <RefreshCw size={14} />
              <span>{tr("ซิงก์โปรแกรม DJ (Live Sync)")}</span>
            </button>
            <div className="set-quick-exports-grid">
              <a
                className="set-quick-export-btn rekordbox"
                href="/api/playlists/export/rekordbox"
                download="stemora_rekordbox_library.xml"
                title={tr("ส่งออกทุกเพลย์ลิสต์ไปยัง rekordbox XML")}
              >
                <ArrowDownToLine size={13} />
                <span>rekordbox XML</span>
              </a>
              <a
                className="set-quick-export-btn serato"
                href="/api/playlists/export/serato"
                download="stemora_serato_crates.zip"
                title={tr("ส่งออกทุกเพลย์ลิสต์ไปยัง Serato Crates")}
              >
                <ArrowDownToLine size={13} />
                <span>Serato Crates</span>
              </a>
            </div>
          </div>
          </div>
        </aside>
        <div className="set-main">
          {composer || !draft ? (
            <section className="set-builder panel">
              <div className="builder-hero">
                <span className="eyebrow">
                  <Sparkles size={14} /> {tr("YOUR NEXT GREAT SET")}
                </span>
                <h2>
                  {tr("บอกบรรยากาศ")}
                  <br />
                  <em>{tr("แล้วค้นหาจังหวะที่ใช่")}</em>
                </h2>
                <p>
                  {tr(
                    "จัดเพลงจากคลังของคุณ โดยใช้ BPM คีย์ และพลังงานเป็นตัวช่วย",
                  )}
                </p>
              </div>
              <form className="workspace-form" onSubmit={generate}>
                <label>
                  {tr("ชื่อเซ็ต")}
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    maxLength={120}
                    required
                  />
                </label>
                <label>
                  {tr("อยากให้เซ็ตนี้รู้สึกอย่างไร?")}
                  <textarea
                    rows={3}
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    maxLength={2000}
                    placeholder={tr(
                      "เช่น เซ็ต 60 นาที เริ่มอบอุ่น ค่อย ๆ เพิ่มพลัง แล้วผ่อนลงตอนปิดงาน",
                    )}
                  />
                </label>
                <div className="prompt-chips">
                  {[
                    tr("เริ่มเบาแล้วค่อยเพิ่มพลัง"),
                    tr("พลังงานขึ้นลงเป็นช่วง"),
                    tr("ลดพลังสำหรับปิดงาน"),
                  ].map((text) => (
                    <button
                      type="button"
                      className="chip"
                      key={tr(text)}
                      onClick={() => setPrompt(text)}
                    >
                      {tr(text)}
                    </button>
                  ))}
                </div>
                <div className="form-columns">
                  <label>
                    {tr("เวลาที่ต้องการ (นาที)")}
                    <input
                      type="number"
                      min={1}
                      max={480}
                      value={minutes}
                      onChange={(e) => setMinutes(Number(e.target.value))}
                      required
                    />
                  </label>
                  <label>
                    {tr("เส้นทางพลังงาน")}
                    <select
                      value={profile}
                      onChange={(e) => setProfile(e.target.value)}
                    >
                      <option value="build">{tr("ค่อย ๆ เพิ่มพลัง")}</option>
                      <option value="wave">{tr("ขึ้นแล้วผ่อนลง")}</option>
                      <option value="steady">{tr("พลังสม่ำเสมอ")}</option>
                      <option value="closing">{tr("ผ่อนลงเพื่อปิดงาน")}</option>
                    </select>
                  </label>
                </div>
                <div className="form-columns three">
                  <label>
                    {tr("แนวเพลง")}
                    <select
                      value={genre}
                      onChange={(e) => setGenre(e.target.value)}
                    >
                      <option value="">{tr("ทุกแนว")}</option>
                      {Array.from(
                        new Set(ready.map((t) => t.genre).filter(Boolean)),
                      ).map((g) => (
                        <option key={g}>{g}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    {tr("BPM ต่ำสุด")}
                    <input
                      type="number"
                      value={bpmMin}
                      min={30}
                      max={300}
                      onChange={(e) => setBpmMin(Number(e.target.value))}
                    />
                  </label>
                  <label>
                    {tr("BPM สูงสุด")}
                    <input
                      type="number"
                      value={bpmMax}
                      min={30}
                      max={300}
                      onChange={(e) => setBpmMax(Number(e.target.value))}
                    />
                  </label>
                </div>
                {seed.length > 0 && (
                  <Notice
                    text={tr("ใช้เพลงที่เลือก {0} เพลงจากคลัง", {
                      0: seed.length,
                    })}
                  />
                )}
                <div className="builder-actions">
                  <button
                    className="primary-button"
                    disabled={busy || ready.length === 0}
                  >
                    {busy ? (
                      <LoaderCircle className="spin" size={17} />
                    ) : (
                      <Sparkles size={17} />
                    )}{" "}
                    {busy ? tr("กำลังวางลำดับเพลง…") : tr("จัดเซ็ตให้ฉัน")}
                    <ArrowRight size={16} />
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={busy}
                    onClick={() => void createBlank()}
                  >
                    {tr("จัดเองจากเซ็ตว่าง")}
                  </button>
                </div>
                <p className="subtle-copy">
                  {ready.length
                    ? tr(
                        "มี {0} เพลงพร้อมจัดเซ็ต · ลำดับที่แนะนำยังปรับได้ทุกเพลง",
                        { 0: ready.length },
                      )
                    : tr("เพิ่มเพลงในคลังก่อนเริ่มจัดเซ็ต")}
                </p>
              </form>
            </section>
          ) : (
            <section className="set-editor panel">
              <header className="set-editor-heading">
                <div className="set-cover">
                  <ListMusic size={34} />
                  <span>{draft.items.length.toString().padStart(2, "0")}</span>
                </div>
                <div className="set-title">
                  <span className="eyebrow">
                    {tr("MADE FOR THE NEXT MOMENT")}
                  </span>
                  <input
                    aria-label={tr("ชื่อเพลย์ลิสต์")}
                    value={draft.name}
                    maxLength={120}
                    onChange={(e) => {
                      setDraft({ ...draft, name: e.target.value });
                      setDirty(true);
                    }}
                  />
                  <p>
                    <Clock3 size={13} /> {formatTime(duration)} ·{" "}
                    {draft.items.length} {tr("เพลง · เวอร์ชัน")}{" "}
                    {draft.revision}
                    {dirty && (
                      <span className="unsaved">{tr("ยังไม่บันทึก")}</span>
                    )}
                  </p>
                </div>
              </header>
              {draft.description && (
                <p className="set-description">{tr(draft.description)}</p>
              )}
              {trash ? (
                <div className="set-toolbar">
                  <Notice
                    text={tr("เซ็ตนี้อยู่ในถังขยะ กู้คืนเพื่อแก้ไขหรือส่งออก")}
                  />
                  <button
                    className="primary-button small"
                    onClick={() =>
                      void action(`/api/playlists/${draft.id}/restore`)
                    }
                  >
                    <RotateCcw size={15} /> {tr("กู้คืนเซ็ต")}
                  </button>
                </div>
              ) : (
                <>
                  <div className="set-toolbar">
                    <button
                      className="primary-button small"
                      disabled={busy || !dirty}
                      onClick={() => void save()}
                    >
                      <Save size={15} /> {tr("บันทึก")}
                    </button>
                    <button
                      className="secondary-button"
                      disabled={busy}
                      onClick={() => {
                        setName(draft.name);
                        setPrompt(draft.prompt);
                        setMinutes(draft.target_minutes);
                        setProfile(draft.profile);
                        setComposer(true);
                      }}
                    >
                      <Sparkles size={14} /> {tr("จัดลำดับใหม่")}
                    </button>
                    <button
                      className="icon-button"
                      aria-label={tr("ทำสำเนาเซ็ต")}
                      title={tr("ทำสำเนา")}
                      disabled={busy || dirty}
                      onClick={() =>
                        void action(`/api/playlists/${draft.id}/duplicate`)
                      }
                    >
                      <Copy size={16} />
                    </button>
                    <button
                      className="icon-button"
                      aria-label={tr("ประวัติเวอร์ชัน")}
                      title={tr("ประวัติเวอร์ชัน")}
                      disabled={busy || dirty}
                      onClick={() => void showVersions()}
                    >
                      <History size={16} />
                    </button>
                    <button
                      className="icon-button"
                      aria-label={tr("ย้ายเซ็ตไปถังขยะ")}
                      title={tr("ย้ายไปถังขยะ")}
                      disabled={busy}
                      onClick={() =>
                        void action(`/api/playlists/${draft.id}`, "DELETE")
                      }
                    >
                      <Trash2 size={16} />
                    </button>
                    {dirty && (
                      <button
                        className="text-button"
                        onClick={() => {
                          const saved = playlists.find(
                            (p) => p.id === draft.id,
                          );
                          if (saved) {
                            setDraft(saved);
                            setDirty(false);
                          }
                        }}
                      >
                        {tr("ย้อนค่าที่ยังไม่บันทึก")}
                      </button>
                    )}
                  </div>
                  <div className="set-energy">
                    <div>
                      <span className="eyebrow">{tr("ENERGY FLOW")}</span>
                      <span>
                        {tr(
                          "ความยาวรวมก่อนมิกซ์ · การซ้อนเพลงอาจทำให้เซ็ตสั้นลง",
                        )}
                      </span>
                    </div>
                    <div className="energy-bars">
                      {draft.items.map((item, i) => (
                        <button
                          key={item.track_id}
                          aria-label={tr("ฟังลำดับ {0} {1}", {
                            0: i + 1,
                            1:
                              lookup[item.track_id]?.title ||
                              tr("เพลงไม่พร้อม"),
                          })}
                          title={`${lookup[item.track_id]?.title}: ${lookup[item.track_id]?.energy ?? "—"}/100`}
                          onClick={() =>
                            setPreview(lookup[item.track_id] || null)
                          }
                        >
                          <i
                            style={{
                              height: `${Math.max(8, lookup[item.track_id]?.energy || 8)}%`,
                            }}
                          />
                          <span>{i + 1}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="set-tracks">
                    {draft.items.length === 0 && (
                      <div className="empty-state">
                        <Music2 />
                        <p>{tr("เลือกเพลงด้านล่างเพื่อเริ่มเซ็ตของคุณ")}</p>
                      </div>
                    )}
                    {draft.items.map((item, index) => {
                      const track = lookup[item.track_id];
                      const prevItem = index > 0 ? draft.items[index - 1] : null;
                      const prevTrack = prevItem ? lookup[prevItem.track_id] : null;
                      const harmonic = prevTrack
                        ? getHarmonicRelation(prevTrack?.camelot, track?.camelot)
                        : null;

                      return (
                        <Fragment key={item.track_id}>
                          {harmonic?.match && (
                            <div className={`harmonic-bridge-pill ${harmonic.type}`}>
                              <span className="harmonic-sparkle">✨</span>
                              <span className="harmonic-text">
                                {harmonic.type === "perfect" && tr("คีย์ตรงกันสมบูรณ์")}
                                {harmonic.type === "relative" && tr("สลับอารมณ์ Major/Minor")}
                                {harmonic.type === "energy" && tr("คีย์ฮาร์โมนิกสมูท")}
                              </span>
                              <span className="harmonic-keys">
                                {prevTrack?.camelot} → {track?.camelot}
                              </span>
                            </div>
                          )}
                          <article
                            className={`set-track ${item.locked ? "locked" : ""}`}
                            draggable
                            onDragStart={() => setDragIndex(index)}
                            onDragOver={(e) => e.preventDefault()}
                            onDrop={(e) => {
                              e.preventDefault();
                              if (dragIndex !== null) move(dragIndex, index);
                              setDragIndex(null);
                            }}
                          >
                            <GripVertical className="drag-handle" size={16} />
                            <span className="track-order">
                              {String(index + 1).padStart(2, "0")}
                            </span>
                            <button
                              className="song-play"
                              disabled={!track}
                              aria-label={tr("ฟังเพลงลำดับ {0}", {
                                0: index + 1,
                              })}
                              onClick={() => setPreview(track)}
                            >
                              <Play size={13} />
                            </button>
                            <div className="set-track-name">
                              <div className="set-track-header">
                                <strong>
                                  {track?.title || tr("เพลงถูกย้ายไปถังขยะ")}
                                </strong>
                                <div className="set-track-badges">
                                  {track?.camelot && (
                                    <span className="camelot-badge" title="Camelot Harmonic Key">
                                      {track.camelot}
                                    </span>
                                  )}
                                  {track?.bpm && (
                                    <span className="bpm-badge" title="Beats Per Minute">
                                      {Math.round(track.bpm)} BPM
                                    </span>
                                  )}
                                  <span className="stems-ready-pill" title={tr("4-Stems พร้อมเล่น")}>
                                    <span className="stem-dot stem-vocal" />
                                    <span className="stem-dot stem-drums" />
                                    <span className="stem-dot stem-bass" />
                                    <span className="stem-dot stem-inst" />
                                    <small>{tr("4-Stems พร้อมเล่น")}</small>
                                  </span>
                                </div>
                              </div>
                              <small className="set-track-artist">
                                {track?.artist || "—"}
                              </small>
                              <input
                                aria-label={tr("โน้ตเพลงลำดับ {0}", {
                                  0: index + 1,
                                })}
                                value={item.note}
                                maxLength={500}
                                onChange={(e) =>
                                  patchItems(
                                    draft.items.map((v, i) =>
                                      i === index
                                        ? { ...v, note: e.target.value }
                                        : v,
                                    ),
                                  )
                                }
                                placeholder={tr("จดโน้ตช่วงเปลี่ยนเพลง…")}
                              />
                            </div>
                            <div className="set-track-actions">
                            <button
                              className="icon-button"
                              aria-label={tr("แนะนำเพลงแทนลำดับ {0}", {
                                0: index + 1,
                              })}
                              title={tr("แนะนำเพลงแทน")}
                              disabled={busy || item.locked}
                              onClick={() => void suggest("replace", index)}
                            >
                              <RefreshCw size={15} />
                            </button>
                            <button
                              className={`icon-button ${item.locked ? "is-active" : ""}`}
                              onClick={() =>
                                patchItems(
                                  draft.items.map((v, i) =>
                                    i === index
                                      ? { ...v, locked: !v.locked }
                                      : v,
                                  ),
                                )
                              }
                              aria-label={tr("{0}เพลงลำดับ {1}", {
                                0: item.locked ? tr("ปลดล็อก") : tr("ล็อก"),
                                1: index + 1,
                              })}
                              aria-pressed={item.locked}
                            >
                              {item.locked ? (
                                <LockKeyhole size={15} />
                              ) : (
                                <Unlock size={15} />
                              )}
                            </button>
                            <button
                              className="icon-button"
                              aria-label={tr("เลื่อนเพลงลำดับ {0} ขึ้น", {
                                0: index + 1,
                              })}
                              disabled={index === 0}
                              onClick={() => move(index, index - 1)}
                            >
                              <ArrowUp size={15} />
                            </button>
                            <button
                              className="icon-button"
                              aria-label={tr("เลื่อนเพลงลำดับ {0} ลง", {
                                0: index + 1,
                              })}
                              disabled={index === draft.items.length - 1}
                              onClick={() => move(index, index + 1)}
                            >
                              <ArrowDown size={15} />
                            </button>
                            <button
                              className="icon-button"
                              aria-label={tr("นำเพลงลำดับ {0} ออก", {
                                0: index + 1,
                              })}
                              onClick={() =>
                                patchItems(
                                  draft.items.filter((_, i) => i !== index),
                                )
                              }
                            >
                              <X size={15} />
                            </button>
                          </div>
                        </article>
                      </Fragment>
                    );
                  })}
                  </div>
                  <div className="set-add-track">
                    <button
                      className="secondary-button next-track-button"
                      disabled={busy}
                      onClick={() => void suggest("next")}
                    >
                      <Sparkles size={15} /> {tr("แนะนำเพลงถัดไป")}
                    </button>
                    <label>
                      {tr("เพิ่มเพลงในเซ็ต")}
                      <select
                        aria-label={tr("เพิ่มเพลงในเซ็ต")}
                        value=""
                        onChange={(e) => {
                          if (e.target.value)
                            patchItems([
                              ...draft.items,
                              {
                                track_id: e.target.value,
                                locked: false,
                                note: tr("เพิ่มเอง"),
                              },
                            ]);
                        }}
                      >
                        <option value="">{tr("เลือกเพลงจากคลัง…")}</option>
                        {ready
                          .filter(
                            (t) =>
                              !draft.items.some(
                                (item) => item.track_id === t.id,
                              ),
                          )
                          .map((track) => (
                            <option key={track.id} value={track.id}>
                              {track.title} · {track.bpm || "—"} {tr("BPM")}
                            </option>
                          ))}
                      </select>
                    </label>
                  </div>
                  <footer className="set-export">
                    <div>
                      <strong>{tr("พร้อมสำหรับเวทีถัดไป")}</strong>
                      <p>
                        {tr(
                          "ZIP รวมเพลงกับ M3U8 · ส่งออกเวอร์ชันที่บันทึกแล้ว",
                        )}
                      </p>
                    </div>
                    {[
                      { key: "csv", label: "CSV" },
                      { key: "m3u", label: "M3U8" },
                      { key: "crate", label: "Serato Crate" },
                      { key: "serato_zip", label: "Serato ZIP" },
                      { key: "rekordbox", label: "rekordbox XML" },
                      { key: "rekordbox_zip", label: "rekordbox ZIP" },
                      { key: "zip", label: "ZIP รวมเพลง" },
                    ].map(({ key, label }) => (
                      <a
                        key={key}
                        className={
                          key === "rekordbox_zip" || key === "serato_zip" || key === "zip"
                            ? "primary-button small"
                            : "secondary-button"
                        }
                        aria-disabled={dirty || draft.items.length === 0}
                        onClick={(e) => {
                          if (dirty || draft.items.length === 0) {
                            e.preventDefault();
                            setError(tr("กรุณาบันทึกและเพิ่มเพลงก่อนส่งออก"));
                          }
                        }}
                        href={`/api/playlists/${draft.id}/export?format=${key}`}
                        download
                      >
                        <ArrowDownToLine size={14} />
                        {label}
                      </a>
                    ))}
                    <button
                      type="button"
                      className="icon-button"
                      title={tr("ซิงก์อัตโนมัติ (Live Sync กับโปรแกรม DJ)")}
                      aria-label={tr("ซิงก์อัตโนมัติ (Live Sync กับโปรแกรม DJ)")}
                      onClick={() => openDjHub("serato")}
                    >
                      <RefreshCw size={15} />
                    </button>
                    <button
                      type="button"
                      className="icon-button"
                      title={tr("คู่มือเชื่อมต่อโปรแกรม DJ (Serato, rekordbox, Traktor, Engine)")}
                      aria-label={tr("คู่มือเชื่อมต่อโปรแกรม DJ (Serato, rekordbox, Traktor, Engine)")}
                      onClick={() => openDjHub("serato")}
                    >
                      <HelpCircle size={15} />
                    </button>
                  </footer>
                </>
              )}
            </section>
          )}
          {preview && (
            <div className="set-preview panel">
              <Music2 size={20} />
              <strong>{preview.title}</strong>
              <audio
                key={preview.id}
                controls
                autoPlay
                src={preview.audio_url}
                aria-label={tr("พรีวิว {0}", { 0: preview.title })}
              />
              <button
                className="icon-button"
                onClick={() => setPreview(null)}
                aria-label={tr("ปิดพรีวิว")}
              >
                <X size={17} />
              </button>
            </div>
          )}
        </div>
      </div>
      {versions && draft && (
        <Modal title={tr("ประวัติเพลย์ลิสต์")} close={() => setVersions(null)}>
          {versions.length === 0 ? (
            <p className="subtle-copy">
              {tr(
                "ยังไม่มีเวอร์ชันก่อนหน้า การบันทึกครั้งถัดไปจะเก็บประวัติให้",
              )}
            </p>
          ) : (
            versions.map((version) => (
              <div className="version-row" key={version.revision}>
                <span>
                  {tr("เวอร์ชัน")} {version.revision}
                  <small>
                    {new Date(version.created_at).toLocaleString(
                      locale === "th" ? "th-TH" : "en-US",
                    )}
                  </small>
                </span>
                <button
                  className="secondary-button"
                  disabled={busy}
                  onClick={() => void restoreVersion(version.revision)}
                >
                  {tr("กู้คืน")}
                </button>
              </div>
            ))
          )}
        </Modal>
      )}
      {showSyncModal && (
        <Modal
          title={tr("ศูนย์เชื่อมต่อโปรแกรม DJ (rekordbox, Serato, Traktor, Engine)")}
          close={() => setShowSyncModal(false)}
          className="modal-sync-hub"
        >
          <div className="rekordbox-guide" id="stems">
            {/* Spotlight App Download Card */}
            <div className="desktop-app-spotlight">
              <div className="spotlight-header">
                <div className="spotlight-brand">
                  <div className="spotlight-logo">
                    <Laptop size={22} />
                  </div>
                  <div>
                    <div className="spotlight-tag">{tr("โปรแกรมเดสก์ท็อป · แนะนำ")}</div>
                    <h3>STEMORA Connect</h3>
                  </div>
                </div>
                <span className="spotlight-badge">v1.0.1 · macOS & Windows</span>
              </div>
              <p className="spotlight-desc">
                {tr(
                  "ซิงก์เพลง คีย์ Camelot, ค่า BPM และเพลย์ลิสต์ลงทั้ง rekordbox และ Serato DJ Pro บนเครื่องของคุณแบบอัตโนมัติ Real-Time จัดเซ็ตบนเว็บแล้วพร้อมเล่นบน Deck ทันที ไม่ต้องเปิด Terminal",
                )}
              </p>

              <div className="dj-supported-pills">
                <span className="dj-software-pill serato">
                  ⚡ Serato DJ Pro & Lite
                </span>
                <span className="dj-software-pill pioneer">
                  ⚡ Pioneer DJ rekordbox 6 & 7
                </span>
                <span className="dj-software-pill stems">
                  ⚡ 4-Stems Performance
                </span>
                <span className="dj-software-pill traktor">
                  ⚡ Traktor / Engine / Virtual DJ
                </span>
              </div>

              <div className="spotlight-actions">
                <a
                  href="/download/STEMORA-Connect-macOS.dmg"
                  download="STEMORA-Connect-macOS.dmg"
                  className="primary-button spotlight-dl-btn"
                >
                  <Download size={16} />
                  <span>{tr("ดาวน์โหลด STEMORA Connect (.dmg สำหรับ Mac)")}</span>
                </a>
                <a
                  href="/download/STEMORA-Connect-macOS.zip"
                  download="STEMORA-Connect-macOS.zip"
                  className="secondary-button"
                >
                  {tr("ดาวน์โหลด .zip")}
                </a>
              </div>
              <div className="spotlight-meta">
                <span>Apple Silicon & Intel</span>
                <span>•</span>
                <span>ขนาด 6.9 MB</span>
                <span>•</span>
                <span>Rust & Tauri Native</span>
              </div>
            </div>

            {/* 1-Click Desktop Pairing Highlight */}
            {pairingSuccess && (
              <div className="pairing-success-banner">
                <Check size={18} />
                <span>
                  {tr(
                    "เชื่อมต่ออัตโนมัติสำเร็จแล้ว! STEMORA Connect กำลังซิงก์เพลงลงโปรแกรม DJ",
                  )}
                </span>
              </div>
            )}

            {desktopDetected && (
              <div className="desktop-pair-highlight-card">
                <div className="pair-info">
                  <div className="pair-indicator-dot" />
                  <div>
                    <strong>{tr("ตรวจพบแอป STEMORA Connect บนเครื่องของคุณแล้ว")}</strong>
                    <small>
                      {tr(
                        "คลิกปุ่มเดียวเพื่อเชื่อมต่อบัญชีทันที ไม่ต้องคัดลอกโทเค็น",
                      )}
                    </small>
                  </div>
                </div>
                <button
                  type="button"
                  className="pair-btn"
                  onClick={() => void pairWithDesktop()}
                  disabled={isPairing || !syncToken}
                >
                  <Zap size={15} />
                  {isPairing ? tr("กำลังเชื่อมต่อ…") : tr("เชื่อมต่อเข้าแอปใน 1 คลิก")}
                </button>
              </div>
            )}

            {/* Sync Token Card */}
            <div className="sync-token-card">
              <div className="token-card-header">
                <strong>{tr("Sync Token ประจำตัวของคุณ")}</strong>
                <small>{tr("สำหรับนำไปใส่ในเมนูตั้งค่า ⚙️ ของแอป STEMORA Connect")}</small>
              </div>
              <div className="token-input-row">
                <input
                  type="text"
                  readOnly
                  value={tokenLoading ? tr("กำลังโหลดโทเค็น…") : syncToken}
                  className="token-field"
                  aria-label={tr("Sync Token")}
                />
                <button
                  type="button"
                  className="secondary-button token-copy-btn"
                  onClick={() => {
                    if (syncToken && navigator.clipboard) {
                      navigator.clipboard.writeText(syncToken);
                      setCopied(true);
                      setTimeout(() => setCopied(false), 2000);
                    }
                  }}
                  disabled={tokenLoading || !syncToken}
                >
                  {copied ? <Check size={14} /> : <Copy size={14} />}
                  {copied ? tr("คัดลอกแล้ว") : tr("คัดลอกโทเค็น")}
                </button>
              </div>
              <div className="token-card-footer">
                <button
                  type="button"
                  className="text-button"
                  onClick={() => void rotateSyncToken()}
                  disabled={tokenLoading}
                >
                  <RotateCcw size={12} /> {tr("สร้างโทเค็นใหม่")}
                </button>
              </div>
            </div>

            {/* Software Guide Tabs */}
            <div style={{ marginTop: 8 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#f8fafc", marginBottom: 6 }}>
                {tr("คู่มือวิธีนำเข้าเพลงและตั้งค่าแยกตามโปรแกรม DJ:")}
              </div>
              <div className="dj-hub-tabs">
                <button
                  type="button"
                  className={`dj-hub-tab-btn ${djGuideTab === "serato" ? "active" : ""}`}
                  onClick={() => setDjGuideTab("serato")}
                >
                  🎧 Serato DJ
                </button>
                <button
                  type="button"
                  className={`dj-hub-tab-btn ${djGuideTab === "rekordbox" ? "active" : ""}`}
                  onClick={() => setDjGuideTab("rekordbox")}
                >
                  🎛️ Pioneer rekordbox
                </button>
                <button
                  type="button"
                  className={`dj-hub-tab-btn ${djGuideTab === "stems" ? "active" : ""}`}
                  onClick={() => setDjGuideTab("stems")}
                >
                  🎚️ Stems & Decks
                </button>
                <button
                  type="button"
                  className={`dj-hub-tab-btn ${djGuideTab === "traktor" ? "active" : ""}`}
                  onClick={() => setDjGuideTab("traktor")}
                >
                  💿 Traktor & Engine
                </button>
                <button
                  type="button"
                  className={`dj-hub-tab-btn ${djGuideTab === "cli" ? "active" : ""}`}
                  onClick={() => setDjGuideTab("cli")}
                >
                  💻 Terminal / CLI
                </button>
              </div>

              {/* Tab: Serato DJ */}
              {djGuideTab === "serato" && (
                <div className="guide-steps-list">
                  <div className="guide-step">
                    <span className="step-num" style={{ background: "#38bdf8", color: "#06131c" }}>1</span>
                    <div>
                      <strong>{tr("ซิงก์ Crates อัตโนมัติด้วย STEMORA Connect (สะดวกที่สุด)")}</strong>
                      <p>
                        {tr(
                          "แอปจะสร้างไฟล์ Binary Crate ลงใน ~/Music/_Serato_/Subcrates/ ให้อัตโนมัติ เมื่อเปิด Serato DJ จะพบลังเพลง STEMORA และเพลย์ลิสต์ทันที",
                        )}
                      </p>
                    </div>
                  </div>
                  <div className="guide-step">
                    <span className="step-num" style={{ background: "#38bdf8", color: "#06131c" }}>2</span>
                    <div>
                      <strong>{tr("หรือส่งออกไฟล์ .crate ด้วยตนเอง (Manual Crate Export)")}</strong>
                      <p>
                        {tr(
                          "กดปุ่มส่งออก Serato Crate หรือ Serato ZIP ด้านล่างเพลย์ลิสต์ แล้วนำไฟล์ .crate ไปวางในโฟลเดอร์ _Serato_/Subcrates/ บนคอมพิวเตอร์ของคุณ",
                        )}
                      </p>
                      <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <code style={{ fontSize: 11, background: "rgba(0,0,0,0.4)", padding: "4px 8px", borderRadius: 4, color: "#38bdf8", fontFamily: "var(--font-mono-stem)" }}>
                          ~/Music/_Serato_/Subcrates/
                        </code>
                        <button
                          type="button"
                          className="secondary-button"
                          style={{ height: 26, fontSize: 11, padding: "0 8px" }}
                          onClick={() => copyPath("~/Music/_Serato_/Subcrates/")}
                        >
                          {copiedPath === "~/Music/_Serato_/Subcrates/" ? <Check size={12} /> : <Copy size={12} />}
                          {copiedPath === "~/Music/_Serato_/Subcrates/" ? tr("คัดลอกที่อยู่ไฟล์แล้ว") : tr("คัดลอกโฟลเดอร์ Serato")}
                        </button>
                      </div>
                    </div>
                  </div>
                  <div className="guide-step">
                    <span className="step-num" style={{ background: "#38bdf8", color: "#06131c" }}>3</span>
                    <div>
                      <strong>{tr("พร้อมเล่นสดและแยก Stems บน Deck")}</strong>
                      <p>
                        {tr(
                          "ลากเพลงลง Deck 1-4 ใน Serato DJ Pro หรือ Lite เล่นได้ทันที รองรับทั้งคีย์เพลง, BPM และแยก Stems ตามปกติ",
                        )}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Tab: Pioneer rekordbox */}
              {djGuideTab === "rekordbox" && (
                <div className="guide-steps-list">
                  <div className="guide-step">
                    <span className="step-num">1</span>
                    <div>
                      <strong>{tr("ซิงก์ XML อัตโนมัติด้วย STEMORA Connect")}</strong>
                      <p>
                        {tr(
                          "STEMORA Connect จะเปิดใช้งานระบบ rekordbox XML และเชื่อมต่อไฟล์ฐานข้อมูล rekordbox.xml ให้อัตโนมัติ 100% โดยไม่ต้องเปิด Preferences เอง",
                        )}
                      </p>
                    </div>
                  </div>
                  <div className="guide-step">
                    <span className="step-num">2</span>
                    <div>
                      <strong>{tr("หรือตั้งค่าเปิด rekordbox XML ใน Preferences")}</strong>
                      <p>
                        {tr(
                          "ไปที่ Preferences > View > Layout ติ๊กถูกที่ช่อง rekordbox xml แล้วไปที่ Preferences > Advanced > Database ในช่อง rekordbox xml ให้เลือกไฟล์ ~/Music/STEMORA/rekordbox.xml",
                        )}
                      </p>
                      <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <code style={{ fontSize: 11, background: "rgba(0,0,0,0.4)", padding: "4px 8px", borderRadius: 4, color: "var(--lime)", fontFamily: "var(--font-mono-stem)" }}>
                          ~/Music/STEMORA/rekordbox.xml
                        </code>
                        <button
                          type="button"
                          className="secondary-button"
                          style={{ height: 26, fontSize: 11, padding: "0 8px" }}
                          onClick={() => copyPath("~/Music/STEMORA/rekordbox.xml")}
                        >
                          {copiedPath === "~/Music/STEMORA/rekordbox.xml" ? <Check size={12} /> : <Copy size={12} />}
                          {copiedPath === "~/Music/STEMORA/rekordbox.xml" ? tr("คัดลอกที่อยู่ไฟล์แล้ว") : tr("คัดลอกไฟล์ rekordbox XML")}
                        </button>
                      </div>
                    </div>
                  </div>
                  <div className="guide-step">
                    <span className="step-num">3</span>
                    <div>
                      <strong>{tr("พร้อมเล่นบน Controller และ Sync ลง USB สำหรับ CDJ")}</strong>
                      <p>
                        {tr(
                          "ในแถบซ้ายมือของ rekordbox หมวด rekordbox xml > STEMORA จะแสดงเพลย์ลิสต์พร้อมค่า BPM, Camelot Key สามารถลากลง Deck หรือกด Sync ไปยัง USB เพื่อเล่นกับ CDJ ได้ทันที",
                        )}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Tab: 4-Stems Performance */}
              {djGuideTab === "stems" && (
                <div className="guide-steps-list">
                  <div className="guide-step">
                    <span className="step-num" style={{ background: "#22d3ee", color: "#082f49" }}>1</span>
                    <div>
                      <strong>{tr("การควบคุม 4-Stems สดบน Deck (Live Stems Mixing)")}</strong>
                      <p>
                        {tr(
                          "เพลงที่ประมวลผลผ่าน STEMORA พร้อมแยกชิ้นดนตรี Vocals, Drums, Bass, Melodic บน Deck ใน Serato DJ Pro และ rekordbox ได้อย่างคมชัด ไร้เสียงรบกวน",
                        )}
                      </p>
                    </div>
                  </div>
                  <div className="guide-step">
                    <span className="step-num" style={{ background: "#22d3ee", color: "#082f49" }}>2</span>
                    <div>
                      <strong>{tr("Serato DJ Pro Stems Pad Mapping")}</strong>
                      <p>
                        {tr(
                          "รองรับปุ่มกด Performance Pad หมวด Stems 4 ปุ่ม (Vocal, Melody, Bass, Drums) 100% พร้อมแยก Crates ย่อยสำหรับ Acapella และ Instrumental อัตโนมัติ",
                        )}
                      </p>
                    </div>
                  </div>
                  <div className="guide-step">
                    <span className="step-num" style={{ background: "#22d3ee", color: "#082f49" }}>3</span>
                    <div>
                      <strong>{tr("Pioneer DJ Track Separation & Camelot Key")}</strong>
                      <p>
                        {tr(
                          "รองรับปุ่ม Track Separation บนคอนโทรลเลอร์ Pioneer DDJ/FLX พร้อมค่า Camelot Key และ BPM ที่วิเคราะห์แม่นยำ ช่วยให้การมิกซ์ข้ามคีย์และการสลับเสียงร้องเข้ากับบีตอื่นสมบูรณ์แบบ",
                        )}
                      </p>
                    </div>
                  </div>
                  <div className="guide-step">
                    <span className="step-num" style={{ background: "#22d3ee", color: "#082f49" }}>4</span>
                    <div>
                      <strong>{tr("ส่งออกไฟล์แยก 4 Stems (WAV Lossless 24-bit)")}</strong>
                      <p>
                        {tr(
                          "ดาวน์โหลดชุดไฟล์แยกแทร็ก Vocals, Drums, Bass, Other คุณภาพสตูดิโอ นำไปโหลดใส่ 4 แชนเนลเพื่อสลับชิ้นดนตรีสด หรือใช้ทำ Mashup / Edit ใน DAW ได้ทันที",
                        )}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Tab: Traktor & Engine */}
              {djGuideTab === "traktor" && (
                <div className="guide-steps-list">
                  <div className="guide-step">
                    <span className="step-num" style={{ background: "#fb923c", color: "#1c0d02" }}>1</span>
                    <div>
                      <strong>{tr("ส่งออกเพลย์ลิสต์มาตรฐานสากล M3U8 หรือ ZIP")}</strong>
                      <p>
                        {tr(
                          "กดปุ่มส่งออก M3U8 หรือ ZIP รวมเพลง ที่แถบส่งออกด้านล่าง เพลงทั้งหมดจะถูกจัดเรียงตามลำดับ คีย์ Camelot และค่า BPM ที่คุณจัดไว้",
                        )}
                      </p>
                    </div>
                  </div>
                  <div className="guide-step">
                    <span className="step-num" style={{ background: "#fb923c", color: "#1c0d02" }}>2</span>
                    <div>
                      <strong>{tr("ลากไฟล์เข้า Traktor, Denon Engine DJ หรือ Virtual DJ")}</strong>
                      <p>
                        {tr(
                          "เปิดโปรแกรม DJ ของคุณ แล้วลากไฟล์ .m3u8 หรือโฟลเดอร์เพลงเข้าไปยังแถบ Playlists / Crates โปรแกรมจะนำเข้าเพลงพร้อมเล่นทันที",
                        )}
                      </p>
                    </div>
                  </div>
                  <div className="guide-step">
                    <span className="step-num" style={{ background: "#fb923c", color: "#1c0d02" }}>3</span>
                    <div>
                      <strong>{tr("คุณภาพเสียงระดับ Lossless WAV")}</strong>
                      <p>
                        {tr(
                          "ไฟล์เสียงที่ดาวน์โหลดเป็นไฟล์ Lossless 16/24-bit คุณภาพสูงระดับสตูดิโอ ไร้การบีบอัดสัญญาณ เหมาะสำหรับการเล่นสดในคลับหรือเฟสติวัล",
                        )}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Tab: Terminal / CLI */}
              {djGuideTab === "cli" && (
                <div className="guide-steps-list">
                  <div className="guide-step">
                    <span className="step-num" style={{ background: "#a855f7", color: "#170426" }}>1</span>
                    <div>
                      <strong>{tr("รัน Live Sync Agent ผ่าน Terminal (Linux / Server)")}</strong>
                      <p>
                        {tr(
                          "คัดลอกคำสั่งด้านล่างไปวางใน Terminal เพื่อให้ Python script ซิงก์เพลงและอัปเดตโฟลเดอร์ ~/Music/STEMORA อัตโนมัติแบบ Background",
                        )}
                      </p>
                      <div className="sync-command-box" style={{ marginTop: 8 }}>
                        <div className="command-row">
                          <code>
                            {tokenLoading
                              ? tr("กำลังโหลดโทเค็น…")
                              : `curl -fsSL ${typeof window !== "undefined" ? window.location.origin : "https://stemora.mydjplus.com"}/api/sync/agent.py | python3 - --token=${syncToken || "..."} --watch`}
                          </code>
                          <button
                            type="button"
                            className="secondary-button"
                            onClick={() => {
                              const cmd = `curl -fsSL ${typeof window !== "undefined" ? window.location.origin : "https://stemora.mydjplus.com"}/api/sync/agent.py | python3 - --token=${syncToken} --watch`;
                              if (navigator.clipboard) {
                                navigator.clipboard.writeText(cmd);
                                setCopied(true);
                                setTimeout(() => setCopied(false), 2000);
                              }
                            }}
                            disabled={tokenLoading || !syncToken}
                          >
                            {copied ? <Check size={14} /> : <Copy size={14} />}
                            {copied ? tr("คัดลอกแล้ว") : tr("คัดลอกคำสั่ง")}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
