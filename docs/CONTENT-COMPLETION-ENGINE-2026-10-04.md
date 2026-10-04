# Content Completion Engine — 2026-10-04

This release treats Google Sheet rows as source material. `buildProductionContent()` centralises normalization, prioritized same-record recovery, useful copy completion, a maximum of two improvement passes, factual and editorial-quality checks, then visual planning. It runs before single-post generation and batch admission. It never confers human approval or writes source Sheets.

## Engineering and workflow gates

Gate A0: requirements and console history retrieved; current v25 checkout and clean baseline verified. Blind spots: fabricated precision facts, filler-driven quality scores, old compiler cache admission, premature image prompts, stale assets, and interrupted batch work. No unresolved critical unknowns.

Gate A: preserve the approved UI, no forms or additional approval steps, no new provider credentials, separate original/production objects, bounded compiler, exact deployment provenance, retain v25/v24/v20 rollback. Use Paper Dashboard's existing compact status/details/buttons.

Gate B/C: 220 tests pass, lint/build pass. Added real-record fixtures and compiler tests for raw/normalized records, weak copy, ingredient objects, missing method assets, literal quantities, false-positive drink ingredients, unsupported claims, bounded improvement, filler-resistant scoring, versioned batch snapshots and malformed-source continuation. All 290 fresh source records passed the read-only release replay with zero dead ends. No generated images are requested for skipped content.

## Real source evidence

| Sheet ID | Rows | Raw-record SHA-256 before deployment |
|---|---:|---|
| 2026091901 — legacy Draft 20 source | 120 | `59afd5567894d8abdd9575521718f1383db119d170bc1782708af37088a4f22d` |
| 812541719 — legacy Draft 100 source | 100 | `90cfa219646170191b541819ba018bba1b28edbeaf97baa0a6d6aed4862f066c` |
| 433728120 — V4 source | 70 | `ff32fa1dcfe95ede0c487bd346e8fc03202ba4aa39e8d0b2bf5cf120cb72a2b2` |

132 records reached PRODUCE; 158 were individually skipped for duplicates, critical facts, unsupported claims or insufficient useful substance. Every skipped row had a screened replacement. These are automatic production decisions, not human editorial approval. Quality is an explainable heuristic, not measured Facebook performance.

Representative checks: EN-NEW-003 quality 57 → 89 with literal ingredient recovery; EN-NEW-009 61 → 89, all six steps retained with 9 → 5 photo optimization; Draft 100 EN-NEW-00000021 completes to five slots when independently checking the adapter, but its corpus duplicate status still prevents production admission; V4 GS-V4-SG-002 and EXP-038 produce. EXP-002's actual five quantified ingredients and mixing instructions produce; prose was previously misread as additional ingredients. Approximation words such as 约 remain attached to quantities. EXP-016 and EXP-054 have generic topic material without useful criteria and remain below quality after two passes. EXP-047 has no recoverable ingredients/method and safely skips; no recipe is fabricated.

## Production objects and persistence

Original Sheet rows remain unchanged. Production overrides include title, hook, body, caption, asset plan, image prompts, derived fields, repair notes, fact-confidence provenance and completion history. Confidence distinguishes SOURCE FACT (explicit text), DERIVED (extraction), AI COMPLETION (wording/structure) and UNVERIFIED CLAIM; explicit text is not an externally verified claim. Existing IndexedDB production state stores individual overrides; active batch/reserve snapshots persist in existing browser state. Old compiler cache versions are re-evaluated. Existing imported media retains its namespace; changed plans become stale and cannot export. Started posts are not silently replaced.

Default behavior: complete safely → quality gate → PRODUCE → images, or exhausted/unsafe → SKIP → next good content. The original factual source may be incomplete or poorly structured; the production copy contains recovered ingredients, method, source-supported tips, natural caption and practical save value. No invented quantities, times, temperatures, safety claims, prices, storage durations or specifications. No mandatory academic URL for ordinary low-risk content.

## Local browser acceptance

Real source dropdowns loaded 120/100/70. Complete, partial legacy, V4 drink, poor V4 and duplicate cases exercised before release. Quick Production continues from the incomplete recipe. Batch 5/10/20 admission and reserve replacement work; prepared batch snapshots contain production content. Local seeded v24 Batch 01 retained the four recoverable drinks and replaced four weak guides: 20 posts, 86 jobs, 4.3 jobs/post, ten reserves. This seeded migration test is separate from the operator's current v25 batch.

The reload regression initially exposed a raw-plan hydration mismatch while duplicate discovery was pending. The selected completed object and its persisted media are now rehydrated together after discovery; the regression passed on rerun.

Individual Recipe and Selection workflow, prompts, deterministic import, explicit unmatched assignment, resume, independent build, partial ZIP, complete ZIP and per-post stale blocking verified. Two-post ZIP: ten PNGs; five-post ZIP: 26 PNGs. All 1440×1800 and uncorrupted. Synthetic fixtures only; this is not real-image approval. Mobile 390×844 has no horizontal overflow. No application console errors or non-GET requests.

Evidence artifacts remain locally under `output/content-completion/` and `output/playwright/completion-*`. Raw full-corpus snapshots are not committed. Run `node scripts/verify-content-completion.mjs` with freshly captured snapshots for the reproducible corpus gate. Browser acceptance scripts use read-only source APIs and isolated browser storage.

## Deployment and live verification

Pending exact saved version/commit and live smoke readback. Deployment will occur only from the clean committed source after engineering and real-record acceptance checks; v25 remains available for rollback. Gate D completes after deployment proof and final report.
