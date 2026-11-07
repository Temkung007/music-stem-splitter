"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { Play, Pause, RotateCcw, Volume2, VolumeX, Mic2, Drum, Guitar, Piano, Sliders } from "lucide-react";
import { useLocale } from "@/components/locale-provider";

interface StemTrack {
  id: "vocals" | "drums" | "bass" | "other";
  name: string;
  nameEn: string;
  ch: string;
  tag: string;
  color: string;
  icon: typeof Mic2;
  volume: number;
  muted: boolean;
  solo: boolean;
}

export function InteractiveHeroMixer() {
  const { t: tr, locale } = useLocale();
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [masterVolume, setMasterVolume] = useState(0.85);

  const [tracks, setTracks] = useState<StemTrack[]>([
    { id: "vocals", name: "เสียงร้อง", nameEn: "Vocals", ch: "CH 1", tag: "2.4 kHz High-Mid", color: "#c084fc", icon: Mic2, volume: 1, muted: false, solo: false },
    { id: "drums", name: "กลอง", nameEn: "Drums", ch: "CH 2", tag: "85 Hz Punch & Beat", color: "#fb923c", icon: Drum, volume: 1, muted: false, solo: false },
    { id: "bass", name: "เบส", nameEn: "Bass", ch: "CH 3", tag: "45 Hz Sub-Groove", color: "#38bdf8", icon: Guitar, volume: 1, muted: false, solo: false },
    { id: "other", name: "ดนตรี", nameEn: "Instruments", ch: "CH 4", tag: "Full-Range Harmonic", color: "#d7f98b", icon: Piano, volume: 0.95, muted: false, solo: false },
  ]);

  const audioCtxRef = useRef<AudioContext | null>(null);
  const gainNodesRef = useRef<Record<string, GainNode>>({});
  const masterGainRef = useRef<GainNode | null>(null);
  const timerRef = useRef<number | null>(null);
  const synthIntervalRef = useRef<number | null>(null);
  const isPlayingRef = useRef(false);
  const beatStepRef = useRef(0);

  // Initialize WebAudio context lazily
  const getAudioContext = useCallback(() => {
    if (!audioCtxRef.current) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AudioCtx();
      const master = ctx.createGain();
      master.gain.value = masterVolume;

      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -1.5;
      limiter.knee.value = 0;
      limiter.ratio.value = 16;

      master.connect(limiter);
      limiter.connect(ctx.destination);

      masterGainRef.current = master;
      audioCtxRef.current = ctx;

      const gains: Record<string, GainNode> = {};
      ["vocals", "drums", "bass", "other"].forEach((id) => {
        const g = ctx.createGain();
        g.gain.value = 1;
        g.connect(master);
        gains[id] = g;
      });
      gainNodesRef.current = gains;
    }
    if (audioCtxRef.current.state === "suspended") {
      audioCtxRef.current.resume();
    }
    return audioCtxRef.current;
  }, [masterVolume]);

  // Update track gains according to solo/mute matrix
  useEffect(() => {
    const hasSolo = tracks.some((t) => t.solo);
    tracks.forEach((t) => {
      const gainNode = gainNodesRef.current[t.id];
      if (gainNode && audioCtxRef.current) {
        let effectiveGain = 0;
        if (hasSolo) {
          effectiveGain = t.solo && !t.muted ? t.volume : 0;
        } else {
          effectiveGain = t.muted ? 0 : t.volume;
        }
        gainNode.gain.setTargetAtTime(effectiveGain, audioCtxRef.current.currentTime, 0.03);
      }
    });
  }, [tracks]);

  // Update master volume
  useEffect(() => {
    if (masterGainRef.current && audioCtxRef.current) {
      masterGainRef.current.gain.setTargetAtTime(masterVolume, audioCtxRef.current.currentTime, 0.03);
    }
  }, [masterVolume]);

  // Synthesize musical groove in real time
  const playBeat = useCallback(() => {
    const ctx = audioCtxRef.current;
    if (!ctx) return;
    const now = ctx.currentTime;
    const step = beatStepRef.current % 16;
    beatStepRef.current += 1;

    // 1. Kick Drum (on steps 0, 4, 8, 12)
    if (step === 0 || step === 4 || step === 8 || step === 12) {
      const g = gainNodesRef.current["drums"];
      if (g) {
        const osc = ctx.createOscillator();
        const env = ctx.createGain();
        osc.frequency.setValueAtTime(140, now);
        osc.frequency.exponentialRampToValueAtTime(42, now + 0.12);
        env.gain.setValueAtTime(0.9, now);
        env.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
        osc.connect(env);
        env.connect(g);
        osc.start(now);
        osc.stop(now + 0.22);
      }
    }

    // 2. Snare / Clap (on steps 4, 12)
    if (step === 4 || step === 12) {
      const g = gainNodesRef.current["drums"];
      if (g) {
        const bufferSize = ctx.sampleRate * 0.1;
        const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
        const noise = ctx.createBufferSource();
        noise.buffer = buffer;
        const filter = ctx.createBiquadFilter();
        filter.type = "highpass";
        filter.frequency.setValueAtTime(1100, now);
        const env = ctx.createGain();
        env.gain.setValueAtTime(0.45, now);
        env.gain.exponentialRampToValueAtTime(0.001, now + 0.14);
        noise.connect(filter);
        filter.connect(env);
        env.connect(g);
        noise.start(now);
      }
    }

    // 3. Hi-Hat (every 2 steps)
    if (step % 2 === 0) {
      const g = gainNodesRef.current["drums"];
      if (g) {
        const bufferSize = ctx.sampleRate * 0.04;
        const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
        const noise = ctx.createBufferSource();
        noise.buffer = buffer;
        const filter = ctx.createBiquadFilter();
        filter.type = "highpass";
        filter.frequency.setValueAtTime(7500, now);
        const env = ctx.createGain();
        env.gain.setValueAtTime(step % 4 === 2 ? 0.22 : 0.09, now);
        env.gain.exponentialRampToValueAtTime(0.001, now + 0.04);
        noise.connect(filter);
        filter.connect(env);
        env.connect(g);
        noise.start(now);
      }
    }

    // 4. Bassline (Walking minor 8A bass groove)
    if (step % 2 === 0) {
      const g = gainNodesRef.current["bass"];
      if (g) {
        const notes = [110, 110, 130.81, 146.83, 110, 98, 110, 164.81];
        const freq = notes[Math.floor(step / 2) % notes.length];
        const osc = ctx.createOscillator();
        osc.type = "sawtooth";
        osc.frequency.setValueAtTime(freq / 2, now);
        const filter = ctx.createBiquadFilter();
        filter.type = "lowpass";
        filter.frequency.setValueAtTime(450, now);
        filter.frequency.exponentialRampToValueAtTime(120, now + 0.18);
        const env = ctx.createGain();
        env.gain.setValueAtTime(0.4, now);
        env.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
        osc.connect(filter);
        filter.connect(env);
        env.connect(g);
        osc.start(now);
        osc.stop(now + 0.18);
      }
    }

    // 5. Instruments / Synth Chords (Steps 0, 6, 8, 14)
    if (step === 0 || step === 6 || step === 8 || step === 14) {
      const g = gainNodesRef.current["other"];
      if (g) {
        const chords = [
          [220, 261.63, 329.63], // Am
          [174.61, 220, 261.63], // F
          [261.63, 329.63, 392], // C
          [196, 246.94, 293.66], // G
        ];
        const chord = chords[Math.floor(step / 4) % chords.length];
        chord.forEach((freq) => {
          const osc = ctx.createOscillator();
          osc.type = "triangle";
          osc.frequency.setValueAtTime(freq, now);
          const env = ctx.createGain();
          env.gain.setValueAtTime(0.12, now);
          env.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
          osc.connect(env);
          env.connect(g);
          osc.start(now);
          osc.stop(now + 0.45);
        });
      }
    }

    // 6. Vocals Harmonic Melody (Steps 2, 6, 10)
    if (step === 2 || step === 6 || step === 10) {
      const g = gainNodesRef.current["vocals"];
      if (g) {
        const vocalPitches = [440, 523.25, 659.25, 587.33];
        const pitch = vocalPitches[Math.floor(step / 3) % vocalPitches.length];
        const osc = ctx.createOscillator();
        osc.type = "sine";
        osc.frequency.setValueAtTime(pitch, now);
        const vibrato = ctx.createOscillator();
        vibrato.frequency.value = 5.5;
        const vibGain = ctx.createGain();
        vibGain.gain.value = 8;
        vibrato.connect(vibGain);
        vibGain.connect(osc.frequency);
        const env = ctx.createGain();
        env.gain.setValueAtTime(0.001, now);
        env.gain.linearRampToValueAtTime(0.25, now + 0.05);
        env.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
        osc.connect(env);
        env.connect(g);
        vibrato.start(now);
        osc.start(now);
        vibrato.stop(now + 0.35);
        osc.stop(now + 0.35);
      }
    }
  }, []);

  const togglePlay = () => {
    const next = !playing;
    setPlaying(next);
    isPlayingRef.current = next;

    if (next) {
      getAudioContext();
      const intervalMs = Math.round((60 / (124 * 4)) * 1000);
      playBeat();
      synthIntervalRef.current = window.setInterval(playBeat, intervalMs);

      timerRef.current = window.setInterval(() => {
        setCurrentTime((prev) => (prev >= 90 ? 0 : prev + 0.1));
      }, 100);
    } else {
      if (synthIntervalRef.current) clearInterval(synthIntervalRef.current);
      if (timerRef.current) clearInterval(timerRef.current);
    }
  };

  const resetTime = () => {
    setCurrentTime(0);
    beatStepRef.current = 0;
  };

  const toggleSolo = (id: StemTrack["id"]) => {
    setTracks((prev) => {
      const current = prev.find((t) => t.id === id);
      const isSoloing = !current?.solo;
      return prev.map((t) => {
        if (t.id === id) return { ...t, solo: isSoloing, muted: false };
        return { ...t, solo: false };
      });
    });
  };

  const toggleMute = (id: StemTrack["id"]) => {
    setTracks((prev) =>
      prev.map((t) => (t.id === id ? { ...t, muted: !t.muted, solo: false } : t))
    );
  };

  const setVolume = (id: StemTrack["id"], volume: number) => {
    setTracks((prev) => prev.map((t) => (t.id === id ? { ...t, volume } : t)));
  };

  useEffect(() => {
    return () => {
      if (synthIntervalRef.current) clearInterval(synthIntervalRef.current);
      if (timerRef.current) clearInterval(timerRef.current);
      if (audioCtxRef.current) {
        audioCtxRef.current.close().catch(() => {});
      }
    };
  }, []);

  const formatDisplayTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 10);
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}.${ms}`;
  };

  return (
    <div
      className="hero-mixer-console"
      data-ui="hero-mixer-console"
      data-visual="hero-mixer"
      style={{
        background: "linear-gradient(180deg, #17181b 0%, #101113 100%)",
        border: "1px solid rgba(255, 255, 255, 0.1)",
        boxShadow: "0 24px 60px -12px rgba(0, 0, 0, 0.95), 0 0 0 1px rgba(0, 0, 0, 0.8), inset 0 1px 0 rgba(255, 255, 255, 0.14)",
        padding: "16px 20px",
        borderRadius: "var(--r-lg)",
        width: "100%",
        maxWidth: "100%",
        height: "100%",
        boxSizing: "border-box",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        position: "relative"
      }}
    >
      {/* Precision Hardware Corner Bolts */}
      <span style={{ position: "absolute", top: 8, left: 10, fontSize: 8, color: "rgba(255,255,255,0.18)", fontFamily: "monospace", pointerEvents: "none" }}>+</span>
      <span style={{ position: "absolute", top: 8, right: 10, fontSize: 8, color: "rgba(255,255,255,0.18)", fontFamily: "monospace", pointerEvents: "none" }}>+</span>
      <span style={{ position: "absolute", bottom: 8, left: 10, fontSize: 8, color: "rgba(255,255,255,0.18)", fontFamily: "monospace", pointerEvents: "none" }}>+</span>
      <span style={{ position: "absolute", bottom: 8, right: 10, fontSize: 8, color: "rgba(255,255,255,0.18)", fontFamily: "monospace", pointerEvents: "none" }}>+</span>

      {/* 1. TOP HARDWARE OLED SCREEN */}
      <div
        style={{
          background: "#07080a",
          border: "1px solid rgba(215, 249, 139, 0.18)",
          borderRadius: 8,
          padding: "10px 14px",
          marginBottom: 10,
          boxShadow: "inset 0 2px 6px rgba(0,0,0,0.8), 0 0 20px rgba(215, 249, 139, 0.04)"
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: "50%",
                background: playing ? "var(--p-accent)" : "#52525b",
                display: "inline-block",
                boxShadow: playing ? "0 0 10px var(--p-accent)" : "none",
                transition: "background 150ms ease, box-shadow 150ms ease"
              }}
            />
            <span className="mono" style={{ fontSize: 11, fontWeight: 700, color: "var(--p-ink)", letterSpacing: "0.08em" }}>
              DEMUCS v4 MATRIX DSP
            </span>
            <span
              className="mono"
              style={{
                height: 18,
                padding: "0 6px",
                fontSize: 9,
                fontWeight: 600,
                background: "rgba(215, 249, 139, 0.12)",
                color: "var(--p-accent)",
                borderRadius: 3,
                display: "inline-flex",
                alignItems: "center",
                border: "1px solid rgba(215, 249, 139, 0.2)"
              }}
            >
              32-BIT FLOAT
            </span>
          </div>

          <div className="mono" style={{ fontSize: 11, color: "var(--p-accent)", letterSpacing: "0.05em", fontWeight: 600, flexShrink: 0 }}>
            124.0 BPM · 8A (Am)
          </div>
        </div>

        {/* OLED Sub-Bar with Track Info & Stereo VU LED Meters */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div className="mono muted" style={{ fontSize: 10, letterSpacing: "0.03em", whiteSpace: "nowrap" }}>
            STREAM: <span style={{ color: "var(--p-ink)" }}>Beautiful Things</span>
          </div>

          {/* Dynamic Stereo VU Meters */}
          <div style={{ display: "flex", gap: 3, alignItems: "center", marginLeft: 12, flexShrink: 0 }} title="Master Stereo Peak Meter">
            <span className="mono muted" style={{ fontSize: 9 }}>L</span>
            <div style={{ display: "flex", gap: 1.5 }}>
              {Array.from({ length: 9 }, (_, i) => {
                const active = playing && Math.sin(currentTime * 8 + i * 0.7) > (i - 4.5) * 0.22;
                const color = i >= 7 ? "#ef4444" : i >= 5 ? "#eab308" : "#22c55e";
                return (
                  <span
                    key={`l-${i}`}
                    style={{
                      width: 3,
                      height: 8,
                      borderRadius: 1,
                      background: active ? color : "rgba(255,255,255,0.08)",
                      boxShadow: active ? `0 0 6px ${color}` : "none"
                    }}
                  />
                );
              })}
            </div>
            <span className="mono muted" style={{ fontSize: 9, marginLeft: 2 }}>R</span>
            <div style={{ display: "flex", gap: 1.5 }}>
              {Array.from({ length: 9 }, (_, i) => {
                const active = playing && Math.cos(currentTime * 8 + i * 0.7) > (i - 4.5) * 0.22;
                const color = i >= 7 ? "#ef4444" : i >= 5 ? "#eab308" : "#22c55e";
                return (
                  <span
                    key={`r-${i}`}
                    style={{
                      width: 3,
                      height: 8,
                      borderRadius: 1,
                      background: active ? color : "rgba(255,255,255,0.08)",
                      boxShadow: active ? `0 0 6px ${color}` : "none"
                    }}
                  />
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* 2. 4 STEM CHANNEL STRIPS */}
      <div style={{ display: "grid", gap: 9, flex: 1, minHeight: 0 }}>
        {tracks.map((track, idx) => {
          const Icon = track.icon;
          const isSilent = track.muted || (tracks.some((t) => t.solo) && !track.solo);

          return (
            <div
              key={track.id}
              className="stem-channel-strip"
              style={{
                display: "grid",
                gridTemplateColumns: "132px 1fr 144px",
                alignItems: "center",
                gap: 12,
                background: isSilent ? "rgba(255,255,255,0.01)" : "rgba(255,255,255,0.025)",
                padding: "8px 12px",
                borderRadius: 6,
                border: "1px solid",
                borderColor: track.solo
                  ? "rgba(230, 162, 60, 0.45)"
                  : track.muted
                  ? "rgba(239, 68, 68, 0.35)"
                  : "rgba(255,255,255,0.06)",
                boxShadow: track.solo ? "0 0 15px rgba(230, 162, 60, 0.12)" : "none",
                opacity: isSilent ? 0.45 : 1,
                transition: "opacity var(--dur) var(--ease), border-color var(--dur) var(--ease), background var(--dur) var(--ease)"
              }}
            >
              {/* Channel Label & Frequency Band Badge */}
              <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 120, flexShrink: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span
                    className="mono"
                    style={{
                      fontSize: 9,
                      fontWeight: 700,
                      color: isSilent ? "var(--p-muted)" : track.color,
                      letterSpacing: "0.04em",
                      background: "rgba(0,0,0,0.3)",
                      padding: "1px 4px",
                      borderRadius: 2,
                      whiteSpace: "nowrap",
                      flexShrink: 0
                    }}
                  >
                    {track.ch}
                  </span>
                  <span
                    style={{
                      width: 18,
                      height: 18,
                      borderRadius: 4,
                      background: isSilent ? "rgba(255,255,255,0.05)" : `color-mix(in oklab, ${track.color} 20%, transparent)`,
                      color: isSilent ? "var(--p-muted)" : track.color,
                      display: "grid",
                      placeItems: "center",
                      flexShrink: 0
                    }}
                  >
                    <Icon size={11} />
                  </span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: "var(--p-ink)", whiteSpace: "nowrap" }}>
                    {locale === "th" ? track.name : track.nameEn}
                  </span>
                </div>
                <span className="mono muted" style={{ fontSize: 9, paddingLeft: 4, letterSpacing: "0.02em", whiteSpace: "nowrap" }}>
                  {track.tag}
                </span>
              </div>

              {/* Dynamic Waveform Visualizer with Neon Gradient & Playhead */}
              <div
                style={{
                  height: 32,
                  display: "flex",
                  alignItems: "center",
                  gap: 2.5,
                  overflow: "hidden",
                  position: "relative",
                  background: "rgba(0,0,0,0.35)",
                  padding: "0 6px",
                  borderRadius: 4,
                  border: "1px solid rgba(255,255,255,0.04)"
                }}
              >
                {/* Active Playhead Scrubber */}
                {playing && !isSilent && (
                  <span
                    style={{
                      position: "absolute",
                      top: 0,
                      bottom: 0,
                      width: 2,
                      background: "#fff",
                      boxShadow: `0 0 8px #fff, 0 0 12px ${track.color}`,
                      left: `${((currentTime * 1.5) % 1) * 100}%`,
                      transition: "left 100ms linear",
                      zIndex: 2,
                      pointerEvents: "none"
                    }}
                  />
                )}

                {Array.from({ length: 32 }, (_, i) => {
                  const baseHeight = 16 + Math.abs(Math.sin(i * 0.42 + idx * 1.4)) * 62;
                  const animatedHeight = playing && !isSilent
                    ? Math.min(100, Math.max(12, baseHeight + Math.sin((currentTime * 10 + i * 1.2) * 1.5) * 35))
                    : baseHeight * 0.55;

                  return (
                    <span
                      key={i}
                      style={{
                        flex: 1,
                        height: `${animatedHeight}%`,
                        background: isSilent
                          ? "var(--p-muted)"
                          : `linear-gradient(to top, color-mix(in oklab, ${track.color} 35%, transparent), ${track.color})`,
                        opacity: isSilent ? 0.2 : 0.88,
                        borderRadius: 1,
                        transition: "height 80ms ease, background 150ms ease"
                      }}
                    />
                  );
                })}
              </div>

              {/* Hardware Controls: Fader Slider + 4-Dot LED VU Meter + Tactile Solo (S) + Mute (M) Buttons */}
              <div style={{ display: "flex", alignItems: "center", gap: 5, justifyContent: "flex-end" }}>
                <input
                  type="range"
                  min="0"
                  max="1.5"
                  step="0.05"
                  value={track.volume}
                  onChange={(e) => setVolume(track.id, parseFloat(e.target.value))}
                  aria-label={`${locale === "th" ? track.name : track.nameEn} ${locale === "th" ? "ระดับเสียง" : "Volume"}`}
                  style={{
                    width: 46,
                    height: 4,
                    accentColor: track.color,
                    cursor: "pointer",
                    flexShrink: 0
                  }}
                />

                {/* Per-Track LED Peak Meter */}
                <div style={{ display: "flex", gap: 1.5, alignItems: "center", flexShrink: 0 }} aria-hidden="true">
                  {Array.from({ length: 4 }, (_, mIdx) => {
                    const isLit = playing && !isSilent && Math.sin(currentTime * 12 + idx * 2.1 + mIdx) > (mIdx - 2) * 0.45;
                    const dotColor = mIdx === 3 ? "#ef4444" : mIdx === 2 ? "#eab308" : track.color;
                    return (
                      <span
                        key={mIdx}
                        style={{
                          width: 2.5,
                          height: 9,
                          borderRadius: 1,
                          background: isLit ? dotColor : "rgba(255,255,255,0.08)",
                          boxShadow: isLit ? `0 0 5px ${dotColor}` : "none",
                          transition: "background 60ms ease, box-shadow 60ms ease"
                        }}
                      />
                    );
                  })}
                </div>

                <button
                  type="button"
                  onClick={() => toggleSolo(track.id)}
                  aria-pressed={track.solo}
                  title="Solo Track"
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: 4,
                    fontSize: 10,
                    fontWeight: 700,
                    border: "1px solid",
                    borderColor: track.solo ? "#e6a23c" : "rgba(255,255,255,0.12)",
                    background: track.solo ? "#e6a23c" : "#1a1c1e",
                    color: track.solo ? "#111" : "#a1a1aa",
                    boxShadow: track.solo ? "0 0 10px rgba(230, 162, 60, 0.5)" : "none",
                    cursor: "pointer",
                    padding: 0,
                    flexShrink: 0,
                    transition: "all 120ms ease"
                  }}
                >
                  S
                </button>
                <button
                  type="button"
                  onClick={() => toggleMute(track.id)}
                  aria-pressed={track.muted}
                  title="Mute Track"
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: 4,
                    fontSize: 10,
                    fontWeight: 700,
                    border: "1px solid",
                    borderColor: track.muted ? "#ef4444" : "rgba(255,255,255,0.12)",
                    background: track.muted ? "#ef4444" : "#1a1c1e",
                    color: track.muted ? "#fff" : "#a1a1aa",
                    boxShadow: track.muted ? "0 0 10px rgba(239, 68, 68, 0.5)" : "none",
                    cursor: "pointer",
                    padding: 0,
                    flexShrink: 0,
                    transition: "all 120ms ease"
                  }}
                >
                  M
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* 3. MASTER TRANSPORT & CONTROL PANEL */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginTop: 10,
          paddingTop: 10,
          borderTop: "1px solid rgba(255, 255, 255, 0.08)"
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button
            type="button"
            className="btn btn--primary"
            onClick={togglePlay}
            style={{
              height: 38,
              padding: "0 16px",
              borderRadius: "var(--r-btn)",
              boxShadow: playing ? "0 0 20px rgba(215, 249, 139, 0.35)" : "none",
              transition: "all 150ms ease"
            }}
          >
            {playing ? <Pause size={15} /> : <Play size={15} fill="currentColor" />}
            <span>{playing ? tr("หยุดชั่วคราว") : tr("ฟังเสียงสเต็ม")}</span>
          </button>

          <button
            type="button"
            className="btn btn--secondary"
            onClick={resetTime}
            title={tr("เริ่มใหม่")}
            style={{ width: 38, height: 38, padding: 0, borderRadius: "var(--r-btn)" }}
          >
            <RotateCcw size={14} />
          </button>

          <div
            style={{
              background: "#07080a",
              border: "1px solid rgba(255, 255, 255, 0.08)",
              borderRadius: 4,
              padding: "4px 8px"
            }}
          >
            <span className="mono" style={{ fontSize: 12, color: playing ? "var(--p-accent)" : "var(--p-ink)", letterSpacing: "0.06em", fontWeight: 600 }}>
              {formatDisplayTime(currentTime)} <span className="muted">/ 01:30.0</span>
            </span>
          </div>
        </div>

        {/* Master Volume Section */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
          <button
            type="button"
            onClick={() => setMasterVolume((v) => (v > 0 ? 0 : 0.85))}
            style={{ color: "var(--p-muted)", display: "flex", padding: 2, background: "transparent", border: "none", cursor: "pointer" }}
            aria-label="Master mute"
          >
            {masterVolume === 0 ? <VolumeX size={15} /> : <Volume2 size={15} />}
          </button>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={masterVolume}
            onChange={(e) => setMasterVolume(parseFloat(e.target.value))}
            aria-label="Master Volume"
            style={{ width: 44, height: 4, accentColor: "var(--p-accent)", cursor: "pointer" }}
          />
          <span className="mono muted" style={{ fontSize: 10, width: 26, textAlign: "right" }}>
            {Math.round(masterVolume * 100)}%
          </span>
        </div>
      </div>
    </div>
  );
}
