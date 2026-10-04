# Single-operator Console simplification — 2026-10-04

Requirement: Continue the clean current v22 checkout at `8356334444681c2961c82e0ec9121790a8bfccf2`; remove routine manual editorial forms and make Content → AI Optimise → Images → Final → Download usable by one operator.

Gate A0: Requirement and project memory retrieved. Blind Spot Pass identified invented facts, source conflicts, risky claims, duplicate copies, stale assets, ambiguous imports, historical-review compatibility, accidental Sheet writes and resume invalidation. No unresolved critical pre-build unknown. Assumption: automatic source-based compilation is appropriate for routine copy improvements; it is explicitly identified in Advanced Details and does not claim an external model call or human approval.

Gate A: Implement within the existing browser/Worker architecture. Keep source rows and historical D1/Sheet review data, manifest IDs, IndexedDB stores, 1440 × 1800 rendering and ZIP logic. Add pure automatic production assessment with tests; replace primary review DOM and handlers; persist per-source browser production decisions separately. Verify real Recipe and Selection Guide sources with synthetic fixture images, then lint/build/self-review and deploy privately. v22 remains rollback. Page profile and historical publication operations stay in Advanced Details.

## Decisions and safety boundaries

- Low-risk content needs complete, consistent source material, usable prompts and no held duplicate; a reviewer name, academic URL, WHY explanation and human approval metadata are not image-production requirements.
- The automatic compiler rewrites presentation and derives type-specific outlines, reader value and a practical CTA from source material. It does not invent quantities, duration, temperature, prices, medical facts or missing causal explanations. It preserves the original body and original source separately.
- Medium/high-risk claims show a focused VERIFY CLAIM panel. A checked reference and explicit claim confirmation are tied to the current source stamp. That confirmation is stored as a claim decision, never as historical editorial PASS.
- Strong duplicates remain skipped by default. Manual Produce cannot override a factual gap, unresolved claim or held duplicate.
- Import depends on a valid image specification. Prompt generation depends on the per-item production decision. Build depends on current technically valid images. Download additionally requires current final assets and Looks Good for the current post. Fix or Regenerate cancels final approval; replacement only invalidates dependent assets.
- Existing Sheet and D1 human-review APIs remain compatible. Their old forms and event handlers are removed from the daily UI. Historical values are read-only in Advanced Details; automatic optimisation performs no external writes.
- Production decisions, compiler versions, claim confirmations, download progress and selected content persist in this browser. Source changes reset stale decisions; existing IndexedDB images and assets remain preserved and stale checks continue to apply.
- Quick Production suggests the strongest available non-duplicate Produce item, or resumes imported images. Next Content and the post-download suggestion support continuous work. Batch 01 remains available as a collection; no bulk generation is added.
- The compiler removes a decorative final asset only when all required content coverage and useful copy remain. Required method images and instructional states are retained; recipes typically produce six final pages from the existing nine source images. Reducing those source images would require a different composition specification and is not silently done.

## Verification and deployment

Pending the current test and release run. Real image validation is not asserted by synthetic fixture testing. No Facebook auto-publishing is introduced.

## Local acceptance evidence

`npm test`: 160/160. `npm run lint`, `npm run build`, built Worker syntax and `git diff --check`: PASS. Tests cover low-risk automatic flow without reviewer fields, weak copy improvement, source-backed facts, medium/high-risk claim confirmation, Chinese storage durations, held duplicates, source-current persistence, action progression, download gates, ambiguous import refusal and names containing explicit image sequence identifiers.

Browser fixtures use captured real Sheet rows, not invented source records: Draft 20 `EN-NEW-009` (Recipe) and V4 `GS-V4-SG-002` (Selection Guide). Both pass source → automatic check/optimisation → Produce → master/slot prompt copy → random-order PNG import → reload/resume → build → final preview → Looks Good → ZIP download. Recipe: 9 source images / 6 final PNGs. Selection Guide: 7 source images / 7 final PNGs; all source criteria retained. ZIP readback verifies ordered PNGs, caption.txt and manifest.json with `AI_CHECKED_NOT_HUMAN_APPROVED` provenance. Replacing an image disables download. Batch 01 contains 20 items; duplicates stay hidden by default. Mobile 390 × 844 has no horizontal overflow and uses Original / AI Optimised tabs. Browser console errors: 0. Non-GET browser requests: 0. No Sheet or Facebook mutation.

Snapshot-only recommendation totals: Produce 131 / Improve 30 / Skip 129 (including 100 held duplicates); these are automatic production decisions, not new human editorial approvals. Live source changes may change these counts.

Gate B/C: Implementation, tests, source loading, fixture workflows, mobile review, security regressions and self-review passed. Deployment and exact-build live readback follow below. The local artifacts are in `output/playwright/simplification-local/` and are synthetic media only.
