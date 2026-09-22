import {
  TEMPLATE_REGISTRY,
  buildGenerationManifest,
  normalizeContentRecord,
  runContentQc,
  validateResolvedContent
} from "./content-model.mjs";

export const V4_CANARY_HEADERS = Object.freeze([
  "Schema_Version", "Content_ID", "Title", "Topic", "Content_Type", "Template_Type",
  "Visual_Profile", "Hook_Type", "Hook_Text", "Ready_To_Post_Caption", "Content_Body",
  "Source_References", "Affiliate_Fit", "Monetization_Angle", "Asset_Plan_JSON", "Status"
]);

const requiredRowFields = ["Content_ID", "Title", "Content_Type", "Template_Type", "Visual_Profile", "Hook_Type", "Hook_Text", "Content_Body", "Asset_Plan_JSON"];
const recipeAdvice = "Suggested supported contract: DRINK + RECIPE_STANDARD.";

function rejected(record, error) {
  const contentId = String(record?.Content_ID || record?.content_id || "(missing)");
  const templateType = String(record?.Template_Type || record?.template_type || "(missing)");
  const detail = String(error?.message || error);
  const suggestion = templateType === "DRINK_STANDARD" ? ` ${recipeAdvice}` : "";
  return {
    ok: false,
    status: "REJECTED",
    contentId,
    templateType,
    reason: `${detail}${suggestion}`.trim()
  };
}

function parseExplicitPlan(record) {
  const raw = record.Asset_Plan_JSON;
  if (typeof raw !== "string" || !raw.trim()) throw new Error("Asset_Plan_JSON is required.");
  let parsed;
  try { parsed = JSON.parse(raw); } catch (error) { throw new Error(`Invalid Asset_Plan_JSON: ${error.message}`); }
  const assets = Array.isArray(parsed) ? parsed : parsed?.assets;
  if (!Array.isArray(assets) || !assets.length) throw new Error("Asset_Plan_JSON must contain a non-empty assets array.");
  return { parsed, assets, coveragePoints: Array.isArray(parsed?.coverage_points) ? parsed.coverage_points : [], sourceIngredients: Array.isArray(parsed?.source_ingredients) ? parsed.source_ingredients : [] };
}

function nonEmpty(value) { return typeof value === "string" && value.trim().length > 0; }

function validateExplicitAssets(record, plan) {
  for (const field of requiredRowFields) if (!nonEmpty(record[field])) throw new Error(`${field} is required.`);
  if (String(record.Schema_Version) !== "4") throw new Error("Schema_Version must be the opaque string value 4.");
  if (typeof record.Content_ID !== "string" || !record.Content_ID.trim()) throw new Error("Content_ID must be a non-empty opaque string.");
  if (!TEMPLATE_REGISTRY[record.Template_Type]) throw new Error(`Unknown Template_Type: ${record.Template_Type}`);
  for (const [index, asset] of plan.assets.entries()) {
    for (const field of ["asset_id", "asset_type", "title", "purpose", "layout_type", "overlay_text", "image_prompt"]) {
      if (!nonEmpty(String(asset?.[field] ?? ""))) throw new Error(`Asset ${index + 1} is missing ${field}.`);
    }
    if (typeof asset.required !== "boolean") throw new Error(`Asset ${asset.asset_id} must declare required as boolean.`);
    const inputs = asset.generation_inputs;
    if (inputs !== undefined && (!Array.isArray(inputs) || !inputs.length)) throw new Error(`Asset ${asset.asset_id} has invalid generation_inputs.`);
    for (const input of inputs || []) {
      for (const field of ["slot_id", "label", "image_prompt"]) if (!nonEmpty(String(input?.[field] ?? ""))) throw new Error(`Generation input in ${asset.asset_id} is missing ${field}.`);
      if (typeof input.required !== "boolean") throw new Error(`Generation input ${input.slot_id || "(missing)"} must declare required as boolean.`);
    }
  }
}

function validateGenerationReadiness(content, explicitPlan) {
  const manifest = buildGenerationManifest(content);
  if (!manifest.entries.length || manifest.entries.some((entry) => !nonEmpty(entry.imagePrompt))) throw new Error("Every generation input requires a non-empty image_prompt.");
  if (content.templateType === "RECIPE_STANDARD") {
    const ingredients = content.resolvedAssetPlan.find((asset) => asset.asset_type === "INGREDIENTS");
    const method = content.resolvedAssetPlan.find((asset) => asset.asset_type === "METHOD");
    if (!ingredients || !method) throw new Error("RECIPE_STANDARD requires INGREDIENTS and METHOD assets for generation readiness.");
    if (!explicitPlan.sourceIngredients.length) throw new Error("RECIPE_STANDARD requires source_ingredients from the source of truth.");
    if (method.generation_inputs.length < 2) throw new Error("RECIPE_STANDARD METHOD requires at least two explicit chronological generation inputs.");
    for (const input of method.generation_inputs) {
      if (!nonEmpty(input.method_step_id) || !nonEmpty(input.step_heading) || !nonEmpty(input.step_supporting_text)) throw new Error(`METHOD input ${input.slot_id} requires method_step_id, step_heading and step_supporting_text.`);
    }
  }
  if (!explicitPlan.coveragePoints.length) throw new Error("coverage_points are required for source-of-truth coverage.");
  const qc = runContentQc(content);
  if (qc.failures.length) throw new Error(qc.failures.map((item) => `${item.code}: ${item.detail}`).join("; "));
  const resolved = validateResolvedContent(content);
  if (!resolved.valid || resolved.requiredSlots.length === 0) throw new Error("Resolved content is not generation-ready.");
  return { manifest, qc, resolved };
}

/** Compile and strictly validate a complete row before any sheet append is attempted. */
export function compileV4CanaryCandidate(candidate) {
  const record = { ...candidate };
  try {
    const explicitPlan = parseExplicitPlan(record);
    validateExplicitAssets(record, explicitPlan);
    const content = normalizeContentRecord(record);
    const generation = validateGenerationReadiness(content, explicitPlan);
    return { ok: true, status: "PASS", record, content, ...generation };
  } catch (error) {
    return rejected(record, error);
  }
}

/**
 * The only allowed write seam. The append callback is never reached for a
 * rejected candidate, which prevents partial production rows.
 */
export async function appendCompiledV4CanaryCandidate(candidate, append) {
  const compiled = compileV4CanaryCandidate(candidate);
  if (!compiled.ok) return compiled;
  if (typeof append !== "function") throw new Error("append callback is required for a validated candidate.");
  await append(V4_CANARY_HEADERS.map((header) => compiled.record[header] ?? ""));
  return { ...compiled, appended: true };
}
