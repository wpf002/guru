import Link from "next/link";
import { API_URL, apiGet } from "../../../lib/api";
import { requireStep } from "../../../lib/gate";

export default async function SetupConnect() {
  await requireStep("connect");
  const status = await apiGet<{ connected: boolean; name?: string }>(
    "/auth/linkedin/status",
  );

  return (
    <>
      <h1>Let Guru post for you</h1>
      <p className="lede">Optional. Without it, copy each approved draft yourself.</p>

      {status?.connected ? (
        <div className="callout">
          <strong>Connected as {status.name}.</strong>
          <p>Approved drafts can publish straight to your feed.</p>
        </div>
      ) : (
        <div className="checkpoint">
          <p>
            Guru gets your name, your email, and permission to post — only ever things
            you have approved. It never reads your feed and never sends messages.
          </p>
          <a className="button" href={`${API_URL}/auth/linkedin/start`}>
            Connect LinkedIn
          </a>
        </div>
      )}

      <div className="setup-nav">
        <Link className="button" href="/review">
          Finish setup
        </Link>
      </div>
    </>
  );
}
