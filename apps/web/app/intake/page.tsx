import { IntakeClient } from "./IntakeClient";

export default async function IntakePage({
  searchParams,
}: {
  searchParams: Promise<{ userId?: string }>;
}) {
  const { userId } = await searchParams;

  if (!userId) {
    return (
      <main className="page">
        <h1>Intake</h1>
        <p className="lede">Add a userId to the URL to start or resume an intake.</p>
      </main>
    );
  }

  return (
    <main className="page wide">
      <h1>Consulting intake</h1>
      <p className="lede">
        Five areas, one at a time. Guru already knows your network and how you write, so
        two of them start mostly answered. You can stop and come back — nothing is lost.
      </p>
      <IntakeClient userId={userId} />
    </main>
  );
}
