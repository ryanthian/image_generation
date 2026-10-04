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
