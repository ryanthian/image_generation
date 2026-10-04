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

Deployment and live acceptance evidence will be added after publishing.
