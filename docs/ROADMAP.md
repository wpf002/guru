# Guru — Roadmap

**AI go-to-market strategist for LinkedIn.**

Source spec: [`spec/linkedin-gtm-engine-mvp.pdf`](spec/linkedin-gtm-engine-mvp.pdf). Every element of that spec is carried forward — see §10 Traceability.

> **Amendment — §0.1 is wrong about scopes.** Verified against LinkedIn's
> per-endpoint permission tables in July 2026: `w_member_social` covers
> publishing only. Commenting and reacting require `w_member_social_feed`, which
> comes from the **Community Management API — a vetted product**, not a
> self-serve one. §1.6 therefore cannot ship in Phase 1 without an approval
> process, and the minimum shippable cut (§11) is §1.0–§1.5.
>
> The strategic argument for engagement-led growth is unaffected, and the code is
> built and tested behind a flag. Details, sources, and the application steps:
> [LINKEDIN-SETUP.md](LINKEDIN-SETUP.md#amendment-to-01).

---

## 0. Integration Verdict — Resolved

The previous pass had four blockers. Three are now solved outright; the fourth is routed around.

| Capability | Path | Verdict |
|---|---|---|
| Account connection | Sign In with LinkedIn / OIDC | ✅ Self-serve |
| Publish to member feed | `w_member_social` | ✅ Self-serve |
| **Comment + react on any post as the member** | `w_member_social` | ✅ **Self-serve — the unlock** |
| Connection list | Data archive, auto-ingested via Gmail | ✅ Solved |
| Full posting history | `Shares.csv` + `Articles/` in archive | ✅ Solved |
| Comment history | `comments.csv` in archive | ✅ Solved |
| DM history | `messages.csv` in archive | ✅ Solved |
| Invitation history | `Invitations` in archive | ✅ Solved |
| Peer/competitor content | Search-index layer (+ optional no-login vendor) | ✅ Solved |
| Own-post engagement read-back | `r_member_social` — closed permission | ⚠️ Partial — see §0.3 |
| Cold connection requests / DMs | No compliant path | ⛔ Routed around — see §0.4 |

### 0.1 The unlock nobody reads the docs carefully enough to find

`w_member_social` is documented as: *post, comment, and react on posts on behalf of an authenticated member.*

Not just post. **Comment and react — on any post, as the user.** Self-serve, no partner approval.

That changes the product. The highest-ROI activity in LinkedIn social selling isn't broadcasting — it's showing up intelligently in the comments of the people your buyers already follow. Guru can do that natively and compliantly. Cold outreach was never the only growth lever; it was just the obvious one.

This becomes a first-class Phase 1 subsystem (§1.6), not a Phase 2 aspiration.

### 0.2 The archive is far richer than an API would ever be

The full data archive is not just a connections list. It contains:

| File | Contains | What Guru does with it |
|---|---|---|
| `Connections.csv` | Every 1st-degree connection — name, company, position, connect date | Network graph, audience-fit, growth velocity |
| `Shares.csv` | Every shortform post ever published | Content baseline, what's already been said |
| `Articles/` | Every longform article | Depth topics, indexed authority assets |
| `comments.csv` | Every comment ever left | **Voice corpus — how they actually write** |
| `messages.csv` | Full DM history | Real client language, objections, deal patterns |
| `Invitations` | Invitation history | Outreach acceptance-rate baseline |
| `Profile`, search history, inferred attributes | — | Positioning gaps, self-perception vs. LinkedIn's inference |

No API tier — including full partner status — returns this. The export isn't the fallback. It's the better source.

**Two operational facts:** connections live only in the *larger* archive, not the quick-select files. And LinkedIn delivers it in **two email installments** — the first, subject line *"The first installment of your LinkedIn data archive is ready!"*, contains `Connections.csv` and typically lands within minutes. The second follows later with the rest.

Which makes the ingestion automatic — see §1.1.

### 0.3 Engagement read-back — partial, and honest about it

`r_member_social` (retrieve posts, comments, and likes on behalf of a member) is a **closed permission — LinkedIn is not accepting access requests**. Don't budget time for an application; there's no queue to join.

Workarounds, in order of preference:

1. **Guru knows what it published.** Every post it creates is tracked forward from creation with full metadata.
2. **Periodic re-archive** captures the historical record.
3. **Lightweight user-reported capture** — a 20-second weekly prompt for the three numbers that matter.
4. **Public post scraping** as an optional tier (§0.5) — engagement counts on public posts, including the user's own.

Not a blocker. The success metrics in §9 are designed to work without it.

### 0.4 Cold outreach — the one genuine wall, and the way around it

Connection requests and DMs have no sanctioned API path. Sales Navigator's API stopped accepting new partners. Recruiter is closed. `r_member_social` is closed. There is no door here, and anyone telling you otherwise is selling session-cookie automation that risks the user's account.

**But the objective behind cold outreach is network growth in the target persona. That objective is fully achievable compliantly:**

- **Engagement-led growth (§1.6)** — Guru comments intelligently on target-persona posts via `w_member_social`. Profile views follow, and inbound connection requests follow those. Inbound converts better than cold outreach anyway.
- **Assisted send (§7)** — Guru builds the target list, drafts the message, deep-links to the profile with the draft on the clipboard. Human taps send. Near-automated throughput, zero account risk.

That covers the goal. What it doesn't cover is unattended bulk cold outreach — which was always the highest-risk, lowest-return part of the spec.

### 0.5 Peer intelligence — three tiers

The spec needs peer/competitor content patterns. No search API exists. Three real paths, layered:

**Tier 1 — Search-index layer (default, fully compliant).** Public LinkedIn posts are indexed by search engines. A programmatic search API (Exa, Brave, SerpAPI) with site-restricted queries returns peer post content without touching LinkedIn. You're querying a search index, not scraping a platform.

**Tier 2 — User-seeded corpus (compliant).** Peers named during intake. Guru tracks their public output across every channel — LinkedIn, newsletters, podcasts, X. Most operators publish the same thinking in several places.

**Tier 3 — No-login public scraping (optional, gray).** Vendor scrapers exist that extract public LinkedIn post content, comments, and reaction counts without cookies or an account, at roughly $1.20 per 1,000 records. Because no account authenticates, **the user's LinkedIn account is not exposed** — worst case is the vendor gets IP-blocked. This is a categorically different risk profile from session-based automation, where the user's own account is the thing on the line. It still runs against LinkedIn's User Agreement, so it's a business decision, not a technical one.

**Default: Tiers 1 and 2. Tier 3 behind a config flag, off unless you turn it on.**

---

## Phase 0 — Foundations & Access

*1 week, calendar-gated by LinkedIn, not by build time*

### 0.6 LinkedIn access track

1. Create/verify the LinkedIn Company Page — **start day one, it gates everything.**
2. Create the Developer Portal app against that page.
3. Request **Sign In with LinkedIn (OIDC)** and **Share on LinkedIn**.
4. Scopes: `openid profile email w_member_social`. Minimum set — all scopes appear on one consent screen and the member must accept all or none.

### 0.7 Locked decisions

| Question (spec §6) | Decision |
|---|---|
| Multi-tenant vs single-user | Multi-tenant schema, single-tenant UX. `userId` on every table from commit one. |
| Confidence score shape | Per-category from day one: topic, angle, tone, format, cadence, **engagement-target**. |
| Meeting-notes data contract | Summaries + user-tagged excerpts. No raw transcripts. Per-document confirm. |
| Voice modeling | Persistent style profile, cold-started from `comments.csv` + `Shares.csv`, refined by edit diffs. |
| Outreach compliance | Engagement-led growth compliant and in Phase 1. Cold send stays assisted. |
| "Resonates well" | Defined in §9. |

### 0.8 Stack

House standard: TypeScript, pnpm/Turborepo, Next.js, Fastify, Prisma/Postgres, Railway.

```
apps/web              Next.js — intake, dashboard, content + engagement review
apps/api              Fastify — OAuth, publishing, orchestration
packages/core         Brief, roadmap, confidence engine
packages/linkedin     OAuth, token refresh, publish, comment, react
packages/archive      Archive fetch + parse (all file types)
packages/intel        Peer/trend search layer
packages/prompts      Versioned prompt templates
packages/db           Prisma schema + client
```

**Auditable over impressive.** Every generated artifact persists with inputs, prompt version, and model. "Why did it suggest this" must be answerable a year later.

**Token security:** ~60-day expiry on authorization-code tokens. Envelope encryption at rest, key in Railway secrets, never logged, never client-side. Proactive rotation plus a re-auth path when refresh fails. Ships in 1.0, not later.

---

## Phase 1 — MVP: The Strategist & Engagement Engine

### 1.0 Secure LinkedIn Connection

*Spec §3.1 · Build order #1*

Three-legged OAuth. Trust-checkpoint screen in plain language before the consent redirect — what's accessed, why, shown in-product rather than buried in a policy. One-click disconnect that deletes tokens and halts processing.

**Exit:** connects, survives a simulated 60-day refresh boundary, disconnects clean.

### 1.1 Automated Archive Ingestion

*Spec §3.1 initial pull — upgraded*

The friction the manual-upload approach accepted, removed.

1. Guru walks the user through requesting the archive (Settings → Data privacy → Get a copy of your data → **larger archive**).
2. With Gmail scope granted, Guru watches for the LinkedIn archive emails, detects the first installment, downloads the ZIP, and ingests it. No manual download, no upload step.
3. Manual upload remains as fallback for users who decline Gmail access.
4. Second installment auto-detected and merged when it lands.
5. Scheduled re-archive prompts on a cadence; each snapshot diffs against the last for growth and churn metrics.

Parsers for every file in §0.2. `Connections.csv` is dirty in practice — emoji in names, inconsistent casing, blank positions, most emails withheld by privacy default. Normalization is a real task, not an afterthought.

**Exit:** archive email → parsed network profile with zero user steps after the initial request.

### 1.2 Structured Adaptive Consulting Intake

*Spec §3.2 · Build order #2*

Preset framework, adaptive within it. Each of the five spec areas is a **slot with completion criteria** — the model follows up freely until criteria are met, then advances. Framework constrains the state machine; AI controls the path.

1. **Who they are** — role, industry/niche, sub-niche, what they sell.
2. **Where they are today** — current activity, existing content, network size/composition, lead flow.
3. **Where they want to be** — goals, target outcomes, timeline.
4. **Who they're trying to reach** — ideal audience/persona.
5. **Voice and constraints** — tone, never-say list, competitive sensitivities, compliance.

Areas 2 and 5 arrive pre-populated from archive data. Guru opens already knowing the network, the posting history, and the writing style — so intake is a conversation between informed parties, not an interrogation. Resumable across sittings.

### 1.3 Strategic Brief

*Spec §3.2 output · Build order #3*

Structured, versioned, user-editable: niche, sub-niche, offer, current state, target state, persona, voice profile, hard constraints. Never-say list and compliance flags become **hard filters** on all generated output, not prompt suggestions. Re-running intake creates v2; nothing overwrites.

### 1.4 Deep-Dive Analysis → Roadmap

*Spec §3.3 · Build order #4*

**Network analysis.** Strategy branches on size, as the spec requires — sparse (~100s) needs network-building before content strategy; dense (~10,000s) is ready for segmentation and targeted content immediately. Plus **audience-fit ratio**: what share of the network matches the target persona. A 10,000-connection network of the wrong people is strategically sparse, and fit is the sharper signal the spec's size heuristic was proxying for.

Now also computed from the archive: invitation acceptance rate, historical posting cadence and gaps, and which past posts drew comments from target-persona accounts.

**Trend analysis.** Sub-niche specific via the §0.5 search layer.

**Peer analysis.** 5–15 peers named at intake. Formats, topics, cadence, hooks. Pattern-learning, not copying — outputs are abstracted patterns and generated drafts are similarity-checked against source material before reaching the user.

**Output: the roadmap.** Current-to-target gap as a phased content and positioning strategy. Every future draft traces to a roadmap element — this is what mechanically enforces *strategy before content*.

### 1.5 Content Engine + Conversational Refinement

*Spec §3.4 · Build order #5–6*

Ready-to-post drafts, not topic ideas. Each carries its "why" — roadmap element, audience segment, business goal. Multi-turn natural-language refinement ("change X," "not how I'd phrase it," "shorter") with full revision history. Publish via `w_member_social`. Scheduling queue. Every edit diff captured as voice-model training data.

### 1.6 Engagement Engine

*New — enabled by §0.1*

The commenting and reacting half of `w_member_social`. This is the network-growth engine the spec wanted from Phase 2, available now and compliant.

- **Target feed construction** — posts from peers, target-persona accounts, and industry voices, surfaced via the §0.5 intel layer.
- **Comment drafting** — substantive, on-brand comments that add a point rather than agreeing. Voice-model driven, same refinement loop as content.
- **Priority scoring** — which posts are worth engaging based on author fit, audience overlap, and freshness.
- **Approve → post** via `w_member_social`. Human-approved in Phase 1, exactly like content.
- **Reaction support** for lower-stakes presence.

Engagement approvals feed their own confidence category. This is also the cleanest place to eventually earn autonomy — a mediocre comment costs far less than a mediocre cold DM.

### 1.7 Approve/Reject + Confidence Score

*Spec §3.5 · Build order #7*

Per-category: topic, angle, tone, format, cadence, engagement-target. Rejections capture reasons where offered — strong training signal. Recency-weighted approval rate, minimum sample size before a category scores. **Visible to the user** as a dashboard; trust is earned transparently or not at all. Every score movement logged against its triggering decision.

### 1.8 Voice Model

*Spec §6 gap — promoted to Phase 1*

Cold-started from `comments.csv` and `Shares.csv` — real writing, hundreds or thousands of samples, available on day one instead of after months of edits. Refined continuously from edit diffs and rejection reasons. Injected into every generation. User-inspectable and editable.

**Measured:** edits-per-draft should decline over time. That number is the honest proof the system is learning.

### 1.9 Meeting Notes / Document Ingestion

*Spec §3.5 signal 3 · Build order #8*

Google Drive pull of Gemini meeting notes, plus direct upload. Summaries and user-tagged excerpts only — no raw transcripts. Per-document confirm; nothing auto-ingests. Extracts insights, recurring problems, and real client language. Full per-document deletion path. Cuttable if the timeline compresses.

### 1.10 Confidence-Threshold Prompt

*Spec §3.5 · Build order #9*

At sustained ~90–95% approval across categories, Guru surfaces: *"I'm ready to run more independently — want to enable that?"* In Phase 1 this is a **stub** that records intent and gates nothing. It validates the threshold mechanic against real data before autonomy attaches to it.

### Phase 1 Non-Goals

Per spec §3.6, unchanged:

- ❌ No autonomous outreach or connection requests.
- ❌ No autonomous posting or commenting without user approval — even at high confidence.
- ❌ No multi-platform support beyond LinkedIn.

---

## Phase 2 — Earned Autonomy & Network Growth

*Spec §4, reshaped around what's actually possible*

**2.1 Engagement autonomy.** Once the engagement confidence score holds above threshold across a meaningful sample, Guru comments and reacts independently within guardrails — daily volume caps, target-account allowlist, hard topic exclusions, and a kill switch. This is real earned autonomy on a real growth lever, fully sanctioned by the API.

**2.2 Content autonomy.** Posts publish on schedule without per-post approval, once content confidence sustains. Separate threshold from engagement.

**2.3 Persona-matched prospecting.** Guru identifies specific people and personas worth connecting with, derived from the roadmap. Fully buildable.

**2.4 Assisted outreach.** Target list, drafted personalized message, deep-link with draft ready. Human sends. Same refinement loop as content.

**2.5 Separate, higher confidence bar for outreach.** The spec raises this and answers it correctly — unsolicited outreach done wrong carries materially higher relationship risk than a mediocre post. Outreach keeps its own score and a higher threshold, permanently.

**Not built:** unattended cold connection requests and DMs. No compliant path exists, and the alternative risks the user's account — the very asset Guru exists to grow.

---

## Phase 3 — The Funnel/Fund Model

*Spec §5 · Direction, not spec*

Once a user has real authority and inbound interest, Guru helps identify a replicable business model around it — the commercial real estate pattern: recruit and fund others in the audience to replicate the model, creating compounding talent, deal flow, and content returning to the original user.

The engine would need to identify patterns distinguishing **customers** from **aspiring operators**, and surface that distinction as a strategic opportunity.

**Phase 1 hedge:** start classifying inbound engagement along the customer/operator axis now. Near-zero cost, and by the time Phase 3 is real you'll have a year of labeled data instead of a cold start.

---

## 9. Success Metrics — "Resonates Well," Defined

*Spec §6 gap, resolved*

| Tier | Metric | Source |
|---|---|---|
| Primary | Qualified inbound conversations | User-logged, weekly prompt |
| Primary | Profile views (trend) | User-reported |
| Primary | Inbound connection requests from target persona | Archive diff |
| Secondary | Comments received from target-persona accounts | Archive re-ingest |
| Secondary | Post engagement | Self-reported, or §0.5 Tier 3 if enabled |
| Internal | Approval rate per category | System |
| Internal | Edits per draft (should decline) | System |
| Internal | Audience-fit ratio of new connections | Archive diff |

Comments from target-persona accounts outweigh raw reaction counts. Eight reactions from real buyers beats two hundred from peers, and the trend engine must be trained toward the former or it optimizes for engagement theater.

---

## 10. Traceability — Spec → Guru

| Spec section | Lands in |
|---|---|
| §1 Vision — 4 inputs | 1.2, 1.1, 1.4, 1.9 |
| §2 Strategy before content | 1.4 → 1.5, enforced by roadmap-element traceability |
| §2 Network-aware | 1.1, 1.4 branching |
| §2 Human-in-loop, autonomous by earned trust | 1.7, 1.10, Phase 2 |
| §2 Collaborative not one-shot | 1.5, 1.6 refinement loops |
| §2 Reusable across niches | Niche/persona as data; zero hardcoded vertical logic |
| §2 Security first | 1.0, 0.7 data contracts |
| §3.1 Secure connection | 1.0, 1.1 |
| §3.2 Adaptive intake | 1.2 |
| §3.2 Strategic brief | 1.3 |
| §3.3 Deep-dive analysis | 1.4 |
| §3.4 Content engine | 1.5 |
| §3.5 Three signal sources | 1.4, 1.7, 1.9 |
| §3.5 Confidence mechanic | 1.7, 1.10 |
| §3.6 Non-goals | Carried verbatim |
| §4 Phase 2 | Phase 2 — engagement autonomy now buildable |
| §5 Phase 3 | Phase 3 + Phase 1 hedge |
| §6 All six open questions | 0.3, 0.7, §9, Phase 2 |
| §7 Build order, all nine | 1.0 → 1.10 |

**Deviations and why:**

1. Network/history data via auto-ingested archive rather than API — richer than any API tier returns, and now automatic.
2. Voice modeling promoted to Phase 1.8, cold-started from real comment and post history.
3. Engagement engine (1.6) added — `w_member_social` permits it, and it's the compliant answer to Phase 2's growth objective.
4. Peer discovery user-seeded plus search-index layer; no LinkedIn search API exists.
5. Cold DM/connect automation not built. Objective met through 1.6 and 2.4.

---

## 11. Sequencing

| Stage | Scope | Estimate |
|---|---|---|
| Phase 0 | Access, decisions, scaffold | 1 week (parallel) |
| Phase 1a | 1.0–1.3 — connect, auto-ingest, intake, brief | 2 weeks |
| Phase 1b | 1.4–1.5 — analysis, roadmap, content, refinement | 2 weeks |
| Phase 1c | 1.6 — engagement engine | 1 week |
| Phase 1d | 1.7–1.8 — confidence, voice model | 1.5 weeks |
| Phase 1e | 1.9–1.10 — notes ingestion, threshold stub | 1 week |
| **Phase 1 total** | **Shippable MVP** | **~7.5 weeks** |
| Phase 2 gate | Decision on data, not calendar | After 60 days of usage |

**Minimum shippable cut:** 1.0 → 1.6. Connect, ingest, intake, brief, roadmap, drafts, refinement, publish, engage. That's a complete product. Confidence scoring and voice modeling make it compound — but they need usage data to be worth anything anyway.
