"use client";

import { useRouter } from "next/navigation";
import { API_URL } from "../lib/api";

export function SignOut({ email }: { email: string }) {
  const router = useRouter();

  async function signOut() {
    // credentials: "include" is what lets the API see the session it is being
    // asked to revoke; without it the row survives and the "sign out" is a lie.
    // No Content-Type header: this POST has no body, and declaring JSON without
    // one makes Fastify reject it.
    await fetch(`${API_URL}/auth/logout`, { method: "POST", credentials: "include" });
    router.refresh();
    router.push("/login");
  }

  return (
    <div
      style={{
        display: "flex",
        gap: "0.75rem",
        alignItems: "baseline",
        justifyContent: "flex-end",
        color: "var(--muted)",
        fontSize: "0.9rem",
      }}
    >
      <span>{email}</span>
      <button
        type="button"
        onClick={signOut}
        style={{
          background: "none",
          border: "none",
          color: "inherit",
          textDecoration: "underline",
          cursor: "pointer",
          padding: 0,
        }}
      >
        Sign out
      </button>
    </div>
  );
}
