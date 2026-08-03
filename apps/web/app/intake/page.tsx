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
      <h1>Consulting intake</h1>
      <p className="lede">
        Five areas, one at a time. Guru already knows your network and how you write, so
        two of them start mostly answered. You can stop and come back — nothing is lost.
      </p>
      <IntakeClient />
    </main>
  );
}
