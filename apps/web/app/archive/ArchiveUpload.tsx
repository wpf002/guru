"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { API_URL } from "../../lib/api";

/**
 * Drop the ZIP without leaving the page.
 *
 * This was a plain HTML form posting straight at the API, which navigated the
 * browser to a different origin and left the user staring at
 * `{"snapshotId":"cms…","status":"INGESTED"}`. On the one screen where someone
 * is already doing something unfamiliar, that reads as a crash.
 */

interface UploadResult {
  status: string;
  counts?: Record<string, number>;
}

const LABELS: Record<string, string> = {
  connections: "connections",
  shares: "posts",
  comments: "comments",
  messages: "messages",
  invitations: "invitations",
  articles: "articles",
};

export function ArchiveUpload() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<UploadResult | null>(null);

  async function upload(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const file = (form.elements.namedItem("archive") as HTMLInputElement).files?.[0];
    if (!file) return;

    setBusy(true);
    setError(null);
    setResult(null);

    const body = new FormData();
    body.append("archive", file);

    try {
      const res = await fetch(`${API_URL}/archive/upload`, {
        method: "POST",
        // No Content-Type: the browser sets the multipart boundary itself.
        credentials: "include",
        body,
      });

      if (!res.ok) {
        const detail = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(detail?.error ?? `Upload failed (${res.status}).`);
        return;
      }

      setResult((await res.json()) as UploadResult);
      // Refresh the history table underneath without a full reload.
      router.refresh();
    } catch {
      setError("Could not reach the API. Is it running?");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={upload}>
      <input type="file" name="archive" accept=".zip" required disabled={busy} />
      <button className="button" type="submit" disabled={busy}>
        {busy ? "Reading it…" : "Upload archive"}
      </button>

      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}

      {result ? (
        <div className="callout">
          <strong>Archive read.</strong>
          <p>
            {Object.entries(result.counts ?? {})
              .filter(([, n]) => n > 0)
              .map(([k, n]) => `${n} ${LABELS[k] ?? k}`)
              .join(", ") || "Nothing recognisable in that file."}
          </p>
          {/* The first installment has no connections. Saying so beats letting
              someone conclude the upload silently failed. */}
          {(result.counts?.connections ?? 0) === 0 ? (
            <p className="note">
              No connections in that file — it is probably the quick archive rather than
              the larger one. Request the larger archive and upload that instead.
            </p>
          ) : null}
        </div>
      ) : null}
    </form>
  );
}
