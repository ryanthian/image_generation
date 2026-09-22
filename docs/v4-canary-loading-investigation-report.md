# V4_CANARY Loading Investigation Report

## Summary

The 60 new `V4_CANARY` records are successfully read from Google Sheets by the live Production Console API.

They do not appear in `#recipe` because the first new record fails strict V4 template validation. The frontend attempts to normalize every returned record in one operation; when `GS-V4-EXP-001` fails, the entire `V4_CANARY` source fails to load.

This is not a Google Sheet range, cache, status, deployment, or `Content_ID` issue.

## Root Cause

`GS-V4-EXP-001` has:

```text
Content_Type: LOCAL_DRINK_HACK
Template_Type: DRINK_STANDARD
```

`DRINK_STANDARD` is not registered in the Production Console's V4 Template Registry.

The first error is:

```text
Unknown Template_Type: DRINK_STANDARD
```

Because the frontend loads records using an all-or-nothing normalization pass, this prevents all 70 `V4_CANARY` records—including existing valid records—from appearing in `#recipe`.

## Complete Live Data Flow

```text
Google Sheet: V4_CANARY
  ↓
Apps Script bridge
  ↓
Live Production API: /api/recipes?sheetName=V4_CANARY
  ↓
Frontend normalizer
  ↓
Template/type validation
  ↓
#recipe UI
```

Live verification confirmed:

```text
source: sheet
sheetName: V4_CANARY
writable: true
records returned: 70
unique Content_IDs: 70
```

The Apps Script bridge uses `getDataRange()`, so it reads the full used Sheet range. There is no hard-coded row limit such as 10, 20, 40, or 71.

## First Failing Gate

```text
V4_CANARY Sheet
PASS

Apps Script bridge
PASS

Live Production API
PASS

GS-V4-EXP-001 normalizer
FAIL — Unknown Template_Type: DRINK_STANDARD
```

## Status, ID, and Cache Findings

- `Status = CONTENT_READY` is not filtered out by the console.
- `GS-V4-EXP-*` IDs are not filtered out or rejected.
- The live site is reading the current Sheet dynamically.
- No rebuild, sync, static export, cache clear, or deployment is required for normal Sheet updates.
- The issue is semantic V4 contract validation.

## Working Record vs First New Record

| Field | Working Record | New Record |
|---|---|---|
| Content_ID | `GS-V4-RCP-001` | `GS-V4-EXP-001` |
| Schema_Version | `4` | `4` |
| Status | `Posted` | `CONTENT_READY` |
| Content_Type | `RECIPE` | `LOCAL_DRINK_HACK` |
| Template_Type | `RECIPE_STANDARD` | `DRINK_STANDARD` |
| Validation | PASS | FAIL |
| Asset types | COVER, INGREDIENTS, METHOD, CLOSEUP | COVER, INGREDIENTS, MIX, FINAL |

## Affected Records

All 60 new records are currently invalid against the established V4 contract.

| Records | Failure |
|---|---|
| EXP-001–010, EXP-051–053 | `DRINK_STANDARD` is unknown |
| EXP-011–015, EXP-047–050 | `FINAL` is not allowed by `RECIPE_STANDARD` |
| EXP-016–019, EXP-032–035, EXP-057 | Missing required `GOOD_BAD_COMPARE` |
| EXP-020, EXP-058 | Missing required `STORED_RESULT` |
| EXP-021–026 | Missing required `HOOK_COVER` |
| EXP-027–031, EXP-059–060 | `RECIPE_COLLECTION` incompatible with `COLLECTION_GRID` |
| EXP-036–042 | `CULTURE_LIFESTYLE_GUIDE` incompatible with `COMPARE_CHECKLIST` |
| EXP-043–046 | `HOW_TO_GUIDE` is unknown |
| EXP-054–056 | `COMPARE_GUIDE` incompatible with `COMPARE_CHECKLIST` |

All 60 `Asset_Plan_JSON` values are valid JSON. The issue is not malformed JSON; it is that the generated plans do not match the supported template contract.

## Required Resolution

Do not weaken the Production Console validation.

Use a Sheet-contract migration for records that can map to existing V4 templates:

- Drinks: map to `Content_Type = DRINK` and `Template_Type = RECIPE_STANDARD`, with valid COVER / INGREDIENTS / METHOD / CLOSEUP assets.
- Recipes: replace or remove unsupported `FINAL` assets; use a valid purpose-specific asset such as `TIP` only where appropriate.
- Selection, Storage, Mistake/Fix, Collection, Culture, and Comparison records: convert to an existing compatible `Content_Type`, `Template_Type`, and allowed asset set.

`EXP-043` through `EXP-046` require a separate decision. `HOW_TO_GUIDE` does not currently exist. They should either remain out of `V4_CANARY` until a tested template is approved, or receive a deliberately scoped new template implementation.

## Recommended Next Action

Repair `GS-V4-EXP-001` first as the migration canary:

```text
Content_Type: DRINK
Template_Type: RECIPE_STANDARD
```

Then replace its `Asset_Plan_JSON` with a valid Recipe Standard plan. Once it loads successfully through the live API and `#recipe`, migrate the remaining records in groups using the same strict V4 contract.

## Verification Completed

```text
Live API data retrieval: PASS
Google Sheet range handling: PASS
Status handling: PASS
Content_ID handling: PASS
Duplicate IDs: PASS — 70/70 unique
Asset_Plan_JSON syntax: PASS — 60/60 valid
Existing V4 regression tests: PASS
Tests: 65/65 PASS
Lint: PASS
Build: PASS
Git working tree: CLEAN
Deployment performed: NO
```
