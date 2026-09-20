import { mkdir, readFile, writeFile, copyFile } from "node:fs/promises";

const [template, data, index, css, app, intelligence] = await Promise.all([
  readFile("src/worker.template.mjs", "utf8"),
  readFile("data/recipes.json", "utf8"),
  readFile("public/index.html", "utf8"),
  readFile("public/styles.css", "utf8"),
  readFile("public/app.js", "utf8"),
  readFile("public/intelligence.js", "utf8")
]);
const output = template
  .replace("__RECIPES_JSON__", data.trim())
  .replace("__INDEX_HTML__", JSON.stringify(index))
  .replace("__STYLES_CSS__", JSON.stringify(css))
  .replace("__APP_JS__", JSON.stringify(app))
  .replace("__INTELLIGENCE_JS__", JSON.stringify(intelligence));
await mkdir("dist/server", { recursive: true });
await mkdir("dist/.openai", { recursive: true });
await writeFile("dist/server/index.js", output);
await copyFile("src/intelligence-core.mjs", "dist/server/intelligence-core.mjs");
await copyFile("src/intelligence-server.mjs", "dist/server/intelligence-server.mjs");
await copyFile("src/facebook-collection-core.mjs", "dist/server/facebook-collection-core.mjs");
await copyFile(".openai/hosting.json", "dist/.openai/hosting.json");
console.log("Built dist/server/index.js");
