import { apiGet } from "../../lib/api";
import { requireSession } from "../../lib/session";
import { ArchiveUpload } from "./ArchiveUpload";

/**
 * Archive setup and status — roadmap §1.1.
 *
 * §1.1 targets "archive email -> parsed profile with zero user steps". Running it
 * for real killed that: LinkedIn sent **no email at all**. The settings page
 * showed the archive ready for two days while the inbox stayed empty, and other
 * LinkedIn mail arrived normally throughout. There is nothing to watch for.
 *
 * There is also no API alternative. The Connections API needs `r_1st_connections`,
 * which no self-serve product grants, and Member Data Portability is EEA-only.
 * The export is the only route to connection and history data, and LinkedIn does
 * not automate it.
 *
 * So this page does the only thing that actually helps: link straight to the
 * right screen, name the one option that includes connections, and say plainly
 * that no email is coming and they should return here. Two clicks on LinkedIn,
 * one file drop here.
 */

/** Verified working — the menu path in the old copy sent people hunting. */
const LINKEDIN_DOWNLOAD_URL = "https://www.linkedin.com/mypreferences/d/download-my-data";

interface Snapshot {
  id: string;
  source: string;
  status: string;
  requestedAt: string;
  completedAt: string | null;
  fileReport: { downloadUrl?: string; unrecognizedFiles?: string[] } | null;
  error: string | null;
}

export default async function ArchivePage({
  searchParams,
}: {
  searchParams: Promise<{ connected?: string; error?: string }>;
}) {
  const { connected, error } = await searchParams;
  await requireSession();


  const data = await apiGet<{ snapshots: Snapshot[] }>("/archive/status");
  const snapshots = data?.snapshots ?? [];
  const needsDownload = snapshots.find((s) => s.fileReport?.downloadUrl);

  return (
    <main className="page">
      <header className="head">
        <div className="head-text">
          <h1>Archive</h1>
          <p className="lede">Your connections, posts and comments. LinkedIn only gives these out as a file you request yourself.</p>
        </div>
      </header>

      {error ? (
        <p className="error" role="alert">
          {error === "invalid_state"
            ? "That link expired. Please try again."
            : "We could not connect that account."}
        </p>
      ) : null}
      {connected ? <p className="callout">Gmail connected.</p> : null}

      <section className="checkpoint">
        <h2>Step 1 &middot; Request it</h2>
        <p>
          Pick <strong>Download larger data archive</strong> — the top option. Only that
          one has your connections. Then <strong>Request archive</strong>.
        </p>
        <a className="button" href={LINKEDIN_DOWNLOAD_URL} target="_blank" rel="noreferrer">
          Open LinkedIn
        </a>
      </section>

      <section className="checkpoint">
        <h2>Step 2 &middot; Come back for it</h2>
        <p>
          Takes a few hours. <strong>No email arrives</strong> — check the same page, and
          the button will say Download archive. Drop the ZIP below without unzipping it.
        </p>
        <a className="button secondary" href={LINKEDIN_DOWNLOAD_URL} target="_blank" rel="noreferrer">
          Check if it&rsquo;s ready
        </a>
      </section>

      <section className="checkpoint">
        <h2>Don&rsquo;t wait for it</h2>
        <p>Intake works without the archive. The file only sharpens what Guru has.</p>
        <a className="button secondary" href="/intake">
          Start intake
        </a>
      </section>

      {needsDownload ? (
        <div className="callout">
          <strong>One step needed.</strong>
          <p>
            LinkedIn&rsquo;s download link is tied to your own logged-in session, so Guru
            can&rsquo;t fetch it. Open it, save the ZIP, and upload it here.
          </p>
          <a
            className="button"
            href={needsDownload.fileReport!.downloadUrl}
            target="_blank"
            rel="noreferrer"
          >
            Open the download link
          </a>
        </div>
      ) : null}

      <h2>Upload</h2>
      <div className="upload">
        <ArchiveUpload />
      </div>

      <h2>History</h2>
      {snapshots.length === 0 ? (
        <p className="note">No archive ingested yet.</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Requested</th>
              <th>Source</th>
              <th>Status</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {snapshots.map((s) => (
              <tr key={s.id}>
                <td>{new Date(s.requestedAt).toLocaleString()}</td>
                <td>{s.source === "GMAIL_AUTO" ? "Gmail" : "Upload"}</td>
                <td>{s.status.replaceAll("_", " ").toLowerCase()}</td>
                <td>
                  {s.error ??
                    (s.fileReport?.unrecognizedFiles?.length
                      ? `${s.fileReport.unrecognizedFiles.length} unrecognised files`
                      : "—")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
