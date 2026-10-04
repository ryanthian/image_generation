# Content Completion Engine — 2026-10-04

This release treats Google Sheet rows as source material. `buildProductionContent()` centralises normalization, prioritized same-record recovery, useful copy completion, a maximum of two improvement passes, factual and editorial-quality checks, then visual planning. It runs before single-post generation and batch admission. It never confers human approval or writes source Sheets.

## Engineering and workflow gates

Gate A0: requirements and console history retrieved; current v25 checkout and clean baseline verified. Blind spots: fabricated precision facts, filler-driven quality scores, old compiler cache admission, premature image prompts, stale assets, and interrupted batch work. No unresolved critical unknowns.

Gate A: preserve the approved UI, no forms or additional approval steps, no new provider credentials, separate original/production objects, bounded compiler, exact deployment provenance, retain v25/v24/v20 rollback. Use Paper Dashboard's existing compact status/details/buttons.

Gate B/C: 221 tests pass, lint/build pass. Added real-record fixtures and compiler tests for raw/normalized records, weak copy, ingredient objects, missing method assets, literal quantities, false-positive drink ingredients, unsupported claims, bounded improvement, filler-resistant scoring, versioned batch snapshots and malformed-source continuation. All 290 fresh source records passed the read-only release replay with zero dead ends. No generated images are requested for skipped content.

## Real source evidence

| Sheet ID | Rows | Raw-record SHA-256 before deployment |
|---|---:|---|
| 2026091901 — legacy Draft 20 source | 120 | `59afd5567894d8abdd9575521718f1383db119d170bc1782708af37088a4f22d` |
| 812541719 — legacy Draft 100 source | 100 | `90cfa219646170191b541819ba018bba1b28edbeaf97baa0a6d6aed4862f066c` |
| 433728120 — V4 source | 70 | `ff32fa1dcfe95ede0c487bd346e8fc03202ba4aa39e8d0b2bf5cf120cb72a2b2` |

131 records reached PRODUCE; 159 were individually skipped for duplicates, critical facts, unsupported claims or insufficient useful substance. Every skipped row had a screened replacement. Replay mirrors both canonical holds and the Console's near-duplicate REWORK exclusion; the initial canonical-only replay admitted one additional near-duplicate, which was corrected in the verification harness. These are automatic production decisions, not human editorial approval. Quality is an explainable heuristic, not measured Facebook performance.

Representative checks: EN-NEW-003 quality 57 → 89 with literal ingredient recovery; EN-NEW-009 61 → 89, all six steps retained with 9 → 5 photo optimization; Draft 100 EN-NEW-00000021 completes to five slots when independently checking the adapter, but its corpus duplicate status still prevents production admission; V4 GS-V4-SG-002 and EXP-038 produce. EXP-002's actual five quantified ingredients and mixing instructions produce; prose was previously misread as additional ingredients. Approximation words such as 约 remain attached to quantities. EXP-016 and EXP-054 have generic topic material without useful criteria and remain below quality after two passes. EXP-047 has no recoverable ingredients/method and safely skips; no recipe is fabricated.

## Production objects and persistence

Original Sheet rows remain unchanged. Production overrides include title, hook, body, caption, asset plan, image prompts, derived fields, repair notes, fact-confidence provenance and completion history. Confidence distinguishes SOURCE FACT (explicit text), DERIVED (extraction), AI COMPLETION (wording/structure) and UNVERIFIED CLAIM; explicit text is not an externally verified claim. Existing IndexedDB production state stores individual overrides; active batch/reserve snapshots persist in existing browser state. Old compiler cache versions are re-evaluated. Resumed legacy batch posts also receive a completed production snapshot while retaining their existing plan stamp until a safe plan refresh. The added migration regression confirms that media and stale blocking remain intact. Existing imported media retains its namespace; changed plans become stale and cannot export. Started posts are not silently replaced.

Default behavior: complete safely → quality gate → PRODUCE → images, or exhausted/unsafe → SKIP → next good content. The original factual source may be incomplete or poorly structured; the production copy contains recovered ingredients, method, source-supported tips, natural caption and practical save value. No invented quantities, times, temperatures, safety claims, prices, storage durations or specifications. No mandatory academic URL for ordinary low-risk content.

## Local browser acceptance

Real source dropdowns loaded 120/100/70. Complete, partial legacy, V4 drink, poor V4 and duplicate cases exercised before release. Quick Production continues from the incomplete recipe. Batch 5/10/20 admission and reserve replacement work; prepared batch snapshots contain production content. Local seeded v24 Batch 01 retained the four recoverable drinks and replaced four weak guides: 20 posts, 86 jobs, 4.3 jobs/post, ten reserves. This seeded migration test is separate from the operator's current v25 batch.

The reload regression initially exposed a raw-plan hydration mismatch while duplicate discovery was pending. The selected completed object and its persisted media are now rehydrated together after discovery; the regression passed on rerun.

Individual Recipe and Selection workflow, prompts, deterministic import, explicit unmatched assignment, resume, independent build, partial ZIP, complete ZIP and per-post stale blocking verified. Two-post ZIP: ten PNGs; five-post ZIP: 26 PNGs. All 1440×1800 and uncorrupted. Synthetic fixtures only; this is not real-image approval. Mobile 390×844 has no horizontal overflow. No application console errors or non-GET requests.

Evidence artifacts remain locally under `output/content-completion/` and `output/playwright/completion-*`. Raw full-corpus snapshots are not committed. Run `node scripts/verify-content-completion.mjs` with freshly captured snapshots for the reproducible corpus gate. Browser acceptance scripts use read-only source APIs and isolated browser storage.

## Deployment and live verification

The complete engine first deployed as v26 (`f767d9c466efb720868d0aaf4207df8520b42d3a`) and passed live completion, individual resume/selective rebuild and batch ZIP acceptance. A final backward-compatible snapshot migration correction deployed as **v27** from **`29db1e726f4304d31d419aa81a5d8b7dc87cb98d`**. Native deployment status: **succeeded**.

- Site: https://content-ai-production-console.ryanthian.chatgpt.site/
- Saved version: `appgprj_6aae8cef935081919aead96f8cd34f7a~appgver_4e3d0abbfa88819187d9682721e08a85`
- Deployment: `appgdep_6ac1ce4dbe188191a21e4a7b67d91b19`
- Archive SHA-256: `ad796759576aa6d0e5662206e0fcd282c344c10e2b69db40ce47150754afb2be`
- Audience unchanged: owner-private, custom access, zero external visitors.
- Rollback: retain v26/v25/v24/v20; no force push, merge, source-row deletion or credentials saved.

Operator's actual Batch 01 after migrating from v25: **20 posts / 20 AI prepared / 20 PRODUCE / 89 image jobs / 4.45 jobs per post / 10 reserves**. Four additional weak records replaced; eight cumulative replacements includes the earlier four v25 replacements. Existing media on a retained Selection Guide was preserved and its plan safely refreshed; all twenty posts have valid current plans. No new human approval or real-image validation is inferred. The final active batch differs from the disposable v24 migration fixture (86 jobs), fresh corpus selection (83 jobs) and browser QA batches that exclude their downloaded test posts.

Final **v27 live smoke: PASS**. `/api/build` returned `29db1e726f4304d31d419aa81a5d8b7dc87cb98d`, built at `2026-10-04T03:55:05.835Z`, matching native saved-version provenance. Live completion checks exercised EXP-002, EN-NEW-003, genuinely incomplete EXP-047, weak EXP-054, Quick Production, 5/10/20 selection, local override persistence and reserve replacement. Batch checks exercised reverse import, explicit unmatched handling, resume, independent builds, partial two-post/full five-post ZIPs, stale isolation and mobile layout. Final ZIP readback confirmed ten/26 ordered PNGs, all 1440×1800, no corrupt entries. Individual Recipe and V4 Selection Guide resume/export/selective-rebuild/Mark Posted blocking passed on v26; that application code is unchanged in v27.

All final v27 source record hashes match the before-deployment hashes. Both final live browser reports have zero application console/page errors and zero non-GET requests. Operator tab reports PRODUCTION READY, twenty PRODUCE posts, zero stale-plan rows and no application errors. No source edit, Facebook publication or fabricated approval occurred.

| Requested release check | Result |
|---|---|
| Platform | PRODUCTION READY WITH WARNINGS |
| Auto repair / content completion / auto re-evaluation | PASS |
| False-positive fact detection | PASS |
| Auto skip / next good content | PASS |
| Batch replacement / reserves / completed-object persistence | PASS |
| No invented precision facts | PASS — source recovery/formatting only; tested missing quantity prevention |
| Actual GS-V4-EXP-047 | SKIPPED after two completion passes; essential ingredients/method unavailable |
| Tests / lint / build | 221/221; PASS; PASS |
| Real corpus release replay | 290 evaluated; 131 PRODUCE; 159 individual skips; zero dead ends |
| Live smoke / mobile / ordered ZIP | PASS |
| New approval / real-image verification | None inferred; synthetic browser fixtures only |

The only non-blocking platform warning is the existing Sites-injected Cloudflare challenge attempting inline execution under `script-src 'self'`. Application scripts have no such error; no CSP relaxation was made. Quality scores remain heuristic and cannot guarantee audience response. Actual user-generated ChatGPT images still need the existing final image checks. These are per-post production judgments, not a platform or corpus-wide blocker.

Gate D: deployment proof and source-integrity readback recorded; feature branch synced to `ryanthian/image_generation`; no runtime work remains. The final documentation/proof commit may follow the deployed code commit without changing the deployed application. No global memory was modified.
