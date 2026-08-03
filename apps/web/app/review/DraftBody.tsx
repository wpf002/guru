"use client";

import { useState } from "react";

/**
 * Collapsed preview of a draft.
 *
 * A LinkedIn post runs several hundred words, so showing it in full pushed
 * Approve and Reject two screens below the fold — the two controls the entire
 * screen exists for. Short drafts render whole; long ones clamp with a fade and
 * a toggle.
 */

/** Below this, expanding would reveal almost nothing, so there is no toggle. */
const CLAMP_THRESHOLD = 420;

export function DraftBody({ content }: { content: string }) {
  const [open, setOpen] = useState(false);
  const long = content.length > CLAMP_THRESHOLD;

  if (!long) return <pre className="draft-body">{content}</pre>;

  return (
    <div className="draft-body-wrap">
      <pre className={open ? "draft-body" : "draft-body clamped"}>{content}</pre>
      <button type="button" className="button ghost reveal" onClick={() => setOpen(!open)}>
        {open ? "Show less" : "Read full draft"}
      </button>
    </div>
  );
}
