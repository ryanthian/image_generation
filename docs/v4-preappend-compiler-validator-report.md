# V4 Pre-Append Compiler + Validator Report

## Current Append Root Cause

Invalid records were appended directly to `V4_CANARY` without first being compiled against the Production Console’s strict V4 Template Registry. The existing Apps Script bridge only supported listing records and marking status; it had no controlled append path.

## Why Invalid Content Entered `V4_CANARY`

There was no pre-write contract gate. Unsupported combinations could therefore be written into the Sheet despite being non-executable by the Console:

- `LOCAL_DRINK_HACK` + `DRINK_STANDARD`
- `EVERYDAY_HACK` + `HOW_TO_GUIDE`

## Pre-Append Validation Design

```text
Candidate row
→ strict Asset_Plan_JSON parse
→ shared V4 normalizer / Template Registry validation
→ explicit generation-readiness validation
→ source coverage and QC validation
→ authenticated atomic bridge append
```

The append callback is never reached for a rejected candidate. The proposed production endpoint is disabled unless all deployment secrets are configured:

- `V4_APPEND_ENABLED=true`
- `V4_APPEND_GATE_TOKEN`
- `V4_APPEND_API_TOKEN`

The Apps Script bridge also requires the gate token, preserves `Content_ID` as a string, rejects duplicate IDs, writes all 16 columns in one operation, and verifies readback.

## Files Changed

| File | Purpose |
| --- | --- |
| `src/v4-preappend.mjs` | Shared strict compiler and atomic append seam. |
| `test/v4-preappend.test.mjs` | Targeted regression coverage. |
| `src/worker.template.mjs` | Disabled-by-default authenticated append endpoint. |
| `apps-script/Code.gs` | Token-gated append action with schema, duplicate-ID, and readback checks. |
| `scripts/build.mjs` | Bundles compiler dependencies. |
| `package.json` | Includes the compiler in linting. |

## Test Results

| Check | Result |
| --- | --- |
| EXP-001 append test | PASS |
| EXP-002 rejection test | PASS |
| EXP-043 rejection test | PASS |
| Incomplete recipe rejection | PASS |
| Existing recipe | PASS |
| Content_ID opaque-string preservation | PASS |
| Full tests | 71/71 PASS |
| Lint | PASS |
| Build | PASS |
| Disabled append endpoint | PASS — returns `503` until explicitly configured and deployed. |

## ID Corruption Root Cause

**Still under investigation.** Repository and bridge audit found no historic append action, numeric conversion, padding, or `Content_ID` write path; the existing bridge only writes `Status`. Determining the altered live IDs requires Google Sheets version history/activity evidence. No IDs were repaired or changed.

## Sheet Changed

**NO**

## Deployment Required

**YES**

The implementation is local and intentionally not deployed. The current Sheet remains untouched; do not use the new append endpoint until the ID-recovery investigation is approved and deployment secrets are configured.
