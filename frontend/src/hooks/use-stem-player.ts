"use client";

import { useLocale } from "@/components/locale-provider";
import { useCallback, useEffect, useRef, useState } from "react";

export type TrackControl = { volume: number; muted: boolean; solo: boolean };
export type Stem = {
  filename: string;
  url: string;
  peaks: number[];
  size_bytes: number;
};

/** Every source starts on the same AudioContext clock, including after a seek. */
class StemEngine {
  context = new AudioContext();
  buffers: Record<string, AudioBuffer> = {};
  gains: Record<string, GainNode> = {};
  sources: AudioBufferSourceNode[] = [];
  master = this.context.createGain();
  limiter = this.context.createDynamicsCompressor();
  duration = 0;
  offset = 0;
  startedAt = 0;
  playing = false;
  looping = false;

  constructor() {
    this.master.connect(this.limiter);
    this.limiter.connect(this.context.destination);
    this.limiter.threshold.value = -1;
    this.limiter.knee.value = 0;
    this.limiter.ratio.value = 20;
  }
  time() {
    const time =
      this.offset +
      (this.playing
        ? Math.max(0, this.context.currentTime - this.startedAt)
        : 0);
    return this.looping && this.duration
      ? time % this.duration
      : Math.min(time, this.duration);
  }
  stop() {
    this.offset = this.time();
    this.playing = false;
    this.sources.forEach((source) => {
      source.stop();
      source.disconnect();
    });
    this.sources = [];
  }
  start() {
    if (!this.duration) return;
    if (this.offset >= this.duration) this.offset = 0;
    this.startedAt = this.context.currentTime + 0.04;
    Object.entries(this.buffers).forEach(([key, buffer]) => {
      const source = this.context.createBufferSource();
      source.buffer = buffer;
      source.loop = this.looping;
      source.loopEnd = this.duration;
      source.connect(this.gains[key]);
      source.start(this.startedAt, this.offset);
      this.sources.push(source);
    });
    this.playing = true;
  }
  seek(time: number) {
    const wasPlaying = this.playing;
    this.stop();
    this.offset = Math.max(0, Math.min(time, this.duration));
    if (wasPlaying) this.start();
  }
  dispose() {
    this.stop();
    void this.context.close();
  }
}

export function useStemPlayer(
  stems: Record<string, Stem> | undefined,
  controls: Record<string, TrackControl>,
  master: number,
) {
  const { t: tr } = useLocale();

  const engine = useRef<StemEngine | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">(
    "idle",
  );
  const [error, setError] = useState("");
  const [playing, setPlaying] = useState(false);
  const [looping, setLooping] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (!stems) return;
    const abort = new AbortController();
    let audio: StemEngine | undefined;
    async function load() {
      setStatus("loading");
      setError("");
      setPlaying(false);
      setTime(0);
      setLooping(false);
      try {
        audio = new StemEngine();
        engine.current = audio;
        for (const [key, stem] of Object.entries(stems!)) {
          const response = await fetch(stem.url, { signal: abort.signal });
          if (!response.ok)
            throw new Error(tr("โหลดแทร็คไม่สำเร็จ กรุณาลองอีกครั้ง"));
          const buffer = await audio.context.decodeAudioData(
            await response.arrayBuffer(),
          );
          if (abort.signal.aborted) return;
          audio.buffers[key] = buffer;
          audio.gains[key] = audio.context.createGain();
          audio.gains[key].connect(audio.master);
        }
        audio.duration = Math.min(
          ...Object.values(audio.buffers).map((buffer) => buffer.duration),
        );
        setDuration(audio.duration);
        setStatus("ready");
      } catch (cause) {
        if (!abort.signal.aborted) {
          setStatus("error");
          setError(
            cause instanceof Error ? cause.message : tr("เปิดเสียงไม่สำเร็จ"),
          );
        }
      }
    }
    void load();
    return () => {
      abort.abort();
      audio?.dispose();
      engine.current = null;
    };
  }, [stems, reload, tr]);

  useEffect(() => {
    const audio = engine.current;
    if (!audio) return;
    const hasSolo = Object.values(controls).some((control) => control.solo);
    for (const [key, control] of Object.entries(controls)) {
      audio.gains[key]?.gain.setTargetAtTime(
        control.muted || (hasSolo && !control.solo) ? 0 : control.volume,
        audio.context.currentTime,
        0.015,
      );
    }
    audio.master.gain.setTargetAtTime(master, audio.context.currentTime, 0.015);
  }, [controls, master, status]);

  useEffect(() => {
    if (!playing) return;
    let frame: number;
    function tick() {
      const audio = engine.current;
      if (!audio) return;
      setTime(audio.time());
      if (!audio.looping && audio.time() >= audio.duration) {
        audio.stop();
        setPlaying(false);
        return;
      }
      frame = requestAnimationFrame(tick);
    }
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing]);

  const toggle = useCallback(async () => {
    const audio = engine.current;
    if (!audio || status !== "ready") return;
    try {
      await audio.context.resume();
      if (audio.playing) audio.stop();
      else audio.start();
      setPlaying(audio.playing);
    } catch {
      setError(tr("เบราว์เซอร์ยังเล่นเสียงไม่ได้ กรุณากดเล่นอีกครั้ง"));
    }
  }, [status, tr]);
  const seek = useCallback((value: number) => {
    engine.current?.seek(value);
    setTime(value);
  }, []);
  const toggleLoop = () => {
    const audio = engine.current;
    if (!audio) return;
    const position = audio.time();
    audio.looping = !audio.looping;
    audio.seek(position);
    setLooping(audio.looping);
  };
  return {
    status,
    error,
    playing,
    looping,
    time,
    duration,
    toggle,
    seek,
    toggleLoop,
    retry: () => setReload((value) => value + 1),
  };
}
