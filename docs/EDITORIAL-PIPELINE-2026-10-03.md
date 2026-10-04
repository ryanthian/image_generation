# Production Console editorial pipeline — 2026-10-03

> The routine production workflow below records the v22 release. The current single-operator requirement supersedes its mandatory human editorial gate for low-risk image production and export. See [Single-operator production](SINGLE-OPERATOR-PRODUCTION-2026-10-04.md). Historical reviews and publishing protections remain compatible.

## Release model

**Platform status** is an engineering and service decision: `PRODUCTION READY`, `PRODUCTION READY WITH WARNINGS`, or `NOT PRODUCTION READY`. It is not an aggregate of editorial approvals. **Content status** is per record: `READY`, `NEEDS IMPROVEMENT`, `HOLD`, or `INVALID`. The Console shows both independently. A score is a heuristic for ordering work, never human approval.

The release requires passing tests, syntax/lint, build, source loading, origin and source validation for writes, non-destructive review storage, conservative import matching, stale-asset protection, working ZIP generation, and no Facebook auto-publishing. A record may reach image production only after its own editorial PASS. Page fit and Page ID are publishing requirements, not image-production or ZIP requirements. A real image is imported before human visual review; each required slot and the final assets need review before export. `Mark Posted` additionally requires publication evidence and its own gates.

## Daily workflow

`SOURCE CONTENT → EDITORIAL QUEUE → IMPROVE CONTENT → APPROVE CONTENT → CHATGPT IMAGE PROMPT → GENERATE IMAGES → IMPORT → BUILD → VISUAL QC → ZIP → POST`

The queue loads the three production Sheets, ranks records, hides strongly held duplicate copies, and offers READY, NEEDS IMPROVEMENT, HOLD, INVALID, DUPLICATE, EDITORIAL REVIEW REQUIRED, SOURCE REVIEW REQUIRED, MISSING FACTS, IMAGE READY, PUBLISHED, and Production Batch 01 filters. Search and table rows open the record. Batch 01 can be reviewed in order with **Next Review** or `Alt+N` outside text fields. Progress separates AI preparation, human approval, needs fix, and remaining work.

The workspace preserves the Google Sheet row and shows original and proposed title/body/caption, change notes, unresolved factual questions, evidence and duplicate state, score, risk tier, and asset plan. A named reviewer records `APPROVED`, `NEEDS_CHANGES`, `HOLD`, or `SKIP` in the existing D1 `production_editorial_reviews` table. Approval requires source-current fingerprint, resolved factual questions, source consistency, caption/copy/claim checks, and risk-appropriate evidence. A changed source invalidates an earlier approval. The legacy adapter resolves Draft 20 and Draft 100 rows into the same production object without V4 Sheet migration or source overwrite.

Low-risk ordinary recipes and basic visual guidance may use checked internal source consistency; no academic URL is imposed by default. Medium-risk storage, nutrition, cost, or technical claims require a specific checked reference. High-risk medical or regulated claims remain strongly gated. The editorial compiler extracts source-backed WHAT, WHY, ACTION and save value where available and records missing support as a factual question. It does not invent quantities or causes.

Each image slot has a deterministic expected filename, a copyable slot prompt, and an import matcher that refuses ambiguous names. Real images receive ten explicit checks: realism, subject, ingredient/object, stage, continuity, random text, logo/watermark, artifacts, crop, and source match. The reviewer chooses PASS, FIX IMAGE, or REGENERATE. A replacement invalidates that slot's review and dependent final assets; unaffected assets remain. A failed slot offers its own prompt for regeneration. Final visual QC and current asset revisions gate the ordered ZIP.

## Corpus and Batch 01

The audited captured corpus has 290 records: Draft 20 `120`, Draft 100 `100`, and V4_CANARY `70`. The canonical map proposes 100 strong groups and holds 100 duplicate copies, leaving 190 active candidates. Six weaker candidate pairs are marked REWORK for human comparison. No rows were deleted. The duplicate map is a snapshot of the audited source state and should be regenerated if the corpus changes materially.

Risk-tier scan: LOW `270`, MEDIUM `20`, HIGH `0`. Production Batch 01 has 20 non-held items: 12 recipes, 4 drinks, 1 selection guide, 1 kitchen hack, and 2 storage guides. The first batch excludes the published mistake/fix examples and generic unposted mistake/fix scaffolds; it does not fabricate a cause just to fill a format quota. Batch status is **AI PREPARED 20, HUMAN APPROVED 0, NEEDS FIX 0** until real review decisions occur. Its packages include full source and proposed copy, overlays, asset order, master session prompt, individual prompts and expected filenames. Unresolved factual questions remain visible.

Artifacts: [canonical-content-map.json](../output/canonical-content-map.json), [canonical-content-map.md](../output/canonical-content-map.md), [production-batch-01.json](../output/production-batch-01.json), [production-batch-01.md](../output/production-batch-01.md), and [editorial-dry-runs.json](../output/editorial-dry-runs.json).

## Verification and boundaries

Draft 20 `EN-NEW-009`, Draft 100 `EN-NEW-022`, and V4 `GS-V4-SG-002` passed isolated source-adapter, fixture-review, generation-manifest, deterministic filename matching, and synthetic ordered-ZIP checks. The fixture review is **not human approval** and the synthetic images are **not real ChatGPT-image validation**. No source row, Sheet Status, or Facebook post was changed in these runs. The earlier V4 browser test built seven synthetic images and a ZIP; the new per-slot visual model still requires live user image review.

**PLATFORM STATUS: PRODUCTION READY.** Sites v22 is deployed privately at [Content AI Production Console](https://content-ai-production-console.ryanthian.chatgpt.site): deployment `appgdep_6ac11b47022c8191bd45fe9820baa7d7`, exact source commit `002195a3943f63aad8fac9de48dc9df09b7201fd`. Sites v20 remains available for rollback. `npm test` passed **144/144**; `npm run lint`, `npm run build`, `git diff --check`, security regression and source-loading checks passed. Live smoke loaded the three sources at **120/100/70**, verified the 290-record queue, 100 hidden duplicate copies, 20-item Batch 01, a blocked Draft 100 record, the V4 prompt/import path, stale-asset export refusal, zero browser-console errors, and a narrow layout without horizontal overflow. The v21 smoke found a transient Sheet-bridge error during redundant per-record reads; v22 removes those reads, and the repeat live smoke showed no application error. There was no Sheet write or Facebook publication. See the [Phase 2 release evidence](PRODUCTION-CONSOLE-AUDIT-2026-10-03.md#phase-2--independent-platform-and-content-release-gates) for limits of the live check.

**CONTENT STATUS is per item.** Batch 01 remains **AI PREPARED 20 / HUMAN APPROVED 0 / NEEDS FIX 0**. Actual ChatGPT-image validation is pending: no real generated image was claimed as reviewed. The legacy adapter passed isolated Draft 20 (`EN-NEW-009`) and Draft 100 (`EN-NEW-022`) review/manifest/synthetic-ZIP dry runs, and the V4 dry run (`GS-V4-SG-002`) passed the same mechanics; none confers a new human approval. Ordered ZIP output works with synthetic fixtures, while production ZIP export continues to require current, reviewed source images and final assets. `PAGE PROFILE: INCOMPLETE` blocks Page-dependent publishing only. No actual Facebook auto-publishing exists.

Remaining human work is per content: inspect Batch 01 copy and evidence, approve selected items, generate real ChatGPT images, review every slot and final asset, and add a genuine Page profile before any Page-dependent publishing step. The rest of the corpus can move through the queue progressively.


### v23 single-operator release — 2026-10-04

Deployed source `2d034c59af4fa33f896aa8cf5516035f70102388`, Sites v23, deployment `appgdep_6ac1a2e0558481919eb25b52c9da7704` succeeded. Full release matrix, local/live workflow evidence and the non-blocking Cloudflare CSP warning are in [Single-operator release log](SINGLE-OPERATOR-PRODUCTION-2026-10-04.md). Three live Sheets load 120 / 100 / 70 records. Tests 160/160; lint/build pass. Routine low-risk production uses automatic source-based checks; human editorial approval is not invented. Real generated-image validation remains pending user media.


## Content Completion Engine release — 2026-10-04 (v27)

The current source-material pipeline is now `buildProductionContent()`: normalize → prioritized same-record recovery → complete useful content → maximum two automatic improvement passes → factual/editorial quality gate → visual plan/prompts. Low-risk items need no new reviewer fields. Original Sheets and human approval remain separate from AI production overrides. Weak/unrecoverable content skips automatically; batches admit completed production objects and keep screened reserves. Existing media, per-asset stale blocking and ordered ZIPs remain intact.

PLATFORM STATUS: **PRODUCTION READY WITH WARNINGS** (existing hosting-injected CSP challenge warning only). DEPLOYED VERSION: **v27**. DEPLOYMENT COMMIT: **`29db1e726f4304d31d419aa81a5d8b7dc87cb98d`**. Deployment ID: `appgdep_6ac1ce4dbe188191a21e4a7b67d91b19`; native status succeeded. All three Sheets loaded **120/100/70** records and their raw hashes remained unchanged. Real-corpus replay: **290 evaluated / 131 PRODUCE / 159 individual skips / zero dead ends**. Near-duplicate REWORK exclusions match the actual Console.

Actual operator Batch 01: **20 AI prepared PRODUCE posts / 89 image jobs / 4.45 average / ten reserves**. Four further weak posts replaced, eight cumulative replacements; no new approval inferred. Actual EXP-047 remains safely skipped, while quantified EXP-002 drink facts recover correctly. Tests **221/221**, lint/build and final live completion/batch/ZIP/mobile smoke PASS. Synthetic image fixtures only; no real-image verification fabricated. No Sheet writes or Facebook publication in the tested flows. Rollback versions retained.

Complete architecture, blind spots, regression corrections, deployment provenance and evidence: [Content Completion Engine report](CONTENT-COMPLETION-ENGINE-2026-10-04.md).
