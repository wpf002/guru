import { IntakeClient } from "../_components/IntakeClient";
import { requireStep } from "../../../lib/gate";

export default async function SetupIntake() {
  const { steps } = await requireStep("intake");
  const seeded = steps.find((s) => s.id === "archive")?.done ?? false;

  return (
    <>
      <h1>Tell Guru what you do</h1>
      <p className="lede">
        {seeded
          ? "Five areas. Two are already answered from your archive. Stop any time."
          : "Five areas. Stop any time — it picks up where you left off."}
      </p>
      <IntakeClient />
    </>
  );
}
