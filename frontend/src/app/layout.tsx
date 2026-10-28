import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "StemX - AI Music Stem Splitter | แยกเสียงเพลง สเต็ป/สเต็ม ดนตรี เสียงร้อง กลอง เบส",
  description: "Web application to separate music into Vocals, Drums, Bass, and Instruments using AI and Web Audio DSP.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="th" className="dark h-full">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-full bg-[#0a0c14] text-slate-100 antialiased selection:bg-cyan-500/30 selection:text-cyan-200">
        {children}
      </body>
    </html>
  );
}
