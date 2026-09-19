import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const base = JSON.parse(await readFile(resolve("../Facebook Page Pattern Vault/data/eunice_draft20_sheet_payload.json"), "utf8"));
const methods = JSON.parse(await readFile(resolve("../Facebook Page Pattern Vault/workbook-upgrades/method-captions-v2/method-caption-payload.json"), "utf8"));
const methodById = new Map(methods.rows.map((row) => [row.contentId, row.values]));
const wanted = [
  "Content_ID", "Draft_Title", "Category", "Ready_To_Post_Caption", "Full_Recipe",
  "Image_1_Cover_Prompt", "Image_2_Ingredients_Prompt", "Image_3_Method_Prompt",
  "Image_3_Step_1_Caption", "Image_3_Step_2_Caption", "Image_3_Step_3_Caption",
  "Image_3_Step_4_Caption", "Image_3_Step_5_Caption", "Image_3_Step_6_Caption",
  "Image_3_Final_Layout_Prompt", "Image_4_Closeup_Prompt", "Exact_Chinese_Overlay",
  "Image_Consistency_And_Negatives", "Quality_Check", "Status"
];
const sourceRows = base.rows.map((values) => Object.fromEntries(base.headers.map((header, index) => [header, values[index] ?? ""])));
const recipes = sourceRows.map((row) => {
  const method = methodById.get(row.Content_ID);
  if (!method) throw new Error(`Missing method captions for ${row.Content_ID}`);
  const merged = {
    ...row,
    Image_3_Method_Prompt: method[0],
    Image_3_Step_1_Caption: method[1],
    Image_3_Step_2_Caption: method[2],
    Image_3_Step_3_Caption: method[3],
    Image_3_Step_4_Caption: method[4],
    Image_3_Step_5_Caption: method[5],
    Image_3_Step_6_Caption: method[6],
    Image_3_Final_Layout_Prompt: method[7]
  };
  return Object.fromEntries(wanted.map((header) => [header, merged[header] ?? ""]));
});
await mkdir("data", { recursive: true });
await writeFile("data/recipes.json", JSON.stringify({
  spreadsheetId: "1AVWQTZarym7Q4nhCYrZdARVVJDluWCMol8maPR_aN4s",
  sheetName: "Eunice Recipe Draft 20 - 2026-09-19",
  headers: wanted,
  recipes
}, null, 2));
console.log(`Wrote ${recipes.length} recipes.`);
