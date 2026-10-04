# Fast visual plans and batch image production — 2026-10-04

## Requirement and baseline

Continue the approved v23 Content → AI Optimise workflow. Reduce unnecessary source photography while retaining useful Facebook information, and implement batch planning, generation prompts, import, resume, independent build and partial ZIP export.

Baseline checkout: `c889d97432c30362a4dbb038c6a54857b281d8d6`. Baseline deployed v23 application: `2d034c59af4fa33f896aa8cf5516035f70102388`. Preserve v23 and v20 for rollback. No source Sheet edits or Facebook publication are part of this change.

## Workflow gates and blind spots

Gate A0 passed before planning: requirement, project context and relevant memory read; clean current baseline and existing private Site verified. Critical blind spots addressed: lost chronological instructions or quantities, removal of a useful interior/detail photograph, mismatched post identities, ambiguous filename mapping, historical storage compatibility, stale/replaced image exports, forged human review, published records entering a new batch, and batch operation races.

Gate A passed before implementation: non-destructive resolved visual plans; a portable batch engine; existing IndexedDB namespaces, renderer and ZIP implementation; Paper Dashboard cards/table/button patterns; unit plus browser verification; rollback through the retained Sites versions. Assumption: reduced photos represent particular source states and do not visually claim to depict every written instruction. Distinct useful states may exceed the suggested count with an explicit explanation.

## Update log

- Added type-aware IMAGE PLAN with required photo count, generation jobs, Start Image Production and secondary Regenerate Plan.
- Representative legacy EN-NEW-009: **9 → 5 source images**, including two representative method photos. All six chronological instructions and ingredient quantities remain in final cards; overflow continues onto ordered continuation cards. Information lost: **NONE**.
- Checklist/summary cards reuse an established subject photo. Unique selection/interior inspection scenes remain separate. V4 GS-V4-SG-002 needs six photos and produces seven final cards.
- Added Auto Select 5 / 10 / 20. Only complete LOW-risk PRODUCE, UNIQUE/CANONICAL, unpublished records qualify. Selection favours score and topic/format variety. Insufficient eligible records are reported without padding.
- Added deterministic batch/post/slot identifiers such as `B01_P01_01_COVER.png`, a flat queue, next pending image, Copy Next / Current Post / Batch, and N/R/FIX commands. Identity resets occur at post boundaries. Resumed prompts omit imported current images.
- Added bulk import using identifiers, independent per-file QC, and explicit exception assignment. Ambiguous files never silently map by upload order.
- Persisted batch selection and progress locally, reusing original image/asset IndexedDB namespaces. Changed source plans and image revisions invalidate only affected posts/assets.
- Added Build Ready Posts using the existing renderer. Inspect Final and choose Looks Good before download. Other posts can continue waiting for images.
- Added a single ordered batch ZIP for current reviewed posts, with one folder per post, 1440×1800 final PNGs, caption, per-post manifest and batch manifest. Single-post ZIP uses the same packaging helper.
- Canonicalised visual signatures across individual/batch rendering and IndexedDB insertion order. Added locks against competing content operations during batch import/build/export.
- Preserved the approved Content UI, original source records, action-specific gates, no-auto-publishing architecture, individual prompts, selective rebuilding and Next Content.

## Verification before deployment

Tests: **176/176 PASS**. Lint: **PASS**. Build: **PASS**. Source-loading/security/stale/ambiguous-import checks remain in the passing regression suite. Self-review and `git diff --check`: PASS.

Read-only production-source snapshot browser checks loaded Draft 20 **120**, Draft 100 **100**, V4 **70**, total **290**. Individual Recipe and Selection Guide import, reload, build, inspect, ordered ZIP, stale-export blocking and selective rebuilding passed. Mark Posted remained blocked; human editorial approval was not granted.

Five-post end-to-end batch: **5 posts / 22 source photos / 4.4 photos per post**. Reverse-order import, explicit unmatched assignment, persisted resume, first-two-post build/export, all-five-post completion/export, and replacement isolating one post all passed. Partial ZIP readback: 2 posts, 9 final PNGs, 2 captions; full ZIP: 5 posts, 25 final PNGs, 5 captions; all PNGs 1440×1800.

Twenty-post planning after the five downloaded posts were excluded: **20 posts / 76 source photos / 3.8 per post** across recipes, drinks, selection guides, collections, comparisons and tips. The mixed-format average may be below the Recipe range. Planning used real captured source records, not fabricated IDs.

Mobile 390×844: no horizontal page overflow. No application console errors or non-GET requests during local browser checks. Text actually drawn on canvas was checked independently for all six method steps, 74°C and 230–260 ml. Representative method cards and mobile view were visually inspected against the existing Paper Dashboard layout.

Evidence: `output/playwright/batch-local/report.json`, `output/playwright/simplification-local/report.json`; ZIPs, copied prompts and screenshots in those directories. QA media are labelled synthetic and isolated from the operator browser.

## Human and runtime boundaries

Real ChatGPT-generated food photographs have **NOT** been validated. Synthetic fixture inspection proves renderer/import/export behaviour only; it does not grant source editorial approval or validate actual subject realism, ingredients, continuity or safety. The operator generates the pending photos in ChatGPT, imports them, inspects actual Final previews and decides Looks Good/Fix/Regenerate. No human approval was fabricated.

Batch selection/progress, source images and final assets persist in this browser/device, not across devices. Unmatched file assignments are pending in memory until resolved; original files must be reimported after reload. No credentials are saved in this report or the repository.

## Deployment and handoff

Final native deployment identity and live verification are recorded below after publication. v23/v20 remain rollback versions. Daily workflow: Batch → Auto Select → Copy Batch → generate one photo per response → drag all downloads into Batch → resolve exceptions → Build Ready Posts → inspect each Final → Looks Good → Download Ready Posts. Refresh affected plans only when source content changes.

### Operator Batch 01 prepared on deployed v24

The existing operator browser now holds **BATCH 01: 20 eligible posts, 78 pending photos, average 3.9 per post**. This differs from the automated test's later twenty-post selection because the test excludes its five already downloaded posts. Actual operator images imported: **0/78**; final posts built: **0/20**; real-image visual approvals: **0/20**. This is a production plan, not a claim of completed photography or human approval.

| Post | Content ID | Photos |
| --- | --- | ---: |
| P01 | EN-NEW-009 | 5 |
| P02 | GS-V4-EXP-002 | 4 |
| P03 | GS-V4-EXP-038 | 4 |
| P04 | GS-V4-SG-002 | 6 |
| P05 | GS-V4-EXP-027 | 3 |
| P06 | GS-V4-EXP-054 | 3 |
| P07 | EN-NEW-052 | 5 |
| P08 | GS-V4-EXP-003 | 4 |
| P09 | GS-V4-EXP-029 | 3 |
| P10 | GS-V4-EXP-056 | 3 |
| P11 | EN-NEW-070 | 5 |
| P12 | GS-V4-EXP-016 | 3 |
| P13 | GS-V4-EXP-043 | 3 |
| P14 | GS-V4-EXP-004 | 4 |
| P15 | EN-NEW-105 | 5 |
| P16 | GS-V4-EXP-017 | 3 |
| P17 | GS-V4-EXP-028 | 3 |
| P18 | GS-V4-EXP-045 | 3 |
| P19 | GS-V4-EXP-005 | 4 |
| P20 | EN-NEW-020 | 5 |

Operator screenshot: `output/playwright/batch-live/operator-batch-01.jpg`. The existing Console tab was reloaded to v24 and left open on Batch 01.

### Verified release and live smoke test

- PLATFORM STATUS: **PRODUCTION READY WITH WARNINGS**. All application checks pass. The non-blocking warning is the existing hosting-injected Cloudflare challenge inline script being refused by the unchanged strict CSP. Every observed inline script was attributable to `/cdn-cgi/challenge-platform/`; no application console or page errors occurred. No security policy was weakened.
- Deployed version: **Sites v24**, status **succeeded**. Audience remains owner-private.
- Deployment commit / live `/api/build` commit: **75039cb8b4f025ef185096ba6e3602735d2137ba**. Build time: `2026-10-04T01:55:12.618Z`.
- Deployment ID: `appgdep_6ac1b237f3588191a80c5b333a7545e0`.
- Saved version ID: `appgprj_6aae8cef935081919aead96f8cd34f7a~appgver_708e24985ff081918b0754a2f56545ae`.
- Live sources: **120 / 100 / 70**, total **290**; dropdown loading passed on all three.
- Live five-post end-to-end and twenty-post planning: **PASS**. Bulk import, exception resolution, reload/resume, per-post build, visual-decision invalidation, two-post/all-five ZIPs, and stale-post isolation passed. Mobile 390×844: PASS.
- Live ZIP binary readback: all final PNGs **1440×1800**, expected captions and batch/post manifests present. Partial: 2 posts / 9 PNGs / 2 captions. Complete: 5 posts / 25 PNGs / 5 captions.
- Live test non-GET requests: **0**. No Sheet status/content update and no Facebook publication. Editorial approval was not fabricated; synthetic final decisions exist only in the disposable test browser.
- Evidence: `output/playwright/batch-live/report.json`, `zip-readback.json`, saved ZIPs and screenshots.

Gate C: acceptance criteria, tests, source-information preservation, UI consistency, exact deployment identity and live readback verified. Gate D: update log, operator Batch 01 and resumable handoff recorded. Remaining work is actual ChatGPT photo generation and the operator's image judgment; no critical engineering blocker remains.

### Superseding Batch 01 cleanup on v25

The v24 operator table above is release history. v25's stricter same-record factual screen found four drinks without essential source quantities and replaced them automatically. Current actual Batch 01: **20 posts / 82 source images / average 4.1 / 11 auto repaired / 4 replacements / 10 reserves**, all 20 PRODUCE. Original sources and existing media remain intact. See [repair release and replacement table](AUTO-REPAIR-CONTINUOUS-PRODUCTION-2026-10-04.md).
