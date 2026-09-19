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

export function parseOverlay(recipe) {
  const overlay = recipe.Exact_Chinese_Overlay || "";
  const cover = overlay.match(/图1：([^\n]+)/)?.[1]?.trim() || recipe.Draft_Title;
  const ingredients = overlay.match(/图2：食材准备\s*\n([\s\S]*?)\n图3：做法步骤/)?.[1]?.trim() || extractIngredients(recipe.Full_Recipe);
  const closeup = overlay.match(/图4：([^\n]+)/)?.[1]?.trim() || "";
  return { cover, ingredients, closeup };
}

export function extractIngredients(fullRecipe = "") {
  return fullRecipe.match(/(?:^|\n)食材\s*\n([\s\S]*?)(?:\n\n做法|\n做法)/)?.[1]?.trim() || "";
}

export function splitCaption(caption = "") {
  const [title = "", ...rest] = caption.split(/\n/);
  return { title: title.trim(), body: rest.join(" ").trim() };
}

export function methodVisual(methodPrompt = "", index) {
  const next = index + 1;
  const pattern = new RegExp(`Panel ${index}[^:]*:\\s*([\\s\\S]*?)(?=\\nPanel ${next}[^:]*:|\\nMaintain exact|$)`, "i");
  const block = methodPrompt.match(pattern)?.[1]?.trim();
  return block || `Create only the photograph for cooking step ${index}; follow the exact supplied step caption.`;
}

function commonPrefix(strings) {
  if (!strings.length) return "";
  let prefix = strings[0];
  for (const value of strings.slice(1)) {
    let index = 0;
    while (index < prefix.length && index < value.length && prefix[index] === value[index]) index += 1;
    prefix = prefix.slice(0, index);
  }
  const boundary = Math.max(prefix.lastIndexOf("\n"), prefix.lastIndexOf(". "));
  return boundary > 120 ? prefix.slice(0, boundary + 1).trim() : "";
}

export function buildSessionPrompt(recipe) {
  const photoPrompts = [recipe.Image_1_Cover_Prompt, recipe.Image_2_Ingredients_Prompt, recipe.Image_4_Closeup_Prompt].filter(Boolean);
  const shared = commonPrefix(photoPrompts);
  const trimShared = (value = "") => shared && value.startsWith(shared) ? value.slice(shared.length).trim() : value.trim();
  const methodStages = Array.from({ length: 6 }, (_, offset) => {
    const index = offset + 1;
    const caption = recipe[`Image_3_Step_${index}_Caption`] || "";
    return `M${index}: ${methodVisual(recipe.Image_3_Method_Prompt, index)}\nExact step: ${caption}`;
  });
  return [
    `CHATGPT IMAGE SESSION — ${recipe.Content_ID} — ${recipe.Draft_Title}`,
    "Commands: N = generate the next stage; R = regenerate the current stage; FIX: ... = correct only the current stage. Start at COVER. Never advance unless I send N.",
    "Generate exactly ONE image per response. Every image must be a portrait 4:5 photograph. No text, letters, numbers, logos or watermarks inside photographs. Keep the same kitchen, cookware, lighting, ingredient cuts and food identity across this recipe. Preserve chronological raw-to-cooked state. This recipe alone is the source of truth.",
    `RECIPE:\n${recipe.Full_Recipe}`,
    shared ? `SHARED PHOTO STYLE:\n${shared}` : "",
    `CONSISTENCY / NEGATIVES:\n${recipe.Image_Consistency_And_Negatives}`,
    `QUALITY CHECK:\n${recipe.Quality_Check}`,
    "STAGES — COVER → INGREDIENTS → M1 → M2 → M3 → M4 → M5 → M6 → CLOSEUP",
    `COVER: ${trimShared(recipe.Image_1_Cover_Prompt)}`,
    `INGREDIENTS: ${trimShared(recipe.Image_2_Ingredients_Prompt)}`,
    ...methodStages,
    `CLOSEUP: ${trimShared(recipe.Image_4_Closeup_Prompt)}`
  ].filter(Boolean).join("\n\n");
}

export function fileSlot(name = "") {
  const normalized = name.toLowerCase().replace(/[^a-z0-9]+/g, "");
  if (/cover|hero|image1/.test(normalized)) return "cover";
  if (/ingredient|image2/.test(normalized)) return "ingredients";
  if (/closeup|detail|image4/.test(normalized)) return "closeup";
  const match = normalized.match(/(?:^|method|step|panel|m)([1-6])(?:$|[^0-9])/);
  return match ? `m${match[1]}` : null;
}
