# Final image share/save — 2026-10-04

The final export card now offers native multi-file sharing when supported, a separate final Facebook caption button, direct ordered PNG downloads, and secondary ZIP/manifest downloads. The existing production workflow and same-content completion policy remain intact.

## Implementation and release gates

Requirement: export a single completed post on iPad/iPhone and desktop without ZIP extraction. Baseline: clean da6236fa5b5c67fe6bb48a2f70ee16bcdadb240b; deployed Sites v28 code 93332b1bf8e984a521f2decc8c1708b17649d37d.

Gate A0 / Blind Spot Pass: preserve the user's active work, distinguish file sharing from text sharing, preserve transient user activation, never export stale/source media, avoid browser-blocked automatic download bursts, and distinguish browser emulation from physical iOS testing. No critical unknown prevents implementation.

Gate A: reuse the Paper Dashboard card, buttons and expandable options; centralise export in src/final-export.mjs; preserve current final rendering and ZIP architecture. Rollback is the previously deployed v28 or retained v20.

- Final images are collected by manifest sequence, including all continuation pages. Stored object/upload order cannot change export order. Recipes use 01_COVER.png, 02_INGREDIENTS.png, 03_METHOD.png, 04_METHOD.png, 05_FINAL.png; additional pages increment the sequence rather than losing content. Legacy CLOSEUP receives the FINAL filename only in direct export; its source/asset semantics and historical ZIP naming are preserved.
- Collection requires existing Looks Good/export gates, passing final QC, exact asset semantics, current source-image revision, 1440 × 1800 metadata, and nonempty PNG blobs. Image replacement blocks share/save/download and exposes Rebuild. Individual thumbnails have fresh guarded download handlers.
- File objects wrap the original final PNG blobs; no rendering, conversion or compression occurs during share/save. Native navigator.share({files}) runs synchronously from the user-click handler before any await. Capability detection requires navigator.canShare({files}) to return true for the actual files.
- Native share contains files only. Caption copying is separate and copies only the resolved final caption. Sharing/saving never marks a post Published or writes a Sheet field.
- Share cancellation returns normally. Unsupported sharing/errors expose numbered individual downloads and ZIP. Desktop Download All uses a native folder picker where supported, writes original PNG Files in order into a distinct post folder, and rechecks freshness before each write. Other browsers expose the numbered download panel rather than firing a burst of potentially blocked downloads.
- More download options retains ZIP, individual PNGs and manifest. Batch ZIP/partial ZIP remain intact. Share This Post and Copy Caption appear only for the reviewed completed post; native sharing cannot share the whole batch.
- Controls have 48 px touch targets, wrap inside the card and need no horizontal scrolling at phone 390 × 844, iPad portrait 768 × 1024, iPad landscape 1024 × 768 and desktop 1440 × 1000. No other screen is redesigned.

## Verification before deployment

Gate B/C: implementation reviewed against final-only, activation, stale/dependency safety, ordering, exact-byte output, rollback and no-publication constraints. Tests 253/253, lint PASS, build PASS, git diff --check PASS.

- test/final-export.test.mjs: canonical order/names, continuation pages, legacy final naming, exact File bytes, unreviewed/stale/source-changed/plan-changed/missing/QC-failed/invalid-dimension/non-PNG/empty PNG rejection, real capability detection, synchronous sharing, files-only payload, cancellation/error fallback, synchronous folder picker, exact ordered writes, cancellation/error, pending-picker stale checks, stop-on-revision-change, ZIP STORE byte preservation.
- output/playwright/final-export-local/report.json: actual source EN-NEW-003, final production renderer, five ordered 1440 × 1800 PNGs, real browser userActivation.isActive=true at the mocked native call, separate exact caption, individual bytes identical by SHA256, ordered folder save, cancellation/error/no-burst fallback, manifest, single-post ZIP, stale blocking/rebuild, all four responsive sizes, reviewed batch single-post sharing, no app errors and zero non-GET requests.
- output/playwright/final-export-batch-local/report.json: all three sources 120/100/70; 9→5 legacy optimisation with all six steps, original quantities and safety cue retained; shuffled imports, explicit unmatched handling, resume, independent build, two-post partial and five-post complete ZIP, stale isolation, Auto Select 20, phone layout.
- output/playwright/final-export-repair-local/report.json: actual GS-V4-EXP-047 remains selected for completion, no auto-skip, partial/completed draft persistence, changed-source invalidation, retained batch identity/reserves, Auto Select 5/10/20, no new reviewer forms, no source writes.

Browser media fixtures are explicitly synthetic and isolated from the operator's browser. Final PNGs are generated by the actual production renderer. Test Looks Good clicks apply only to fixtures; they do not fabricate approval for the production corpus.

## Device limitation and API references

Physical iPad/iPhone share-sheet destinations and actual Facebook upload have not been exercised by the automation environment. The implementation opens the OS/browser-controlled share sheet where file sharing is supported; it cannot silently write to Photos or prove Facebook publication. Windows/macOS native folder-picker integration is capability-based and tested with browser API fixtures; individual downloads and ZIP are universal fallbacks.

Primary references: [MDN navigator.share](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/share), [Web Share API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Share_API), [HTMLAnchorElement.download](https://developer.mozilla.org/en-US/docs/Web/API/HTMLAnchorElement/download).

## Deployment evidence

Deployment status and exact commit readback are recorded after publication below. Existing owner-private audience and rollback releases are preserved.

## Source-outage preservation found during live QA

Initial live checks hit a transient Google Apps Script second-redirect rejection. A read-only registry refresh recovered all three sources; the strict redirect guard was preserved. Independently fetched arrays returned 120/100/70 and exactly matched the pre-release JSON SHA256 hashes.

This exposed an existing batch reconciliation defect: a temporarily missing row could be treated as incomplete content. Batch reconciliation now retains the complete batch and reserves if a selected/reserve source record is unavailable. Eligible posts can still build/export independently; unavailable posts remain blocked individually. When full source data returns, older pre-production replacements caused by partial reads are recovered only where the original is currently eligible, not already in the batch, and the replacement has no media. Replacement history is retained with a recovery marker; no original source is edited and started media is never displaced. Meaningful regression tests cover partial-source preservation and safe recovery/media protection. The browser export suite also exercises a temporary V4 outage and source recovery on a real five-post batch.

## Final release readback

PLATFORM STATUS: PRODUCTION READY WITH WARNINGS (existing hosting-injected inline challenge CSP warning; no app errors). Final deployment is Sites **v30**, after v29 introduced sharing and v30 added the source-outage batch preservation fix.

DEPLOYED CODE SHA: **1c41262280d677ffd9909bea624a3a3654402c4a**

SAVED VERSION: appgprj_6aae8cef935081919aead96f8cd34f7a~appgver_5520bf225bcc8191806b9098967c49c4

DEPLOYMENT ID: appgdep_6ac218053398819187bbb1c0b21f5f6f

NATIVE STATUS: succeeded; https://content-ai-production-console.ryanthian.chatgpt.site/

ARCHIVE SHA256: b002fee5a655ecfccc62fe53eb68bc046bf820cf48e26ed83a9b44c507b480f8

LIVE /api/build: same exact SHA; builtAt 2026-10-04T09:10:00.088Z. Owner-only audience unchanged. Native version listing retains v28 and v20 rollback archives.

LIVE EXPORT SMOKE: PASS — output/playwright/final-export-v30-live/report.json. All three sources loaded 120/100/70. Final share Files, canonical names/order, 1440 × 1800 PNG headers, real browser click activation, caption-only copying, exact individual/folder bytes, cancellation, unsupported/error fallback, no automatic download burst, manifest and single-post ZIP, stale blocking and rebuild, four responsive sizes, batch Share This Post and a temporary V4 read outage all pass. Batch/reserve JSON remains identical during the simulated outage, then resumes when the source returns. App errors: zero; non-GET browser requests: zero. Hosting challenge CSP warning is isolated; CSP is not weakened.

SOURCE READBACK: output/final-export-live/source-readback.json. Original row arrays unchanged: 2026091901 / 120 / 59afd5567894d8abdd9575521718f1383db119d170bc1782708af37088a4f22d; 812541719 / 100 / 90cfa219646170191b541819ba018bba1b28edbeaf97baa0a6d6aed4862f066c; 433728120 / 70 / ff32fa1dcfe95ede0c487bd346e8fc03202ba4aa39e8d0b2bf5cf120cb72a2b2. No Sheet status/content write or Facebook publication was performed.

OPERATOR READBACK: existing working tab refreshed to v30. GS-V4-EXP-047 remains selected, its completion draft remains empty and no facts have been injected. Batch 01 remains 20 posts with 10 reserves and now 85 image jobs after eligible unstarted posts were recovered from historical partial-source replacements; its active replacement count is 4, with complete historical records retained. No synthetic test media was inserted into the operator browser. This recovery changes the batch selection; it does not imply any human editorial or image approval.

REMAINING DEVICE VALIDATION: real iOS/iPadOS native destinations and physical Windows/macOS save dialogs require device testing. API contracts and real-browser user activation are verified using mocks; the native Photos/Facebook destination is not claimed. Sharing/saving does not prove publication.

LIVE BATCH ZIP REGRESSION: PASS — output/playwright/final-export-v30-batch-live/report.json verifies exact v30 SHA, all source counts, source instruction preservation, bulk/shuffled import and explicit unmatched assignment, resume, independent builds, two-post partial ZIP, complete five-post ZIP, selective stale-post blocking, Auto Select 20 and phone layout. Independent Python zipfile CRC validation passes for the single-post ZIP (5 PNGs), partial two-post ZIP (10 PNGs) and complete five-post ZIP (26 PNGs, including continuation pages).

Gate C: final tests 253/253, lint/build PASS, both live suites PASS, source hashes unchanged, self-review and blind-spot traceability complete. Native OS dialogs remain the explicit unverified device boundary.

Gate D: implementation and source-recovery decisions recorded here and in the production audit. Application code is deployed at the SHA above; a documentation-only evidence commit follows it. GitHub feature branch fix/production-console-end-to-end-audit receives the validated implementation and report. No main merge, new approval workflow, Sheet write or Facebook publication was performed. Rollback: deploy the saved v28 version; v20 also remains available.
