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

export type StepId = "connect" | "archive" | "intake" | "brief" | "roadmap";

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

/**
 * Ordered as the roadmap builds it: connection, archive, intake, brief, roadmap.
 * Optional steps still occupy their place in the sequence — they can be skipped,
 * not reordered.
 */
export async function setupProgress(): Promise<Progress> {
  const [linkedin, archive, intake, brief, roadmap] = await Promise.all([
    apiGet<{ connected: boolean }>("/auth/linkedin/status").catch(() => null),
    apiGet<{ snapshots: { status: string }[] }>("/archive/status").catch(() => null),
    apiGet<{ complete: boolean }>("/intake/state").catch(() => null),
    apiGet<{ id: string }>("/brief").catch(() => null),
    apiGet<{ id: string }>("/roadmap").catch(() => null),
  ]);

  const hasArchive = (archive?.snapshots ?? []).some((s) => s.status !== "FAILED");

  const steps: Step[] = [
    {
      id: "connect",
      label: "Connect",
      href: "/setup/connect",
      done: Boolean(linkedin?.connected),
      optional: true,
    },
    { id: "archive", label: "Archive", href: "/setup/archive", done: hasArchive, optional: true },
    { id: "intake", label: "Intake", href: "/setup/intake", done: Boolean(intake?.complete) },
    { id: "brief", label: "Brief", href: "/setup/brief", done: Boolean(brief) },
    { id: "roadmap", label: "Strategy", href: "/setup/roadmap", done: Boolean(roadmap) },
  ];

  // Optional means skippable, not skipped. Landing a brand-new user on step 3
  // because steps 1 and 2 were optional is not walking them through setup — it
  // is hiding two thirds of it. They get offered in order and moved past with a
  // button.
  const current = steps.find((s) => !s.done) ?? null;

  // Completion still only counts the required ones, so declining LinkedIn does
  // not leave someone stuck in setup forever.
  const complete = steps.every((s) => s.done || s.optional);

  return { steps, current, complete };
}

/**
 * Whether a step can be opened yet.
 *
 * Setup is a sequence, so jumping to the brief before intake exists produces a
 * dead screen that explains nothing. Everything up to and including the first
 * unfinished required step is reachable; nothing beyond it is.
 */
export function reachable(steps: Step[], id: StepId): boolean {
  const index = steps.findIndex((s) => s.id === id);
  if (index <= 0) return true;
  // Every required step before this one must be done.
  return steps.slice(0, index).every((s) => s.done || s.optional);
}
