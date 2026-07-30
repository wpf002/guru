# Guru

**AI go-to-market strategist for LinkedIn.**

Guru learns a user's niche, network, and writing voice, builds a strategy from
them, and then proposes the content and engagement that executes it. Nothing is
published without approval.

Full plan: [docs/ROADMAP.md](docs/ROADMAP.md). Source spec:
[docs/spec/linkedin-gtm-engine-mvp.pdf](docs/spec/linkedin-gtm-engine-mvp.pdf).

---

## Status

**Phase 0 — foundations.** The monorepo, the data model, and the security and
scoring primitives are in place. Phase 1a (§1.0–1.3) is next.

| Roadmap | Component | State |
|---|---|---|
| §0.8 | Monorepo, workspaces, Turbo | ✅ |
| §0.7 | Multi-tenant schema, `userId` everywhere | ✅ |
| §0.8 | Token envelope encryption + rotation | ✅ tested |
| §1.7 | Per-category confidence engine | ✅ tested |
| §1.3 | Brief constraints as hard filters | ✅ tested |
| §1.4 | Network analysis, audience-fit ratio | ✅ tested |
| §1.1 | Archive parsers + normalization | ✅ tested |
| §1.1 | Archive email detection | ✅ tested |
| §1.6 | Engagement priority scoring | ✅ tested |
| §1.8 | Voice statistics | ✅ tested |
| §0.8 | Versioned prompt registry | ✅ tested |
| §1.0 | LinkedIn OAuth + trust checkpoint | ✅ wired, needs live credentials |
| §1.5 | Publish / comment / react client | ✅ written, unverified against live API |
| §1.1 | Gmail fetch + unzip pipeline | ⬜ |
| §1.2 | Intake state machine | ⬜ |
| §1.4 | Roadmap generation | ⬜ |

---

## Architecture

```
apps/web              Next.js — intake, dashboard, content + engagement review
apps/api              Fastify — OAuth, publishing, orchestration
packages/core         Confidence, constraints, network analysis, voice, crypto
packages/linkedin     OAuth, token refresh, publish, comment, react
packages/archive      Archive detection, parsing, normalization, snapshot diffs
packages/intel        Peer/trend search layer, engagement target scoring
packages/prompts      Versioned prompt templates
packages/db           Prisma schema + client
```

Two invariants hold throughout:

**Every table carries `userId`.** Multi-tenant schema, single-tenant UX. Tenancy
is not something you retrofit.

**Every generated artifact points at a `Generation` row** recording the inputs,
prompt name, prompt version, and model. Prompt versions are immutable — you add a
version, you never edit one — so "why did it suggest this" is answerable a year
later.

---

## What Guru will not do

These are design decisions, not gaps to close later.

- **No cold connection requests or DMs.** No sanctioned API path exists (§0.4).
  Everything that claims otherwise is session-cookie automation that risks the
  user's account — the asset this product exists to grow. The objective behind
  cold outreach is met instead through engagement-led growth (§1.6) and assisted
  send (§2.4).
- **No autonomous posting or commenting in Phase 1**, at any confidence level.
- **Tier 3 public scraping is off by default.** It sits behind
  `INTEL_TIER3_SCRAPING_ENABLED` and is a business decision, not a technical one.
- **DM history is opt-in per record.** `MessageRecord.usableForAnalysis`
  defaults to false. Those are other people's words.

---

## Setup

Requires Node 20+, pnpm 9, and a Postgres database.

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

- Access and refresh tokens are envelope-encrypted (`packages/core/src/crypto.ts`).
  Each token gets its own data key; the data key is wrapped with the master key.
  Rotating the master key rewraps data keys rather than touching payloads, so
  rotation never forces a re-auth.
- The Fastify logger redacts authorization headers, cookies, and every token
  field by name.
- Disconnect deletes the account row. Ciphertext left behind is not a disconnect.
- Archive files are user PII and are gitignored by name as well as by directory.
