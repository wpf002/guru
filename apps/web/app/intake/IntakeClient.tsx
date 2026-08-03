"use client";

import { useEffect, useRef, useState } from "react";
import { API_URL } from "../../lib/api";

/**
 * The intake conversation — roadmap §1.2.
 *
 * The progress rail is not decoration: intake is resumable across sittings, and
 * a user returning three days later needs to see where they left off and that
 * the areas marked "from your archive" were not questions they forgot to answer.
 */

interface Progress {
  area: string;
  complete: boolean;
  seeded: boolean;
}

interface TurnResult {
  sessionId: string;
  area: string | null;
  question: string | null;
  complete: boolean;
  progress: Progress[];
}

const AREA_LABELS: Record<string, string> = {
  WHO_THEY_ARE: "Who you are",
  WHERE_THEY_ARE_TODAY: "Where you are today",
  WHERE_THEY_WANT_TO_BE: "Where you want to be",
  WHO_THEY_REACH: "Who you're trying to reach",
  VOICE_AND_CONSTRAINTS: "Voice and constraints",
};

export function IntakeClient() {
  const [state, setState] = useState<TurnResult | null>(null);
  const [messages, setMessages] = useState<{ role: string; text: string }[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    // React 18 StrictMode double-invokes effects in development; without this
    // guard the user sees the opening question twice.
    if (started.current) return;
    started.current = true;

    void (async () => {
      try {
        const result = await post<TurnResult>("/intake/start");
        setState(result);
        // Starting a fresh session has no question yet — ask for the first one.
        const first = result.question
          ? result
          : await post<TurnResult>(`/intake/${result.sessionId}/answer`, { message: null });
        setState(first);
        if (first.question) setMessages([{ role: "assistant", text: first.question }]);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    })();
  }, []);

  async function send() {
    const text = input.trim();
    if (!text || !state || busy) return;

    setBusy(true);
    setError(null);
    setInput("");
    setMessages((m) => [...m, { role: "user", text }]);

    try {
      const result = await post<TurnResult>(`/intake/${state.sessionId}/answer`, {
        message: text,
      });
      setState(result);
      if (result.question) {
        setMessages((m) => [...m, { role: "assistant", text: result.question! }]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function buildBrief() {
    if (!state) return;
    setBusy(true);
    try {
      await post(`/intake/${state.sessionId}/brief`);
      location.href = "/dashboard";
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <div className="intake">
      <aside className="rail">
        {(state?.progress ?? []).map((p) => (
          <div key={p.area} className={p.complete ? "rail-item done" : "rail-item"}>
            <span className="rail-dot" aria-hidden />
            <div>
              <div>{AREA_LABELS[p.area] ?? p.area}</div>
              {p.seeded ? (
                <div className="rail-note">Pre-filled from your archive</div>
              ) : null}
            </div>
          </div>
        ))}
      </aside>

      <div className="conversation">
        {messages.map((m, i) => (
          <div key={i} className={m.role === "user" ? "bubble user" : "bubble assistant"}>
            {m.text}
          </div>
        ))}

        {error ? (
          <p className="error" role="alert">
            {error}
          </p>
        ) : null}

        {state?.complete ? (
          <div className="callout">
            <strong>Intake complete.</strong>
            <p>Guru can now write your strategic brief. You will be able to edit it.</p>
            <button className="button" onClick={buildBrief} disabled={busy}>
              {busy ? "Writing…" : "Build the brief"}
            </button>
          </div>
        ) : (
          <form
            className="composer"
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
          >
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  void send();
                }
              }}
              placeholder="Answer in your own words…"
              rows={3}
              disabled={busy}
            />
            <button className="button" type="submit" disabled={busy || !input.trim()}>
              {busy ? "Thinking…" : "Send"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // The API is a different origin in development, so the session cookie is
    // only sent when this is set. Without it every action is anonymous and 401s.
    credentials: "include",
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error((await res.text()) || `Request failed (${res.status})`);
  return (await res.json()) as T;
}
