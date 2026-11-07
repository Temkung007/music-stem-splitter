"use client";

import { AudioLines, Drum, Guitar, Mic2, Piano } from "lucide-react";
import { useLocale } from "@/components/locale-provider";

/** Decorative output preview, deliberately distinct from live progress. */
export function SoundPreview({ expanded = false }: { expanded?: boolean }) {
  const { t } = useLocale();
  const tracks = [
    { label: t("เสียงร้อง"), Icon: Mic2, color: "#c7b2f0" },
    { label: t("กลอง"), Icon: Drum, color: "#e5b78e" },
    { label: t("เบส"), Icon: Guitar, color: "#9ec7d0" },
    { label: t("ดนตรี"), Icon: Piano, color: "#cce699" },
  ];
  return (
    <div className={`output-preview ${expanded ? "output-preview-expanded" : ""}`} aria-hidden="true">
      <div className="preview-top"><span><AudioLines size={15} /> {t("หนึ่งเพลง หลายความเป็นไปได้")}</span><span>4 STEMS</span></div>
      <div className="preview-tracks">
        {tracks.map(({ label, Icon, color }, row) => (
          <div className="preview-track" key={label} style={{ color }}>
            <span className="preview-track-label"><Icon size={15} /> {label}</span>
            <span className="preview-wave">
              {Array.from({ length: 64 }, (_, i) => <i key={i} style={{ height: `${12 + Math.abs(Math.sin(i * 1.91 + row) * Math.cos(i * 0.24 + row)) * 86}%` }} />)}
            </span>
          </div>
        ))}
      </div>
      {expanded && <div className="preview-bottom"><span>ORIGINAL → REIMAGINED</span><span>WAV / ZIP</span></div>}
    </div>
  );
}
