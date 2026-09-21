import {
  buildAssetFilename,
  buildGenerationManifest,
  buildSessionPrompt,
  calculateAdaptivePanel,
  calculateMethodGrid,
  matchGenerationSlot,
  normalizeContentRecord,
  runContentQc
} from "/content-model.js";

const state = {
  records: [],
  filtered: [],
  content: null,
  plan: [],
  manifest: { entries: [], expectedAssets: 0 },
  images: {},
  assets: {},
  writable: false,
  source: "snapshot",
  sourceName: "",
  sources: []
};
const $ = (id) => document.getElementById(id);
const escapeHtml = (value = "") => String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
let toastTimer;

function toast(message, error) {
  const node = $("toast");
  node.textContent = message;
  node.className = `toast show${error ? " error" : ""}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { node.className = "toast"; }, 3600);
}

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("content-ai-production-console-v1", 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("images")) db.createObjectStore("images");
      if (!db.objectStoreNames.contains("assets")) db.createObjectStore("assets");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function idb(store, mode, action) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const result = action(tx.objectStore(store));
    tx.oncomplete = () => resolve(result && result.result);
    tx.onerror = () => reject(tx.error);
  }).finally(() => db.close());
}

const getStored = (store, key) => idb(store, "readonly", (objectStore) => objectStore.get(key));
const putStored = (store, key, value) => idb(store, "readwrite", (objectStore) => objectStore.put(value, key));
const deleteStored = (store, key) => idb(store, "readwrite", (objectStore) => objectStore.delete(key));
const keyFor = (kind, name) => `${state.sourceName}:${state.content.contentId}:${kind}:${name}`;
const assetSemanticKey = (item) => JSON.stringify({ layout: item.layout_type, text: item.overlay_text, heading: item.local_heading, inputs: item.generation_inputs.map((input) => [input.slot_id, input.overlay_text]), sources: item.source_input_ids || [] });

async function copyText(value, message) {
  try {
    await navigator.clipboard.writeText(value);
    toast(message);
  } catch (_) {
    const area = document.createElement("textarea");
    area.value = value;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    document.execCommand("copy");
    area.remove();
    toast(message);
  }
}

function imageUrl(value) {
  return value?.blob ? URL.createObjectURL(value.blob) : "";
}

function renderManifest() {
  $("manifestCount").textContent = `Generation Images: ${state.manifest.expectedAssets} · Final Assets: ${state.plan.length}`;
  $("manifestList").innerHTML = state.manifest.entries.map((entry) =>
    `<li><b>${String(entry.sequence).padStart(2, "0")}</b><span>${escapeHtml(entry.label)}</span><small>${escapeHtml(entry.assetType)}</small></li>`
  ).join("");
}

function renderSlots() {
  const container = $("slots");
  container.innerHTML = "";
  for (const entry of state.manifest.entries) {
    const stored = state.images[entry.slotId];
    const node = document.createElement("article");
    const stale = Boolean(stored && entry.regenRequiredReason && stored.semanticKey !== entry.semanticKey);
    node.className = `slot${stored ? " ready" : ""}${stale ? " stale" : ""}`;
    node.dataset.slot = entry.slotId;
    node.innerHTML = `
      <div class="slot-preview">${stored ? `<img alt="${escapeHtml(entry.label)} imported image">` : `<div class="slot-empty"><b>${String(entry.sequence).padStart(2, "0")} · ${escapeHtml(entry.label)}</b><span>${escapeHtml(entry.assetType)} · Drop PNG, JPG or WebP</span></div>`}</div>
      <div class="slot-footer">
        <div><div class="slot-name">${String(entry.sequence).padStart(2, "0")} · ${escapeHtml(entry.label)}</div><div class="slot-state">${stale ? `REGEN REQUIRED · ${escapeHtml(entry.regenRequiredReason)}` : stored ? "Complete" : entry.required ? "Required" : "Optional"}</div></div>
        <div class="slot-actions"><button type="button" data-choose>${stored ? "Replace" : "Choose"}</button>${stored ? '<button type="button" data-remove>Remove</button>' : ""}</div>
        <input type="file" accept="image/png,image/jpeg,image/webp" hidden>
      </div>`;
    if (stored) node.querySelector("img").src = imageUrl(stored);
    const input = node.querySelector("input");
    node.querySelector("[data-choose]").addEventListener("click", () => input.click());
    input.addEventListener("change", () => input.files[0] && saveImage(entry.slotId, input.files[0]));
    node.querySelector("[data-remove]")?.addEventListener("click", () => removeImage(entry.slotId));
    for (const event of ["dragenter", "dragover"]) node.addEventListener(event, (e) => { e.preventDefault(); node.classList.add("dragover"); });
    for (const event of ["dragleave", "drop"]) node.addEventListener(event, (e) => { e.preventDefault(); node.classList.remove("dragover"); });
    node.addEventListener("drop", (e) => e.dataTransfer.files[0] && saveImage(entry.slotId, e.dataTransfer.files[0]));
    container.appendChild(node);
  }
  updateProgress();
}

function renderAssets() {
  const container = $("assetGrid");
  container.innerHTML = "";
  for (const assetItem of state.plan) {
    const stored = state.assets[assetItem.asset_id];
    const node = document.createElement("article");
    node.className = "asset";
    node.dataset.asset = assetItem.asset_id;
    node.innerHTML = `<div class="asset-preview">${stored ? `<img alt="${escapeHtml(assetItem.title)}">` : "Not built"}</div><div class="asset-footer"><div><strong>${String(assetItem.sequence).padStart(2, "0")} · ${escapeHtml(assetItem.title)}</strong><small>${escapeHtml(assetItem.asset_type)}</small></div><button type="button" ${stored ? "" : "disabled"}>Download</button></div>`;
    if (stored) node.querySelector("img").src = imageUrl(stored);
    node.querySelector("button").addEventListener("click", () => stored && downloadBlob(stored.blob, stored.filename));
    container.appendChild(node);
  }
  $("downloadAll").disabled = state.plan.some((item) => item.required && !state.assets[item.asset_id]);
  updateProgress();
}

function updateProgress() {
  const requiredEntries = state.manifest.entries.filter((entry) => entry.required);
  const imported = requiredEntries.filter((entry) => state.images[entry.slotId]).length;
  const built = state.plan.filter((item) => state.assets[item.asset_id]).length;
  const total = requiredEntries.length + state.plan.length;
  const percent = total ? Math.round(((imported + built) / total) * 100) : 0;
  $("progressText").textContent = `${imported} / ${requiredEntries.length}`;
  $("progressBar").style.width = `${requiredEntries.length ? (imported / requiredEntries.length) * 100 : 0}%`;
  $("completionRing").style.setProperty("--progress", `${percent}%`);
  $("completionRing").querySelector("strong").textContent = `${percent}%`;
}

async function saveImage(slotId, file) {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) return toast("Use a PNG, JPG or WebP image.", true);
  if (file.size > 35 * 1024 * 1024) return toast("Image is larger than 35 MB.", true);
  const entry = state.manifest.entries.find((item) => item.slotId === slotId);
  const value = { blob: file, name: file.name, type: file.type, semanticKey: entry?.semanticKey || "", updatedAt: Date.now() };
  await putStored("images", keyFor("image", slotId), value);
  state.images[slotId] = value;
  renderSlots();
  renderQc();
}

async function removeImage(slotId) {
  await deleteStored("images", keyFor("image", slotId));
  delete state.images[slotId];
  renderSlots();
  renderQc();
  toast("Image removed. Import a replacement before building.");
}

async function importMany(files) {
  const valid = Array.from(files).filter((file) => /^image\/(png|jpeg|webp)$/.test(file.type));
  if (!valid.length) return toast("No supported images selected.", true);
  const byId = new Map(state.manifest.entries.map((entry) => [entry.slotId, entry]));
  const assigned = new Set();
  const pending = [];
  let named = 0;
  for (const file of valid) {
    const mapped = matchGenerationSlot(file.name, state.manifest);
    if (mapped && byId.has(mapped) && !assigned.has(mapped)) {
      await saveImage(mapped, file);
      assigned.add(mapped);
      named += 1;
    } else {
      pending.push(file);
    }
  }
  const available = state.manifest.entries.map((entry) => entry.slotId).filter((slotId) => !assigned.has(slotId) && !state.images[slotId]);
  let sequential = 0;
  for (let index = 0; index < pending.length && index < available.length; index += 1) {
    await saveImage(available[index], pending[index]);
    sequential += 1;
  }
  const ignored = valid.length - named - sequential;
  const detail = [named ? `${named} matched by filename` : "", sequential ? `${sequential} assigned by manifest order` : "", ignored ? `${ignored} extra ignored` : ""].filter(Boolean).join("; ");
  toast(`${named + sequential} image${named + sequential === 1 ? "" : "s"} imported. ${detail}`, Boolean(ignored));
  $("allFiles").value = "";
}

async function loadContentState() {
  state.images = {};
  state.assets = {};
  await Promise.all(state.manifest.entries.map(async (entry) => {
    const value = await getStored("images", keyFor("image", entry.slotId));
    if (value) state.images[entry.slotId] = value;
  }));
  await Promise.all(state.plan.map(async (item) => {
    const value = await getStored("assets", keyFor("asset", item.asset_id));
    if (value?.semanticKey === assetSemanticKey(item)) state.assets[item.asset_id] = value;
  }));
  renderSlots();
  renderAssets();
  renderQc();
}

function applyContent(content) {
  state.content = content;
  state.plan = content.resolvedAssetPlan;
  state.manifest = buildGenerationManifest(content);
  localStorage.setItem(`capc:selectedContent:${state.sourceName}`, content.contentId);
  $("sideRecipe").textContent = content.title;
  $("sideId").textContent = content.contentId;
  $("contentId").textContent = content.contentId;
  $("category").textContent = content.topic;
  $("status").textContent = content.lifecycleStatus;
  $("status").classList.toggle("posted", content.lifecycleStatus === "PUBLISHED" || content.lifecycleStatus === "Posted");
  $("title").textContent = content.title;
  $("captionPreview").textContent = content.caption;
  $("recipeSelect").value = content.contentId;
  $("contentType").textContent = content.contentType;
  $("templateType").textContent = content.templateType;
  $("visualProfile").textContent = content.visualProfile;
  $("hookType").textContent = content.hookType;
  $("hookText").textContent = content.hookText;
  $("slotHeading").textContent = `${state.manifest.expectedAssets} generation slots`;
  $("slotHelper").textContent = `Import in manifest order: ${state.manifest.entries.map((entry) => entry.label).join(" → ")}.`;
  $("assetHeading").textContent = `${state.plan.length} final Facebook assets`;
  renderQc();
  renderManifest();
  loadContentState().catch((error) => toast(error.message, true));
}

function renderQc() {
  const qc = runContentQc(state.content);
  const stale = state.manifest.entries.filter((entry) => entry.regenRequiredReason && state.images[entry.slotId] && state.images[entry.slotId].semanticKey !== entry.semanticKey);
  const status = qc.failures.length ? "FAIL" : stale.length || qc.warnings.length ? "WARNING" : "PASS";
  const details = [
    ...qc.failures.map((item) => `${item.code}: ${item.detail}`),
    ...qc.warnings.map((item) => `${item.code}: ${item.detail}`),
    ...stale.map((entry) => `REGEN REQUIRED: ${entry.label} — ${entry.regenRequiredReason}`)
  ];
  $("qcSummary").className = `qc-summary qc-${status.toLowerCase()}`;
  $("qcStatus").textContent = status;
  $("qcDetails").textContent = details.length ? details.join("\n") : "All deterministic source, ingredient, mapping and purpose checks passed.";
  $("publishHeading").textContent = status === "FAIL" ? "NOT READY TO POST" : "Ready to publish";
  $("markPosted").disabled = !state.writable || status === "FAIL";
}

function renderOptions(records) {
  state.filtered = records;
  const select = $("recipeSelect");
  select.innerHTML = records.map((content) => `<option value="${escapeHtml(content.contentId)}">${escapeHtml(content.contentId)} · ${escapeHtml(content.title)}</option>`).join("");
  if (state.content && records.some((content) => content.contentId === state.content.contentId)) select.value = state.content.contentId;
}

function moveContent(direction) {
  const index = state.records.findIndex((item) => item.contentId === state.content.contentId);
  const next = (index + direction + state.records.length) % state.records.length;
  renderOptions(state.records);
  applyContent(state.records[next]);
}

function canvas2d() {
  const canvas = document.createElement("canvas");
  canvas.width = 1440;
  canvas.height = 1800;
  return { canvas, context: canvas.getContext("2d", { alpha: false }) };
}

async function loadImage(blob) {
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.decoding = "async";
    image.src = url;
    await image.decode();
    return image;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

function coverDraw(context, image, x, y, width, height) {
  const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight);
  const sourceWidth = width / scale;
  const sourceHeight = height / scale;
  const sx = (image.naturalWidth - sourceWidth) / 2;
  const sy = (image.naturalHeight - sourceHeight) / 2;
  context.drawImage(image, sx, sy, sourceWidth, sourceHeight, x, y, width, height);
}

function linesFor(context, text, maxWidth) {
  const output = [];
  for (const paragraph of String(text || "").split(/\n/)) {
    if (!paragraph) { output.push(""); continue; }
    let line = "";
    const tokens = /\s/.test(paragraph) ? paragraph.split(/(\s+)/) : Array.from(paragraph);
    for (const token of tokens) {
      if (context.measureText(line + token).width > maxWidth && line) { output.push(line.trim()); line = token.trimStart(); }
      else line += token;
    }
    if (line) output.push(line.trim());
  }
  return output;
}

function drawLines(context, text, x, y, maxWidth, lineHeight, maxLines) {
  const lines = linesFor(context, text, maxWidth).slice(0, maxLines || 99);
  lines.forEach((line, index) => context.fillText(line, x, y + index * lineHeight));
  return lines.length;
}

function gradient(context, y, height, top) {
  const value = context.createLinearGradient(0, y, 0, y + height);
  if (top) { value.addColorStop(0, "rgba(0,0,0,.72)"); value.addColorStop(1, "rgba(0,0,0,0)"); }
  else { value.addColorStop(0, "rgba(0,0,0,0)"); value.addColorStop(1, "rgba(0,0,0,.78)"); }
  context.fillStyle = value;
  context.fillRect(0, y, 1440, height);
}

async function firstImageFor(assetItem) {
  const slotId = assetItem.generation_inputs[0]?.slot_id || assetItem.source_input_ids?.[0];
  if (!slotId || !state.images[slotId]) throw new Error(`Missing image for ${assetItem.title}.`);
  return loadImage(state.images[slotId].blob);
}

async function buildCoverAsset(assetItem) {
  const { canvas, context } = canvas2d();
  coverDraw(context, await firstImageFor(assetItem), 0, 0, 1440, 1800);
  gradient(context, 0, 620, true);
  context.fillStyle = "#fff";
  context.textAlign = "center";
  context.textBaseline = "alphabetic";
  context.font = '700 92px "Noto Sans SC", "PingFang SC", sans-serif';
  drawLines(context, assetItem.overlay_text || state.content.hookText || state.content.title, 720, 205, 1160, 112, 3);
  return canvas;
}

async function buildInformationAsset(assetItem) {
  const { canvas, context } = canvas2d();
  context.fillStyle = "#f4f3ef";
  context.fillRect(0, 0, 1440, 1800);
  const isIngredients = assetItem.layout_type === "ingredients_compact" || assetItem.asset_type === "INGREDIENTS";
  const label = assetItem.section_label || (isIngredients ? "食材" : assetItem.title);
  const heading = assetItem.local_heading || (state.content.schemaVersion < 4 || assetItem.asset_type === "COVER" ? state.content.title : "");
  const body = String(assetItem.overlay_text || assetItem.purpose).replace(/；/g, "\n").replace(/。$/g, "");
  context.font = '500 38px "Noto Sans SC", "PingFang SC", sans-serif';
  const metrics = calculateAdaptivePanel({ label, heading, body, measure: (text) => context.measureText(text).width });
  coverDraw(context, await firstImageFor(assetItem), 0, 0, 1440, metrics.imageHeight + 70);
  context.fillStyle = "#fff";
  context.fillRect(70, metrics.imageHeight, 1300, metrics.panelHeight - 70);
  context.fillStyle = "#f96332";
  context.font = '700 36px Montserrat, "Noto Sans SC", sans-serif';
  context.fillText(label, 130, metrics.imageHeight + 100);
  let cursorY = metrics.imageHeight + 145;
  if (heading) {
    context.fillStyle = "#252422";
    context.font = '700 58px "Noto Sans SC", "PingFang SC", sans-serif';
    context.textBaseline = "top";
    cursorY += drawLines(context, heading, 130, cursorY, 1170, 72, 3) * 72 + 18;
  }
  context.fillStyle = "#252422";
  context.font = '500 38px "Noto Sans SC", "PingFang SC", sans-serif';
  context.textBaseline = "top";
  drawLines(context, body, 130, cursorY, 1170, 58, 10);
  return canvas;
}

async function buildMethodGrid(assetItem) {
  const { canvas, context } = canvas2d();
  context.fillStyle = "#f4f3ef";
  context.fillRect(0, 0, 1440, 1800);
  const tiles = calculateMethodGrid(assetItem.generation_inputs.length);
  for (let index = 0; index < assetItem.generation_inputs.length; index += 1) {
    const input = assetItem.generation_inputs[index];
    const { x, y, width: cellWidth, height: cellHeight } = tiles[index];
    const [title, ...bodyParts] = String(input.overlay_text || input.label).split(/\n/);
    context.font = '500 24px "Noto Sans SC", "PingFang SC", sans-serif';
    const bodyLines = Math.max(1, linesFor(context, bodyParts.join(" "), cellWidth - 155).length);
    const captionHeight = Math.max(142, Math.min(Math.round(cellHeight * 0.3), 92 + bodyLines * 34));
    const imageHeight = cellHeight - captionHeight;
    const image = await loadImage(state.images[input.slot_id].blob);
    coverDraw(context, image, x + 8, y + 8, cellWidth - 16, imageHeight - 8);
    context.fillStyle = "#fff";
    context.fillRect(x + 8, y + imageHeight, cellWidth - 16, captionHeight - 8);
    context.fillStyle = "#f96332";
    context.beginPath();
    context.arc(x + 61, y + imageHeight + 55, 34, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = "#fff";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.font = "700 30px Montserrat, sans-serif";
    context.fillText(String(index + 1), x + 61, y + imageHeight + 56);
    context.textAlign = "left";
    context.textBaseline = "top";
    context.fillStyle = "#252422";
    context.font = '700 31px "Noto Sans SC", "PingFang SC", sans-serif';
    context.fillText(title, x + 111, y + imageHeight + 24);
    context.fillStyle = "#66615b";
    context.font = '500 24px "Noto Sans SC", "PingFang SC", sans-serif';
    drawLines(context, bodyParts.join(" "), x + 111, y + imageHeight + 71, cellWidth - 155, 34, Math.max(2, Math.floor((captionHeight - 80) / 34)));
  }
  return canvas;
}

async function buildDetailAsset(assetItem) {
  const { canvas, context } = canvas2d();
  coverDraw(context, await firstImageFor(assetItem), 0, 0, 1440, 1800);
  const text = assetItem.overlay_text || assetItem.purpose;
  if (text) {
    gradient(context, 1080, 720, false);
    context.fillStyle = "#fff";
    context.textAlign = "left";
    context.textBaseline = "top";
    context.font = '700 58px "Noto Sans SC", "PingFang SC", sans-serif';
    drawLines(context, text, 110, 1420, 1220, 78, 4);
  }
  return canvas;
}

async function buildAssetCanvas(assetItem) {
  if (["method_grid_2x3", "method_grid_adaptive"].includes(assetItem.layout_type) && assetItem.generation_inputs.length > 1) return buildMethodGrid(assetItem);
  if (assetItem.layout_type === "cover_overlay") return buildCoverAsset(assetItem);
  if (assetItem.layout_type === "detail_overlay") return buildDetailAsset(assetItem);
  return buildInformationAsset(assetItem);
}

function canvasBlob(canvas) {
  return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Canvas export failed.")), "image/png", 1));
}

async function buildAssets() {
  const missing = state.manifest.entries.filter((entry) => entry.required && !state.images[entry.slotId]).map((entry) => entry.label);
  if (missing.length) return toast(`Missing required images: ${missing.join(", ")}.`, true);
  const button = $("buildAssets");
  button.disabled = true;
  button.textContent = `Building ${state.plan.length} assets…`;
  try {
    for (const assetItem of state.plan) {
      try {
        const canvas = await buildAssetCanvas(assetItem);
        if (canvas.width !== 1440 || canvas.height !== 1800) throw new Error("Incorrect output dimensions.");
        const value = {
          blob: await canvasBlob(canvas),
          filename: buildAssetFilename(state.content, assetItem),
          width: 1440,
          height: 1800,
          qc_status: "PASS",
          semanticKey: assetSemanticKey(assetItem),
          updatedAt: Date.now()
        };
        await putStored("assets", keyFor("asset", assetItem.asset_id), value);
        state.assets[assetItem.asset_id] = value;
      } catch (error) {
        throw new Error(`${assetItem.title} failed: ${error.message}`);
      }
    }
    renderAssets();
    renderQc();
    toast(`${state.plan.length} final assets are ready.`);
  } catch (error) {
    renderAssets();
    toast(error.message, true);
  } finally {
    button.disabled = false;
    button.innerHTML = "<span>03</span>Build Final Assets";
  }
}

function downloadBlob(blob, filename) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 1200);
}

async function markPosted() {
  if (!state.writable) return toast("This source is read-only. Status was not changed.", true);
  const button = $("markPosted");
  button.disabled = true;
  button.textContent = "Updating Sheet…";
  try {
    const response = await fetch(`/api/recipes/${encodeURIComponent(state.content.contentId)}/status`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "Posted", sheetName: state.sourceName })
    });
    const result = await response.json();
    if (!response.ok || !result.ok || result.status !== "Posted") throw new Error(result.error || "Status update failed.");
    state.content.lifecycleStatus = "Posted";
    $("status").textContent = "Posted";
    $("status").classList.add("posted");
    toast(`Status verified in row ${result.rowNumber}.`);
  } catch (error) {
    toast(error.message, true);
  } finally {
    button.disabled = !state.writable;
    button.textContent = "Mark Posted";
  }
}

function bindEvents() {
  $("sheetSelect").addEventListener("change", (event) => loadSource(event.target.value));
  $("recipeSelect").addEventListener("change", (event) => {
    const content = state.records.find((item) => item.contentId === event.target.value);
    if (content) applyContent(content);
  });
  $("search").addEventListener("input", (event) => {
    const query = event.target.value.trim().toLowerCase();
    const records = query ? state.records.filter((content) => [content.contentId, content.title, content.topic, content.contentType, content.templateType].some((value) => String(value).toLowerCase().includes(query))) : state.records;
    renderOptions(records);
  });
  $("prev").addEventListener("click", () => moveContent(-1));
  $("next").addEventListener("click", () => moveContent(1));
  $("copyPrompt").addEventListener("click", () => copyText(buildSessionPrompt(state.content), "One deterministic ChatGPT image session prompt copied."));
  $("importAll").addEventListener("click", () => $("allFiles").click());
  $("allFiles").addEventListener("change", (event) => importMany(event.target.files));
  $("buildAssets").addEventListener("click", buildAssets);
  $("copyCaption").addEventListener("click", () => copyText(state.content.caption, "Facebook caption copied."));
  $("copyCaptionBottom").addEventListener("click", () => copyText(state.content.caption, "Facebook caption copied."));
  $("markPosted").addEventListener("click", markPosted);
  $("downloadAll").addEventListener("click", () => state.plan.forEach((item, index) => {
    const stored = state.assets[item.asset_id];
    if (stored) setTimeout(() => downloadBlob(stored.blob, stored.filename), index * 250);
  }));
}

function renderSourceOptions() {
  $("sheetSelect").innerHTML = state.sources.map((source) => `<option value="${escapeHtml(source.name)}">${escapeHtml(source.label)}</option>`).join("");
  $("sheetSelect").value = state.sourceName;
}

async function loadSource(sourceName) {
  try {
    const query = sourceName ? `?${new URLSearchParams({ sheetName: sourceName })}` : "";
    const response = await fetch(`/api/recipes${query}`);
    const data = await response.json();
    const rawRecords = data.records || data.recipes;
    if (!response.ok || !data.ok || !Array.isArray(rawRecords)) throw new Error(data.error || "Content data failed to load.");
    state.records = rawRecords.map(normalizeContentRecord);
    state.writable = Boolean(data.writable);
    state.source = data.source;
    state.sourceName = data.sheetName || data.sourceName;
    state.sources = data.sheets || data.sources || [{ name: state.sourceName, label: state.sourceName }];
    localStorage.setItem("capc:selectedSource", state.sourceName);
    renderSourceOptions();
    const connection = $("connection");
    connection.className = `connection ${state.writable ? "live" : "offline"}`;
    connection.lastElementChild.textContent = state.writable ? `Google Sheet connected · ${state.records.length} records` : `${data.source === "canary" ? "V4 canary" : "Local snapshot"} · read-only`;
    $("markPosted").disabled = !state.writable;
    $("writeHint").textContent = state.writable ? "Only the Status field will be updated." : "This source is read-only; production data will not be changed.";
    renderOptions(state.records);
    const saved = localStorage.getItem(`capc:selectedContent:${state.sourceName}`);
    applyContent(state.records.find((content) => content.contentId === saved) || state.records[0]);
    if (data.warning) toast(data.warning, true);
  } catch (error) {
    $("connection").className = "connection offline";
    $("connection").lastElementChild.textContent = "Content data unavailable";
    toast(error.message, true);
  }
}

async function start() {
  bindEvents();
  await loadSource(localStorage.getItem("capc:selectedSource") || "");
}

start();
