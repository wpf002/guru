import { redirect } from "next/navigation";
import { reachable, setupProgress, type StepId } from "./progress";

/**
 * Refuses a step whose prerequisites are not met.
 *
 * Returns the progress so the page can render without fetching it twice.
 */
export async function requireStep(id: StepId) {
  const progress = await setupProgress();
  if (!reachable(progress.steps, id)) {
    redirect(progress.current?.href ?? "/setup");
  }
  return progress;
}
