"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";
import type { Task } from "@/components/stem-mixer";

type DeviceSupport = "checking" | "ready" | "unsupported";
type ResultFile = {
  name: string;
  filename: string;
  blob: Blob;
  size_bytes: number;
  peaks: number[];
};
type LocalResult = { task: Task; files: ResultFile[]; archive: Blob };
const phaseMessages: Record<string, string> = {
  loading: "กำลังโหลดตัวประมวลผลบนอุปกรณ์",
  download: "กำลังดาวน์โหลดไฟล์ AI ประมาณ 96 MB เก็บไว้ใช้ครั้งต่อไป",
  cached: "พบไฟล์ AI ที่เก็บไว้บนอุปกรณ์แล้ว",
  preparing: "กำลังเตรียม GPU ครั้งแรกอาจใช้เวลาสักครู่",
  separating: "กำลังแยกเสียงด้วย GPU บนอุปกรณ์ของคุณ",
  packing: "กำลังเตรียมแทร็คและ ZIP บนอุปกรณ์",
};
const errorMessages: Record<string, string> = {
  gpu_busy:
    "มีแท็บอื่นกำลังแยกเสียงด้วย GPU กรุณารอให้เสร็จหรือยกเลิกงานในแท็บนั้นก่อน",
  unsupported:
    "อุปกรณ์นี้ยังใช้ WebGPU ไม่ได้ ลอง Chrome หรือ Edge รุ่นล่าสุดบนคอมพิวเตอร์ หรือเลือกประมวลผลบนเซิร์ฟเวอร์",
  download_failed:
    "ดาวน์โหลดไฟล์ประมวลผลไม่สำเร็จ ตรวจสอบอินเทอร์เน็ตแล้วลองอีกครั้ง",
  invalid_audio:
    "อ่านไฟล์เสียงไม่ได้หรือผลลัพธ์ไม่สมบูรณ์ กรุณาลองไฟล์ WAV หรือ MP3 อื่น",
  gpu_failed:
    "GPU ประมวลผลไม่สำเร็จ ลองปิดโปรแกรมที่ใช้กราฟิก เลือกเพลงที่สั้นลง หรือใช้เซิร์ฟเวอร์",
};

export function useClientStems(onTask: (task: Task | null) => void) {
  const [support, setSupport] = useState<DeviceSupport>("checking");
  const [running, setRunning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveProgress, setSaveProgress] = useState(0);
  const [saved, setSaved] = useState(false);
  const [result, setResult] = useState<LocalResult | null>(null);
  const [error, setError] = useState("");
  const worker = useRef<Worker | null>(null);
  const workerEvents = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const urls = useRef<string[]>([]);
  const timeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const idleTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resultRef = useRef<LocalResult | null>(null);
  const runningRef = useRef(false);
  const saveController = useRef<AbortController | null>(null);
  const uploadSession = useRef<string | null>(null);

  const stopWorker = useCallback(() => {
    worker.current?.terminate();
    workerEvents.current?.abort();
    worker.current = null;
    if (timeout.current) clearTimeout(timeout.current);
    if (idleTimeout.current) clearTimeout(idleTimeout.current);
    idleTimeout.current = null;
    timeout.current = null;
    runningRef.current = false;
  }, []);
  const release = useCallback(() => {
    urls.current.forEach((url) => URL.revokeObjectURL(url));
    urls.current = [];
    resultRef.current = null;
  }, []);
  useEffect(() => {
    let disposed = false;
    const gpu = (
      navigator as Navigator & {
        gpu?: {
          requestAdapter(options?: {
            powerPreference: string;
          }): Promise<unknown>;
        };
      }
    ).gpu;
    void (async () => {
      let ready = false;
      try {
        ready =
          isSecureContext &&
          !!gpu &&
          !!(await gpu.requestAdapter({ powerPreference: "high-performance" }));
      } catch {
        /* Feature existence alone does not guarantee an available adapter. */
      }
      if (!disposed) setSupport(ready ? "ready" : "unsupported");
    })();
    return () => {
      disposed = true;
      generation.current++;
      stopWorker();
      release();
      saveController.current?.abort();
    };
  }, [release, stopWorker]);

  useEffect(() => {
    if (!running && (!result || saved)) return;
    const preventLoss = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", preventLoss);
    return () => window.removeEventListener("beforeunload", preventLoss);
  }, [running, result, saved]);

  const clear = useCallback(() => {
    generation.current++;
    if (uploadSession.current) {
      void apiFetch(`/api/client-stems/uploads/${uploadSession.current}`, {
        method: "DELETE",
      }).catch(() => {});
      uploadSession.current = null;
    }
    if (runningRef.current) stopWorker();
    release();
    setResult(null);
    setRunning(false);
    setSaved(false);
    setError("");
  }, [release, stopWorker]);
  const cancel = useCallback(() => {
    generation.current++;
    stopWorker();
    setRunning(false);
    onTask(null);
    setError("ยกเลิกการแยกเสียงแล้ว ไฟล์ต้นฉบับยังอยู่ในเครื่องของคุณ");
  }, [onTask, stopWorker]);

  const run = useCallback(
    async (file: File, mode: string) => {
      if (runningRef.current || saveController.current) return;
      if (support !== "ready") {
        setError(errorMessages.unsupported);
        return;
      }
      clear();
      if (idleTimeout.current) clearTimeout(idleTimeout.current);
      idleTimeout.current = null;
      const current = generation.current;
      runningRef.current = true;
      setRunning(true);
      const task: Task = {
        id: "local-" + crypto.randomUUID(),
        filename: file.name,
        stems_mode: mode,
        engine: "webgpu",
        status: "processing",
        progress: 1,
        message: "กำลังอ่านไฟล์เสียงบนอุปกรณ์",
        stems: {},
        created_at: new Date().toISOString(),
        local: true,
      };
      onTask(task);
      const fail = (code: string) => {
        console.warn("STEMORA GPU failure:", code);
        if (generation.current !== current) return;
        stopWorker();
        setRunning(false);
        onTask(null);
        setError(errorMessages[code] || errorMessages.gpu_failed);
      };
      try {
        if (!file.size || file.size > 50_000_000)
          throw new Error("invalid_audio");
        const context = new AudioContext({ sampleRate: 44100 });
        let decoded: AudioBuffer;
        try {
          decoded = await context.decodeAudioData(await file.arrayBuffer());
        } catch {
          throw new Error("invalid_audio");
        } finally {
          await context.close();
        }
        if (generation.current !== current) return;
        if (
          !Number.isFinite(decoded.duration) ||
          decoded.duration <= 0 ||
          decoded.duration > 600
        )
          throw new Error("invalid_audio");
        if (decoded.sampleRate !== 44100) {
          const resampler = new OfflineAudioContext(
            2,
            Math.ceil(decoded.duration * 44100),
            44100,
          );
          const source = resampler.createBufferSource();
          source.buffer = decoded;
          source.connect(resampler.destination);
          source.start();
          decoded = await resampler.startRendering();
        }
        if (generation.current !== current) return;
        const left = new Float32Array(decoded.getChannelData(0));
        const right = new Float32Array(
          decoded.getChannelData(decoded.numberOfChannels > 1 ? 1 : 0),
        );
        const instance =
          worker.current ||
          new Worker("/client-stems/worker-lite-v1.js", {
            type: "module",
            name: "stemora-local-audio",
          });
        worker.current = instance;
        workerEvents.current?.abort();
        workerEvents.current = new AbortController();
        const events = { signal: workerEvents.current.signal };
        instance.addEventListener("error", (event) => {
          console.warn("STEMORA worker:", event.message);
          fail("gpu_failed");
        }, events);
        instance.addEventListener("messageerror", () => fail("gpu_failed"), events);
        instance.addEventListener("message", ({ data }) => {
          if (generation.current !== current) return;
          if (data.type === "diagnostic") {
            console.warn("STEMORA GPU diagnostic:", data.text);
          } else if (data.type === "device-lost") {
            if (runningRef.current) fail("gpu_failed");
            else stopWorker();
          } else if (data.type === "progress") {
            if (timeout.current) clearTimeout(timeout.current);
            timeout.current = setTimeout(
              () => fail("gpu_failed"),
              30 * 60 * 1000,
            );
            onTask({
              ...task,
              progress: data.progress,
              message: phaseMessages[data.phase] || phaseMessages.separating,
            });
          } else if (data.type === "error") fail(data.code);
          else if (data.type === "complete") {
            const files = data.files as ResultFile[];
            const stems = Object.fromEntries(
              files.map((file) => {
                const url = URL.createObjectURL(file.blob);
                urls.current.push(url);
                return [
                  file.name,
                  {
                    filename: file.filename,
                    peaks: file.peaks,
                    size_bytes: file.size_bytes,
                    url,
                  },
                ];
              }),
            );
            const archiveUrl = URL.createObjectURL(data.archive);
            urls.current.push(archiveUrl);
            const complete: Task = {
              ...task,
              status: "completed",
              progress: 100,
              message: "แทร็คของคุณพร้อมแล้ว",
              duration: data.duration,
              stems,
              archive_url: archiveUrl,
            };
            const localResult = {
              task: complete,
              files,
              archive: data.archive,
            };
            resultRef.current = localResult;
            setResult(localResult);
            onTask(complete);
            if (timeout.current) clearTimeout(timeout.current);
            timeout.current = null;
            runningRef.current = false;
            // Reuse compiled GPU kernels for the next track; release idle GPU memory.
            idleTimeout.current = setTimeout(stopWorker, 5 * 60 * 1000);
            setRunning(false);
          }
        }, events);
        timeout.current = setTimeout(() => fail("gpu_failed"), 30 * 60 * 1000);
        instance.postMessage({ type: "run", mode, filename: file.name, left, right }, [
          left.buffer,
          right.buffer,
        ]);
      } catch (cause) {
        fail(cause instanceof Error ? cause.message : "invalid_audio");
      }
    },
    [clear, onTask, stopWorker, support],
  );

  const save = useCallback(async () => {
    const current = resultRef.current;
    if (!current || saveController.current) return null;
    const controller = new AbortController();
    saveController.current = controller;
    setSaving(true);
    setSaveProgress(0);
    setError("");
    try {
      const send = async (
        path: string,
        options: RequestInit,
        timeoutMs = 120000,
      ) => {
        const response = await apiFetch(path, {
          ...options,
          signal: AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(timeoutMs),
          ]),
        });
        const data = await response.json().catch(() => null);
        if (!response.ok || !data)
          throw new Error(
            typeof data?.detail === "string"
              ? data.detail
              : "บันทึกเข้า cloud ไม่สำเร็จ ผลลัพธ์ยังดาวน์โหลดจากเครื่องได้",
          );
        return data;
      };
      const clientId = current.task.id.slice(6);
      const started = await send("/api/client-stems/uploads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: clientId,
          filename: current.task.filename,
          stems_mode: current.task.stems_mode,
          files: current.files.map((file) => ({
            name: file.filename,
            size_bytes: file.size_bytes,
          })),
        }),
      });
      if (started.completed) {
        setSaved(true);
        uploadSession.current = null;
        return started.completed as Task;
      }
      uploadSession.current = clientId;
      const required = current.files.reduce(
        (total, file) => total + file.size_bytes,
        0,
      );
      let sent = current.files.reduce(
        (total, file) => total + (started.offsets?.[file.filename] || 0),
        0,
      );
      for (const file of current.files) {
        let offset = started.offsets?.[file.filename] ?? 0;
        if (
          !Number.isSafeInteger(offset) ||
          offset < 0 ||
          offset > file.blob.size
        )
          throw new Error(
            "บันทึกเข้า cloud ไม่สำเร็จ ผลลัพธ์ยังดาวน์โหลดจากเครื่องได้",
          );
        while (offset < file.blob.size) {
          const end = Math.min(offset + 4_000_000, file.blob.size);
          const uploaded = await send(
            `/api/client-stems/uploads/${clientId}/${file.filename}?offset=${offset}`,
            {
              method: "PUT",
              headers: { "Content-Type": "application/octet-stream" },
              body: file.blob.slice(offset, end),
            },
          );
          if (uploaded.offset !== end)
            throw new Error(
              "บันทึกเข้า cloud ไม่สำเร็จ ผลลัพธ์ยังดาวน์โหลดจากเครื่องได้",
            );
          sent += end - offset;
          offset = end;
          setSaveProgress(Math.floor((sent / required) * 95));
        }
      }
      const data = await send(
        `/api/client-stems/uploads/${clientId}/complete`,
        { method: "POST" },
        600000,
      );
      uploadSession.current = null;
      setSaveProgress(100);
      if (controller.signal.aborted) return null;
      setSaved(true);
      return data as Task;
    } catch (cause) {
      if (!controller.signal.aborted)
        setError(
          cause instanceof Error
            ? cause.message
            : "บันทึกเข้า cloud ไม่สำเร็จ ผลลัพธ์ยังดาวน์โหลดจากเครื่องได้",
        );
      return null;
    } finally {
      saveController.current = null;
      setSaving(false);
    }
  }, []);

  return {
    support,
    running,
    saving,
    saveProgress,
    saved,
    result,
    error,
    run,
    cancel,
    clear,
    save,
    dismissError: () => setError(""),
  };
}
