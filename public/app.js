import {
  buildAssetFilename,
  buildAssetSourceRevision,
  buildGenerationManifest,
  buildSessionPrompt,
  calculateAdaptivePanel,
  calculateMethodGrid,
  deriveGenerationReadiness,
  derivePublishingReadiness,
  isStoredAssetStale,
  matchGenerationSlot,
  normalizeContentRecord,
  normalizeContentRecordsSafely,
  runContentQc,
  runEditorialReview
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
  sourceId: null,
  sourceInfo: null,
  sources: [],
  profiles: [],
  templates: [],
  pageProfile: null,
  pageProfileComplete: false,
  editorialReviewRecord: null,
  workflow: null,
  resultsSummary: null,
  currentPublicationId: "",
  visualQcConfirmedFor: "",
  currentSheet: null,
  contentLoadToken: 0,
  editingProfileId: ""
};
const APPROVED_OPPORTUNITIES_SOURCE = "V4.2 Approved Opportunities";
const WORKFLOW_STAGES = ["IDEA", "COPY_DRAFT", "EDITORIAL_REVIEW", "COPY_APPROVED", "VISUAL_VIDEO_PROMPT", "ASSET_CREATED", "QC_PASSED", "SCHEDULED_PUBLISHED", "RESULTS_RECORDED"];
const WORKFLOW_LABELS = ["Idea", "Copy draft", "Editorial review", "Copy approved", "Visual/video prompt", "Asset created", "QC passed", "Scheduled / published", "Results recorded"];
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

function reportRejectedRecords(rejected) {
  if (!rejected.length) return;
  console.warn("Skipped invalid content records", rejected);
  const sample = rejected.slice(0, 3).map((item) => item.contentId).join(", ");
  toast(`${rejected.length} record${rejected.length === 1 ? "" : "s"} skipped due to validation error: ${sample}`, true);
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
const sourceKey = () => state.sourceId ? String(state.sourceId) : state.sourceName;
const writeHeaders = () => ({ "content-type": "application/json", "x-content-intelligence-request": "1" });
const splitLines = (value) => String(value || "").split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
const keyFor = (kind, name) => `${sourceKey()}:${state.content.contentId}:${kind}:${name}`;
const assetSemanticKey = (item) => JSON.stringify({ layout: item.layout_type, text: item.overlay_text, heading: item.local_heading, inputs: item.generation_inputs.map((input) => [input.slot_id, input.overlay_text]), sources: item.source_input_ids || [] });
const assetSourceRevision = (item) => buildAssetSourceRevision(item, state.images);

async function apiJson(path, options = {}) {
  const response = await fetch(path, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) {
    const error = new Error(data.error || `Request failed (${response.status}).`);
    Object.assign(error, data);
    throw error;
  }
  return data;
}

function localDateValue(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
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
    const generationBlocked = !state.generationReadiness?.ready;
    const node = document.createElement("article");
    const stale = Boolean(stored && entry.regenRequiredReason && stored.semanticKey !== entry.semanticKey);
    node.className = `slot${stored ? " ready" : ""}${stale ? " stale" : ""}`;
    node.dataset.slot = entry.slotId;
    node.innerHTML = `
      <div class="slot-preview">${stored ? `<img alt="${escapeHtml(entry.label)} imported image">` : `<div class="slot-empty"><b>${String(entry.sequence).padStart(2, "0")} · ${escapeHtml(entry.label)}</b><span>${escapeHtml(entry.assetType)} · Drop PNG, JPG or WebP</span></div>`}</div>
      <div class="slot-footer">
        <div><div class="slot-name">${String(entry.sequence).padStart(2, "0")} · ${escapeHtml(entry.label)}</div><div class="slot-state">${stale ? `REGEN REQUIRED · ${escapeHtml(entry.regenRequiredReason)}` : stored ? "Complete" : entry.required ? "Required" : "Optional"}</div></div>
        <div class="slot-actions"><button type="button" data-choose ${generationBlocked ? "disabled" : ""}>${stored ? "Replace" : "Choose"}</button>${stored ? `<button type="button" data-remove ${generationBlocked ? "disabled" : ""}>Remove</button>` : ""}</div>
        <input type="file" accept="image/png,image/jpeg,image/webp" hidden>
      </div>`;
    if (stored) node.querySelector("img").src = imageUrl(stored);
    const input = node.querySelector("input");
    node.querySelector("[data-choose]").addEventListener("click", () => input.click());
    input.addEventListener("change", () => input.files[0] && saveImage(entry.slotId, input.files[0]));
    node.querySelector("[data-remove]")?.addEventListener("click", () => removeImage(entry.slotId));
    for (const event of ["dragenter", "dragover"]) node.addEventListener(event, (e) => { e.preventDefault(); if (!generationBlocked) node.classList.add("dragover"); });
    for (const event of ["dragleave", "drop"]) node.addEventListener(event, (e) => { e.preventDefault(); node.classList.remove("dragover"); });
    node.addEventListener("drop", (e) => { if (!generationBlocked && e.dataTransfer.files[0]) saveImage(entry.slotId, e.dataTransfer.files[0]); });
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
    node.className = `asset${stored?.stale ? " stale" : ""}`;
    node.dataset.asset = assetItem.asset_id;
    node.innerHTML = `<div class="asset-preview">${stored ? `<img alt="${escapeHtml(assetItem.title)}">` : "Not built"}</div><div class="asset-footer"><div><strong>${String(assetItem.sequence).padStart(2, "0")} · ${escapeHtml(assetItem.title)}</strong><small>${escapeHtml(assetItem.asset_type)}${stored?.stale ? " · REBUILD REQUIRED" : ""}</small></div><button type="button" ${stored && !stored.stale ? "" : "disabled"}>Download</button></div>`;
    if (stored) node.querySelector("img").src = imageUrl(stored);
    node.querySelector("button").addEventListener("click", () => stored && !stored.stale && downloadBlob(stored.blob, stored.filename));
    container.appendChild(node);
  }
  $("downloadAll").disabled = state.plan.some((item) => item.required && (!state.assets[item.asset_id] || state.assets[item.asset_id].stale));
  updateProgress();
}

function updateProgress() {
  const requiredEntries = state.manifest.entries.filter((entry) => entry.required);
  const imported = requiredEntries.filter((entry) => state.images[entry.slotId]).length;
  const built = state.plan.filter((item) => state.assets[item.asset_id] && !state.assets[item.asset_id].stale).length;
  const total = requiredEntries.length + state.plan.length;
  const percent = total ? Math.round(((imported + built) / total) * 100) : 0;
  $("progressText").textContent = `${imported} / ${requiredEntries.length}`;
  $("progressBar").style.width = `${requiredEntries.length ? (imported / requiredEntries.length) * 100 : 0}%`;
  $("completionRing").style.setProperty("--progress", `${percent}%`);
  $("completionRing").querySelector("strong").textContent = `${percent}%`;
}

async function saveImage(slotId, file) {
  if (!state.generationReadiness?.ready) return toast("Generation is blocked. Complete the editorial and specification gate before importing source images.", true);
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) return toast("Use a PNG, JPG or WebP image.", true);
  if (file.size > 35 * 1024 * 1024) return toast("Image is larger than 35 MB.", true);
  const entry = state.manifest.entries.find((item) => item.slotId === slotId);
  const value = { blob: file, name: file.name, type: file.type, semanticKey: entry?.semanticKey || "", updatedAt: Date.now() };
  await putStored("images", keyFor("image", slotId), value);
  state.images[slotId] = value;
  state.visualQcConfirmedFor = "";
  for (const assetItem of state.plan) {
    const sourceIds = [...(assetItem.generation_inputs || []).map((input) => input.slot_id), ...(assetItem.source_input_ids || [])];
    if (sourceIds.includes(slotId) && state.assets[assetItem.asset_id]) state.assets[assetItem.asset_id].stale = true;
  }
  renderSlots();
  renderAssets();
  renderQc();
}

async function removeImage(slotId) {
  await deleteStored("images", keyFor("image", slotId));
  delete state.images[slotId];
  state.visualQcConfirmedFor = "";
  for (const assetItem of state.plan) {
    const sourceIds = [...(assetItem.generation_inputs || []).map((input) => input.slot_id), ...(assetItem.source_input_ids || [])];
    if (sourceIds.includes(slotId) && state.assets[assetItem.asset_id]) state.assets[assetItem.asset_id].stale = true;
  }
  renderSlots();
  renderAssets();
  renderQc();
  toast("Image removed. Import a replacement before building.");
}

async function importMany(files) {
  if (!state.generationReadiness?.ready) return toast("Generation is blocked until the editorial review and production specification pass.", true);
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

async function loadContentState(token = state.contentLoadToken) {
  state.images = {};
  state.assets = {};
  await Promise.all(state.manifest.entries.map(async (entry) => {
    const stableKey = keyFor("image", entry.slotId);
    const legacyKey = `${state.sourceName}:${state.content.contentId}:image:${entry.slotId}`;
    const value = await getStored("images", stableKey) || (legacyKey !== stableKey ? await getStored("images", legacyKey) : null);
    if (token !== state.contentLoadToken) return;
    if (value) state.images[entry.slotId] = value;
    if (value && stableKey !== legacyKey && !await getStored("images", stableKey)) await putStored("images", stableKey, value);
  }));
  await Promise.all(state.plan.map(async (item) => {
    const stableKey = keyFor("asset", item.asset_id);
    const legacyKey = `${state.sourceName}:${state.content.contentId}:asset:${item.asset_id}`;
    const value = await getStored("assets", stableKey) || (legacyKey !== stableKey ? await getStored("assets", legacyKey) : null);
    if (token !== state.contentLoadToken) return;
    if (value?.semanticKey === assetSemanticKey(item)) {
      const sourceRevision = assetSourceRevision(item);
      state.assets[item.asset_id] = { ...value, sourceRevision: value.sourceRevision || sourceRevision, stale: isStoredAssetStale(item, value, state.images) };
      if (stableKey !== legacyKey && !await getStored("assets", stableKey)) await putStored("assets", stableKey, value);
    }
  }));
  if (token !== state.contentLoadToken) return;
  renderSlots();
  renderAssets();
  renderQc();
}

function applyContent(content) {
  state.contentLoadToken += 1;
  const token = state.contentLoadToken;
  state.content = { ...content, pageProfile: state.pageProfile || content.pageProfile || null };
  state.images = {};
  state.assets = {};
  state.editorialReviewRecord = null;
  state.workflow = null;
  state.currentPublicationId = "";
  state.visualQcConfirmedFor = "";
  state.plan = state.content.resolvedAssetPlan;
  state.manifest = buildGenerationManifest(state.content);
  localStorage.setItem(`capc:selectedContent:${sourceKey()}`, state.content.contentId);
  $("sideRecipe").textContent = state.content.title;
  $("sideId").textContent = state.content.contentId;
  $("contentId").textContent = state.content.contentId;
  $("category").textContent = state.content.topic;
  $("status").textContent = state.content.lifecycleStatus;
  $("status").classList.toggle("posted", state.content.lifecycleStatus === "PUBLISHED" || state.content.lifecycleStatus === "Posted");
  $("title").textContent = state.content.title;
  $("captionPreview").textContent = state.content.caption;
  $("recipeSelect").value = state.content.contentId;
  $("contentType").textContent = state.content.contentType;
  $("templateType").textContent = state.content.templateType;
  $("visualProfile").textContent = state.content.visualProfile;
  $("hookType").textContent = state.content.hookType;
  $("hookText").textContent = state.content.hookText;
  $("slotHeading").textContent = `${state.manifest.expectedAssets} generation slots`;
  $("slotHelper").textContent = `Import in manifest order: ${state.manifest.entries.map((entry) => entry.label).join(" → ")}.`;
  $("assetHeading").textContent = `${state.plan.length} final Facebook assets`;
  renderEditorialForm(state.content.editorialReview || {});
  renderQc();
  renderManifest();
  renderWorkflow();
  renderResults();
  loadContentState(token).catch((error) => toast(error.message, true));
  loadContentOperations(token).catch((error) => toast(`Editorial/workflow state could not be loaded: ${error.message}`, true));
}

function renderQc() {
  const qc = runContentQc(state.content);
  const editorial = runEditorialReview(state.content);
  const generation = deriveGenerationReadiness(state.content, { structuralQc: qc, editorialReview: editorial });
  const stale = state.manifest.entries.filter((entry) => entry.regenRequiredReason && state.images[entry.slotId] && state.images[entry.slotId].semanticKey !== entry.semanticKey);
  const contractStatus = qc.failures.length ? "FAIL" : stale.length || qc.warnings.length ? "WARNING" : "PASS";
  const allFinalAssetsBuilt = state.plan.length > 0 && state.plan.every((item) => {
    const built = state.assets[item.asset_id];
    return built?.qc_status === "PASS" && !built.stale && built.sourceRevision === assetSourceRevision(item);
  });
  const requiredImagesPresent = state.manifest.entries.filter((entry) => entry.required).every((entry) => Boolean(state.images[entry.slotId]));
  const visualQcStatus = !allFinalAssetsBuilt ? "NOT RUN" : state.visualQcConfirmedFor === state.content.contentId ? "PASS" : "REVIEW REQUIRED";
  const publishing = derivePublishingReadiness(state.content, {
    generationReadiness: generation,
    requiredImagesPresent,
    finalAssetsPresent: allFinalAssetsBuilt,
    visualQcStatus: visualQcStatus === "REVIEW REQUIRED" ? "NOT CONFIRMED" : visualQcStatus,
    pageProfileReady: state.pageProfileComplete
  });
  const combinedStatus = contractStatus === "FAIL" ? "fail" : editorial.status === "BLOCKED" ? "blocked" : editorial.status === "REVIEW" || generation.status === "GENERATION_BLOCKED" ? "review" : "pass";
  const details = [
    ...qc.failures.map((item) => `${item.code}: ${item.detail}`),
    ...qc.warnings.map((item) => `${item.code}: ${item.detail}`),
    ...stale.map((entry) => `REGEN REQUIRED: ${entry.label} — ${entry.regenRequiredReason}`),
    ...editorial.issues.map((item) => `${item.severity} · ${item.code}: ${item.detail}`),
    ...generation.blockers.map((item) => `GENERATION BLOCKER: ${item}`),
    ...publishing.blockers.map((item) => `PUBLISHING BLOCKER: ${item}`)
  ];
  $("qcSummary").className = `qc-summary qc-${combinedStatus}`;
  setGate("contractGate", "qcStatus", contractStatus);
  setGate("editorialGate", "editorialStatus", editorial.status);
  setGate("generationGate", "generationStatus", generation.status.replace("GENERATION_", ""));
  setGate("visualGate", "visualStatus", visualQcStatus);
  setGate("publishingGate", "publishingStatus", publishing.status);
  $("qcDetails").textContent = details.length ? details.join("\n") : "Contract checks pass. No editorial or production blockers are recorded.";
  $("editorialNote").textContent = "Editorial PASS requires complete review metadata, a named reviewer and timestamp. Rule checks do not independently prove factual accuracy.";
  $("publishHeading").textContent = publishing.status === "PUBLISHED" ? "Already published" : publishing.ready ? "Ready to post" : "NOT READY TO POST";
  const publicationRecorded = (state.resultsSummary?.rows || []).some((row) => row.contentId === state.content.contentId && row.pageProfileId === state.pageProfile?.profileId && row.postUrl && Number.isFinite(Date.parse(row.publishedAt)));
  const workflowPublished = ["SCHEDULED_PUBLISHED", "RESULTS_RECORDED"].includes(state.workflow?.stage);
  $("markPosted").disabled = !state.writable || !publishing.ready || !publicationRecorded || !workflowPublished;
  $("visualQcCheck").disabled = !allFinalAssetsBuilt;
  $("visualQcCheck").checked = state.visualQcConfirmedFor === state.content.contentId;
  $("visualQcHint").textContent = allFinalAssetsBuilt
    ? "Review every final preview for source fidelity, readability and image/text match. This confirmation is session-only and resets when you switch content or reload."
    : "Build all final assets before recording a visual review.";
  $("copyPrompt").disabled = !generation.ready;
  $("importAll").disabled = !generation.ready;
  $("buildAssets").disabled = !generation.ready || !requiredImagesPresent;
  $("copyCaption").disabled = editorial.status !== "PASS";
  $("copyCaptionBottom").disabled = editorial.status !== "PASS";
  $("writeHint").textContent = state.writable
    ? (publishing.ready && publicationRecorded && workflowPublished ? "Production gates and publication record pass. Mark Posted writes only the Status field." : `Sheet status write is blocked: ${publishing.blockers[0] || (!publicationRecorded ? "save the matching post URL and publish date" : "advance the workflow to Scheduled / Published")}`)
    : "This source is read-only; production data will not be changed.";
  state.editorialReview = editorial;
  state.generationReadiness = generation;
  state.publishingReadiness = publishing;
}

function setGate(containerId, statusId, value) {
  const container = $(containerId);
  container.className = `quality-gate ${String(value).toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  $(statusId).textContent = value;
}

function setFormValue(id, value) {
  const node = $(id);
  if (node) node.value = value ?? "";
}

function renderEditorialForm(review = {}) {
  const fields = {
    editorReviewer: review.reviewer, editorDecision: review.review_status || "REVIEW",
    editorEvidenceReferences: (review.evidence?.references || []).join("\n"),
    editorAudienceNeed: review.audience_need, editorReaderValue: review.reader_value,
    editorSourceNotes: review.source_notes, editorClaimEvidence: review.claim_evidence,
    editorLimitations: review.limitations, editorReviewNote: review.review_note,
    editorInternalNotes: [review.internal_claim_notes, review.editorial_notes].filter(Boolean).join("\n"),
    editorTiming: review.timing_guidance, editorTemperature: review.temperature_guidance,
    editorServing: review.serving_expectation, editorMistakeProblem: review.mistake_problem,
    editorCause: review.cause_explanation, editorConsequence: review.consequence,
    editorExpectedResult: review.expected_result, editorSuitability: review.option_suitability,
    editorTradeoffs: review.tradeoffs, editorDecisionLogic: review.decision_logic
  };
  for (const [id, value] of Object.entries(fields)) setFormValue(id, value);
  $("editorEvidenceType").value = review.evidence?.type || review.evidence_type || "UNVERIFIED";
  $("editorEvidenceVerified").checked = review.source_evidence_status === "VERIFIED";
  $("editorCaptionApproved").checked = review.caption_review_status === "PASS";
  $("editorReaderCopyReviewed").checked = review.reader_facing_copy_reviewed === true;
  $("editorNoInternalLeakage").checked = review.internal_note_leakage === false;
  $("editorClaimSafetyOk").checked = review.claim_safety_ok === true;
  $("editorPageFitApproved").checked = review.page_fit_status === "PASS";
  $("editorRecipeApproximate").checked = review.approximate_recipe === true || review.recipe_precision === "APPROXIMATE";
  $("editorTemperatureRequired").checked = review.temperature_required === true;
  $("reviewSavedState").textContent = review.reviewed_at ? `Sheet verified · ${review.review_status || "REVIEW"}` : "Not saved";
  const disabled = !state.content || !state.sourceId || state.source === "approved-opportunities";
  $("saveEditorialReview").disabled = disabled;
  for (const id of ["editorReviewer", "editorDecision", "editorEvidenceType", ...Object.keys(fields).filter((field) => field !== "editorReviewer" && field !== "editorDecision"), "editorEvidenceVerified", "editorCaptionApproved", "editorReaderCopyReviewed", "editorNoInternalLeakage", "editorClaimSafetyOk", "editorPageFitApproved", "editorRecipeApproximate", "editorTemperatureRequired"]) {
    if ($(id)) $(id).disabled = disabled;
  }
  $("editorPageFitApproved").disabled = disabled || !state.pageProfileComplete;
  $("pageFitReviewHint").textContent = state.pageProfileComplete
    ? "Page-specific fit is a publishing check; generation can proceed independently."
    : "Deferred: no complete Page profile is assigned. Content can still be reviewed and generated; publishing stays blocked.";
}

function renderPageProfiles() {
  const profiles = state.profiles || [];
  const assignedId = state.currentSheet?.targetPageProfileId || "";
  const options = [`<option value="">No page profile assigned</option>`, ...profiles.map((profile) => `<option value="${escapeHtml(profile.profileId)}">${escapeHtml(profile.displayName)} · ${profile.active ? "Active" : "Draft"}</option>`)].join("");
  $("targetPageProfile").innerHTML = options;
  $("targetPageProfile").value = assignedId;
  $("sourceActive").checked = Boolean(state.currentSheet?.active);
  $("sourceActive").disabled = !state.currentSheet;
  $("assignPageProfile").disabled = !state.sourceId || state.source === "approved-opportunities";
  const selected = profiles.find((profile) => profile.profileId === assignedId) || null;
  state.pageProfile = selected;
  state.pageProfileComplete = Boolean(selected?.active && selected.facebookPageId && selected.audience && selected.primaryLanguage && selected.toneGuidance && selected.avoidTopics?.length);
  const readiness = state.currentSheet?.setupStatus || "NEEDS_SETUP";
  $("sourceSetupStatus").textContent = readiness.replaceAll("_", " ");
  $("sourceSetupStatus").className = `badge ${readiness === "READY" ? "badge-success" : "badge-warning"}`;
  $("pageProfileHint").textContent = state.currentSheet?.setupReasons?.join(" ") || (state.pageProfileComplete
    ? `Assigned to ${selected.displayName}. Page-specific audience, language, tone and exclusions are included in the generation prompt.`
    : "Content review and image generation can use the connected source without a Page ID. Assign a complete, active Page profile later to review Page fit and enable publishing.");
  const newProfileOptions = [`<option value="">Assign later</option>`, ...profiles.filter((profile) => profile.active).map((profile) => `<option value="${escapeHtml(profile.profileId)}">${escapeHtml(profile.displayName)}</option>`)].join("");
  $("newSheetPageProfile").innerHTML = newProfileOptions;
}

function fillProfileForm(profile = {}) {
  state.editingProfileId = profile.profileId || "";
  setFormValue("profileFacebookPageId", profile.facebookPageId);
  setFormValue("profileDisplayName", profile.displayName);
  setFormValue("profileAudience", profile.audience);
  setFormValue("profileLanguage", profile.primaryLanguage);
  setFormValue("profileTone", profile.toneGuidance);
  setFormValue("profilePillars", (profile.contentPillars || []).join("\n"));
  setFormValue("profileFormats", (profile.suitableFormats || []).join("\n"));
  setFormValue("profileAvoidTopics", (profile.avoidTopics || []).join("\n"));
  setFormValue("profileMonetization", (profile.monetizationTypes || []).join("\n"));
  $("profileActive").checked = Boolean(profile.active);
}

function renderWorkflow() {
  const stage = state.workflow?.stage || "COPY_DRAFT";
  const index = WORKFLOW_STAGES.indexOf(stage);
  $("workflowStageBadge").textContent = WORKFLOW_LABELS[Math.max(0, index)] || stage;
  $("workflowStages").innerHTML = WORKFLOW_LABELS.map((label, step) => `<li class="${step < index ? "done" : step === index ? "current" : ""}"><span>${String(step + 1).padStart(2, "0")}</span> ${escapeHtml(label)}</li>`).join("");
  const disabled = !state.content || !state.sourceId || state.source === "approved-opportunities" || index < 0 || index >= WORKFLOW_STAGES.length - 1;
  $("advanceWorkflow").disabled = disabled;
  const next = WORKFLOW_LABELS[index + 1];
  $("advanceWorkflow").textContent = next ? `Advance to ${next}` : "Workflow complete";
  $("workflowHint").textContent = state.workflow?.note
    ? `Last transition by ${state.workflow.actor || "operator"} · ${state.workflow.updatedAt || "time unavailable"} · ${state.workflow.note}`
    : "Advance one stage at a time. Asset, visual-QC and publication stages require operator confirmation and a note.";
}

function renderResults() {
  const summary = state.resultsSummary;
  const contentId = state.content?.contentId;
  const rows = (summary?.rows || []).filter((row) => row.contentId === contentId);
  const select = $("resultPublication");
  const selected = state.currentPublicationId;
  select.innerHTML = `<option value="">New publication</option>${rows.map((row) => `<option value="${escapeHtml(row.publicationId)}">${escapeHtml(row.publishedAt)} · ${escapeHtml(row.contentFormat)}${row.postUrl ? " · URL saved" : ""}</option>`).join("")}`;
  select.value = rows.some((row) => row.publicationId === selected) ? selected : "";
  const groupText = (label, entries) => `<section><h3>${escapeHtml(label)}</h3>${entries.length ? entries.map((item) => `<p>${escapeHtml(item.label)} · ${item.publications} posts · qualified views ${item.qualifiedViews ?? "unknown"} · Meta RM ${item.metaEarnings ?? "unknown"} · affiliate RM ${item.affiliateCommission ?? "unknown"}</p>`).join("") : "<p>No recorded results.</p>"}</section>`;
  $("resultsSummary").innerHTML = summary
    ? groupText("By Page", summary.byPage) + groupText("By Content Type", summary.byContentType) + groupText("By Format", summary.byFormat) + `<section><h3>Selected content</h3>${rows.length ? rows.map((row) => `<p>${escapeHtml(row.publishedAt)} · ${escapeHtml(row.pageDisplayName || "Page unknown")} · ${escapeHtml(row.contentFormat)} · views ${row.metrics?.qualifiedViews ?? "unknown"}${row.postUrl ? ` · <a href="${escapeHtml(row.postUrl)}" target="_blank" rel="noopener">Post</a>` : ""}</p>`).join("") : "<p>No publication/results recorded for this content.</p>"}</section>`
    : "<p>No manual results loaded.</p>";
  $("saveManualResults").disabled = !state.content || !state.sourceId || !state.pageProfileComplete || state.source === "approved-opportunities";
}

async function loadContentOperations(token = state.contentLoadToken) {
  if (!state.content || !state.sourceId || state.source === "approved-opportunities") return;
  const query = new URLSearchParams({ sheetId: String(state.sourceId), contentId: state.content.contentId });
  const [reviewData, workflowData, resultsData] = await Promise.all([
    apiJson(`/api/production/editorial-review?${query}`),
    apiJson(`/api/production/workflow?${query}`),
    apiJson(`/api/production/results?${new URLSearchParams({ sheetId: String(state.sourceId), pageProfileId: state.pageProfile?.profileId || "" })}`)
  ]);
  if (token !== state.contentLoadToken) return;
  state.editorialReviewRecord = reviewData.review;
  state.workflow = workflowData.workflow;
  state.resultsSummary = resultsData.summary;
  if (reviewData.review?.review) {
    state.content = { ...state.content, editorialReview: reviewData.review.review };
    renderEditorialForm(reviewData.review.review);
  } else renderEditorialForm(state.content.editorialReview || {});
  renderWorkflow();
  renderResults();
  renderQc();
  renderSlots();
}

function editorialReviewPayload() {
  return {
    sheetId: state.sourceId, contentId: state.content.contentId,
    reviewer: $("editorReviewer").value, reviewStatus: $("editorDecision").value,
    evidenceType: $("editorEvidenceType").value,
    evidenceReferences: $("editorEvidenceReferences").value.split(/\r?\n/).map((value) => value.trim()).filter(Boolean),
    audienceNeed: $("editorAudienceNeed").value, readerValue: $("editorReaderValue").value,
    sourceNotes: $("editorSourceNotes").value, claimEvidence: $("editorClaimEvidence").value,
    limitations: $("editorLimitations").value, reviewNote: $("editorReviewNote").value,
    internalClaimNotes: $("editorInternalNotes").value, editorialNotes: "",
    evidenceVerified: $("editorEvidenceVerified").checked, captionApproved: $("editorCaptionApproved").checked,
    readerFacingCopyReviewed: $("editorReaderCopyReviewed").checked,
    internalNoteLeakage: !$("editorNoInternalLeakage").checked,
    claimSafetyOk: $("editorClaimSafetyOk").checked,
    pageFitApproved: $("editorPageFitApproved").checked, approximateRecipe: $("editorRecipeApproximate").checked,
    recipePrecision: $("editorRecipeApproximate").checked ? "APPROXIMATE" : "EXACT",
    timingGuidance: $("editorTiming").value, temperatureRequired: $("editorTemperatureRequired").checked,
    temperatureGuidance: $("editorTemperature").value, servingExpectation: $("editorServing").value,
    mistakeProblem: $("editorMistakeProblem").value, causeExplanation: $("editorCause").value,
    consequence: $("editorConsequence").value, expectedResult: $("editorExpectedResult").value,
    optionSuitability: $("editorSuitability").value, tradeoffs: $("editorTradeoffs").value,
    decisionLogic: $("editorDecisionLogic").value
  };
}

async function saveEditorialReview() {
  if (!state.content || !state.sourceId) return;
  try {
    const result = await apiJson("/api/production/editorial-review", { method: "POST", headers: writeHeaders(), body: JSON.stringify(editorialReviewPayload()) });
    if (result.recomputedFrom !== "sheet-readback" || result.review?.source !== "sheet") throw new Error("Review save was not verified from the Google Sheet readback.");
    state.editorialReviewRecord = result.review;
    state.content = { ...state.content, editorialReview: result.review.review };
    renderEditorialForm(result.review.review);
    renderQc();
    renderSlots();
    toast(`Google Sheet readback verified · Editorial ${result.evaluated.status}.`);
  } catch (error) {
    if (error.message) toast(error.message, true);
    if (error.issues) toast(`${error.reviewStatus || "Review"}: ${error.issues.map((item) => item.code).join(", ")}`, true);
  }
}

async function advanceWorkflow() {
  if (!state.content || !state.sourceId) return;
  const index = WORKFLOW_STAGES.indexOf(state.workflow?.stage || "COPY_DRAFT");
  const nextStage = WORKFLOW_STAGES[index + 1];
  if (!nextStage) return;
  const requiredImagesPresent = state.manifest.entries.filter((entry) => entry.required).every((entry) => Boolean(state.images[entry.slotId]));
  const finalAssetsPresent = state.plan.length > 0 && state.plan.every((item) => state.assets[item.asset_id] && !state.assets[item.asset_id].stale);
  try {
    const result = await apiJson("/api/production/workflow", { method: "POST", headers: writeHeaders(), body: JSON.stringify({
      sheetId: state.sourceId, contentId: state.content.contentId, nextStage,
      actor: $("workflowActor").value, note: $("workflowNote").value,
      requiredImagesPresent, finalAssetsPresent,
      visualQcPass: state.visualQcConfirmedFor === state.content.contentId
    }) });
    state.workflow = result.workflow;
    $("workflowNote").value = "";
    renderWorkflow();
    toast(`Workflow advanced to ${WORKFLOW_LABELS[WORKFLOW_STAGES.indexOf(result.workflow.stage)]}.`);
  } catch (error) { toast(error.message, true); }
}

function selectedPublication() {
  const id = $("resultPublication").value;
  return (state.resultsSummary?.rows || []).find((row) => row.publicationId === id) || null;
}

function fillResultForm(publication) {
  state.currentPublicationId = publication?.publicationId || "";
  setFormValue("resultPublishedAt", publication?.publishedAt ? String(publication.publishedAt).slice(0, 10) : localDateValue());
  setFormValue("resultPostUrl", publication?.postUrl || "");
  setFormValue("resultFormat", publication?.contentFormat || "Carousel");
  setFormValue("resultProductionMinutes", publication?.productionMinutes);
  setFormValue("resultDirectCost", publication?.directCost);
  setFormValue("resultCurrency", publication?.currency || "MYR");
  const snapshot = publication?.metrics || {};
  for (const [id, key] of [["resultReach", "reach"], ["resultQualifiedViews", "qualifiedViews"], ["resultEngagement", "engagement"], ["resultShares", "shares"], ["resultSaves", "saves"], ["resultRetention", "retentionRate"], ["resultMetaEarnings", "metaEarnings"], ["resultAffiliateClicks", "affiliateClicks"], ["resultAffiliateOrders", "affiliateOrders"], ["resultAffiliateCommission", "affiliateCommission"]]) setFormValue(id, snapshot[key]);
}

async function saveManualResults() {
  if (!state.content || !state.sourceId || !state.pageProfile?.profileId) return;
  const fields = {
    resultReach: "reach", resultQualifiedViews: "qualifiedViews", resultEngagement: "engagement", resultShares: "shares", resultSaves: "saves", resultRetention: "retentionRate", resultMetaEarnings: "metaEarnings", resultAffiliateClicks: "affiliateClicks", resultAffiliateOrders: "affiliateOrders", resultAffiliateCommission: "affiliateCommission", resultProductionMinutes: "productionMinutes", resultDirectCost: "directCost"
  };
  const metrics = Object.fromEntries(Object.entries(fields).map(([id, key]) => [key, $(id).value]));
  const hasMetric = Object.entries(fields).some(([id, key]) => key !== "productionMinutes" && key !== "directCost" && $(id).value !== "");
  const publication = selectedPublication();
  const body = {
    ...metrics, sheetId: state.sourceId, contentId: state.content.contentId,
    pageProfileId: state.pageProfile.profileId, contentType: state.content.contentType,
    contentFormat: $("resultFormat").value, publishedAt: $("resultPublishedAt").value,
    postUrl: $("resultPostUrl").value, currency: $("resultCurrency").value,
    enteredBy: $("resultEnteredBy").value,
    ...(publication ? { publicationId: publication.publicationId } : {}),
    ...(!hasMetric ? { publicationOnly: true } : {})
  };
  try {
    const result = await apiJson("/api/production/results", { method: "POST", headers: writeHeaders(), body: JSON.stringify(body) });
    state.currentPublicationId = result.publication.publicationId;
    await loadContentOperations();
    $("resultPublication").value = state.currentPublicationId;
    toast(result.snapshot ? "Publication and observed metrics saved." : "Publication details saved. No metrics were recorded as zero.");
  } catch (error) { toast(error.message, true); }
}

function clearContentView(message) {
  state.content = null;
  state.records = [];
  state.plan = [];
  state.manifest = { entries: [], expectedAssets: 0 };
  state.images = {};
  state.assets = {};
  state.editorialReviewRecord = null;
  state.workflow = null;
  state.resultsSummary = null;
  $("recipeSelect").innerHTML = "";
  $("title").textContent = message;
  $("contentId").textContent = "—";
  $("sideRecipe").textContent = message;
  $("sideId").textContent = "";
  $("slots").innerHTML = "";
  $("assetGrid").innerHTML = "";
  $("manifestList").innerHTML = "";
  $("manifestCount").textContent = "Generation Images: 0 · Final Assets: 0";
  $("slotHeading").textContent = "No generation inputs";
  $("assetHeading").textContent = "No final assets";
  $("copyPrompt").disabled = true;
  $("importAll").disabled = true;
  $("buildAssets").disabled = true;
  $("copyCaption").disabled = true;
  $("copyCaptionBottom").disabled = true;
  $("markPosted").disabled = true;
  $("saveEditorialReview").disabled = true;
  $("advanceWorkflow").disabled = true;
  $("saveManualResults").disabled = true;
  $("qcDetails").textContent = message;
  renderEditorialForm({});
  renderWorkflow();
  renderResults();
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
  if (!state.generationReadiness?.ready) return toast("Build is blocked until editorial and generation readiness pass.", true);
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
          sourceRevision: assetSourceRevision(assetItem),
          stale: false,
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
  if (!state.publishingReadiness?.ready) return toast("Publishing is blocked until editorial, generation, source-image and visual QC gates pass.", true);
  if (!["SCHEDULED_PUBLISHED", "RESULTS_RECORDED"].includes(state.workflow?.stage)) return toast("Record the post URL/date and advance the production workflow to Scheduled / Published first.", true);
  const button = $("markPosted");
  button.disabled = true;
  button.textContent = "Updating Sheet…";
  try {
    const result = await apiJson(`/api/recipes/${encodeURIComponent(state.content.contentId)}/status`, {
      method: "POST",
      headers: writeHeaders(),
      body: JSON.stringify({ status: "Posted", sheetId: state.sourceId, requiredImagesPresent: true, finalAssetsPresent: true, visualQcPass: state.visualQcConfirmedFor === state.content.contentId })
    });
    state.content.lifecycleStatus = "Posted";
    $("status").textContent = "Posted";
    $("status").classList.add("posted");
    renderQc();
    toast(`Status verified in row ${result.rowNumber}.`);
  } catch (error) {
    toast(error.message, true);
  } finally {
    button.disabled = !state.writable || !state.publishingReadiness?.ready;
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
  $("copyPrompt").addEventListener("click", () => {
    if (!state.generationReadiness?.ready) return toast("Generation is blocked. Resolve the editorial and specification blockers first.", true);
    return copyText(buildSessionPrompt(state.content), "One deterministic ChatGPT image session prompt copied.");
  });
  $("importAll").addEventListener("click", () => {
    if (!state.generationReadiness?.ready) return toast("Image import is blocked until the generation specification passes.", true);
    return $("allFiles").click();
  });
  $("allFiles").addEventListener("change", (event) => importMany(event.target.files));
  $("buildAssets").addEventListener("click", buildAssets);
  $("copyCaption").addEventListener("click", () => {
    if (state.editorialReview?.status !== "PASS") return toast("Caption is not cleared for reader use. Complete editorial review first.", true);
    return copyText(state.content.caption, "Facebook caption copied.");
  });
  $("copyCaptionBottom").addEventListener("click", () => {
    if (state.editorialReview?.status !== "PASS") return toast("Caption is not cleared for reader use. Complete editorial review first.", true);
    return copyText(state.content.caption, "Facebook caption copied.");
  });
  $("markPosted").addEventListener("click", markPosted);
  $("saveEditorialReview").addEventListener("click", saveEditorialReview);
  $("advanceWorkflow").addEventListener("click", advanceWorkflow);
  $("saveManualResults").addEventListener("click", saveManualResults);
  $("refreshResults").addEventListener("click", () => loadContentOperations().catch((error) => toast(error.message, true)));
  $("resultPublication").addEventListener("change", (event) => {
    const publication = (state.resultsSummary?.rows || []).find((row) => row.publicationId === event.target.value);
    fillResultForm(publication);
  });
  $("refreshSheets").addEventListener("click", () => refreshSheets(true));
  $("assignPageProfile").addEventListener("click", assignPageProfile);
  $("savePageProfile").addEventListener("click", savePageProfile);
  $("targetPageProfile").addEventListener("change", (event) => fillProfileForm(state.profiles.find((profile) => profile.profileId === event.target.value) || {}));
  $("openAddSheet").addEventListener("click", openAddSheet);
  $("closeAddSheet").addEventListener("click", () => { $("addSheetPanel").hidden = true; });
  $("newSheetTemplate").addEventListener("change", renderSheetTemplatePreview);
  $("createSheet").addEventListener("click", createSheet);
  $("visualQcCheck").addEventListener("change", (event) => {
    state.visualQcConfirmedFor = event.target.checked ? state.content.contentId : "";
    renderQc();
  });
  $("downloadAll").addEventListener("click", () => state.plan.forEach((item, index) => {
    const stored = state.assets[item.asset_id];
    if (stored && !stored.stale) setTimeout(() => downloadBlob(stored.blob, stored.filename), index * 250);
  }));
}

function renderSourceOptions() {
  const currentValue = state.source === "approved-opportunities" ? APPROVED_OPPORTUNITIES_SOURCE : String(state.sourceId || "");
  const options = state.sources.map((source) => `<option value="${escapeHtml(source.sheetId)}">${escapeHtml(source.label || source.title || source.name)}</option>`);
  options.push(`<option value="${escapeHtml(APPROVED_OPPORTUNITIES_SOURCE)}">V4.2 development ideas · local handoff</option>`);
  $("sheetSelect").innerHTML = options.join("");
  if ([...$("sheetSelect").options].some((option) => option.value === currentValue)) $("sheetSelect").value = currentValue;
}

async function refreshSheets(keepCurrent = false) {
  try {
    const data = await apiJson("/api/sheets");
    state.sources = Array.isArray(data.sheets) ? data.sheets : [];
    state.profiles = Array.isArray(data.profiles) ? data.profiles : [];
    renderSourceOptions();
    const stored = localStorage.getItem("capc:selectedSourceId") || localStorage.getItem("capc:selectedSource") || "";
    const legacyMatch = state.sources.find((source) => source.title === stored || source.name === stored);
    const preferred = keepCurrent && state.sourceId ? String(state.sourceId) : legacyMatch ? String(legacyMatch.sheetId) : stored;
    const chosen = state.sources.find((source) => String(source.sheetId) === preferred) || state.sources.find((source) => source.active && source.schemaStatus === "READY") || state.sources[0];
    if (chosen) await loadSource(String(chosen.sheetId));
    else { clearContentView("No supported content worksheets were discovered."); $("connection").lastElementChild.textContent = "No content worksheets"; }
  } catch (error) {
    $("connection").className = "connection offline";
    $("connection").lastElementChild.textContent = "Sheet discovery unavailable";
    toast(error.message, true);
  }
}

async function loadSource(sourceValue) {
  if (sourceValue === APPROVED_OPPORTUNITIES_SOURCE) {
    const approved = JSON.parse(localStorage.getItem("content-ai-v4-2-approved") || "[]");
    const rawRecords = approved.map((item) => item.production_draft).filter(Boolean);
    const normalized = normalizeContentRecordsSafely(rawRecords);
    state.records = normalized.records;
    state.writable = false;
    state.source = "approved-opportunities";
    state.sourceId = null;
    state.currentSheet = null;
    state.pageProfile = null;
    state.sourceName = APPROVED_OPPORTUNITIES_SOURCE;
    localStorage.setItem("capc:selectedSource", state.sourceName);
    renderSourceOptions();
    $("connection").className = "connection offline";
    $("connection").lastElementChild.textContent = `Development handoffs · ${state.records.length} · read-only`;
    $("writeHint").textContent = "Idea approved for development only. Complete the content specification and editorial review before generation; nothing is published automatically.";
    renderPageProfiles();
    if (!state.records.length) return clearContentView("No V4.2 ideas have been approved for development yet.");
    renderOptions(state.records);
    applyContent(state.records[0]);
    reportRejectedRecords(normalized.rejected);
    return;
  }
  const source = state.sources.find((item) => String(item.sheetId) === String(sourceValue));
  if (!source) return toast("Select a discovered worksheet by its stable sheetId.", true);
  state.contentLoadToken += 1;
  state.sourceId = Number(source.sheetId);
  state.sourceName = source.title || source.name;
  state.source = "sheet";
  state.currentSheet = source;
  state.pageProfile = state.profiles.find((item) => item.profileId === source.targetPageProfileId) || null;
  state.writable = false;
  localStorage.setItem("capc:selectedSourceId", String(source.sheetId));
  localStorage.setItem("capc:selectedSource", state.sourceName);
  renderSourceOptions();
  renderPageProfiles();
  clearContentView("Loading selected worksheet…");
  const connection = $("connection");
  connection.className = source.setupStatus === "READY" ? "connection live" : "connection offline";
  connection.lastElementChild.textContent = `${source.title} · ${source.contentType} · ${source.targetPageName} · ${source.setupStatus}`;
  try {
    const data = await apiJson(`/api/recipes?${new URLSearchParams({ sheetId: String(source.sheetId) })}`);
    state.currentSheet = { ...source, ...(data.sourceState || {}), setupStatus: data.setupStatus || source.setupStatus, setupReasons: data.setupReasons || source.setupReasons };
    state.profiles = data.profiles || state.profiles;
    state.pageProfile = data.pageProfile || state.profiles.find((item) => item.profileId === state.currentSheet.targetPageProfileId) || null;
    renderPageProfiles();
    const rawRecords = data.records || data.recipes || [];
    if (!Array.isArray(rawRecords)) throw new Error("Worksheet source did not return a records array.");
    const normalized = normalizeContentRecordsSafely(rawRecords);
    state.records = normalized.records;
    state.writable = Boolean(data.writable && data.source === "sheet");
    connection.className = state.writable ? "connection live" : "connection offline";
    connection.lastElementChild.textContent = state.writable
      ? `${state.sourceName} · ${state.records.length} records · ${state.currentSheet.setupStatus}`
      : `${state.sourceName} · ${data.setupStatus || state.currentSheet.setupStatus}${(data.setupReasons || []).length ? ` · ${data.setupReasons[0]}` : ""}`;
    if (!state.records.length) {
      const message = (data.setupReasons || state.currentSheet.setupReasons || []).join(" ") || "This supported worksheet is ready but has no content rows yet.";
      clearContentView(message);
      reportRejectedRecords(normalized.rejected);
      return;
    }
    renderOptions(state.records);
    const saved = localStorage.getItem(`capc:selectedContent:${state.sourceId}`) || localStorage.getItem(`capc:selectedContent:${state.sourceName}`);
    applyContent(state.records.find((item) => item.contentId === saved) || state.records[0]);
    reportRejectedRecords(normalized.rejected);
  } catch (error) {
    state.writable = false;
    connection.className = "connection offline";
    connection.lastElementChild.textContent = `${state.sourceName} · load failed`;
    clearContentView(`${state.sourceName} is unavailable or needs setup. Other discovered worksheets remain selectable.`);
    toast(error.message, true);
  }
}

async function savePageProfile() {
  const profile = {
    profileId: state.editingProfileId || undefined,
    facebookPageId: $("profileFacebookPageId").value,
    displayName: $("profileDisplayName").value,
    audience: $("profileAudience").value,
    primaryLanguage: $("profileLanguage").value,
    toneGuidance: $("profileTone").value,
    contentPillars: splitLines($("profilePillars").value),
    suitableFormats: splitLines($("profileFormats").value),
    avoidTopics: splitLines($("profileAvoidTopics").value),
    monetizationTypes: splitLines($("profileMonetization").value),
    active: $("profileActive").checked
  };
  try {
    const result = await apiJson("/api/production/page-profiles", { method: "POST", headers: writeHeaders(), body: JSON.stringify(profile) });
    fillProfileForm(result.profile);
    await refreshSheets(true);
    toast(`Page profile saved${result.profile.active ? " and activated" : " as a draft"}.`);
  } catch (error) { toast(error.message, true); }
}

async function assignPageProfile() {
  if (!state.sourceId) return toast("Select a connected worksheet first.", true);
  try {
    await apiJson("/api/production/sheets/settings", { method: "POST", headers: writeHeaders(), body: JSON.stringify({ sheetId: state.sourceId, targetPageProfileId: $("targetPageProfile").value, active: $("sourceActive").checked }) });
    await refreshSheets(true);
    toast("Target Page profile assignment saved.");
  } catch (error) { toast(error.message, true); }
}

async function openAddSheet() {
  $("addSheetPanel").hidden = false;
  try {
    const [templateData, sheetData] = await Promise.all([apiJson("/api/sheet-templates"), apiJson("/api/sheets")]);
    state.templates = templateData.templates || [];
    state.profiles = sheetData.profiles || state.profiles;
    $("newSheetTemplate").innerHTML = state.templates.map((item) => `<option value="${escapeHtml(item.templateId)}">${escapeHtml(item.label)}</option>`).join("");
    renderSheetTemplatePreview();
    renderPageProfiles();
  } catch (error) { $("addSheetResult").textContent = error.message; $("addSheetResult").className = "helper add-sheet-result error"; }
}

function renderSheetTemplatePreview() {
  const selected = state.templates.find((item) => item.templateId === $("newSheetTemplate").value) || state.templates[0];
  if (!selected) return;
  $("newSheetTemplateDescription").textContent = `${selected.description} Content type: ${selected.contentType}; schema v${selected.schemaVersion}.`;
  $("newSheetHeaders").textContent = selected.headers.join(" · ");
}

async function createSheet() {
  const button = $("createSheet");
  button.disabled = true;
  $("addSheetResult").textContent = "Creating a new worksheet…";
  $("addSheetResult").className = "helper add-sheet-result";
  try {
    const result = await apiJson("/api/sheets", { method: "POST", headers: writeHeaders(), body: JSON.stringify({ templateId: $("newSheetTemplate").value, title: $("newSheetTitle").value, targetPageProfileId: $("newSheetPageProfile").value }) });
    await refreshSheets(false);
    const createdId = String(result.sheet.sheetId);
    $("sheetSelect").value = createdId;
    await loadSource(createdId);
    $("addSheetResult").textContent = `Created ${result.sheet.title} (sheetId ${result.sheet.sheetId}). The tab is empty and ready for content using the selected template.`;
    $("addSheetResult").className = "helper add-sheet-result success";
    $("newSheetTitle").value = "";
  } catch (error) {
    $("addSheetResult").textContent = error.message;
    $("addSheetResult").className = "helper add-sheet-result error";
  } finally { button.disabled = false; }
}

async function start() {
  bindEvents();
  window.addEventListener("capc-approved-opportunity", () => loadSource(APPROVED_OPPORTUNITIES_SOURCE));
  fillProfileForm();
  await refreshSheets(false);
}

start();
