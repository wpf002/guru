import Link from "next/link";
import { apiGet } from "../../../lib/api";
import { ArchiveUpload } from "../_components/ArchiveUpload";
import { requireStep } from "../../../lib/gate";

const DOWNLOAD_URL = "https://www.linkedin.com/mypreferences/d/download-my-data";

export default async function SetupArchive() {
  await requireStep("archive");
  const data = await apiGet<{ snapshots: { status: string }[] }>("/archive/status");
  const has = (data?.snapshots ?? []).some((s) => s.status !== "FAILED");

  return (
    <>
      <h1>Bring in your LinkedIn history</h1>
      <p className="lede">
        Your connections, posts and comments. LinkedIn only hands these over as a file.
      </p>

      {has ? (
        <div className="callout">
          <strong>Archive loaded.</strong>
          <p>Guru knows your network and how you write.</p>
        </div>
      ) : (
        <div className="checkpoint">
          <p>
            On LinkedIn, pick <strong>Download larger data archive</strong> — the top
            option, the only one with your connections — then <strong>Request archive</strong>.
          </p>
          <p>
            It takes a few hours and <strong>no email arrives</strong>. Come back to the
            same page for it.
          </p>
          <a className="button" href={DOWNLOAD_URL} target="_blank" rel="noreferrer">
            Open LinkedIn
          </a>
        </div>
      )}

      <h2>Upload the ZIP</h2>
      <div className="upload">
        <ArchiveUpload />
      </div>

      <div className="setup-nav">
        <Link className={has ? "button" : "button secondary"} href="/setup/intake">
          {has ? "Continue" : "Skip — upload it later"}
        </Link>
      </div>
    </>
  );
}
