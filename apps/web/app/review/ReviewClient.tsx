"use client";

import { useState } from "react";
import { API_URL } from "../../lib/api";

/**
 * Content and engagement review — roadmap §1.5, §1.6, §1.7.
 *
 * Every draft is shown with its "why" — the roadmap element it serves — because
 * approving content without seeing the strategy behind it is the failure mode
 * the whole product is built to avoid.
 *
 * Rejection asks for a reason. It is optional, and it is the strongest training
 * signal the system gets, so it is offered every time rather than buried.
 */

export interface DraftView {
  id: string;
  content: string;
  status: string;
  whyThis: string | null;
  similarityScore: number | null;
  roadmapElement: { title: string; phase: number; rationale: string };
  revisions: { index: number; author: string; instruction: string | null }[];
}

const CATEGORIES = ["TOPIC", "ANGLE", "TONE", "FORMAT", "CADENCE"] as const;

export function ContentReview({ drafts }: { drafts: DraftView[] }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function call(path: string, body?: unknown) {
    setBusy(path);
    setError(null);
    try {
      const res = await fetch(`${API_URL}${path}`, {
        method: "POST",
        // Declaring JSON with no body makes Fastify reject the request before
        // it reaches the route.
        headers: body === undefined ? {} : { "Content-Type": "application/json" },
        // Different origin in development — without this the session cookie is
        // not sent and every approval 401s.
        credentials: "include",
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (!res.ok) throw new Error((await res.text()) || `Request failed (${res.status})`);
      location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  if (drafts.length === 0) {
    return <p className="lede">Nothing awaiting review. Generate a draft from a roadmap element.</p>;
  }

  return (
    <div>
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}

      {drafts.map((draft) => (
        <article className="draft" key={draft.id}>
          <div className="why">
            <span className="pill">Phase {draft.roadmapElement.phase}</span>{" "}
            <strong>{draft.roadmapElement.title}</strong>
            <p>{draft.whyThis ?? draft.roadmapElement.rationale}</p>
          </div>

          <pre className="draft-body">{draft.content}</pre>

          <div className="meta">
            <span>{draft.status.toLowerCase()}</span>
            {draft.revisions.length > 1 ? (
              <span>{draft.revisions.length - 1} revisions</span>
            ) : null}
            {draft.similarityScore !== null ? (
              <span
                title="How much of this draft overlaps with peer source material. Anything above 25% is blocked before it reaches you."
              >
                {Math.round(draft.similarityScore * 100)}% peer overlap
              </span>
            ) : null}
          </div>

          <Refine draftId={draft.id} onSubmit={(instruction) =>
            call(`/content/${draft.id}/refine`, { instruction })
          } />

          <div className="actions">
            <button
              className="button"
              disabled={busy !== null}
              onClick={() =>
                call("/decisions", {
                  type: "APPROVE",
                  category: "TONE",
                  contentDraftId: draft.id,
                })
              }
            >
              Approve
            </button>
            <RejectButton
              disabled={busy !== null}
              onReject={(reason, category) =>
                call("/decisions", {
                  type: "REJECT",
                  category,
                  contentDraftId: draft.id,
                  reason,
                })
              }
            />
            {draft.status === "APPROVED" ? (
              <button
                className="button secondary"
                disabled={busy !== null}
                onClick={() => call(`/content/${draft.id}/publish`)}
              >
                Publish now
              </button>
            ) : null}
          </div>
        </article>
      ))}
    </div>
  );
}

function Refine({
  draftId,
  onSubmit,
}: {
  draftId: string;
  onSubmit: (instruction: string) => void;
}) {
  const [value, setValue] = useState("");
  return (
    <form
      className="refine"
      onSubmit={(e) => {
        e.preventDefault();
        if (!value.trim()) return;
        onSubmit(value.trim());
        setValue("");
      }}
    >
      <input
        aria-label={`Refine draft ${draftId}`}
        placeholder="Not how I'd phrase it. Shorter. Cut the last line."
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <button type="submit" className="button secondary">
        Refine
      </button>
    </form>
  );
}

/**
 * Rejection captures a reason and a category. Asking which dimension was wrong
 * is what keeps one bad tone from dragging down the topic score.
 */
function RejectButton({
  disabled,
  onReject,
}: {
  disabled: boolean;
  onReject: (reason: string, category: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [category, setCategory] = useState<string>("TONE");

  if (!open) {
    return (
      <button className="button ghost" disabled={disabled} onClick={() => setOpen(true)}>
        Reject
      </button>
    );
  }

  return (
    <div className="reject-panel">
      <label>
        What was wrong?
        <select value={category} onChange={(e) => setCategory(e.target.value)}>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c.toLowerCase()}
            </option>
          ))}
        </select>
      </label>
      <input
        placeholder="Optional — but this is what teaches it"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
      <button className="button ghost" onClick={() => onReject(reason, category)}>
        Confirm reject
      </button>
    </div>
  );
}

export interface TargetView {
  id: string;
  postUrl: string;
  authorName: string | null;
  postContent: string | null;
  priorityScore: number | null;
  scoreRationale: string | null;
  drafts: { id: string; content: string | null; status: string; whyThis: string | null }[];
}

export function EngagementReview({ targets }: { targets: TargetView[] }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function call(path: string, body?: unknown) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}${path}`, {
        method: "POST",
        // Declaring JSON with no body makes Fastify reject the request before
        // it reaches the route.
        headers: body === undefined ? {} : { "Content-Type": "application/json" },
        // Different origin in development — without this the session cookie is
        // not sent and every approval 401s.
        credentials: "include",
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (!res.ok) throw new Error((await res.text()) || `Request failed (${res.status})`);
      location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (targets.length === 0) {
    return (
      <p className="lede">
        No targets in the queue. Run discovery, or add peers if you have not yet.
      </p>
    );
  }

  return (
    <div>
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}

      {targets.map((target) => {
        const draft = target.drafts[0];
        return (
          <article className="draft" key={target.id}>
            <div className="why">
              <strong>{target.authorName ?? "Unknown author"}</strong>{" "}
              {target.priorityScore !== null ? (
                <span className="pill">{target.priorityScore.toFixed(2)}</span>
              ) : null}
              <p>{target.scoreRationale}</p>
            </div>

            {target.postContent ? (
              <blockquote className="quoted">{target.postContent.slice(0, 600)}</blockquote>
            ) : null}

            {draft?.content ? (
              <>
                <pre className="draft-body">{draft.content}</pre>
                {draft.whyThis ? <p className="note">{draft.whyThis}</p> : null}
                <div className="actions">
                  <button
                    className="button"
                    disabled={busy}
                    onClick={async () => {
                      await call("/decisions", {
                        type: "APPROVE",
                        category: "ENGAGEMENT_TARGET",
                        engagementDraftId: draft.id,
                      });
                    }}
                  >
                    Approve
                  </button>
                  <button
                    className="button secondary"
                    disabled={busy}
                    onClick={() => call(`/engagement/draft/${draft.id}/publish`)}
                  >
                    Post comment
                  </button>
                  <button
                    className="button ghost"
                    disabled={busy}
                    onClick={() =>
                      call("/decisions", {
                        type: "REJECT",
                        category: "ENGAGEMENT_TARGET",
                        engagementDraftId: draft.id,
                      })
                    }
                  >
                    Skip
                  </button>
                </div>
              </>
            ) : (
              <div className="actions">
                <button
                  className="button"
                  disabled={busy}
                  onClick={() => call(`/engagement/${target.id}/comment`)}
                >
                  Draft a comment
                </button>
                <button
                  className="button ghost"
                  disabled={busy}
                  onClick={() => call(`/engagement/${target.id}/react`, { type: "LIKE" })}
                >
                  React only
                </button>
                <a className="button ghost" href={target.postUrl} target="_blank" rel="noreferrer">
                  Open post
                </a>
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}
