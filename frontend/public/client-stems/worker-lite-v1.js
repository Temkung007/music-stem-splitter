// The upstream runtime installs a message handler; this bridge keeps downloads,
// checksums, inference and result packaging entirely inside one dedicated worker.
import initialize, { separate } from "./assets/runtime-lite-v1.js";
import { packAudio, zipStems } from "./audio-tools.mjs";

const send = self.postMessage.bind(self);
const originalError = console.error;
console.error = (...args) => {
  send({ type: "diagnostic", text: args.map(String).join(" ").slice(0, 1800) });
  originalError(...args);
};
const MODEL = "weights-8193504c.bin";
const MODEL_BYTES = 84030696;
const MODEL_SHA =
  "8193504cdfb3943adaf039b8acb524a46e87ebf232c383ac7a32c80a6578423e";
const MODEL_URL = new URL("./assets/" + MODEL, self.location.href).href;
const CACHE = "stemora-client-gpu-v035";
let mode = "4stems",
  jobActive = false,
  memoryWeights,
  wasmReady;
const progress = (phase, value) =>
  send({ type: "progress", phase, progress: value });

// Keep driver diagnostics in the console; never expose audio or model details in the UI.
if (typeof GPUAdapter !== "undefined") {
  const requestDevice = GPUAdapter.prototype.requestDevice;
  GPUAdapter.prototype.requestDevice = async function (descriptor) {
    const device = await requestDevice.call(this, descriptor);
    device.addEventListener("uncapturederror", (event) =>
      send({
        type: "diagnostic",
        text: "GPU validation: " + event.error.message,
      }),
    );
    void device.lost.then((info) => {
      send({
        type: "diagnostic",
        text: "GPU device lost: " + info.reason + " " + info.message,
      });
      send({ type: "device-lost" });
    });
    return device;
  };
}

async function valid(buffer) {
  if (buffer.byteLength !== MODEL_BYTES) return false;
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", buffer));
  return (
    Array.from(hash, (b) => b.toString(16).padStart(2, "0")).join("") ===
    MODEL_SHA
  );
}

async function weights() {
  if (memoryWeights) {
    progress("cached", 24);
    return memoryWeights;
  }
  let cache;
  try {
    cache = await caches.open(CACHE);
    const cached = await cache.match(MODEL_URL);
    if (cached) {
      const buffer = await cached.arrayBuffer();
      if (await valid(buffer)) {
        progress("cached", 24);
        memoryWeights = new Uint8Array(buffer);
        return memoryWeights;
      }
      await cache.delete(MODEL_URL);
    }
  } catch {
    /* Private browsing or storage eviction must not prevent inference. */
  }
  progress("download", 4);
  const response = await fetch(MODEL_URL, { credentials: "omit" });
  if (!response.ok || !response.body) throw new Error("download_failed");
  const reader = response.body.getReader(),
    bytes = new Uint8Array(MODEL_BYTES);
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (received + value.length > MODEL_BYTES) {
      await reader.cancel();
      throw new Error("download_failed");
    }
    bytes.set(value, received);
    received += value.length;
    progress("download", 4 + Math.floor((20 * received) / MODEL_BYTES));
  }
  if (!(await valid(bytes.buffer))) throw new Error("download_failed");
  try {
    await cache?.put(
      MODEL_URL,
      new Response(bytes, {
        headers: { "Content-Type": "application/octet-stream" },
      }),
    );
  } catch {
    /* A full device cache is optional, not a failed separation. */
  }
  memoryWeights = bytes;
  return bytes;
}

async function run(data) {
  mode = data.mode;
  try {
    if (!self.isSecureContext || !self.navigator.gpu)
      throw new Error("unsupported");
    const adapter = await navigator.gpu.requestAdapter({
      powerPreference: "high-performance",
    });
    if (!adapter) throw new Error("unsupported");
    if (
      !(data.left instanceof Float32Array) ||
      !(data.right instanceof Float32Array) ||
      data.left.length !== data.right.length ||
      !data.left.length ||
      data.left.length > 44100 * 600 ||
      !["4stems", "2stems"].includes(mode)
    )
      throw new Error("invalid_audio");
    progress("loading", 3);
    wasmReady ||= initialize({
      module_or_path: new URL(
        "./assets/runtime-lite-v1_bg.wasm",
        self.location.href,
      ),
    });
    await wasmReady;
    const modelBytes = await weights();
    progress("preparing", 28);
    const separated = await separate(
      modelBytes,
      "htdemucs",
      ["drums", "bass", "other", "vocals"],
      data.left,
      data.right,
      44100,
      (event) => {
        if (event.type === "chunk_done")
          progress(
            "separating",
            30 + Math.floor((60 * event.index) / event.total),
          );
      },
    );
    const names = separated.stem_names(),
      samples = separated.n_samples;
    const audio = separated.take_audio();
    progress("packing", 94);
    const files = packAudio(audio, names, samples, 44100, mode);
    const archive = zipStems(files, data.filename);
    send({
      type: "complete",
      files: files.map(({ bytes, ...file }) => ({
        ...file,
        blob: new Blob([bytes], { type: "audio/wav" }),
        size_bytes: bytes.length,
      })),
      archive,
      duration: samples / 44100,
    });
  } catch (error) {
    send({
      type: "error",
      code: ["unsupported", "invalid_audio", "download_failed"].includes(
        error?.message,
      )
        ? error.message
        : "gpu_failed",
    });
  }
}

self.onmessage = async ({ data }) => {
  if (data.type !== "run" || jobActive) return;
  jobActive = true;
  try {
    // Prevent multiple tabs from exhausting GPU memory at the same time.
    if (navigator.locks)
      await navigator.locks.request(
        "stemora-local-audio",
        { ifAvailable: true },
        async (lock) => {
          if (!lock) send({ type: "error", code: "gpu_busy" });
          else await run(data);
        },
      );
    else await run(data);
  } finally {
    jobActive = false;
  }
};
