(function () {
  "use strict";

  const SLOT_DEFS = [
    ["cover", "Cover"], ["ingredients", "Ingredients"], ["m1", "M1"], ["m2", "M2"], ["m3", "M3"],
    ["m4", "M4"], ["m5", "M5"], ["m6", "M6"], ["closeup", "Closeup"]
  ];
  const ASSET_DEFS = [
    ["cover", "Final Cover"], ["ingredients", "Ingredients Card"], ["method", "Method Card"], ["closeup", "Final Closeup"]
  ];
  const state = { recipes: [], filtered: [], recipe: null, images: {}, assets: {}, writable: false, source: "snapshot", sheetName: "", sheets: [] };
  const $ = (id) => document.getElementById(id);
  let toastTimer;

  function toast(message, error) {
    const node = $("toast");
    node.textContent = message;
    node.className = `toast show${error ? " error" : ""}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { node.className = "toast"; }, 3200);
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
  const keyFor = (name) => `${state.sheetName}:${state.recipe.Content_ID}:${name}`;

  function fileSlot(name) {
    const normalized = name.toLowerCase().replace(/[^a-z0-9]+/g, "");
    if (/cover|hero|image1/.test(normalized)) return "cover";
    if (/ingredient|image2/.test(normalized)) return "ingredients";
    if (/closeup|detail|image4/.test(normalized)) return "closeup";
    const match = normalized.match(/(?:^|method|step|panel|m)([1-6])(?:$|[^0-9])/);
    return match ? `m${match[1]}` : null;
  }

  function parseOverlay(recipe) {
    const overlay = recipe.Exact_Chinese_Overlay || "";
    return {
      cover: (overlay.match(/图1：([^\n]+)/) || [])[1]?.trim() || recipe.Draft_Title,
      ingredients: (overlay.match(/图2：食材准备\s*\n([\s\S]*?)\n图3：做法步骤/) || [])[1]?.trim() || "",
      closeup: (overlay.match(/图4：([^\n]+)/) || [])[1]?.trim() || ""
    };
  }

  function methodVisual(prompt, index) {
    const pattern = new RegExp(`Panel ${index}[^:]*:\\s*([\\s\\S]*?)(?=\\nPanel ${index + 1}[^:]*:|\\nMaintain exact|$)`, "i");
    return prompt.match(pattern)?.[1]?.trim() || `Create only the photograph for cooking step ${index}; follow the exact supplied step caption.`;
  }

  function commonPrefix(strings) {
    if (!strings.length) return "";
    let prefix = strings[0];
    for (const value of strings.slice(1)) {
      let i = 0;
      while (i < prefix.length && i < value.length && prefix[i] === value[i]) i += 1;
      prefix = prefix.slice(0, i);
    }
    const boundary = Math.max(prefix.lastIndexOf("\n"), prefix.lastIndexOf(". "));
    return boundary > 120 ? prefix.slice(0, boundary + 1).trim() : "";
  }

  function buildSessionPrompt(recipe) {
    const photos = [recipe.Image_1_Cover_Prompt, recipe.Image_2_Ingredients_Prompt, recipe.Image_4_Closeup_Prompt].filter(Boolean);
    const shared = commonPrefix(photos);
    const trim = (value) => shared && value.startsWith(shared) ? value.slice(shared.length).trim() : value.trim();
    const methods = Array.from({ length: 6 }, (_, offset) => {
      const index = offset + 1;
      return `M${index}: ${methodVisual(recipe.Image_3_Method_Prompt, index)}\nExact step: ${recipe[`Image_3_Step_${index}_Caption`]}`;
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
      `COVER: ${trim(recipe.Image_1_Cover_Prompt)}`,
      `INGREDIENTS: ${trim(recipe.Image_2_Ingredients_Prompt)}`,
      ...methods,
      `CLOSEUP: ${trim(recipe.Image_4_Closeup_Prompt)}`
    ].filter(Boolean).join("\n\n");
  }

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

  function renderSlots() {
    const container = $("slots");
    container.innerHTML = "";
    for (const [slot, label] of SLOT_DEFS) {
      const stored = state.images[slot];
      const node = document.createElement("article");
      node.className = `slot${stored ? " ready" : ""}`;
      node.dataset.slot = slot;
      node.innerHTML = `<div class="slot-preview">${stored ? `<img alt="${label} imported image">` : `<div class="slot-empty"><b>${label}</b><span>Drop PNG, JPG or WebP</span></div>`}</div><div class="slot-footer"><div><div class="slot-name">${label}</div><div class="slot-state">${stored ? "Complete" : "Waiting for image"}</div></div><button type="button">${stored ? "Replace" : "Choose"}</button><input type="file" accept="image/png,image/jpeg,image/webp" hidden></div>`;
      if (stored) node.querySelector("img").src = imageUrl(stored);
      const input = node.querySelector("input");
      node.querySelector("button").addEventListener("click", () => input.click());
      input.addEventListener("change", () => input.files[0] && saveImage(slot, input.files[0]));
      for (const event of ["dragenter", "dragover"]) node.addEventListener(event, (e) => { e.preventDefault(); node.classList.add("dragover"); });
      for (const event of ["dragleave", "drop"]) node.addEventListener(event, (e) => { e.preventDefault(); node.classList.remove("dragover"); });
      node.addEventListener("drop", (e) => e.dataTransfer.files[0] && saveImage(slot, e.dataTransfer.files[0]));
      container.appendChild(node);
    }
    updateProgress();
  }

  function renderAssets() {
    const container = $("assetGrid");
    container.innerHTML = "";
    for (const [asset, label] of ASSET_DEFS) {
      const stored = state.assets[asset];
      const node = document.createElement("article");
      node.className = "asset";
      node.innerHTML = `<div class="asset-preview">${stored ? `<img alt="${label}">` : "Not built"}</div><div class="asset-footer"><strong>${label}</strong><button type="button" ${stored ? "" : "disabled"}>Download</button></div>`;
      if (stored) node.querySelector("img").src = imageUrl(stored);
      node.querySelector("button").addEventListener("click", () => downloadBlob(stored.blob, stored.filename));
      container.appendChild(node);
    }
    $("downloadAll").disabled = ASSET_DEFS.some(([name]) => !state.assets[name]);
    updateProgress();
  }

  function updateProgress() {
    const images = SLOT_DEFS.filter(([name]) => state.images[name]).length;
    const assets = ASSET_DEFS.filter(([name]) => state.assets[name]).length;
    const percent = Math.round(((images + assets) / 13) * 100);
    $("progressText").textContent = `${images} / 9`;
    $("progressBar").style.width = `${(images / 9) * 100}%`;
    $("completionRing").style.setProperty("--progress", `${percent}%`);
    $("completionRing").querySelector("strong").textContent = `${percent}%`;
  }

  async function saveImage(slot, file) {
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) return toast("Use a PNG, JPG or WebP image.", true);
    if (file.size > 35 * 1024 * 1024) return toast("Image is larger than 35 MB.", true);
    const value = { blob: file, name: file.name, type: file.type, updatedAt: Date.now() };
    await putStored("images", keyFor(slot), value);
    state.images[slot] = value;
    renderSlots();
    toast(`${SLOT_DEFS.find(([name]) => name === slot)[1]} imported.`);
  }

  async function importMany(files) {
    const valid = Array.from(files).filter((file) => /^image\/(png|jpeg|webp)$/.test(file.type));
    if (!valid.length) return toast("No supported images selected.", true);
    const assigned = new Set();
    const pending = [];
    for (const file of valid) {
      const mapped = fileSlot(file.name);
      if (mapped && !assigned.has(mapped)) { await saveImage(mapped, file); assigned.add(mapped); }
      else pending.push(file);
    }
    const available = SLOT_DEFS.map(([name]) => name).filter((name) => !assigned.has(name) && !state.images[name]);
    for (let i = 0; i < pending.length && i < available.length; i += 1) await saveImage(available[i], pending[i]);
    toast(`${Math.min(valid.length, 9)} image${valid.length === 1 ? "" : "s"} imported.`);
  }

  async function loadRecipeState() {
    state.images = {};
    state.assets = {};
    await Promise.all(SLOT_DEFS.map(async ([name]) => { const value = await getStored("images", keyFor(name)); if (value) state.images[name] = value; }));
    await Promise.all(ASSET_DEFS.map(async ([name]) => { const value = await getStored("assets", keyFor(name)); if (value) state.assets[name] = value; }));
    renderSlots();
    renderAssets();
  }

  function applyRecipe(recipe) {
    state.recipe = recipe;
    localStorage.setItem(`capc:selectedRecipe:${state.sheetName}`, recipe.Content_ID);
    $("sideRecipe").textContent = recipe.Draft_Title;
    $("sideId").textContent = recipe.Content_ID;
    $("contentId").textContent = recipe.Content_ID;
    $("category").textContent = recipe.Category;
    $("status").textContent = recipe.Status || "Draft";
    $("status").classList.toggle("posted", recipe.Status === "Posted");
    $("title").textContent = recipe.Draft_Title;
    $("captionPreview").textContent = recipe.Ready_To_Post_Caption;
    $("recipeSelect").value = recipe.Content_ID;
    loadRecipeState().catch((error) => toast(error.message, true));
  }

  function renderOptions(recipes) {
    state.filtered = recipes;
    const select = $("recipeSelect");
    select.innerHTML = recipes.map((recipe) => `<option value="${recipe.Content_ID}">${recipe.Content_ID} · ${recipe.Draft_Title}</option>`).join("");
    if (state.recipe && recipes.some((recipe) => recipe.Content_ID === state.recipe.Content_ID)) select.value = state.recipe.Content_ID;
  }

  function moveRecipe(direction) {
    const index = state.recipes.findIndex((item) => item.Content_ID === state.recipe.Content_ID);
    const next = (index + direction + state.recipes.length) % state.recipes.length;
    renderOptions(state.recipes);
    applyRecipe(state.recipes[next]);
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
    for (const paragraph of String(text).split(/\n/)) {
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
    const g = context.createLinearGradient(0, y, 0, y + height);
    if (top) { g.addColorStop(0, "rgba(0,0,0,.72)"); g.addColorStop(1, "rgba(0,0,0,0)"); }
    else { g.addColorStop(0, "rgba(0,0,0,0)"); g.addColorStop(1, "rgba(0,0,0,.78)"); }
    context.fillStyle = g;
    context.fillRect(0, y, 1440, height);
  }

  async function buildCover() {
    const { canvas, context } = canvas2d();
    const image = await loadImage(state.images.cover.blob);
    coverDraw(context, image, 0, 0, 1440, 1800);
    gradient(context, 0, 620, true);
    const overlay = parseOverlay(state.recipe);
    context.fillStyle = "#fff";
    context.textAlign = "center";
    context.font = '700 92px "Noto Sans SC", "PingFang SC", sans-serif';
    drawLines(context, overlay.cover, 720, 205, 1160, 112, 3);
    context.font = '600 28px Montserrat, sans-serif';
    context.fillText(state.recipe.Content_ID, 720, 470);
    return canvas;
  }

  async function buildIngredients() {
    const { canvas, context } = canvas2d();
    context.fillStyle = "#f4f3ef";
    context.fillRect(0, 0, 1440, 1800);
    const image = await loadImage(state.images.ingredients.blob);
    coverDraw(context, image, 0, 0, 1440, 1000);
    context.fillStyle = "#fff";
    context.fillRect(70, 920, 1300, 810);
    context.fillStyle = "#f96332";
    context.font = '700 36px Montserrat, "Noto Sans SC", sans-serif';
    context.fillText("食材准备", 130, 1035);
    context.fillStyle = "#252422";
    context.font = '700 58px "Noto Sans SC", "PingFang SC", sans-serif';
    context.fillText(state.recipe.Draft_Title, 130, 1125);
    context.font = '500 38px "Noto Sans SC", "PingFang SC", sans-serif';
    context.textBaseline = "top";
    drawLines(context, parseOverlay(state.recipe).ingredients.replace(/；/g, "\n").replace(/。$/g, ""), 130, 1195, 1170, 58, 9);
    return canvas;
  }

  async function buildMethod() {
    const { canvas, context } = canvas2d();
    context.fillStyle = "#f4f3ef";
    context.fillRect(0, 0, 1440, 1800);
    for (let i = 0; i < 6; i += 1) {
      const col = i % 2;
      const row = Math.floor(i / 2);
      const x = col * 720;
      const y = row * 600;
      const image = await loadImage(state.images[`m${i + 1}`].blob);
      coverDraw(context, image, x + 8, y + 8, 704, 390);
      context.fillStyle = "#fff";
      context.fillRect(x + 8, y + 398, 704, 194);
      context.fillStyle = "#f96332";
      context.beginPath();
      context.arc(x + 61, y + 453, 34, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = "#fff";
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.font = "700 30px Montserrat, sans-serif";
      context.fillText(String(i + 1), x + 61, y + 454);
      const [title, ...bodyParts] = state.recipe[`Image_3_Step_${i + 1}_Caption`].split(/\n/);
      context.textAlign = "left";
      context.textBaseline = "top";
      context.fillStyle = "#252422";
      context.font = '700 31px "Noto Sans SC", "PingFang SC", sans-serif';
      context.fillText(title, x + 111, y + 422);
      context.fillStyle = "#66615b";
      context.font = '500 24px "Noto Sans SC", "PingFang SC", sans-serif';
      drawLines(context, bodyParts.join(" "), x + 111, y + 469, 565, 34, 3);
    }
    return canvas;
  }

  async function buildCloseup() {
    const { canvas, context } = canvas2d();
    const image = await loadImage(state.images.closeup.blob);
    coverDraw(context, image, 0, 0, 1440, 1800);
    const text = parseOverlay(state.recipe).closeup;
    if (text) {
      gradient(context, 1120, 680, false);
      context.fillStyle = "#fff";
      context.textAlign = "left";
      context.textBaseline = "top";
      context.font = '700 58px "Noto Sans SC", "PingFang SC", sans-serif';
      drawLines(context, text, 110, 1440, 1220, 78, 4);
    }
    return canvas;
  }

  function canvasBlob(canvas) {
    return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Canvas export failed.")), "image/png", 1));
  }

  async function buildAssets() {
    const missing = SLOT_DEFS.filter(([name]) => !state.images[name]).map(([, label]) => label);
    if (missing.length) return toast(`Import all 9 images first. Missing: ${missing.join(", ")}.`, true);
    const button = $("buildAssets");
    button.disabled = true;
    button.textContent = "Building 1440 × 1800 assets…";
    try {
      const builders = { cover: buildCover, ingredients: buildIngredients, method: buildMethod, closeup: buildCloseup };
      for (const [name] of ASSET_DEFS) {
        const canvas = await builders[name]();
        if (canvas.width !== 1440 || canvas.height !== 1800) throw new Error(`${name} has incorrect dimensions.`);
        const value = { blob: await canvasBlob(canvas), filename: `${state.recipe.Content_ID}-${name}-1440x1800.png`, width: 1440, height: 1800, updatedAt: Date.now() };
        await putStored("assets", keyFor(name), value);
        state.assets[name] = value;
      }
      renderAssets();
      toast("All four final assets are ready.");
    } catch (error) {
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
    if (!state.writable) return toast("Sheet bridge is offline. Status was not changed.", true);
    const button = $("markPosted");
    button.disabled = true;
    button.textContent = "Updating Sheet…";
    try {
      const response = await fetch(`/api/recipes/${encodeURIComponent(state.recipe.Content_ID)}/status`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "Posted", sheetName: state.sheetName })
      });
      const result = await response.json();
      if (!response.ok || !result.ok || result.status !== "Posted") throw new Error(result.error || "Status update failed.");
      state.recipe.Status = "Posted";
      $("status").textContent = "Posted";
      $("status").classList.add("posted");
      toast("Google Sheet Status updated to Posted.");
    } catch (error) {
      toast(error.message, true);
    } finally {
      button.disabled = !state.writable;
      button.textContent = "Mark Posted";
    }
  }

  function bindEvents() {
    $("sheetSelect").addEventListener("change", (event) => loadSheet(event.target.value));
    $("recipeSelect").addEventListener("change", (event) => {
      const recipe = state.recipes.find((item) => item.Content_ID === event.target.value);
      if (recipe) applyRecipe(recipe);
    });
    $("search").addEventListener("input", (event) => {
      const query = event.target.value.trim().toLowerCase();
      const recipes = query ? state.recipes.filter((recipe) => [recipe.Content_ID, recipe.Draft_Title, recipe.Category].some((value) => value.toLowerCase().includes(query))) : state.recipes;
      renderOptions(recipes);
    });
    $("prev").addEventListener("click", () => moveRecipe(-1));
    $("next").addEventListener("click", () => moveRecipe(1));
    $("copyPrompt").addEventListener("click", () => copyText(buildSessionPrompt(state.recipe), "One ChatGPT image session prompt copied."));
    $("importAll").addEventListener("click", () => $("allFiles").click());
    $("allFiles").addEventListener("change", (event) => importMany(event.target.files));
    $("buildAssets").addEventListener("click", buildAssets);
    $("copyCaption").addEventListener("click", () => copyText(state.recipe.Ready_To_Post_Caption, "Exact Facebook caption copied."));
    $("copyCaptionBottom").addEventListener("click", () => copyText(state.recipe.Ready_To_Post_Caption, "Exact Facebook caption copied."));
    $("markPosted").addEventListener("click", markPosted);
    $("downloadAll").addEventListener("click", () => ASSET_DEFS.forEach(([name], index) => setTimeout(() => downloadBlob(state.assets[name].blob, state.assets[name].filename), index * 250)));
  }

  function renderSheetOptions() {
    $("sheetSelect").innerHTML = state.sheets.map((sheet) => `<option value="${sheet.name}">${sheet.label}</option>`).join("");
    $("sheetSelect").value = state.sheetName;
  }

  async function loadSheet(sheetName) {
    try {
      const query = sheetName ? `?${new URLSearchParams({ sheetName })}` : "";
      const response = await fetch(`/api/recipes${query}`);
      const data = await response.json();
      if (!response.ok || !data.ok || !Array.isArray(data.recipes)) throw new Error(data.error || "Recipe data failed to load.");
      state.recipes = data.recipes;
      state.writable = Boolean(data.writable);
      state.source = data.source;
      state.sheetName = data.sheetName;
      state.sheets = data.sheets || [{ name: data.sheetName, label: data.sheetName }];
      localStorage.setItem("capc:selectedSheet", state.sheetName);
      renderSheetOptions();
      const connection = $("connection");
      connection.className = `connection ${state.writable ? "live" : "offline"}`;
      connection.lastElementChild.textContent = state.writable ? `Google Sheet connected · ${state.recipes.length} recipes` : "Local snapshot · Sheet write offline";
      $("markPosted").disabled = !state.writable;
      $("writeHint").textContent = state.writable ? "Only the Status field will be updated." : "Configure the private server bridge to enable Status updates.";
      renderOptions(state.recipes);
      const saved = localStorage.getItem(`capc:selectedRecipe:${state.sheetName}`);
      applyRecipe(state.recipes.find((recipe) => recipe.Content_ID === saved) || state.recipes[0]);
      if (data.warning) toast(data.warning, true);
    } catch (error) {
      $("connection").className = "connection offline";
      $("connection").lastElementChild.textContent = "Recipe data unavailable";
      toast(error.message, true);
    }
  }

  async function start() {
    bindEvents();
    await loadSheet(localStorage.getItem("capc:selectedSheet") || "");
  }

  start();
})();
