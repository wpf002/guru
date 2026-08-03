import Link from "next/link";
import { reachable, setupProgress } from "../../lib/progress";
import { requireSession } from "../../lib/session";

/**
 * Setup is one gated sequence.
 *
 * The steps used to be separate sidebar links with nothing saying which came
 * first, and jumping to the brief before intake existed produced a dead screen.
 * A step you have not earned yet is not a link.
 */
export default async function SetupLayout({ children }: { children: React.ReactNode }) {
  await requireSession();
  const { steps } = await setupProgress();

  return (
    <main className="page setup">
      <ol className="stepper">
        {steps.map((step, i) => {
          const open = reachable(steps, step.id);
          const cls = ["stepper-item", step.done ? "done" : "", open ? "" : "locked"]
            .filter(Boolean)
            .join(" ");

          const inner = (
            <>
              <span className="stepper-dot">{step.done ? "✓" : i + 1}</span>
              <span className="stepper-label">
                {step.label}
                {step.optional ? <em>optional</em> : null}
              </span>
            </>
          );

          return (
            <li key={step.id} className={cls}>
              {open ? <Link href={step.href}>{inner}</Link> : <span>{inner}</span>}
            </li>
          );
        })}
      </ol>

      <div className="setup-body">{children}</div>
    </main>
  );
}
