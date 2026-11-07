"use client";

import { useLocale } from "@/components/locale-provider";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  ArrowDownToLine,
  AudioLines,
  Cloud,
  FileAudio,
  Headphones,
  LoaderCircle,
  Pencil,
  Play,
  Plus,
  RotateCcw,
  Search,
  Sparkles,
  Trash2,
  Upload,
} from "lucide-react";
import {
  api,
  fileSize,
  jsonRequest,
  type MusicTrack,
  type WorkspaceSummary,
} from "@/lib/api";
import { formatTime, Waveform } from "@/components/stem-mixer";
import { Modal, Notice } from "@/components/workspace-ui";

export function MusicLibrary({
  onSeparate,
  onPlaylist,
}: {
  onSeparate: (id: string) => void;
  onPlaylist: (ids: string[]) => void;
}) {
  const { t: tr } = useLocale();

  const [tracks, setTracks] = useState<MusicTrack[]>([]);
  const [summary, setSummary] = useState<WorkspaceSummary | null>(null);
  const [query, setQuery] = useState("");
  const [genre, setGenre] = useState("");
  const [bpm, setBpm] = useState("");
  const [trash, setTrash] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [editing, setEditing] = useState<MusicTrack | null>(null);
  const [playing, setPlaying] = useState<MusicTrack | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const load = useCallback(async () => {
    try {
      const [songs, stats] = await Promise.all([
        api<MusicTrack[]>(`/api/cloud/tracks?trash=${trash}`),
        api<WorkspaceSummary>("/api/cloud/summary"),
      ]);
      setTracks(songs);
      setSummary(stats);
      setLoadError("");
    } catch (cause) {
      setLoadError((cause as Error).message);
    } finally {
      setLoading(false);
    }
  }, [trash]);
  useEffect(() => {
    const init = setTimeout(() => void load(), 0);
    const interval = setInterval(() => void load(), 5000);
    return () => {
      clearTimeout(init);
      clearInterval(interval);
    };
  }, [load]);
  async function upload(files: FileList | File[] | null) {
    if (!files?.length || busy) return;
    setBusy(true);
    setError("");
    let count = 0;
    try {
      for (const file of Array.from(files)) {
        if (
          !/\.(mp3|wav|flac|m4a|aac|ogg)$/i.test(file.name) ||
          file.size > 100_000_000
        ) {
          throw new Error(
            tr("{0}: รองรับไฟล์เสียงไม่เกิน 100 MB", { 0: file.name }),
          );
        }
        const form = new FormData();
        form.append("file", file);
        await api("/api/cloud/tracks", { method: "POST", body: form });
        count++;
        setMessage(
          tr("อัปโหลดแล้ว {0}/{1} เพลง กำลังวิเคราะห์เสียง…", {
            0: count,
            1: files.length,
          }),
        );
      }
      await load();
    } catch (cause) {
      setError((cause as Error).message);
      await load();
    } finally {
      setBusy(false);
    }
  }
  async function action(path: string, method = "POST") {
    setError("");
    try {
      await api(path, { method });
      setMessage(trash ? tr("กู้คืนเพลงแล้ว") : tr("บันทึกการเปลี่ยนแปลงแล้ว"));
      await load();
    } catch (cause) {
      setError((cause as Error).message);
    }
  }
  async function demo() {
    setBusy(true);
    setError("");
    try {
      await api("/api/cloud/demo", { method: "POST" });
      setMessage(
        tr("เพิ่มเพลงตัวอย่างสังเคราะห์แล้ว กำลังวิเคราะห์เพื่อเตรียมจัดเซ็ต"),
      );
      await load();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const visible = tracks.filter(
    (t) =>
      `${t.title} ${t.artist} ${t.genre} ${t.tags.join(" ")}`
        .toLowerCase()
        .includes(query.toLowerCase()) &&
      (!genre || t.genre === genre) &&
      (!bpm ||
        (t.bpm !== null &&
          (bpm === "slow"
            ? t.bpm < 110
            : bpm === "mid"
              ? t.bpm >= 110 && t.bpm < 125
              : t.bpm >= 125))),
  );
  const active = tracks.filter((t) =>
    ["queued", "analyzing"].includes(t.status),
  ).length;
  return (
    <div className="cloud-workspace">
      {(error || loadError) && (
        <div className="error-message" role="alert">
          {error || loadError}
          <button
            onClick={() => {
              setError("");
              setLoadError("");
            }}
          >
            {tr("ปิด")}
          </button>
        </div>
      )}
      {message && <Notice text={tr(message)} dismiss={() => setMessage("")} />}
      <div className="workspace-stats">
        <div>
          <span>
            <FileAudio size={16} /> {tr("เพลงพร้อมใช้")}
          </span>
          <strong>
            {summary?.ready || 0}
            <small> {tr("เพลง")}</small>
          </strong>
        </div>
        <div>
          <span>
            <AudioLines size={16} /> {tr("รอวิเคราะห์")}
          </span>
          <strong>
            {active}
            <small> {tr("เพลง")}</small>
          </strong>
        </div>
        <div>
          <span>
            <Cloud size={16} /> {tr("พื้นที่จัดเก็บ")}
          </span>
          <strong>{fileSize(summary?.used_bytes || 0)}</strong>
          <progress
            max={summary?.quota_bytes || 1}
            value={summary?.used_bytes || 0}
          />
          <small>
            {tr("จาก")} {fileSize(summary?.quota_bytes || 0)}
          </small>
        </div>
      </div>
      <section
        className="cloud-upload panel"
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void upload(e.dataTransfer.files);
        }}
        data-dragging={dragging}
      >
        <div className="cloud-upload-icon">
          <Upload size={23} />
        </div>
        <div>
          <h2>{tr("เพลงของคุณ พร้อมทุกเซ็ต")}</h2>
          <p>
            {tr(
              "ลากเพลงมาวาง หรือเพิ่มหลายไฟล์พร้อมกัน · สูงสุด 100 MB / เพลง",
            )}
          </p>
        </div>
        <input
          ref={input}
          className="visually-hidden"
          type="file"
          multiple
          accept=".mp3,.wav,.flac,.m4a,.aac,.ogg"
          onChange={(e) => {
            void upload(e.target.files);
            e.target.value = "";
          }}
        />
        <button
          className="primary-button small"
          onClick={() => input.current?.click()}
          disabled={busy}
        >
          {busy ? (
            <LoaderCircle size={16} className="spin" />
          ) : (
            <Plus size={16} />
          )}{" "}
          {tr("เพิ่มเพลง")}
        </button>
      </section>
      <section className="panel music-table-panel">
        <div className="library-tools">
          <div className="library-tabs">
            <button
              className={!trash ? "selected" : ""}
              onClick={() => {
                setTrash(false);
                setSelected([]);
              }}
            >
              {tr("คลังเพลง")}
            </button>
            <button
              className={trash ? "selected" : ""}
              onClick={() => {
                setTrash(true);
                setSelected([]);
              }}
            >
              <Trash2 size={14} /> {tr("ถังขยะ")}
            </button>
          </div>
          <button className="text-button" onClick={() => void load()}>
            {tr("รีเฟรช")}
          </button>
        </div>
        <div className="library-filters">
          <label className="search-field">
            <Search size={16} />
            <input
              placeholder={tr("ค้นหาเพลง ศิลปิน หรือแท็ก")}
              aria-label={tr("ค้นหาเพลง")}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <select
            aria-label={tr("กรองแนวเพลง")}
            value={genre}
            onChange={(e) => setGenre(e.target.value)}
          >
            <option value="">{tr("ทุกแนวเพลง")}</option>
            {Array.from(
              new Set(tracks.map((t) => t.genre).filter(Boolean)),
            ).map((g) => (
              <option key={g}>{g}</option>
            ))}
          </select>
          <select
            aria-label={tr("กรอง BPM")}
            value={bpm}
            onChange={(e) => setBpm(e.target.value)}
          >
            <option value="">{tr("ทุก BPM")}</option>
            <option value="slow">{tr("ต่ำกว่า 110")}</option>
            <option value="mid">110–124</option>
            <option value="fast">{tr("125 ขึ้นไป")}</option>
          </select>
        </div>
        {selected.length > 0 && !trash && (
          <div className="selection-bar">
            <span>
              {tr("เลือก")} {selected.length} {tr("เพลง")}
            </span>
            <button
              className="primary-button small"
              onClick={() => onPlaylist(selected)}
            >
              <Sparkles size={15} /> {tr("จัดเซ็ตจากเพลงที่เลือก")}
            </button>
            <button className="text-button" onClick={() => setSelected([])}>
              {tr("ยกเลิก")}
            </button>
          </div>
        )}
        {loading ? (
          <div className="empty-state">
            <LoaderCircle className="spin" /> {tr("กำลังเปิดคลังเพลง…")}
          </div>
        ) : visible.length === 0 ? (
          <div className="empty-state">
            <Headphones size={38} />
            <h3>
              {trash
                ? tr("ยังไม่มีเพลงในถังขยะ")
                : tracks.length
                  ? tr("ไม่พบเพลงที่ค้นหา")
                  : tr("เริ่มสะสมเสียงในแบบของคุณ")}
            </h3>
            <p>
              {trash
                ? tr(
                    "เพลงที่ย้ายมาที่นี่สามารถกู้คืนได้ และยังนับพื้นที่จัดเก็บ",
                  )
                : tr("เพิ่มเพลงของคุณ หรือทดลองด้วยเพลงสังเคราะห์ 6 เพลง")}
            </p>
            {!trash && tracks.length === 0 && (
              <button
                className="secondary-button"
                disabled={busy}
                onClick={() => void demo()}
              >
                <Play size={15} /> {tr("เพิ่มเพลงตัวอย่าง")}
              </button>
            )}
          </div>
        ) : (
          <div className="music-table-scroll">
            <table className="music-table">
              <thead>
                <tr>
                  <th>
                    <input
                      type="checkbox"
                      aria-label={tr("เลือกทุกเพลงที่พร้อม")}
                      checked={
                        visible.filter((t) => t.status === "ready").length >
                          0 &&
                        visible
                          .filter((t) => t.status === "ready")
                          .every((t) => selected.includes(t.id))
                      }
                      onChange={(e) =>
                        setSelected(
                          e.target.checked
                            ? visible
                                .filter((t) => t.status === "ready")
                                .map((t) => t.id)
                            : [],
                        )
                      }
                    />
                  </th>
                  <th>{tr("เพลง / ศิลปิน")}</th>
                  <th>{tr("BPM")}</th>
                  <th>{tr("KEY")}</th>
                  <th>{tr("ENERGY")}</th>
                  <th>{tr("เวลา")}</th>
                  <th>{tr("จัดการ")}</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((track) => (
                  <tr key={track.id}>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={tr("เลือก {0}", { 0: track.title })}
                        disabled={track.status !== "ready" || trash}
                        checked={selected.includes(track.id)}
                        onChange={(e) =>
                          setSelected((old) =>
                            e.target.checked
                              ? [...old, track.id]
                              : old.filter((id) => id !== track.id),
                          )
                        }
                      />
                    </td>
                    <td>
                      <div className="song-identity">
                        <button
                          className="song-play"
                          disabled={trash || track.status !== "ready"}
                          onClick={() => setPlaying(track)}
                          aria-label={tr("ฟัง {0}", { 0: track.title })}
                        >
                          <Play size={15} />
                        </button>
                        <div>
                          <strong>{track.title}</strong>
                          <small>
                            {track.artist || tr("ยังไม่ระบุศิลปิน")}
                            {track.genre ? ` · ${track.genre}` : ""}
                          </small>
                          {track.status !== "ready" && (
                            <span className={`analysis-badge ${track.status}`}>
                              {track.status === "failed"
                                ? tr(track.message)
                                : track.status === "analyzing"
                                  ? tr("กำลังวิเคราะห์เสียง")
                                  : tr("รอวิเคราะห์")}
                            </span>
                          )}
                          {track.tags.length > 0 && (
                            <div className="song-tags">
                              {track.tags.map((tag) => (
                                <span key={tag}>{tag}</span>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="numeric">{track.bpm || "—"}</td>
                    <td>
                      <span className="key-tag">{track.camelot || "—"}</span>
                      <small className="key-detail">
                        {track.musical_key || tr("รอระบุ")}
                      </small>
                    </td>
                    <td>
                      <div className="energy-meter">
                        <i style={{ width: `${track.energy || 0}%` }} />
                      </div>
                      <small>{track.energy ?? "—"}/100</small>
                    </td>
                    <td className="numeric">{formatTime(track.duration)}</td>
                    <td>
                      <div className="song-actions">
                        {trash ? (
                          <button
                            className="icon-button"
                            title={tr("กู้คืนเพลง")}
                            aria-label={tr("กู้คืน {0}", { 0: track.title })}
                            onClick={() =>
                              void action(
                                `/api/cloud/tracks/${track.id}/restore`,
                              )
                            }
                          >
                            <RotateCcw size={16} />
                          </button>
                        ) : (
                          <>
                            <button
                              className="icon-button"
                              aria-label={tr("แก้ไข {0}", { 0: track.title })}
                              title={tr("แก้ไขข้อมูลเพลง")}
                              onClick={() => setEditing(track)}
                              disabled={track.status !== "ready"}
                            >
                              <Pencil size={15} />
                            </button>
                            <button
                              className="icon-button"
                              aria-label={tr("แยกเสียง {0}", {
                                0: track.title,
                              })}
                              title={tr("เปิดสตูดิโอแยกเสียง")}
                              onClick={() => onSeparate(track.id)}
                              disabled={track.status !== "ready"}
                            >
                              <AudioLines size={16} />
                            </button>
                            <a
                              className="icon-button"
                              href={`${track.audio_url}?download=true`}
                              download
                              aria-label={tr("ดาวน์โหลด {0}", {
                                0: track.title,
                              })}
                            >
                              <ArrowDownToLine size={15} />
                            </a>
                            {track.status === "failed" && (
                              <button
                                className="icon-button"
                                aria-label={tr("วิเคราะห์ใหม่ {0}", {
                                  0: track.title,
                                })}
                                onClick={() =>
                                  void action(
                                    `/api/cloud/tracks/${track.id}/analyze`,
                                  )
                                }
                              >
                                <RotateCcw size={15} />
                              </button>
                            )}
                            <button
                              className="icon-button"
                              aria-label={tr("ย้าย {0} ไปถังขยะ", {
                                0: track.title,
                              })}
                              disabled={
                                track.status === "queued" ||
                                track.status === "analyzing"
                              }
                              onClick={() => {
                                if (playing?.id === track.id) setPlaying(null);
                                setSelected((old) =>
                                  old.filter((id) => id !== track.id),
                                );
                                void action(
                                  `/api/cloud/tracks/${track.id}`,
                                  "DELETE",
                                );
                              }}
                            >
                              <Trash2 size={15} />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="table-footnote">
          {tr(
            "BPM คีย์ และพลังงานเป็นค่าประมาณ · ฟังตรวจสอบและแก้ไขก่อนใช้แสดงจริง",
          )}
        </div>
      </section>
      {playing && (
        <section className="library-player panel">
          <div>
            <span className="eyebrow">{tr("NOW PREVIEWING")}</span>
            <strong>{playing.title}</strong>
            <small>{playing.artist || tr("Your private library")}</small>
          </div>
          <div className="library-player-wave">
            <Waveform peaks={playing.peaks} />
          </div>
          <audio
            key={playing.id}
            src={playing.audio_url}
            controls
            autoPlay
            aria-label={tr("เล่น {0}", { 0: playing.title })}
          />
          <button className="text-button" onClick={() => setPlaying(null)}>
            {tr("ปิด")}
          </button>
        </section>
      )}
      {editing && (
        <TrackEditor
          track={editing}
          close={() => setEditing(null)}
          saved={() => {
            setEditing(null);
            void load();
          }}
        />
      )}
    </div>
  );
}
function TrackEditor({
  track,
  close,
  saved,
}: {
  track: MusicTrack;
  close: () => void;
  saved: () => void;
}) {
  const { t: tr } = useLocale();

  const [title, setTitle] = useState(track.title);
  const [artist, setArtist] = useState(track.artist);
  const [genre, setGenre] = useState(track.genre);
  const [tags, setTags] = useState(track.tags.join(", "));
  const [bpm, setBpm] = useState(track.bpm?.toString() || "");
  const [key, setKey] = useState(track.musical_key || "");
  const [energy, setEnergy] = useState(track.energy ?? 50);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api(
        `/api/cloud/tracks/${track.id}`,
        jsonRequest("PATCH", {
          title,
          artist,
          genre,
          tags: tags
            .split(",")
            .map((v) => v.trim())
            .filter(Boolean),
          bpm: bpm ? Number(bpm) : null,
          musical_key: key || null,
          energy,
        }),
      );
      saved();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={tr("ปรับข้อมูลเพลง")} close={close}>
      <form className="workspace-form" onSubmit={submit}>
        <label>
          {tr("ชื่อเพลง")}
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            maxLength={200}
          />
        </label>
        <div className="form-columns">
          <label>
            {tr("ศิลปิน")}
            <input
              value={artist}
              onChange={(e) => setArtist(e.target.value)}
              maxLength={120}
            />
          </label>
          <label>
            {tr("แนวเพลง")}
            <input
              value={genre}
              onChange={(e) => setGenre(e.target.value)}
              maxLength={60}
              placeholder={tr("เช่น House")}
            />
          </label>
        </div>
        <div className="form-columns">
          <label>
            {tr("BPM")}
            <input
              type="number"
              value={bpm}
              onChange={(e) => setBpm(e.target.value)}
              min={30}
              max={300}
              step="0.1"
            />
          </label>
          <label>
            {tr("คีย์")}
            <select value={key} onChange={(e) => setKey(e.target.value)}>
              <option value="">{tr("ยังไม่ระบุ")}</option>
              {[
                "C",
                "C#",
                "D",
                "D#",
                "E",
                "F",
                "F#",
                "G",
                "G#",
                "A",
                "A#",
                "B",
              ].flatMap((note) =>
                ["major", "minor"].map((mode) => (
                  <option key={`${note} ${mode}`}>
                    {note} {mode}
                  </option>
                )),
              )}
            </select>
          </label>
        </div>
        <label>
          {tr("พลังงาน")} {energy}/100
          <input
            type="range"
            min={0}
            max={100}
            value={energy}
            onChange={(e) => setEnergy(Number(e.target.value))}
          />
        </label>
        <label>
          {tr("แท็ก (คั่นด้วยจุลภาค)")}
          <input
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            placeholder={tr("warmup, sunset, favorite")}
            maxLength={600}
          />
        </label>
        {error && (
          <div className="error-message" role="alert">
            {tr(error)}
          </div>
        )}
        <div className="modal-actions">
          <button type="button" className="secondary-button" onClick={close}>
            {tr("ยกเลิก")}
          </button>
          <button className="primary-button small" disabled={busy}>
            {tr("บันทึกข้อมูล")}
          </button>
        </div>
      </form>
    </Modal>
  );
}
