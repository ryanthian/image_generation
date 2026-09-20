---
source_name: My Facebook Page
facebook_id: "100044347487511"
source_role: audience
captured_at_utc: 2026-09-20T08:39:19.891Z
status: verified-canary
method: authenticated in-app Facebook browser; feed DOM extraction followed by direct-post verification
---

# My Page 10-Post Collection Canary

## Scope and audit rule

This is a collection-method canary, not a 200-post analysis. Each record was first captured from the authenticated Facebook feed, then reopened through Facebook's direct photo or post surface. A record passes only when its caption fingerprint and canonical media identity match the direct surface.

`published_at` is intentionally `NULL` for all ten records. Facebook exposed only relative ages on these surfaces (`6h`, `17h`, `5d`, `3w`, `4w`, `9w`), not a reliable absolute publication timestamp. The prior collector's author-comment timestamp must not be substituted.

Metrics below are a direct-post snapshot at collection time. They may differ from the initial feed snapshot because Facebook interactions changed during verification. This is expected and requires append-only metric snapshots in the canonical database.

## Verified records

| External post ID | Relative age | Caption fingerprint | Direct metrics (reaction/comment/share) | Canonical URL |
|---|---|---|---:|---|
| `1608032727351628` | `6h` | `#姜葱香菇鸡腿煲` | 12 / 1 / 5 | [Post](https://www.facebook.com/permalink.php?story_fbid=pfbid0TM2v7upQL81jjdUHa6MCD4obTE8maFgLzUCyfE4iFiGLTCQYxAzuXHRVFNYJWExkl&id=100044347487511) |
| `1607667557388145` | `17h` | `左手还是右手？如何正确的佩戴水晶宝石手串` | 83 / 1 / 76 | [Post](https://www.facebook.com/permalink.php?story_fbid=pfbid06uT1pz49ncKoKMkwpymchhXTKRNQrDR5RK3N9nko1YFySQ5iktWKod951rqva9hml&id=100044347487511) |
| `1603736207781280` | `5d` | `馒头发过头会怎样？一眼看懂发酵状态` | 7 / 2 / 5 | [Post](https://www.facebook.com/permalink.php?story_fbid=pfbid029Hi2zLefftKZa6BP5N82D2AjRcBvQtuHgYUYXv3hMZdXDmqH8NgK1scuau5NVW41l&id=100044347487511) |
| `1585366982951536` | `3w` | `鸡腿煮熟后放凉切片，淋上葱油酱` | 46 / 1 / 56 | [Post](https://www.facebook.com/permalink.php?story_fbid=pfbid02o7xWJLnUUYQQCHA25Ydq8ckAc3zFK2HJUcMJQZc5rvwDPKEJnwEr7vL1iWuiiXBUl&id=100044347487511) |
| `1581422270012674` | `4w` | `芒果打成冰沙` | 9 / 1 / 8 | [Photo post](https://www.facebook.com/photo/?fbid=1581422270012674&set=a.653615272793383) |
| `1581421803346054` | `4w` | `虾、苏东、鱼片、马鲛鱼` | 2 / 1 / 2 | [Post](https://www.facebook.com/permalink.php?story_fbid=pfbid02DEq8gJSjZ6UJBgqXF5ZV8ycYyFmTD8zJhT6v5QFTA5hrem3sKn7sTiaPX7AYbU3Kl&id=100044347487511) |
| `1581420536679514` | `4w` | `虾先煎香，牛油炒咖喱叶和麦片` | 36 / 1 / 29 | [Post](https://www.facebook.com/permalink.php?story_fbid=pfbid0xd9CnRqBPNXKk2t6VdM3Y14ekbVMyxVf914z1G8PnrunxRKXEVXDgmFzGFUk3muql&id=100044347487511) |
| `1554398376048397` | `9w` | `9款便当菜组合` | 111 / 1 / 126 | [Post](https://www.facebook.com/permalink.php?story_fbid=pfbid0ksKoeyDngN3soGwMqZYWoGJCND2pHGxFtxVF8JMymL1vxym2gsrc4zsXdvoZPmVl&id=100044347487511) |
| `1554258859395682` | `9w` | `干捞板面家常版` | 39 / 1 / 29 | [Photo post](https://www.facebook.com/photo/?fbid=1554258859395682&set=a.653615269460050) |
| `1553676272787274` | `9w` | `西瓜冰饮加一点酸柑` | 56 / 1 / 48 | [Photo post](https://www.facebook.com/photo/?fbid=1553676272787274&set=a.653615272793383) |

## Media evidence

All ten records were associated with the expected first media identity on the Facebook direct surface. Carousels exposed multiple photo IDs and Facebook-generated image descriptions. Standalone photo posts did not always expose an image description; those values must remain `NULL`, not inferred.

Examples of verified carousel media:

- `1608032727351628`: 4 media references, including the cover `1608032110685023` and ingredient-card `1608032237351677`.
- `1585366982951536`: 5 media references for the 葱油鸡腿饭 carousel.
- `1581421803346054`: 5 media references for the 巴刹海鲜 guide.
- `1554398376048397`: 5 visible media references, with Facebook reporting 6 additional items in the carousel.

## Limits that the production collector must preserve

- Facebook's displayed feed order is not a reliable chronological order. The canary deliberately does not call these the exact latest ten.
- Store relative age separately as raw evidence; do not treat it as `published_at`.
- Store every metric capture as a new `post_metric_snapshots` record.
- Retain feed raw record JSON separately from the normalized post, including raw media descriptions and any unresolved fields.
- Run a dedicated Reel/video sub-canary before claiming reliable video duration or view extraction.

## Result

Caption fingerprints: 10/10 matched.

Canonical post/media identity: 10/10 matched.

Direct metric snapshot captured: 10/10 for reactions, comments, and shares.

Exact absolute publication timestamp: 0/10 exposed; correctly normalized as `NULL`.

CANARY PASS — READY FOR 200, subject to the collector hardening and Reel/video sub-canary described above.
