import { redirect } from "next/navigation";
import { setupProgress } from "../../lib/progress";

/** Sends you to wherever you left off. */
export default async function SetupIndex() {
  const { current, complete } = await setupProgress();
  redirect(complete ? "/review" : (current?.href ?? "/setup/archive"));
}
