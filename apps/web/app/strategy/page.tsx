import { apiGet } from "../../lib/api";
import { requireSession } from "../../lib/session";
import { DraftFromElement } from "./DraftFromElement";

/**
 * The roadmap — §1.4.
 *
 * "Every future draft traces to a roadmap element — this is what mechanically
 * enforces strategy before content." That element is the product's central
 * artifact and had no screen at all: the strategy existed in the database and
 * the user could never read it.
 */

interface Element {
  id: string;
  phase: number;
  order: number;
  title: string;
  rationale: string;
  businessGoal: string;
  audienceSegment: string;
  targetTopics: string[];
}

interface Roadmap {
  id: string;
  version: number;
  summary: string;
  degraded?: boolean;
  elements: Element[];
}

const PHASE_NAMES: Record<number, string> = {
  1: "Now",
  2: "Next",
  3: "Then",
  4: "Later",
};

export default async function StrategyPage() {
  await requireSession();
  const roadmap = await apiGet<Roadmap>("/roadmap");

  if (!roadmap) {
    return (
      <main className="page">
        <header className="head">
          <div className="head-text">
            <h1>Strategy</h1>
          </div>
        </header>
        <div className="empty">
          <h3>No strategy yet</h3>
          <p>Finish setup and Guru will build one from your brief.</p>
          <a className="button" href="/setup">
            Go to setup
          </a>
        </div>
      </main>
    );
  }

  const phases = [...new Set(roadmap.elements.map((e) => e.phase))].sort();

  return (
    <main className="page wide">
      <header className="head">
        <div className="head-text">
          <h1>Strategy</h1>
          <p className="lede">
            Every draft comes from one of these. Pick one to write from.
          </p>
        </div>
        <span className="pill">v{roadmap.version}</span>
      </header>

      {roadmap.degraded ? (
        <div className="callout">
          <strong>Built without market data.</strong>
          <p>No search provider is configured, so this comes from your brief alone.</p>
        </div>
      ) : null}

      {phases.map((phase) => (
        <section key={phase}>
          <h2>
            {PHASE_NAMES[phase] ?? `Phase ${phase}`}
          </h2>

          {roadmap.elements
            .filter((e) => e.phase === phase)
            .sort((a, b) => a.order - b.order)
            .map((el) => (
              <article className="draft" key={el.id}>
                <h3>{el.title}</h3>
                <p className="element-why">{el.rationale}</p>

                <dl className="facts inline">
                  <div>
                    <dt>Goal</dt>
                    <dd>{el.businessGoal}</dd>
                  </div>
                  <div>
                    <dt>Audience</dt>
                    <dd>{el.audienceSegment}</dd>
                  </div>
                </dl>

                {el.targetTopics.length > 0 ? (
                  <div className="chips">
                    {el.targetTopics.map((t) => (
                      <span className="pill" key={t}>
                        {t}
                      </span>
                    ))}
                  </div>
                ) : null}

                <div className="actions">
                  <DraftFromElement elementId={el.id} />
                </div>
              </article>
            ))}
        </section>
      ))}
    </main>
  );
}
