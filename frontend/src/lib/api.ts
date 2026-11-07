import { clientLocale, translateClient as tr } from "@/lib/i18n";
export async function apiFetch(path: string, options: RequestInit = {}) {
  const method = (options.method || "GET").toUpperCase();
  const headers = new Headers(options.headers);
  headers.set("Accept-Language", clientLocale());
  if (!["GET", "HEAD", "OPTIONS"].includes(method))
    headers.set("X-Stemora-Request", "1");
  const response = await fetch(path, {
    ...options,
    headers,
    credentials: "same-origin",
  });
  if (response.status === 401 && !path.includes("/auth/"))
    window.dispatchEvent(new Event("stemora:unauthorized"));
  return response;
}
export async function api<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await apiFetch(path, options);
  const data = await response.json().catch(() => null);
  if (!response.ok)
    throw new Error(
      typeof data?.detail === "string"
        ? data.detail
        : tr("ทำรายการไม่สำเร็จ กรุณาตรวจสอบข้อมูลแล้วลองอีกครั้ง"),
    );
  return data as T;
}
export const jsonRequest = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});
export type User = {
  id: string;
  email: string;
  name: string;
  created_at: string;
};
export type MusicTrack = {
  id: string;
  filename: string;
  title: string;
  artist: string;
  genre: string;
  tags: string[];
  status: "queued" | "analyzing" | "ready" | "failed";
  message: string;
  bpm: number | null;
  musical_key: string | null;
  camelot: string | null;
  energy: number | null;
  duration: number;
  size_bytes: number;
  peaks: number[];
  audio_url: string;
  deleted_at: string | null;
  analysis: { estimated?: boolean; note?: string; manually_edited?: boolean };
  created_at: string;
};
export type SetItem = { track_id: string; locked: boolean; note: string };
export type Playlist = {
  id: string;
  name: string;
  description: string;
  prompt: string;
  target_minutes: number;
  profile: string;
  items: SetItem[];
  revision: number;
  created_at: string;
  updated_at: string;
};
export type WorkspaceSummary = {
  total: number;
  ready: number;
  used_bytes: number;
  quota_bytes: number;
  playlists: number;
  storage: { driver: string; ready: boolean };
  assistant: boolean;
  assistant_configured?: boolean;
};
export const fileSize = (bytes: number) =>
  bytes >= 1000 ** 3
    ? `${(bytes / 1000 ** 3).toFixed(2)} GB`
    : `${(bytes / 1000 ** 2).toFixed(1)} MB`;
