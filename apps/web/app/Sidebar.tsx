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

type IconProps = { d: string };

/** Inline strokes rather than an icon package — six paths is not a dependency. */
function Icon({ d }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  );
}

const ICONS = {
  archive: "M4 8h16M4 8a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v1a2 2 0 0 1-2 2M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8M10 12h4",
  linkedin: "M7 10v7M7 7v.01M12 17v-4a2 2 0 0 1 4 0v4M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",
  intake: "M8 10h8M8 14h5M21 12a8 8 0 0 1-11.4 7.2L3 21l1.8-6.6A8 8 0 1 1 21 12z",
  dashboard: "M3 13h6v8H3zM15 3h6v18h-6zM9 17h6v4H9zM9 3h6v10H9z",
  review: "M9 12l2 2 4-4M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z",
  autonomy: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6h.09A1.65 1.65 0 0 0 10 3.09V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z",
} as const;

const SECTIONS = [
  {
    label: "Set up",
    links: [
      { href: "/archive", label: "Archive", icon: ICONS.archive },
      { href: "/connect", label: "LinkedIn", icon: ICONS.linkedin },
    ],
  },
  {
    label: "Strategy",
    links: [
      { href: "/intake", label: "Intake", icon: ICONS.intake },
      { href: "/dashboard", label: "Dashboard", icon: ICONS.dashboard },
    ],
  },
  {
    label: "Work",
    links: [
      { href: "/review", label: "Review", icon: ICONS.review },
      { href: "/autonomy", label: "Autonomy", icon: ICONS.autonomy },
    ],
  },
];

export function Sidebar({ email }: { email: string }) {
  const pathname = usePathname();

  async function signOut() {
    // credentials: "include" is what lets the API see the session it is being
    // asked to revoke; without it the row survives and the sign-out is a lie.
    await fetch(`${API_URL}/auth/logout`, { method: "POST", credentials: "include" });
    // Full navigation: the root layout has to re-render on the server to drop
    // the sidebar.
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
              <Icon d={link.icon} />
              {link.label}
            </Link>
          ))}
        </div>
      ))}

      <div className="side-foot">
        <span className="avatar">{email.slice(0, 1)}</span>
        <div className="side-user">
          <span title={email}>{email}</span>
          <button type="button" className="linky" onClick={signOut}>
            Sign out
          </button>
        </div>
      </div>
    </aside>
  );
}
