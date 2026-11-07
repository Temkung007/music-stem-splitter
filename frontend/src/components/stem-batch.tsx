"use client";
import { useState, useEffect, useCallback, useId } from "react";
import { StemJobStatus } from "@/components/stem-job-status";
import type { Task } from "@/components/stem-mixer";
import { StemStorageChoice } from "@/components/stem-storage-choice";
import { queueSeparation } from "@/lib/separation-upload";
import { apiFetch } from "@/lib/api";
import { useLocale } from "@/components/locale-provider";

type Entry = { id: string; file: File; status: "ready" | "uploading" | "queued" | "error"; message?: string; requestId?: string; options?: string };
export function StemBatch({ onQueued }: { onQueued: () => void }) {
  const { locale } = useLocale();
  const fileId = useId();
  const [items, setItems] = useState<Entry[]>([]);
  const [working, setWorking] = useState(false);
  const [jobs, setJobs] = useState<Task[]>([]);
  const [trash, setTrash] = useState<{id: string; filename: string; status: string}[]>([]);
  const [statusUnavailable, setStatusUnavailable] = useState(false);
  const [manageError, setManageError] = useState("");
  const [quota, setQuota] = useState<{used_bytes: number; quota_bytes: number} | null>(null);
  const refreshJobs = useCallback(async () => {
    try {
      const [a, b, c] = await Promise.all([apiFetch("/api/tasks", {signal: AbortSignal.timeout(8000)}), apiFetch("/api/worker-trash", {signal: AbortSignal.timeout(8000)}), apiFetch("/api/cloud/summary", {signal: AbortSignal.timeout(8000)})]);
      if (a.ok) { setJobs(await a.json()); setStatusUnavailable(false); } else setStatusUnavailable(true);
      if (b.ok) setTrash(await b.json());
      if (c.ok) setQuota(await c.json());
    } catch { setStatusUnavailable(true); }
  }, []);
  useEffect(() => { void refreshJobs(); const changed = () => void refreshJobs(); window.addEventListener("stemora:tasks-changed", changed); const timer = setInterval(changed, 10000); return () => { clearInterval(timer); window.removeEventListener("stemora:tasks-changed", changed); }; }, [refreshJobs]);
  async function manage(id: string, action: "trash" | "restore" | "cancel" | "purge") {
    try {
      setManageError("");
      const response = await apiFetch(`/api/tasks/${id}/${action}`, { method: action === "purge" ? "DELETE" : "POST" });
      if (!response.ok) { const data = await response.json(); throw new Error(data.detail || "Error"); }
      await refreshJobs(); onQueued();
    } catch (error) { setManageError(error instanceof Error ? error.message : "Error"); }
  }
  const [mode, setMode] = useState("4stems");
  const [storageMode, setStorageMode] = useState("download");
  const th = locale === "th";
  async function send() {
    setWorking(true);
    for (const item of items.filter((x) => x.status === "ready" || x.status === "error")) {
      const options = `${mode}:${storageMode}`;
      const requestId = item.options === options && item.requestId ? item.requestId : crypto.randomUUID();
      setItems((list) => list.map((x) => x.id === item.id ? { ...x, status: "uploading", message: "0%", requestId, options } : x));
      const form = new FormData();
      form.append("storage_mode", storageMode);
      form.append("file", item.file); form.append("engine", "worker"); form.append("stems_mode", mode);
      try {
        await queueSeparation(form, requestId, (percent) => setItems((list) => list.map((x) => x.id === item.id ? {...x, message: percent === 100 ? (th ? "กำลังตรวจและส่งเข้าคิว…" : "Checking and queuing…") : `${percent}%`} : x)));
        setItems((list) => list.map((x) => x.id === item.id ? { ...x, status: "queued" } : x));
        onQueued(); void refreshJobs();
      } catch (e) {
        setItems((list) => list.map((x) => x.id === item.id ? { ...x, status: "error", message: e instanceof Error ? e.message : "Error" } : x));
      }
    }
    setWorking(false);
  }
  return <section className="panel stem-batch">
    <div className="batch-heading"><div><span className="batch-eyebrow">STEM STUDIO</span><h2>{th ? "เลือกเพลง แล้วให้เราจัดการเสียง" : "Your tracks. Ready for the next set."}</h2></div><span className="batch-count">{items.filter(x => x.status === "queued").length} / {items.length} {th ? "ส่งแล้ว" : "queued"}</span></div>
    <p>{th ? "เลือกหลายไฟล์ แล้วส่งเข้าคิว ระบบรับงานตามคิวและช่องประมวลผลที่ว่าง รอคิวได้สูงสุด 10 งาน เลือกแยกเพื่อดาวน์โหลดได้แม้ Cloud เต็ม" : "Choose multiple files to queue. Up to 10 jobs can wait per account. Songs start as processing slots become available. Download mode works even when cloud storage is full."}</p>
    <StemStorageChoice value={storageMode} onChange={setStorageMode} disabled={working} />
    {storageMode === "cloud" && quota && <p>{th ? `เหลือพื้นที่ ${Math.max(0, (quota.quota_bytes - quota.used_bytes) / 1e6).toFixed(1)} MB จาก ${(quota.quota_bytes / 1e6).toFixed(0)} MB · ผลลัพธ์ 4 แทร็คใช้ประมาณ 42.3 MB ต่อนาที และจองพื้นที่ต้นฉบับระหว่างทำงาน` : `${Math.max(0, (quota.quota_bytes - quota.used_bytes) / 1e6).toFixed(1)} MB free of ${(quota.quota_bytes / 1e6).toFixed(0)} MB · Four stems need about 42.3 MB per minute, plus temporary source space.`}</p>}
    <div className="stem-batch-actions"><label className="secondary-button stem-batch-choose" htmlFor={fileId}>{th ? "+ เพิ่มเพลง" : "+ Add songs"}</label><input id={fileId} aria-label={th ? "เลือกหลายเพลง" : "Choose multiple songs"} className="stem-batch-input" type="file" multiple accept=".mp3,.wav,.flac,.m4a,.aac,.ogg" disabled={working} onChange={(e) => { const files = Array.from(e.target.files || []); setItems((old) => [...old, ...files.map((file) => ({ id: crypto.randomUUID(), file, status: "ready" as const }))]); e.target.value = ""; }} />
    <select aria-label={th ? "จำนวนแทร็ค" : "Stem layout"} value={mode} disabled={working} onChange={(e) => setMode(e.target.value)}><option value="4stems">4 Stems</option><option value="2stems">2 Stems</option></select>
    {items.map((item) => <div key={item.id} style={{display:"flex", alignItems:"center", gap:12, marginTop:10}}><span style={{flex:1,overflowWrap:"anywhere"}}>{item.file.name} · {item.status === "queued" ? (th ? "เข้าคิวแล้ว" : "Queued") : item.status === "uploading" ? `${th ? "กำลังส่ง" : "Uploading"} ${item.message || ""}` : item.status === "error" ? item.message : (th ? "พร้อมส่ง" : "Ready")}</span>{item.status !== "queued" && <button type="button" disabled={working} onClick={() => setItems((list) => list.filter((x) => x.id !== item.id))}>{th ? "นำออก" : "Remove"}</button>}</div>)}
    <button className="primary-button small" disabled={working || !items.some((x) => x.status === "ready" || x.status === "error")} onClick={() => void send()}>{working ? (th ? "กำลังส่งไฟล์…" : "Uploading…") : (th ? `เริ่มแยก ${items.filter(x => x.status === "ready" || x.status === "error").length || ""} เพลง →` : `Separate ${items.filter(x => x.status === "ready" || x.status === "error").length || ""} songs →`)}</button></div>
    <details style={{marginTop: 20}}><summary>{th ? "จัดการงานและถังขยะ" : "Manage jobs and trash"}</summary>
      {jobs.map((job) => <div key={job.id} style={{display:"flex", gap:12, alignItems:"center", marginTop:10}}><span style={{flex:1, overflowWrap:"anywhere"}}>{job.filename} · {job.status === "completed" ? (th ? "พร้อมมิกซ์" : "Ready") : job.status === "failed" ? (th ? "ไม่สำเร็จ" : "Failed") : job.status === "cancelled" ? (th ? "ยกเลิกแล้ว" : "Cancelled") : ["expired", "expiring"].includes(job.status) ? (th ? "หมดอายุแล้ว" : "Expired") : job.status === "queued" ? (th ? "รอคิว" : "Queued") : (th ? "กำลังประมวลผล" : "Processing")}<StemJobStatus task={job} compact connectionIssue={statusUnavailable} /></span>{["queued", "processing"].includes(job.status) ? <button disabled={job.engine !== "worker"} onClick={() => void manage(job.id, "cancel")}>{th ? "ยกเลิก" : "Cancel"}</button> : <button onClick={() => void manage(job.id, "trash")}>{th ? "ลบ" : "Delete"}</button>}</div>)}
      {trash.length > 0 && <p>{th ? "ไฟล์ Cloud ในถังขยะยังใช้พื้นที่ ส่วนผลลัพธ์ชั่วคราวจะหมดอายุตามเดิม" : "Cloud files in trash still use storage. Temporary results keep their original expiry."}</p>}
      {trash.map((job) => <div key={job.id} style={{display:"flex",gap:12,marginTop:10}}><span style={{flex:1}}>{job.filename}</span>{job.status !== "deleting" && <button onClick={() => void manage(job.id, "restore")}>{th ? "กู้คืน" : "Restore"}</button>}<button onClick={() => { if (window.confirm(th ? "ลบถาวรและคืนพื้นที่? ไฟล์จะกู้คืนไม่ได้" : "Delete permanently and free storage? This cannot be undone.")) void manage(job.id, "purge"); }}>{th ? "ลบถาวร" : "Delete permanently"}</button></div>)}
      {manageError && <p role="alert">{manageError}</p>}
    </details>
    <p>{th ? "เปิดหน้านี้ไว้จนส่งไฟล์ครบ จากนั้นกลับมาดูผลในงานแยกเสียงได้" : "Keep this page open until uploads finish, then find results in Stem jobs."}</p>
  </section>;
}
