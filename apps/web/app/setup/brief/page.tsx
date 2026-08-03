import Link from "next/link";
import { apiGet } from "../../../lib/api";
import { requireStep } from "../../../lib/gate";

interface Brief {
  id: string;
  version: number;
  role: string | null;
  industry: string | null;
  niche: string | null;
  subNiche: string | null;
  neverSay: string[];
  persona: { description?: string } | null;
  targetState: { goals?: string } | null;
}

export default async function SetupBrief() {
  await requireStep("brief");
  const brief = await apiGet<Brief>("/brief");

  if (!brief) {
    return (
      <>
        <h1>Your brief</h1>
        <p className="lede">Finish intake and Guru will write it.</p>
        <Link className="button" href="/setup/intake">
          Back to intake
        </Link>
      </>
    );
  }

  return (
    <>
      <h1>Your brief</h1>
      <p className="lede">Everything Guru writes comes from this. Edit it any time.</p>

      <div className="checkpoint">
        <dl className="facts">
          <div>
            <dt>Role</dt>
            <dd>{brief.role ?? "—"}</dd>
          </div>
          <div>
            <dt>Niche</dt>
            <dd>{brief.subNiche ?? brief.niche ?? "—"}</dd>
          </div>
          <div>
            <dt>Audience</dt>
            <dd>{brief.persona?.description ?? "—"}</dd>
          </div>
          <div>
            <dt>Goal</dt>
            <dd>{brief.targetState?.goals ?? "—"}</dd>
          </div>
        </dl>
      </div>

      {brief.neverSay.length > 0 ? (
        <>
          <h2>Never says</h2>
          <div className="checkpoint">
            <div className="chips">
              {brief.neverSay.map((t) => (
                <span className="pill" key={t}>
                  {t}
                </span>
              ))}
            </div>
          </div>
        </>
      ) : null}

      <div className="setup-nav">
        <Link className="button" href="/setup/roadmap">
          Build my strategy
        </Link>
      </div>
    </>
  );
}
