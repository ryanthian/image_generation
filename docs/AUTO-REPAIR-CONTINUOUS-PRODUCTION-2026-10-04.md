# Continuous production: safe automatic repair — 2026-10-04

## Requirement, baseline and gates

Continue the deployed v24 Console without redesigning Content, adding reviewer forms, editing Sheets or publishing to Facebook. Automatically recover same-record facts, improve presentation, re-evaluate, skip irrecoverable records and replace incomplete batch posts before image production.

Clean starting checkout: `32a1b10d98430e3d40485da6b88e005a4b97864e`. v24 deployed application: `75039cb8b4f025ef185096ba6e3602735d2137ba`. v24/v23/v20 remain rollback versions. The native Site remains owner-private.

Gate A0 passed before planning: current requirement, relevant project memory, repository and deployed baseline inspected. Blind spots: false missing facts in older schemas; quantities invented from ingredient names; cooking cues incorrectly requiring exact time; contradictions; stale cached assessments; published/duplicate selection; loss of operator images on replacement; old filenames mapping to new posts; browser-state persistence; fixture approval mistaken for human approval. No unresolved critical planning unknown remained.

Gate A passed before implementation: source-preserving compiler, existing IndexedDB/localStorage persistence, screened reserve pool, deterministic replacement generations, existing Paper Dashboard notifications/buttons/cards, unit tests plus isolated browser tests and retained deployment rollback. Factual recovery is conservative and deterministic; it uses no unrelated record or external generated recipe.

## Change log

- Added `production-repair.mjs`: scans source fields, structured assets, Full_Recipe, body, caption, legacy ingredients, ingredient prompts and individual method captions within one record. Extracts explicit quantities and ordered methods; never supplies missing amounts, time, temperatures or claims.
- Records AUTO_FIXED, NON_BLOCKING_WARNING, CRITICAL_UNRESOLVED and source provenance. The original raw record is retained unchanged; the production override is persisted locally with source/raw-input change stamps and `humanApproved: false`.
- Fixes quantity-unit false positives (朵/张/棵 and other source units), fruit flesh incorrectly treated as meat, and source fish doneness cues incorrectly requiring a poultry cue. Exact time is unnecessary when the source provides a clear observable doneness cue. Optional garnish/to-taste wording remains unchanged with a warning.
- Detects conflicting explicit ingredient quantities, including equivalent metric units, unresolved essentials and unsafe/high-risk claims. It does not remove factual gates to boost the score.
- Replaced the instruction to manually edit Sheets with a compact Content Check, View Details and Skip & Next Good Content. Safe content has Generate Images and Improve Again. No new reviewer or evidence form was introduced.
- Quick Production and Next Good Content choose already screened LOW-risk PRODUCE records, refresh the selected source and continue past a newly incomplete candidate. Duplicates, published and downloaded items are excluded from new work.
- Auto Select 5/10/20 screens before admission, retains 5/5/10 reserves, and reports evaluation, repair, exclusions and replacements. Replacement prefers the same content type and screened reserves; no weak padding is used.
- Reconciles existing batches. Incomplete posts with no started media are replaced automatically; post ordinals remain stable. A replacement uses filenames such as `B01_P02R01_01_COVER.png`, preventing old P02 downloads silently mapping to its replacement.
- Existing images/assets are never deleted by cleanup. If source facts fail after image work has started, that post stays individually blocked while other posts' prompts/builds/ZIPs can continue. A failed build no longer aborts unrelated ready posts.
- Preserves legacy 9 → 5 optimisation, all method text, independent builds, partial ZIP, import exceptions, resume, stale blocking, three connected Sheets, and Content → AI Optimise.

## Actual failing record

Live read-only inspection: **GS-V4-EXP-047, 蜜汁叉烧家常版**. Its body/caption and five asset prompts are generic; no explicit ingredient list, quantities or ordered recipe appear anywhere in this record. The existing `CONTENT_READY` label is not factual completeness. Result: **SKIPPED — SOURCE INCOMPLETE**. No recipe was fabricated. Both Skip & Next and Quick Production load a screened usable record and enable its prompts.

Actual legacy false positives EN-NEW-003 (香菇2朵) and EN-NEW-014 (explicit fish cue) now pass factual checks and produce. EN-NEW-111 no longer receives a false meat cue error, but its storage advice retains a separate claim-support gate. No approval or evidence is inferred from resolving a parser false positive.

## Tests and acceptance evidence

Unit suite: **206/206 PASS**, including 30 new repair/continuity cases. Lint/build/diff check PASS. Security/source-loading/stale/ambiguous-import tests remain in the passing suite.

Read-only snapshots: Draft 20 **120**, Draft 100 **100**, V4 **70**, total **290**. Same-record extraction, legacy/V4 complete recipes, missing time with doneness, optional garnish, false positives, contradiction detection, quantity non-invention, skip, next-good exclusions, reserve/refill, replacement identity and started-work preservation pass.

Isolated local browser: actual GS-V4-EXP-047 skipped; EN-NEW-003 repaired with prompts enabled; production override persisted; Quick Production continues; Auto Select 5/10/20 and reserve pools pass. Newly incomplete accepted-post replacement was tested with a browser-local GET-response mock; no Sheet was changed. Existing v24 20-post/78-image Batch 01 fixture is cleaned to **20 posts / 82 image jobs / average 4.1 / 10 reserves / 4 replacements / 11 posts auto repaired**.

Existing individual and batch end-to-end regressions pass. Recipe retains six rendered method steps and literal 74°C/230–260ml source facts; 9 → 5 photos. V4 Selection import/build/resume/ordered ZIP and selective rebuild pass. Batch reverse-order imports, explicit unmatched assignment, partial-two-post ZIP, full-five-post ZIP, independent builds and stale-post isolation pass. Mobile 390×844 has no page overflow. Application console errors and non-GET requests: zero locally.

Evidence: `output/playwright/repair-local/report.json`, `repair-regression-local/report.json`, `repair-individual-local/report.json`, screenshots and ZIPs. Raw source snapshots remain ignored; only four relevant source-record fixtures are committed.

## Release and live handoff

Exact version/commit/deployment and live operator Batch 01 readback will be recorded after publication. Real ChatGPT photographs and human visual judgment remain unverified. All image fixtures are isolated, synthetic and never imported into the operator browser. No Sheet update or Facebook publication is part of validation.
