# Production Console audit — 2026-10-03

## Requirement and protected baseline
Audit and repair the existing Vanilla JS / Worker / Apps Script / IndexedDB production flow; preserve source rows, IDs, statuses and stored assets. No Facebook publication or real Posted-state tests.

Baseline: clean `main`, `8b43a18ca6aa50883dc145251a2993454f84df64`. GitHub remote: ryanthian/image_generation. Sites project: appgprj_6aae8cef935081919aead96f8cd34f7a. Version 20 deployment appgdep_6abbca48bff88191a647ef83516ce6bf verified succeeded. Local checkpoint branch: checkpoint/production-audit-2026-10-03. Work branch: fix/production-console-end-to-end-audit.

## Blind Spot Pass / Gate A0
- B1 Source inventory: dropdown != worksheet inventory; inspect live metadata and each API response. No invented fourth source.
- B2 Invalid rows: Worker strict loop currently rejects entire worksheet; isolate by row and preserve raw/normalized alignment.
- B3 Cache: timestamp-only revision, incomplete semantic invalidation, async content-switch races and unpersisted visual confirmation need coverage.
- B4 Image matching: sequential fallback silently guesses unknown names; reject ambiguity and duplicate destinations.
- B5 Rendering: fixed line slicing loses source information; fit complete text and split overflow.
- B6 Readiness: human evidence and visual review cannot be fabricated by heuristics or fixtures.
- B7 External state: authenticated Sheets/Apps Script/deployment must be checked separately from local tests.
- B8 Safety: no source-data writes during dry runs; no secret material in output or Git.
Requirement and relevant historical memory retrieved; current clean baseline supersedes old dirty-tree warning. No blocking unknown prevents local engineering. Gate A0 passed.

## Implementation plan / Gate A
1. Repair row-isolation and source metadata; audit every accessible record without writing source content.
2. Add testable import, dependency, technical-QC, readiness, text-layout and ZIP primitives.
3. Integrate with existing Paper Dashboard cards/forms, preserve legacy cache, add persistent errors/rejections and explicit next actions.
4. Strengthen prompt detail and factual source fidelity; add heuristic 100-point audit and duplication report, separately from reviewer approval.
5. Run Node regression, lint/build, representative browser dry-runs, reload/replacement/overflow/mobile checks; inspect PNG/ZIP artifacts.
6. Review security/diff, commit, deploy through established Sites workflow only after release checks; verify exact version and live smoke tests.
Rollback: checkpoint branch and existing deployed v20. No schema-destructive migration or IndexedDB deletion planned. Tests map to B1–B8. Gate A passed.

## Baseline verification
125/125 tests passed; npm run lint and npm run build passed.

## Executive summary and acceptance result

The code now isolates malformed rows, reports source identity and actual response counts, matches image uploads without guessing, tracks source-image and renderer revisions, builds 1440 × 1800 ordered assets, and downloads one UTF-8 ZIP. Local browser testing completed the approved V4 selection-guide path through import, build, preview, reload, replacement invalidation, and ZIP inspection. Production readiness is **NOT PRODUCTION READY**: 289 of 290 captured records lack production editorial approval, the two legacy Sheets therefore cannot complete authorized end-to-end dry runs, no real generated-image set has received human visual approval, and the target Page profile is incomplete. Deployment remains on the verified v20 baseline until those release gates can be exercised. A fixture's manual visual checkbox was used only to test gate mechanics; it is not production visual approval.

## Source inventory

The connected workbook `1AVWQTZarym7Q4nhCYrZdARVVJDluWCMol8maPR_aN4s` has **39 tabs** by native Google Sheets metadata. Three are registered production content Sheets; the fourth dropdown choice is a browser-local V4.2 opportunity handoff (currently zero in the test browser), not a Sheet. `V4_STAGING_RECOVERY_20260922` is a staging/recovery tab, not an additional production source. The live API reports the three production Sheets as writable; their target Page profile is incomplete, so publishing is blocked. The local browser preview labels captured data **Snapshot · read-only** and does not write back to Sheets.

| Production source | Sheet ID | Schema | Live rows | Normalized | Contract warnings | Rejected | Generation ready | Editorial PASS | Publish ready |
|---|---:|---|---:|---:|---:|---:|---:|---:|---:|
| Eunice Recipe Draft 20 - 2026-09-19 | 2026091901 | Legacy Recipe, 26 columns | 120 | 120 | 0 | 0 | 0 | 0 | 0 |
| Eunice Recipe Draft 100 - 2026-09-20 | 812541719 | Legacy Recipe, 26 columns | 100 | 100 | 0 | 0 | 0 | 0 | 0 |
| V4_CANARY | 433728120 | V4 universal, 17 columns | 70 | 70 | 0 | 0 | 1 | 1 | 0 |

Total: **290 live rows, 290 normalized, zero rejected in this capture**. The new normalization path rejects individual bad rows with Content_ID, source row, field, reason, and suggested repair; it keeps valid siblings available. The UI now has a persistent rejected-record panel. Counts for selected live Sheets come from `/api/recipes.totalRows`; local handoffs are counted from their browser list. The other live Sheets say “count pending load” until their own response is read. No fourth production Sheet was created or inferred.

## Full content and monetisation-readiness audit

The machine-readable [JSON](../output/content-quality-audit.json) covers every captured record with a 100-point, 14-dimension heuristic for hook, usefulness, saves, shares, uniqueness, clarity, density, visual potential, caption, evidence, repetition, natural language, monetisation fit, and affiliate fit. The grouped [Markdown report](../output/content-quality-audit.md) lists affected Content_IDs and 106 duplicate candidate pairs with KEEP/REWORK/HOLD suggestions. Neither artifact predicts performance, verifies factual claims, establishes copyright, or grants human approval. Existing measured performance was not present in these source responses.

| Source | Heuristic READY (85–100) | NEEDS IMPROVEMENT (70–84) | HOLD (<70 or risk rule) | INVALID |
|---|---:|---:|---:|---:|
| Draft 20 | 0 | 33 | 87 | 0 |
| Draft 100 | 0 | 13 | 87 | 0 |
| V4_CANARY | 3 | 51 | 16 | 0 |
| **All** | **3** | **97** | **190** | **0** |

Only `GS-V4-SG-002` is both heuristic READY and editorial PASS/generation-ready. `GS-V4-KH-001` and `GS-V4-EXP-002` score READY by the heuristic but remain editorial REVIEW and generation-blocked. One V4 record has verified source evidence; 289 need human evidence review. Systemic findings include weak WHAT→WHY→ACTION coverage, absent explicit audience/reader value, unreviewed captions and claims, and reused treatments between the two legacy drafts. Some V4 recipes lack quantities, ingredients, timing, or full method detail. These are source/editorial gaps; generating filler facts would be unsafe. The renderer and prompt compiler were improved at the common level rather than rewriting source rows.

Meta's current official guidance emphasizes original creator content and limits distribution/monetisation for spammy or low-value repetition: [Rewarding Original Creators on Facebook](https://about.fb.com/news/2026/03/rewarding-original-creators-on-facebook/) and [Cracking Down on Spammy Content on Facebook](https://about.fb.com/news/2025/04/cracking-down-on-spammy-content-facebook/). Our internal label is **monetisation readiness**, never guaranteed eligibility. Export and new Posted preparation require heuristic READY plus the separate editorial, technical, and manual visual gates.

## Findings, root causes, and changes

| Area | Before / root cause | After / verification |
|---|---|---|
| Source load | A strict normalization loop could reject an entire worksheet because of one bad row; source options could show stale counts or conflate handoff with Sheet. | Worker returns valid rows and separate rejects with aligned raw rows. Dropdown identifies Sheet, Snapshot, or local handoff; selected counts derive from response. All three live sources load. |
| Prompt generation | Session prompt and filenames gave weak slot-specific handoff guidance. | Master and current-slot prompts specify one image, role, framing, 4:5 safe crop, continuity, source facts, local context where appropriate, negatives, N/R/FIX controls, and expected filename. All 290 source contracts and manifests compile. This is prompt-contract verification, not a claim that ChatGPT images were generated. |
| Image import | Ambiguous names could fall through to sequence assignment; MIME/size alone allowed spoofed or unusable files. | Random-order unique slot names match deterministically. Collisions and unknown names enter an Unmatched panel for explicit assignment. PNG/JPEG/WebP magic bytes, decode, pixel count, ratio, softness/crop warning, size and batch limits are checked. Browser test imported seven randomly ordered synthetic images without guessing. |
| Stale dependencies | Timestamp-only source-image revision and incomplete asset semantic keys could leave a cached PNG looking current. | Per-image revision/hash and renderer/source/plan/text signatures mark dependent assets stale, disable downloads and visual review, and survive reload. Browser replacement of V4 slot `03-inspection-detail` invalidated only its consuming final asset; rebuild restored current state. |
| Final render | Fixed text slicing could clip long Chinese copy and method steps. | Canvas waits for fonts, fits readable text, emits continuation pages when needed, and uses at most two full-width method steps per page. Node tests preserve every character; seven browser-produced PNGs were inspected as 1440 × 1800. Synthetic geometric images do not establish real food realism or semantic accuracy. |
| Download | Multiple downloads and no ordered package. | One ZIP with sequence-prefixed PNGs, exact caption.txt, and manifest.json. The downloaded V4 test ZIP was opened independently: seven ordered 1440 × 1800 PNGs plus two metadata files with valid UTF-8 names. Individual downloads remain available for current assets. |
| Gates and UX | Broad QC language could imply publish readiness from structural validity. Errors could disappear after a toast; empty local handoff could display prior record scores. | Explicit contract, editorial, generation, source-image, technical, final-asset, visual, export, and publishing states; manual visual checklist bound to the session signature; persistent errors and rejected rows; cleared stale scores when no record is selected. The Mark Posted button stayed disabled in preview. Live status writes still require correct Sheet/Content_ID readback. |
| Security and performance | Untrusted uploads, filenames, and large asset sets needed bounds; repeated previews could retain object URLs. | HTML output is escaped, SVG and spoofed signatures rejected, source allow-list remains, ZIP paths sanitized, batch/megapixel limits applied, object URLs revoked, built canvases released, and ZIP blobs streamed for CRC without materializing all PNG bytes. No credentials were added to client code or audit artifacts. |

The original Paper Dashboard 2 Pro reference and `docs/PAPER_DASHBOARD_REFERENCE.md` were checked before adding cards and statuses. At 390 × 844, the local app had no horizontal overflow; browser console reported zero errors. The original template was not modified.

The Worker independently recomputes structural/editorial/generation and internal monetisation readiness before a Posted write, and still checks the workflow, publication URL/date, source allow-list, and Sheet write readback. Source-image, final-asset, and visual-QC flags remain client attestations because the actual image blobs live in browser IndexedDB rather than a server-verifiable asset store. This is a residual trust limitation; the release has not been called production-ready on that basis.

## Tests and representative dry runs

`npm test`: **138/138 pass** (baseline 125/125). `npm run lint`, `npm run build`, and `git diff --check`: pass. New coverage includes invalid-row isolation, legacy and V4 contract/prompt resolution, 3/4/5/6/7 plans, random-order/duplicate import matching, source replacement and semantic staleness, image QC and signatures, Chinese overflow, filename safety, ZIP structure/order, and readiness gates. The source audit script parsed all three captured live responses and generated both content reports.

Browser local preview used read-only snapshots captured from authenticated production API responses. Draft 20 loaded 120/120 and Draft 100 loaded 100/100; their prompt/import/build/export controls correctly remained blocked by missing editorial PASS. V4_CANARY loaded 70/70. For approved `GS-V4-SG-002`, seven synthetic PNG fixtures were imported, built, previewed, reloaded, replaced, rebuilt, manually checked **for gate-mechanics testing only**, and exported as a ZIP. The fixture did not assess realistic generated-image quality. A separate browser-local V4.2 handoff with zero records displayed zero and cleared previous quality results. No source row, Posted status, or Facebook post was changed.

The requested real dry run of one item from **each** production source cannot pass until a human completes factual/source/editorial review of a representative record in each legacy Sheet. Manual review of actual ChatGPT images, Page assignment, production Sheet write/readback, and post-deployment smoke are also pending. Local technical fixtures cannot substitute for those external gates.

## Changed files and release state

Code: `public/app.js`, `public/index.html`, `public/styles.css`, `src/content-model.mjs`, `src/worker.template.mjs`, new `src/production-core.mjs`, new `src/content-quality.mjs`, `scripts/build.mjs`, `scripts/preview.mjs`, new `scripts/audit-production.mjs`, `package.json`. Tests: `test/lib.test.mjs`, new `test/production-safety.test.mjs`. Artifacts: this report and the two content audit reports. Raw authenticated source snapshots remain ignored under `output/audit/` and are not part of the commit.

Gate B (ready to test) and Gate C (code review / tests) pass for the implemented changes; Gate C for **production acceptance** fails on the unresolved human/editorial and real-image dry-run criteria. No new Sites deployment is authorized by the task's stated release sequence until those dry runs pass. Existing production deployment v20, `appgdep_6abbca48bff88191a647ef83516ce6bf`, remains the verified deployed version and rollback baseline. The checkpoint branch and current feature branch preserve the code for review and resumption. Gate D handoff is this report; the decision to withhold release is recorded here.
