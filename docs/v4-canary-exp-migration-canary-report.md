# V4_CANARY EXP Migration — Canary Report

## CANARY

`GS-V4-EXP-001`: PASS

Changed in `V4_CANARY` only:

- `Content_Type`: `DRINK`
- `Template_Type`: `RECIPE_STANDARD`
- `Asset_Plan_JSON`: rebuilt to strict V4 Recipe Standard:
  - COVER
  - INGREDIENTS
  - METHOD with M1 → M2 → M3 chronological inputs
  - CLOSEUP
  - exact listed ingredients only
  - no health claims, unsupported ingredients, generated text, logos, or watermarks

Readback confirmed the Sheet stores valid JSON and the intended contract values.

## Phase 2 Result

| Check | Result |
|---|---|
| Sheet record exists | PASS |
| EXP-001 strict normalization | PASS |
| Template validation | PASS |
| Asset_Plan_JSON | PASS |
| Generation manifest | PASS — 6 inputs: Cover, Ingredients, M1, M2, M3, Closeup |
| Existing V4 records normalize | PASS |
| Production API transport | PASS |
| `#recipe` complete source load | FAIL |

The fresh production Console now progresses past EXP-001 and fails at the next untouched row:

```text
Unknown Template_Type: DRINK_STANDARD
```

That is `GS-V4-EXP-002`.

Per the Phase 2 gate, execution stopped immediately. No EXP-002–EXP-060 record was edited.

## Migration Summary

```text
Total EXP records: 60
Successfully migrated: 1
Manual review: not assessed; Phase 2 gate stopped execution
Held: not assessed; Phase 2 gate stopped execution
Failed migrations: 0
Unprocessed: 59
```

## Current V4_CANARY State

```text
Total records: 70
Strictly valid records: 11
Strictly invalid records: 59
Duplicate Content_IDs: 0
```

## Regression

```text
Tests: 65/65 PASS
Lint: PASS
Build: PASS
Deployment required: NO
Application code changed: NO
```

Git contains only previously requested untracked Markdown reports under `docs/`; no application-code changes were made.

## Required Next Action

Authorize Phase 3 migration-matrix work and grouped repairs, beginning with `GS-V4-EXP-002` through `GS-V4-EXP-010` under the verified `DRINK` + `RECIPE_STANDARD` contract.
