import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Aivanta — Business automation, orchestrated intelligently",
  description: "Design, connect, and manage business workflows with AI-assisted automation built for real teams.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
