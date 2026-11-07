import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { encodeStereo, packAudio, zipStems, stemDownloadName } from "../frontend/public/client-stems/audio-tools.mjs";

assert.equal(stemDownloadName("เพลงของฉัน.mp3", "vocals.wav"), "เพลงของฉัน (Acapella).wav");
assert.equal(stemDownloadName("../เพลง.mp3", "no_vocals.wav"), "เพลง (Instrumental).wav");
assert.equal(stemDownloadName("...", "vocals.wav"), "Track (Acapella).wav");
const left = Float32Array.of(0, .5, -.5, 1), right = Float32Array.of(.25, -.25, 0, -1);
const wav = encodeStereo(left, right, 44100);
const view = new DataView(wav.bytes.buffer);
assert.equal(view.getUint32(24, true), 44100);
assert.equal(view.getUint16(22, true), 2);
assert.equal(view.getInt16(48, true), 16384);
assert.equal(view.getInt16(50, true), -8192);
assert.equal(view.getInt16(58, true), -32768);
assert.throws(() => encodeStereo(Float32Array.of(NaN), Float32Array.of(0), 44100));
assert.throws(() => encodeStereo(left, right.subarray(1), 44100));
const samples = 4, names = ["drums", "bass", "other", "vocals"];
const audio = Float32Array.from({length: 32}, (_, i) => (Math.floor(i / 8) + 1) * .1);
const two = packAudio(audio, names, samples, 44100, "2stems");
assert.deepEqual(two.map((f) => f.name), ["vocals", "no_vocals"]);
assert(Math.abs(new DataView(two[1].bytes.buffer).getInt16(44, true) / 32767 - .6) < .0001);
const four = packAudio(audio, names, samples, 44100, "4stems");
assert.equal(four.length, 4);
assert.throws(() => packAudio(audio.subarray(1), names, samples, 44100, "4stems"));
const directory = await mkdtemp(join(tmpdir(), "stemora-client-audio-"));
try {
  await writeFile(join(directory, "stems.zip"), new Uint8Array(await zipStems(four).arrayBuffer()));
  await writeFile(join(directory, "named.zip"), new Uint8Array(await zipStems(four, "เพลงไทย.mp3").arrayBuffer()));
  const named = spawnSync("python3", ["-c", "import sys,zipfile; z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; assert 'เพลงไทย (Acapella).wav' in z.namelist(); assert all(i.flag_bits & 0x800 for i in z.infolist())", join(directory, "named.zip")], {encoding:"utf8"});
  assert.equal(named.status, 0, named.stderr);
  const checked = spawnSync("python3", ["-c", "import sys,zipfile,io,wave; z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; assert set(z.namelist())=={'vocals.wav','drums.wav','bass.wav','other.wav'}; w=wave.open(io.BytesIO(z.read('vocals.wav'))); assert (w.getnchannels(),w.getsampwidth(),w.getframerate(),w.getnframes())==(2,2,44100,4)", join(directory, "stems.zip")], {encoding: "utf8"});
  assert.equal(checked.status, 0, checked.stderr);
} finally { await rm(directory, {recursive:true,force:true}); }
console.log("Client WAV/ZIP: stereo PCM, non-finite rejection, two/four stems, mixture and Python ZIP/CRC validation passed.");
