import { mkdir, readFile, writeFile, copyFile } from "node:fs/promises";

const [template, data, canary, performanceHistory, index, css, app, contentModel, intelligence, opportunities] = await Promise.all([
  readFile("src/worker.template.mjs", "utf8"),
  readFile("data/recipes.json", "utf8"),
  readFile("data/content-v4-canary.json", "utf8"),
  readFile("data/v4-2-historical-performance.json", "utf8"),
  readFile("public/index.html", "utf8"),
  readFile("public/styles.css", "utf8"),
  readFile("public/app.js", "utf8"),
  readFile("src/content-model.mjs", "utf8"),
  readFile("public/intelligence.js", "utf8"),
  readFile("public/opportunities.js", "utf8")
]);
const output = template
  .replace("__RECIPES_JSON__", data.trim())
  .replace("__CANARY_JSON__", canary.trim())
  .replace("__V42_HISTORY_JSON__", performanceHistory.trim())
  .replace("__INDEX_HTML__", JSON.stringify(index))
  .replace("__STYLES_CSS__", JSON.stringify(css))
  .replace("__APP_JS__", JSON.stringify(app))
  .replace("__CONTENT_MODEL_JS__", JSON.stringify(contentModel))
  .replace("__INTELLIGENCE_JS__", JSON.stringify(intelligence))
  .replace("__OPPORTUNITIES_JS__", JSON.stringify(opportunities));
await mkdir("dist/server", { recursive: true });
await mkdir("dist/.openai", { recursive: true });
await mkdir("dist/.openai/drizzle/meta", { recursive: true });
await writeFile("dist/server/index.js", output);
await copyFile("src/intelligence-core.mjs", "dist/server/intelligence-core.mjs");
await copyFile("src/intelligence-server.mjs", "dist/server/intelligence-server.mjs");
await copyFile("src/opportunity-engine.mjs", "dist/server/opportunity-engine.mjs");
await copyFile("src/facebook-collection-core.mjs", "dist/server/facebook-collection-core.mjs");
await copyFile(".openai/hosting.json", "dist/.openai/hosting.json");
await Promise.all([
  copyFile("db/migrations/0001_content_intelligence.sql", "dist/.openai/drizzle/0001_content_intelligence.sql"),
  copyFile("db/migrations/0002_facebook_observed_collection.sql", "dist/.openai/drizzle/0002_facebook_observed_collection.sql"),
  copyFile("db/migrations/0003_gate_a3_dataset_provenance.sql", "dist/.openai/drizzle/0003_gate_a3_dataset_provenance.sql")
]);
await writeFile("dist/.openai/drizzle/meta/_journal.json", `${JSON.stringify({ version: "7", dialect: "sqlite", entries: [] }, null, 2)}\n`);
console.log("Built dist/server/index.js");
