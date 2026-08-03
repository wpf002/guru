"use client";

import { useState } from "react";
import { API_URL } from "../../../lib/api";

/** The one slow step — a minute or so of model time — so it says so. */
export function BuildRoadmap({ done }: { done?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (done) {
    return (
      <div className="setup-nav">
        <a className="button" href="/strategy">
          See it
        </a>
      </div>
    );
  }

  async function build() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/roadmap`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? "Could not build it. Try again.");
        return;
      }
      window.location.assign("/strategy");
    } catch {
      setError("Could not reach the API.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="setup-nav">
        <button type="button" onClick={build} disabled={busy}>
          {busy ? "Thinking — about a minute…" : "Build my strategy"}
        </button>
      </div>
    </>
  );
}
