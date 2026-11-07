import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { LocaleProvider } from "@/components/locale-provider";
import { preferredLocale, type Locale } from "@/lib/i18n";
import "./globals.css";
import "./taste-skill.css";
import "./workspace.css";
import "./redesign.css";

async function requestLocale(): Promise<Locale> {
  const saved = (await cookies()).get("stemora_locale")?.value;
  return saved === "th" || saved === "en"
    ? saved
    : preferredLocale((await headers()).get("accept-language"));
}

export async function generateMetadata(): Promise<Metadata> {
  const locale = await requestLocale();
  return {
    title:
      locale === "th"
        ? "STEMORA — DJ Workspace & Stem Studio สำหรับคนรักเสียงเพลง"
        : "STEMORA — Private DJ Workspace & Stem Studio",
    description:
      locale === "th"
        ? "แยกเสียง 4 แทร็ก Vocals, Drums, Bass, Instruments ด้วย Demucs v4 AI พร้อมมิกเซอร์ DSP และพื้นที่ฟรี 200 MB ต่อบัญชี"
        : "Separate vocals, drums, bass and instruments with Demucs v4 AI. Real-time WebAudio DSP mixer and private S3 music library.",
  };
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const locale = await requestLocale();
  return (
    <html
      lang={locale}
      data-type="software"
      data-radius="soft"
      data-ground="sage"
      data-buttons="solid"
      data-motion="on"
    >
      <head>
        <meta name="site-kind" content="software" />
        <meta name="page-type" content="software" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Urbanist:ital,wght@0,400..700;1,400..700&family=DM+Mono:ital,wght@0,400;0,500;1,400&display=swap"
          rel="stylesheet"
        />
        <link rel="stylesheet" href="/assets/system.css" />
        <link rel="stylesheet" href="/assets/ui/cards.css" />
        <link rel="stylesheet" href="/assets/motion/motion.css" />
        <link rel="stylesheet" href="/assets/backgrounds/backgrounds.css" />
        <link rel="stylesheet" href="/assets/layout/layout.css" />
        <link rel="stylesheet" href="/assets/icons/icon.css" />
        <style
          dangerouslySetInnerHTML={{
            __html: `
              :root {
                --p-bg: #111213;
                --p-surface: #18191b;
                --p-ink: #f2f4ec;
                --p-muted: #9fa697;
                --p-accent: #d7f98b;
                --p-accent-ink: #111213;
                --p-action: #d7f98b;
                --p-action-ink: #111213;
                --accent: #d7f98b;
                --action: #d7f98b;
                --line: rgba(242, 244, 236, 0.12);
                --line-strong: rgba(242, 244, 236, 0.22);
                --btn-h: 44px;
              }
              main#top {
                margin: 0 !important;
                padding: 0 !important;
                max-width: none !important;
                width: 100% !important;
              }
              .nav__link,
              .nav__actions .btn,
              .nav__actions .language-switcher button {
                font-size: 15px !important;
              }
              .nav__actions .language-switcher button {
                height: 44px !important;
                min-height: 44px !important;
                padding: 0 14px !important;
              }
              .nav__link.active,
              .nav__link[aria-current="page"] {
                color: var(--p-accent) !important;
              }
            `,
          }}
        />
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                function updateNavCurrent() {
                  var vh = window.innerHeight;
                  var links = document.querySelectorAll('.nav__link[href^="#"]');
                  var found = null;
                  links.forEach(function(l) {
                    var id = l.getAttribute('href').slice(1);
                    var sec = document.getElementById(id);
                    if (sec) {
                      var r = sec.getBoundingClientRect();
                      if (r.top <= vh * 0.5 && r.bottom > vh * 0.2) found = l;
                    }
                  });
                  links.forEach(function(l) {
                    if (l === found) {
                      l.setAttribute('aria-current', 'page');
                      l.classList.add('active');
                    } else {
                      l.removeAttribute('aria-current');
                      l.classList.remove('active');
                    }
                  });
                }
                window.addEventListener('scroll', updateNavCurrent, { passive: true });
                document.addEventListener('scroll', updateNavCurrent, { passive: true });
                setInterval(updateNavCurrent, 150);
              })();
            `,
          }}
        />
      </head>
      <body>
        <LocaleProvider initialLocale={locale}>{children}</LocaleProvider>
      </body>
    </html>
  );
}
