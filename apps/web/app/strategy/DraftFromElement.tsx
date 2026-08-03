"use client";

import { useState } from "react";
import { API_URL } from "../../lib/api";

/**
 * The only route from strategy to content.
 *
 * There is deliberately no way to generate a post from a free-text topic —
 * `ContentDraft.roadmapElementId` is non-nullable, so this button is what makes
 * "strategy before content" a constraint rather than a principle.
 */
export function DraftFromElement({ elementId }: { elementId: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function draft() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/content/draft`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ roadmapElementId: elementId }),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        // A blocked draft is the constraint filter working, not a failure.
        setError(body?.error ?? `Could not write it (${res.status}).`);
        return;
      }
      window.location.assign("/review");
    } catch {
      setError("Could not reach the API.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" className="secondary" onClick={draft} disabled={busy}>
        {busy ? "Writing…" : "Write a post from this"}
      </button>
      {error ? (
        <span className="error inline" role="alert">
          {error}
        </span>
      ) : null}
    </>
  );
}
