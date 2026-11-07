"use client";
import { stemDownloadName } from "@/lib/stem-filenames";

import { useLocale } from "@/components/locale-provider";
import { useEffect, useState, type CSSProperties } from "react";
import {
  ArrowDownToLine,
  AudioLines,
  Disc3,
  Drum,
  Headphones,
  LoaderCircle,
  Mic2,
  Music2,
  Pause,
  Play,
  Repeat2,
  RotateCcw,
  SkipBack,
  Volume2,
} from "lucide-react";
import {
  useStemPlayer,
  type Stem,
  type TrackControl,
} from "@/hooks/use-stem-player";

export type TaskQueue = {
  phase: "preparing_source" | "waiting" | "waiting_worker" | "preparing" | "separating" | "uploading" | "reconnecting";
  position: number | null;
  waiting: number;
  processing: number;
  elapsed_seconds: number;
  heartbeat_age_seconds: number | null;
  worker_online: boolean;
  checked_at: number;
};
export type Task = {
  id: string;
  filename: string;
  stems_mode: string;
  engine: string;
  status: "queued" | "processing" | "completed" | "failed" | "cancelled" | "expired" | "expiring";
  progress: number;
  message: string;
  stems: Record<string, Stem>;
  duration?: number;
  created_at: string;
  local?: boolean;
  archive_url?: string;
  storage_mode?: "cloud" | "download";
  expires_at?: number;
  queue?: TaskQueue;
};
export const trackInfo = {
  vocals: { title: "Vocals", thai: "เสียงร้อง", color: "#c1a5ff", Icon: Mic2 },
  drums: { title: "Drums", thai: "กลอง", color: "#edb584", Icon: Drum },
  bass: { title: "Bass", thai: "เบส", color: "#c6e78a", Icon: AudioLines },
  other: {
    title: "Instruments",
    thai: "เครื่องดนตรีอื่น ๆ",
    color: "#86c8d6",
    Icon: Music2,
  },
  no_vocals: {
    title: "Instrumental",
    thai: "ดนตรีประกอบ",
    color: "#86c8d6",
    Icon: Music2,
  },
};
export const formatTime = (time: number) =>
  `${Math.floor(time / 60)
    .toString()
    .padStart(2, "0")}:${Math.floor(time % 60)
    .toString()
    .padStart(2, "0")}`;
export function Waveform({
  peaks,
  progress = 0,
}: {
  peaks: number[];
  progress?: number;
}) {
  return (
    <svg
      className="waveform"
      viewBox={`0 0 ${peaks.length * 4} 64`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      {peaks.map((peak, i) => (
        <rect
          key={i}
          x={i * 4}
          y={(32 - Math.max(2, peak * 28)).toFixed(3)}
          width="2"
          height={Math.max(4, peak * 56).toFixed(3)}
          rx="1"
          fill="currentColor"
          opacity={i / peaks.length <= progress ? 1 : 0.35}
        />
      ))}
    </svg>
  );
}

export function StemMixer({ task }: { task: Task }) {
  const { t: tr } = useLocale();

  const initial = () =>
    Object.fromEntries(
      Object.keys(task.stems).map((key) => [
        key,
        { volume: 1, muted: false, solo: false },
      ]),
    );
  const [controls, setControls] =
    useState<Record<string, TrackControl>>(initial);
  const [master, setMaster] = useState(0.8);
  const [preset, setPreset] = useState("all");
  const player = useStemPlayer(task.stems, controls, master);
  const hasSolo = Object.values(controls).some((control) => control.solo);
  const ready = player.status === "ready";
  const duration = player.duration || task.duration || 0;
  const togglePlayback = player.toggle;
  useEffect(() => {
    function keydown(event: KeyboardEvent) {
      if (
        event.code === "Space" &&
        !(
          event.target instanceof HTMLElement &&
          (event.target.matches("input, button, select, textarea, a") ||
            event.target.isContentEditable)
        )
      ) {
        event.preventDefault();
        void togglePlayback();
      }
    }
    document.addEventListener("keydown", keydown);
    return () => document.removeEventListener("keydown", keydown);
  }, [togglePlayback]);
  function change(key: string, patch: Partial<TrackControl>) {
    setPreset("custom");
    setControls((old) => ({ ...old, [key]: { ...old[key], ...patch } }));
  }
  function applyPreset(name: string) {
    setPreset(name);
    setControls(
      Object.fromEntries(
        Object.keys(task.stems).map((key) => [
          key,
          {
            volume: 1,
            muted: name === "karaoke" && key === "vocals",
            solo:
              name === "vocal"
                ? key === "vocals"
                : name === "rhythm" && ["drums", "bass"].includes(key),
          },
        ]),
      ),
    );
  }
  return (
    <section className="mixer panel" aria-label={tr("มิกเซอร์เสียง")}>
      <div className="mixer-heading">
        <div className="record-icon">
          <Disc3
            size={25}
            className={player.playing ? "record-spinning" : ""}
          />
        </div>
        <div>
          <span className="eyebrow">{tr("YOUR STEMS ARE READY")}</span>
          <h2>{task.filename}</h2>
          <p>
            {Object.keys(task.stems).length} {tr("tracks")} <span>·</span>{" "}
            {tr("WAV")} <span>·</span> {formatTime(duration)}
          </p>
        </div>
        <span className="ready-badge">{tr("พร้อมมิกซ์")}</span>
      </div>
      {!["demucs", "webgpu", "worker"].includes(task.engine) && (
        <div className="engine-notice">
          {task.engine === "demo"
            ? tr(
                "เพลงตัวอย่างสังเคราะห์ • แทร็ค Vocals เป็นเสียงซินธ์นำ เพื่อทดลองมิกเซอร์",
              )
            : tr(
                "โหมด DSP • แทร็คเป็นการกรองย่านเสียง ไม่ใช่การแยกเครื่องดนตรีด้วย AI และอาจมีเสียงซ้อนกัน",
              )}
        </div>
      )}
      <div className="preset-row">
        <span>
          <Headphones size={15} /> {tr("ฟังแบบ")}
        </span>
        {[
          ["all", tr("ทุกแทร็ค")],
          ["vocal", tr("Acapella")],
          ["karaoke", tr("Karaoke")],
          ...(task.stems.drums ? [["rhythm", tr("Drum & bass")]] : []),
        ].map(([key, label]) => (
          <button
            key={key}
            className={preset === key ? "chip selected" : "chip"}
            onClick={() => applyPreset(key)}
            aria-pressed={preset === key}
          >
            {label}
          </button>
        ))}
        <button
          className="icon-button reset-mix"
          title={tr("รีเซ็ตมิกซ์")}
          aria-label={tr("รีเซ็ตมิกซ์")}
          onClick={() => {
            applyPreset("all");
            setMaster(0.8);
          }}
        >
          <RotateCcw size={15} />
        </button>
      </div>
      <div className="tracks">
        {Object.entries(task.stems).map(([key, stem]) => {
          const info =
            trackInfo[key as keyof typeof trackInfo] || trackInfo.other;
          const control = controls[key];
          const dimmed = control.muted || (hasSolo && !control.solo);
          return (
            <div
              key={key}
              className={`track ${dimmed ? "track-muted" : ""}`}
              style={{ "--track-color": info.color } as CSSProperties}
            >
              <div className="track-label">
                <div className="track-icon">
                  <info.Icon size={19} />
                </div>
                <div>
                  <strong>{info.title}</strong>
                  <small>
                    {task.engine === "demo" && key === "vocals"
                      ? tr("ซินธ์นำ (ตัวอย่าง)")
                      : tr(info.thai)}
                  </small>
                </div>
              </div>
              <div className="track-wave">
                <Waveform
                  peaks={stem.peaks}
                  progress={duration ? player.time / duration : 0}
                />
                <input
                  className="wave-seek"
                  type="range"
                  aria-label={tr("เลื่อนตำแหน่ง {0}", { 0: info.title })}
                  min="0"
                  max={duration}
                  step="0.1"
                  value={player.time}
                  disabled={!ready}
                  onChange={(e) => player.seek(Number(e.target.value))}
                />
              </div>
              <div className="track-controls">
                <button
                  className={`track-toggle ${control.muted ? "active" : ""}`}
                  aria-label={tr("ปิดเสียง {0}", { 0: info.title })}
                  aria-pressed={control.muted}
                  onClick={() => change(key, { muted: !control.muted })}
                >
                  {tr("M")}
                </button>
                <button
                  className={`track-toggle ${control.solo ? "active" : ""}`}
                  aria-label={tr("ฟังเฉพาะ {0}", { 0: info.title })}
                  aria-pressed={control.solo}
                  onClick={() =>
                    change(key, { solo: !control.solo, muted: false })
                  }
                >
                  {tr("S")}
                </button>
                <input
                  type="range"
                  min="0"
                  max="1.5"
                  step="0.01"
                  value={control.volume}
                  aria-label={tr("ระดับเสียง {0}", { 0: info.title })}
                  onChange={(e) =>
                    change(key, { volume: Number(e.target.value) })
                  }
                />
                <span className="volume-value">
                  {Math.round(control.volume * 100)}%
                </span>
                <a
                  className="icon-button"
                  href={stem.url}
                  download={stemDownloadName(task.filename, stem.filename)}
                  aria-label={tr("ดาวน์โหลด {0}", { 0: info.title })}
                  title={tr("ดาวน์โหลด {0}", { 0: info.title })}
                >
                  <ArrowDownToLine size={16} />
                </a>
              </div>
            </div>
          );
        })}
      </div>
      <div className="transport">
        <div className="playback-buttons">
          <button
            className="icon-button"
            onClick={() => player.seek(0)}
            disabled={!ready}
            aria-label={tr("กลับไปเริ่มต้น")}
          >
            <SkipBack size={18} />
          </button>
          <button
            className="play-button"
            onClick={() => void player.toggle()}
            disabled={!ready}
            aria-label={
              player.playing ? tr("หยุดชั่วคราว") : tr("เล่นทุกแทร็ค")
            }
          >
            {player.status === "loading" ? (
              <LoaderCircle size={21} className="spin" />
            ) : player.playing ? (
              <Pause size={21} fill="currentColor" />
            ) : (
              <Play size={21} fill="currentColor" />
            )}
          </button>
          <button
            className={`icon-button ${player.looping ? "is-active" : ""}`}
            disabled={!ready}
            onClick={player.toggleLoop}
            aria-pressed={player.looping}
            aria-label={tr("เล่นวนซ้ำ")}
          >
            <Repeat2 size={19} />
          </button>
        </div>
        <div className="transport-seek">
          <input
            type="range"
            min="0"
            max={duration}
            value={player.time}
            step="0.1"
            disabled={!ready}
            onChange={(e) => player.seek(Number(e.target.value))}
            aria-label={tr("ตำแหน่งเพลง")}
          />
          <div>
            <span>{formatTime(player.time)}</span>
            <span>{formatTime(duration)}</span>
          </div>
        </div>
        <div className="master-volume">
          <Volume2 size={17} />
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            aria-label={tr("ระดับเสียงรวม")}
            value={master}
            onChange={(e) => setMaster(Number(e.target.value))}
          />
        </div>
      </div>
      {player.status === "loading" && (
        <p className="player-status" role="status">
          {tr("กำลังเตรียมเสียงสำหรับเล่นพร้อมกัน…")}
        </p>
      )}
      {player.error && (
        <p className="error-message" role="alert">
          {tr(player.error)}{" "}
          <button onClick={player.retry}>{tr("โหลดเสียงอีกครั้ง")}</button>
        </p>
      )}
      <div className="mixer-footer">
        <span>
          <kbd>{tr("space")}</kbd> {tr("เล่น / หยุด")}{" "}
          <span className="desktop-only">
            {tr("· M ปิดเสียง · S ฟังเฉพาะแทร็ค")}
          </span>
        </span>
        <a
          className="primary-button small"
          href={task.archive_url || `/api/download-all/${task.id}`}
          download={`${task.filename.replace(/\.[^.]+$/, "")}_stems.zip`}
        >
          <ArrowDownToLine size={16} /> {tr("ดาวน์โหลดทุกแทร็ค")}{" "}
          <span>{tr("ZIP")}</span>
        </a>
      </div>
    </section>
  );
}
