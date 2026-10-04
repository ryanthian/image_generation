import {classifyClaimRisk} from './editorial-pipeline.mjs';

const DEFAULT_VISUAL_PROFILE = "REALISTIC_MALAYSIAN_KITCHEN";
const DEFAULT_TYPOGRAPHY = "PAPER_FACEBOOK_CN";

const asset = (assetType, title, purpose, layoutType, overlayText = "") => ({
  asset_type: assetType,
  title,
  purpose,
  layout_type: layoutType,
  overlay_text: overlayText,
  typography_profile: DEFAULT_TYPOGRAPHY,
  aspect_ratio: "4:5",
  required: true,
  qc_rules: ["IMAGE_PRESENT", "OUTPUT_1440X1800", "NO_VISIBLE_CONTENT_ID"]
});

export const TEMPLATE_REGISTRY = Object.freeze({
  RECIPE_STANDARD: {
    compatible_content_types: ["RECIPE", "DRINK"],
    min_assets: 3,
    recommended_max_assets: 6,
    allowed_asset_types: ["COVER", "INGREDIENTS", "METHOD", "CLOSEUP", "TIP"],
    required_asset_types: ["COVER", "METHOD", "CLOSEUP"],
    visual_consistency_rules: ["Same dish identity, cookware, lighting and ingredient state across assets"],
    default_asset_plan: [
      asset("COVER", "Cover", "Introduce the finished result", "cover_overlay"),
      asset("INGREDIENTS", "Ingredients", "Show the exact ingredients", "information_card"),
      asset("METHOD", "Method", "Teach the cooking sequence", "method_grid_2x3"),
      asset("CLOSEUP", "Closeup", "Show final texture and doneness", "detail_overlay")
    ]
  },
  DRINK_STANDARD: {
    compatible_content_types: ["DRINK", "LOCAL_DRINK_HACK"],
    min_assets: 4,
    recommended_max_assets: 6,
    allowed_asset_types: ["COVER", "INGREDIENTS", "MIX", "FINAL", "TIP", "DETAIL"],
    required_asset_types: ["COVER", "INGREDIENTS", "MIX", "FINAL"],
    visual_consistency_rules: ["Keep the same drink identity, glassware, ingredients, lighting and preparation state across assets"],
    default_asset_plan: [
      asset("COVER", "Cover", "Introduce the finished drink", "cover_overlay"),
      asset("INGREDIENTS", "Ingredients", "Show the exact drink ingredients", "information_card"),
      asset("MIX", "Mix", "Show the drink preparation action", "information_card"),
      asset("FINAL", "Final", "Show the completed drink and payoff", "detail_overlay")
    ]
  },
  MISTAKE_BEFORE_AFTER: {
    compatible_content_types: ["MISTAKE_FIX"],
    min_assets: 3,
    recommended_max_assets: 7,
    allowed_asset_types: ["HOOK_COVER", "WRONG_METHOD", "CORRECT_METHOD", "CORRECT_SEQUENCE", "FINAL_RESULT", "DETAIL"],
    required_asset_types: ["HOOK_COVER", "WRONG_METHOD", "CORRECT_METHOD", "FINAL_RESULT"],
    visual_consistency_rules: ["Wrong and correct examples must be visibly distinguishable under the same camera setup"],
    default_asset_plan: [
      asset("HOOK_COVER", "Hook", "State the practical problem", "cover_overlay"),
      asset("WRONG_METHOD", "Wrong method", "Show the mistake clearly", "information_card"),
      asset("CORRECT_METHOD", "Correct method", "Show the correction clearly", "information_card"),
      asset("CORRECT_SEQUENCE", "Correct sequence", "Teach the correct order", "information_card"),
      asset("FINAL_RESULT", "Final result", "Show the improved result", "detail_overlay")
    ]
  },
  COMPARE_CHECKLIST: {
    compatible_content_types: ["SELECTION_GUIDE"],
    min_assets: 4,
    recommended_max_assets: 8,
    allowed_asset_types: ["COVER", "GOOD_BAD_COMPARE", "INSPECTION_DETAIL", "CHECKLIST", "CLOSEUP"],
    required_asset_types: ["COVER", "GOOD_BAD_COMPARE", "CHECKLIST"],
    visual_consistency_rules: ["Every image must teach a visible selection criterion; good and bad examples must be distinguishable"],
    default_asset_plan: [
      asset("COVER", "Cover", "Introduce what the reader will learn to choose", "cover_overlay"),
      asset("GOOD_BAD_COMPARE", "Good vs bad", "Compare good and poor examples", "information_card"),
      asset("INSPECTION_DETAIL", "Inspection detail A", "Teach the first inspection cue", "information_card"),
      asset("INSPECTION_DETAIL", "Inspection detail B", "Teach the second inspection cue", "information_card"),
      asset("CHECKLIST", "Checklist", "Summarise the selection checklist", "information_card"),
      asset("CLOSEUP", "Closeup", "Reinforce the best example", "detail_overlay")
    ]
  },
  STORAGE_SEQUENCE: {
    compatible_content_types: ["STORAGE_GUIDE"],
    min_assets: 3,
    recommended_max_assets: 7,
    allowed_asset_types: ["HOOK", "WRONG_METHOD", "PREPARATION", "CORRECT_STORAGE", "STORED_RESULT", "DETAIL"],
    required_asset_types: ["HOOK", "CORRECT_STORAGE", "STORED_RESULT"],
    visual_consistency_rules: ["Use one continuous batch of food and the same storage environment"],
    default_asset_plan: [
      asset("HOOK", "Hook", "Show the storage problem", "cover_overlay"),
      asset("WRONG_METHOD", "Wrong storage", "Show what causes early spoilage", "information_card"),
      asset("PREPARATION", "Preparation", "Show preparation before storage", "information_card"),
      asset("CORRECT_STORAGE", "Correct storage", "Show the correct container and placement", "information_card"),
      asset("STORED_RESULT", "Stored result", "Show the expected practical result", "detail_overlay")
    ]
  },
  KITCHEN_TECHNIQUE: {
    compatible_content_types: ["KITCHEN_HACK"],
    min_assets: 3,
    recommended_max_assets: 8,
    allowed_asset_types: ["HOOK", "PROBLEM", "TECHNIQUE", "SEQUENCE", "DETAIL", "CHECKPOINT", "FINAL_RESULT"],
    required_asset_types: ["HOOK", "TECHNIQUE", "FINAL_RESULT"],
    visual_consistency_rules: ["Keep the same cookware, ingredient batch and chronological state"],
    default_asset_plan: [
      asset("HOOK", "Hook", "Introduce the kitchen problem", "cover_overlay"),
      asset("PROBLEM", "Problem", "Show the failure state", "information_card"),
      asset("TECHNIQUE", "Technique", "Demonstrate the key technique", "information_card"),
      asset("SEQUENCE", "Sequence", "Show the correct order", "information_card"),
      asset("FINAL_RESULT", "Final result", "Show the finished improvement", "detail_overlay")
    ]
  },
  SAVEABLE_GUIDE: {
    compatible_content_types: ["SELECTION_GUIDE", "REFERENCE_GUIDE", "COMPARISON_GUIDE", "PRODUCT_GUIDE"],
    min_assets: 3,
    recommended_max_assets: 6,
    allowed_asset_types: ["COVER", "GUIDE_POINT", "COMPARE", "CHECKLIST", "SUMMARY"],
    required_asset_types: ["COVER", "CHECKLIST"],
    visual_consistency_rules: ["Use realistic photography with concise mobile-readable guidance; do not present cultural beliefs as facts"],
    default_asset_plan: [
      asset("COVER", "Cover", "Introduce the practical question", "cover_overlay"),
      asset("GUIDE_POINT", "Guide point", "Explain a visible decision point", "information_card"),
      asset("GUIDE_POINT", "Guide point", "Explain another visible decision point", "information_card"),
      asset("CHECKLIST", "Quick reference", "Provide a saveable recap", "information_card")
    ]
  },
  COLLECTION_GUIDE: {
    compatible_content_types: ["COLLECTION"],
    min_assets: 3,
    recommended_max_assets: 8,
    allowed_asset_types: ["COVER", "COLLECTION_GROUP", "COLLECTION_ITEM", "SUMMARY", "SAVE_CARD"],
    required_asset_types: ["COVER", "SUMMARY"],
    visual_consistency_rules: ["Collection items must be factually distinct and retain a coherent visual hierarchy"],
    default_asset_plan: [
      asset("COVER", "Cover", "Introduce the collection", "cover_overlay"),
      asset("COLLECTION_GROUP", "Collection", "Show a practical group", "information_card"),
      asset("SUMMARY", "Quick reference", "Summarise the collection", "information_card")
    ]
  },
  COLLECTION_GRID: {
    compatible_content_types: ["COLLECTION"],
    min_assets: 3,
    recommended_max_assets: 10,
    allowed_asset_types: ["COVER", "GROUP", "SUMMARY", "SAVE_CARD"],
    required_asset_types: ["COVER", "SUMMARY"],
    visual_consistency_rules: ["Maintain a coherent collection palette and labelling hierarchy"],
    default_asset_plan: [asset("COVER", "Cover", "Introduce the collection", "cover_overlay"), asset("SUMMARY", "Summary", "Summarise the collection", "information_card")]
  },
  LONGFORM_GUIDE: {
    compatible_content_types: ["LONGFORM_LIFESTYLE"],
    min_assets: 3,
    recommended_max_assets: 8,
    allowed_asset_types: ["COVER", "SECTION", "CHECKLIST", "SUMMARY"],
    required_asset_types: ["COVER", "SUMMARY"],
    visual_consistency_rules: ["Belief content must be framed as tradition, custom or personal sharing rather than scientific fact"],
    default_asset_plan: [asset("COVER", "Cover", "Introduce the guide", "cover_overlay"), asset("SECTION", "Guide section", "Explain one useful point", "information_card"), asset("SUMMARY", "Summary", "Summarise the guide", "information_card")]
  }
});

const clone = (value) => JSON.parse(JSON.stringify(value));
const safeId = (value = "") => String(value).trim().replace(/[^a-zA-Z0-9_-]+/g, "-");

export function parseLegacyOverlay(record) {
  const overlay = record.Exact_Chinese_Overlay || "";
  return {
    cover: overlay.match(/图1：([^\n]+)/)?.[1]?.trim() || record.Draft_Title || "",
    ingredients: overlay.match(/图2：食材准备\s*\n([\s\S]*?)\n图3：做法步骤/)?.[1]?.trim() || extractIngredients(record.Full_Recipe),
    closeup: overlay.match(/图4：([^\n]+)/)?.[1]?.trim() || ""
  };
}

export function extractIngredients(fullRecipe = "") {
  return fullRecipe.match(/(?:^|\n)食材\s*\n([\s\S]*?)(?:\n\n做法|\n做法)/)?.[1]?.trim() || "";
}

function parseLegacyIngredientItems(ingredients = "") {
  return String(ingredients).split(/[;；、,，|｜\n]/).map((value) => value.trim().replace(/[。.]$/, "")).filter(Boolean).map((value) => {
    const match = value.match(/^(.+?)\s*(\d+(?:\.\d+)?\s*(?:g|kg|ml|l|克|千克|毫升|升|斤|两|勺|茶匙|汤匙|瓣|根|片|碗|杯|颗|个|只|条))$/i);
    const leadingQuantity = value.match(/^(\d+(?:\.\d+)?\s*(?:g|kg|ml|l|克|千克|毫升|升|斤|两|勺|茶匙|汤匙|瓣|根|片|碗|杯|颗|个|只|条))\s*(.+)$/i);
    return match ? { name: match[1].trim(), quantity: match[2].trim() }
      : leadingQuantity ? { name: leadingQuantity[2].trim(), quantity: leadingQuantity[1].trim() }
        : { name: value, quantity: "" };
  });
}

export function legacyMethodVisual(methodPrompt = "", index) {
  const pattern = new RegExp(`Panel ${index}[^:]*:\\s*([\\s\\S]*?)(?=\\nPanel ${index + 1}[^:]*:|\\nMaintain exact|$)`, "i");
  return methodPrompt.match(pattern)?.[1]?.trim() || `Create only the photograph for cooking step ${index}; follow the exact supplied step caption.`;
}

function applyClaimSafety(record) {
  let hookText = String(record.hook_text || record.Hook_Text || record.title || record.Draft_Title || "").trim();
  const claimEvidence = String(record.claim_evidence || record.Claim_Evidence || "").trim();
  if (!claimEvidence) hookText = hookText.replace(/\b\d+(?:\.\d+)?%\s*的人/g, "很多人");
  const priceVerified = record.price_verified === true || String(record.Price_Verified || "").toUpperCase() === "TRUE";
  if (!priceVerified && /RM\s*\d+[\s\S]*RM\s*\d+/i.test(hookText)) hookText = "外面吃不便宜，自己做其实简单很多";
  return { hookText, priceVerified };
}

function withGenerationInputs(assetItem, index, visualProfile) {
  const result = clone(assetItem);
  result.sequence = Number(result.sequence || index + 1);
  result.asset_id = safeId(result.asset_id || `${result.asset_type}-${result.sequence}`).toLowerCase();
  result.visual_profile = result.visual_profile || visualProfile;
  result.typography_profile = result.typography_profile || DEFAULT_TYPOGRAPHY;
  result.aspect_ratio = result.aspect_ratio || "4:5";
  result.required = result.required !== false;
  result.qc_rules = Array.isArray(result.qc_rules) ? result.qc_rules : ["IMAGE_PRESENT", "OUTPUT_1440X1800", "NO_VISIBLE_CONTENT_ID"];
  const inputs = Array.isArray(result.generation_inputs)
    ? result.generation_inputs
    : Array.isArray(result.source_input_ids)
      ? []
      : [{ slot_id: result.asset_id, label: result.title || result.asset_type, image_prompt: result.image_prompt || "" }];
  result.generation_inputs = inputs.map((input, inputIndex) => ({
    slot_id: safeId(input.slot_id || `${result.asset_id}-${inputIndex + 1}`).toLowerCase(),
    label: input.label || `${result.title || result.asset_type} ${inputIndex + 1}`,
    image_prompt: input.image_prompt || result.image_prompt || "",
    overlay_text: input.overlay_text || "",
    source_role: input.source_role || result.asset_type,
    method_step_id: input.method_step_id || "",
    step_heading: input.step_heading || String(input.overlay_text || "").split(/\n/)[0] || "",
    step_supporting_text: input.step_supporting_text || String(input.overlay_text || "").split(/\n/).slice(1).join(" ") || "",
    regen_required_reason: input.regen_required_reason || "",
    required: input.required === undefined ? result.required : input.required !== false
  }));
  return result;
}

function validateMethodMappings(plan) {
  for (const item of plan.filter((assetItem) => assetItem.asset_type === "METHOD" && assetItem.generation_inputs.length > 1)) {
    const ids = item.generation_inputs.map((input, index) => input.method_step_id || (/^m\d+$/i.test(input.slot_id) ? input.slot_id.toUpperCase() : `M${index + 1}`));
    if (new Set(ids).size !== ids.length) throw new Error(`Duplicate Method step mapping in ${item.asset_id}.`);
    const expected = ids.map((_, index) => `M${index + 1}`);
    if (ids.some((id, index) => String(id).toUpperCase() !== expected[index])) throw new Error(`Missing or reordered Method step mapping in ${item.asset_id}; expected ${expected.join(" → ")}.`);
  }
}

export function resolveAssetPlan(record, registry = TEMPLATE_REGISTRY) {
  const definition = registry[record.templateType];
  if (!Object.hasOwn(registry, record.templateType)) throw new Error(`Unknown Template_Type: ${record.templateType}`);
  if (!definition.compatible_content_types.includes(record.contentType)) throw new Error(`${record.templateType} is not compatible with ${record.contentType}`);
  const requested = Array.isArray(record.assetOverrides) && record.assetOverrides.length ? record.assetOverrides : definition.default_asset_plan;
  const plan = requested.map((item, index) => withGenerationInputs(item, index, record.visualProfile));
  if (plan.length < definition.min_assets) throw new Error(`${record.templateType} requires at least ${definition.min_assets} assets.`);
  const types = new Set(plan.map((item) => item.asset_type));
  const missing = definition.required_asset_types.filter((type) => !types.has(type));
  if (missing.length) throw new Error(`${record.templateType} is missing required assets: ${missing.join(", ")}`);
  for (const item of plan) {
    if (!definition.allowed_asset_types.includes(item.asset_type)) throw new Error(`${item.asset_type} is not allowed by ${record.templateType}`);
  }
  validateMethodMappings(plan);
  const generatedIds = new Set(plan.flatMap((item) => item.generation_inputs.map((input) => input.slot_id)));
  for (const item of plan) {
    for (const sourceId of item.source_input_ids || []) if (!generatedIds.has(sourceId)) throw new Error(`Unknown composition source input ID: ${sourceId}`);
  }
  if (plan.length > 30) throw new Error("Asset plan exceeds 30 assets.");
  if (new Set(plan.map(item => item.asset_id)).size !== plan.length) throw new Error("Duplicate asset ID.");
  if (new Set(plan.map(item => item.sequence)).size !== plan.length || plan.some(item => !Number.isSafeInteger(item.sequence) || item.sequence < 1)) throw new Error("Invalid or duplicate asset sequence.");
  return plan.sort((a, b) => a.sequence - b.sequence);
}

export function adaptLegacyRecipe(record) {
  const overlay = parseLegacyOverlay(record);
  const editorial = parseEditorialReview(record);
  const methodInputs = Array.from({ length: 6 }, (_, offset) => {
    const index = offset + 1;
    const caption = record[`Image_3_Step_${index}_Caption`] || "";
    return {
      slot_id: `m${index}`,
      label: `M${index}`,
      image_prompt: legacyMethodVisual(record.Image_3_Method_Prompt, index),
      overlay_text: caption
    };
  });
  const normalized = {
    schemaVersion: 2,
    contentId: record.Content_ID,
    title: record.Draft_Title,
    topic: "RECIPE",
    contentType: "RECIPE",
    templateType: "RECIPE_STANDARD",
    visualProfile: "REALISTIC_HOME_COOKING",
    hookType: "QUESTION",
    hookText: record.Draft_Title,
    caption: record.Ready_To_Post_Caption || "",
    contentBody: record.Full_Recipe || "",
    source: record.Source_References || "",
    affiliateFit: record.Affiliate_Fit || "NONE",
    monetizationAngle: "",
    lifecycleStatus: record.Status || "DRAFT",
    beliefContent: false,
    editorialReview: editorial.metadata,
    editorialReviewParseError: editorial.error,
    editorialReviewPresent: editorial.present,
    raw: record,
    assetOverrides: [
      { ...asset("COVER", "Cover", "Introduce the finished dish", "cover_overlay", overlay.cover), asset_id: "cover", image_prompt: record.Image_1_Cover_Prompt || "", generation_inputs: [{ slot_id: "cover", label: "Cover", image_prompt: record.Image_1_Cover_Prompt || "" }] },
      { ...asset("INGREDIENTS", "Ingredients", "Show exact ingredients", "information_card", overlay.ingredients), asset_id: "ingredients", image_prompt: record.Image_2_Ingredients_Prompt || "", generation_inputs: [{ slot_id: "ingredients", label: "Ingredients", image_prompt: record.Image_2_Ingredients_Prompt || "" }] },
      { ...asset("METHOD", "Method", "Teach six recipe steps", "method_grid_2x3"), asset_id: "method", generation_inputs: methodInputs },
      { ...asset("CLOSEUP", "Closeup", "Show final texture", "detail_overlay", overlay.closeup), asset_id: "closeup", image_prompt: record.Image_4_Closeup_Prompt || "", generation_inputs: [{ slot_id: "closeup", label: "Closeup", image_prompt: record.Image_4_Closeup_Prompt || "" }] }
    ],
    consistencyRules: [record.Image_Consistency_And_Negatives || ""].filter(Boolean),
    qualityRules: [record.Quality_Check || ""].filter(Boolean)
  };
  normalized.resolvedAssetPlan = resolveAssetPlan(normalized);
  return normalized;
}

function parseAssetConfiguration(record) {
  if (Array.isArray(record.assets)) return { assets: record.assets };
  if (Array.isArray(record.asset_plan)) return { assets: record.asset_plan };
  const serialized = record.Asset_Plan_JSON || record.Asset_Plan || "";
  if (!serialized) return { assets: null };
  try {
    const parsed = JSON.parse(serialized);
    return Array.isArray(parsed) ? { assets: parsed } : {
      assets: parsed.assets,
      coveragePoints: parsed.coverage_points,
      sourceIngredients: parsed.source_ingredients
    };
  } catch (error) {
    throw new Error(`Invalid Asset Plan JSON for ${record.Content_ID || record.content_id}: ${error.message}`);
  }
}

const EDITORIAL_REVIEW_STATUSES = new Set(["NOT_REVIEWED", "REVIEW", "PASS", "BLOCKED"]);

function parseEditorialReview(record = {}) {
  const serialized = record.Editorial_Review_JSON || record.editorial_review_json;
  const present = serialized !== undefined && serialized !== null && serialized !== "";
  let metadata = {};
  let error = "";
  if (serialized && typeof serialized === "object" && !Array.isArray(serialized)) metadata = clone(serialized);
  else if (serialized) {
    try {
      metadata = JSON.parse(serialized);
      if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) throw new Error("must be a JSON object");
    } catch (parseError) { error = `Invalid Editorial_Review_JSON: ${parseError.message}`; }
  }
  const aliases = {
    review_status: ["Editorial_Status", "editorial_status"],
    reviewer: ["Editorial_Reviewer", "editorial_reviewer"],
    reviewed_at: ["Editorial_Reviewed_At", "editorial_reviewed_at"],
    audience_need: ["USER_NEED", "User_Need", "Audience_Need", "audience_need", "user_need"],
    reader_value: ["Reader_Value", "reader_value"],
    reader_facing_copy_reviewed: ["Reader_Facing_Copy_Reviewed", "reader_facing_copy_reviewed"],
    internal_note_leakage: ["Internal_Note_Leakage", "internal_note_leakage"],
    claim_safety_ok: ["Claim_Safety_OK", "claim_safety_ok"],
    evidence_type: ["Evidence_Type", "evidence_type"],
    source_evidence_status: ["Source_Evidence_Status", "source_evidence_status"],
    caption_review_status: ["Caption_Review_Status", "caption_review_status"],
    claim_evidence: ["Claim_Evidence", "claim_evidence"],
    internal_claim_notes: ["Internal_Claim_Notes", "internal_claim_notes"],
    editorial_notes: ["Editorial_Notes", "editorial_notes"],
    source_notes: ["Source_Notes", "source_notes"],
    limitations: ["Limitations", "limitations"],
    recipe_precision: ["Recipe_Precision", "recipe_precision", "Approximate_Recipe", "approximate_recipe"],
    timing_guidance: ["Timing_Guidance", "timing_guidance"],
    temperature_guidance: ["Temperature_Guidance", "temperature_guidance"],
    temperature_required: ["Temperature_Required", "temperature_required"],
    serving_expectation: ["Serving_Expectation", "serving_expectation"],
    mistake_problem: ["Mistake_Problem", "mistake_problem"],
    cause_explanation: ["Cause_Explanation", "cause_explanation", "Why_It_Happens", "why_it_happens"],
    consequence: ["Mistake_Consequence", "mistake_consequence", "consequence"],
    correction: ["Correction", "correction"],
    expected_result: ["Expected_Corrected_Result", "expected_corrected_result"],
    selection_question: ["Selection_Question", "selection_question"],
    comparison_criteria: ["Comparison_Criteria", "comparison_criteria"],
    option_suitability: ["Option_Suitability", "option_suitability"],
    tradeoffs: ["Tradeoffs", "tradeoffs"],
    decision_logic: ["Decision_Logic", "decision_logic"]
  };
  for (const [key, names] of Object.entries(aliases)) {
    if (metadata[key] !== undefined) continue;
    const name = names.find((candidate) => record[candidate] !== undefined && record[candidate] !== "");
    if (name) metadata[key] = record[name];
  }
  if (metadata.review_status === undefined && typeof metadata.status === "string") metadata.review_status = metadata.status;
  return { metadata, error, present };
}

export function adaptV4Record(record) {
  const { hookText, priceVerified } = applyClaimSafety(record);
  const assetConfiguration = parseAssetConfiguration(record);
  const editorial = parseEditorialReview(record);
  const normalized = {
    schemaVersion: Number(record.Schema_Version || record.schema_version || 4),
    contentId: record.Content_ID || record.content_id,
    title: record.Title || record.Draft_Title || record.title,
    topic: record.Topic || record.topic || "LIFESTYLE",
    contentType: record.Content_Type || record.content_type,
    templateType: record.Template_Type || record.template_type,
    visualProfile: record.Visual_Profile || record.visual_profile || DEFAULT_VISUAL_PROFILE,
    hookType: record.Hook_Type || record.hook_type || "CURIOSITY",
    hookText,
    caption: record.Caption || record.Ready_To_Post_Caption || record.caption || "",
    contentBody: record.Content_Body || record.content_body || "",
    source: record.Source || record.Source_References || record.source || "",
    sourceReferences: record.Source_References || record.source_references || record.Source || record.source || "",
    affiliateFit: record.Affiliate_Fit || record.affiliate_fit || "NONE",
    monetizationAngle: record.Monetization_Angle || record.monetization_angle || "",
    productCategory: record.Product_Category || record.product_category || "",
    ctaType: record.CTA_Type || record.cta_type || "SAVE_SHARE",
    lifecycleStatus: record.Status || record.status || "DRAFT",
    beliefContent: record.Belief_Content === true || String(record.Belief_Content || "").toUpperCase() === "TRUE",
    priceClaim: {
      enabled: record.Price_Hook_Enabled === true || String(record.Price_Hook_Enabled || "").toUpperCase() === "TRUE",
      outsidePrice: record.Outside_Price || "",
      estimatedHomeCost: record.Estimated_Home_Cost || "",
      source: record.Price_Source || "",
      verifiedDate: record.Price_Verified_Date || "",
      verified: priceVerified
    },
    assetOverrides: assetConfiguration.assets,
    coveragePoints: Array.isArray(assetConfiguration.coveragePoints) ? assetConfiguration.coveragePoints : [],
    sourceIngredients: Array.isArray(assetConfiguration.sourceIngredients) ? assetConfiguration.sourceIngredients : [],
    consistencyRules: Array.isArray(record.visual_consistency_rules) ? record.visual_consistency_rules : [],
    qualityRules: Array.isArray(record.qc_rules) ? record.qc_rules : [],
    editorialReview: editorial.metadata,
    editorialReviewParseError: editorial.error,
    editorialReviewPresent: editorial.present,
    raw: record
  };
  if (!normalized.contentId || !normalized.title || !normalized.contentType || !normalized.templateType) throw new Error("V4 content requires Content_ID, Title, Content_Type and Template_Type.");
  normalized.resolvedAssetPlan = resolveAssetPlan(normalized);
  return normalized;
}

export function calculateAdaptivePanel({ label = "", heading = "", body = "", width = 1180, measure = (text) => Array.from(String(text)).length * 38 }) {
  const lineCount = (text, fontScale = 1) => {
    if (!text) return 0;
    let lines = 0;
    for (const paragraph of String(text).split(/\n/)) {
      let current = 0;
      for (const token of Array.from(paragraph || " ")) {
        const tokenWidth = measure(token) * fontScale;
        if (current && current + tokenWidth > width) { lines += 1; current = tokenWidth; }
        else current += tokenWidth;
      }
      lines += 1;
    }
    return lines;
  };
  const labelLines = label ? 1 : 0;
  const headingLines = lineCount(heading, 1.45);
  const bodyLines = lineCount(body, 1);
  const contentHeight = 72 + labelLines * 48 + headingLines * 72 + bodyLines * 58 + 58;
  const panelHeight = Math.max(460, Math.min(780, contentHeight));
  return { panelHeight, imageHeight: 1800 - panelHeight, labelLines, headingLines, bodyLines };
}

export function calculateMethodGrid(stepCount) {
  if (!Number.isInteger(stepCount) || stepCount < 2) throw new Error("Method grid requires at least two steps.");
  const rowCount = Math.ceil(stepCount / 2);
  const rowHeight = 1800 / rowCount;
  return Array.from({ length: stepCount }, (_, index) => {
    const isFullWidthFinal = stepCount % 2 === 1 && index === stepCount - 1;
    const row = isFullWidthFinal ? rowCount - 1 : Math.floor(index / 2);
    const column = index % 2;
    return {
      index,
      x: isFullWidthFinal ? 0 : column * 720,
      y: row * rowHeight,
      width: isFullWidthFinal ? 1440 : 720,
      height: rowHeight,
      fullWidth: isFullWidthFinal
    };
  });
}

export function runContentQc(content) {
  const failures = [];
  const warnings = [];
  const plan = content.resolvedAssetPlan || [];
  const generatedSlots=new Set(plan.flatMap(item=>(item.generation_inputs||[]).map(input=>input.slot_id)));
  for(const item of plan){for(const id of item.source_input_ids||[])if(!generatedSlots.has(id))failures.push({code:'UNKNOWN_COMPOSITION_IMAGE',detail:`${item.asset_id}: ${id}`});for(const step of item.method_steps||[])if(!generatedSlots.has(step.image_slot_id))failures.push({code:'METHOD_PHOTO_MAPPING_MISSING',detail:`${step.method_step_id||step.slot_id}: ${step.image_slot_id}`});}
  const covered = new Set(plan.flatMap((item) => Array.isArray(item.coverage_point_ids) ? item.coverage_point_ids : []));
  const hasRequiredDrinkStandardAssets = content.templateType === "DRINK_STANDARD"
    && TEMPLATE_REGISTRY.DRINK_STANDARD.required_asset_types.every((assetType) => plan.some((item) => item.asset_type === assetType));
  for (const point of content.coveragePoints || []) {
    const coreDrinkCoverage = point.id === "CORE" && hasRequiredDrinkStandardAssets;
    if (point.required !== false && !covered.has(point.id) && !coreDrinkCoverage) failures.push({ code: "UNCOVERED_SOURCE_POINT", detail: point.text || point.id });
  }
  const ingredientsAsset = plan.find((item) => item.asset_type === "INGREDIENTS");
  if (ingredientsAsset && (content.sourceIngredients || []).length) {
    const actual = new Set((ingredientsAsset.ingredient_items || []).map((item) => typeof item === "string" ? item : item.name));
    for (const ingredient of content.sourceIngredients) if (!actual.has(ingredient)) failures.push({ code: "MISSING_REQUIRED_INGREDIENT", detail: ingredient });
    for (const ingredient of actual) if (!content.sourceIngredients.includes(ingredient)) failures.push({ code: "UNSUPPORTED_INGREDIENT", detail: ingredient });
  }
  const purposeKeys = new Map();
  for (const item of plan) {
    const key = `${item.local_heading || item.title}|${(item.coverage_point_ids || []).slice().sort().join(",")}`;
    if (purposeKeys.has(key) && key !== "|") warnings.push({ code: "REDUNDANT_ASSET_PURPOSE", detail: `${purposeKeys.get(key)} and ${item.asset_id}` });
    purposeKeys.set(key, item.asset_id);
    if (item.asset_type !== "COVER" && item.local_heading === content.title) warnings.push({ code: "TITLE_REPETITION", detail: item.asset_id });
  }
  const method = plan.find((item) => item.asset_type === "METHOD" && (item.method_steps || item.generation_inputs).length > 1);
  if (method) {
    (method.method_steps || method.generation_inputs).forEach((input, index) => {
      const expected = `M${index + 1}`;
      const actual = String(input.method_step_id || input.slot_id).toUpperCase();
      if (actual !== expected) failures.push({ code: "METHOD_MAPPING_MISMATCH", detail: `${actual} != ${expected}` });
    });
  }
  return { status: failures.length ? "FAIL" : warnings.length ? "WARNING" : "PASS", failures, warnings, manualChecks: ["Visual realism", "Subject continuity", "Image and text visual alignment", "Wrong-example plausibility", "Composition quality"] };
}

const textValue = (value) => typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
const hasText = (...values) => values.some((value) => Boolean(textValue(value)));
const INTERNAL_NOTE_PATTERN = /(?:不发布|不要发布|请勿发布|内部(?:备注|指示|审核|使用)|编辑验证|仅供内部|do not publish|internal only|not for readers)/i;
const UNSUPPORTED_BENEFIT_PATTERN = /(?:解暑|排毒|开胃|提神|治愈|治疗|预防疾病|降血糖|降血脂|增强免疫|减肥|助眠)/;
const QUANTITY_PATTERN = /(?:(?:\d+(?:\.\d+)?(?:\s*\/\s*\d+)?|半)\s*(?:g|kg|ml|l|克|千克|毫升|升|斤|两|勺|茶匙|汤匙|瓣|根|片|碗|杯|颗|个|只|条|朵|张|棵|粒|块|枚)|适量|少许|半个|半只)/i;

function planText(content) {
  return (content.resolvedAssetPlan || []).flatMap((item) => [
    item.overlay_text, item.purpose, item.local_heading,
    ...(item.method_steps || item.generation_inputs || []).flatMap((input) => [input.step_heading, input.step_supporting_text, input.overlay_text])
  ]).filter(Boolean).join("\n");
}

function recipeApproximation(metadata) {
  const value = String(metadata.recipe_precision || "").trim().toUpperCase();
  return metadata.approximate_recipe === true || value === "TRUE" || value === "APPROXIMATE" || value === "ESTIMATE";
}

/**
 * Editorial completeness is deliberately separate from deterministic asset/contract QC.
 * PASS requires both content completeness and an explicit reviewer + timestamp in the optional
 * Editorial_Review_JSON (or equivalent mapped fields); it is not inferred from structural PASS.
 */
export function runEditorialReview(content) {
  const metadata = {...(content.productionDerivedFields||{}),...(content.editorialReview||{})};
  const reviewPresent = content.editorialReviewPresent ?? Object.keys(content.editorialReview||{}).length > 0;
  const issues = [];
  const add = (code, detail, severity = "REVIEW") => issues.push({ code, detail, severity });
  const plan = content.resolvedAssetPlan || [];
  const body = textValue(content.contentBody);
  const caption = textValue(content.caption);
  const assetCopy = plan.flatMap((item) => [item.section_label, item.local_heading, item.overlay_text, ...(item.generation_inputs || []).map((input) => input.overlay_text)]);
  const publishableCopy = [content.title, content.hookText, caption, content.raw?.CTA_Text, content.raw?.cta_text, ...assetCopy].map(textValue).filter(Boolean).join("\n");
  const editorialMaterialExists = Boolean(body || caption || (content.coveragePoints || []).length || metadata.reader_value);
  const evidence = metadata.evidence && typeof metadata.evidence === "object" ? metadata.evidence : {};
  const evidenceType = String(evidence.type || metadata.evidence_type || (String(metadata.source_evidence_status || "").toUpperCase() === "VERIFIED" ? "SOURCE_DIRECT" : "UNVERIFIED")).toUpperCase();
  const evidenceReferences = Array.isArray(evidence.references) ? evidence.references.map(textValue).filter(Boolean) : [];
  const evidenceNotes = textValue(evidence.notes || metadata.source_notes || metadata.claim_evidence);
  const risk=classifyClaimRisk(content);
  const internalEvidenceAccepted=risk.tier==='LOW' && evidenceType==='SOURCE_INTERNAL' && metadata.internal_consistency_checked===true && String(metadata.source_evidence_status||'').toUpperCase()==='INTERNAL_REVIEWED';

  if (content.editorialReviewParseError) add("EDITORIAL_REVIEW_JSON_INVALID", content.editorialReviewParseError);
  if (!editorialMaterialExists) {
    add("EDITORIAL_CONTENT_NOT_STARTED", "The opportunity handoff has no developed source content or reader-facing caption.", "PENDING");
    const emptyContentStatus = String(metadata.review_status || "NOT_REVIEWED").toUpperCase();
    if (emptyContentStatus === "BLOCKED") {
      add("EDITOR_MARKED_BLOCKED", "The editor has explicitly blocked this content.", "BLOCKED");
      return { status: "BLOCKED", issues, reviewer: textValue(metadata.reviewer), reviewedAt: textValue(metadata.reviewed_at), mode: "RULES_PLUS_REVIEWER_ATTESTATION" };
    }
    if (content.editorialReviewParseError || emptyContentStatus === "REVIEW" || !EDITORIAL_REVIEW_STATUSES.has(emptyContentStatus)) {
      return { status: "REVIEW", issues, reviewer: textValue(metadata.reviewer), reviewedAt: textValue(metadata.reviewed_at), mode: "RULES_PLUS_REVIEWER_ATTESTATION" };
    }
    return { status: "NOT_REVIEWED", issues, reviewer: textValue(metadata.reviewer), reviewedAt: textValue(metadata.reviewed_at), mode: "RULES_PLUS_REVIEWER_ATTESTATION" };
  }

  if (INTERNAL_NOTE_PATTERN.test(publishableCopy)) {
    add("INTERNAL_NOTE_IN_READER_COPY", "Internal production/review instructions appear in reader-facing text; move them to dedicated internal fields before use.", "BLOCKED");
  }
  if (UNSUPPORTED_BENEFIT_PATTERN.test(publishableCopy) && !hasText(metadata.claim_evidence)) {
    add("UNSUPPORTED_BENEFIT_CLAIM", "Reader-facing copy contains a health/wellness benefit claim without claim evidence.", "BLOCKED");
  }

  const audienceText = `${content.title || ""} ${content.hookText || ""} ${caption}`;
  const audienceSignal = /[?？]|为什么|怎么(?:做|挑|选)|如何|别只看|不知道煮什么|买菜|选购|谁适合|如何判断/.test(audienceText)
    || (["RECIPE", "DRINK"].includes(content.contentType) && /(?:晚餐|白饭|米饭|家常菜|不知道煮)/.test(audienceText));
  if (!hasText(metadata.audience_need)) add("AUDIENCE_NEED_NOT_EXPLICIT", "Record the specific reader need or decision this content serves.");
  else if (!audienceSignal && textValue(metadata.audience_need).length < 8) add("AUDIENCE_NEED_UNCLEAR", "Describe the reader and practical need clearly enough to guide an editorial decision.");
  if (!hasText(metadata.reader_value)) add("READER_VALUE_NOT_EXPLICIT", "Record the concrete reader benefit in the editorial specification; asset presence alone does not prove usefulness.");
  const pageProfileReady = Boolean(content.pageProfile?.active && content.pageProfile.facebookPageId
    && content.pageProfile.displayName && content.pageProfile.audience && content.pageProfile.primaryLanguage
    && content.pageProfile.toneGuidance && content.pageProfile.avoidTopics?.length);
  // Page fit is a publishing-only decision. It must not block image prompts or ZIP export.
  if (!body || !caption) add("READER_VALUE_OR_CAPTION_MISSING", "A developed source body and reader-facing caption are both required.");
  if (caption && caption.length < 12) add("CAPTION_VALUE_TOO_THIN", "Caption is too short to demonstrate useful reader-facing value.");
  if (body && INTERNAL_NOTE_PATTERN.test(body)) add("INTERNAL_NOTE_IN_SOURCE_BODY", "Move the internal instruction out of Content_Body into Editorial_Notes; keep the reader-facing copy separate.");

  const source = textValue(content.sourceReferences || content.source);
  const genericSourcePattern = /controlled\s+v4\s+google\s+sheet\s+canary|top\s+facebook\s+performance\s+list|source\s*(?:pending|tbd|unknown)|待补|待核实/i;
  const genericSource = genericSourcePattern.test(source);
  const specificEvidenceNotes = [metadata.source_notes, evidence.notes, metadata.claim_evidence].map(textValue).filter((value) => value && !genericSourcePattern.test(value));
  const validEvidenceReferences = evidenceReferences.filter((reference) => !genericSourcePattern.test(reference));
  if (!internalEvidenceAccepted && !source && !specificEvidenceNotes.length && !validEvidenceReferences.length) add("SOURCE_EVIDENCE_MISSING", "Add an identifiable source or evidence note for factual statements.");
  else if (!internalEvidenceAccepted && genericSource && !specificEvidenceNotes.length && !validEvidenceReferences.length) add("SOURCE_EVIDENCE_IS_PLACEHOLDER", "The current source label identifies the canary, not evidence supporting this content.");
  if (!["SOURCE_DIRECT", "SOURCE_GENERAL", "HEURISTIC", "UNVERIFIED", "SOURCE_INTERNAL"].includes(evidenceType)) add("EVIDENCE_TYPE_INVALID", `Unsupported evidence type: ${evidenceType}.`);
  if (evidenceType === 'SOURCE_INTERNAL' && !internalEvidenceAccepted) add('INTERNAL_REVIEW_INSUFFICIENT','Internal consistency review can replace an external citation only for low-risk content, with explicit reviewer attestation.');
  if (evidenceType === "UNVERIFIED") add("SOURCE_EVIDENCE_UNVERIFIED", "Evidence is explicitly unverified; Editorial PASS is not available.");
  else if (!internalEvidenceAccepted && String(metadata.source_evidence_status || "").toUpperCase() !== "VERIFIED") add("SOURCE_EVIDENCE_NOT_VERIFIED", "The reviewer has not confirmed that the cited source or evidence was checked.");
  if (evidenceType === "SOURCE_DIRECT" && !validEvidenceReferences.length && !specificEvidenceNotes.length && (genericSource || !source)) add("SOURCE_DIRECT_REFERENCE_MISSING", "Direct-source evidence requires an identifiable reference that supports the stated claim.");
  if (evidenceType === "SOURCE_GENERAL" && !evidenceNotes) add("SOURCE_GENERAL_NOTE_MISSING", "Explain the established general knowledge supporting the factual statements.");
  if (evidenceType === "HEURISTIC") {
    if (!evidenceNotes && !hasText(metadata.limitations)) add("HEURISTIC_BASIS_MISSING", "Record the practical basis or limitation of this rule of thumb.");
    if (!/(?:通常|一般|可能|可以|可作(?:為|为)參考|可作(?:为)?参考|比較|比较|不一定|不是唯一|若.{0,20}(?:可|可以|建議|建议)|when appropriate)/i.test(publishableCopy)) {
      add("HEURISTIC_UNQUALIFIED", "Qualify this rule of thumb in reader-facing copy; do not state it as a guarantee.");
    }
    if (/(?:一定|必然|保證|保证|百分之百|永遠|永远|絕不|绝不)/.test(publishableCopy)) add("HEURISTIC_ABSOLUTE_CLAIM", "A practical heuristic is paired with absolute wording; revise it conservatively.");
  }
  if (metadata.internal_note_leakage === true) add("INTERNAL_NOTE_LEAKAGE_CONFIRMED", "Reviewer marked internal notes as present in reader-facing copy.", "BLOCKED");
  else if (metadata.internal_note_leakage !== false) add("INTERNAL_NOTE_LEAKAGE_NOT_CONFIRMED", "Explicitly confirm that reader-facing copy contains no internal production or review notes.");
  if (metadata.claim_safety_ok === false) add("CLAIM_SAFETY_FAILED", "Reviewer marked at least one reader-facing claim as unsafe or unsupported.", "BLOCKED");
  else if (metadata.claim_safety_ok !== true) add("CLAIM_SAFETY_NOT_CONFIRMED", "Explicitly confirm that factual and benefit claims are appropriately supported and qualified.");
  if (metadata.reader_facing_copy_reviewed !== true) add("READER_FACING_COPY_NOT_REVIEWED", "Confirm that title, caption, overlays and CTA are natural, publishable reader-facing copy.");
  if (String(metadata.review_status || "").toUpperCase() === "BLOCKED") {
    add("EDITOR_MARKED_BLOCKED", "The editor has explicitly blocked this content.", "BLOCKED");
  }
  if (String(metadata.review_status || "").toUpperCase() === "REVIEW") {
    add("EDITOR_REQUESTED_REVIEW", textValue(metadata.review_note) || "The editor requested another review.");
  }

  const editorialCopyReviewed = String(metadata.caption_review_status || "").toUpperCase() === "PASS";
  if (!editorialCopyReviewed) add("CAPTION_EDITORIAL_REVIEW_MISSING", "Naturalness and reader-facing tone have not been explicitly reviewed.");

  const fullText = `${body}\n${caption}\n${planText(content)}`;
  if (["RECIPE", "DRINK"].includes(content.contentType) || content.templateType === "RECIPE_STANDARD") {
    const ingredientsAsset = plan.find((item) => item.asset_type === "INGREDIENTS");
    const legacyIngredientItems = content.schemaVersion < 4 && content.raw
      ? parseLegacyIngredientItems(parseLegacyOverlay(content.raw).ingredients || extractIngredients(content.raw.Full_Recipe))
      : [];
    const sourceIngredients = content.sourceIngredients?.length ? content.sourceIngredients : legacyIngredientItems.map((item) => item.name);
    const ingredientItems = ingredientsAsset?.ingredient_items?.length ? ingredientsAsset.ingredient_items : legacyIngredientItems;
    if (!sourceIngredients.length || !ingredientsAsset) add("RECIPE_INGREDIENTS_MISSING", "A source-backed ingredient list is required.");
    const hasQuantities = sourceIngredients.length > 0 && sourceIngredients.every((name) => (content.productionDerivedFields?.optional_ingredients||[]).includes(name) || ingredientItems.some((item) => {
      const itemText = typeof item === "string" ? item : `${item?.name || ""} ${item?.quantity || ""}`;
      return textValue(itemText).includes(name) && QUANTITY_PATTERN.test(itemText);
    }));
    const approximate = recipeApproximation(metadata);
    if (!hasQuantities && !(approximate && hasText(metadata.limitations))) {
      add("RECIPE_QUANTITIES_OR_APPROXIMATION_MISSING", "Add reproducible quantities, or explicitly mark the recipe approximate and explain the limitation.");
    }
    const method = plan.find((item) => item.asset_type === "METHOD");
    const steps = method?.method_steps || method?.generation_inputs || [];
    const editorialSteps = steps.map((step, index) => {
      const caption = textValue(step.overlay_text);
      return {
        method_step_id: step.method_step_id || (/^m\d+$/i.test(step.slot_id || "") ? step.slot_id.toUpperCase() : `M${index + 1}`),
        step_heading: step.step_heading || caption.split(/[，,；;。\n]/)[0]?.trim(),
        step_supporting_text: step.step_supporting_text || caption.split(/\n/).slice(1).join(" ").trim()
      };
    });
    if (!body || editorialSteps.length < 2 || editorialSteps.some((step) => !hasText(step.method_step_id, step.step_heading, step.step_supporting_text))) {
      add("RECIPE_METHOD_INCOMPLETE", "Provide preparation instructions and ordered method steps with IDs, headings and supporting text.");
    }
    const hasTiming = hasText(metadata.timing_guidance) || /\d+\s*(?:分钟|min(?:ute)?s?|秒)|(?:至|直到|直至).{0,12}(?:熟透|全熟|断生|凝固|上色|金黄|冒汽|变软|收汁)|熟透|全熟|断生|凝固|刚熟/i.test(fullText);
    if (!hasTiming) add("RECIPE_TIMING_GUIDANCE_MISSING", "Add useful timing or observable doneness guidance.");
    if (metadata.temperature_required === true && !hasText(metadata.temperature_guidance)) {
      add("RECIPE_TEMPERATURE_GUIDANCE_MISSING", "This recipe is marked temperature-sensitive; provide the applicable temperature guidance or remove the requirement with a reason.");
    }
    const recipeIdentityAndMethod = `${content.title || ""} ${body}`;
    // Do not treat 鸡蛋 (egg) as poultry; require an explicit meat term.
    // Recognize an already-specified safe internal-temperature cue as well as
    // clear textual doneness cues so valid recipes are not falsely blocked.
    const needsCookSafetyCue = /(?:(?:鸡|鸭|鹅)(?!蛋)|猪肉|牛肉|羊肉|兔肉|肉末|肉片|肉丁|禽肉|排骨|鱼|虾|chicken|pork|beef|lamb|poultry|fish|shrimp)/i.test(recipeIdentityAndMethod);
    const hasMeatDonenessCue = /(?:完全熟透|中心熟透|熟透|全熟|蒸熟|煮熟|煎熟|熟至|刚熟|fully cooked|cook through|(?:74|75)\s*°?\s*C|165\s*°?\s*F)/i.test(fullText);
    const hasFishCue=/(?:鱼|fish)/i.test(recipeIdentityAndMethod) && /(?:中心\s*(?:63\s*°?\s*C|145\s*°?\s*F)|自然分成片层|鱼肉完全不透明)/i.test(fullText);
    if (needsCookSafetyCue && !hasMeatDonenessCue && !hasFishCue) {
      add("RECIPE_COOKING_SAFETY_CUE_MISSING", "Add an appropriate doneness/safety cue for the meat in this recipe.");
    }
    const closeup = plan.find((item) => item.asset_type === "CLOSEUP" || item.asset_type === "FINAL");
    if (!hasText(metadata.serving_expectation, closeup?.overlay_text, closeup?.purpose)) {
      add("RECIPE_RESULT_EXPECTATION_MISSING", "Describe the serving/result expectation for the reader.");
    }
  }

  if (content.contentType === "MISTAKE_FIX" || content.templateType === "MISTAKE_BEFORE_AFTER") {
    const wrong = plan.find((item) => item.asset_type === "WRONG_METHOD");
    const correct = plan.find((item) => item.asset_type === "CORRECT_METHOD");
    const final = plan.find((item) => item.asset_type === "FINAL_RESULT");
    const problemText = `${content.title || ""} ${content.hookText || ""} ${metadata.mistake_problem || ""}`;
    if (!hasText(metadata.mistake_problem) && !/[?？]|出水|缩水|做错|失败|问题/.test(problemText)) add("MISTAKE_NOT_DEFINED", "Define the specific mistake or reader problem.");
    if (!hasText(metadata.cause_explanation) && !/(?:因为|原因是|由于|导致|所以|会让|容易让)/.test(body)) add("MISTAKE_CAUSE_MISSING", "Explain why the mistake happens; a visual label alone is not an explanation.");
    if (!hasText(metadata.consequence) && !/(?:出水|缩水|变老|变柴|变软|变色|失败|影响|导致)/.test(`${content.title || ""} ${content.hookText || ""} ${body} ${caption}`)) add("MISTAKE_CONSEQUENCE_MISSING", "State the practical consequence of the mistake.");
    if (!wrong || !correct || !hasText(correct.overlay_text)) add("MISTAKE_CORRECTION_MISSING", "Provide a clear, actionable correction alongside the wrong-method example.");
    if (!hasText(metadata.expected_result, final?.overlay_text, final?.purpose)) add("MISTAKE_EXPECTED_RESULT_MISSING", "State the result readers should expect after applying the correction.");
  }

  if (content.contentType === "SELECTION_GUIDE" || content.templateType === "COMPARE_CHECKLIST" || content.templateType === "SAVEABLE_GUIDE") {
    const requiredPoints = (content.coveragePoints || []).filter((point) => point.required !== false);
    const covered = new Set(plan.flatMap((item) => item.coverage_point_ids || []));
    const missingPoints = requiredPoints.filter((point) => !covered.has(point.id));
    if (!requiredPoints.length || missingPoints.length) add("SELECTION_CRITERIA_INCOMPLETE", missingPoints.length ? `Map every required criterion to a final asset: ${missingPoints.map((point) => point.text || point.id).join(", ")}.` : "Define explicit decision criteria.");
    if (!hasText(metadata.option_suitability) && !/(?:适合|适用|更适合|不适合|如果.{0,12}(?:选|挑|买))/.test(fullText)) {
      add("SELECTION_SUITABILITY_MISSING", "Explain who/when each option or criterion suits.");
    }
    if (!hasText(metadata.tradeoffs, metadata.limitations) && !/(?:不过|但|限制|不适合|取舍|缺点|通常|可能)/.test(fullText)) {
      add("SELECTION_TRADEOFFS_MISSING", "Represent relevant trade-offs, exceptions or limitations.");
    }
    if (!hasText(metadata.decision_logic) && !/(?:检查|看|挑|选|判断|优先|同样大小)/.test(fullText)) {
      add("SELECTION_DECISION_LOGIC_MISSING", "State how the reader should apply the criteria to make a decision.");
    }
  }

  if (metadata.schema_version !== undefined && Number(metadata.schema_version) !== 1) add("EDITORIAL_REVIEW_VERSION_UNSUPPORTED", "Editorial review JSON schema_version must be 1.");
  const explicitStatus = String(metadata.review_status || "NOT_REVIEWED").toUpperCase();
  if (!EDITORIAL_REVIEW_STATUSES.has(explicitStatus)) add("EDITORIAL_STATUS_INVALID", `Unsupported editorial state: ${explicitStatus}.`);
  const hasBlockingIssue = issues.some((issue) => issue.severity === "BLOCKED");
  const hasReviewIssue = issues.some((issue) => issue.severity === "REVIEW");
  const reviewedAt = textValue(metadata.reviewed_at);
  const reviewerAttestationPresent = hasText(metadata.reviewer) && Boolean(reviewedAt) && Number.isFinite(Date.parse(reviewedAt));
  if (reviewedAt && !Number.isFinite(Date.parse(reviewedAt))) add("EDITORIAL_REVIEW_TIMESTAMP_INVALID", "reviewed_at must be a valid ISO-8601 timestamp.");
  let status = "PASS";
  if (hasBlockingIssue || explicitStatus === "BLOCKED") status = "BLOCKED";
  else if (!reviewPresent && !content.editorialReviewParseError) {
    status = "NOT_REVIEWED";
    add("EDITORIAL_REVIEW_NOT_STARTED", "No durable Editorial_Review_JSON review input exists for this record.", "PENDING");
  } else if (hasReviewIssue || explicitStatus === "REVIEW") status = "REVIEW";
  else if (explicitStatus !== "PASS" || !reviewerAttestationPresent) {
    status = explicitStatus === "NOT_REVIEWED" ? "NOT_REVIEWED" : "REVIEW";
    add("EDITORIAL_APPROVAL_NOT_RECORDED", "Rule checks are complete, but an explicit editor PASS with reviewer and timestamp is required.", "PENDING");
  }
  return { status, issues, reviewer: textValue(metadata.reviewer), reviewedAt: textValue(metadata.reviewed_at), mode: "RULES_PLUS_REVIEWER_ATTESTATION" };
}

export function deriveGenerationReadiness(content, { structuralQc = runContentQc(content), editorialReview = runEditorialReview(content) } = {}) {
  const blockers = [];
  if (structuralQc.failures.length) blockers.push(`Contract QC is ${structuralQc.status}.`);
  if (editorialReview.status !== "PASS") blockers.push(`Editorial status is ${editorialReview.status}.`);
  try {
    const manifest = buildGenerationManifest(content);
    if (!validateResolvedContent(content).valid) blockers.push("Resolved production specification is incomplete.");
    if (!manifest.entries.length) blockers.push("Generation Plan has no inputs.");
    for (const entry of manifest.entries) if (entry.required && !textValue(entry.imagePrompt)) blockers.push(`Required generation input ${entry.slotId} has no image prompt.`);
  } catch (error) { blockers.push(`Generation Plan is invalid: ${error.message}`); }
  return { status: blockers.length ? "GENERATION_BLOCKED" : "GENERATION_READY", ready: blockers.length === 0, blockers };
}

export function derivePublishingReadiness(content, { generationReadiness = deriveGenerationReadiness(content), requiredImagesPresent = false, finalAssetsPresent = false, visualQcStatus = "NOT_RUN", pageProfileReady } = {}) {
  if (["PUBLISHED", "POSTED"].includes(String(content.lifecycleStatus || "").toUpperCase())) return { status: "PUBLISHED", ready: false, blockers: [] };
  const blockers = [];
  if (!generationReadiness.ready) blockers.push(...generationReadiness.blockers);
  if (!requiredImagesPresent) blockers.push("Required source images are incomplete.");
  if (!finalAssetsPresent) blockers.push("Final assets have not all been built.");
  if (visualQcStatus !== "PASS") blockers.push(`Final visual QC is ${visualQcStatus}.`);
  const hasPageProfile = pageProfileReady ?? Boolean(content.pageProfile?.active && content.pageProfile.facebookPageId
    && content.pageProfile.displayName && content.pageProfile.audience && content.pageProfile.primaryLanguage
    && content.pageProfile.toneGuidance && content.pageProfile.avoidTopics?.length);
  if (!hasPageProfile) blockers.push("Assign a complete target Facebook Page profile before publishing.");
  else {
    const review=content.editorialReview||{};
    if (String(review.page_fit_status||'').toUpperCase()!=='PASS') blockers.push('Review copy fit against the assigned Page before publishing.');
    if (textValue(review.page_profile_id)!==textValue(content.pageProfile.profileId)
      || (content.pageProfile.updatedAt&&textValue(review.page_profile_updated_at)!==textValue(content.pageProfile.updatedAt))) blockers.push('Page fit review is stale for this Page profile.');
  }
  return { status: blockers.length ? "NOT_READY" : "READY", ready: blockers.length === 0, blockers };
}

/** Stable revision fingerprint for the source images consumed by one final asset. */
export function buildAssetSourceRevision(assetItem, imageSlots = {}) {
  const slotIds = [...new Set([
    ...(assetItem?.generation_inputs || []).map((input) => input.slot_id),
    ...(assetItem?.source_input_ids || [])
  ].filter(Boolean))].sort();
  return JSON.stringify(slotIds.map((slotId) => [slotId, imageSlots[slotId]?.revision || imageSlots[slotId]?.updatedAt || null]));
}

/** Fail closed for stale sources, while safely recognizing pre-fingerprint assets by timestamps. */
export function isStoredAssetStale(assetItem, storedAsset, imageSlots = {}) {
  if (!storedAsset || storedAsset.stale) return true;
  const slotIds = [...new Set([
    ...(assetItem?.generation_inputs || []).map((input) => input.slot_id),
    ...(assetItem?.source_input_ids || [])
  ].filter(Boolean))];
  const currentRevision = buildAssetSourceRevision(assetItem, imageSlots);
  if (typeof storedAsset.sourceRevision === "string" && storedAsset.sourceRevision) return storedAsset.sourceRevision !== currentRevision;
  if (!slotIds.length) return false;
  const builtAt = Number(storedAsset.updatedAt);
  return !Number.isFinite(builtAt) || slotIds.some((slotId) => {
    const image = imageSlots[slotId];
    const importedAt = Number(image?.updatedAt);
    return !image || !Number.isFinite(importedAt) || importedAt > builtAt;
  });
}

export function normalizeContentRecord(record) {
  if (!record || typeof record !== "object" || Array.isArray(record)) throw new Error("Content row must be an object.");
  if (typeof (record.Content_ID || record.content_id) !== "string" || !(record.Content_ID || record.content_id).trim()) throw new Error("Content_ID must be an opaque non-empty string.");
  if (!(record.Title || record.Draft_Title || record.title)) throw new Error("Title is required.");
  const schema = Number(record.Schema_Version || record.schema_version || 0);
  return schema >= 4 || record.Content_Type || record.content_type ? adaptV4Record(record) : adaptLegacyRecipe(record);
}

export function identifyContentRecord(record, index = 0) {
  return String(record?.Content_ID || record?.content_id || record?.Title || record?.title || `row ${index + 1}`);
}

export function normalizeContentRecordsSafely(rawRecords = []) {
  const records = [];
  const rejected = [];
  if (!Array.isArray(rawRecords)) throw new Error("Source must return a records array.");
  const counts = new Map();
  for (const row of rawRecords) { const id = row?.Content_ID || row?.content_id; if (id) counts.set(id, (counts.get(id) || 0) + 1); }
  rawRecords.forEach((record, index) => {
    try {
      if (counts.get(record?.Content_ID || record?.content_id) > 1) throw new Error("Duplicate Content_ID in this worksheet; status writes are unsafe.");
      const normalized = normalizeContentRecord(record);
      buildGenerationManifest(normalized);
      records.push(normalized);
    } catch (error) {
      rejected.push({
        contentId: identifyContentRecord(record, index),
        message: error.message,
        rowNumber: index + 2,
        field: /Content_ID/.test(error.message) ? "Content_ID" : /Title/.test(error.message) ? "Title" : /Template|compatible/.test(error.message) ? "Template_Type / Content_Type" : "Asset_Plan_JSON",
        suggestedRepair: /Duplicate/.test(error.message) ? "Resolve duplicate identifiers; preserve the intended record IDs before using status writes." : "Repair the named field using the source content, then reload this worksheet."
      });
    }
  });
  return { records, rejected };
}

export function buildGenerationManifest(content) {
  const entries = [];
  const slotIds = new Set();
  for (const assetItem of content.resolvedAssetPlan) {
    for (const input of assetItem.generation_inputs) {
      if (slotIds.has(input.slot_id)) throw new Error(`Duplicate generation input ID: ${input.slot_id}`);
      slotIds.add(input.slot_id);
      entries.push({
        sequence: entries.length + 1,
        slotId: input.slot_id,
        label: input.label,
        assetId: assetItem.asset_id,
        assetType: assetItem.asset_type,
        imagePrompt: input.image_prompt,
        overlayText: input.overlay_text,
        semanticKey: JSON.stringify([content.contentId, content.contentBody, content.visualProfile, content.consistencyRules, input.image_prompt, input.overlay_text, input.source_role]),
        expectedFilename: `${String(entries.length + 1).padStart(2, "0")}_${input.slot_id.toUpperCase()}.png`,
        regenRequiredReason: input.regen_required_reason,
        required: input.required !== false
      });
    }
  }
  return { contentId: content.contentId, expectedAssets: entries.length, entries };
}

export function buildSessionPrompt(content) {
  const manifest = buildGenerationManifest(content);
  const stages = manifest.entries.map((entry) => `${String(entry.sequence).padStart(2, "0")} ${entry.label}`).join(" → ");
  const sourceLabel = content.contentType === "RECIPE" ? "SOURCE-OF-TRUTH RECIPE" : "SOURCE-OF-TRUTH CONTENT";
  const pageProfile = content.pageProfile;
  const pageGuidance = pageProfile ? [
    `TARGET FACEBOOK PAGE: ${pageProfile.displayName}`,
    `Audience/niche: ${pageProfile.audience}`,
    `Primary language: ${pageProfile.primaryLanguage}`,
    `Tone/style: ${pageProfile.toneGuidance}`,
    pageProfile.contentPillars?.length ? `Suitable content pillars: ${pageProfile.contentPillars.join(" · ")}` : "",
    pageProfile.suitableFormats?.length ? `Suitable formats: ${pageProfile.suitableFormats.join(" · ")}` : "",
    pageProfile.avoidTopics?.length ? `Avoid topics/claims: ${pageProfile.avoidTopics.join(" · ")}` : ""
  ].filter(Boolean).join("\n") : "";
  return [
    `CHATGPT IMAGE SESSION — ${content.contentId} — ${content.title}`,
    `Content Type: ${content.contentType}\nTemplate: ${content.templateType}\nVisual Profile: ${content.visualProfile}\nHook Type: ${content.hookType}`,
    `Commands: N = generate the next image; R = regenerate the current image only; FIX: ... = correct the current image only. Start at ${manifest.entries[0]?.label || "the first image"}. Never advance after R or FIX. Advance exactly one generation input only when I send N. After the final generation input, N must not create another stage.`,
    "Generate exactly ONE image per response. Do not skip generation inputs. Do not render text, letters, numbers, logos or watermarks inside photographs; controlled typography is added later by the Production Console.",
    "EDITORIAL VALUE RULE: Every educational asset should provide at least one actionable reader insight beyond the headline unless minimal text is intentionally required by that asset’s visual purpose. Where the source specification supports it, preserve a clear micro-label, heading, main judgment and concise practical explanation/action in the controlled overlay. Readability comes before filling space. Never invent ingredients, facts, causes, quantities or claims; if source support is insufficient, flag the specification for review instead of adding filler.",
    `${sourceLabel}:\n${content.contentBody}`,
    pageGuidance ? `PAGE-SPECIFIC CONTENT DIRECTION:\n${pageGuidance}` : "",
    content.consistencyRules.length ? `VISUAL CONSISTENCY:\n${content.consistencyRules.join("\n")}` : "",
    content.qualityRules.length ? `QUALITY CHECK:\n${content.qualityRules.join("\n")}` : "",
    "PHOTO DIRECTION: Portrait 4:5. Frame the essential subject inside the central 80% safe area with room for a later crop. Use realistic editorial photography, natural textures and small natural imperfections. Soft directional daylight and an appropriate top-down or eye-level view; keep the entire instructional action legible. Malaysian home context only where supported by the subject. No embedded text, letters, numbers, logos, labels or watermarks.",
    "CONTINUITY: Same subject identity, plate/bowl or tools, countertop and compatible lighting throughout. Each slot must show its own assigned state and logical progression, not repeat the finished cover. SOURCE facts and the current slot take priority over conflicting style adjectives in older prompts.",
    "AVOID: plastic textures, repeated identical pieces, floating objects, impossible utensils or hands, excessive steam, unnatural gloss, hyper-saturated colour, distracting blur, wrong ingredient state. Do not add objects, ingredients or factual details absent from the source.",
    `GENERATION MANIFEST — ${manifest.expectedAssets} IMAGES\n${stages}`,
    ...manifest.entries.map((entry) => `${String(entry.sequence).padStart(2, "0")} ${entry.label} [${entry.assetType}]\nCONTENT ID: ${content.contentId}\nSAVE AS: ${entry.expectedFilename}\nSUBJECT / SCENE / REQUIRED STATE: ${entry.imagePrompt}${entry.overlayText ? `\nConsole overlay: ${entry.overlayText}` : ""}`)
  ].filter(Boolean).join("\n\n");
}

export function matchGenerationSlot(filename, manifest) {
  const base = String(filename || "").replace(/\.[^.]+$/, "").toLowerCase();
  const candidates = new Set();
  const sequence = base.match(/^(?:image[ _-]*|img[ _-]*|asset[ _-]*)?(\d{1,2})(?=[ _-]|$)/);
  const namedSequences=[...base.matchAll(/(?:^|[ _-])(?:image|img|asset)[ _-]*(\d{1,2})(?=[ _-]|$)/g)];
  for(const match of [sequence,...namedSequences].filter(Boolean)){const entry=manifest.entries[Number(match[1])-1];if(!entry)return null;candidates.add(entry.slotId);}
  const tokens = base.split(/[^a-z0-9]+/).filter(Boolean);
  for(const entry of manifest.entries) {
    const slot = entry.slotId.toLowerCase();
    const label = entry.label.toLowerCase();
    const bounded = value => value && new RegExp(`(?:^|[^a-z0-9])${value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:$|[^a-z0-9])`).test(base);
    if(tokens.includes(slot) || bounded(slot) || (label.length > 2 && bounded(label))) candidates.add(entry.slotId);
  }
  return candidates.size === 1 ? [...candidates][0] : null;
}

export function buildAssetFilename(content, assetItem) {
  if (content.schemaVersion < 4) return `${content.contentId}-${assetItem.asset_id}-1440x1800.png`;
  return `${content.contentId}_${String(assetItem.sequence).padStart(2, "0")}_${assetItem.asset_type}.png`;
}

export function validateResolvedContent(content) {
  const manifest = buildGenerationManifest(content);
  return {
    valid: Boolean(content.contentId && content.title && content.resolvedAssetPlan.length && manifest.entries.length),
    assetCount: content.resolvedAssetPlan.length,
    generationCount: manifest.entries.length,
    requiredSlots: manifest.entries.filter((entry) => entry.required).map((entry) => entry.slotId)
  };
}

export function buildSlotPrompt(content, slotId) {
  const manifest = buildGenerationManifest(content);
  const entry = manifest.entries.find(item => item.slotId === slotId);
  if (!entry) throw new Error("Unknown generation slot.");
  return [
    `CURRENT SLOT ONLY — ${entry.sequence}/${manifest.entries.length} — ${entry.label}`,
    `CONTENT ID: ${content.contentId}\nSLOT ROLE: ${entry.assetType}\nSAVE AS: ${entry.expectedFilename}`,
    `SUBJECT / SCENE / REQUIRED STATE: ${entry.imagePrompt}`,
    `SOURCE FACTS: ${content.contentBody}`,
    `VISUAL PROFILE: ${content.visualProfile}. Keep the same subject identity, plate/bowl, tools, countertop and compatible lighting as the other images in this set. Show only this assigned stage, with realistic materials and natural imperfections.`,
    `CAMERA / COMPOSITION: Editorial photography with an angle that clearly shows the action or decision cue. Portrait 4:5, central 80% safe crop, room for Console overlays. Soft natural light where appropriate.`,
    `REQUIRED OBJECTS: Only objects supported by the source and described in this slot. REQUIRED STATE: ${entry.label}.`,
    `DO NOT SHOW: Embedded text, letters, numbers, logos, watermarks, floating objects, plastic food, repeated identical pieces, impossible tools or hands, excessive steam, unnatural gloss, wrong ingredient state.`,
    entry.overlayText ? `Console-controlled text added later (do not embed): ${entry.overlayText}` : "",
    "Generate exactly one image for this slot."
  ].filter(Boolean).join("\n\n");
}
