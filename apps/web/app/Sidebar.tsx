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
  dashboard: "M3 13h6v8H3zM15 3h6v18h-6zM9 17h6v4H9zM9 3h6v10H9z",
  strategy: "M3 3v18h18M7 15l4-4 3 3 5-6",
  review: "M9 12l2 2 4-4M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z",
} as const;

/**
 * One flat list, ordered by how often you open it.
 *
 * It was previously grouped under Set up / Strategy / Work, which invented a
 * taxonomy for six links and put the screen you use daily at the bottom. The
 * rule below the divider is enough separation: everything above it is the daily
 * loop, everything below it is configured once and forgotten.
 */
/**
 * Three screens, because Phase 1 is three things.
 *
 * §1.4 the strategy, §1.5–1.6 the drafts waiting on you, §1.7 whether it is
 * learning. Nothing else earns a permanent place: archive, intake and the
 * LinkedIn connection are setup and live in that flow, and autonomy is Phase 2
 * — §1.10 is explicitly "a stub that records intent and gates nothing", so a
 * nav item for it would advertise a capability the product does not have.
 */
const NAV = [
  { href: "/strategy", label: "Strategy", icon: ICONS.strategy },
  { href: "/review", label: "Review", icon: ICONS.review },
  { href: "/dashboard", label: "Progress", icon: ICONS.dashboard },
];

/** Home matches exactly; everything else by prefix, so /review?tab=… stays lit. */
function cls(pathname: string, link: { href: string; exact?: boolean }): string {
  const active = link.exact ? pathname === link.href : pathname.startsWith(link.href);
  return active ? "side-link active" : "side-link";
}

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

      <nav className="side-nav">
        {NAV.map((link) => (
          <Link key={link.href} href={link.href} className={cls(pathname, link)}>
            <Icon d={link.icon} />
            {link.label}
          </Link>
        ))}
      </nav>

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
