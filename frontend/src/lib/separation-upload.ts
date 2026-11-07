import { apiFetch } from "@/lib/api";
import { clientLocale, translateClient as tr } from "@/lib/i18n";

type Queued = {task_id: string; filename: string; status: string};
async function recover(id: string): Promise<Queued | null> {
  const response = await apiFetch(`/api/separation-requests/${encodeURIComponent(id)}`, {signal: AbortSignal.timeout(15000)});
  if (!response.ok) throw new Error(tr("ตรวจสอบคิวไม่สำเร็จ กรุณาลองอีกครั้ง"));
  return (await response.json()).task;
}
export async function queueSeparation(form: FormData, id: string, progress: (percent: number) => void, path = "/api/separate"): Promise<Queued> {
  // Recover before uploading on every retry, including after a lost response.
  let previous: Queued | null;
  try { previous = await recover(id); } catch { throw new Error(tr("ตรวจสอบคิวไม่สำเร็จ กรุณาลองอีกครั้ง")); }
  if (previous) return previous;
  form.set("request_id", id);
  try {
    return await new Promise<Queued>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", path);
      xhr.timeout = 600000;
      xhr.setRequestHeader("X-Stemora-Request", "1");
      xhr.setRequestHeader("Accept-Language", clientLocale());
      xhr.upload.onprogress = (event) => { if (event.lengthComputable) progress(Math.min(100, Math.round(event.loaded * 100 / event.total))); };
      xhr.onload = () => {
        let data;
        try { data = JSON.parse(xhr.responseText); } catch { reject(new Error("transport")); return; }
        if (xhr.status >= 200 && xhr.status < 300) resolve(data);
        else if (xhr.status >= 500) reject(new Error("transport"));
        else reject(new Error(typeof data.detail === "string" ? data.detail : tr("ส่งไฟล์ไม่สำเร็จ กรุณาลองอีกครั้ง")));
      };
      xhr.onerror = xhr.ontimeout = () => reject(new Error("transport"));
      xhr.send(form);
    });
  } catch (error) {
    if (!(error instanceof Error) || error.message !== "transport") throw error;
    try { const task = await recover(id); if (task) return task; } catch { /* Keep the request ID for a safe retry. */ }
    throw new Error(tr("การเชื่อมต่อขาดช่วง กดลองอีกครั้งเพื่อตรวจคิวเดิมและส่งต่ออย่างปลอดภัย"));
  }
}
