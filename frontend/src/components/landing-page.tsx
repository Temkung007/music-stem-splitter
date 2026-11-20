"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { useLocale, LanguageSwitcher } from "@/components/locale-provider";
import { Brand } from "@/components/brand";
import { InteractiveHeroMixer } from "@/components/interactive-hero-mixer";
import {
  AudioLines,
  Disc3,
  HardDrive,
  Cpu,
  Layers,
  Menu,
  Play,
  Sliders,
  CheckCircle2,
  X,
  Eye,
  EyeOff,
  LoaderCircle,
  FolderSync,
} from "lucide-react";
import { api, jsonRequest, type User } from "@/lib/api";

interface LandingPageProps {
  onSuccess: (user: User) => void;
}

export function LandingPage({ onSuccess }: LandingPageProps) {
  const { t: tr, locale } = useLocale();

  const [menuOpen, setMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const authDialog = useRef<HTMLDialogElement>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const closeLabel = locale === "th" ? "ปิด" : "Close";
  const menuLabel = tr("เมนูหลัก");

  useEffect(() => {
    const updateHeader = () => setScrolled(window.scrollY > 24);
    updateHeader();
    window.addEventListener("scroll", updateHeader, { passive: true });
    return () => window.removeEventListener("scroll", updateHeader);
  }, []);

  useEffect(() => {
    const dialog = authDialog.current;
    if (modalOpen && dialog && !dialog.open) {
      dialog.showModal();
      dialog.querySelector("input")?.focus();
    }
  }, [modalOpen]);

  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await api<User>(
        `/api/auth/${mode}`,
        jsonRequest("POST", { email, password, name: name || "DJ" })
      );
      if (typeof window !== "undefined") {
        localStorage.setItem("stemora_active_session", "1");
      }
      authDialog.current?.close();
      onSuccess(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : tr("เข้าสู่ระบบไม่สำเร็จ"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {/* 1. FIXED NAV BAR (Taste-Skill Standard: header.nav > .wrap.nav__bar) */}
      <header
        className="nav landing-nav"
        data-solid={scrolled || menuOpen}
        onKeyDown={(event) => {
          if (event.key === "Escape" && menuOpen) {
            setMenuOpen(false);
            menuButton.current?.focus();
          }
        }}
      >
        <div className="wrap nav__bar">
          <a className="nav__logo" href="#top" onClick={() => setMenuOpen(false)}>
            <Brand />
          </a>

          <div className="nav__actions">
            <LanguageSwitcher />
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => { setMenuOpen(false); setMode("login"); setError(""); setModalOpen(true); }}
            >
              {tr("เข้าสู่ระบบ")}
            </button>
            <button
              ref={menuButton}
              type="button"
              className="landing-menu-button"
              aria-label={menuLabel}
              aria-controls="landing-navigation"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen(!menuOpen)}
            >
              {menuOpen ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
            </button>
          </div>

          <nav id="landing-navigation" className="nav__links landing-links" aria-label={menuLabel} data-open={menuOpen}>
            <a className="nav__link" href="#stems" onClick={() => setMenuOpen(false)}>{tr("ระบบแยกเสียง")}</a>
            <a className="nav__link" href="#features" onClick={() => setMenuOpen(false)}>{tr("ฟีเจอร์เด่น")}</a>
            <a className="nav__link" href="#dj-sync" onClick={() => setMenuOpen(false)}>{tr("ซิงก์โปรแกรม DJ")}</a>
            <a className="nav__link" href="#pipeline" onClick={() => setMenuOpen(false)}>{tr("สถาปัตยกรรม")}</a>
            <a className="nav__link" href="#faq" onClick={() => setMenuOpen(false)}>{tr("คำถามที่พบบ่อย")}</a>
            <div className="landing-menu-language"><LanguageSwitcher /></div>
          </nav>
        </div>
      </header>

      {/* 2. MAIN CONTAINER WITH EXACT TASTE-SKILL SECTIONS */}
      <main id="top">
        <section className="landing-hero" aria-labelledby="hero-h">
          <Image
            className="landing-hero-art"
            src="/brand/stemora-rooftop.webp"
            alt=""
            fill
            preload
            unoptimized
          />
          <div className="wrap landing-hero-inner">
            <div className="landing-hero-copy">
              <h1 id="hero-h">
                {locale === "th" ? "เวิร์กสเปซดีเจ" : "DJ Workspace"}{" "}
                <span>{locale === "th" ? "สตูดิโอแยกเสียง" : "& Stem Studio"}</span>
              </h1>
              <p className="hero__lead">
                {tr("ระบบแยก 4 สเตมเสียงร้อง กลอง เบส และเครื่องดนตรีด้วย Demucs v4 Neural DSP พร้อม WebAudio 32-bit Float บนคลาวด์และ WebGPU ฟรี 200 MB S3")}
              </p>
              <div className="landing-hero-actions">
                <button
                  type="button"
                  className="btn btn--primary"
                  onClick={() => { setMode("register"); setError(""); setModalOpen(true); }}
                >
                  {tr("เปิดสตูดิโอของคุณฟรี")}
                </button>
                <a href="#stems" className="btn btn--secondary">
                  <Play size={16} aria-hidden="true" />
                  {locale === "th" ? "ลองมิกเซอร์" : "Try the Mixer"}
                </a>
              </div>
            </div>
          </div>
        </section>

        {/* SECTION 2: APP-FRAME STUDIO SHOWCASE */}
        <section id="stems" className="section landing-mixer" aria-labelledby="stems-h">
          <div className="wrap">
            <div className="section-head">
              <h2 id="stems-h">
                {locale === "th" ? "ลองมิกเซอร์ 4 แทร็ก" : "Try the 4-track mixer"}
              </h2>
              <p style={{ color: "var(--p-ink)" }}>
                {locale === "th"
                  ? "เปิดเพลงตัวอย่าง แล้วปรับระดับเสียง ปิดเสียง หรือฟังทีละแทร็ก"
                  : "Play the demo, then adjust, mute, or solo each stem."}
              </p>
            </div>

            <InteractiveHeroMixer />
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
                  <div style={{ width: 44, height: 44, borderRadius: "var(--r-md)", background: "color-mix(in oklab, var(--p-accent) 10%, transparent)", display: "grid", placeItems: "center", color: "var(--p-accent)", marginBottom: "var(--s-4)" }}>
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
                  <div style={{ width: 44, height: 44, borderRadius: "var(--r-md)", background: "color-mix(in oklab, var(--p-accent) 10%, transparent)", display: "grid", placeItems: "center", color: "var(--p-accent)", marginBottom: "var(--s-4)" }}>
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
                  <div style={{ width: 44, height: 44, borderRadius: "var(--r-md)", background: "color-mix(in oklab, var(--p-accent) 10%, transparent)", display: "grid", placeItems: "center", color: "var(--p-accent)", marginBottom: "var(--s-4)" }}>
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
                  <div style={{ width: 44, height: 44, borderRadius: "var(--r-md)", background: "color-mix(in oklab, var(--p-accent) 10%, transparent)", display: "grid", placeItems: "center", color: "var(--p-accent)", marginBottom: "var(--s-4)" }}>
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

        {/* SECTION: UNIVERSAL DJ ECOSYSTEM (rekordbox & Serato DJ Live Sync) */}
        <section id="dj-sync" className="section" aria-labelledby="dj-sync-h">
          <div className="wrap">
            <div className="section-head">
              <div style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "4px 12px", borderRadius: 999, background: "color-mix(in oklab, var(--p-accent) 10%, transparent)", border: "1px solid color-mix(in oklab, var(--p-accent) 30%, transparent)", marginBottom: 12 }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--lime)", boxShadow: "0 0 8px var(--lime)" }} />
                <span className="mono" style={{ fontSize: 12, fontWeight: 700, color: "var(--lime)", letterSpacing: "0.08em" }}>
                  UNIVERSAL DJ LIVE SYNC
                </span>
              </div>
              <h2 id="dj-sync-h">
                {tr("ซิงก์เพลงและเพลย์ลิสต์ลงทั้ง 2 โปรแกรม DJ ชั้นนำระดับโลก")}
              </h2>
              <p style={{ color: "var(--p-ink)", maxWidth: 720 }}>
                {tr("เชื่อมต่อตรงกับ Pioneer DJ rekordbox และ Serato DJ Pro แบบ Real-Time จัดเซ็ต คีย์ Camelot และ BPM บนเว็บ แล้วโหลดลง Decks เล่นสดหรือส่งออก USB ได้ทันที")}
              </p>
            </div>

            {/* Dual App Side-by-Side Cards */}
            <div className="grid" style={{ marginBottom: "var(--s-6)" }}>
              {/* Card 1: Pioneer DJ rekordbox */}
              <div
                className="card span-6"
                style={{
                  background: "linear-gradient(145deg, color-mix(in oklab, var(--p-accent) 5%, transparent) 0%, rgba(18, 21, 28, 0.95) 100%)",
                  borderColor: "color-mix(in oklab, var(--p-accent) 25%, transparent)",
                  padding: "var(--s-6)",
                  borderRadius: "var(--r-lg)",
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "space-between",
                  boxShadow: "0 8px 32px rgba(0,0,0,0.3)",
                }}
              >
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      <div
                        style={{
                          width: 46,
                          height: 46,
                          borderRadius: 12,
                          background: "color-mix(in oklab, var(--p-accent) 12%, transparent)",
                          border: "1px solid color-mix(in oklab, var(--p-accent) 30%, transparent)",
                          display: "grid",
                          placeItems: "center",
                          fontSize: 22,
                        }}
                      >
                        🎛️
                      </div>
                      <div>
                        <span className="mono" style={{ fontSize: 11, color: "var(--lime)", fontWeight: 700, letterSpacing: "0.08em" }}>
                          INDUSTRY CLUB STANDARD
                        </span>
                        <h3 style={{ fontSize: 20, fontWeight: 700, color: "#f8fafc", margin: "2px 0 0" }}>
                          Pioneer DJ rekordbox
                        </h3>
                      </div>
                    </div>
                    <span className="pill mono" style={{ fontSize: 11, background: "color-mix(in oklab, var(--p-accent) 12%, transparent)", color: "var(--lime)", borderColor: "color-mix(in oklab, var(--p-accent) 30%, transparent)" }}>
                      v6 & v7 Ready
                    </span>
                  </div>

                  <p style={{ color: "#cbd5e1", fontSize: 14, lineHeight: 1.6, marginBottom: 18 }}>
                    {tr("ซิงก์ฐานข้อมูล Live XML Auto-Bridge เชื่อมต่อไฟล์ rekordbox.xml อัตโนมัติ เพลย์ลิสต์ คีย์ Camelot (1A–12B) และค่า BPM จะปรากฏในหมวด rekordbox xml ทันที พร้อมลากลง Deck 1-4 หรือ Sync ใส่ USB สำหรับ CDJ / XDJ")}
                  </p>

                  <div style={{ display: "grid", gap: 10, marginBottom: 20 }}>
                    {[
                      tr("ตรวจจับและตั้งค่าพาธ rekordbox XML ให้อัตโนมัติ 100% ไม่ต้องเปิด Preferences"),
                      tr("วิเคราะห์ Harmonic Camelot Key ช่วยจัดเซ็ตต่อเนื่องเนียนไร้สะดุด"),
                      tr("ส่งออกเพลย์ลิสต์ลง USB แฟลชไดรฟ์สำหรับเล่นบน Pioneer CDJ-3000 / XDJ"),
                    ].map((bullet, idx) => (
                      <div key={idx} style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 13, color: "#e2e8f0" }}>
                        <span style={{ color: "var(--lime)", flexShrink: 0, marginTop: 2 }}>✓</span>
                        <span>{bullet}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div style={{ paddingTop: 14, borderTop: "1px solid rgba(255,255,255,0.08)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span className="mono" style={{ fontSize: 11, color: "#94a3b8" }}>
                    {tr("รูปแบบ:")} Live XML Bridge + rekordbox ZIP
                  </span>
                  <a
                    href="#contact"
                    className="btn btn--secondary"
                    style={{ height: 34, fontSize: 12, padding: "0 14px" }}
                    onClick={() => { setMode("register"); setModalOpen(true); }}
                  >
                    {tr("ทดลองซิงก์ rekordbox")}
                  </a>
                </div>
              </div>

              {/* Card 2: Serato DJ Pro & Lite */}
              <div
                className="card span-6"
                style={{
                  background: "linear-gradient(145deg, color-mix(in oklab, var(--audio-accent) 5%, transparent) 0%, rgba(18, 21, 28, 0.95) 100%)",
                  borderColor: "color-mix(in oklab, var(--audio-accent) 25%, transparent)",
                  padding: "var(--s-6)",
                  borderRadius: "var(--r-lg)",
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "space-between",
                  boxShadow: "0 8px 32px rgba(0,0,0,0.3)",
                }}
              >
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      <div
                        style={{
                          width: 46,
                          height: 46,
                          borderRadius: 12,
                          background: "color-mix(in oklab, var(--audio-accent) 12%, transparent)",
                          border: "1px solid color-mix(in oklab, var(--audio-accent) 30%, transparent)",
                          display: "grid",
                          placeItems: "center",
                          fontSize: 22,
                        }}
                      >
                        🎧
                      </div>
                      <div>
                        <span className="mono" style={{ fontSize: 11, color: "var(--audio-accent)", fontWeight: 700, letterSpacing: "0.08em" }}>
                          TURNTABLE & PERFORMANCE
                        </span>
                        <h3 style={{ fontSize: 20, fontWeight: 700, color: "#f8fafc", margin: "2px 0 0" }}>
                          Serato DJ Pro & Lite
                        </h3>
                      </div>
                    </div>
                    <span className="pill mono" style={{ fontSize: 11, background: "color-mix(in oklab, var(--audio-accent) 12%, transparent)", color: "var(--audio-accent)", borderColor: "color-mix(in oklab, var(--audio-accent) 30%, transparent)" }}>
                      v3+ Native Crate
                    </span>
                  </div>

                  <p style={{ color: "#cbd5e1", fontSize: 14, lineHeight: 1.6, marginBottom: 18 }}>
                    {tr("ส่งออกและซิงก์ไฟล์ Native Binary Crates (.crate) ตรงเข้าโฟลเดอร์ Subcrates ของ Serato ทันที เมื่อเปิด Serato DJ จะพบคลังเพลง STEMORA พร้อมเล่นบน Deck 1-4 ทันที รองรับการสแครชและฟีเจอร์แยก Stems สด")}
                  </p>

                  <div style={{ display: "grid", gap: 10, marginBottom: 20 }}>
                    {[
                      tr("สร้างไฟล์ Binary Crate ลง ~/Music/_Serato_/Subcrates/ ให้อัตโนมัติ"),
                      tr("พร้อมลากลง Deck เล่นสดแบบ Zero Latency บนคอนโทรลเลอร์ทุกรุ่น"),
                      tr("รองรับการแยกเสียงสด Serato Stems แยก Vocals, Melodic, Bass, Drums"),
                    ].map((bullet, idx) => (
                      <div key={idx} style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 13, color: "#e2e8f0" }}>
                        <span style={{ color: "var(--audio-accent)", flexShrink: 0, marginTop: 2 }}>✓</span>
                        <span>{bullet}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div style={{ paddingTop: 14, borderTop: "1px solid rgba(255,255,255,0.08)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span className="mono" style={{ fontSize: 11, color: "#94a3b8" }}>
                    {tr("รูปแบบ:")} Native .crate + Serato ZIP
                  </span>
                  <a
                    href="#contact"
                    className="btn btn--secondary"
                    style={{ height: 34, fontSize: 12, padding: "0 14px" }}
                    onClick={() => { setMode("register"); setModalOpen(true); }}
                  >
                    {tr("ทดลองซิงก์ Serato")}
                  </a>
                </div>
              </div>
            </div>

            {/* Desktop Companion Spotlight Banner */}
            <div
              style={{
                background: "linear-gradient(135deg, color-mix(in oklab, var(--p-accent) 8%, transparent) 0%, #151821 55%, #10121a 100%)",
                border: "1px solid color-mix(in oklab, var(--p-accent) 28%, transparent)",
                borderRadius: "var(--r-lg)",
                padding: "24px 28px",
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 20,
              }}
            >
              <div style={{ maxWidth: 620 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                  <span className="pill mono" style={{ fontSize: 10, background: "color-mix(in oklab, var(--p-accent) 12%, transparent)", color: "var(--lime)", borderColor: "color-mix(in oklab, var(--p-accent) 30%, transparent)" }}>
                    DESKTOP COMPANION · v1.0.1
                  </span>
                </div>
                <h3 style={{ fontSize: 19, fontWeight: 700, color: "#f8fafc", margin: "0 0 6px" }}>
                  STEMORA Connect · {tr("สะพานเชื่อมต่ออัตโนมัติ ไม่ต้องแตะ Terminal")}
                </h3>
                <p style={{ fontSize: 13, color: "#cbd5e1", lineHeight: 1.55, margin: 0 }}>
                  {tr("โปรแกรมเบื้องหลังขนาดกะทัดรัด (6.9 MB) ทำงานบน Mac และ Windows ช่วยจับคู่บัญชีกับเว็บใน 1 คลิก แล้วซิงก์ทั้งเพลงและเพลย์ลิสต์ลง rekordbox และ Serato ให้อัตโนมัติทุกครั้งที่จัดเซ็ต")}
                </p>
              </div>

              <div className="connect-downloads" style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-start" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <a
                    href="/download/STEMORA-Connect-macOS.dmg"
                    download="STEMORA-Connect-macOS.dmg"
                    className="btn btn--primary"
                    style={{ minHeight: 42, fontSize: 13, padding: "8px 18px", textDecoration: "none" }}
                  >
                    <FolderSync size={16} />
                    <span>{tr("ดาวน์โหลด Connect (.dmg สำหรับ Mac)")}</span>
                  </a>
                  <a
                    href="/download/STEMORA-Connect-macOS.zip"
                    download="STEMORA-Connect-macOS.zip"
                    className="btn btn--secondary"
                    style={{ height: 42, fontSize: 13, padding: "0 14px", textDecoration: "none" }}
                  >
                    .zip
                  </a>
                </div>
                <div style={{ padding: "6px 12px", background: "rgba(0,0,0,0.35)", borderRadius: 6, border: "1px solid rgba(255,255,255,0.08)", fontSize: 11, color: "#94a3b8", display: "inline-flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                  <span style={{ color: "var(--lime)", fontWeight: 600 }}>💡 {tr("สำหรับผู้ใช้ Mac:")}</span>
                  <span>{tr("หากขึ้นเตือน 'แอปเสียหาย' ให้เปิด Terminal แล้วรัน:")}</span>
                  <code style={{ background: "rgba(0,0,0,0.5)", padding: "1px 5px", borderRadius: 3, color: "var(--p-accent)", fontFamily: "var(--font-mono-stem)" }}>xattr -cr /Applications/&quot;STEMORA Connect.app&quot;</code>
                </div>
              </div>
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
                  title: tr("ส่งออกพร้อมเล่น DJ (Serato & rekordbox)"),
                  desc: tr("มิกซ์สดด้วย WebAudio 32-bit Float 0ms Latency ปรับเกน 0–150%, Solo, Mute พร้อมซิงก์อัตโนมัติลงทั้ง Pioneer DJ rekordbox และ Serato DJ Pro หรือดาวน์โหลด Lossless WAV/ZIP และ M3U8 ครบทุกโปรแกรม DJ"),
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
                  {tr("STEMORA รองรับครบทั้ง 2 โปรแกรมระดับโลก: Pioneer DJ rekordbox (ผ่าน Live XML Auto-Bridge และส่งออก USB สำหรับ CDJ/XDJ) และ Serato DJ Pro / Lite (ผ่าน Native Binary Crates ซิงก์เข้า Subcrates โดยตรง) พร้อมทั้ง Traktor Pro, Engine DJ และ Virtual DJ ด้วยเพลย์ลิสต์ M3U8 และ Lossless WAV")}
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
                  <Brand />
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
                  <li><a href="#dj-sync">Pioneer rekordbox</a></li>
                  <li><a href="#dj-sync">Serato DJ Pro</a></li>
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

      {modalOpen && (
        <dialog
          ref={authDialog}
          className="auth-dialog"
          aria-labelledby="auth-title"
          onClose={() => { setModalOpen(false); setShowPassword(false); }}
          onClick={(event) => {
            if (event.target === event.currentTarget) event.currentTarget.close();
          }}
        >
          <div className="auth-dialog-card">
            <button
              type="button"
              className="auth-dialog-close"
              onClick={() => authDialog.current?.close()}
              aria-label={closeLabel}
            >
              <X size={20} aria-hidden="true" />
            </button>

            <div className="auth-dialog-heading">
              <div className="auth-dialog-brand"><Brand /></div>
              <h2 id="auth-title">
                {mode === "login" ? tr("เข้าสู่ระบบสตูดิโอ") : tr("สร้างบัญชีดีเจใหม่")}
              </h2>
              <p className="muted">
                {mode === "login"
                  ? tr("เข้าสู่ระบบเพื่อเข้าถึงคลังเพลงและมิกเซอร์ส่วนตัว")
                  : tr("รับพื้นที่จัดเก็บฟรี 200 MB และประมวลผล 4 แทร็กทันที")}
              </p>
            </div>

            <form className="auth-dialog-form" onSubmit={handleAuthSubmit}>
              {mode === "register" && (
                <div>
                  <label htmlFor="auth-name">{tr("ชื่อดีเจ หรือ ชื่อสตูดิโอ")}</label>
                  <input id="auth-name" type="text" autoComplete="nickname" value={name} onChange={(event) => setName(event.target.value)} required />
                </div>
              )}
              <div>
                <label htmlFor="auth-email">{tr("อีเมล")}</label>
                <input id="auth-email" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="dj@example.com" required />
              </div>
              <div>
                <label htmlFor="auth-password">{tr("รหัสผ่าน")}</label>
                <div className="auth-password">
                  <input id="auth-password" type={showPassword ? "text" : "password"} autoComplete={mode === "register" ? "new-password" : "current-password"} value={password} onChange={(event) => setPassword(event.target.value)} minLength={8} required />
                  <button
                    type="button"
                    aria-label={locale === "th" ? "แสดงรหัสผ่าน" : "Show password"}
                    aria-pressed={showPassword}
                    onClick={() => setShowPassword(!showPassword)}
                  >
                    {showPassword ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
                  </button>
                </div>
              </div>
              {error && <p className="auth-dialog-error" role="alert">{error}</p>}
              <button type="submit" className="btn btn--primary" disabled={busy}>
                {busy && <LoaderCircle size={16} className="animate-spin" aria-hidden="true" />}
                {mode === "login" ? tr("เข้าสู่ระบบสตูดิโอ") : tr("ลงทะเบียนและเริ่มใช้งาน")}
              </button>
            </form>

            <div className="auth-dialog-switch">
              {mode === "login" ? tr("ยังไม่มีบัญชี?") : tr("มีบัญชีอยู่แล้ว?")}{" "}
              <button type="button" onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(""); }}>
                {mode === "login" ? tr("สมัครสมาชิกใหม่") : tr("เข้าสู่ระบบ")}
              </button>
            </div>
          </div>
        </dialog>
      )}
    </>
  );
}
