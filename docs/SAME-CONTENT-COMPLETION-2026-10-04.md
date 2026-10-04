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

PLATFORM STATUS: PRODUCTION READY WITH WARNINGS. Engineering and requested production paths pass; hosting continues to inject a Cloudflare inline challenge blocked by the existing script-src self policy. This is a pre-existing non-blocking hosting warning, not an app error; CSP was not weakened.

DEPLOYED VERSION: Sites v28

DEPLOYMENT CODE SHA: 93332b1bf8e984a521f2decc8c1708b17649d37d

SAVED VERSION: appgprj_6aae8cef935081919aead96f8cd34f7a~appgver_17869b88ebe081918a689080a500d77c

DEPLOYMENT ID: appgdep_6ac1d5af50888191a2a42fdfec578edc

STATUS: succeeded; https://content-ai-production-console.ryanthian.chatgpt.site/

LIVE /api/build: exact deployed code SHA above; builtAt 2026-10-04T04:26:48.862Z. Native saved-version readback confirms v28 and archive SHA256 9fa0b8ca1d647d6b127e7e2b4efc23726c3eafcdc27b0826ac456124d1eb7219. Owner and audience preserved. Native version listing confirms v27 and v20 remain available for rollback.

LIVE SMOKE: PASS. output/playwright/same-content-live/report.json and output/playwright/same-content-batch-live/report.json independently read back the exact SHA and all source counts. Same-content completion, partial draft persistence, complete draft persistence, raw-source invalidation, retained batch ID/ordinal/reserve, batch resume, Auto Select 5/10/20, no reviewer forms, no app errors, and mobile overflow checks passed. The complete image/import/build/partial-ZIP/full-ZIP/stale regression passed on v28. Non-GET requests: zero in both isolated test contexts.

POST-DEPLOYMENT SOURCE READBACK: fresh output/same-content-live/source-*.json; all 290 original records have identical pre/post array hashes:

- 2026091901: 120; 59afd5567894d8abdd9575521718f1383db119d170bc1782708af37088a4f22d
- 812541719: 100; 90cfa219646170191b541819ba018bba1b28edbeaf97baa0a6d6aed4862f066c
- 433728120: 70; ff32fa1dcfe95ede0c487bd346e8fc03202ba4aa39e8d0b2bf5cf120cb72a2b2

Fresh real-corpus compiler replay passes with 131 PRODUCE, 49 IMPROVE / same-content completion, and 110 independently ineligible/held records. No approved-content count was fabricated.

OPERATOR STATE: existing Batch 01 remains 20 posts / 89 image jobs / 10 reserves / 8 historical replacements, all 20 plans valid. No new missing-content replacement occurred. The operator's current tab is left on GS-V4-EXP-047, Fix This Content & Continue, with an empty completion draft and Mark Posted blocked. Its genuine recipe facts have not been invented or injected. Old media and batch state are retained.

Gate C: tests 229/229, lint/build PASS, live acceptance PASS, diff/self-review complete, blind-spot cases covered by meaningful unit and real browser tests. A stale cached source selection found during browser QA was fixed by using the freshly loaded queue record.

Gate D: report and audit decision recorded; production code pushed to the existing GitHub feature branch fix/production-console-end-to-end-audit. Documentation-only evidence commits may follow the deployed code SHA; no new app changes, main merge, PR, Sheet write or Facebook publication occurred.

REMAINING HUMAN/CONTENT INPUT: genuinely unavailable essential recipe facts (actual GS-V4-EXP-047 has no quantities or ordered method); ChatGPT draft completion uses an explicit copy/paste handoff because no text model service is connected. Real generated images and final visual review remain per-content steps. These are not platform deployment blockers.
