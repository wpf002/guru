# Where things stand

Handoff note. Everything below is committed and pushed.

## Running locally

```bash
pnpm db:up          # Postgres on :5439
pnpm go             # checks env, creates a local user, prints your URL
pnpm dev
```

`.env` has `DATABASE_URL`, `TOKEN_ENCRYPTION_KEY` and `ANTHROPIC_API_KEY` set.
LinkedIn and Google are not configured, and the app runs fine without them.

Tests: `pnpm test` (196, no database) and `pnpm test:integration` (92, needs the
database). Conformance suite asserts roadmap claims directly — see
[TRACEABILITY.md](TRACEABILITY.md).

## What works, verified against real data

Archive upload → intake → brief → roadmap → draft, all exercised against live
Postgres and the live model API. A real intake was run against Will's actual
LinkedIn profile: Log Analytics Engineer (CISSP), Las Vegas Sands, 116
connections, dormant since a job-change post four months ago. It produced a
brief with a real sub-niche (the coverage case for telemetry ingest decisions)
and a working never-say list.

Notably the intake adapted correctly to someone **not selling anything** — the
goal is career visibility, not clients. §2's "reusable across niches" holds
beyond the consultant shape it was written for.

## What has never run

Anything needing a credential nobody has issued:

- **LinkedIn** — no app exists yet. The Create-page form is filled and waiting in
  Chrome; it needs two clicks that are legally the user's (the authorised-
  representative checkbox and Create page). Then app → verify → two products →
  redirect URL → credentials → `pnpm linkedin:doctor`.
- **Gmail/Drive** (§1.1 watch, §1.9 Drive pull) — no Google project.
- **Intel provider** (§1.4 trend/peer analysis) — no search API key, so roadmaps
  are generated with `degraded: true` and say so.

## Open, in priority order

1. **Intake over-probes.** It took six questions to close section 1 and eleven
   overall. Every question was good, but that is too long. The fix is prompt
   tuning in `intake.followup` — let it accept a sufficient answer sooner.
2. **Intake UI loses the transcript on reload.** Session state resumes correctly;
   the conversation doesn't redraw. `IntakeClient` never fetches prior turns.
3. **Gmail archive link is unverified.** LinkedIn emails a link, not a file. If
   it's server-fetchable, onboarding is three clicks; if session-bound, four.
   Unknowable without a real archive email. This decides whether §1.1's "zero
   user steps" is achievable.
4. **§1.6 needs the Community Management API** — a vetted application, weeks of
   review. Code is built behind `LINKEDIN_FEED_SCOPES_APPROVED`.

## Bugs found by running it for real

Five features were fully implemented, type-checked and passing tests while doing
nothing. Recorded because the pattern matters more than the individual fixes:

1. The roadmap generator never saw the brief (`void brief`).
2. The second archive installment wiped the network picture.
3. Nothing ran on a timer — no scheduler existed.
4. Meeting notes reached no prompt.
5. The never-say filter matched descriptions instead of terms, so it blocked
   nothing.

Every one passed its tests because the tests asserted that a function behaved,
not that the roadmap's promise held. That's what the conformance suite is for.
