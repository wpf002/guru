# Guru

**AI go-to-market strategist for LinkedIn.**

Guru learns a user's niche, network, and writing voice, builds a strategy from
them, and then proposes the content and engagement that executes it. Nothing is
published without approval.

Full plan: [docs/ROADMAP.md](docs/ROADMAP.md). Source spec:
[docs/spec/linkedin-gtm-engine-mvp.pdf](docs/spec/linkedin-gtm-engine-mvp.pdf).

---

## Status

Every phase in the roadmap is implemented. What is *not* done is verification
against live credentials — no LinkedIn app, Google project, intel key, or
Postgres instance has been connected yet, so nothing here has made a real API
call. See [What is unverified](#what-is-unverified).

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

**156 tests**, all passing. `apps/web` and `apps/api` both build; the API boots
and serves every route.

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

**Every table carries `userId`.** Multi-tenant schema, single-tenant UX. Tenancy
is not something you retrofit.

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

## What is unverified

Nothing here has run against a live service. Specifically:

- **No LinkedIn API call has been made.** The OAuth flow, the publish/comment/
  react client, and the API version pin (`202506`) are written to the documented
  contract but not exercised.
- **No Gmail or Drive call has been made.** The archive-link patterns are
  matched against realistic samples in tests, not against a real LinkedIn email.
- **No model call has been made.** The model layer is tested against a fake
  client; prompts have not been run.
- **No migration has been applied.** `packages/db/prisma/migrations` is generated
  from the schema via `migrate diff`, not from a live database.

The unit-tested logic — crypto, confidence, constraints, network analysis,
parsing, similarity, autonomy guardrails, scoring — is the part that is actually
verified.

---

## Setup

Requires Node 20+, pnpm 9, and Postgres.

```bash
pnpm install
```

```bash
cp .env.example .env
```

Generate the token encryption key:

```bash
openssl rand -base64 32
```

Put it in `.env` as `TOKEN_ENCRYPTION_KEY`, fill in `DATABASE_URL`, then:

```bash
pnpm db:generate && pnpm db:migrate
```

Run everything:

```bash
pnpm dev
```

Tests:

```bash
pnpm test
```

Google, the intel provider, and the Anthropic key are all optional at boot —
a deployment without them starts and degrades visibly rather than failing.
LinkedIn credentials and the encryption key are required.

### LinkedIn credentials

Guru needs a Developer Portal app tied to a LinkedIn **Company Page** — create
the page first, it gates everything else (§0.6). Request the *Sign In with
LinkedIn using OpenID Connect* and *Share on LinkedIn* products, then set
`LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET`, and `LINKEDIN_REDIRECT_URI`.

Scopes are `openid profile email w_member_social` — the minimum set. LinkedIn
shows all scopes on one consent screen and the member accepts all or none, so
adding one later means every existing user re-consents.

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
