// Run before dev/build. Large public inference assets are reproducible, not checked into Git.
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  open,
  writeFile,
} from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("../public/client-stems/", import.meta.url));
const manifest = JSON.parse(await readFile(join(root, "assets.json"), "utf8"));
const directory = join(root, "assets");
await mkdir(directory, { recursive: true });
async function valid(path, item) {
  try {
    if ((await stat(path)).size !== item.bytes) return false;
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(path)) hash.update(chunk);
    return hash.digest("hex") === item.sha256;
  } catch {
    return false;
  }
}
for (const item of manifest.files) {
  if (
    !/^[a-zA-Z0-9._-]+$/.test(item.name) ||
    (!item.packaged && !item.url?.startsWith("https://"))
  )
    throw new Error("Invalid asset manifest");
  const target = join(directory, item.name);
  if (!(await valid(target, item))) {
    const pending = target + ".pending";
    try {
      if (item.packaged) {
        if (!/^[a-zA-Z0-9._-]+$/.test(item.packaged))
          throw new Error("Invalid packaged asset");
        await writeFile(
          pending,
          gunzipSync(
            await readFile(
              new URL("../inference-assets/" + item.packaged, import.meta.url),
            ),
          ),
        );
      } else {
        console.log("Downloading browser processing files:", item.name);
        const response = await fetch(item.url, {
          signal: AbortSignal.timeout(900000),
        });
        if (!response.ok || !response.body)
          throw new Error(
            "Could not download browser inference asset: " + response.status,
          );
        const file = await open(pending, "w");
        let received = 0;
        try {
          for await (const chunk of response.body) {
            received += chunk.length;
            if (received > item.bytes)
              throw new Error("Browser asset exceeds its pinned size");
            await file.writeFile(chunk);
          }
        } finally {
          await file.close();
        }
      }
      if (!(await valid(pending, item)))
        throw new Error("Browser asset checksum mismatch");
      await rename(pending, target);
    } finally {
      await rm(pending, { force: true });
    }
  }
  console.log("Browser asset verified:", item.name, item.bytes);
}
