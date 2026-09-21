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
  const inputs = Array.isArray(result.generation_inputs) && result.generation_inputs.length
    ? result.generation_inputs
    : [{ slot_id: result.asset_id, label: result.title || result.asset_type, image_prompt: result.image_prompt || "" }];
  result.generation_inputs = inputs.map((input, inputIndex) => ({
    slot_id: safeId(input.slot_id || `${result.asset_id}-${inputIndex + 1}`).toLowerCase(),
    label: input.label || `${result.title || result.asset_type} ${inputIndex + 1}`,
    image_prompt: input.image_prompt || result.image_prompt || "",
    overlay_text: input.overlay_text || "",
    required: input.required === undefined ? result.required : input.required !== false
  }));
  return result;
}

export function resolveAssetPlan(record, registry = TEMPLATE_REGISTRY) {
  const definition = registry[record.templateType];
  if (!definition) throw new Error(`Unknown Template_Type: ${record.templateType}`);
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
  return plan;
}

export function adaptLegacyRecipe(record) {
  const overlay = parseLegacyOverlay(record);
  const methodInputs = Array.from({ length: 6 }, (_, offset) => {
    const index = offset + 1;
    return {
      slot_id: `m${index}`,
      label: `M${index}`,
      image_prompt: legacyMethodVisual(record.Image_3_Method_Prompt, index),
      overlay_text: record[`Image_3_Step_${index}_Caption`] || ""
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

function parseAssetOverrides(record) {
  if (Array.isArray(record.assets)) return record.assets;
  if (Array.isArray(record.asset_plan)) return record.asset_plan;
  const serialized = record.Asset_Plan_JSON || record.Asset_Plan || "";
  if (!serialized) return null;
  try {
    const parsed = JSON.parse(serialized);
    return Array.isArray(parsed) ? parsed : parsed.assets;
  } catch (error) {
    throw new Error(`Invalid Asset Plan JSON for ${record.Content_ID || record.content_id}: ${error.message}`);
  }
}

export function adaptV4Record(record) {
  const { hookText, priceVerified } = applyClaimSafety(record);
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
    assetOverrides: parseAssetOverrides(record),
    consistencyRules: Array.isArray(record.visual_consistency_rules) ? record.visual_consistency_rules : [],
    qualityRules: Array.isArray(record.qc_rules) ? record.qc_rules : [],
    raw: record
  };
  if (!normalized.contentId || !normalized.title || !normalized.contentType || !normalized.templateType) throw new Error("V4 content requires Content_ID, Title, Content_Type and Template_Type.");
  normalized.resolvedAssetPlan = resolveAssetPlan(normalized);
  return normalized;
}

export function normalizeContentRecord(record) {
  const schema = Number(record.Schema_Version || record.schema_version || 0);
  return schema >= 4 || record.Content_Type || record.content_type ? adaptV4Record(record) : adaptLegacyRecipe(record);
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
  return [
    `CHATGPT IMAGE SESSION — ${content.contentId} — ${content.title}`,
    `Content Type: ${content.contentType}\nTemplate: ${content.templateType}\nVisual Profile: ${content.visualProfile}\nHook Type: ${content.hookType}`,
    `Commands: N = generate the next image; R = regenerate the current image only; FIX: ... = correct the current image only. Start at ${manifest.entries[0]?.label || "the first image"}. Never advance after R or FIX. Advance exactly one generation input only when I send N. After the final generation input, N must not create another stage.`,
    "Generate exactly ONE image per response. Do not skip generation inputs. Do not render text, letters, numbers, logos or watermarks inside photographs; controlled typography is added later by the Production Console.",
    `${sourceLabel}:\n${content.contentBody}`,
    content.consistencyRules.length ? `VISUAL CONSISTENCY:\n${content.consistencyRules.join("\n")}` : "",
    content.qualityRules.length ? `QUALITY CHECK:\n${content.qualityRules.join("\n")}` : "",
    `GENERATION MANIFEST — ${manifest.expectedAssets} IMAGES\n${stages}`,
    ...manifest.entries.map((entry) => `${String(entry.sequence).padStart(2, "0")} ${entry.label} [${entry.assetType}]\n${entry.imagePrompt}${entry.overlayText ? `\nConsole overlay: ${entry.overlayText}` : ""}`)
  ].filter(Boolean).join("\n\n");
}

export function matchGenerationSlot(filename, manifest) {
  const normalized = String(filename || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  if (!normalized) return null;
  const numbered = normalized.match(/(?:^|asset|image|img)(\d{1,2})/);
  if (numbered) return manifest.entries[Number(numbered[1]) - 1]?.slotId || null;
  return manifest.entries.find((entry) => {
    const slot = entry.slotId.toLowerCase().replace(/[^a-z0-9]+/g, "");
    const label = entry.label.toLowerCase().replace(/[^a-z0-9]+/g, "");
    return (slot.length > 1 && normalized.includes(slot)) || (label.length > 2 && normalized.includes(label));
  })?.slotId || null;
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
