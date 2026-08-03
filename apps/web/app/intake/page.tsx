import { IntakeClient } from "./IntakeClient";
import { requireSession } from "../../lib/session";

export default async function IntakePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, never>>;
}) {
  await searchParams;
  await requireSession();

  return (
    <main className="page wide">
      <header className="head">
        <div className="head-text">
          <h1>Intake</h1>
          <p className="lede">
            Five areas. Two are pre-filled from your archive. Stop and come back any time.
          </p>
        </div>
      </header>
      <IntakeClient />
    </main>
  );
}
