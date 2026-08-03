import { IntakeClient } from "../_components/IntakeClient";
import { requireStep } from "../../../lib/gate";

export default async function SetupIntake() {
  await requireStep("intake");
  return (
    <>
      <h1>Tell Guru what you do</h1>
      <p className="lede">
        Five areas. Two are already filled in from your archive. Stop any time.
      </p>
      <IntakeClient />
    </>
  );
}
