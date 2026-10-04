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
const productionCore = await readFile("src/production-core.mjs", "utf8");
const contentQuality = await readFile("src/content-quality.mjs", "utf8");
const fastVisualPlan=await readFile('src/fast-visual-plan.mjs','utf8');
const batchProduction=await readFile('src/batch-production.mjs','utf8');
const productionAssistant = await readFile('src/production-assistant.mjs','utf8');
const editorialPipeline = await readFile('src/editorial-pipeline.mjs','utf8');
const batch01 = await readFile('output/production-batch-01.json','utf8');
const canonicalMap = await readFile('output/canonical-content-map.json','utf8');
const buildInfo = { commit: (await import("node:child_process")).execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), builtAt: new Date().toISOString() };
const output = template
  .replace("__BUILD_INFO_JSON__", () => JSON.stringify(buildInfo))
  .replace("__PRODUCTION_CORE_JS__", () => JSON.stringify(productionCore))
  .replace("__CONTENT_QUALITY_JS__", () => JSON.stringify(contentQuality))
  .replace('__FAST_VISUAL_PLAN_JS__',()=>JSON.stringify(fastVisualPlan))
  .replace('__BATCH_PRODUCTION_JS__',()=>JSON.stringify(batchProduction))
  .replace('__PRODUCTION_ASSISTANT_JS__',()=>JSON.stringify(productionAssistant))
  .replace('__EDITORIAL_PIPELINE_JS__',()=>JSON.stringify(editorialPipeline))
  .replace('__BATCH_01_JSON__',()=>batch01.trim())
  .replace('__CANONICAL_MAP_JSON__',()=>canonicalMap.trim())
  .replace("__RECIPES_JSON__", () => data.trim())
  .replace("__CANARY_JSON__", () => canary.trim())
  .replace("__V42_HISTORY_JSON__", performanceHistory.trim())
  .replace("__INDEX_HTML__", () => JSON.stringify(index))
  .replace("__STYLES_CSS__", () => JSON.stringify(css))
  .replace("__APP_JS__", () => JSON.stringify(app))
  .replace("__CONTENT_MODEL_JS__", () => JSON.stringify(contentModel))
  .replace("__INTELLIGENCE_JS__", () => JSON.stringify(intelligence))
  .replace("__OPPORTUNITIES_JS__", () => JSON.stringify(opportunities));
await mkdir("dist/server", { recursive: true });
await mkdir("dist/.openai", { recursive: true });
await mkdir("dist/.openai/drizzle/meta", { recursive: true });
await writeFile("dist/server/index.js", output);
await copyFile("src/intelligence-core.mjs", "dist/server/intelligence-core.mjs");
await copyFile("src/intelligence-server.mjs", "dist/server/intelligence-server.mjs");
await copyFile("src/opportunity-engine.mjs", "dist/server/opportunity-engine.mjs");
await copyFile("src/content-model.mjs", "dist/server/content-model.mjs");
await copyFile("src/content-quality.mjs", "dist/server/content-quality.mjs");
await copyFile('src/editorial-pipeline.mjs','dist/server/editorial-pipeline.mjs');
await copyFile("src/apps-script-bridge.mjs", "dist/server/apps-script-bridge.mjs");
await copyFile("src/sheet-registry-cache.mjs", "dist/server/sheet-registry-cache.mjs");
await copyFile("src/production-operations.mjs", "dist/server/production-operations.mjs");
await copyFile("src/sheet-contracts.mjs", "dist/server/sheet-contracts.mjs");
await copyFile("src/v4-preappend.mjs", "dist/server/v4-preappend.mjs");
await copyFile("src/facebook-collection-core.mjs", "dist/server/facebook-collection-core.mjs");
await copyFile(".openai/hosting.json", "dist/.openai/hosting.json");
await Promise.all([
  copyFile("db/migrations/0001_content_intelligence.sql", "dist/.openai/drizzle/0001_content_intelligence.sql"),
  copyFile("db/migrations/0002_facebook_observed_collection.sql", "dist/.openai/drizzle/0002_facebook_observed_collection.sql"),
  copyFile("db/migrations/0003_gate_a3_dataset_provenance.sql", "dist/.openai/drizzle/0003_gate_a3_dataset_provenance.sql"),
  copyFile("db/migrations/0004_production_operations.sql", "dist/.openai/drizzle/0004_production_operations.sql")
]);
await writeFile("dist/.openai/drizzle/meta/_journal.json", `${JSON.stringify({ version: "7", dialect: "sqlite", entries: [] }, null, 2)}\n`);
console.log("Built dist/server/index.js");
