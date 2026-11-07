/** PCM16 WAV and uncompressed ZIP. Kept in the worker to avoid blocking the UI. */
export function encodeStereo(left, right, sampleRate) {
  if (left.length !== right.length || !left.length)
    throw new Error("invalid_audio");
  const bytes = new Uint8Array(44 + left.length * 4);
  const view = new DataView(bytes.buffer);
  const text = (at, value) =>
    [...value].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
  text(0, "RIFF");
  view.setUint32(4, bytes.length - 8, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 2, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 4, true);
  view.setUint16(32, 4, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, left.length * 4, true);
  const peaks = new Array(140).fill(0);
  let maximum = 0;
  for (let i = 0; i < left.length; i++) {
    for (let ch = 0; ch < 2; ch++) {
      const value = ch ? right[i] : left[i];
      if (!Number.isFinite(value)) throw new Error("invalid_audio");
      maximum = Math.max(maximum, Math.abs(value));
    }
  }
  // One gain for both channels: prevent clipping while preserving their balance.
  const gain = maximum > 1 ? 0.999 / maximum : 1;
  for (let i = 0; i < left.length; i++) {
    const l = left[i] * gain,
      r = right[i] * gain;
    view.setInt16(44 + i * 4, Math.round(l * (l < 0 ? 32768 : 32767)), true);
    view.setInt16(46 + i * 4, Math.round(r * (r < 0 ? 32768 : 32767)), true);
    const bin = Math.min(139, Math.floor((i * 140) / left.length));
    peaks[bin] = Math.max(peaks[bin], Math.abs(l), Math.abs(r));
  }
  const peak = Math.max(...peaks) || 1;
  return {
    bytes,
    peaks: peaks.map((p) => Math.round((p / peak) * 1000) / 1000),
  };
}

const crcTable = Uint32Array.from({ length: 256 }, (_, i) => {
  let value = i;
  for (let b = 0; b < 8; b++)
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export function stemDownloadName(source, stem) {
  let title = source.normalize("NFC").replace(/\\/g, "/").split("/").pop().replace(/\.[^.]+$/, "").replace(/[\x00-\x1f\x7f<>:"/\\|?*]/g, "_").replace(/^[ .]+|[ .]+$/g, "").replace(/[ .]+$/g, "") || "Track";
  while (new TextEncoder().encode(title).length > 180) title = Array.from(title).slice(0, -1).join("");
  title = title.replace(/[ .]+$/g, "") || "Track";
  const labels = {vocals:"Acapella",no_vocals:"Instrumental",drums:"Drums",bass:"Bass",other:"Other Instruments"};
  return `${title} (${labels[stem.replace(/\.wav$/, "")] || "Stem"}).wav`;
}

/** Stored ZIP avoids an expensive compression pass; UTF-8 preserves song titles. */
export function zipStems(files, sourceFilename = "") {
  const parts = [],
    central = [];
  let offset = 0,
    directorySize = 0;
  for (const file of files) {
    if (!/^(vocals|drums|bass|other|no_vocals)\.wav$/.test(file.filename))
      throw new Error("invalid_audio");
    const name = new TextEncoder().encode(sourceFilename ? stemDownloadName(sourceFilename, file.filename) : file.filename),
      size = file.bytes.length;
    const crc = crc32(file.bytes);
    const header = new Uint8Array(30 + name.length),
      h = new DataView(header.buffer);
    h.setUint32(0, 0x04034b50, true);
    h.setUint16(4, 20, true);
    h.setUint16(6, 0x800, true);
    h.setUint16(12, 33, true);
    h.setUint32(14, crc, true);
    h.setUint32(18, size, true);
    h.setUint32(22, size, true);
    h.setUint16(26, name.length, true);
    header.set(name, 30);
    const entry = new Uint8Array(46 + name.length),
      e = new DataView(entry.buffer);
    e.setUint32(0, 0x02014b50, true);
    e.setUint16(4, 20, true);
    e.setUint16(6, 20, true);
    e.setUint16(8, 0x800, true);
    e.setUint16(14, 33, true);
    e.setUint32(16, crc, true);
    e.setUint32(20, size, true);
    e.setUint32(24, size, true);
    e.setUint16(28, name.length, true);
    e.setUint32(42, offset, true);
    entry.set(name, 46);
    parts.push(header, file.bytes);
    central.push(entry);
    offset += header.length + size;
    directorySize += entry.length;
  }
  const end = new Uint8Array(22),
    e = new DataView(end.buffer);
  e.setUint32(0, 0x06054b50, true);
  e.setUint16(8, files.length, true);
  e.setUint16(10, files.length, true);
  e.setUint32(12, directorySize, true);
  e.setUint32(16, offset, true);
  return new Blob([...parts, ...central, end], { type: "application/zip" });
}

export function packAudio(audio, names, samples, sampleRate, mode) {
  const required = ["drums", "bass", "other", "vocals"];
  if (
    names.length !== 4 ||
    required.some((n) => !names.includes(n)) ||
    !Number.isInteger(samples) ||
    samples <= 0 ||
    audio.length !== names.length * samples * 2
  )
    throw new Error("invalid_audio");
  const channel = (name, ch) => {
    const offset = (names.indexOf(name) * 2 + ch) * samples;
    return audio.subarray(offset, offset + samples);
  };
  const output =
    mode === "2stems"
      ? ["vocals", "no_vocals"]
      : ["vocals", "drums", "bass", "other"];
  return output.map((name) => {
    let left, right;
    if (name === "no_vocals") {
      left = new Float32Array(samples);
      right = new Float32Array(samples);
      for (const source of ["drums", "bass", "other"]) {
        const l = channel(source, 0),
          r = channel(source, 1);
        for (let i = 0; i < samples; i++) {
          left[i] += l[i];
          right[i] += r[i];
        }
      }
    } else {
      left = channel(name, 0);
      right = channel(name, 1);
    }
    return {
      name,
      filename: name + ".wav",
      ...encodeStereo(left, right, sampleRate),
    };
  });
}
