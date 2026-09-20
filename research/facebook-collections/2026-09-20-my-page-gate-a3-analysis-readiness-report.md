# Gate A3 Analysis Readiness Report

Generated: 2026-09-20T14:09:15.784Z

Dataset: My Facebook Page - 200-Post Observed Sample

## Gate Status

- Gate A3 status: PASS
- Dataset type: 200 observed Facebook posts
- Media scope: reel/video-only observed sample
- Latest-200 status: NOT verified as latest 200
- Chronology status: unverified
- Exact publish-date completeness: 0%
- Production D1 touched: no
- Deployment performed: no

## Reconciliation

| Check | Expected | Persisted | Result |
|---|---:|---:|---|
| Canonical posts | 200 | 200 | PASS |
| Unique canonical IDs | 200 | 200 | PASS |
| Duplicate canonical IDs | 0 | 0 | PASS |
| Metric snapshots | 403 | 403 | PASS |
| Raw observations | 403 | 403 | PASS |
| Media references | 200 | 200 | PASS |

## Completeness

- Identity completeness: 100%
- Caption completeness: 99.5%
- Metric completeness: 100%
- Media completeness: 100%
- Exact-date completeness: 0%
- Captions: full 199, collapsed 0, missing 1, failed 0
- Media: reel/video 200, image 0, carousel 0, text 0, unknown 0

## Missing Caption Verification

- External post ID: 1377429970434769
- Discovery order: 159
- Caption capture status: missing
- caption_missing flag: true
- Caption text: NULL

## NULL Preservation

- published_at NULL count: 200/200
- reach_count NULL count: 403/403
- click_count NULL count: 403/403
- No reach/click/impression/demographic values were inferred.

## Provenance

- sample_type: observed_sample
- media_scope: reel_only
- chronology_status: unverified
- source_checkpoint: /Users/ryanthian/Documents/Codex_mac/content-ai-production-console/research/facebook-collections/2026-09-20-my-page-200-observed-canonical-checkpoint.json
- direct verification files: 8

## Supported Analyses

- Caption structure
- Hook/opening patterns
- CTA patterns
- Caption length and distribution
- Topic/content clusters from stored captions
- Repeated content formulas
- Creative concepts
- Observed views
- Observed reactions
- Observed comments
- Observed shares
- Distribution and outlier analysis on available public metrics
- High/low observed performers using available public metrics
- Relationships between available public metrics
- Reel content pattern extraction where supported by stored captions and media references

## Not Currently Supported

- Latest-200 claims
- Recency trends
- Posting-frequency effects
- Engagement-per-day
- Performance velocity based on publish age
- Reach efficiency
- CTR
- Impression-based rates
- Demographic performance
- Image-vs-reel performance comparison
- Carousel-vs-reel comparison
- Chronological trend conclusions

## Gate A3 Safety Boundary

This gate does not score content ideas, rank future post ideas, generate the next 20 posts, declare a winning content formula, change recommendation-engine behavior, perform automated optimization, or deploy recommendation logic.
