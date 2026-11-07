"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { Play, Pause, RotateCcw, Volume2, VolumeX, Mic2, Drum, Guitar, Piano } from "lucide-react";
import { useLocale } from "@/components/locale-provider";

interface StemTrack {
  id: "vocals" | "drums" | "bass" | "other";
  name: string;
  nameEn: string;
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
    { id: "vocals", name: "เสียงร้อง (Vocals)", nameEn: "Vocals", color: "#d5b2ff", icon: Mic2, volume: 1, muted: false, solo: false },
    { id: "drums", name: "กลอง (Drums)", nameEn: "Drums", color: "#ffb480", icon: Drum, volume: 1, muted: false, solo: false },
    { id: "bass", name: "เบส (Bass)", nameEn: "Bass", color: "#80dfff", icon: Guitar, volume: 1, muted: false, solo: false },
    { id: "other", name: "ดนตรี (Instruments)", nameEn: "Instruments", color: "#d7f98b", icon: Piano, volume: 0.95, muted: false, solo: false },
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

    // 1. DRUMS
    const drumGain = gainNodesRef.current["drums"];
    if (drumGain) {
      // Kick on 0, 4, 8, 12
      if (step % 4 === 0) {
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.frequency.setValueAtTime(140, now);
        osc.frequency.exponentialRampToValueAtTime(38, now + 0.12);
        g.gain.setValueAtTime(0.9, now);
        g.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
        osc.connect(g);
        g.connect(drumGain);
        osc.start(now);
        osc.stop(now + 0.23);
      }
      // Snare on 4, 12
      if (step === 4 || step === 12) {
        const osc = ctx.createOscillator();
        osc.type = "triangle";
        const g = ctx.createGain();
        osc.frequency.setValueAtTime(220, now);
        osc.frequency.exponentialRampToValueAtTime(90, now + 0.1);
        g.gain.setValueAtTime(0.65, now);
        g.gain.exponentialRampToValueAtTime(0.01, now + 0.15);
        osc.connect(g);
        g.connect(drumGain);
        osc.start(now);
        osc.stop(now + 0.16);
      }
      // Hi-hat on every 2 steps
      if (step % 2 === 0) {
        const osc = ctx.createOscillator();
        osc.type = "highpass" as OscillatorType;
        const g = ctx.createGain();
        osc.frequency.setValueAtTime(8000, now);
        g.gain.setValueAtTime(step % 4 === 2 ? 0.35 : 0.18, now);
        g.gain.exponentialRampToValueAtTime(0.01, now + 0.05);
        osc.connect(g);
        g.connect(drumGain);
        osc.start(now);
        osc.stop(now + 0.06);
      }
    }

    // 2. BASS (A minor: A1 55Hz, C2 65.4Hz, D2 73.4Hz, E2 82.4Hz)
    const bassGain = gainNodesRef.current["bass"];
    if (bassGain) {
      const bassNotes = [55, 55, 65.4, 55, 73.4, 55, 82.4, 65.4];
      const freq = bassNotes[Math.floor(step / 2) % bassNotes.length];
      if (step % 2 === 0) {
        const osc = ctx.createOscillator();
        osc.type = "sawtooth";
        const filter = ctx.createBiquadFilter();
        filter.type = "lowpass";
        filter.frequency.setValueAtTime(260, now);
        filter.Q.value = 4;
        const g = ctx.createGain();
        osc.frequency.setValueAtTime(freq, now);
        g.gain.setValueAtTime(0.7, now);
        g.gain.exponentialRampToValueAtTime(0.01, now + 0.18);
        osc.connect(filter);
        filter.connect(g);
        g.connect(bassGain);
        osc.start(now);
        osc.stop(now + 0.19);
      }
    }

    // 3. INSTRUMENTS (Chords: Am9 -> Fmaj7)
    const otherGain = gainNodesRef.current["other"];
    if (otherGain && (step === 0 || step === 8)) {
      const chord = step < 8 ? [220, 261.63, 329.63, 392] : [174.61, 220, 261.63, 329.63];
      chord.forEach((f) => {
        const osc = ctx.createOscillator();
        osc.type = "sine";
        const g = ctx.createGain();
        osc.frequency.setValueAtTime(f, now);
        g.gain.setValueAtTime(0.18, now);
        g.gain.exponentialRampToValueAtTime(0.005, now + 0.7);
        osc.connect(g);
        g.connect(otherGain);
        osc.start(now);
        osc.stop(now + 0.75);
      });
    }

    // 4. VOCALS (Melodic synth lead phrase: 440Hz, 523Hz, 659Hz)
    const vocalGain = gainNodesRef.current["vocals"];
    if (vocalGain) {
      const vocalMelody = [440, 0, 523.25, 440, 659.25, 0, 587.33, 523.25, 440, 0, 392, 440, 523.25, 0, 440, 0];
      const f = vocalMelody[step];
      if (f > 0) {
        const osc = ctx.createOscillator();
        osc.type = "triangle";
        const g = ctx.createGain();
        osc.frequency.setValueAtTime(f, now);
        // Add subtle vibrato
        const vibrato = ctx.createOscillator();
        vibrato.frequency.value = 5.5;
        const vGain = ctx.createGain();
        vGain.gain.value = 6;
        vibrato.connect(vGain);
        vGain.connect(osc.frequency);
        vibrato.start(now);
        vibrato.stop(now + 0.2);

        g.gain.setValueAtTime(0.4, now);
        g.gain.exponentialRampToValueAtTime(0.01, now + 0.19);
        osc.connect(g);
        g.connect(vocalGain);
        osc.start(now);
        osc.stop(now + 0.2);
      }
    }
  }, []);

  const togglePlay = () => {
    if (playing) {
      if (synthIntervalRef.current) clearInterval(synthIntervalRef.current);
      if (timerRef.current) clearInterval(timerRef.current);
      isPlayingRef.current = false;
      setPlaying(false);
    } else {
      getAudioContext();
      isPlayingRef.current = true;
      setPlaying(true);
      // 124 BPM = 16th note every 120ms
      beatStepRef.current = 0;
      synthIntervalRef.current = window.setInterval(playBeat, 121);
      timerRef.current = window.setInterval(() => {
        setCurrentTime((prev) => (prev >= 90 ? 0 : prev + 0.25));
      }, 250);
    }
  };

  const resetTime = () => {
    setCurrentTime(0);
    beatStepRef.current = 0;
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

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  };

  const setVolume = (id: string, val: number) => {
    setTracks((prev) =>
      prev.map((t) => (t.id === id ? { ...t, volume: val } : t))
    );
  };

  const toggleMute = (id: string) => {
    setTracks((prev) =>
      prev.map((t) => (t.id === id ? { ...t, muted: !t.muted } : t))
    );
  };

  const toggleSolo = (id: string) => {
    setTracks((prev) =>
      prev.map((t) => (t.id === id ? { ...t, solo: !t.solo } : t))
    );
  };

  return (
    <div
      className="hero-mixer-console"
      data-ui="hero-mixer-console"
      data-visual="hero-mixer"
      style={{
        background: "var(--p-surface)",
        border: "1px solid var(--line)",
        padding: "16px 20px",
        borderRadius: "var(--r-lg)",
        width: "100%",
        maxWidth: "100%",
        height: "100%",
        boxSizing: "border-box",
        overflow: "hidden",
      }}
    >
      {/* Console Top Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--s-4)", borderBottom: "1px solid var(--line)", paddingBottom: "var(--s-3)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--s-2)" }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: playing ? "var(--p-accent)" : "var(--p-muted)", display: "inline-block", boxShadow: playing ? "0 0 10px var(--p-accent)" : "none" }} />
          <span className="mono" style={{ fontSize: "var(--t-label)", fontWeight: 500, color: "var(--p-ink)", letterSpacing: "0.05em" }}>
            DEMUCS v4 DSP CONSOLE
          </span>
          <span className="pill" style={{ height: 22, padding: "0 8px", fontSize: 11, background: "rgba(215, 249, 139, 0.12)", color: "var(--p-accent)", borderColor: "transparent" }}>
            LIVE 4-STEMS
          </span>
        </div>
        <div className="mono" style={{ fontSize: "var(--t-small)", color: "var(--p-muted)", letterSpacing: "0.03em" }}>
          124 BPM · 8A (Am)
        </div>
      </div>

      {/* 4 Stem Channels */}
      <div style={{ display: "grid", gap: "var(--s-3)" }}>
        {tracks.map((track, idx) => {
          const Icon = track.icon;
          const isSilent = track.muted || (tracks.some((t) => t.solo) && !track.solo);

          return (
            <div
              key={track.id}
              className="stem-channel-strip"
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(90px, 120px) 1fr auto",
                alignItems: "center",
                gap: "var(--s-2)",
                background: "rgba(255,255,255,0.02)",
                padding: "8px 10px",
                borderRadius: "var(--r-sm)",
                border: "1px solid",
                borderColor: isSilent ? "transparent" : "rgba(255,255,255,0.06)",
                opacity: isSilent ? 0.45 : 1,
                transition: "opacity var(--dur) var(--ease), border-color var(--dur) var(--ease)"
              }}
            >
              {/* Channel Label */}
              <div style={{ display: "flex", alignItems: "center", gap: "var(--s-2)" }}>
                <span style={{ color: track.color, display: "flex" }}>
                  <Icon size={16} />
                </span>
                <span style={{ fontSize: "var(--t-small)", fontWeight: 500, color: "var(--p-ink)", whiteSpace: "nowrap" }}>
                  {locale === "th" ? track.name.split(" ")[0] : track.nameEn}
                </span>
              </div>

              {/* Dynamic Waveform Visualizer */}
              <div style={{ height: 24, display: "flex", alignItems: "center", gap: 3, overflow: "hidden" }}>
                {Array.from({ length: 28 }, (_, i) => {
                  const baseHeight = 15 + Math.abs(Math.sin(i * 0.45 + idx * 1.5)) * 60;
                  const animatedHeight = playing && !isSilent
                    ? Math.min(100, Math.max(10, baseHeight + Math.sin((currentTime * 10 + i * 1.2) * 1.5) * 35))
                    : baseHeight * 0.6;

                  return (
                    <span
                      key={i}
                      style={{
                        flex: 1,
                        height: `${animatedHeight}%`,
                        background: isSilent ? "var(--p-muted)" : track.color,
                        opacity: isSilent ? 0.2 : 0.85,
                        borderRadius: 1,
                        transition: "height 80ms ease, background 150ms ease"
                      }}
                    />
                  );
                })}
              </div>

              {/* Controls: Volume + Solo + Mute */}
              <div style={{ display: "flex", alignItems: "center", gap: "var(--s-2)", justifyContent: "flex-end" }}>
                <input
                  type="range"
                  min="0"
                  max="1.5"
                  step="0.05"
                  value={track.volume}
                  onChange={(e) => setVolume(track.id, parseFloat(e.target.value))}
                  aria-label={`${track.name} Volume`}
                  style={{
                    width: 64,
                    height: 4,
                    accentColor: track.color,
                    cursor: "pointer"
                  }}
                />
                <button
                  type="button"
                  onClick={() => toggleSolo(track.id)}
                  aria-pressed={track.solo}
                  style={{
                    width: 26,
                    height: 24,
                    borderRadius: 4,
                    fontSize: 11,
                    fontWeight: 700,
                    border: "1px solid",
                    borderColor: track.solo ? "#e6a23c" : "var(--line)",
                    background: track.solo ? "#e6a23c" : "transparent",
                    color: track.solo ? "#111" : "var(--p-muted)",
                    cursor: "pointer",
                    padding: 0
                  }}
                >
                  S
                </button>
                <button
                  type="button"
                  onClick={() => toggleMute(track.id)}
                  aria-pressed={track.muted}
                  style={{
                    width: 26,
                    height: 24,
                    borderRadius: 4,
                    fontSize: 11,
                    fontWeight: 700,
                    border: "1px solid",
                    borderColor: track.muted ? "#f56c6c" : "var(--line)",
                    background: track.muted ? "#f56c6c" : "transparent",
                    color: track.muted ? "#fff" : "var(--p-muted)",
                    cursor: "pointer",
                    padding: 0
                  }}
                >
                  M
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Transport & Master Bar */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "var(--s-4)", paddingTop: "var(--s-3)", borderTop: "1px solid var(--line)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--s-3)" }}>
          <button
            type="button"
            className="btn btn--primary"
            onClick={togglePlay}
            style={{ height: 38, padding: "0 var(--s-4)", borderRadius: "var(--r-btn)" }}
          >
            {playing ? <Pause size={15} /> : <Play size={15} fill="currentColor" />}
            <span>{playing ? tr("หยุดชั่วคราว") : tr("เล่นตัวอย่างสด")}</span>
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
          <span className="mono" style={{ fontSize: "var(--t-small)", color: "var(--p-ink)", letterSpacing: "0.05em" }}>
            {formatTime(currentTime)} / 01:30
          </span>
        </div>

        {/* Master Volume */}
        <div style={{ display: "flex", alignItems: "center", gap: "var(--s-1)", flexShrink: 0 }}>
          <button
            type="button"
            onClick={() => setMasterVolume((v) => (v > 0 ? 0 : 0.85))}
            style={{ color: "var(--p-muted)", display: "flex", padding: 2 }}
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
