# V4_CANARY EXP Phase 3–4 Migration Matrix

**Status:** Blocked safely before Sheet writes  
**Scope:** `GS-V4-EXP-002` through `GS-V4-EXP-060`  
**Validated canary:** `GS-V4-EXP-001` — PASS

## Decision

No additional EXP record is safe to auto-migrate from the current Sheet data.

The strict V4 Template Registry supplies valid structures, but the remaining rows contain generic placeholder asset plans and generic source bodies. Rebuilding a strict plan would require inventing ingredients, method stages, selection criteria, comparison facts, or cultural guidance. That would violate the source-of-truth and no-invention rules.

## Registry contracts used for classification

| Target template | Compatible content type | Required asset types |
| --- | --- | --- |
| `RECIPE_STANDARD` | `RECIPE`, `DRINK` | `COVER`, `METHOD`, `CLOSEUP` |
| `MISTAKE_BEFORE_AFTER` | `MISTAKE_FIX` | `HOOK_COVER`, `WRONG_METHOD`, `CORRECT_METHOD`, `FINAL_RESULT` |
| `COMPARE_CHECKLIST` | `SELECTION_GUIDE` | `COVER`, `GOOD_BAD_COMPARE`, `CHECKLIST` |
| `STORAGE_SEQUENCE` | `STORAGE_GUIDE` | `HOOK`, `CORRECT_STORAGE`, `STORED_RESULT` |
| `SAVEABLE_GUIDE` | `COMPARISON_GUIDE` and other guide types | `COVER`, `CHECKLIST` |
| `LONGFORM_GUIDE` | `LONGFORM_LIFESTYLE` | `COVER`, `SUMMARY` |

## Matrix

### Drinks — manual source specification required

All have current `LOCAL_DRINK_HACK` + `DRINK_STANDARD`; target `DRINK` + `RECIPE_STANDARD`.
Required plan: `COVER`, exact `INGREDIENTS`, chronological `METHOD` generation inputs, `CLOSEUP`.

| Content ID | Title | Classification | Reason |
| --- | --- | --- | --- |
| GS-V4-EXP-002 | 荔枝酸柑话梅冰饮 | MANUAL_REVIEW | Exact ingredient list and preparation stages absent. |
| GS-V4-EXP-003 | 百香果 Asam Boi Soda | MANUAL_REVIEW | Exact ingredient list and preparation stages absent. |
| GS-V4-EXP-004 | 青苹果话梅气泡饮 | MANUAL_REVIEW | Exact ingredient list and preparation stages absent. |
| GS-V4-EXP-005 | 西瓜酸柑话梅冰饮 | MANUAL_REVIEW | Exact ingredient list and preparation stages absent. |
| GS-V4-EXP-006 | 沙示 Asam Boi Float | MANUAL_REVIEW | Exact ingredient list and preparation stages absent. |
| GS-V4-EXP-007 | 洛神花酸柑话梅冰茶 | MANUAL_REVIEW | Exact ingredient list and preparation stages absent. |
| GS-V4-EXP-008 | 荔枝柠檬红茶 | MANUAL_REVIEW | Exact ingredient list and preparation stages absent. |
| GS-V4-EXP-009 | 菠萝柠檬冰茶 | MANUAL_REVIEW | Exact ingredient list and preparation stages absent. |
| GS-V4-EXP-010 | Kopi C 冰砖牛奶 | MANUAL_REVIEW | Exact ingredient list and preparation stages absent. |
| GS-V4-EXP-051 | 酸柑蜂蜜红茶 | MANUAL_REVIEW | Exact ingredient list and preparation stages absent. |
| GS-V4-EXP-052 | 苹果桂花冰茶 | MANUAL_REVIEW | Exact ingredient list and preparation stages absent. |
| GS-V4-EXP-053 | Milo Kopi 冰饮 | MANUAL_REVIEW | Exact ingredient list and preparation stages absent. |

### Recipes — manual source specification required

Current and target contract: `RECIPE` + `RECIPE_STANDARD`.
Required plan: `COVER`, exact `INGREDIENTS`, chronological `METHOD` generation inputs, `CLOSEUP`.

| Content ID | Title | Classification | Reason |
| --- | --- | --- | --- |
| GS-V4-EXP-011 | 炸鸡店风味薯泥 | MANUAL_REVIEW | Ingredients and supported cooking sequence absent. |
| GS-V4-EXP-012 | Kopitiam Kaya Butter Toast | MANUAL_REVIEW | Ingredients and supported cooking sequence absent. |
| GS-V4-EXP-013 | 夜市杯装牛油玉米 | MANUAL_REVIEW | Ingredients and supported cooking sequence absent. |
| GS-V4-EXP-014 | 炸鸡店风味 Garlic Bread | MANUAL_REVIEW | Ingredients and supported cooking sequence absent. |
| GS-V4-EXP-015 | 海南鸡扒洋葱酱 | MANUAL_REVIEW | Ingredients and supported cooking sequence absent. |
| GS-V4-EXP-047 | 蜜汁叉烧家常版 | MANUAL_REVIEW | Ingredients and supported cooking sequence absent. |
| GS-V4-EXP-048 | 三杯鸡家常版 | MANUAL_REVIEW | Ingredients and supported cooking sequence absent. |
| GS-V4-EXP-049 | 蒜蓉豆豉蒸鸡腿 | MANUAL_REVIEW | Ingredients and supported cooking sequence absent. |
| GS-V4-EXP-050 | 番茄午餐肉炒蛋饭 | MANUAL_REVIEW | Ingredients and supported cooking sequence absent. |

### Selection guides — manual factual criteria required

Current and target contract: `SELECTION_GUIDE` + `COMPARE_CHECKLIST`.
Required plan: `COVER`, `GOOD_BAD_COMPARE`, visible `INSPECTION_DETAIL` assets, `CHECKLIST`.

| Content ID | Title | Classification | Reason |
| --- | --- | --- | --- |
| GS-V4-EXP-016 | 一张图看懂 12 种常见茶饮 | MANUAL_REVIEW | Individual categories and factual comparison criteria absent. |
| GS-V4-EXP-017 | 一张图看懂 12 种鸡蛋熟度 | MANUAL_REVIEW | Individual stages and factual criteria absent. |
| GS-V4-EXP-018 | 生抽、老抽、蚝油、鱼露怎么用 | MANUAL_REVIEW | Usage distinctions and source-backed criteria absent. |
| GS-V4-EXP-019 | 淀粉怎么选：玉米、木薯、马铃薯 | MANUAL_REVIEW | Selection criteria and supported uses absent. |
| GS-V4-EXP-032 | 买鸡蛋先看这4点 | MANUAL_REVIEW | The four inspection criteria are absent. |
| GS-V4-EXP-033 | 买虾别只看颜色 | MANUAL_REVIEW | Visible selection criteria are absent. |
| GS-V4-EXP-034 | 买番茄怎么挑 | MANUAL_REVIEW | Visible selection criteria are absent. |
| GS-V4-EXP-035 | 买榴莲先别只看刺 | MANUAL_REVIEW | Visible selection criteria are absent. |
| GS-V4-EXP-057 | 买芒果怎么挑熟度 | MANUAL_REVIEW | Observable ripeness criteria and usage mapping absent. |

### Storage guides — manual storage instructions required

Current and target contract: `STORAGE_GUIDE` + `STORAGE_SEQUENCE`.
Required plan: `HOOK`, optional `WRONG_METHOD`/`PREPARATION`, `CORRECT_STORAGE`, `STORED_RESULT`.

| Content ID | Title | Classification | Reason |
| --- | --- | --- | --- |
| GS-V4-EXP-020 | 葱、蒜、姜怎么保存更久 | MANUAL_REVIEW | Each ingredient requires distinct, source-backed handling. |
| GS-V4-EXP-058 | 青瓜买回来很快软？ | MANUAL_REVIEW | Exact storage method and failure mechanism absent. |

### Mistake/Fix guides — manual causal sequence required

Current and target contract: `MISTAKE_FIX` + `MISTAKE_BEFORE_AFTER`.
Required plan: `HOOK_COVER`, `WRONG_METHOD`, `CORRECT_METHOD`, optional `CORRECT_SEQUENCE`, `FINAL_RESULT`.

| Content ID | Title | Classification | Reason |
| --- | --- | --- | --- |
| GS-V4-EXP-021 | 为什么蒸蛋每次都有洞？ | MANUAL_REVIEW | Supported cause, correction, and visual sequence absent. |
| GS-V4-EXP-022 | 煎鱼为什么一翻就破皮？ | MANUAL_REVIEW | Supported cause, correction, and visual sequence absent. |
| GS-V4-EXP-023 | 炒饭为什么湿湿黏黏？ | MANUAL_REVIEW | Supported cause, correction, and visual sequence absent. |
| GS-V4-EXP-024 | 炸豆腐为什么一下锅就碎？ | MANUAL_REVIEW | Supported cause, correction, and visual sequence absent. |
| GS-V4-EXP-025 | 鸡胸肉为什么越煎越柴？ | MANUAL_REVIEW | Supported cause, correction, and visual sequence absent. |
| GS-V4-EXP-026 | 煮面为什么汤越来越咸？ | MANUAL_REVIEW | Supported cause, correction, and visual sequence absent. |

### Culture/lifestyle guides — manual claim and source review required

Potential target: `LONGFORM_LIFESTYLE` + `LONGFORM_GUIDE`.
Required plan: `COVER`, source-backed culturally framed sections, optional `CHECKLIST`, `SUMMARY`.

| Content ID | Title | Classification | Reason |
| --- | --- | --- | --- |
| GS-V4-EXP-036 | 戒指戴不同手指，常见象征一次看懂 | MANUAL_REVIEW | Traditional and practical claims need sources and separation. |
| GS-V4-EXP-037 | 项链长度怎么选 | MANUAL_REVIEW | Measurement and fit guidance is not specified. |
| GS-V4-EXP-038 | 手串尺寸怎么量手围 | MANUAL_REVIEW | Measurement method and sizing criteria are not specified. |
| GS-V4-EXP-039 | 金银首饰可以一起戴吗？ | MANUAL_REVIEW | Practical compatibility claims need sourced guidance. |
| GS-V4-EXP-040 | 洗澡时哪些首饰最好先取下 | MANUAL_REVIEW | Material-specific care guidance is not specified. |
| GS-V4-EXP-041 | 水晶左右手佩戴：传统说法 vs 实际佩戴 | MANUAL_REVIEW | Cultural claims must be explicitly separated from practical facts. |
| GS-V4-EXP-042 | 手串颗数常见说法 + 尺寸现实 | MANUAL_REVIEW | Cultural claims and factual sizing data need sources. |

### Comparison guides — manual comparison facts required

Potential target: `COMPARISON_GUIDE` + `SAVEABLE_GUIDE`.
Required plan: `COVER`, factual `COMPARE`/`GUIDE_POINT` assets, `CHECKLIST`, `SUMMARY`.

| Content ID | Title | Classification | Reason |
| --- | --- | --- | --- |
| GS-V4-EXP-054 | 鸡腿 vs 鸡胸，什么煮法更适合？ | MANUAL_REVIEW | Cooking-use differences are not specified. |
| GS-V4-EXP-055 | 柠檬 vs 酸柑，做饮料差在哪里？ | MANUAL_REVIEW | Factual aroma and use differences are not specified. |
| GS-V4-EXP-056 | 美乃滋 vs 沙拉酱，做 coleslaw 怎么选 | MANUAL_REVIEW | Product differences and recipe-use guidance are not specified. |

### Holds — do not force into the active canary

| Content ID | Title | Classification | Missing capability or source material |
| --- | --- | --- | --- |
| GS-V4-EXP-027 | 9款豆腐家常做法 | HOLD | Collection item list, facts, and source-backed plans absent. |
| GS-V4-EXP-028 | 9款鸡腿家常做法 | HOLD | Collection item list, facts, and source-backed plans absent. |
| GS-V4-EXP-029 | 9款包菜家常做法 | HOLD | Collection item list, facts, and source-backed plans absent. |
| GS-V4-EXP-030 | 9款罐头午餐肉做法 | HOLD | Collection item list, facts, and source-backed plans absent. |
| GS-V4-EXP-031 | 9款蒸鸡做法 | HOLD | Collection item list, facts, and source-backed plans absent. |
| GS-V4-EXP-043 | 鞋带总松？3种不容易松的系法 | HOLD | `HOW_TO_GUIDE` is not a registered V4 template. |
| GS-V4-EXP-044 | 保鲜膜总是撕歪？ | HOLD | `HOW_TO_GUIDE` is not a registered V4 template. |
| GS-V4-EXP-045 | 塑料袋打死结怎么快速解 | HOLD | `HOW_TO_GUIDE` is not a registered V4 template. |
| GS-V4-EXP-046 | 冰箱异味先检查这5个地方 | HOLD | `HOW_TO_GUIDE` is not a registered V4 template. |
| GS-V4-EXP-059 | 家里聚会 5 壶简单冰饮 | HOLD | Collection items and individual drink specifications absent. |
| GS-V4-EXP-060 | 6款 Asam Boi 冰饮合集 | HOLD | Collection items and individual drink specifications absent. |

## Current validation state

| Check | Result |
| --- | --- |
| Total EXP records | 60 |
| Successfully migrated | 1 — EXP-001 |
| Strictly valid V4_CANARY records | 11 |
| Strictly invalid V4_CANARY records | 59 |
| Duplicate Content_IDs | 0 |
| First remaining invalid record | GS-V4-EXP-002 |
| Production API / Sheet bridge | PASS |
| Complete V4_CANARY normalization | FAIL |
| `#recipe` complete-source load | FAIL; it falls back to the established 10 records |
| Existing-record regression | PASS |
| Tests | 65/65 PASS |
| Lint | PASS |
| Build | PASS |
| Application-code changes | NO |
| Deployment required | NO |

## Required handling decision

Invalid HOLD rows cannot remain in the active `V4_CANARY` tab: runtime normalization is all-or-nothing and does not filter records by `Status`.

The safe next action is to preserve the HOLD rows in a non-active staging tab (for example, `V4_HOLD`) with their original values intact, then provide source-of-truth specifications for each MANUAL_REVIEW record before strict migration. This requires explicit approval because it changes the Sheet’s active data placement.

