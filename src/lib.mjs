import {
  adaptLegacyRecipe,
  buildGenerationManifest,
  buildSessionPrompt as buildUniversalSessionPrompt,
  extractIngredients,
  legacyMethodVisual,
  matchGenerationSlot,
  normalizeContentRecord,
  parseLegacyOverlay
} from "./content-model.mjs";

export const REQUIRED_HEADERS = [
  "Content_ID",
  "Draft_Title",
  "Category",
  "Ready_To_Post_Caption",
  "Full_Recipe",
  "Image_1_Cover_Prompt",
  "Image_2_Ingredients_Prompt",
  "Image_3_Method_Prompt",
  "Image_3_Step_1_Caption",
  "Image_3_Step_2_Caption",
  "Image_3_Step_3_Caption",
  "Image_3_Step_4_Caption",
  "Image_3_Step_5_Caption",
  "Image_3_Step_6_Caption",
  "Image_3_Final_Layout_Prompt",
  "Image_4_Closeup_Prompt",
  "Exact_Chinese_Overlay",
  "Image_Consistency_And_Negatives",
  "Quality_Check",
  "Status"
];

export const STAGES = ["cover", "ingredients", "m1", "m2", "m3", "m4", "m5", "m6", "closeup"];

export function rowsToRecipes(headers, rows) {
  const missing = REQUIRED_HEADERS.filter((header) => !headers.includes(header));
  if (missing.length) throw new Error(`Missing required headers: ${missing.join(", ")}`);
  return rows
    .map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""])))
    .filter((row) => row.Content_ID);
}

export const parseOverlay = parseLegacyOverlay;
export { extractIngredients };
export const methodVisual = legacyMethodVisual;

export function buildSessionPrompt(record) {
  return buildUniversalSessionPrompt(record.resolvedAssetPlan ? record : normalizeContentRecord(record));
}

export function fileSlot(name = "") {
  const sample = adaptLegacyRecipe({
    Content_ID: "legacy",
    Draft_Title: "legacy",
    Image_3_Method_Prompt: "",
    Image_1_Cover_Prompt: "",
    Image_2_Ingredients_Prompt: "",
    Image_4_Closeup_Prompt: ""
  });
  return matchGenerationSlot(name, buildGenerationManifest(sample));
}
