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

Gate B/C: implementation reviewed against final-only, activation, stale/dependency safety, ordering, exact-byte output, rollback and no-publication constraints. Tests 251/251, lint PASS, build PASS, git diff --check PASS.

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
