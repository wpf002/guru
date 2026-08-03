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
      <h1>Your LinkedIn archive</h1>
      <p className="lede">
        The export is richer than any API tier returns: every connection, every post,
        every comment you have ever left. The comments are what let Guru write in your
        voice on day one instead of after months of corrections.
      </p>

      {error ? (
        <p className="error" role="alert">
          {error === "invalid_state"
            ? "That link expired. Please try again."
            : "We could not connect that account."}
        </p>
      ) : null}
      {connected ? <p className="callout">Gmail connected.</p> : null}

      <section className="checkpoint">
        <h2>First visit — ask LinkedIn for it</h2>
        <p>
          The button opens the exact page. Pick{" "}
          <strong>&ldquo;Download larger data archive&rdquo;</strong> — the top option.
          It is the only one that includes your connections; the checkbox list below it
          does not.
        </p>
        <a className="button" href={LINKEDIN_DOWNLOAD_URL} target="_blank" rel="noreferrer">
          Open LinkedIn&rsquo;s download page
        </a>
        <p className="note">
          Then click <strong>Request archive</strong> and close the tab. Nothing else to
          do. It usually takes a few hours.
        </p>

        <h2>Second visit — bring it back</h2>
        <p>
          <strong>LinkedIn will not email you.</strong> We tested this: the archive sat
          ready for two days and no message ever arrived, while ordinary LinkedIn mail
          kept coming. Do not wait for one.
        </p>
        <p>
          Come back to this page later, open the same link, and the button there will say{" "}
          <strong>Download archive</strong>. Save the ZIP and drop it below — you do not
          need to unzip it.
        </p>
        <a className="button secondary" href={LINKEDIN_DOWNLOAD_URL} target="_blank" rel="noreferrer">
          Check whether it&rsquo;s ready
        </a>
      </section>

      <section className="checkpoint">
        <h2>Meanwhile, don&rsquo;t wait</h2>
        <p>
          Intake, your brief and your first roadmap all run without the archive. Start
          now; uploading it later sharpens what Guru already knows rather than unblocking
          it.
        </p>
        <a className="button secondary" href="/intake">
          Start the intake
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
      <ArchiveUpload />

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
