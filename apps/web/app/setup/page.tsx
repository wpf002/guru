import Link from "next/link";
import { redirect } from "next/navigation";
import { setupProgress } from "../../lib/progress";

/**
 * Unfinished, this drops you at the step you are on. Finished, it stays as the
 * way back in — re-upload a newer archive, re-read the brief, connect LinkedIn
 * later. Redirecting away once setup completed made all of that unreachable.
 */
export default async function SetupIndex() {
  const { current, complete, steps } = await setupProgress();

  if (current) redirect(current.href);

  return (
    <>
      <h1>Setup</h1>
      <p className="lede">Done. Come back here to change any of it.</p>

      <div className="checkpoint">
        <ul className="revisit">
          {steps.map((step) => (
            <li key={step.id}>
              <Link href={step.href}>{step.label}</Link>
              {step.done ? null : <span className="pill">not done</span>}
            </li>
          ))}
        </ul>
      </div>

      <div className="setup-nav">
        <Link className="button" href="/strategy">
          Back to the app
        </Link>
      </div>
    </>
  );
}
