import { apiGet } from "../../lib/api";
import {
  ContentReview,
  EngagementReview,
  type DraftView,
  type TargetView,
} from "./ReviewClient";
import { requireSession } from "../../lib/session";

/**
 * The approval surface — roadmap §1.5, §1.6, §3.6.
 *
 * Nothing on this page publishes without a click. That holds at every confidence
 * level in Phase 1, and it is the reason the whole product is safe to point at a
 * real account.
 */
export default async function ReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab } = await searchParams;
  await requireSession();

  const active = tab === "engagement" ? "engagement" : "content";

  const [content, engagement] = await Promise.all([
    apiGet<{ drafts: DraftView[] }>("/content"),
    apiGet<{ targets: TargetView[] }>("/engagement/queue"),
  ]);

  const pending = (content?.drafts ?? []).filter(
    (d) => d.status === "DRAFT" || d.status === "IN_REFINEMENT" || d.status === "APPROVED",
  );

  return (
    <main className="page">
      <header className="head">
        <div className="head-text">
          <h1>Review</h1>
          <p className="lede">Nothing goes out without your approval.</p>
        </div>
      </header>

      <nav className="tabs">
        <a className={active === "content" ? "tab active" : "tab"} href="/review">
          Content ({pending.length})
        </a>
        <a
          className={active === "engagement" ? "tab active" : "tab"}
          href="/review?tab=engagement"
        >
          Engagement ({engagement?.targets.length ?? 0})
        </a>
      </nav>

      {active === "content" ? (
        <ContentReview drafts={pending} />
      ) : (
        <EngagementReview targets={engagement?.targets ?? []} />
      )}
    </main>
  );
}
