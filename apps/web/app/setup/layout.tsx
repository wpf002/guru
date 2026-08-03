import Link from "next/link";
import { setupProgress } from "../../lib/progress";
import { requireSession } from "../../lib/session";

/**
 * Setup is one flow, not four pages.
 *
 * Archive, intake, brief and LinkedIn used to be separate sidebar links with
 * nothing to say which came first or when you were finished. This wraps them in
 * a stepper: where you are, what is left, what is optional.
 */
export default async function SetupLayout({ children }: { children: React.ReactNode }) {
  await requireSession();
  const { steps } = await setupProgress();

  return (
    <main className="page setup">
      <ol className="stepper">
        {steps.map((step, i) => (
          <li key={step.id} className={step.done ? "stepper-item done" : "stepper-item"}>
            <Link href={step.href}>
              <span className="stepper-dot">{step.done ? "✓" : i + 1}</span>
              <span className="stepper-label">
                {step.label}
                {step.optional ? <em>optional</em> : null}
              </span>
            </Link>
          </li>
        ))}
      </ol>

      <div className="setup-body">{children}</div>
    </main>
  );
}
