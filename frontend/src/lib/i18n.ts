import catalog from "./translations.json";
export type Locale = "th" | "en";
type Parameters = Record<string, unknown>;
const messages = catalog as Record<string, { th: string; en: string }>;
const aliases = new Map<string, { th: string; en: string }>();
const patterns: {
  pattern: RegExp;
  names: string[];
  message: { th: string; en: string };
}[] = [];
for (const [key, message] of Object.entries(messages)) {
  for (const text of new Set([key, message.th, message.en])) {
    aliases.set(text, message);
    if (/\{\d+\}/.test(text)) {
      const names: string[] = [];
      const parts = text.split(/(\{\d+\})/).map((part) => {
        if (/^\{\d+\}$/.test(part)) {
          names.push(part.slice(1, -1));
          return "([\\s\\S]*?)";
        }
        return part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      });
      patterns.push({
        pattern: new RegExp("^" + parts.join("") + "$"),
        names,
        message,
      });
    }
  }
}
function format(text: string, parameters: Parameters) {
  return text.replace(/\{(\d+)\}/g, (match, name) =>
    name in parameters ? String(parameters[name]) : match,
  );
}
export function translate(
  source: string,
  locale: Locale,
  parameters?: Parameters,
): string {
  const exact = messages[source] || aliases.get(source);
  if (exact) return format(exact[locale], parameters || {});
  for (const entry of patterns) {
    const match = entry.pattern.exec(source);
    if (match)
      return format(
        entry.message[locale],
        Object.fromEntries(entry.names.map((name, i) => [name, match[i + 1]])),
      );
  }
  return source;
}
export function clientLocale(): Locale {
  return typeof document !== "undefined" &&
    document.documentElement.lang === "en"
    ? "en"
    : "th";
}
export function translateClient(source: string, parameters?: Parameters) {
  return translate(source, clientLocale(), parameters);
}
export function preferredLocale(header: string | null): Locale {
  const candidates = (header || "")
    .split(",")
    .map((entry) => {
      const [tag, ...options] = entry.trim().split(";");
      const quality = options.find((value) => value.trim().startsWith("q="));
      return {
        language: tag.toLowerCase().split("-")[0],
        quality: quality ? Number(quality.trim().slice(2)) : 1,
      };
    })
    .filter((entry) => entry.quality > 0)
    .sort((a, b) => b.quality - a.quality);
  return (
    (candidates.find(
      (entry) => entry.language === "th" || entry.language === "en",
    )?.language as Locale) || "th"
  );
}
