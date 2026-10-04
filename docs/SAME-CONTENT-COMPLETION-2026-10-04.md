# Same-content completion — 2026-10-04

The user superseded the missing-facts auto-skip policy: keep the selected content, help complete it, and continue production for that content.

## Operating behaviour

- Same-record recovery and automatic presentation improvement still run first. Missing factual detail now produces IMPROVE / COMPLETE_THIS_CONTENT, not automatic SKIP.
- Quick Production, initial queue loading, Generate Images, and Improve Again keep incomplete content selected and open Fix This Content & Continue.
- Existing batch posts that need completion retain Content_ID, position, media namespace and reserve candidates. Other valid posts can continue independently. Auto Select still admits quality-checked complete candidates.
- The completion workspace is a content editor, not an editorial approval/reviewer form. Add only missing facts, or copy the grounded ChatGPT completion prompt, paste the completed body, and use Use Content & Continue.
- No connected text-generation service exists in this Console. Automatic recovery, structuring, captions and plans use the deterministic compiler; actual ChatGPT text completion uses the copy/paste handoff. No claim of autonomous model calls is made.
- Explicit additions persist in the existing browser production session. Their source and raw-input fingerprints must both match. A changed source invalidates old additions. Original Sheet content is retained and no Sheet edits occur.
- Supplied additions are labelled USER PROVIDED, separate from SOURCE FACT, DERIVED and AI COMPLETION. No human editorial/visual approval is conferred.
- Precision facts are not fabricated. A single missing amount can be supplied without rewriting the recipe. Partial drafts remain saved and the same item stays selected until its outstanding essential facts pass.
- Image plans and prompts are prepared only for content passing factual and quality gates. Affected media becomes stale on changes; unchanged records preserve their plans and image identifiers.

## Workflow gates and blind spots

Gate A0: current requirement, relevant memory, clean baseline 4eea399, current architecture and Paper Dashboard reference inspected. Critical blind spots: absent text-generation service, no factual quantities/method in actual GS-V4-EXP-047, stale source selection, source-fingerprint invalidation, batch identity, no implicit approval, and export staleness. No blocking unknown prevents implementing a same-content completion handoff. Default completion asks only for unrecoverable essential facts.

Gate A: smallest central-engine change plus existing-state persistence and compact content editor; no redesign, provider credential, Sheet write, publishing integration or reviewer workflow. Rollback is Sites v27; prior versions including v20 remain retained. Tests identified for missing fact recovery, no fabrication, same Content_ID, partial draft/reload, source changes, batch resume, imports and ZIP.

## Verification before deployment

- npm test: 229/229; npm run lint: PASS; npm run build: PASS.
- Read-only real corpus: 3 sources, 120 / 100 / 70 rows; 290 total; 131 PRODUCE, 49 IMPROVE requiring completion, 110 SKIP for other eligibility/risk/duplicate reasons. Platform readiness is independent of these content states.
- scripts/verify-auto-repair-flow.mjs: same record kept in Quick Production and batch, partial and complete additions persist, changed raw source invalidates additions, source record remains unchanged, Auto Select 5/10/20 works, no app errors or non-GET requests, mobile 390px has no overflow.
- Actual GS-V4-EXP-047: genuinely lacks ingredient quantities/method. Its legitimate state is KEPT FOR COMPLETION. Isolated-browser supplied test additions demonstrated same-ID PRODUCE and six image jobs, not a real verified recipe or actual AI completion. Nothing was injected into the operator session.
- scripts/verify-batch-flow.mjs: legacy 9→5 image optimisation; all six method steps and explicit quantities render; bulk imports, explicit unmatched handling, resume, independent build, partial two-post ZIP and full five-post ZIP, isolated stale post blocking. ZIP readback: 10 / 26 PNGs, all 1440×1800, intact archives. Synthetic images only; real-image approval is not claimed.
- Browser proof: output/playwright/same-content-local/report.json and output/playwright/same-content-batch-local/report.json.

## Deployment evidence

Pending the final same-content UI run and native deployment. Append exact version, deployment ID, code SHA and live readback after success.
