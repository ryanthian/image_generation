import { TEMPLATE_REGISTRY } from "./content-model.mjs";
import { V4_CANARY_HEADERS } from "./v4-preappend.mjs";

export const LEGACY_RECIPE_HEADERS = Object.freeze([
  "Content_ID", "Draft_Title", "Category", "Ready_To_Post_Caption", "Full_Recipe",
  "Time_And_Servings", "Source_References", "Pattern_Notes", "Image_1_Cover_Prompt",
  "Image_2_Ingredients_Prompt", "Image_3_Method_Prompt", "Image_3_Step_1_Caption",
  "Image_3_Step_2_Caption", "Image_3_Step_3_Caption", "Image_3_Step_4_Caption",
  "Image_3_Step_5_Caption", "Image_3_Step_6_Caption", "Image_3_Final_Layout_Prompt",
  "Image_4_Closeup_Prompt", "Exact_Chinese_Overlay", "Image_Consistency_And_Negatives",
  "Quality_Check", "Affiliate_Fit", "Originality", "Status"
]);

export const INITIAL_SOURCE_SEEDS = Object.freeze([
  { sheetId: 2026091901, title: "Eunice Recipe Draft 20 - 2026-09-19", schemaFamily: "LEGACY_RECIPE" },
  { sheetId: 812541719, title: "Eunice Recipe Draft 100 - 2026-09-20", schemaFamily: "LEGACY_RECIPE" },
  { sheetId: 433728120, title: "V4_CANARY", schemaFamily: "V4_UNIVERSAL" }
]);

const V4_TEMPLATE_TYPES = Object.freeze([
  "RECIPE_STANDARD", "MISTAKE_BEFORE_AFTER", "COMPARE_CHECKLIST", "STORAGE_SEQUENCE",
  "KITCHEN_TECHNIQUE", "SAVEABLE_GUIDE", "COLLECTION_GUIDE"
]);

const RESERVED_SHEET_NAMES = new Set([
  "DASHBOARD", "SETTINGS", "CONFIG", "CONFIGURATION", "LOOKUP", "LOOKUPS", "INSTRUCTIONS", "SYSTEM",
  "CONTENT LIBRARY", "POSTING QUEUE", "FAN PAGE SPLIT PLAN", "V4_CANARY", "V4_STAGING", "V4_HOLD",
  "PRODUCTION_SHEET_REGISTRY", "PRODUCTION_PAGE_PROFILES"
]);

export function isReservedSheetName(title) {
  const normalized = String(title || "").trim().replace(/\s+/g, " ").toLocaleUpperCase();
  return RESERVED_SHEET_NAMES.has(normalized)
    || normalized.startsWith("V4_CANARY_BACKUP_")
    || normalized.startsWith("V4_CANARY_BACKUP ")
    || normalized.startsWith("V4_STAGING_RECOVERY_")
    || normalized === "COPY OF V4_CANARY";
}

export const SHEET_TEMPLATES = Object.freeze([
  Object.freeze({
    templateId: "LEGACY_RECIPE", label: "Legacy Recipe", contentType: "RECIPE", schemaVersion: 2,
    headers: LEGACY_RECIPE_HEADERS, description: "Existing 25-column recipe sheet; legacy image workflow."
  }),
  ...V4_TEMPLATE_TYPES.map((templateType) => Object.freeze({
    templateId: `V4_${templateType}`,
    label: `${templateType.replaceAll("_", " ")} · V4`,
    contentType: TEMPLATE_REGISTRY[templateType].compatible_content_types[0],
    templateType,
    schemaVersion: 4,
    headers: V4_CANARY_HEADERS,
    description: "Strict V4 universal content schema. Each row selects its registered content/template contract."
  }))
]);

function normalizedHeaders(headers) {
  if (!Array.isArray(headers)) return { headers: [], duplicates: [] };
  const values = headers.map((value) => String(value ?? "").trim());
  const seen = new Set();
  const duplicates = [];
  for (const value of values) {
    if (!value) continue;
    if (seen.has(value)) duplicates.push(value);
    seen.add(value);
  }
  return { headers: values, duplicates };
}

export function inspectSheetHeaders(rawHeaders) {
  const { headers, duplicates } = normalizedHeaders(rawHeaders);
  if (duplicates.length) return { schemaFamily: "UNKNOWN", schemaVersion: null, contentType: null, templateId: null, setupStatus: "NEEDS_SETUP", reasons: [`Duplicate header names: ${[...new Set(duplicates)].join(", ")}.`] };

  const legacyMissing = LEGACY_RECIPE_HEADERS.filter((header) => !headers.includes(header));
  if (!legacyMissing.length) return { schemaFamily: "LEGACY_RECIPE", schemaVersion: 2, contentType: "RECIPE", templateId: "LEGACY_RECIPE", setupStatus: "READY", reasons: [] };

  const v4Missing = V4_CANARY_HEADERS.filter((header) => !headers.includes(header));
  if (!v4Missing.length) return { schemaFamily: "V4_UNIVERSAL", schemaVersion: 4, contentType: "ROW_DEFINED", templateId: "V4_UNIVERSAL", setupStatus: "READY", reasons: [] };

  const v4Common = V4_CANARY_HEADERS.filter((header) => headers.includes(header));
  const legacyCommon = LEGACY_RECIPE_HEADERS.filter((header) => headers.includes(header));
  if (v4Common.length || legacyCommon.length) {
    const likely = v4Common.length >= legacyCommon.length ? v4Missing : legacyMissing;
    return {
      schemaFamily: "UNKNOWN", schemaVersion: null, contentType: null, templateId: null,
      setupStatus: "NEEDS_SETUP", reasons: [`Unsupported/incomplete content schema; missing required headers: ${likely.slice(0, 12).join(", ")}${likely.length > 12 ? "…" : ""}.`]
    };
  }
  return { schemaFamily: "UNKNOWN", schemaVersion: null, contentType: null, templateId: null, setupStatus: "NEEDS_SETUP", reasons: ["No supported content schema could be identified from the header row."] };
}

export function getSheetTemplate(templateId) {
  return SHEET_TEMPLATES.find((template) => template.templateId === templateId) || null;
}

export function publicSheetTemplate(template) {
  if (!template) return null;
  return { templateId: template.templateId, label: template.label, contentType: template.contentType, templateType: template.templateType || "", schemaVersion: template.schemaVersion, headers: [...template.headers], description: template.description };
}
