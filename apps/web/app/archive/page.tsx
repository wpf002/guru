import { API_URL, apiGet } from "../../lib/api";

/**
 * Archive setup and status — roadmap §1.1.
 *
 * The honest version of "zero user steps": LinkedIn emails a link, not a file,
 * and that link usually needs the member's own session. When Guru can fetch it,
 * this page just shows the result. When it can't, it hands over the exact link
 * rather than failing quietly.
 */

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
  searchParams: Promise<{ userId?: string; connected?: string; error?: string }>;
}) {
  const { userId, connected, error } = await searchParams;

  if (!userId) {
    return (
      <main className="page">
        <h1>Your LinkedIn archive</h1>
        <p className="lede">Add a userId to the URL to set up archive ingestion.</p>
      </main>
    );
  }

  const data = await apiGet<{ snapshots: Snapshot[] }>(`/archive/status/${userId}`);
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
      {connected ? <p className="callout">Gmail connected — Guru will watch for the archive email.</p> : null}

      <section className="checkpoint">
        <h2>Step 1 — request it from LinkedIn</h2>
        <ol>
          <li>
            Open <strong>Settings &rarr; Data privacy &rarr; Get a copy of your data</strong>.
          </li>
          <li>
            Choose the <strong>larger archive</strong>. Your connections are only in that
            one — the quick-select files do not include them.
          </li>
          <li>
            LinkedIn sends it in two emails. The first arrives within minutes and has your
            connections; the rest follows later.
          </li>
        </ol>

        <h2>Step 2 — let Guru pick it up</h2>
        <p>
          With Gmail connected, Guru watches for those two emails and ingests them. It
          only ever reads mail from LinkedIn matching that subject, and the access is
          read-only.
        </p>
        <a className="button" href={`${API_URL}/auth/google/start`}>
          Connect Gmail
        </a>
        <p className="note">
          Prefer not to? Skip it — download the ZIP yourself and upload it below. Same
          result, one extra step.
        </p>
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
      <form action={`${API_URL}/archive/upload`} method="post" encType="multipart/form-data">
        <input type="hidden" name="userId" value={userId} />
        <input type="file" name="archive" accept=".zip" required />
        <button className="button" type="submit">
          Upload archive
        </button>
      </form>

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
