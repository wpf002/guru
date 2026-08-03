import { IntakeClient } from "../../intake/IntakeClient";

export default function SetupIntake() {
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
