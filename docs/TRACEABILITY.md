# Traceability — roadmap § → code → test

Every roadmap section, where it lives, and how it's verified.

Three verification levels, and the distinction matters:

- **Conformance** — a test in `roadmap-conformance.integration.test.ts` asserts
  the roadmap's *claim*, not an implementation detail. Four features in this
  codebase were fully implemented, type-checked and unit-tested while doing
  nothing at all, because every test asserted that a function behaved rather
  than that the promise held.
- **Tested** — unit or integration coverage of the behaviour.
- **Built, unverified** — code exists, no credential has ever exercised it.

Run it:

```bash
pnpm test && pnpm test:integration
```

---

## §0 — Integration verdict

| § | Claim | Where | Status |
|---|---|---|---|
| 0.1 | `w_member_social` covers comment + react | `packages/linkedin/src/scopes.ts` | ⚠️ **Roadmap is wrong.** Comments and reactions need `w_member_social_feed` (vetted). See [LINKEDIN-SETUP.md](LINKEDIN-SETUP.md#amendment-to-01). Conformance |
| 0.2 | Archive is richer than any API | `packages/archive/src/parsers.ts`, `zip.ts` | Tested |
| 0.3 | `r_member_social` closed; track posts forward | `ContentDraft.linkedinUrn` | Conformance |
| 0.4 | No cold connect/DM path — routed around | `prospecting.ts` (drafts, never sends) | Conformance |
| 0.5 | Three intel tiers; Tier 3 off by default | `packages/intel`, `INTEL_TIER3_SCRAPING_ENABLED` | Conformance |
| 0.6 | LinkedIn access track | [LINKEDIN-SETUP.md](LINKEDIN-SETUP.md) | Doc + `pnpm linkedin:doctor` |
| 0.7 | Multi-tenant schema, `userId` everywhere | `schema.prisma` | Conformance |
| 0.7 | Per-category confidence from day one | `packages/core/src/confidence.ts` | Tested |
| 0.7 | Meeting notes: summaries + excerpts, never transcripts | `services/documents.ts` | Conformance |
| 0.7 | DM content opt-in per record | `MessageRecord.usableForAnalysis` | Conformance |
| 0.8 | Every artifact records inputs, prompt version, model | `packages/llm/src/client.ts` | Conformance |
| 0.8 | Token envelope encryption + rotation | `packages/core/src/crypto.ts` | Tested |

## §1 — Phase 1

| § | Claim | Where | Status |
|---|---|---|---|
| 1.0 | Three-legged OAuth, trust checkpoint, clean disconnect | `routes/linkedin-auth.ts`, `app/connect` | Built, unverified |
| 1.0 | **Exit:** survives a 60-day refresh boundary | `packages/linkedin/src/__tests__/refresh.test.ts` | Tested |
| 1.1 | Gmail watch → detect → download → ingest | `services/archive-ingest.ts` | Built, unverified |
| 1.1 | Manual upload fallback | `POST /archive/upload` | Tested |
| 1.1 | Second installment merged | `resolveSnapshot()` | Tested — **was broken**, see below |
| 1.1 | Re-archive cadence, snapshot diffs | `archive.recheck` job, `snapshotDelta()` | Tested |
| 1.1 | Dirty-data normalization | `packages/archive/src/normalize.ts` | Tested |
| 1.2 | Five slots with completion criteria | `packages/core/src/intake-framework.ts` | Tested |
| 1.2 | Framework decides completion, not the model | `services/intake.ts` | Tested |
| 1.2 | Areas 2 and 5 seeded from archive | `buildSeeds()` | Tested |
| 1.2 | Resumable across sittings | `startIntake()` | Tested |
| 1.3 | Versioned, user-editable brief | `services/brief.ts` | Tested |
| 1.3 | Never-say list is a hard filter | `packages/core/src/constraints.ts` | Conformance |
| 1.4 | Network analysis, audience-fit ratio | `packages/core/src/network.ts` | Tested |
| 1.4 | Invitation accept rate, posting cadence | `networkPicture()` | Tested |
| 1.4 | Posts that drew persona comments | — | ⚠️ **Not measurable.** Returns null with reason. Conformance |
| 1.4 | Trend + peer analysis | `intelPicture()` | Built, unverified (needs intel key) |
| 1.4 | Drafts similarity-checked against peers | `packages/core/src/similarity.ts` | Tested |
| 1.4 | Every draft traces to a roadmap element | Non-nullable FK | Conformance |
| 1.5 | Ready-to-post drafts carrying their "why" | `generateDraft()` | Tested |
| 1.5 | Conversational refinement, full history | `refineDraft()`, `DraftRevision` | Tested |
| 1.5 | Scheduling queue | `content.publishDue` job | Tested |
| 1.5 | Publish via `w_member_social` | `packages/linkedin/src/client.ts` | Built, unverified |
| 1.5 | Edit diffs captured for the voice model | `applyUserEdit()` | Tested |
| 1.6 | Target feed, priority scoring | `packages/intel/src/scoring.ts` | Tested |
| 1.6 | Comment drafting, reactions | `services/engagement.ts` | Built — **needs the vetted scope** |
| 1.6 | Human-approved in Phase 1 | `publishEngagement()` | Conformance |
| 1.7 | Per-category, recency-weighted, min sample | `confidence.ts` | Tested |
| 1.7 | Every movement logged against its decision | `ConfidenceEvent` | Tested |
| 1.7 | Visible dashboard | `app/dashboard` | Built |
| 1.8 | Cold-started from comments + shares | `buildVoiceProfile()` | Tested |
| 1.8 | Refined from edit diffs | `voice.refresh` job | Tested |
| 1.8 | Edits per draft declines | `editsPerDraftTrend()` | Tested |
| 1.9 | Drive pull + upload, per-doc confirm | `services/documents.ts` | Built, unverified (Drive) |
| 1.9 | Summaries and excerpts only | `redactPrompt`, no transcript column | Conformance |
| 1.9 | Real deletion | `deleteDocument()` | Tested |
| 1.10 | Threshold prompt, gates nothing | `autonomyPromptState()` | Conformance |
| 3.6 | Non-goals held | autonomy off by default, LinkedIn only | Conformance |

## §2 — Phase 2

| § | Claim | Where | Status |
|---|---|---|---|
| 2.1 | Engagement autonomy within guardrails | `packages/core/src/autonomy.ts` | Tested |
| 2.1 | Caps, allowlist, exclusions, kill switch | `evaluateAutonomy()` | Tested |
| 2.2 | Content autonomy, separate threshold | `AUTONOMY_THRESHOLDS` | Conformance |
| 2.3 | Persona-matched prospecting | `identifyProspects()` | Tested |
| 2.4 | Assisted outreach with deep link | `draftOutreach()` | Tested |
| 2.5 | Permanently higher outreach bar | `AUTONOMY_THRESHOLDS.OUTREACH` | Conformance |
| — | Cold connect/DM **not built** | — | Conformance |

## §3 / §5 / §9

| § | Claim | Where | Status |
|---|---|---|---|
| 3.5 | Three signal sources reach a prompt | trends, decisions, documents | Conformance |
| 5 | Customer/operator classification hedge | `services/classification.ts` | Tested |
| 9 | Weekly report, archive-derived metrics | `metrics.weeklyPrompt` job | Tested |
| 9 | Approval rate, edits/draft, fit ratio | `metricsView()` | Tested |

---

## Where the roadmap and reality diverge

Three, each recorded rather than papered over.

**§0.1 — the scope claim is wrong.** `w_member_social` covers publishing only.
Commenting and reacting need `w_member_social_feed`, from the vetted Community
Management API. §1.6 therefore cannot ship in Phase 1 without an approval
process, and the minimum shippable cut is §1.0–§1.5. The code is built and
tested behind a flag.

**§1.4 / §9 — persona comments received are not measurable.** The archive holds
comments you *left*, not comments you *received*; reading back your own
engagement needs `r_member_social`, which is closed. Reported as null with the
reason, not as zero.

**§1.1 — "zero user steps" doesn't hold.** LinkedIn emails a link, not a file,
and the link is usually behind the member's own session. The pipeline tries the
fetch and falls back to handing the user a one-click download.

## Bugs this audit found

All four were fully implemented and passing tests while doing nothing:

1. **The roadmap generator never saw the brief** — `buildPrompt` took it and did
   `void brief`. Produced generic advice while a brief sat in the database.
2. **The second archive installment destroyed the network picture** — it opened a
   new snapshot containing no connections, so the network read as zero and the
   growth diff reported every connection as churned.
3. **Nothing ran on a timer** — no scheduler existed; six roadmap features were
   routes nobody called.
4. **Meeting notes reached no prompt** — §3.5's third signal source was extracted,
   stored, and ignored.

The conformance suite exists so the fifth one fails a test instead.
