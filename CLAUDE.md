# Guru — working notes

AI go-to-market strategist for LinkedIn. Plan of record: [docs/ROADMAP.md](docs/ROADMAP.md).
Source spec: [docs/spec/linkedin-gtm-engine-mvp.pdf](docs/spec/linkedin-gtm-engine-mvp.pdf).
Roadmap section references (§1.4, §0.5) appear throughout the code — they are the
canonical way to explain why something exists.

## Commands

```bash
pnpm install
pnpm dev            # all apps
pnpm test           # vitest across workspaces
pnpm typecheck
pnpm db:generate    # after any schema.prisma change
pnpm db:migrate
```

## Invariants

These are not style preferences. Breaking one is a design regression.

1. **`userId` on every table holding user data.** Multi-tenant schema, single-tenant
   UX (§0.7). Tenancy is not retrofittable.
2. **Every generated artifact points at a `Generation` row** recording resolved
   inputs, prompt name, prompt version, and model (§0.8). Inputs are stored
   *resolved*, not as foreign keys — the brief and voice profile that produced a
   draft are mutable, and a pointer to a since-edited row explains nothing.
3. **Prompt versions are immutable.** Add a version in
   `packages/prompts/src/registry.ts`; never edit a published one. Editing in
   place silently rewrites the history of every artifact claiming to use it.
4. **`ContentDraft.roadmapElementId` is required.** That foreign key is what
   mechanically enforces "strategy before content" (§1.4) — not prompt discipline.
   There is deliberately no route that generates a post from a free-text topic.
5. **Brief constraints are enforced in code, after generation.** See
   `packages/core/src/constraints.ts`. A never-say list in a prompt is a
   suggestion; this is a filter. Same for the similarity gate in
   `packages/core/src/similarity.ts` — "pattern-learning, not copying" is a claim
   the product makes to users, so it is enforced rather than asserted.
6. **Token plaintext never reaches a log, an error message, the database, or the
   client.** The Fastify logger redacts by field name; keep that list current.
7. **Autonomy decisions are pure.** `packages/core/src/autonomy.ts` has no I/O;
   `apps/api/src/services/autonomy.ts` only reads state, asks for a verdict, and
   logs it. Blocked actions are logged as loudly as published ones — "the
   guardrail held" has to be inspectable.

## Model layer

All generation goes through `packages/llm`. `claude-opus-5`, adaptive thinking,
`output_config.format` for structured output, prompt caching on the system
prefix.

The system prefix is cached, so it must stay byte-identical across calls —
anything with a timestamp or a per-request id belongs in `prompt`, after the
breakpoint. Structured output is validated client-side with Zod on top of the
constrained decode: schemas encode what an artifact needs to be *usable*
downstream (a persona with signals, an element with a rationale), which a
constrained decode does not guarantee.

Refusals, truncation, and transport failures all write an audit row before
throwing.

## Compliance boundaries

Written down because they will look like missing features to anyone who does not
know the API surface:

- **No cold connection requests or DMs.** No sanctioned path exists (§0.4). Do not
  add one — every available approach is session-cookie automation that risks the
  user's account. The objective is met via engagement-led growth (§1.6) and
  assisted send (§2.4).
- **`r_member_social` is closed.** Own-post engagement cannot be read back (§0.3).
  Posts are tracked forward from creation instead. Do not write code that assumes
  a read-back API will appear.
- **Tier 3 scraping stays behind `INTEL_TIER3_SCRAPING_ENABLED`,** default off.
- **`MessageRecord.usableForAnalysis` defaults to false.** DM content is other
  people's words; opt-in per record, never a bulk default.
- **Phase 1 publishes nothing without approval,** at any confidence score.

## Layout

```
apps/web              Next.js — intake, dashboard, content + engagement review, autonomy
apps/api              Fastify — OAuth, publishing, orchestration
packages/core         crypto, confidence, constraints, network, voice, similarity, autonomy, intake framework
packages/linkedin     OAuth + the three w_member_social actions
packages/archive      detection, parsing, normalization, snapshot diffs
packages/intel        peer/trend search, engagement target scoring
packages/prompts      versioned templates
packages/db           Prisma schema + client
```

Pure logic lives in packages and is unit-tested; I/O lives in apps. The archive
email *classifier* is in `packages/archive` while the Gmail *fetch* is in
`apps/api` for exactly this reason — the interesting failure is misclassifying an
email, not failing to fetch one.

## Testing

Vitest. Logic packages have real coverage; the tests encode the non-obvious
decisions (why an edit counts as half an approval, why a large ill-fitting network
scores as sparse, why freshness multiplies rather than adds). Read them before
changing those behaviours.

Nothing in the test suite hits a network or a database.
