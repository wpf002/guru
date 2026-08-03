"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { API_URL } from "../lib/api";

/**
 * The app's navigation.
 *
 * Every screen used to be a dead end — no header, no links between pages — so
 * the only route from intake to review was editing the URL bar. A client
 * component because the active state depends on the current path.
 */

const SECTIONS = [
  {
    label: "Set up",
    links: [
      { href: "/archive", label: "Archive" },
      { href: "/connect", label: "LinkedIn" },
    ],
  },
  {
    label: "Strategy",
    links: [
      { href: "/intake", label: "Intake" },
      { href: "/dashboard", label: "Dashboard" },
    ],
  },
  {
    label: "Work",
    links: [
      { href: "/review", label: "Review" },
      { href: "/autonomy", label: "Autonomy" },
    ],
  },
];

export function Sidebar({ email }: { email: string }) {
  const pathname = usePathname();

  async function signOut() {
    // credentials: "include" is what lets the API see the session it is being
    // asked to revoke; without it the row survives and the sign-out is a lie.
    await fetch(`${API_URL}/auth/logout`, { method: "POST", credentials: "include" });
    // Full navigation for the same reason as sign-in: the root layout has to be
    // re-rendered on the server to drop the sidebar.
    window.location.assign("/login");
  }

  return (
    <aside className="sidebar">
      <Link className="brand" href="/">
        <span className="brand-mark">G</span>
        Guru
      </Link>

      {SECTIONS.map((section) => (
        <div key={section.label}>
          <div className="side-label">{section.label}</div>
          {section.links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              // startsWith so /review?tab=engagement still marks Review active.
              className={pathname.startsWith(link.href) ? "side-link active" : "side-link"}
            >
              {link.label}
            </Link>
          ))}
        </div>
      ))}

      <div className="side-foot">
        <div className="side-user" title={email}>
          {email}
        </div>
        <button type="button" className="linky" onClick={signOut}>
          Sign out
        </button>
      </div>
    </aside>
  );
}
