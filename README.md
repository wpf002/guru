# Guru

**AI go-to-market strategist for LinkedIn.**

Guru learns a user's niche, network, and writing voice, builds a strategy from
them, and then proposes the content and engagement that executes it. Nothing is
published without approval.

Full plan: [docs/ROADMAP.md](docs/ROADMAP.md). Source spec:
[docs/spec/linkedin-gtm-engine-mvp.pdf](docs/spec/linkedin-gtm-engine-mvp.pdf).

**Picking this up cold?** [docs/STATE.md](docs/STATE.md) — what runs, what has never
run, and what's open.

**Does the code match the spec?** [docs/TRACEABILITY.md](docs/TRACEABILITY.md) maps every
roadmap section to its code and its test, and records the three places the
roadmap and reality diverge.

---

## Status

Every phase in the roadmap is implemented, the schema is migrated onto a real
Postgres, and every phase's service layer is exercised against it. LinkedIn OAuth
and the model layer have both been exercised against the real services; Google
and the intel provider have not, and nothing has been published yet. See
[What is verified, and what is not](#what-is-verified-and-what-is-not).

| Roadmap | Component | State |
|---|---|---|
| §0.8 | Monorepo, workspaces, Turbo | ✅ |
| §0.7 | Multi-tenant schema, `userId` everywhere | ✅ |
| §0.8 | Token envelope encryption + rotation | ✅ tested |
| §0.8 | Model layer with per-call `Generation` audit | ✅ tested |
| §0.8 | Versioned, immutable prompt registry | ✅ tested |
| §1.0 | LinkedIn OAuth, trust checkpoint, disconnect | ✅ built |
| §1.1 | Archive parsing, normalization, ZIP unpacking | ✅ tested |
| §1.1 | Gmail watch, link extraction, ingest pipeline | ✅ built |
| §1.2 | Intake state machine, resumable, archive-seeded | ✅ built |
| §1.3 | Versioned strategic brief, hard constraint filters | ✅ tested |
| §1.4 | Network analysis, audience-fit ratio | ✅ tested |
| §1.4 | Persona-fit scoring, trend + peer analysis, roadmap | ✅ built |
| §1.5 | Content drafts, refinement loop, publish, schedule | ✅ built |
| §1.5 | Similarity gate against peer material | ✅ tested |
| §1.6 | Engagement targets, priority scoring, comments, reactions | ✅ tested / built |
| §1.7 | Per-category confidence, event log, dashboard | ✅ tested |
| §1.8 | Voice model, cold start + edit-diff refinement | ✅ tested |
| §1.9 | Drive/upload document ingestion, per-doc confirm | ✅ built |
| §1.10 | Confidence-threshold prompt (stub, gates nothing) | ✅ built |
| §2.1–2.2 | Autonomy guardrails, caps, allowlist, kill switch | ✅ tested |
| §2.3–2.4 | Persona-matched prospecting, assisted outreach | ✅ built |
| §2.5 | Separate, higher outreach threshold | ✅ tested |
| §5 | Customer/operator classification (Phase 1 hedge) | ✅ built |
| §9 | Metrics: weekly report, archive-derived, edits/draft | ✅ built |

**232 unit tests** and **123 integration tests against a live Postgres**, all
passing. `apps/web` and `apps/api` both build; the API boots against the real
database and serves every route.

The integration tests run each phase's service layer against actual Postgres
with the model scripted — that is the split that matters, because it catches
what a mocked Prisma cannot: enum values that don't exist, unique constraints
that don't hold, cascade deletes that don't cascade. They found a real bug on
first run: the document service claimed transcripts were never persisted, but
the model layer audits every prompt, so the §0.7 contract was being broken in
the `Generation` row. Fixed with an explicit `redactPrompt` opt-out.

---

## Architecture

```
apps/web              Next.js — intake, dashboard, content + engagement review
apps/api              Fastify — OAuth, ingestion, orchestration, publishing
packages/core         crypto, confidence, constraints, network, voice, similarity, autonomy
packages/llm          Anthropic client + generation audit + output schemas
packages/linkedin     OAuth, token refresh, publish, comment, react
packages/archive      email detection, ZIP unpacking, parsing, snapshot diffs
packages/intel        peer/trend search layer, engagement target scoring
packages/prompts      versioned prompt templates
packages/db           Prisma schema + client
```

Pure logic lives in packages and is unit-tested; I/O lives in apps. Four
invariants hold throughout:

**Every table carries `userId`, and every route resolves it from the session.**
`requireUser` is the only sanctioned source of a user id, and `ownedBy` guards
every route that addresses a row by its own id — a draft id is not a capability.
Not-yours and does-not-exist both answer 404, so no endpoint can be used to
discover which ids exist.

**Every generated artifact points at a `Generation` row** recording resolved
inputs, prompt name, prompt version, and model. Prompt versions are immutable —
you add a version, you never edit one — so "why did it suggest this" is
answerable a year later.

**`ContentDraft.roadmapElementId` is non-nullable.** There is no route that
generates a post from a free-text topic. That foreign key is what makes
"strategy before content" a constraint rather than a principle.

**Brief constraints are enforced in code, after generation.** A never-say list in
a prompt is a suggestion; `packages/core/src/constraints.ts` is a filter.

---

## What Guru will not do

Design decisions, not gaps to close later.

- **No cold connection requests or DMs.** No sanctioned API path exists (§0.4).
  Everything that claims otherwise is session-cookie automation that risks the
  user's account — the asset this product exists to grow. There is no send
  function in `prospecting.ts` and there should never be one. The objective is
  met through engagement-led growth (§1.6) and assisted send (§2.4).
- **Outreach never becomes autonomous.** It has its own confidence score and a
  permanently higher threshold, and `evaluateAutonomy` refuses it at any score.
- **No autonomous posting or commenting in Phase 1**, at any confidence level.
- **Tier 3 public scraping is off by default**, behind
  `INTEL_TIER3_SCRAPING_ENABLED`. A business decision, not a technical one.
- **DM history is opt-in per record.** `MessageRecord.usableForAnalysis` defaults
  to false and the parser never sets it.
- **No raw meeting transcripts are stored.** Summaries and user-tagged excerpts
  only, confirmed per document, with real deletion.

### One correction to the roadmap

§1.1 targets "archive email → parsed network profile with zero user steps".
LinkedIn does not attach the archive to that email — it sends a link, and the
link is usually served behind the member's own session. So the pipeline attempts
the fetch and, when it can't get a ZIP, surfaces the extracted link as a
one-click download feeding the upload path. Two clicks in the bad case, zero in
the good one, and never a spinner that never resolves.

---

## What is verified, and what is not

**Verified.** The migration applies cleanly to Postgres 16 (33 tables). Every
phase's service layer runs against that database: archive ingestion and snapshot
diffing, the intake state machine's completion rules, brief versioning, persona
scoring and re-scoring, roadmap generation, all three content gates, engagement
drafting, confidence scoring and the event log, the voice model, document
ingestion's privacy contract, autonomy guardrails including the kill switch,
prospecting, and classification. The API boots against the real database and
serves every route. Plus the pure logic — crypto, network analysis, parsing,
similarity, scoring — under unit test.

**Not verified.** The third-party edge:

- **OAuth is exercised; publishing is not.** A real account is connected with
  `openid profile email w_member_social`, and the token is envelope-encrypted at
  rest. The publish/comment/react client is written to the documented contract
  but has never been called, so nothing has been posted. LinkedIn issued no
  refresh token — self-serve apps don't get one — so the connection expires
  after 60 days and `needsReauth` is the only thing that surfaces it.
- **No Gmail or Drive call has been made.** The archive-link patterns are
  matched against realistic samples, not against a real LinkedIn email.
- **Model calls are exercised, but not by the tests.** A real intake and brief
  were generated against the live API. Every *test* still scripts the transport,
  so prompt quality is not covered by anything automated — output *shape* is
  enforced by schema, output *quality* is judged by reading it.

Google and the intel provider still need a credential nobody has issued. The
LinkedIn side is live: Company Page → Developer Portal app → both self-serve
products → a completed OAuth round trip. Current state is tracked in
[docs/STATE.md](docs/STATE.md).

---

## Setup

Requires Node 20+, pnpm 9, and Docker (or your own Postgres).

```bash
pnpm install
```

Start the database — a dedicated container on port 5439, so it won't collide
with anything else you have running:

```bash
pnpm db:up
```

```bash
cp .env.example .env
```

Generate the token encryption key and put it in `.env` as
`TOKEN_ENCRYPTION_KEY`:

```bash
openssl rand -base64 32
```

Apply the schema:

```bash
pnpm db:generate && pnpm db:migrate
```

Run everything:

```bash
pnpm dev
```

Unit tests (no database needed):

```bash
pnpm test
```

Integration tests (needs the database up):

```bash
pnpm test:integration
```

Google, the intel provider, and the Anthropic key are all optional at boot —
a deployment without them starts and degrades visibly rather than failing.
LinkedIn credentials and the encryption key are required.

### Accounts

Open http://localhost:3000 and create one. Email and password — scrypt hashed,
opaque session tokens in an httpOnly cookie, and every route resolves the user
from that session rather than from the URL.

Signing up with the email of an existing passwordless user *adopts* that row
rather than creating a second one, which is how an install that predates
sign-up keeps its archive, brief and drafts.

### LinkedIn is optional

**You do not need LinkedIn to use Guru.** The archive is a ZIP upload, and
intake, brief, roadmap, drafting and refinement are all local. Only publishing
touches the API — until you wire it up, copy the draft and post it yourself.
The server boots without `LINKEDIN_*` set; the publish button returns a clear
503 explaining why.

### LinkedIn credentials, when you want publishing

Full walkthrough: **[docs/LINKEDIN-SETUP.md](docs/LINKEDIN-SETUP.md)**.

The short version: create a Company Page, create a Developer Portal app against
it, add *Sign In with LinkedIn (OIDC)* and *Share on LinkedIn* — both self-serve
— then fill in `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET`, and
`LINKEDIN_REDIRECT_URI` and run:

```bash
pnpm linkedin:doctor
```

It validates the credentials against LinkedIn, checks the redirect URI shape,
reports which capabilities the granted scopes will actually allow, and prints a
consent URL to test the flow.

**Publishing is self-serve; commenting and reacting are not.** The engagement
engine (§1.6) needs `w_member_social_feed`, which comes from the vetted
Community Management API. Guru ships with that scope un-requested — LinkedIn
rejects an authorization request naming an unapproved scope outright — so
§1.0–§1.5 work immediately and §1.6 turns on with one flag once approved.

---

## Security notes

- Access and refresh tokens are envelope-encrypted
  (`packages/core/src/crypto.ts`). Each token gets its own data key; the data key
  is wrapped with the master key. Rotating the master key rewraps data keys
  rather than touching payloads, so rotation never forces a re-auth.
- The Fastify logger redacts authorization headers, cookies, and every token and
  repo-token field by name.
- Disconnect deletes the account row. Ciphertext left behind is not a disconnect.
- Archive downloads are host-checked before *and* after redirects, size-capped,
  and verified to be a real ZIP — an HTML login page served as 200 would
  otherwise parse as an empty archive and look like a user with no connections.
- Archive files are user PII and are gitignored by name as well as by directory.
