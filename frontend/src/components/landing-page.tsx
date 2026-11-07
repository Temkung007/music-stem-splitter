"use client";

import { useState } from "react";
import Image from "next/image";
import { useLocale, LanguageSwitcher } from "@/components/locale-provider";
import { InteractiveHeroMixer } from "@/components/interactive-hero-mixer";
import {
  AudioLines,
  Disc3,
  HardDrive,
  Cpu,
  Layers,
  ArrowRight,
  ShieldCheck,
  Zap,
  Sliders,
  CheckCircle2,
  X,
  Eye,
  EyeOff,
  LoaderCircle,
  FolderSync,
  Sparkles,
} from "lucide-react";
import { api, jsonRequest, type User } from "@/lib/api";

interface LandingPageProps {
  onSuccess: (user: User) => void;
}

export function LandingPage({ onSuccess }: LandingPageProps) {
  const { t: tr, locale } = useLocale();

  // Auth modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // Quick Demo Login
  const instantDemoLogin = async () => {
    setBusy(true);
    setError("");
    const demoEmail = "demo@stemora.io";
    const demoPassword = "demopassword123";
    try {
      const result = await api<User>(
        "/api/auth/login",
        jsonRequest("POST", { email: demoEmail, password: demoPassword })
      );
      onSuccess(result);
      setModalOpen(false);
    } catch {
      try {
        const result = await api<User>(
          "/api/auth/register",
          jsonRequest("POST", { email: demoEmail, password: demoPassword, name: "Demo DJ" })
        );
        onSuccess(result);
        setModalOpen(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : tr("เข้าสู่ระบบไม่สำเร็จ"));
      }
    } finally {
      setBusy(false);
    }
  };

  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await api<User>(
        `/api/auth/${mode}`,
        jsonRequest("POST", { email, password, name: name || "DJ" })
      );
      onSuccess(result);
      setModalOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : tr("เข้าสู่ระบบไม่สำเร็จ"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {/* 1. FIXED NAV BAR (Taste-Skill Standard: header.nav > .wrap.nav__bar) */}
      <header className="nav">
        <div className="wrap nav__bar">
          <a className="nav__logo" href="#top">
            <span className="mark" data-mark="stack" aria-hidden="true"></span>
            STEMORA
          </a>

          <nav className="nav__links" aria-label="Main">
            <div className="nav__item">
              <a className="nav__link" href="#stems">
                {tr("ระบบแยกเสียง")}
              </a>
            </div>
            <div className="nav__item">
              <a className="nav__link" href="#features">
                {tr("ฟีเจอร์เด่น")}
              </a>
            </div>
            <div className="nav__item">
              <a className="nav__link" href="#pipeline">
                {tr("สถาปัตยกรรม")}
              </a>
            </div>
            <div className="nav__item">
              <a className="nav__link" href="#faq">
                {tr("คำถามที่พบบ่อย")}
              </a>
            </div>
          </nav>

          <div className="nav__actions">
            <LanguageSwitcher />
            <button
              type="button"
              className="btn btn--primary"
              style={{ height: 44, fontSize: 15 }}
              onClick={() => { setMode("login"); setError(""); setModalOpen(true); }}
            >
              <span>{tr("เข้าสู่ระบบ")}</span>
              <svg className="m-arrow" viewBox="0 0 12 12" aria-hidden="true">
                <path className="m-arrow__stem" d="M1 6h8" />
                <path className="m-arrow__head" d="M4.5 2.5 8 6l-3.5 3.5" />
              </svg>
            </button>
          </div>
        </div>
      </header>

      {/* 2. MAIN CONTAINER WITH EXACT TASTE-SKILL SECTIONS */}
      <main id="top">
        {/* HERO SECTION: Exactly One Screen (100svh) */}
        <section className="hero hero--split" aria-labelledby="hero-h">
          <div className="wrap">
            <div className="hero-text hero-split grid">
              {/* Left Column: Hero Copy (span-6) */}
              <div className="hero-copy span-6">
                <p className="hero-notice">
                  <b>DEMUCS v4 NEURAL DSP</b> · BETA · 0MS WEBAUDIO LATENCY
                </p>

                <h1 id="hero-h" style={{ letterSpacing: "-0.03em" }}>
                  DJ Workspace <br />
                  <span style={{ color: "var(--p-accent)" }}>&amp; Stem Studio</span>
                </h1>

                <p className="hero__lead" style={{ color: "var(--p-ink)" }}>
                  {tr("ระบบแยก 4 สเตมเสียงร้อง กลอง เบส และเครื่องดนตรีด้วย Demucs v4 Neural DSP พร้อม WebAudio 32-bit Float บนคลาวด์และ WebGPU ฟรี 200 MB S3")}
                </p>

                <div className="btn-row">
                  <button
                    type="button"
                    className="btn btn--primary"
                    style={{ height: 44, fontSize: 15 }}
                    onClick={() => { setMode("register"); setError(""); setModalOpen(true); }}
                  >
                    <span>{tr("เปิดสตูดิโอของคุณฟรี")}</span>
                    <svg className="m-arrow" viewBox="0 0 12 12" aria-hidden="true">
                      <path className="m-arrow__stem" d="M1 6h8" />
                      <path className="m-arrow__head" d="M4.5 2.5 8 6l-3.5 3.5" />
                    </svg>
                  </button>
                  <a
                    href="#stems"
                    className="btn btn--secondary"
                    style={{ height: 44, fontSize: 14 }}
                  >
                    <span>{locale === "th" ? "ดูโครงสร้าง 4 สเต็ม" : "Explore 4-Stem DSP"}</span>
                  </a>
                </div>

                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 18 }}>
                  <span className="pill mono" style={{ height: 24, fontSize: 11, background: "rgba(255,255,255,0.03)", borderColor: "rgba(255,255,255,0.08)" }}>
                    24-bit Lossless
                  </span>
                  <span className="pill mono" style={{ height: 24, fontSize: 11, background: "rgba(255,255,255,0.03)", borderColor: "rgba(255,255,255,0.08)" }}>
                    WebGPU Offline
                  </span>
                  <span className="pill mono" style={{ height: 24, fontSize: 11, background: "rgba(255,255,255,0.03)", borderColor: "rgba(255,255,255,0.08)" }}>
                    200 MB S3 Storage
                  </span>
                  <span className="pill mono" style={{ height: 24, fontSize: 11, color: "var(--p-accent)", background: "rgba(215,249,139,0.05)", borderColor: "rgba(215,249,139,0.2)" }}>
                    Zero Logs Privacy
                  </span>
                </div>

                <dl className="hero-facts" style={{ marginTop: 22 }}>
                  <div style={{ padding: "10px 14px", background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 6 }}>
                    <dt style={{ fontSize: 11, letterSpacing: "0.04em", textTransform: "uppercase" }}>{locale === "th" ? "แยก 4 แทร็ก" : "4-Stem Matrix"}</dt>
                    <dd style={{ fontSize: 13, fontWeight: 600, color: "var(--p-ink)", marginTop: 2 }}>Demucs v4 Neural</dd>
                  </div>
                  <div style={{ padding: "10px 14px", background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 6 }}>
                    <dt style={{ fontSize: 11, letterSpacing: "0.04em", textTransform: "uppercase" }}>{locale === "th" ? "ความหน่วงต่ำ" : "Zero Latency"}</dt>
                    <dd style={{ fontSize: 13, fontWeight: 600, color: "var(--p-accent)", marginTop: 2 }}>0ms DSP Engine</dd>
                  </div>
                  <div style={{ padding: "10px 14px", background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 6 }}>
                    <dt style={{ fontSize: 11, letterSpacing: "0.04em", textTransform: "uppercase" }}>{locale === "th" ? "คลังเพลงส่วนตัว" : "Private Storage"}</dt>
                    <dd style={{ fontSize: 13, fontWeight: 600, color: "var(--p-ink)", marginTop: 2 }}>200 MB Free S3</dd>
                  </div>
                </dl>
              </div>

              {/* Right Column: Live Interactive Stem Mixer Console (span-6 start-7) */}
              <div className="hero-visual frame frame--photo span-6 start-7" data-ui="hero-mixer" data-visual="mixer">
                <InteractiveHeroMixer />
              </div>
            </div>
          </div>
        </section>

        {/* SECTION 2: APP-FRAME STUDIO SHOWCASE */}
        <section id="stems" className="section bg-topglow" aria-labelledby="stems-h">
          <div className="wrap">
            <div className="section-head">
              <h2 id="stems-h">
                {tr("ระบบแยกเสียง 4 แทร็กอย่างหมดจด")}{" "}
                <span className="muted">{tr("ควบคุมมิกเซอร์ DSP 32-bit Float ไม่สูญเสียความละเอียด")}</span>
              </h2>
              <p style={{ color: "var(--p-ink)" }}>
                {tr("ประมวลผลแยกแทร็กด้วย Demucs v4 พร้อมช่องสัญญาณอิสระ Vocals, Drums, Bass, Other เพื่อสร้างมิกซ์หรือรีมิกซ์สดได้ทันที")}
              </p>
            </div>

            <div
              className="panel frame"
              data-ui="stems-console"
              data-visual="stems-dsp"
              style={{
                background: "var(--p-surface)",
                borderColor: "var(--line)",
                borderRadius: "var(--r-lg)",
                overflow: "hidden",
              }}
            >
              {/* App Console Window Bar */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "12px 20px",
                  background: "#141517",
                  borderBottom: "1px solid var(--line)",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#ff5f56" }} />
                  <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#ffbd2e" }} />
                  <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#27c93f" }} />
                  <span className="mono muted" style={{ fontSize: 12, marginLeft: 12, color: "#9fa697" }}>
                    stemora-studio / beta
                  </span>
                </div>
                <div style={{ display: "flex", gap: "var(--s-3)" }}>
                  <span className="pill" style={{ height: 24, fontSize: 11 }}>
                    BPM 126.0
                  </span>
                  <span className="pill" style={{ height: 24, fontSize: 11, color: "var(--p-accent)" }}>
                    Camelot 8A (Am)
                  </span>
                  <span className="pill" style={{ height: 24, fontSize: 11 }}>
                    24-bit 48kHz WAV
                  </span>
                </div>
              </div>

              {/* Multi-Track Waveform Preview */}
              <div style={{ padding: "var(--s-6)", display: "grid", gap: "var(--s-4)" }}>
                {[
                  { name: "VOCALS", color: "#d5b2ff", lufs: "-14.2 LUFS", icon: AudioLines },
                  { name: "DRUMS", color: "#ffb480", lufs: "-10.1 LUFS", icon: Disc3 },
                  { name: "BASS", color: "#80dfff", lufs: "-12.5 LUFS", icon: Layers },
                  { name: "OTHER", color: "#d7f98b", lufs: "-15.8 LUFS", icon: Sliders },
                ].map((track, i) => (
                  <div key={track.name} style={{ display: "grid", gridTemplateColumns: "110px 1fr 90px", alignItems: "center", gap: "var(--s-4)" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ width: 8, height: 8, borderRadius: "50%", background: track.color }} />
                      <span className="mono" style={{ fontSize: 12, fontWeight: 600, color: "var(--p-ink)" }}>{track.name}</span>
                    </div>

                    <div style={{ height: 32, background: "rgba(0,0,0,0.3)", borderRadius: "var(--r-sm)", border: "1px solid var(--line)", padding: "0 10px", display: "flex", alignItems: "center", gap: 3, overflow: "hidden" }}>
                      {Array.from({ length: 48 }, (_, idx) => {
                        const h = 15 + Math.abs(Math.sin((idx * 0.35) + i * 1.8) * Math.cos(idx * 0.12)) * 75;
                        return (
                          <span
                            key={idx}
                            style={{
                              flex: 1,
                              height: `${h}%`,
                              background: track.color,
                              opacity: 0.8,
                              borderRadius: 1
                            }}
                          />
                        );
                      })}
                    </div>

                    <span className="mono muted" style={{ fontSize: 11, textAlign: "right", color: "#9fa697" }}>
                      {track.lufs}
                    </span>
                  </div>
                ))}
              </div>

              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 20px", background: "#141517", borderTop: "1px solid var(--line)" }}>
                <span className="muted" style={{ fontSize: 13, color: "#9fa697" }}>
                  {tr("ปรับเกนแยกอิสระ 0–150%, Solo, Mute และส่งออก Lossless WAV/ZIP")}
                </span>
                <button
                  type="button"
                  className="btn btn--primary"
                  style={{ height: 44, fontSize: 15 }}
                  onClick={() => { setMode("register"); setModalOpen(true); }}
                >
                  <span>{tr("เริ่มแยกเพลงของคุณ")}</span>
                  <ArrowRight size={14} />
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* SECTION 3: FEATURES 1-ROW GRID (Taste-Skill: 4 distinct card variants on 12-col grid) */}
        <section id="features" className="section" aria-labelledby="features-h">
          <div className="wrap">
            <div className="section-head">
              <h2 id="features-h">
                {tr("4 ฟีเจอร์หลักสำหรับ DJ และ Producer")}
              </h2>
              <p style={{ color: "var(--p-ink)" }}>
                {tr("ผสมผสานการวิเคราะห์ความกลมกลืนทางดนตรี Harmonic เข้ากับระบบประมวลผล DSP แม่นยำ")}
              </p>
            </div>

            <div className="grid">
              {/* Card 1: Lead Card */}
              <article
                className="card card--lead span-3"
                data-ui="feature-demucs"
                style={{
                  background: "var(--p-surface)",
                  borderColor: "var(--line)",
                  padding: "var(--s-6)",
                  borderRadius: "var(--r-md)",
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "space-between",
                  minHeight: "440px",
                }}
              >
                <div>
                  <div style={{ width: 44, height: 44, borderRadius: "var(--r-md)", background: "rgba(215, 249, 139, 0.1)", display: "grid", placeItems: "center", color: "var(--p-accent)", marginBottom: "var(--s-4)" }}>
                    <AudioLines size={22} />
                  </div>
                  <h3 style={{ fontSize: 18, fontWeight: 600, margin: "8px 0 12px", color: "var(--p-ink)" }}>
                    {tr("Demucs v4 Neural")}
                  </h3>
                  <p style={{ color: "var(--p-ink)", lineHeight: 1.6, fontSize: 14, marginBottom: 20 }}>
                    {tr("แยกเสียงร้อง กลอง เบส และเครื่องดนตรีด้วย Hybrid Transformer 32-bit Float คมชัดไร้การบีบอัด")}
                  </p>
                </div>
                <div>
                  <span className="pill" style={{ height: 24, fontSize: 11 }}>
                    Lossless 32-bit Float DSP
                  </span>
                </div>
              </article>

              {/* Card 2: Row Card */}
              <article
                className="card card--row span-3"
                data-ui="feature-camelot"
                style={{
                  background: "var(--p-surface)",
                  borderColor: "var(--line)",
                  padding: "var(--s-6)",
                  borderRadius: "var(--r-md)",
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "space-between",
                  minHeight: "440px",
                }}
              >
                <div>
                  <div style={{ width: 44, height: 44, borderRadius: "var(--r-md)", background: "rgba(215, 249, 139, 0.1)", display: "grid", placeItems: "center", color: "var(--p-accent)", marginBottom: "var(--s-4)" }}>
                    <Disc3 size={22} />
                  </div>
                  <h3 style={{ fontSize: 18, fontWeight: 600, margin: "8px 0 12px", color: "var(--p-ink)" }}>
                    {tr("Camelot Wheel AI")}
                  </h3>
                  <p style={{ color: "var(--p-ink)", lineHeight: 1.6, fontSize: 14, marginBottom: 20 }}>
                    {tr("จัดเรียงเพลย์ลิสต์อัตโนมัติตามวงล้อ Camelot 1A–12B และ Energy Curve แนะนำคีย์ที่เข้ากันได้แม่นยำ")}
                  </p>
                </div>
                <div>
                  <span className="pill" style={{ height: 24, fontSize: 11 }}>
                    Harmonic 12A Matching
                  </span>
                </div>
              </article>

              {/* Card 3: Open Card */}
              <article
                className="card card--open span-3"
                data-ui="feature-s3"
                style={{
                  background: "var(--p-surface)",
                  borderColor: "var(--line)",
                  padding: "var(--s-6)",
                  borderRadius: "var(--r-md)",
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "space-between",
                  minHeight: "440px",
                }}
              >
                <div>
                  <div style={{ width: 44, height: 44, borderRadius: "var(--r-md)", background: "rgba(215, 249, 139, 0.1)", display: "grid", placeItems: "center", color: "var(--p-accent)", marginBottom: "var(--s-4)" }}>
                    <HardDrive size={22} />
                  </div>
                  <h3 style={{ fontSize: 18, fontWeight: 600, margin: "8px 0 12px", color: "var(--p-ink)" }}>
                    {tr("Private S3 Storage")}
                  </h3>
                  <p style={{ color: "var(--p-ink)", lineHeight: 1.6, fontSize: 14, marginBottom: 20 }}>
                    {tr("พื้นที่จัดเก็บเพลงส่วนตัว 200 MB บน Garage S3 สตรีมเฉพาะช่วงไบต์ ปลอดภัย เข้ารหัสเฉพาะคุณ")}
                  </p>
                </div>
                <div>
                  <span className="pill" style={{ height: 24, fontSize: 11 }}>
                    200 MB Free S3 Vault
                  </span>
                </div>
              </article>

              {/* Card 4: Split Card */}
              <article
                className="card card--split span-3"
                data-ui="feature-worker"
                style={{
                  background: "var(--p-surface)",
                  borderColor: "var(--line)",
                  padding: "var(--s-6)",
                  borderRadius: "var(--r-md)",
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "space-between",
                  minHeight: "440px",
                }}
              >
                <div>
                  <div style={{ width: 44, height: 44, borderRadius: "var(--r-md)", background: "rgba(215, 249, 139, 0.1)", display: "grid", placeItems: "center", color: "var(--p-accent)", marginBottom: "var(--s-4)" }}>
                    <Cpu size={22} />
                  </div>
                  <h3 style={{ fontSize: 18, fontWeight: 600, margin: "8px 0 12px", color: "var(--p-ink)" }}>
                    {tr("Hybrid WebGPU Engine")}
                  </h3>
                  <p style={{ color: "var(--p-ink)", lineHeight: 1.6, fontSize: 14, marginBottom: 20 }}>
                    {tr("ประมวลผลบนการ์ดจอของคุณด้วย WebGPU ในเบราว์เซอร์ได้ทันที หรือส่งงานเข้าคิวประมวลผลบน Cloud")}
                  </p>
                </div>
                <div>
                  <span className="pill" style={{ height: 24, fontSize: 11 }}>
                    WebGPU & Cloud Workers
                  </span>
                </div>
              </article>
            </div>
          </div>
        </section>

        {/* SECTION 4: AUDIO PIPELINE DIAGRAM (4 stages on 12-column grid, >55% fill) */}
        <section id="pipeline" className="section" aria-labelledby="pipe-h">
          <div className="wrap">
            <div className="section-head">
              <h2 id="pipe-h">
                {tr("สถาปัตยกรรมประมวลผลเสียง 4 ขั้นตอน")}{" "}
                <span className="muted">{tr("จาก Ingest สู่ DJ Set Ready")}</span>
              </h2>
              <p style={{ color: "var(--p-ink)" }}>
                {tr("กระบวนการแปลงไฟล์เสียงแบบไม่สูญเสียคุณภาพ ตั้งแต่ Ingest ไปจนถึง Multi-Track Stem Export")}
              </p>
            </div>

            <div className="grid" data-ui="audio-pipeline">
              {[
                {
                  step: "01",
                  title: tr("นำเข้าไฟล์เสียง"),
                  desc: tr("รองรับไฟล์เสียงความละเอียดสูง WAV 24/32-bit, FLAC, AIFF, MP3, AAC และ OGG ผ่านระบบ Streaming Ingest ขีดจำกัดสูงสุด 50 MB ต่อแทร็ก"),
                  badge: "Lossless Audio Ingest",
                  icon: AudioLines,
                  tag: "Multi-Format"
                },
                {
                  step: "02",
                  title: tr("วิเคราะห์ DSP"),
                  desc: tr("ถอดรหัสและวิเคราะห์ความเร็ว BPM, คีย์เสียงตามวงล้อ Camelot Wheel (1A–12B), ระดับความดัง LUFS และพลังงาน Spectral Centroid ด้วย Librosa"),
                  badge: "Librosa & FFmpeg DSP",
                  icon: Sliders,
                  tag: "Key & Tempo"
                },
                {
                  step: "03",
                  title: tr("แยกเสียง AI"),
                  desc: tr("ประมวลผลแยกช่องสัญญาณด้วย Demucs v4 Hybrid Transformer แยก 4 สเตมอิสระ Vocals, Drums, Bass, Other โดยไม่มี Inter-Channel Bleed"),
                  badge: "Demucs v4 Neural Engine",
                  icon: Layers,
                  tag: "4 Stems Isolation"
                },
                {
                  step: "04",
                  title: tr("มิกเซอร์ WebAudio"),
                  desc: tr("มิกซ์สดด้วย WebAudio 32-bit Float 0ms Latency ปรับเกน 0–150%, Solo, Mute พร้อมส่งออก Lossless WAV/ZIP และเพลย์ลิสต์ Rekordbox M3U8"),
                  badge: "0ms Real-Time Engine",
                  icon: Disc3,
                  tag: "DJ Ready Export"
                },
              ].map((item) => (
                <div
                  key={item.step}
                  className="card span-3"
                  data-ui={`pipe-step-${item.step}`}
                  style={{
                    background: "var(--p-surface)",
                    borderColor: "var(--line)",
                    padding: "var(--s-6)",
                    borderRadius: "var(--r-md)",
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "space-between",
                    minHeight: "440px",
                  }}
                >
                  <div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--s-4)" }}>
                      <span className="mono" style={{ fontSize: 14, color: "var(--p-accent)", fontWeight: 700 }}>
                        STEP {item.step}
                      </span>
                      <item.icon size={20} style={{ color: "var(--p-muted)" }} />
                    </div>
                    <h3 style={{ fontSize: 18, fontWeight: 600, margin: "8px 0 12px", color: "var(--p-ink)" }}>
                      {item.title}
                    </h3>
                    <p style={{ fontSize: 14, lineHeight: 1.6, marginBottom: 20, color: "var(--p-ink)" }}>
                      {item.desc}
                    </p>
                  </div>
                  <div>
                    <span className="pill" style={{ height: 24, fontSize: 11 }}>
                      {item.badge}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* SECTION 5: FAQ SECTION (Taste-Skill Standard: .faq > .faq__item) */}
        <section id="faq" className="section" aria-labelledby="faq-h">
          <div className="wrap">
            <div className="section-head">
              <h2 id="faq-h">
                {tr("คำถามที่พบบ่อย (FAQ) เกี่ยวกับระบบ STEMORA 4 ข้อหลัก")}
              </h2>
              <p style={{ color: "var(--p-ink)" }}>
                {tr("คำตอบสำหรับข้อสงสัยที่พบบ่อยเกี่ยวกับการประมวลผลเสียง ความปลอดภัย และการจัดเก็บข้อมูล")}
              </p>
            </div>

            <div className="faq" data-ui="faq-list">
              <div className="faq__item">
                <h3>{tr("คุณภาพเสียงของ Stems ที่แยกออกมาเทียบกับสตูดิโอเป็นอย่างไร?")}</h3>
                <p>
                  {tr("Demucs v4 Neural Engine ให้คุณภาพเสียงระดับ 32-bit Float คมชัดสูงสุด ไร้การสูญเสียไดนามิกหรือรายละเอียดความถี่")}
                </p>
              </div>

              <div className="faq__item">
                <h3>{tr("ไฟล์เพลงของฉันมีความเป็นส่วนตัวและปลอดภัยแค่ไหนบนระบบ Cloud S3?")}</h3>
                <p>
                  {tr("ไฟล์เสียงทุกไฟล์ถูกจัดเก็บใน S3 Bucket ส่วนตัวที่มีการตรวจสิทธิ์เซสชันเข้มงวด ไม่เปิดเผยสู่สาธารณะ และไม่มีการส่งต่อให้ภายนอก")}
                </p>
              </div>

              <div className="faq__item">
                <h3>{tr("การแยกเสียงบนเบราว์เซอร์ (WebGPU) กับ Cloud Worker แตกต่างกันอย่างไร?")}</h3>
                <p>
                  {tr("WebGPU ทำงานบนการ์ดจอในเครื่องของคุณโดยตรง ส่วน Cloud Worker ประมวลผลบนเซิร์ฟเวอร์ความเร็วสูงสำหรับงานขนาดใหญ่")}
                </p>
              </div>

              <div className="faq__item">
                <h3>{tr("สามารถส่งออกเพลย์ลิสต์ไปใช้งานกับอุปกรณ์และโปรแกรม DJ ชั้นนำได้หรือไม่?")}</h3>
                <p>
                  {tr("รองรับการส่งออก M3U8 Playlist เข้ากันได้กับ Rekordbox, Traktor, Serato และ Engine DJ พร้อมดาวน์โหลด Lossless ZIP")}
                </p>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* 3. CLOSING FOOTER (Taste-Skill Standard: footer.footer.closing directly under body) */}
      <footer className="footer closing" id="contact" aria-labelledby="close-h">
        <div className="wrap">
          <div className="closing__cta close--type">
            <div className="section-head">
              <h2 id="close-h">
                {tr("พร้อมเปิดสตูดิโอและแยกเพลงของคุณหรือยัง?")}
              </h2>
              <p style={{ color: "var(--p-ink)" }}>
                {tr("สร้างบัญชีฟรีวันนี้ รับพื้นที่จัดเก็บ 200 MB และเริ่มแยกเสียงแทร็กแรกของคุณได้ทันที")}
              </p>
            </div>
            <button
              type="button"
              className="btn btn--primary"
              style={{ height: 44, fontSize: 15, width: "100%", maxWidth: 480 }}
              onClick={() => { setMode("register"); setError(""); setModalOpen(true); }}
            >
              <span>{tr("เปิดสตูดิโอของคุณฟรี")}</span>
              <svg className="m-arrow" viewBox="0 0 12 12" aria-hidden="true">
                <path className="m-arrow__stem" d="M1 6h8" />
                <path className="m-arrow__head" d="M4.5 2.5 8 6l-3.5 3.5" />
              </svg>
            </button>
          </div>

          <div className="closing__links">
            <div className="grid">
              <div className="span-4 stack-4">
                <a className="nav__logo" href="#top">
                  <span className="mark" data-mark="stack" aria-hidden="true"></span>
                  STEMORA
                </a>
                <p className="footer__lede">
                  {tr("สตูดิโอแยกเสียงและคลังเพลงส่วนตัวสำหรับ DJ")}
                </p>
              </div>
              <div className="span-2 footer__col">
                <h4>{tr("สตูดิโอ")}</h4>
                <ul>
                  <li><a href="#stems">{tr("ระบบแยกเสียง")}</a></li>
                  <li><a href="#features">{tr("ฟีเจอร์เด่น")}</a></li>
                </ul>
              </div>
              <div className="span-2 footer__col">
                <h4>{tr("ระบบ")}</h4>
                <ul>
                  <li><a href="#pipeline">{tr("สถาปัตยกรรม")}</a></li>
                  <li><a href="#faq">{tr("คำถามที่พบบ่อย")}</a></li>
                </ul>
              </div>
              <div className="span-2 footer__col">
                <h4>{tr("ดีเจ")}</h4>
                <ul>
                  <li><a href="#top">Camelot Wheel</a></li>
                  <li><a href="#top">Harmonic Mixing</a></li>
                </ul>
              </div>
              <div className="span-2 footer__col">
                <h4>{tr("ติดต่อ")}</h4>
                <ul>
                  <li><a href="mailto:contact@stemora.io">contact@stemora.io</a></li>
                  <li><a href="https://github.com/temkung007/music-stem-splitter">GitHub Project</a></li>
                </ul>
              </div>
            </div>

            <div className="footer__legal">
              <span>&copy; {new Date().getFullYear()} STEMORA &nbsp; Private DJ Workspace (Beta)</span>
              <a className="credits" href="#top">Built for DJs &amp; Producers</a>
            </div>
          </div>
        </div>
      </footer>

      {/* 4. TASTE-SKILL AUTH MODAL DIALOG */}
      {modalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 100,
            background: "rgba(0, 0, 0, 0.75)",
            backdropFilter: "blur(16px)",
            display: "grid",
            placeItems: "center",
            padding: "var(--s-4)",
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setModalOpen(false);
          }}
        >
          <div
            className="card"
            style={{
              width: "min(100%, 460px)",
              background: "var(--p-surface)",
              borderColor: "var(--line)",
              borderRadius: "var(--r-lg)",
              padding: "var(--s-6)",
              boxShadow: "0 24px 64px rgba(0, 0, 0, 0.6)",
              position: "relative",
            }}
          >
            {/* Close Button */}
            <button
              type="button"
              className="icon-button"
              style={{ position: "absolute", top: 16, right: 16 }}
              onClick={() => setModalOpen(false)}
              aria-label="Close"
            >
              <X size={18} />
            </button>

            {/* Header */}
            <div style={{ textAlign: "center", marginBottom: "var(--s-5)" }}>
              <div style={{ display: "inline-flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <span className="mark" data-mark="stack" aria-hidden="true"></span>
                <span style={{ font: "500 20px/1 var(--font-display)", letterSpacing: "-0.02em" }}>STEMORA</span>
              </div>
              <h3 style={{ fontSize: 20, fontWeight: 600, color: "var(--p-ink)", margin: "4px 0" }}>
                {mode === "login" ? tr("เข้าสู่ระบบสตูดิโอ") : tr("สร้างบัญชีดีเจใหม่")}
              </h3>
              <p className="muted" style={{ fontSize: 13, color: "#9fa697" }}>
                {mode === "login"
                  ? tr("เข้าสู่ระบบเพื่อเข้าถึงคลังเพลงและมิกเซอร์ส่วนตัว")
                  : tr("รับพื้นที่จัดเก็บฟรี 200 MB และประมวลผล 4 แทร็กทันที")}
              </p>
            </div>

            {/* Quick Demo Login Option */}
            <div style={{ marginBottom: "var(--s-4)" }}>
              <button
                type="button"
                className="btn btn--secondary"
                style={{ width: "100%", justifyContent: "center", height: 42 }}
                onClick={instantDemoLogin}
                disabled={busy}
              >
                <Zap size={16} style={{ color: "var(--p-accent)" }} />
                <span>{tr("เข้าใช้งานด้วย Demo Account (คลิกเดียว)")}</span>
              </button>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "16px 0" }}>
              <div style={{ flex: 1, height: 1, background: "var(--line)" }} />
              <span className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 1, color: "#9fa697" }}>
                {tr("หรือใช้อีเมล")}
              </span>
              <div style={{ flex: 1, height: 1, background: "var(--line)" }} />
            </div>

            {/* Form */}
            <form onSubmit={handleAuthSubmit} style={{ display: "grid", gap: "var(--s-3)" }}>
              {mode === "register" && (
                <div>
                  <label style={{ display: "block", fontSize: 12, fontWeight: 500, marginBottom: 6, color: "var(--p-ink)" }}>
                    {tr("ชื่อดีเจ หรือ ชื่อสตูดิโอ")}
                  </label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="DJ Shadow, Studio 88"
                    required
                    style={{
                      width: "100%",
                      height: 42,
                      padding: "0 12px",
                      background: "#111213",
                      border: "1px solid var(--line)",
                      borderRadius: "var(--r-btn)",
                      color: "var(--p-ink)",
                    }}
                  />
                </div>
              )}

              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 500, marginBottom: 6, color: "var(--p-ink)" }}>
                  {tr("อีเมล")}
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="dj@example.com"
                  required
                  style={{
                    width: "100%",
                    height: 42,
                    padding: "0 12px",
                    background: "#111213",
                    border: "1px solid var(--line)",
                    borderRadius: "var(--r-btn)",
                    color: "var(--p-ink)",
                  }}
                />
              </div>

              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 500, marginBottom: 6, color: "var(--p-ink)" }}>
                  {tr("รหัสผ่าน")}
                </label>
                <div style={{ position: "relative" }}>
                  <input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••••••"
                    required
                    minLength={8}
                    style={{
                      width: "100%",
                      height: 42,
                      padding: "0 40px 0 12px",
                      background: "#111213",
                      border: "1px solid var(--line)",
                      borderRadius: "var(--r-btn)",
                      color: "var(--p-ink)",
                    }}
                  />
                  <button
                    type="button"
                    style={{
                      position: "absolute",
                      right: 10,
                      top: "50%",
                      transform: "translateY(-50%)",
                      background: "none",
                      border: "none",
                      color: "var(--p-muted)",
                      cursor: "pointer",
                    }}
                    onClick={() => setShowPassword(!showPassword)}
                  >
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

              {error && (
                <div
                  style={{
                    padding: "10px 14px",
                    borderRadius: "var(--r-btn)",
                    background: "rgba(255, 95, 86, 0.1)",
                    border: "1px solid rgba(255, 95, 86, 0.3)",
                    color: "#ff8080",
                    fontSize: 13,
                  }}
                >
                  {error}
                </div>
              )}

              <button
                type="submit"
                className="btn btn--primary"
                style={{ width: "100%", height: 44, justifyContent: "center", marginTop: 8 }}
                disabled={busy}
              >
                {busy && <LoaderCircle size={16} className="animate-spin" />}
                <span>
                  {mode === "login" ? tr("เข้าสู่ระบบสตูดิโอ") : tr("ลงทะเบียนและเริ่มใช้งาน")}
                </span>
              </button>
            </form>

            {/* Toggle Mode */}
            <div style={{ textAlign: "center", marginTop: 16, fontSize: 13, color: "var(--p-muted)" }}>
              {mode === "login" ? (
                <>
                  {tr("ยังไม่มีบัญชี?")}{" "}
                  <button
                    type="button"
                    style={{ background: "none", border: "none", color: "var(--p-accent)", fontWeight: 600, cursor: "pointer" }}
                    onClick={() => { setMode("register"); setError(""); }}
                  >
                    {tr("สมัครสมาชิกใหม่")}
                  </button>
                </>
              ) : (
                <>
                  {tr("มีบัญชีอยู่แล้ว?")}{" "}
                  <button
                    type="button"
                    style={{ background: "none", border: "none", color: "var(--p-accent)", fontWeight: 600, cursor: "pointer" }}
                    onClick={() => { setMode("login"); setError(""); }}
                  >
                    {tr("เข้าสู่ระบบ")}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
