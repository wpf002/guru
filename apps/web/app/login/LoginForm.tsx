"use client";

import { useState } from "react";
import { API_URL } from "../../lib/api";

/**
 * Sign in and sign up in one form.
 *
 * Separate pages for two flows that differ by one field is more navigation than
 * the choice deserves, and people routinely land on the wrong one.
 */
export function LoginForm({ initialMode }: { initialMode: "login" | "signup" }) {
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

      // A full navigation, not router.push. The root layout decides whether to
      // render the sidebar, and a client-side push reuses the layout that was
      // rendered while signed out — so the first screen after signing in had no
      // navigation on it at all until the user happened to reload.
      window.location.assign("/");
    } catch {
      setError("Could not reach the API. Is it running on port 3001?");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="draft">
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}

      <label className="field">
        <span>Email</span>
        <input
          type="email"
          required
          autoComplete="email"
          placeholder="you@company.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </label>

      {signingUp ? (
        <label className="field">
          <span>Name</span>
          <input
            type="text"
            autoComplete="name"
            placeholder="Optional"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
      ) : null}

      <label className="field">
        <span>Password</span>
        <input
          type="password"
          required
          autoComplete={signingUp ? "new-password" : "current-password"}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {signingUp ? (
          <small>
            At least 12 characters. A phrase you can remember beats a short password you
            cannot.
          </small>
        ) : null}
      </label>

      <button className="block" type="submit" disabled={busy}>
        {busy ? "Working…" : signingUp ? "Create account" : "Sign in"}
      </button>

      <div style={{ textAlign: "center" }}>
        <button
          type="button"
          className="linky"
          onClick={() => {
            setMode(signingUp ? "login" : "signup");
            setError(null);
          }}
        >
          {signingUp ? "I already have an account" : "Create an account instead"}
        </button>
      </div>
    </form>
  );
}
