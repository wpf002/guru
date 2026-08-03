import Link from "next/link";
import { apiGet } from "../../lib/api";
import { requireSession } from "../../lib/session";

/**
 * The confidence dashboard — roadmap §1.7 and §9.
 *
 * Visible to the user by design. A score the user cannot see is not a trust
 * mechanism, it is a hidden variable — so this page shows the number, the sample
 * size behind it, and what is still missing when it is null.
 */

interface Dashboard {
  categories: {
    category: string;
    score: number | null;
    sampleSize: number;
    minSampleSize: number;
    meetsThreshold: boolean;
    note: string | null;
  }[];
  outreach: { score: number | null; sampleSize: number } | null;
  readyForAutonomyPrompt: boolean;
}

interface Metrics {
  primary: Record<string, number | null>;
  internal: {
    editsPerDraft: { current: number | null; previous: number | null; improving: boolean | null };
    postsPublished: number;
    engagementsPublished: number;
    newConnectionFitRatio: number | null;
  };
  notes: string[];
}

const LABELS: Record<string, string> = {
  TOPIC: "Topic",
  ANGLE: "Angle",
  TONE: "Tone",
  FORMAT: "Format",
  CADENCE: "Cadence",
  ENGAGEMENT_TARGET: "Engagement targets",
};

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, never>>;
}) {
  await searchParams;
  const user = await requireSession();

  const [confidence, metrics] = await Promise.all([
    apiGet<Dashboard>("/confidence"),
    apiGet<Metrics>("/metrics"),
  ]);

  return (
    <main className="page">
      <h1>Dashboard</h1>

      <h2>Confidence by category</h2>
      <p className="lede">
        Scored per category from your recent decisions. Too few decisions shows no score,
        not zero.
      </p>

      <div className="grid">
        {confidence?.categories.map((c) => (
          <div className="card" key={c.category}>
            <div className="card-label">{LABELS[c.category] ?? c.category}</div>
            <div className="card-value">
              {c.score === null ? "—" : `${Math.round(c.score * 100)}%`}
            </div>
            <div className="card-note">
              {c.note ?? `${c.sampleSize} decisions${c.meetsThreshold ? " · at threshold" : ""}`}
            </div>
          </div>
        ))}
      </div>

      {confidence?.outreach ? (
        <p className="note">
          Outreach is scored separately and held to a permanently higher bar. It never
          becomes autonomous — there is no compliant way to send on your behalf, so Guru
          drafts and you send.
        </p>
      ) : null}

      {confidence?.readyForAutonomyPrompt ? (
        <div className="callout">
          <strong>I&rsquo;m ready to run more independently — want to enable that?</strong>
          <p>
            Every category is sustaining its threshold. Turning this on is a separate,
            explicit decision, and you can stop it at any time.
          </p>
          <Link className="button" href="/autonomy">
            Review autonomy settings
          </Link>
        </div>
      ) : null}

      <h2>Is it learning?</h2>
      <div className="grid">
        <Stat
          label="Edits per draft"
          value={metrics?.internal.editsPerDraft.current?.toFixed(2) ?? "—"}
          note={
            metrics?.internal.editsPerDraft.improving === null
              ? "Needs two periods"
              : metrics?.internal.editsPerDraft.improving
                ? "Down on last period — the voice model is landing closer"
                : "Up on last period"
          }
        />
        <Stat label="Posts published" value={String(metrics?.internal.postsPublished ?? 0)} />
        <Stat
          label="Comments published"
          value={String(metrics?.internal.engagementsPublished ?? 0)}
        />
        <Stat
          label="New connections matching persona"
          value={
            metrics?.internal.newConnectionFitRatio === null ||
            metrics?.internal.newConnectionFitRatio === undefined
              ? "—"
              : `${Math.round(metrics.internal.newConnectionFitRatio * 100)}%`
          }
          note="New connections only"
        />
      </div>

      {metrics?.notes.length ? (
        <ul className="notes">
          {metrics.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      ) : null}
    </main>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="card">
      <div className="card-label">{label}</div>
      <div className="card-value">{value}</div>
      {note ? <div className="card-note">{note}</div> : null}
    </div>
  );
}
