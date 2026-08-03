import { apiGet } from "./api";

/**
 * Where the user is in setup.
 *
 * Setup used to be four sidebar links the user was left to sequence themselves
 * — archive, intake, brief, LinkedIn — with nothing saying which came first or
 * whether they were done. It is one flow now, and this decides which step it
 * opens on, derived from what actually exists rather than from a flag we would
 * have to keep in sync.
 */

export type StepId = "archive" | "intake" | "brief" | "connect";

export interface Step {
  id: StepId;
  label: string;
  href: string;
  done: boolean;
  /** Setup can finish without it — LinkedIn is only needed to publish. */
  optional?: boolean;
}

export interface Progress {
  steps: Step[];
  /** The first unfinished step, or null when setup is complete. */
  current: Step | null;
  complete: boolean;
}

export async function setupProgress(): Promise<Progress> {
  const [archive, intake, brief, linkedin] = await Promise.all([
    apiGet<{ snapshots: { status: string }[] }>("/archive/status").catch(() => null),
    apiGet<{ complete: boolean }>("/intake/state").catch(() => null),
    apiGet<{ id: string }>("/brief").catch(() => null),
    apiGet<{ connected: boolean }>("/auth/linkedin/status").catch(() => null),
  ]);

  const hasArchive = (archive?.snapshots ?? []).some((s) => s.status !== "FAILED");

  const steps: Step[] = [
    { id: "archive", label: "Archive", href: "/setup/archive", done: hasArchive, optional: true },
    { id: "intake", label: "Intake", href: "/setup/intake", done: Boolean(intake?.complete) },
    { id: "brief", label: "Brief", href: "/setup/brief", done: Boolean(brief) },
    {
      id: "connect",
      label: "LinkedIn",
      href: "/setup/connect",
      done: Boolean(linkedin?.connected),
      optional: true,
    },
  ];

  // Required steps decide completion; the optional ones never block the flow.
  const current = steps.find((s) => !s.done && !s.optional) ?? null;

  return { steps, current, complete: current === null };
}
