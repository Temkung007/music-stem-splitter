"use client";

import { useLocale } from "@/components/locale-provider";
import type { Task } from "@/components/stem-mixer";

export function StemJobStatus({ task, compact = false, connectionIssue = false }: {
  task: Task;
  compact?: boolean;
  connectionIssue?: boolean;
}) {
  const { t, locale } = useLocale();
  if (task.engine !== "worker" || !["queued", "processing"].includes(task.status)) return null;
  const th = locale === "th";
  const waiting = task.status === "queued";
  const reconnecting = connectionIssue || task.queue?.phase === "reconnecting";
  const uploading = task.queue?.phase === "uploading";
  const busy = (task.queue?.waiting ?? 0) >= 3;
  const title = reconnecting
    ? (th ? "กำลังเชื่อมต่ออีกครั้ง" : "Reconnecting")
    : waiting ? (th ? "กำลังรอคิว" : "Waiting in queue")
    : uploading ? (th ? "กำลังเตรียมไฟล์ดาวน์โหลด" : "Preparing your downloads")
    : (th ? "กำลังแยกเสียง" : "Separating your song");
  const message = reconnecting
    ? (th ? "กรุณารอสักครู่ ระบบกำลังตรวจสอบงานของคุณ" : "Please wait while we check your job.")
    : waiting && busy
      ? (th ? "ขณะนี้มีงานรอประมวลผลจำนวนมาก อาจใช้เวลาสักครู่" : "There are many jobs in the queue. This may take a little while.")
      : waiting
        ? (th ? "เพลงเข้าคิวแล้ว จะเริ่มอัตโนมัติเมื่อระบบพร้อม" : "Your song is queued and will start automatically when ready.")
        : (th ? "กำลังดำเนินการ กรุณารอสักครู่" : "Working on your song. Please wait a moment.");

  if (compact) return waiting || reconnecting
    ? <span className="job-status-compact">{message}</span>
    : null;

  return <div className="job-status-detail">
    <h2><span role="status" aria-live="polite">{title}</span></h2>
    <p className="job-status-explanation">{message}</p>
    {!waiting && !reconnecting && <>
      <div className="progress-label"><span>{th ? "ความคืบหน้า" : "Progress"}</span><strong>{task.progress}%</strong></div>
      <progress max="100" value={task.progress} aria-label={t("ความคืบหน้าการแยกเสียง")} />
    </>}
  </div>;
}
