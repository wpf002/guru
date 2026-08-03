# Where things stand

Handoff note. Everything below is committed and pushed.

## Running locally

```bash
pnpm db:up          # Postgres on :5439
pnpm db:migrate
pnpm dev            # web on :3000, api on :3001
```

Then open http://localhost:3000 and create an account. There is no longer a
bootstrap route: sign-up is the only way to get a user row, and signing up with
the email of an existing passwordless user adopts that row rather than forking
it — which is how a pre-auth install keeps its archive and brief.

`.env` has `DATABASE_URL`, `TOKEN_ENCRYPTION_KEY`, `ANTHROPIC_API_KEY` and the
LinkedIn credentials set. Google and the intel provider are not configured, and
the app runs fine without them.

Tests: `pnpm test` (232, no database) and `pnpm test:integration` (128, needs the
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

**The app is company-verified** (2 Aug 2026), which is LinkedIn's gate before
accounts other than the developer's own can authorize it. Nothing in the
Developer Portal now blocks a second user from connecting.

Two consequences worth knowing:

- **No refresh token was issued.** LinkedIn grants those only to approved apps,
  so the 60-day access token is all there is. Re-auth is needed by
  **29 Sept 2026**; `needsReauth` on the status route is what surfaces it.
- **Publishing has still never been exercised.** The connection is proven; the
  three `w_member_social` actions are not. Nothing has been posted.

## What has never run

- **Publishing / commenting / reacting** — the client is written to the
  documented contract and now has a real token, but no call has been made.
- **Gmail/Drive** (§1.1 watch, §1.9 Drive pull) — no Google project.
- **Intel provider** (§1.4 trend/peer analysis) — no search API key, so roadmaps
  are generated with `degraded: true` and say so.

## A real archive is ingested (2 Aug 2026)

114 connections, 88 messages, 43 invitations, 1 share, 1 comment. Snapshot
`COMPLETE`, no false churn on the diff. The network reads as expected — top
titles are Detection Engineer, Senior Information Security Engineer, Threat
Hunter — and the last post is 9 Mar 2026, matching the dormancy the brief
assumed.

Two things this exposed, both of which only a real export could show:

- **No archive email is ever sent.** LinkedIn's settings page said the archive
  was ready; nothing arrived in Gmail, while other LinkedIn mail (including the
  API provisioning notices) landed fine. §1.1's "archive email → parsed profile
  with zero user steps" has no email to trigger on. The settings page is the
  only reliable signal. A Gmail watcher would have waited forever.
- **The settings page understates what the download contains.** It listed five
  categories (Articles, Invitations, Profile, Recommendations, Registration);
  the ZIP held 41 files including `Connections.csv`. Do not infer contents from
  that list.

## Brief v2, from the real archive (2 Aug 2026)

Intake re-run against the ingested archive and answered from Will's actual
profile and message history. **Five questions total** — one opening plus four
follow-ups — with areas 2 and 5 seeded from the archive, so it confirmed his
network and cadence instead of asking him to recite them. v1 is superseded.

The picture changed materially, because v1 was synthesized with "no archive has
been ingested yet":

- The goal is a **job search**, not general visibility. His own profile summary
  says he is "actively seeking a role that values detection quality and
  measurable security improvements". Target seat: Senior/Staff Detection
  Engineer, in-house, twelve-month horizon.
- Inbound already exists and is the wrong kind — 91 messages from 35 people
  since Nov 2025, ~40 mentioning a role, almost all cold agency recruiters
  during his Oct 2025–Mar 2026 gap. The goal is to replace that channel, not
  create one from zero.
- The persona is two-tier: people who can open a req (detection/SOC leadership,
  1,000+ employees, in-house SOC) and peer practitioners who refer and argue.

The never-say list grew from 18 to 27 literal terms and now covers every past
employer (Adobe, Deepwatch, Zyston, ReliaQuest, CenturyLink) and stack
(Splunk, Sumo Logic, CrowdStrike, Carbon Black, Sentinel, Elastic), verified
blocking real sentences.

**Known false positives, deliberately kept:** `Sands`, `Sentinel` and `Elastic`
also block "the sands of time", "a sentinel value in the parser" and "elastic
scaling" — all plausible in his domain. The failure is safe: a blocked draft is
regenerated, whereas a miss names his employer publicly while he is employed in
a regulated industry. `editBrief` (§1.3) is how to relax it if the regenerations
get annoying.

**Voice modelling has almost nothing to work with.** His entire published
history is one job-change announcement and one "Congratulations! 🎉". §1.8's
cold-start path is doing all the work; there is no real corpus to learn from.

## Multi-user access (2 Aug 2026)

Guru is multi-user. The schema always was; nothing authenticated anyone.

Before: `userId` arrived in a query string, a path parameter or an
`x-guru-user` header and every route believed it, and a missing header resolved
to `prisma.user.findFirst({ orderBy: { createdAt: "asc" } })` — the oldest row
in the database. Signing in as somebody else was a matter of typing their id,
and every anonymous request read whoever signed up first.

Now:

- **Email and password**, scrypt via `node:crypto` (`packages/core/src/password.ts`).
  No native addon, parameters stored in the hash so the cost can be raised
  without invalidating anyone. Length is the only rule — composition rules
  produce `Password1!`.
- **Opaque session tokens**, SHA-256 hashed at rest, in an httpOnly SameSite=Lax
  cookie. Logout deletes the row; a revoked session that still resolves is not
  revoked. `POST /auth/logout-all` revokes every session for that user.
- **`requireUser` is the only source of a userId.** It runs as a hook, so a
  route added later is anonymous until it opts in.
- **`ownedBy` guards every route that takes a bare resource id** — draft,
  target, prospect, document, brief, voice profile, intake session. A draft id
  is not a capability. Not-yours and does-not-exist both return 404, so the
  endpoints cannot be used to discover which ids are real.
- **`/bootstrap/*` is gone.** `/bootstrap/users` returned every user's email.
- **LinkedIn connects to the signed-in user**, with no email-upsert fallback.
- Login gives one answer for a wrong password and an unknown account, and hashes
  a dummy when the account is missing so the timing does not leak either.

Two ordering bugs fell out of writing the tests: `/archive/upload` parsed the
multipart body before checking auth, so an anonymous caller could stream 500MB
into the process before being rejected; and `/content/publish-due` swept every
account, so any signed-in user could push everyone's scheduled posts out early.

## Open, in priority order

1. **§1.6 needs the Community Management API** — a vetted application, weeks of
   review. Code is built behind `LINKEDIN_FEED_SCOPES_APPROVED`.
2. **Publishing has still never been called.** `pnpm linkedin:preflight` now
   verifies everything up to the write against the live API without creating
   anything — token decryption, liveness, scope, protocol headers, the pinned
   `LinkedIn-Version`, and that the payload carries every field LinkedIn says
   it requires (it enumerates them in its rejection, which turns the error into
   a schema check). All green as of 2 Aug 2026.

   What is still unproven is the *content* of those fields — that a real
   commentary string and visibility value are accepted. Only an actual post
   settles that. `deletePost` exists, so the cheapest real test is publish then
   immediately delete, which is still briefly visible to the network.

## Fixed: intake over-probing

`intake.followup@1.1.0`. v1.0.0 was written entirely around asking, and never
told the model to credit criteria the conversation had *already* satisfied — so
it credited only the one its own question targeted, and area 1's five required
criteria cost five turns however much a single answer covered.

Measured by replaying one set of realistic answers through both versions against
the live model:

| | v1.0.0 | v1.1.0 |
|---|---|---|
| Area 1 (who they are) | 8 questions | 0 |
| Total | 11 | 4 |

The 11 reproduces the original real intake exactly. v1.0.0 also turned
adversarial once stuck — "you've dodged this four times now" — while pressing
for an `offer` that does not exist for someone who is not selling anything.

Add ~1 for the opening question the UI fetches before the first answer.

## Fixed: intake transcript survives a reload

`IntakeClient` now fetches the stored turns after resuming and renders the whole
conversation, instead of showing the last question alone.

The worse half of the same bug: it decided whether to ask an opening question by
checking whether `question` was null, but `question` reports only the *last*
turn. Reload right after answering and it was null with turns already present, so
the client posted a null message and spent a model call generating a replacement
question for criteria that were still open. It now gates on the transcript being
empty. Verified in a browser against a seeded session: two page loads, zero
model calls, turns unchanged.

Driving it in a browser also turned up three things the integration suite could
not have caught:

- **The dev server was serving a 404 stylesheet.** It had been running since
  30 Jul across every change; `<link>` was in the HTML and the asset was gone,
  so every page rendered unstyled. Only a restart with `.next` cleared fixes it,
  and nothing in the tests looks at CSS.
- **`POST /intake/start` 400'd from the browser but passed in tests.** With
  `userId` gone it sends no body, while still declaring
  `Content-Type: application/json` — which Fastify rejects before the route
  runs. `app.inject` with no payload does not reproduce that. The server now
  parses an empty JSON body as `{}`, the clients no longer declare JSON when
  there is nothing to send, and a test sets the header explicitly.
- **Six routes called `requireUser` inside a `try`** whose catch turned
  everything into a 409 or a redirect, so an anonymous request to `/roadmap`
  answered "conflict" and echoed "Sign in to continue" as the reason. Four
  others answered 503 before checking auth, telling anonymous callers whether
  Google or LinkedIn is configured.

## Archive onboarding, rewritten (3 Aug 2026)

The archive page told users to navigate LinkedIn's menus by hand and then said
"LinkedIn sends it in two emails. The first arrives within minutes." That is
false — no email arrives at all — and it offered to connect Gmail to watch for
it. A new user following those instructions waits forever for a signal that
never comes.

It now links straight to
`https://www.linkedin.com/mypreferences/d/download-my-data`, names the one
option that includes connections, says plainly that no email is coming, and
tells them to come back. Upload moved off a cross-origin HTML form (which
navigated away and rendered raw JSON) onto a client component that stays put and
reports what was read — including "no connections in that file, you probably
picked the quick archive".

The home page also listed LinkedIn and the archive as steps 1 and 2, which read
as prerequisites. Neither is: intake, brief, roadmap and drafting all run with
no archive and no LinkedIn. Reordered so the hours-long wait starts first and
runs in the background.

Why this cannot be automated away: the Connections API needs
`r_1st_connections`, which no self-serve product grants, and Member Data
Portability is EEA-only. The export is the only route to network data outside
Europe, and LinkedIn does not automate it for anyone.

## Bugs found by running it for real

Nine features were fully implemented, type-checked and passing tests while
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

9. The ZIP unpacker matched `shares.csv` and `comments.csv` exactly, but real
   exports name them `Shares_1638994912.csv` and `Comments_1638994912.csv` —
   the member id is appended. Both fell into `unrecognizedFiles` while ingestion
   reported success, which would have emptied the voice model, posting cadence,
   the brief's archive summary and the §1.2 seeds. Found by ingesting a real
   export; every fixture in the tests had used the clean names.

Every one passed its tests because the tests asserted that a function behaved,
not that the roadmap's promise held. That's what the conformance suite is for.
