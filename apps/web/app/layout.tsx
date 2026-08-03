import type { Metadata } from "next";
import "./globals.css";
import { currentUser } from "../lib/api";
import { Sidebar } from "./Sidebar";

export const metadata: Metadata = {
  title: "Guru",
  description: "AI go-to-market strategist for LinkedIn",
};

/**
 * The app shell.
 *
 * Signed in, every page sits inside a persistent sidebar. Signed out there is
 * nothing to navigate to, so the chrome is dropped and the auth screen gets the
 * whole window.
 */
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();

  return (
    <html lang="en">
      <body>
        <div className={user ? "shell" : "shell plain"}>
          {user ? <Sidebar email={user.email} /> : null}
          <div className="content">{children}</div>
        </div>
      </body>
    </html>
  );
}
