export const OPPORTUNITY_ENGINE_VERSION = "v4.2-explainable-opportunity-engine";
export const USER_NEEDS = Object.freeze(["HOW_TO_CHOOSE", "HOW_TO_FIX", "HOW_TO_MAKE", "WHAT_IS_THE_DIFFERENCE", "WHAT_GOES_WITH_WHAT", "QUICK_REFERENCE", "SAVE_FOR_LATER", "BUDGET_SOLUTION", "LOCAL_NOSTALGIA", "BEGINNER_GUIDE", "CARE_GUIDE", "SIZE_GUIDE", "COMPARISON", "COLLECTION_INSPIRATION"]);
export const MECHANISMS = Object.freeze(["DECISION_GUIDE", "REFERENCE_GUIDE", "COLLECTION", "MISTAKE_FIX", "LOCAL_FAMILIARITY", "RECIPE_UTILITY", "COMPARISON_GUIDE", "TECHNIQUE_GUIDE"]);

const level = (value) => ["HIGH", "MEDIUM", "LOW", "NONE"].includes(value) ? value : "LOW";
const text = (value) => String(value || "").trim();
const tokens = (value) => text(value).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").split(/\s+/).filter((item) => item.length > 1);
const safeDivide = (numerator, denominator, multiplier = 1) => Number.isFinite(Number(numerator)) && Number(denominator) > 0 ? Number(numerator) / Number(denominator) * multiplier : null;

export function normalizePerformance(record = {}) {
  const impressions = Number.isFinite(Number(record.impressions)) ? Number(record.impressions) : null;
  return {
    ...record,
    impressions,
    views: Number.isFinite(Number(record.views)) ? Number(record.views) : null,
    save_rate: safeDivide(record.saves, impressions),
    share_rate: safeDivide(record.shares, impressions),
    interaction_rate: safeDivide(record.interactions, impressions),
    reaction_rate: safeDivide(record.reactions, impressions),
    follow_rate: safeDivide(record.net_follows, impressions),
    follow_per_1k: safeDivide(record.net_follows, impressions, 1000),
    revenue_rpm: safeDivide(record.approximate_earnings_usd, impressions, 1000)
  };
}

export function extractFeatures(record = {}) {
  const source = `${record.title || ""} ${record.caption || ""}`.toLowerCase();
  const localWords = ["asam boi", "kopitiam", "ribena", "sarsi", "豆豉", "白饭", "月底", "妈妈煮法", "下午茶", "天气热"];
  const mechanism = record.mechanism || (/别|怎么选|适合谁|看这/.test(source) ? "DECISION_GUIDE" : /为什么|缩水|出水|做错/.test(source) ? "MISTAKE_FIX" : /\d+款|\d+种/.test(source) ? "COLLECTION" : /一张图看懂|有什么不同|区别/.test(source) ? "REFERENCE_GUIDE" : /煮|做法|食谱/.test(source) ? "RECIPE_UTILITY" : "TECHNIQUE_GUIDE");
  const userNeed = record.user_need || (mechanism === "DECISION_GUIDE" ? "HOW_TO_CHOOSE" : mechanism === "MISTAKE_FIX" ? "HOW_TO_FIX" : mechanism === "COLLECTION" ? "COLLECTION_INSPIRATION" : mechanism === "REFERENCE_GUIDE" ? "QUICK_REFERENCE" : "HOW_TO_MAKE");
  return { topic: record.topic || "GENERAL", content_type: record.content_type || mechanism, user_need: userNeed, content_mechanism: mechanism, hook_pattern: record.hook_pattern || userNeed, item_count: Number(record.item_count) || null, local_relevance: record.local_relevance || (localWords.some((word) => source.includes(word)) ? "HIGH" : "LOW"), claim_risk: /水晶|宝石|能量|旺|转运/.test(source) ? "MEDIUM" : "LOW" };
}

export function titleSimilarity(a, b) {
  const left = new Set(tokens(a)); const right = new Set(tokens(b));
  if (!left.size || !right.size) return 0;
  const shared = [...left].filter((item) => right.has(item)).length;
  return shared / new Set([...left, ...right]).size;
}

export function detectSaturation(candidate, historical = [], { recentDays = 90, now = "2026-09-22T00:00:00Z" } = {}) {
  const cutoff = new Date(new Date(now).getTime() - recentDays * 86400000);
  const candidateFeatures = extractFeatures(candidate);
  const related = historical.filter((item) => {
    const features = extractFeatures(item);
    const recent = !item.publish_time || new Date(item.publish_time) >= cutoff;
    return recent && (features.topic === candidateFeatures.topic || features.content_mechanism === candidateFeatures.content_mechanism || titleSimilarity(item.title, candidate.title) >= .45);
  });
  const asamBoi = /asam boi/i.test(candidate.title || "") && historical.filter((item) => /asam boi/i.test(item.title || "")).length >= 4;
  const repeated = related.length;
  const saturation = asamBoi || repeated >= 4 ? "HIGH" : repeated >= 2 ? "MEDIUM" : "LOW";
  const reasons = [];
  if (asamBoi) reasons.push(`${historical.filter((item) => /asam boi/i.test(item.title || "")).length} closely related Asam Boi drink posts appear in the supplied comparison sample.`);
  else if (repeated) reasons.push(`${repeated} related recent post${repeated === 1 ? "" : "s"} share this topic or mechanism in the comparison window.`);
  else reasons.push("No closely related topic or mechanism appears in the recent comparison window.");
  return { saturation, novelty: saturation === "HIGH" ? "LOW" : saturation === "MEDIUM" ? "MEDIUM" : "HIGH", reasons, related_count: repeated };
}

export function routeOpportunity(candidate) {
  const mechanism = extractFeatures(candidate).content_mechanism;
  if (candidate.recommended_template) return candidate.recommended_template;
  if (mechanism === "COLLECTION") return "COLLECTION_GUIDE";
  if (["DECISION_GUIDE", "REFERENCE_GUIDE", "COMPARISON_GUIDE"].includes(mechanism)) return "SAVEABLE_GUIDE";
  if (mechanism === "MISTAKE_FIX") return "MISTAKE_BEFORE_AFTER";
  if (mechanism === "RECIPE_UTILITY") return "RECIPE_STANDARD";
  if (mechanism === "LOCAL_FAMILIARITY") return "SAVEABLE_GUIDE";
  return "KITCHEN_TECHNIQUE";
}

export function buildOpportunity(candidate, historical = []) {
  const features = extractFeatures(candidate); const trend = detectSaturation(candidate, historical);
  const template = routeOpportunity(candidate);
  const evidence = historical.filter((item) => extractFeatures(item).content_mechanism === features.content_mechanism).map(normalizePerformance).slice(0, 3);
  const claimRisk = level(candidate.claim_risk || features.claim_risk);
  const notes = [
    `Uses the transferable ${features.content_mechanism} mechanism, not a claim that this exact topic will repeat historical results.`,
    ...trend.reasons,
    candidate.save_trigger ? `Save use: ${candidate.save_trigger}.` : "No fabricated save trigger.",
    ...evidence.slice(0, 2).map((item) => `Historical analogue: ${item.title} · saves ${item.saves ?? "—"}, shares ${item.shares ?? "—"}, follows ${item.net_follows ?? "—"}.`)
  ];
  return {
    opportunity_id: candidate.opportunity_id || `OPP-${String(candidate.title).replace(/[^a-z0-9]+/gi, "-").slice(0, 36).toUpperCase()}`,
    title: candidate.title, ...features, recommended_template: template,
    save_trigger: candidate.save_trigger || "", share_trigger: candidate.share_trigger || "",
    save_potential: level(candidate.save_potential || (candidate.save_trigger ? "HIGH" : "LOW")),
    share_potential: level(candidate.share_potential || (candidate.share_trigger ? "MEDIUM" : "LOW")),
    local_relevance: level(candidate.local_relevance || features.local_relevance), affiliate_fit: level(candidate.affiliate_fit || "LOW"),
    saturation: trend.saturation, novelty: trend.novelty, claim_risk: claimRisk, visual_potential: level(candidate.visual_potential || "HIGH"),
    evidence_notes: notes, historical_evidence: evidence, approval_status: "PENDING"
  };
}

export const OPPORTUNITY_CANARY_SEEDS = Object.freeze([
  { title: "第一次买手串，珠子大小怎么选？", topic: "JEWELRY_CRYSTAL_CULTURE", user_need: "HOW_TO_CHOOSE", mechanism: "DECISION_GUIDE", save_trigger: "买之前回来确认尺寸", share_trigger: "第一次买手串的人", visual_potential: "HIGH", claim_risk: "LOW" },
  { title: "保温杯容量怎么选？350ml、500ml、750ml分别适合谁？", topic: "DRINKWARE", user_need: "HOW_TO_CHOOSE", mechanism: "DECISION_GUIDE", save_trigger: "下单前回来比较容量", share_trigger: "准备买水瓶的人", affiliate_fit: "HIGH", local_relevance: "MEDIUM" },
  { title: "买西兰花别只看颜色，记住这4点", topic: "VEGETABLE_SELECTION", user_need: "HOW_TO_CHOOSE", mechanism: "DECISION_GUIDE", save_trigger: "下次买菜时可以参考", share_trigger: "家里负责买菜的人", local_relevance: "HIGH" },
  { title: "白虾、明虾、老虎虾有什么区别？", topic: "SEAFOOD_SELECTION", user_need: "WHAT_IS_THE_DIFFERENCE", mechanism: "REFERENCE_GUIDE", save_trigger: "下次买虾时回来比较", share_trigger: "常买海鲜的人", local_relevance: "HIGH" },
  { title: "6款月底家常菜，不知道煮什么就看这张", topic: "BUDGET_HOME_COOKING", user_need: "BUDGET_SOLUTION", mechanism: "COLLECTION", save_trigger: "不知道煮什么时回来选", share_trigger: "下班后还要煮饭的人", local_relevance: "HIGH" },
  { title: "虾仁下锅前为什么要吸干？", topic: "COOKING_TECHNIQUE", user_need: "HOW_TO_FIX", mechanism: "MISTAKE_FIX", save_trigger: "下次炒虾时对照", share_trigger: "经常把虾炒老的人" },
  { title: "Kopitiam常见冰饮有什么不同？", topic: "LOCAL_DRINK", user_need: "WHAT_IS_THE_DIFFERENCE", mechanism: "REFERENCE_GUIDE", save_trigger: "下次点饮料时参考", share_trigger: "第一次去kopitiam的人", local_relevance: "HIGH" },
  { title: "蒸蛋为什么总是有蜂窝？", topic: "COOKING_TECHNIQUE", user_need: "HOW_TO_FIX", mechanism: "MISTAKE_FIX", save_trigger: "蒸蛋前回来检查", share_trigger: "常做家常菜的人" },
  { title: "鸡蛋6种家常搭配，不知道煮什么就选一个", topic: "HOME_COOKING", user_need: "COLLECTION_INSPIRATION", mechanism: "COLLECTION", save_trigger: "不知道煮什么时回来选", share_trigger: "想换菜单的人" },
  { title: "保鲜盒尺寸怎么选？一人份、两人份、备餐分别适合哪种？", topic: "KITCHEN_STORAGE", user_need: "SIZE_GUIDE", mechanism: "DECISION_GUIDE", save_trigger: "下单前比较尺寸", share_trigger: "准备整理厨房的人", affiliate_fit: "HIGH" },
  { title: "天气热想喝酸甜冰饮？先看这3种本地常见搭配", topic: "LOCAL_DRINK", user_need: "LOCAL_NOSTALGIA", mechanism: "LOCAL_FAMILIARITY", save_trigger: "天气热时回来选", share_trigger: "想喝本地冰饮的人", local_relevance: "HIGH" },
  { title: "豆豉蒸排骨怎么做才入味？", topic: "HOME_COOKING", user_need: "HOW_TO_MAKE", mechanism: "RECIPE_UTILITY", save_trigger: "下次蒸排骨时对照", share_trigger: "喜欢家常蒸菜的人", local_relevance: "HIGH" }
]);

export function buildOpportunityCanary(historical) { return OPPORTUNITY_CANARY_SEEDS.map((candidate) => buildOpportunity(candidate, historical)); }

export function approveOpportunity(opportunity) {
  if (!opportunity || opportunity.approval_status === "APPROVED") throw new Error("Opportunity must be pending before approval.");
  const claimPrefix = opportunity.topic === "JEWELRY_CRYSTAL_CULTURE" ? "在一些佩戴文化中，" : "";
  return {
    ...opportunity, approval_status: "APPROVED", approved_at: new Date().toISOString(),
    production_draft: { Schema_Version: 4, Content_ID: `V4-2-${opportunity.opportunity_id}`, Title: opportunity.title, Topic: opportunity.topic, Content_Type: opportunity.recommended_template === "COLLECTION_GUIDE" ? "COLLECTION" : opportunity.recommended_template === "MISTAKE_BEFORE_AFTER" ? "MISTAKE_FIX" : opportunity.recommended_template === "RECIPE_STANDARD" ? "RECIPE" : opportunity.recommended_template === "KITCHEN_TECHNIQUE" ? "KITCHEN_HACK" : "SELECTION_GUIDE", Template_Type: opportunity.recommended_template, Hook_Type: opportunity.hook_pattern, Hook_Text: `${claimPrefix}${opportunity.title}`, Caption: "", Status: "APPROVED_FOR_PRODUCTION", Opportunity_ID: opportunity.opportunity_id }
  };
}
