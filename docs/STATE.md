# Where things stand

Handoff note. Everything below is committed and pushed.

## Running locally

```bash
pnpm db:up          # Postgres on :5439
pnpm go             # checks env, creates a local user, prints your URL
pnpm dev
```

`.env` has `DATABASE_URL`, `TOKEN_ENCRYPTION_KEY`, `ANTHROPIC_API_KEY` and the
LinkedIn credentials set. Google and the intel provider are not configured, and
the app runs fine without them.

Tests: `pnpm test` (196, no database) and `pnpm test:integration` (101, needs the
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

**LinkedIn is connected for real** (30 Jul 2026). Company Page `Guru`
(`143052071`) → Developer Portal app `227463488` → both self-serve products →
OAuth completed end to end. Granted scopes: `openid profile email
w_member_social`. The token is envelope-encrypted at rest, verified by reading
the row directly.

Two consequences worth knowing:

- **No refresh token was issued.** LinkedIn grants those only to approved apps,
  so the 60-day access token is all there is. Re-auth is needed by
  **29 Sept 2026**; `needsReauth` on the status route is what surfaces it.
- **Publishing has still never been exercised.** The connection is proven; the
  three `w_member_social` actions are not. Nothing has been posted.

## What has never run

- **Publishing / commenting / reacting** — the client is written to the
  documented contract and now has a real token, but no call has been made.
- **Archive ingestion for this user** — `connections` and `shares` are both 0.
  The intake ran off profile data, not an archive. §1.1 is untested against a
  real LinkedIn export.
- **Gmail/Drive** (§1.1 watch, §1.9 Drive pull) — no Google project.
- **Intel provider** (§1.4 trend/peer analysis) — no search API key, so roadmaps
  are generated with `degraded: true` and say so.

## Open, in priority order

1. **Ingest a real archive.** Everything downstream currently reasons about a
   network of zero. This is the largest gap between what the product claims and
   what it has seen.
2. **Intake over-probes.** It took six questions to close section 1 and eleven
   overall. Every question was good, but that is too long. The fix is prompt
   tuning in `intake.followup` — let it accept a sufficient answer sooner.
3. **Intake UI loses the transcript on reload.** Session state resumes correctly;
   the conversation doesn't redraw. `IntakeClient` never fetches prior turns.
4. **§1.6 needs the Community Management API** — a vetted application, weeks of
   review. Code is built behind `LINKEDIN_FEED_SCOPES_APPROVED`.

## Bugs found by running it for real

Eight features were fully implemented, type-checked and passing tests while
doing nothing. Recorded because the pattern matters more than the individual
fixes:

1. The roadmap generator never saw the brief (`void brief`).
2. The second archive installment wiped the network picture.
3. Nothing ran on a timer — no scheduler existed.
4. Meeting notes reached no prompt.
5. The never-say filter matched descriptions instead of terms, so it blocked
   nothing.
6. The OAuth callback keyed the user row on the LinkedIn email, so connecting
   forked any user created with a different address — token on a new row, brief
   and intake stranded on the old one, `connected: true` either way. Now bound
   through the flow by userId; covered by
   `linkedin-auth.integration.test.ts`.
7. `pnpm linkedin:doctor` passed any secret at all. It matched
   `invalid_client_secret`, which LinkedIn does not emit — the real response is
   `invalid_client` / "Client authentication failed". Verified against the live
   endpoint by probing with a deliberately wrong secret.
8. `pnpm test` ran almost nothing. Turbo invoked `vitest run` inside each
   package, where the root config's repo-relative globs matched no files, so
   most packages reported "no test files" and the suite passed. The root script
   now runs vitest once from the root. The 196 figure was always real — it came
   from running vitest directly — but the documented command did not produce it.

Every one passed its tests because the tests asserted that a function behaved,
not that the roadmap's promise held. That's what the conformance suite is for.
