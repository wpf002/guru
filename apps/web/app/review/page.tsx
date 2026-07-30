import { apiGet } from "../../lib/api";
import {
  ContentReview,
  EngagementReview,
  type DraftView,
  type TargetView,
} from "./ReviewClient";

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
  searchParams: Promise<{ userId?: string; tab?: string }>;
}) {
  const { userId, tab } = await searchParams;
  if (!userId) {
    return (
      <main className="page">
        <h1>Review</h1>
        <p className="lede">Add a userId to the URL to review drafts.</p>
      </main>
    );
  }

  const active = tab === "engagement" ? "engagement" : "content";

  const [content, engagement] = await Promise.all([
    apiGet<{ drafts: DraftView[] }>(`/content/${userId}`),
    apiGet<{ targets: TargetView[] }>(`/engagement/queue/${userId}`),
  ]);

  const pending = (content?.drafts ?? []).filter(
    (d) => d.status === "DRAFT" || d.status === "IN_REFINEMENT" || d.status === "APPROVED",
  );

  return (
    <main className="page">
      <h1>Review</h1>

      <nav className="tabs">
        <a className={active === "content" ? "tab active" : "tab"} href={`/review?userId=${userId}`}>
          Content ({pending.length})
        </a>
        <a
          className={active === "engagement" ? "tab active" : "tab"}
          href={`/review?userId=${userId}&tab=engagement`}
        >
          Engagement ({engagement?.targets.length ?? 0})
        </a>
      </nav>

      {active === "content" ? (
        <ContentReview userId={userId} drafts={pending} />
      ) : (
        <EngagementReview userId={userId} targets={engagement?.targets ?? []} />
      )}
    </main>
  );
}
