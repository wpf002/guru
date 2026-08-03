"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { API_URL } from "../../lib/api";

/**
 * Sign in and sign up in one form.
 *
 * Separate pages for two flows that differ by one field is more navigation than
 * the choice deserves, and people routinely land on the wrong one.
 */
export function LoginForm({ initialMode }: { initialMode: "login" | "signup" }) {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "signup">(initialMode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const signingUp = mode === "signup";

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      const res = await fetch(`${API_URL}/auth/${signingUp ? "signup" : "login"}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Without this the Set-Cookie is dropped and the sign-in silently does
        // nothing — the API is on a different origin in development.
        credentials: "include",
        body: JSON.stringify({
          email,
          password,
          ...(signingUp && name ? { name } : {}),
        }),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? "Something went wrong. Try again.");
        return;
      }

      // Server components read the session cookie, so the cached render has to
      // go — otherwise the dashboard renders its signed-out shell.
      router.refresh();
      router.push("/");
    } catch {
      setError("Could not reach the API. Is it running on port 3001?");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="draft" style={{ display: "grid", gap: "0.75rem" }}>
      <label style={{ display: "grid", gap: "0.25rem" }}>
        <span>Email</span>
        <input
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </label>

      {signingUp && (
        <label style={{ display: "grid", gap: "0.25rem" }}>
          <span>
            Name <span style={{ color: "var(--muted)" }}>(optional)</span>
          </span>
          <input
            type="text"
            autoComplete="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
      )}

      <label style={{ display: "grid", gap: "0.25rem" }}>
        <span>Password</span>
        <input
          type="password"
          required
          autoComplete={signingUp ? "new-password" : "current-password"}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {signingUp && (
          <small style={{ color: "var(--muted)" }}>
            At least 12 characters. A phrase you can remember beats a short password you
            cannot.
          </small>
        )}
      </label>

      {error && (
        <p role="alert" style={{ color: "var(--bad, #b00)", margin: 0 }}>
          {error}
        </p>
      )}

      <button type="submit" disabled={busy}>
        {busy ? "Working…" : signingUp ? "Create account" : "Sign in"}
      </button>

      <button
        type="button"
        onClick={() => {
          setMode(signingUp ? "login" : "signup");
          setError(null);
        }}
        style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer" }}
      >
        {signingUp ? "I already have an account" : "Create an account instead"}
      </button>
    </form>
  );
}
