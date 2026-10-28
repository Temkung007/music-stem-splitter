"use client";

import React, { useState, useRef, useEffect } from "react";
import {
  Music2,
  Mic2,
  Disc3,
  Sliders,
  Volume2,
  VolumeX,
  Play,
  Pause,
  RotateCcw,
  Download,
  Upload,
  CheckCircle2,
  Sparkles,
  Layers,
  Cpu,
  RefreshCw,
  FolderArchive,
  Volume1,
  FileAudio,
} from "lucide-react";
import confetti from "canvas-confetti";

interface StemData {
  filename: string;
  url: string;
  peaks: number[];
  size_bytes?: number;
}

interface TaskResult {
  id: string;
  filename: string;
  stems_mode: string;
  status: "queued" | "processing" | "completed" | "failed";
  progress: number;
  message: string;
  stems: Record<string, StemData>;
  original?: {
    filename: string;
    url: string;
    peaks: number[];
  };
}

interface StemControl {
  name: string;
  label: string;
  icon: string;
  color: string;
  textColor: string;
  borderColor: string;
  glowClass: string;
  volume: number; // 0 to 1.5
  muted: boolean;
  solo: boolean;
}

const STEM_CONFIGS: Record<string, { label: string; icon: string; color: string; textColor: string; borderColor: string; glowClass: string }> = {
  vocals: {
    label: "เสียงร้อง (Vocals)",
    icon: "🎤",
    color: "#06b6d4",
    textColor: "text-cyan-400",
    borderColor: "border-cyan-500/40",
    glowClass: "glow-cyan",
  },
  drums: {
    label: "กลอง (Drums)",
    icon: "🥁",
    color: "#f59e0b",
    textColor: "text-amber-400",
    borderColor: "border-amber-500/40",
    glowClass: "glow-amber",
  },
  bass: {
    label: "เบส (Bass)",
    icon: "🎸",
    color: "#a855f7",
    textColor: "text-purple-400",
    borderColor: "border-purple-500/40",
    glowClass: "glow-purple",
  },
  other: {
    label: "ดนตรีอื่นๆ (Instruments)",
    icon: "🎹",
    color: "#10b981",
    textColor: "text-emerald-400",
    borderColor: "border-emerald-500/40",
    glowClass: "glow-emerald",
  },
  no_vocals: {
    label: "ดนตรีล้วน (Karaoke/Instrumental)",
    icon: "🎵",
    color: "#ec4899",
    textColor: "text-pink-400",
    borderColor: "border-pink-500/40",
    glowClass: "glow-cyan",
  },
};

export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [stemsMode, setStemsMode] = useState<"4stems" | "2stems">("4stems");
  const [modelName, setModelName] = useState<string>("htdemucs");
  const [isUploading, setIsUploading] = useState(false);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [taskData, setTaskData] = useState<TaskResult | null>(null);
  const [systemHealth, setSystemHealth] = useState<{
    device?: string;
    demucs_available?: boolean;
    ffmpeg_available?: boolean;
  } | null>(null);

  // Playback state
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isLooping, setIsLooping] = useState(false);
  const [masterVolume, setMasterVolume] = useState(1.0);

  // Stems controls
  const [stemControls, setStemControls] = useState<Record<string, StemControl>>({});

  // Audio elements references for synchronization
  const audioRefs = useRef<Record<string, HTMLAudioElement>>({});
  const animationFrameRef = useRef<number | null>(null);

  // Check system health on load
  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then((data) => setSystemHealth(data))
      .catch((err) => console.log("Backend offline or waiting:", err));
  }, []);

  // Poll task progress
  useEffect(() => {
    if (!taskId) return;

    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/tasks/${taskId}`);
        if (!res.ok) return;
        const data: TaskResult = await res.json();
        setTaskData(data);

        if (data.status === "completed") {
          clearInterval(interval);
          setIsUploading(false);
          confetti({
            particleCount: 80,
            spread: 70,
            origin: { y: 0.6 },
          });

          // Initialize controls for stems
          const controls: Record<string, StemControl> = {};
          Object.keys(data.stems).forEach((stemKey) => {
            const conf = STEM_CONFIGS[stemKey] || {
              label: stemKey.toUpperCase(),
              icon: "🎵",
              color: "#38bdf8",
              textColor: "text-sky-400",
              borderColor: "border-sky-500/40",
              glowClass: "glow-cyan",
            };
            controls[stemKey] = {
              name: stemKey,
              ...conf,
              volume: 1.0,
              muted: false,
              solo: false,
            };
          });
          setStemControls(controls);
        } else if (data.status === "failed") {
          clearInterval(interval);
          setIsUploading(false);
        }
      } catch (err) {
        console.error("Polling error:", err);
      }
    }, 1500);

    return () => clearInterval(interval);
  }, [taskId]);

  // Audio synchronization loop
  useEffect(() => {
    const updateTime = () => {
      const firstAudio = Object.values(audioRefs.current)[0];
      if (firstAudio) {
        setCurrentTime(firstAudio.currentTime);
        if (firstAudio.duration && !isNaN(firstAudio.duration)) {
          setDuration(firstAudio.duration);
        }
        if (firstAudio.ended) {
          if (isLooping) {
            handleSeek(0);
            handlePlay();
          } else {
            setIsPlaying(false);
          }
        }
      }
      if (isPlaying) {
        animationFrameRef.current = requestAnimationFrame(updateTime);
      }
    };

    if (isPlaying) {
      animationFrameRef.current = requestAnimationFrame(updateTime);
    } else if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
    }

    return () => {
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    };
  }, [isPlaying, isLooping]);

  // Update audio element volumes when stem controls or master volume changes
  useEffect(() => {
    const hasSolo = Object.values(stemControls).some((c) => c.solo);

    Object.entries(stemControls).forEach(([key, ctrl]) => {
      const audio = audioRefs.current[key];
      if (audio) {
        if (ctrl.muted || (hasSolo && !ctrl.solo)) {
          audio.volume = 0;
        } else {
          audio.volume = Math.min(1.0, Math.max(0, ctrl.volume * masterVolume));
        }
      }
    });
  }, [stemControls, masterVolume]);

  const handleFileDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      setFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
    }
  };

  const handleStartSeparation = async () => {
    if (!file) return;

    setIsUploading(true);
    const formData = new FormData();
    formData.append("file", file);
    formData.append("stems_mode", stemsMode);
    formData.append("model_name", modelName);

    try {
      const res = await fetch("/api/separate", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      setTaskId(data.task_id);
    } catch (err) {
      console.error("Separation request error:", err);
      setIsUploading(false);
      alert("เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์");
    }
  };

  const handleTryDemo = async () => {
    setIsUploading(true);
    try {
      const res = await fetch("/api/demo-audio", { method: "POST" });
      const data = await res.json();
      setTaskId(data.task_id);
    } catch (err) {
      console.error("Demo request error:", err);
      setIsUploading(false);
      alert("ไม่สามารถสร้างไฟล์ตัวอย่างได้");
    }
  };

  // Playback handlers
  const handlePlay = () => {
    Object.values(audioRefs.current).forEach((audio) => {
      audio.play().catch((e) => console.log("Audio play prevented:", e));
    });
    setIsPlaying(true);
  };

  const handlePause = () => {
    Object.values(audioRefs.current).forEach((audio) => {
      audio.pause();
    });
    setIsPlaying(false);
  };

  const handleSeek = (time: number) => {
    setCurrentTime(time);
    Object.values(audioRefs.current).forEach((audio) => {
      audio.currentTime = time;
    });
  };

  const handleResetTracks = () => {
    handleSeek(0);
    handlePause();
  };

  // Stem control toggles
  const toggleMute = (stemKey: string) => {
    setStemControls((prev) => ({
      ...prev,
      [stemKey]: { ...prev[stemKey], muted: !prev[stemKey].muted },
    }));
  };

  const toggleSolo = (stemKey: string) => {
    setStemControls((prev) => {
      const isCurrentSolo = prev[stemKey].solo;
      const updated: Record<string, StemControl> = {};
      Object.keys(prev).forEach((k) => {
        updated[k] = {
          ...prev[k],
          solo: k === stemKey ? !isCurrentSolo : false,
        };
      });
      return updated;
    });
  };

  const setVolume = (stemKey: string, volume: number) => {
    setStemControls((prev) => ({
      ...prev,
      [stemKey]: { ...prev[stemKey], volume },
    }));
  };

  // Preset handlers
  const applyPreset = (preset: "acapella" | "karaoke" | "drumbass" | "reset") => {
    setStemControls((prev) => {
      const next = { ...prev };
      Object.keys(next).forEach((k) => {
        next[k] = { ...next[k], solo: false, muted: false, volume: 1.0 };
      });

      if (preset === "acapella") {
        if (next["vocals"]) next["vocals"].solo = true;
      } else if (preset === "karaoke") {
        if (next["vocals"]) next["vocals"].muted = true;
      } else if (preset === "drumbass") {
        if (next["drums"]) next["drums"].solo = true;
        if (next["bass"]) next["bass"].solo = true;
      }
      return next;
    });
  };

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  };

  return (
    <div className="min-h-screen flex flex-col justify-between">
      {/* Top Navigation */}
      <header className="border-b border-slate-800/80 bg-slate-950/60 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-cyan-500 via-indigo-500 to-purple-500 p-0.5 flex items-center justify-center shadow-lg shadow-cyan-500/20">
              <div className="w-full h-full bg-slate-950 rounded-[10px] flex items-center justify-center">
                <Disc3 className="w-5 h-5 text-cyan-400 animate-spin-slow" />
              </div>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-extrabold text-lg tracking-tight bg-gradient-to-r from-cyan-400 via-teal-300 to-indigo-300 bg-clip-text text-transparent">
                  StemX Studio
                </span>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-cyan-950/80 text-cyan-300 border border-cyan-800/50 font-medium">
                  v1.0 AI
                </span>
              </div>
              <p className="text-xs text-slate-400">ระบบแยกสเต็ป/สเต็มไฟล์เพลงระดับมืออาชีพ</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {systemHealth && (
              <div className="hidden sm:flex items-center gap-2 text-xs bg-slate-900/90 border border-slate-800 px-3 py-1.5 rounded-lg text-slate-300">
                <Cpu className="w-3.5 h-3.5 text-cyan-400" />
                <span>
                  Hardware: <strong className="text-cyan-300 uppercase">{systemHealth.device || "CPU"}</strong>
                </span>
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              </div>
            )}
            <button
              onClick={handleTryDemo}
              disabled={isUploading}
              className="text-xs font-medium px-3.5 py-1.5 rounded-lg bg-indigo-950/60 hover:bg-indigo-900/80 text-indigo-300 border border-indigo-800/60 transition flex items-center gap-1.5"
            >
              <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
              ลองไฟล์เพลงตัวอย่าง
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 flex-1 w-full">
        {/* Upload Deck if no completed task */}
        {!taskData || taskData.status !== "completed" ? (
          <div className="max-w-3xl mx-auto space-y-8 py-6">
            <div className="text-center space-y-3">
              <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-white">
                แยกท่อนและ Stems ไฟล์เพลงด้วย{" "}
                <span className="bg-gradient-to-r from-cyan-400 to-indigo-400 bg-clip-text text-transparent">
                  AI Deep Learning
                </span>
              </h1>
              <p className="text-slate-400 text-sm sm:text-base max-w-xl mx-auto">
                อัปโหลดเพลงโปรดเพื่อแยกเสียงร้อง (Vocals), กลอง (Drums), เบส (Bass) และเครื่องดนตรี (Instruments)
                แบบแยกแทร็คชัดเจน พร้อมมิกเซอร์ควบคุมในตัว
              </p>
            </div>

            {/* Upload Box */}
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleFileDrop}
              className={`relative border-2 border-dashed rounded-2xl p-8 sm:p-12 text-center transition-all duration-300 ${
                file
                  ? "border-cyan-500/60 bg-cyan-950/10"
                  : "border-slate-800 hover:border-slate-700 bg-slate-900/40"
              }`}
            >
              <input
                type="file"
                id="audio-input"
                accept="audio/*,.mp3,.wav,.flac,.m4a,.aac,.ogg"
                onChange={handleFileSelect}
                className="hidden"
              />

              {file ? (
                <div className="space-y-4">
                  <div className="w-16 h-16 rounded-2xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center mx-auto text-cyan-400 shadow-lg shadow-cyan-500/10">
                    <FileAudio className="w-8 h-8" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-lg text-white">{file.name}</h3>
                    <p className="text-xs text-slate-400 mt-1">
                      ขนาด: {(file.size / (1024 * 1024)).toFixed(2)} MB • พร้อมทำการแยกแทร็ค
                    </p>
                  </div>
                  <label
                    htmlFor="audio-input"
                    className="inline-block text-xs text-slate-400 hover:text-cyan-300 cursor-pointer underline"
                  >
                    เปลี่ยนไฟล์เพลงอื่น
                  </label>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="w-16 h-16 rounded-2xl bg-slate-800/80 border border-slate-700 flex items-center justify-center mx-auto text-cyan-400">
                    <Upload className="w-8 h-8" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-lg text-white">ลากไฟล์เพลงมาวางที่นี่</h3>
                    <p className="text-xs text-slate-400 mt-1">
                      รองรับไฟล์ MP3, WAV, FLAC, M4A, AAC, OGG (สูงสุด 50MB)
                    </p>
                  </div>
                  <label
                    htmlFor="audio-input"
                    className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm font-medium cursor-pointer transition border border-slate-700/80"
                  >
                    <Music2 className="w-4 h-4 text-cyan-400" />
                    เลือกไฟล์จากเครื่อง
                  </label>
                </div>
              )}
            </div>

            {/* Separation Options */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div
                onClick={() => setStemsMode("4stems")}
                className={`p-4 rounded-xl border cursor-pointer transition flex items-start gap-3.5 ${
                  stemsMode === "4stems"
                    ? "border-cyan-500/50 bg-cyan-950/20 text-white shadow-lg shadow-cyan-500/5"
                    : "border-slate-800/80 bg-slate-900/30 text-slate-400 hover:border-slate-700"
                }`}
              >
                <div
                  className={`p-2.5 rounded-lg ${
                    stemsMode === "4stems" ? "bg-cyan-500/20 text-cyan-400" : "bg-slate-800 text-slate-400"
                  }`}
                >
                  <Layers className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="font-semibold text-sm text-slate-200">แยก 4 Stems (แนะนำ)</h4>
                  <p className="text-xs text-slate-400 mt-0.5">
                    แยก 4 แทร็ค: เสียงร้อง, กลอง, เบส, และเมโลดี้/ดนตรีอื่นๆ
                  </p>
                </div>
              </div>

              <div
                onClick={() => setStemsMode("2stems")}
                className={`p-4 rounded-xl border cursor-pointer transition flex items-start gap-3.5 ${
                  stemsMode === "2stems"
                    ? "border-indigo-500/50 bg-indigo-950/20 text-white shadow-lg shadow-indigo-500/5"
                    : "border-slate-800/80 bg-slate-900/30 text-slate-400 hover:border-slate-700"
                }`}
              >
                <div
                  className={`p-2.5 rounded-lg ${
                    stemsMode === "2stems" ? "bg-indigo-500/20 text-indigo-400" : "bg-slate-800 text-slate-400"
                  }`}
                >
                  <Mic2 className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="font-semibold text-sm text-slate-200">แยก 2 Stems (Karaoke)</h4>
                  <p className="text-xs text-slate-400 mt-0.5">
                    แยก 2 แทร็ค: เสียงร้อง (Vocals) + ดนตรีแบ็คกิ้งแทร็ค (Instrumental)
                  </p>
                </div>
              </div>
            </div>

            {/* Action Button & Status */}
            <div className="space-y-4">
              <button
                onClick={handleStartSeparation}
                disabled={!file || isUploading}
                className={`w-full py-3.5 px-6 rounded-xl font-bold text-base transition flex items-center justify-center gap-2 shadow-lg ${
                  file && !isUploading
                    ? "bg-gradient-to-r from-cyan-500 to-indigo-600 hover:from-cyan-400 hover:to-indigo-500 text-white shadow-cyan-500/25 cursor-pointer"
                    : "bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-700/50"
                }`}
              >
                {isUploading ? (
                  <>
                    <RefreshCw className="w-5 h-5 animate-spin text-cyan-300" />
                    กำลังประมวลผลแยกแทร็ค... ({taskData?.progress || 10}%)
                  </>
                ) : (
                  <>
                    <Sliders className="w-5 h-5" />
                    เริ่มแยกแทร็คเพลงทันที
                  </>
                )}
              </button>

              {/* Progress Box */}
              {isUploading && taskData && (
                <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800 space-y-3">
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-slate-300 font-medium flex items-center gap-2">
                      <span className="inline-block w-2 h-2 rounded-full bg-cyan-400 animate-ping" />
                      {taskData.message || "กำลังวิเคราะห์ไฟล์เพลง..."}
                    </span>
                    <span className="text-cyan-400 font-bold">{taskData.progress}%</span>
                  </div>
                  <div className="w-full bg-slate-800 h-2 rounded-full overflow-hidden">
                    <div
                      className="bg-gradient-to-r from-cyan-500 to-indigo-500 h-full transition-all duration-500 rounded-full"
                      style={{ width: `${taskData.progress}%` }}
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          /* Multi-track Stem Mixer Deck */
          <div className="space-y-6">
            {/* Top Deck Info & Master Action */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-5 rounded-2xl bg-slate-900/80 border border-slate-800 shadow-xl">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xs px-2 py-0.5 rounded bg-emerald-950/80 text-emerald-400 border border-emerald-800/60 font-semibold flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3" /> แยกลำโพง/สเต็มสำเร็จ
                  </span>
                  <span className="text-xs text-slate-400">
                    {taskData.stems_mode === "4stems" ? "4 Stems" : "2 Stems"}
                  </span>
                </div>
                <h2 className="text-xl font-bold text-white mt-1">{taskData.filename}</h2>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                <button
                  onClick={() => {
                    setTaskData(null);
                    setTaskId(null);
                    setFile(null);
                  }}
                  className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-slate-300 border border-slate-700 transition flex items-center gap-1.5"
                >
                  <Upload className="w-3.5 h-3.5" />
                  แยกเพลงใหม่
                </button>

                <a
                  href={`/api/download-all/${taskData.id}`}
                  download
                  className="px-4 py-2 rounded-lg bg-gradient-to-r from-cyan-500 to-indigo-600 hover:from-cyan-400 hover:to-indigo-500 text-white text-xs font-bold transition flex items-center gap-1.5 shadow-lg shadow-cyan-500/20"
                >
                  <FolderArchive className="w-4 h-4" />
                  ดาวน์โหลดทุก Stems (.ZIP)
                </a>
              </div>
            </div>

            {/* Master Transport & Preset Control Bar */}
            <div className="p-4 sm:p-5 rounded-2xl bg-slate-900/60 border border-slate-800/90 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                {/* Transport Buttons */}
                <div className="flex items-center gap-3">
                  <button
                    onClick={isPlaying ? handlePause : handlePlay}
                    className="w-12 h-12 rounded-xl bg-gradient-to-r from-cyan-500 to-indigo-600 hover:from-cyan-400 hover:to-indigo-500 text-white flex items-center justify-center shadow-lg shadow-cyan-500/25 transition cursor-pointer"
                  >
                    {isPlaying ? <Pause className="w-6 h-6" /> : <Play className="w-6 h-6 ml-0.5" />}
                  </button>

                  <button
                    onClick={handleResetTracks}
                    title="เริ่มใหม่ (Restart)"
                    className="w-10 h-10 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 flex items-center justify-center transition border border-slate-700/80 cursor-pointer"
                  >
                    <RotateCcw className="w-4 h-4" />
                  </button>

                  <button
                    onClick={() => setIsLooping(!isLooping)}
                    title="วนลูป (Loop)"
                    className={`px-3 py-2 rounded-xl text-xs font-semibold border transition cursor-pointer ${
                      isLooping
                        ? "bg-cyan-950/80 border-cyan-500/60 text-cyan-300"
                        : "bg-slate-800 border-slate-700 text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    Loop: {isLooping ? "ON" : "OFF"}
                  </button>

                  {/* Time readout */}
                  <div className="font-mono text-sm px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-cyan-400">
                    {formatTime(currentTime)} / {formatTime(duration || 0)}
                  </div>
                </div>

                {/* Quick Presets */}
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-xs text-slate-400 font-medium mr-1">Presets:</span>
                  <button
                    onClick={() => applyPreset("acapella")}
                    className="text-xs px-2.5 py-1 rounded-md bg-cyan-950/60 hover:bg-cyan-900/80 text-cyan-300 border border-cyan-800/50 transition cursor-pointer"
                  >
                    🎤 Acapella
                  </button>
                  <button
                    onClick={() => applyPreset("karaoke")}
                    className="text-xs px-2.5 py-1 rounded-md bg-pink-950/60 hover:bg-pink-900/80 text-pink-300 border border-pink-800/50 transition cursor-pointer"
                  >
                    🎵 Karaoke
                  </button>
                  <button
                    onClick={() => applyPreset("drumbass")}
                    className="text-xs px-2.5 py-1 rounded-md bg-amber-950/60 hover:bg-amber-900/80 text-amber-300 border border-amber-800/50 transition cursor-pointer"
                  >
                    🥁 Drum & Bass
                  </button>
                  <button
                    onClick={() => applyPreset("reset")}
                    className="text-xs px-2.5 py-1 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition cursor-pointer"
                  >
                    🔄 รีเซ็ตทั้งหมด
                  </button>
                </div>

                {/* Master Volume */}
                <div className="flex items-center gap-2 min-w-[140px]">
                  {masterVolume === 0 ? (
                    <VolumeX className="w-4 h-4 text-slate-500" />
                  ) : masterVolume < 0.5 ? (
                    <Volume1 className="w-4 h-4 text-cyan-400" />
                  ) : (
                    <Volume2 className="w-4 h-4 text-cyan-400" />
                  )}
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.01"
                    value={masterVolume}
                    onChange={(e) => setMasterVolume(parseFloat(e.target.value))}
                    className="w-full accent-cyan-400 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
                  />
                </div>
              </div>

              {/* Master Scrubber Timeline */}
              <div className="relative pt-2">
                <input
                  type="range"
                  min="0"
                  max={duration || 100}
                  step="0.1"
                  value={currentTime}
                  onChange={(e) => handleSeek(parseFloat(e.target.value))}
                  className="w-full h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-cyan-400"
                />
              </div>
            </div>

            {/* Individual Stem Channel Strips */}
            <div className="space-y-3">
              {Object.entries(taskData.stems).map(([key, stem]) => {
                const ctrl = stemControls[key] || {
                  name: key,
                  label: key.toUpperCase(),
                  icon: "🎵",
                  color: "#38bdf8",
                  textColor: "text-sky-400",
                  borderColor: "border-sky-500/40",
                  glowClass: "glow-cyan",
                  volume: 1.0,
                  muted: false,
                  solo: false,
                };

                const progressRatio = duration > 0 ? currentTime / duration : 0;

                return (
                  <div
                    key={key}
                    className={`p-4 rounded-xl border transition-all duration-200 bg-slate-900/60 backdrop-blur-sm ${
                      ctrl.muted
                        ? "opacity-60 border-slate-800/80"
                        : ctrl.solo
                        ? `${ctrl.borderColor} ${ctrl.glowClass} bg-slate-900/90`
                        : "border-slate-800/80 hover:border-slate-700"
                    }`}
                  >
                    {/* Hidden Audio Element */}
                    <audio
                      ref={(el) => {
                        if (el) audioRefs.current[key] = el;
                      }}
                      src={stem.url}
                      preload="auto"
                    />

                    <div className="flex flex-col lg:flex-row lg:items-center gap-4">
                      {/* Stem Identity & Track Info */}
                      <div className="w-full lg:w-48 flex items-center justify-between lg:justify-start gap-3">
                        <div className="flex items-center gap-2.5">
                          <span className="text-xl">{ctrl.icon}</span>
                          <div>
                            <h4 className={`font-bold text-sm ${ctrl.textColor}`}>{ctrl.label}</h4>
                            <p className="text-[11px] text-slate-400">
                              {stem.filename}
                            </p>
                          </div>
                        </div>

                        {/* Mobile solo/mute buttons */}
                        <div className="flex lg:hidden items-center gap-1.5">
                          <button
                            onClick={() => toggleSolo(key)}
                            className={`w-7 h-7 rounded text-xs font-bold transition cursor-pointer ${
                              ctrl.solo
                                ? "bg-amber-500 text-black font-extrabold shadow-sm shadow-amber-500/50"
                                : "bg-slate-800 text-slate-400 hover:text-white"
                            }`}
                          >
                            S
                          </button>
                          <button
                            onClick={() => toggleMute(key)}
                            className={`w-7 h-7 rounded text-xs font-bold transition cursor-pointer ${
                              ctrl.muted
                                ? "bg-rose-500 text-white font-extrabold shadow-sm shadow-rose-500/50"
                                : "bg-slate-800 text-slate-400 hover:text-white"
                            }`}
                          >
                            M
                          </button>
                        </div>
                      </div>

                      {/* Interactive Waveform Display */}
                      <div
                        onClick={(e) => {
                          const rect = e.currentTarget.getBoundingClientRect();
                          const clickX = e.clientX - rect.left;
                          const ratio = clickX / rect.width;
                          if (duration > 0) handleSeek(ratio * duration);
                        }}
                        className="flex-1 h-14 bg-slate-950/90 rounded-lg p-2 border border-slate-800/80 relative flex items-center gap-[2px] cursor-pointer overflow-hidden group"
                      >
                        {/* Playhead line */}
                        <div
                          className="absolute top-0 bottom-0 w-[2px] bg-white z-20 shadow-md shadow-white transition-all pointer-events-none"
                          style={{ left: `${progressRatio * 100}%` }}
                        />

                        {/* Waveform bars */}
                        {stem.peaks && stem.peaks.length > 0 ? (
                          stem.peaks.map((val, idx) => {
                            const barRatio = idx / stem.peaks.length;
                            const isPast = barRatio <= progressRatio;
                            return (
                              <div
                                key={idx}
                                className="flex-1 rounded-sm transition-all"
                                style={{
                                  height: `${Math.max(12, val * 100)}%`,
                                  backgroundColor: isPast ? ctrl.color : "#334155",
                                  opacity: ctrl.muted ? 0.3 : isPast ? 0.95 : 0.4,
                                }}
                              />
                            );
                          })
                        ) : (
                          <div className="w-full text-center text-xs text-slate-500">
                            ไม่มีข้อมูล Waveform
                          </div>
                        )}
                      </div>

                      {/* Controls Strip (Solo, Mute, Fader, Download) */}
                      <div className="flex items-center justify-between lg:justify-end gap-3 min-w-[280px]">
                        {/* Desktop Solo & Mute Buttons */}
                        <div className="hidden lg:flex items-center gap-1.5">
                          <button
                            onClick={() => toggleSolo(key)}
                            title="Solo: ฟังเฉพาะเสียงนี้"
                            className={`w-8 h-8 rounded-lg text-xs font-bold transition cursor-pointer ${
                              ctrl.solo
                                ? "bg-amber-500 text-black font-extrabold shadow-md shadow-amber-500/30"
                                : "bg-slate-800 text-slate-400 hover:text-slate-100 hover:bg-slate-700"
                            }`}
                          >
                            S
                          </button>
                          <button
                            onClick={() => toggleMute(key)}
                            title="Mute: ปิดเสียงนี้"
                            className={`w-8 h-8 rounded-lg text-xs font-bold transition cursor-pointer ${
                              ctrl.muted
                                ? "bg-rose-500 text-white font-extrabold shadow-md shadow-rose-500/30"
                                : "bg-slate-800 text-slate-400 hover:text-slate-100 hover:bg-slate-700"
                            }`}
                          >
                            M
                          </button>
                        </div>

                        {/* Track Volume Fader Slider */}
                        <div className="flex items-center gap-2 flex-1 max-w-[140px]">
                          <input
                            type="range"
                            min="0"
                            max="1.5"
                            step="0.02"
                            value={ctrl.volume}
                            disabled={ctrl.muted}
                            onChange={(e) => setVolume(key, parseFloat(e.target.value))}
                            className="w-full accent-cyan-400 h-1.5 bg-slate-800 rounded-lg cursor-pointer disabled:opacity-40"
                          />
                          <span className="text-[11px] font-mono text-slate-400 w-8 text-right">
                            {Math.round(ctrl.volume * 100)}%
                          </span>
                        </div>

                        {/* Download Stem Button */}
                        <a
                          href={stem.url}
                          download={`${taskData.filename.replace(/\.[^/.]+$/, "")}_${key}.wav`}
                          title={`ดาวน์โหลด ${ctrl.label}`}
                          className="w-8 h-8 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-cyan-400 flex items-center justify-center transition border border-slate-700/80 cursor-pointer"
                        >
                          <Download className="w-4 h-4" />
                        </a>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-800/80 py-6 text-center text-xs text-slate-500">
        <p>StemX Studio • Powered by Demucs AI & Web Audio • Separate any track into clean stems</p>
      </footer>
    </div>
  );
}
