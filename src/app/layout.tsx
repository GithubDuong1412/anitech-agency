import type { Metadata } from "next";
import { Fira_Sans, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

const sans = Fira_Sans({
  subsets: ["latin", "latin-ext", "vietnamese"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-sans-face",
  display: "swap",
});

// Fira Code has no Vietnamese glyphs, so labels like "TRỰC TIẾP" fell back to another face.
const mono = IBM_Plex_Mono({
  subsets: ["latin", "latin-ext", "vietnamese"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-mono-face",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Anitech Agency — Agent Operations",
  description: "A visual operations room for the Anitech AI agent team.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="vi" className={`${sans.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
