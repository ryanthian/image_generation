# Production UX cleanup — 2026-10-04

Focused requirement: preserve Content → AI Optimise → Images → Final → Download → Next Good Content; remove obsolete editorial transitions, operator notes, manual publication/performance entry and engineering diagnostics from production.

Gate A0: requirement, project memory and clean v30 baseline verified. Blind spots: removed DOM dependencies; saved media hydration; truthful progress; stale assets; publication safety; legacy source and batch resume; iPad scroll/tap behavior. No unresolved critical pre-build unknowns. Counts describe browser-saved production, not fabricated daily totals or Facebook publication.

Gate A: adapt the existing Quick Production card using Paper Dashboard numbers/card-category patterns; remove obsolete DOM and handlers; retain source/content compiler, D1 performance storage, backend publishing checks and API schemas. Test saved-state counts and actual browser workflow; keep private audience and v30 rollback.

## Implemented

- Removed editorial workflow transitions, operator/note fields, manual publication and performance forms, empty analytics summaries, Mark Posted UI and all their browser write handlers.
- Removed platform status and technical publishing diagnostics from the production screen. No replacement debugging panel or reviewer form.
- Kept performance/publication data models, historical API/storage and server-side security gates unchanged. Existing publication records still exclude published content from production selection.
- Compact progress: In progress, Ready for images, Images ready and Ready to post. Counts are derived from actual hydrated source assessments and saved current media. Current content and screened next content have Continue / Next Good Content / Batch Production actions.
- Ready to post requires current source images, current QC-passing rendered assets and Looks Good. Stale or pending repair assets cannot be counted ready. Sharing and exporting do not imply publication.
- Hydration disables Continue/Next until saved images and content state are restored. Same-content completion and existing production state remain intact.
- Final share/save and caption remain primary; ordered PNG, individual download, manifest and ZIP remain available.

## Verification (local)

259/259 tests; lint/build and diff check PASS. Six meaningful progress cases cover empty state, partial images, awaiting review, fresh reviewed assets, stale assets, duplicate/published exclusion, unverified content and downloaded-versus-published state.

Browser QA uses actual source records from all three Sheets (120/100/70), synthetic source-image fixtures and the application's real 1440 × 1800 final renderer. Native OS sharing and folder saving are mocked with actual browser user activation; physical iPad Share Sheet behavior is not claimed.

Same-content completion: actual GS-V4-EXP-047 retained; draft/reload and continuation tested with explicitly synthetic factual additions in an isolated test browser, never operator content or Sheet writes.

Batch: legacy 9 → 5 reduction retains all six steps/quantities; explicit unmatched mapping; independent builds; two-post partial ZIP; five-post ZIP; reload/resume; stale single-post isolation; Auto Select 20. No browser non-GET requests or application console errors.

## Deployed release and live acceptance

- Sites version: **v32**, native deployment status **succeeded**.
- Deployed code: `e005b3e5f256cb27398793ab65dcd30ddb4be9d2`.
- Version ID: `appgprj_6aae8cef935081919aead96f8cd34f7a~appgver_77bb38b7d284819182769632150ece48`.
- Deployment ID: `appgdep_6ac221619db881919c65348dc9ac8158`.
- Archive SHA-256: `5ac621348ddfe7a27f71975ae1a48940364872c1838a0ecc9d43830e978f1601`.
- Live `/api/build` readback: matching deployed commit, built `2026-10-04T09:49:31.275Z`.
- URL: https://content-ai-production-console.ryanthian.chatgpt.site/
- Existing owner-private audience preserved. v30 remains available for rollback.

Final exact-build live smoke: `output/playwright/ux-cleanup-v32-live/report.json`, PASS. Three live Sheets retain 120 / 100 / 70 records. Content → AI Optimise → Images → Final → Looks Good → share/save/copy caption → ZIP → Next Good Content works. Both next buttons land on valid Produce records (EN-NEW-005 and EN-NEW-004), never a loading placeholder.

Progress transitions: empty state → imported images → built final → Looks Good → stale input/rebuild → resume/next. Counts update from real stored state. Synthetic test context finishes with 4 in progress, 122 ready for images, 6 images-ready posts, 2 ready-to-post posts; these are QA state, not the operator's production totals.

Operator tab readback: original selected GS-V4-EXP-047, unchanged completion draft and identical batch record sequence. Existing Batch 01 remains **20 posts / 85 image jobs**, no synthetic QA assets in operator state. Actual operator progress: 0 in progress, 128 ready for images, 0 images ready, 0 ready to post. Missing facts are still handled by the existing same-content completion path; no facts or human approval fabricated.

Extended live batch/completion regressions: `output/playwright/ux-cleanup-batch-v31-live/report.json` and `output/playwright/ux-cleanup-completion-v31-live/report.json`, PASS on the same application JavaScript. v32 differs from v31 only in one responsive CSS rule; the entire production/export/progress/next/batch-share smoke was repeated on v32. Batch partial ZIP: 10 PNGs; full five-post ZIP: 26 PNGs, preserving continuation pages. Single post: 5 final PNGs. All ZIP CRC checks pass.

Responsive checks: 390 × 844 phone, 768 × 1024 iPad portrait, 1024 × 768 landscape, 1440 × 1000 desktop and actual narrow operator view. No horizontal overflow; primary and export buttons remain 48px. Narrow progress actions use two rows to reduce scrolling. Screenshots in `output/playwright/ux-cleanup-v32-live/`; `operator-progress.png` is the actual user's saved state.

Final checks: **259/259 tests**, lint PASS, build PASS, built Worker syntax PASS, diff check PASS. Zero application console errors and zero browser non-GET requests in live regressions. Existing host-injected Cloudflare challenge inline-script CSP messages are recorded separately; application CSP was not weakened.

Gate C: acceptance and blind spots verified. Removed DOM dependencies have no startup errors; current assets/QC/Looks Good stay enforced; published/duplicate content excluded; batch/source-outage preservation and repair/resume pass. No underlying analytics storage/migration/API changes, Sheet status writes or Facebook publication.

Gate D: this release report records decisions, deployment, rollback, device limitations and evidence paths. No unresolved engineering blocker. Physical iPad Safari/native OS destinations remain untested; browser viewport/API testing is explicitly labelled. Useful performance ingestion and publishing models are preserved for later API/import analytics; no analytics engine built in this cleanup.
