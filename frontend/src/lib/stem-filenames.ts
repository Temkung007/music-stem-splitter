/** User-facing names only; object storage and model filenames stay canonical. */
export function stemDownloadName(source: string, stem: string): string {
  let title = source.normalize("NFC").replace(/\\/g, "/").split("/").pop()!.replace(/\.[^.]+$/, "").replace(/[\x00-\x1f\x7f<>:"/\\|?*]/g, "_").replace(/^[ .]+|[ .]+$/g, "").replace(/[ .]+$/g, "") || "Track";
  while (new TextEncoder().encode(title).length > 180) title = Array.from(title).slice(0, -1).join("");
  title = title.replace(/[ .]+$/g, "") || "Track";
  const labels: Record<string, string> = {vocals:"Acapella",no_vocals:"Instrumental",drums:"Drums",bass:"Bass",other:"Other Instruments"};
  return `${title} (${labels[stem.replace(/\.wav$/, "")] || "Stem"}).wav`;
}
