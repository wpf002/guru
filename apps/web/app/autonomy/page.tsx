import { apiGet } from "../../lib/api";
import { requireSession } from "../../lib/session";

/**
 * Autonomy settings and audit — roadmap §2.1, §2.2, §2.5.
 *
 * Every control on this page is a limit rather than a capability, and the log
 * below shows the blocks as prominently as the actions. A user extending this
 * much trust is owed the evidence that the guardrails are doing something.
 */

interface Settings {
  engagementAutonomyEnabled: boolean;
  contentAutonomyEnabled: boolean;
  dailyEngagementCap: number;
  dailyContentCap: number;
  targetAllowlist: string[];
  requireAllowlist: boolean;
  topicExclusions: string[];
  killSwitch: boolean;
  killSwitchReason: string | null;
}

interface Action {
  id: string;
  kind: string;
  outcome: string;
  reason: string | null;
  createdAt: string;
}

export default async function AutonomyPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, never>>;
}) {
  await searchParams;
  await requireSession();

  const [settings, log] = await Promise.all([
    apiGet<Settings>("/autonomy"),
    apiGet<{ actions: Action[] }>("/autonomy/log"),
  ]);

  return (
    <main className="page">
      <h1>Autonomy</h1>
      <p className="lede">
        Guru can act without waiting for you, within limits you set. It earns this
        separately for commenting and for posting, and it never earns it for outreach —
        there is no compliant way to send on your behalf, so that stays a draft you send.
      </p>

      {settings?.killSwitch ? (
        <div className="callout danger">
          <strong>Everything is stopped.</strong>
          <p>{settings.killSwitchReason ?? "Halted by the kill switch."}</p>
        </div>
      ) : null}

      <div className="grid">
        <div className="card">
          <div className="card-label">Commenting</div>
          <div className="card-value">
            {settings?.engagementAutonomyEnabled ? "On" : "Off"}
          </div>
          <div className="card-note">Up to {settings?.dailyEngagementCap ?? 0} per day</div>
        </div>
        <div className="card">
          <div className="card-label">Posting</div>
          <div className="card-value">{settings?.contentAutonomyEnabled ? "On" : "Off"}</div>
          <div className="card-note">Up to {settings?.dailyContentCap ?? 0} per day</div>
        </div>
        <div className="card">
          <div className="card-label">Allowlist</div>
          <div className="card-value">{settings?.targetAllowlist.length ?? 0}</div>
          <div className="card-note">
            {settings?.requireAllowlist
              ? "Required — an empty list blocks everything"
              : "Not required"}
          </div>
        </div>
        <div className="card">
          <div className="card-label">Excluded topics</div>
          <div className="card-value">{settings?.topicExclusions.length ?? 0}</div>
          <div className="card-note">Checked on top of your never-say list</div>
        </div>
      </div>

      <h2>What it actually did</h2>
      <p className="note">
        Blocked entries are the point of this log — they are the evidence the limits hold.
      </p>

      {log?.actions.length ? (
        <table className="table">
          <thead>
            <tr>
              <th>When</th>
              <th>Kind</th>
              <th>Outcome</th>
              <th>Reason</th>
            </tr>
          </thead>
          <tbody>
            {log.actions.map((a) => (
              <tr key={a.id}>
                <td>{new Date(a.createdAt).toLocaleString()}</td>
                <td>{a.kind.toLowerCase()}</td>
                <td className={a.outcome === "PUBLISHED" ? "" : "blocked"}>
                  {a.outcome.replaceAll("_", " ").toLowerCase()}
                </td>
                <td>{a.reason ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="note">Nothing yet — autonomy has not run.</p>
      )}
    </main>
  );
}
