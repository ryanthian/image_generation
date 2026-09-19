import { mkdir, readFile, writeFile, copyFile } from "node:fs/promises";

const [template, data, index, css, app] = await Promise.all([
  readFile("src/worker.template.mjs", "utf8"),
  readFile("data/recipes.json", "utf8"),
  readFile("public/index.html", "utf8"),
  readFile("public/styles.css", "utf8"),
  readFile("public/app.js", "utf8")
]);
const output = template
  .replace("__RECIPES_JSON__", data.trim())
  .replace("__INDEX_HTML__", JSON.stringify(index))
  .replace("__STYLES_CSS__", JSON.stringify(css))
  .replace("__APP_JS__", JSON.stringify(app));
await mkdir("dist/server", { recursive: true });
await mkdir("dist/.openai", { recursive: true });
await writeFile("dist/server/index.js", output);
await copyFile(".openai/hosting.json", "dist/.openai/hosting.json");
console.log("Built dist/server/index.js");
