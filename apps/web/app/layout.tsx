import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Guru",
  description: "AI go-to-market strategist for LinkedIn",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
