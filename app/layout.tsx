import type { Metadata } from "next";
import "./globals.css";
import "./aivanta-theme.css";

export const metadata: Metadata = {
  title: "Rexnora — Intelligence in motion",
  description: "Describe it. Build it. Run it. Rexnora is an intelligent automation platform for individuals, teams and businesses.",
  icons: { icon: "/rexnora-mark.svg", shortcut: "/rexnora-mark.svg", apple: "/rexnora-mark.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
