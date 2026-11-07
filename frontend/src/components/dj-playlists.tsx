"use client";

import { useLocale } from "@/components/locale-provider";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  ChevronDown,
  ArrowDown,
  ArrowDownToLine,
  ArrowRight,
  ArrowUp,
  Clock3,
  Copy,
  GripVertical,
  HelpCircle,
  History,
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
  const [showRekordboxGuide, setShowRekordboxGuide] = useState(false);
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
            <button className="icon-button set-list-toggle" onClick={() => setShowSavedSets(!showSavedSets)} aria-expanded={showSavedSets} aria-controls="saved-sets" aria-label={tr("แสดงเซ็ตที่บันทึก")}><ChevronDown size={17} /></button>
            <button
              className="icon-button"
              onClick={newSet}
              aria-label={tr("สร้างเซ็ตใหม่")}
              disabled={busy}
            >
              <Plus size={18} />
            </button>
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
                <span>
                  <strong>{item.name}</strong>
                  <small>
                    {item.items.length} {tr("เพลง · เป้าหมาย")}{" "}
                    {item.target_minutes} {tr("นาที")}
                  </small>
                </span>
                <ArrowRight size={14} />
              </button>
            ))
          )}
          <div className="set-list-actions">
            <button
              className="secondary-button"
              onClick={() => void load()}
              disabled={busy}
            >
              {tr("รีเฟรชรายการ")}
            </button>
            <a
              className="secondary-button"
              href="/api/playlists/export/rekordbox"
              download="stemora_rekordbox_library.xml"
              title={tr("ส่งออกทุกเพลย์ลิสต์ไปยัง rekordbox XML")}
            >
              <ArrowDownToLine size={14} />
              {tr("ส่งออกคลัง rekordbox")}
            </a>
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
                      return (
                        <article
                          key={item.track_id}
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
                            <strong>
                              {track?.title || tr("เพลงถูกย้ายไปถังขยะ")}
                            </strong>
                            <small>
                              {track?.artist || "—"} · {track?.bpm || "—"}{" "}
                              {tr("BPM ·")} {track?.camelot || "—"}
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
                      { key: "zip", label: "ZIP" },
                      { key: "rekordbox", label: "rekordbox XML" },
                      { key: "rekordbox_zip", label: "rekordbox ZIP" },
                    ].map(({ key, label }) => (
                      <a
                        key={key}
                        className={
                          key === "rekordbox_zip" || key === "zip"
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
                      title={tr("วิธีเชื่อมต่อกับ rekordbox")}
                      aria-label={tr("วิธีเชื่อมต่อกับ rekordbox")}
                      onClick={() => setShowRekordboxGuide(true)}
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
      {showRekordboxGuide && (
        <Modal
          title={tr("วิธีเชื่อมต่อเพลย์ลิสต์กับ Pioneer DJ rekordbox")}
          close={() => setShowRekordboxGuide(false)}
        >
          <div className="rekordbox-guide">
            <div className="guide-step">
              <span className="step-num">1</span>
              <div>
                <strong>{tr("เปิดเมนู rekordbox XML ในการตั้งค่า")}</strong>
                <p>
                  {tr(
                    "เปิด rekordbox เข้าไปที่ Preferences (การตั้งค่า) > View (มุมมอง) > Layout แล้วติ๊กถูกที่ช่อง rekordbox xml",
                  )}
                </p>
              </div>
            </div>
            <div className="guide-step">
              <span className="step-num">2</span>
              <div>
                <strong>{tr("เลือกไฟล์ XML จาก STEMORA")}</strong>
                <p>
                  {tr(
                    "ไปที่ Preferences > Advanced (ขั้นสูง) > Database (ฐานข้อมูล) ในหัวข้อ rekordbox xml ให้กด Browse แล้วเลือกไฟล์ .xml ที่ดาวน์โหลดจาก STEMORA",
                  )}
                </p>
              </div>
            </div>
            <div className="guide-step">
              <span className="step-num">3</span>
              <div>
                <strong>
                  {tr("นำเข้าเพลงพร้อมเล่นบน CDJ / Controller")}
                </strong>
                <p>
                  {tr(
                    "ในแถบซ้ายของ rekordbox ให้เปิดหมวด rekordbox xml > STEMORA จะพบเพลย์ลิสต์พร้อมค่า BPM, Camelot Key, และ Cue Marker สามารถลากลง Deck หรือกด Import to Collection / Sync ไปยัง USB เพื่อเล่นกับ CDJ ได้ทันที",
                  )}
                </p>
              </div>
            </div>
            <div className="guide-note">
              <small>
                {tr(
                  "💡 หมายเหตุ: CloudDirectPlay ของ AlphaTheta เป็นระบบคลาวด์ปิดของ Pioneer DJ โดยเฉพาะ แต่การใช้ rekordbox XML Bridge เป็นวิธีมาตรฐานของ DJ สากลที่นำเข้าเพลง คีย์ และ Beatgrid ได้สมบูรณ์ที่สุด",
                )}
              </small>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
