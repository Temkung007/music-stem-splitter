"use client";

import { useLocale } from "@/components/locale-provider";
import { useEffect, useState, type FormEvent } from "react";
import { Cloud, LockKeyhole, ShieldCheck, LogOut } from "lucide-react";
import { useAuth } from "@/components/auth-boundary";
import { api, fileSize, jsonRequest, type WorkspaceSummary } from "@/lib/api";
import { Notice } from "@/components/workspace-ui";
export function AccountPanel() {
  const { t: tr } = useLocale();

  const { user, logout } = useAuth();
  const [summary, setSummary] = useState<WorkspaceSummary | null>(null);
  const [allowance, setAllowance] = useState<{limit_minutes:number; remaining_minutes:number|null; timezone:string} | null>(null);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api<{limit_minutes:number; remaining_minutes:number|null; timezone:string}>("/api/processing-allowance").then(setAllowance).catch(() => {});
    api<WorkspaceSummary>("/api/cloud/summary")
      .then(setSummary)
      .catch((cause) => setError(cause.message));
  }, []);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api(
        "/api/auth/password",
        jsonRequest("POST", { current_password: current, new_password: next }),
      );
      setCurrent("");
      setNext("");
      setMessage(tr("เปลี่ยนรหัสผ่านแล้ว และออกจากระบบบนอุปกรณ์อื่นทั้งหมด"));
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="guide-grid">
      <section className="panel guide-panel">
        <span className="eyebrow">
          <ShieldCheck size={15} /> {tr("PRIVATE BY DEFAULT")}
        </span>
        <h2>{user.name}</h2>
        <p className="free-storage-label">
          {tr("พื้นที่ฟรี")}: {fileSize(summary?.quota_bytes || 200_000_000)}
        </p>
        <p>{user.email}</p>
        {allowance && allowance.limit_minutes > 0 && <div className="account-fact"><ShieldCheck /><div><strong>{tr("โควตาแยกเสียงวันนี้")}</strong><p>{tr("เหลือ {0} จาก {1} นาทีเพลง", {0:allowance.remaining_minutes ?? 0,1:allowance.limit_minutes})}</p><p>{tr("เริ่มรอบใหม่เที่ยงคืนเวลาไทย · ไม่นับการแยกบนอุปกรณ์ของคุณ")}</p></div></div>}
        <div className="account-fact">
          <Cloud />
          <div>
            <strong>
              {summary?.storage.ready
                ? tr("พื้นที่จัดเก็บพร้อมใช้งาน")
                : summary
                  ? tr("พื้นที่จัดเก็บยังไม่พร้อม กรุณาลองใหม่")
                  : tr("กำลังตรวจสอบพื้นที่จัดเก็บ")}
            </strong>
            <p>
              {fileSize(summary?.used_bytes || 0)} {tr("จาก")}{" "}
              {fileSize(summary?.quota_bytes || 0)}
            </p>
          </div>
        </div>
        <p>
          {tr(
            "ไฟล์เพลง แทร็คที่แยกแล้ว และเพลย์ลิสต์ผูกกับบัญชีของคุณ เพลงในถังขยะกู้คืนได้และยังนับพื้นที่จัดเก็บ",
          )}
        </p>
        <div className="account-fact">
          <LockKeyhole />
          <div>
            <strong>{tr("ผู้ช่วยจัดเซ็ต")}</strong>
            <p>
              {summary?.assistant
                ? tr("พร้อมใช้ AI อ่านคำสั่งและจัดลำดับจากข้อมูลเสียง")
                : summary?.assistant_configured
                  ? tr(
                      "ผู้ช่วย AI ยังไม่พร้อม · ยังจัดลำดับจาก BPM คีย์ และพลังงานได้",
                    )
                  : tr(
                      "จัดลำดับจาก BPM คีย์ และพลังงาน · ผู้ดูแลเปิดผู้ช่วย AI เพิ่มได้",
                    )}
            </p>
          </div>
        </div>
        <p>
          {tr(
            "ค่าที่วิเคราะห์เป็นตัวช่วย ควรฟังตรวจสอบก่อนแสดงจริง การส่งออก M3U8 ใช้คู่กับไฟล์เพลงที่อยู่ใน ZIP เดียวกัน",
          )}
        </p>
        <button
          className="secondary-button account-logout"
          onClick={() => void logout()}
        >
          <LogOut size={15} /> {tr("ออกจากระบบ")}
        </button>
      </section>
      <section className="panel guide-panel">
        <h2>{tr("เปลี่ยนรหัสผ่าน")}</h2>
        {message && <Notice text={tr(message)} />}
        <form className="workspace-form" onSubmit={submit}>
          <label>
            {tr("รหัสผ่านปัจจุบัน")}
            <input
              type="password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              required
              autoComplete="current-password"
            />
          </label>
          <label>
            {tr("รหัสผ่านใหม่")}
            <input
              type="password"
              minLength={10}
              maxLength={128}
              value={next}
              onChange={(e) => setNext(e.target.value)}
              required
              autoComplete="new-password"
            />
          </label>
          {error && (
            <div className="error-message" role="alert">
              {tr(error)}
            </div>
          )}
          <button className="primary-button small" disabled={busy}>
            {tr("บันทึกรหัสผ่านใหม่")}
          </button>
        </form>
      </section>
    </div>
  );
}
