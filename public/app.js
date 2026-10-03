import {
  buildAssetFilename,
  buildSlotPrompt,
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

import { assetSemanticKey, sourceLabel, imageQc, verifyImageSignature, hashBlob, planImports, fitText, wrapText, sessionSignature, productionGates, exportEntries, createZip, safeFilename, BATCH_LIMIT } from "/production-core.js";
import { auditContent } from "/content-quality.js";
import {applyEditorialWork,classifyClaimRisk,prepareEditorialProposal,queuePriority,recordKey,sourceFingerprint} from "/editorial-pipeline.mjs";

const state = {
  unmatched: [],
  sourceLoadToken: 0,
  busy: false,
  rejected: [],
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
  editingProfileId: "",
  editorialRows: [], editorialBatch: null, canonicalMap: null, workById: {}, originalContent: null, appliedWork: false, imageReviews: {}
};
const APPROVED_OPPORTUNITIES_SOURCE = "V4.2 Approved Opportunities";
const WORKFLOW_STAGES = ["IDEA", "COPY_DRAFT", "EDITORIAL_REVIEW", "COPY_APPROVED", "VISUAL_VIDEO_PROMPT", "ASSET_CREATED", "QC_PASSED", "SCHEDULED_PUBLISHED", "RESULTS_RECORDED"];
const WORKFLOW_LABELS = ["Idea", "Copy draft", "Editorial review", "Copy approved", "Visual/video prompt", "Asset created", "QC passed", "Scheduled / published", "Results recorded"];
function initialWorkflowStage(content) {
  const status=String(content?.lifecycleStatus||'').trim().toUpperCase();
  if(status==='POSTED'||status==='PUBLISHED')return 'SCHEDULED_PUBLISHED';
  if(status==='QC_PASSED')return 'QC_PASSED';
  if(status==='ASSET_CREATED')return 'ASSET_CREATED';
  if(status==='APPROVED'||status==='COPY_APPROVED')return 'COPY_APPROVED';
  if(status.includes('REVIEW'))return 'EDITORIAL_REVIEW';
  return content?.contentBody||content?.caption?'COPY_DRAFT':'IDEA';
}
const $ = (id) => document.getElementById(id);
const escapeHtml = (value = "") => String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
let toastTimer;

function toast(message, error) {
  const node = $("toast");
  node.textContent = message;
  node.className = `toast show${error ? " error" : ""}`;
  if (error && $("persistentError")) { $("persistentError").hidden = false; $("persistentError").textContent = message; }
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { node.className = "toast"; }, 3600);
}

function reportRejectedRecords(rejected) {
  state.rejected = rejected;
  $("rejectedPanel").hidden = !rejected.length;
  $("rejectedCount").textContent = `${rejected.length} rejected records`;
  $("rejectedRecords").innerHTML = rejected.map(item => `<tr><td>${escapeHtml(item.contentId)}</td><td>${escapeHtml(item.field || "Source row")}</td><td>${escapeHtml(item.message)}</td><td>${escapeHtml(item.suggestedRepair || "Repair the source field and reload.")}</td></tr>`).join("");
}
const previewUrls = new Map();
function clearPreviewUrls(group) { for (const url of previewUrls.get(group) || []) URL.revokeObjectURL(url); previewUrls.set(group, []); }
function previewUrl(blob, group) { const url = URL.createObjectURL(blob); previewUrls.get(group)?.push(url); return url; }
function reviewSignature() { return sessionSignature(state.content, state.manifest, state.images, state.assets); }
const IMAGE_REVIEW_CHECKS=['REALISM','CORRECT SUBJECT','CORRECT INGREDIENT / OBJECT','CORRECT STAGE','CONTINUITY','NO RANDOM TEXT','NO LOGO/WATERMARK','NO OBVIOUS AI ARTIFACT','CROP ACCEPTABLE','FACTUALLY MATCHES SOURCE'];
function slotReviewKey(slotId){return `capc:image-review:${keyFor('image-review',slotId)}`;}
function slotReviewPassed(entry){const image=state.images[entry.slotId],review=state.imageReviews[entry.slotId];return Boolean(image&&review?.status==='PASS'&&review.imageRevision===image.revision&&review.semanticKey===entry.semanticKey&&IMAGE_REVIEW_CHECKS.every(check=>review.checks?.includes(check)));}
function invalidateReview() { state.visualQcConfirmedFor = ""; }
function refreshStale() {
  for (const item of state.plan) if (state.assets[item.asset_id]) {
    const ids = [...item.generation_inputs.map(i => i.slot_id), ...(item.source_input_ids || [])];
    state.assets[item.asset_id].stale = state.assets[item.asset_id].semanticKey !== assetSemanticKey(item)
      || isStoredAssetStale(item, state.assets[item.asset_id], state.images)
      || ids.some(id => { const entry=state.manifest.entries.find(e=>e.slotId===id); return !state.images[id] || state.images[id].semanticKey!==entry?.semanticKey; });
  }
}
function renderUnmatched() {
  $("unmatchedPanel").hidden = !state.unmatched.length;
  $("unmatchedList").innerHTML = state.unmatched.map((item,index)=>`<div class="unmatched-row"><span>${escapeHtml(item.file.name)} — ${escapeHtml(item.reason)}</span><select aria-label="Destination for ${escapeHtml(item.file.name)}" data-destination="${index}"><option value="">Choose slot…</option>${state.manifest.entries.map(e=>`<option value="${escapeHtml(e.slotId)}">${escapeHtml(e.expectedFilename)}${state.images[e.slotId]?" (replace)":""}</option>`).join("")}</select><button class="btn btn-neutral" data-assign="${index}">Assign image</button></div>`).join("");
  $("unmatchedList").querySelectorAll('[data-assign]').forEach(button=>button.addEventListener('click',async()=>{
    const index=Number(button.dataset.assign),slot=$("unmatchedList").querySelector(`[data-destination="${index}"]`).value;
    if(!slot)return toast("Choose a destination first.",true);
    if(await saveImage(slot,state.unmatched[index].file)){state.unmatched.splice(index,1);renderUnmatched();}
  }));
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
    tx.onabort = () => reject(tx.error || new Error("Storage transaction aborted."));
  }).finally(() => db.close());
}

const getStored = (store, key) => idb(store, "readonly", (objectStore) => objectStore.get(key));
const putStored = (store, key, value) => idb(store, "readwrite", (objectStore) => objectStore.put(value, key));
const deleteStored = (store, key) => idb(store, "readwrite", (objectStore) => objectStore.delete(key));
const sourceKey = () => state.sourceId ? String(state.sourceId) : state.sourceName;
const writeHeaders = () => ({ "content-type": "application/json", "x-content-intelligence-request": "1" });
const splitLines = (value) => String(value || "").split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
const keyFor = (kind, name) => `${sourceKey()}:${state.content.contentId}:${kind}:${name}`;

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
  $("manifestCount").textContent = `Generation Images: ${state.manifest.expectedAssets} · Planned assets: ${state.plan.length} (long method/text may span more pages)`;
  $("manifestList").innerHTML = state.manifest.entries.map((entry) =>
    `<li><b>${String(entry.sequence).padStart(2, "0")}</b><span>${escapeHtml(entry.label)}</span><small>${escapeHtml(entry.expectedFilename)}</small></li>`
  ).join("");
}

function renderSlots() {
  clearPreviewUrls("slots");
  const container = $("slots");
  container.innerHTML = "";
  for (const entry of state.manifest.entries) {
    const stored = state.images[entry.slotId];
    const generationBlocked = !state.generationReadiness?.ready;
    const node = document.createElement("article");
    const stale = Boolean(stored && stored.semanticKey !== entry.semanticKey);
    node.className = `slot${stored ? " ready" : ""}${stale ? " stale" : ""}`;
    node.dataset.slot = entry.slotId;
    node.innerHTML = `
      <div class="slot-preview">${stored ? `<img alt="${escapeHtml(entry.label)} imported image">` : `<div class="slot-empty"><b>${String(entry.sequence).padStart(2, "0")} · ${escapeHtml(entry.label)}</b><span>${escapeHtml(entry.assetType)} · Drop PNG, JPG or WebP</span></div>`}</div>
      <div class="slot-footer">
        <div><div class="slot-name">${String(entry.sequence).padStart(2, "0")} · ${escapeHtml(entry.label)}</div><div class="slot-state">${stale ? `REGEN REQUIRED · source definition changed` : stored ? "Complete" : entry.required ? "Required" : "Optional"}</div></div>
        <small class="image-facts">${escapeHtml(entry.expectedFilename)}${stored?.qc ? `<br>${stored.qc.width} × ${stored.qc.height} · ${stored.qc.orientation}${stored.qc.cropFraction > .03 ? " · Crop required" : ""}<br>${escapeHtml(stored.qc.warnings.join(" "))}` : ""}</small>
        <div class="slot-actions"><button type="button" data-copy-slot ${generationBlocked ? "disabled" : ""}>Copy slot prompt</button><button type="button" data-choose ${generationBlocked ? "disabled" : ""}>${stored ? "Replace" : "Choose"}</button>${stored ? `<button type="button" data-remove ${generationBlocked ? "disabled" : ""}>Remove</button>` : ""}</div>
        ${stored?`<details class="slot-review"><summary>Real-image review · ${slotReviewPassed(entry)?'PASS':state.imageReviews[entry.slotId]?.status||'NOT REVIEWED'}</summary><div class="slot-review-checks">${IMAGE_REVIEW_CHECKS.map((check,index)=>`<label><input type="checkbox" data-review-check="${index}" ${state.imageReviews[entry.slotId]?.checks?.includes(check)?'checked':''}> ${escapeHtml(check)}</label>`).join('')}</div><label>Decision<select data-slot-decision><option value="">Not reviewed</option><option value="PASS">PASS</option><option value="FIX IMAGE">FIX IMAGE</option><option value="REGENERATE">REGENERATE</option></select></label><button type="button" data-save-slot-review>Save image review</button><button type="button" data-copy-repair>Copy this slot prompt</button></details>`:''}
        <input type="file" accept="image/png,image/jpeg,image/webp" hidden>
      </div>`;
    if (stored) node.querySelector("img").src = previewUrl(stored.blob, "slots");
    node.querySelector("[data-copy-slot]").addEventListener("click", () => copyText(buildSlotPrompt(state.content, entry.slotId), "Slot prompt copied."));
    const input = node.querySelector("input");
    node.querySelector("[data-choose]").addEventListener("click", () => input.click());
    input.addEventListener("change", () => input.files[0] && saveImage(entry.slotId, input.files[0]));
    node.querySelector("[data-remove]")?.addEventListener("click", () => removeImage(entry.slotId));
    if(stored){node.querySelector('[data-slot-decision]').value=state.imageReviews[entry.slotId]?.status||'';
      node.querySelector('[data-copy-repair]').addEventListener('click',()=>copyText(buildSlotPrompt(state.content,entry.slotId),'Affected slot prompt copied.'));
      node.querySelector('[data-save-slot-review]').addEventListener('click',()=>{const status=node.querySelector('[data-slot-decision]').value,checks=[...node.querySelectorAll('[data-review-check]:checked')].map(input=>IMAGE_REVIEW_CHECKS[Number(input.dataset.reviewCheck)]);if(status==='PASS'&&checks.length!==IMAGE_REVIEW_CHECKS.length)return toast('Check all ten real-image criteria before PASS.',true);if(!status)return toast('Choose PASS, FIX IMAGE, or REGENERATE.',true);const review={status,checks,imageRevision:stored.revision,semanticKey:entry.semanticKey,reviewedAt:new Date().toISOString()};state.imageReviews[entry.slotId]=review;localStorage.setItem(slotReviewKey(entry.slotId),JSON.stringify(review));invalidateReview();renderSlots();renderQc();if(status!=='PASS')copyText(buildSlotPrompt(state.content,entry.slotId),'Affected slot prompt copied for repair.');else toast('Real-image review PASS recorded for this slot.');});}
    for (const event of ["dragenter", "dragover"]) node.addEventListener(event, (e) => { e.preventDefault(); if (!generationBlocked) node.classList.add("dragover"); });
    for (const event of ["dragleave", "drop"]) node.addEventListener(event, (e) => { e.preventDefault(); node.classList.remove("dragover"); });
    node.addEventListener("drop", (e) => { if (!generationBlocked && e.dataTransfer.files[0]) saveImage(entry.slotId, e.dataTransfer.files[0]); });
    container.appendChild(node);
  }
  updateProgress();
}

function renderAssets() {
  refreshStale();
  clearPreviewUrls("assets");
  const container = $("assetGrid"); container.innerHTML = "";
  let sequence=0;
  for (const item of state.plan) {
    const stored=state.assets[item.asset_id];
    for(const page of stored?.pages?.length ? stored.pages : [stored]) {
      const order=++sequence,node=document.createElement("article");
      node.className=`asset${stored?.stale ? " stale" : ""}`;node.dataset.asset=item.asset_id;
      const filename=`${String(order).padStart(2,"0")}_${safeFilename(item.asset_type)}.png`;
      node.innerHTML=`<div class="asset-preview">${page ? `<img alt="${escapeHtml(item.title)} page ${order}">` : "Not built"}</div><div class="asset-footer"><div><strong>${String(order).padStart(2,"0")} · ${escapeHtml(item.title)}</strong><small>${stored?.stale ? "STALE — REBUILD REQUIRED" : stored ? "CURRENT · 1440 × 1800" : "Build required"}</small></div><button type="button" ${stored && !stored.stale ? "" : "disabled"}>Download</button></div>`;
      if(page)node.querySelector("img").src=previewUrl(page.blob,"assets");
      node.querySelector("button").addEventListener("click",()=>{refreshStale();if(!stored.stale)downloadBlob(page.blob,filename);});container.appendChild(node);
    }
  }
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
  if(state.busy) { toast("Wait for the current build or export to finish.",true); return false; }
  if (!state.generationReadiness?.ready) { toast("Resolve the editorial and specification gate before importing images.",true); return false; }
  const token=state.contentLoadToken,entry=state.manifest.entries.find(item=>item.slotId===slotId),key=keyFor("image",slotId);
  if(!entry)return false;
  try {
    if (!/^image\/(png|jpeg|webp)$/.test(file.type) || file.size > 35*1024*1024) throw Error("Use PNG, JPEG or WebP up to 35 MB.");
    if(!await verifyImageSignature(file))throw Error("File signature does not match its declared image type.");
    const decoded=await loadImage(file);
    const qc=imageQc({type:file.type,size:file.size,width:decoded.naturalWidth,height:decoded.naturalHeight});
    if(qc.status==='FAIL')throw Error(qc.errors.join(' '));
    const hash=await hashBlob(file);
    const duplicate=Object.entries(state.images).find(([id,image])=>id!==slotId && image.hash===hash);
    if(duplicate)qc.warnings.push(`Identical image also used in ${duplicate[0]}; verify that the stages are correct.`);
    if(token!==state.contentLoadToken)return false;
    const value={blob:file,name:file.name,type:file.type,semanticKey:entry.semanticKey,hash,revision:crypto.randomUUID(),qc,updatedAt:Date.now()};
    await putStored("images",key,value);
    if(token!==state.contentLoadToken)return false;
    state.images[slotId]=value;delete state.imageReviews[slotId];localStorage.removeItem(slotReviewKey(slotId));invalidateReview();refreshStale();renderSlots();renderAssets();renderQc();return true;
  } catch(error){toast(`${file.name}: ${error.message}`,true);return false;}
}
async function removeImage(slotId) {
  if(state.busy)return;
  const token=state.contentLoadToken;
  await deleteStored("images",keyFor("image",slotId));
  if(token!==state.contentLoadToken)return;
  delete state.images[slotId];delete state.imageReviews[slotId];localStorage.removeItem(slotReviewKey(slotId));invalidateReview();refreshStale();renderSlots();renderAssets();renderQc();
}
async function importMany(files) {
  if(state.busy || !state.generationReadiness?.ready)return toast("Complete the generation gate before importing.",true);
  const list=Array.from(files);
  if(list.length>60 || list.reduce((sum,file)=>sum+file.size,0)>BATCH_LIMIT)return toast("Import at most 60 files / 160 MB in one batch.",true);
  const token=state.contentLoadToken,{matched,unmatched}=planImports(list,state.manifest,matchGenerationSlot);
  state.unmatched=unmatched;let imported=0;
  for(const {file,slotId} of matched){if(token!==state.contentLoadToken)return;if(await saveImage(slotId,file))imported++;else state.unmatched.push({file,reason:"Import failed; see the error above."});}
  renderUnmatched();toast(`${imported} images matched. ${state.unmatched.length} require explicit assignment.`);$("allFiles").value="";
}

async function loadContentState(token = state.contentLoadToken) {
  state.images = {};
  state.imageReviews = {};
  state.assets = {};
  state.imageReviews={};
  await Promise.all(state.manifest.entries.map(async (entry) => {
    const stableKey = keyFor("image", entry.slotId);
    const legacyKey = `${state.sourceName}:${state.content.contentId}:image:${entry.slotId}`;
    const value = await getStored("images", stableKey) || (legacyKey !== stableKey ? await getStored("images", legacyKey) : null);
    if (token !== state.contentLoadToken) return;
    if (value) {
      if(!value.qc) { try { if(!await verifyImageSignature(value.blob))throw Error("File signature mismatch."); const decoded=await loadImage(value.blob); value.qc=imageQc({type:value.blob.type,size:value.blob.size,width:decoded.naturalWidth,height:decoded.naturalHeight}); } catch { value.qc={status:"FAIL",width:0,height:0,errors:["Stored image cannot decode."],warnings:[]}; } }
      if(token!==state.contentLoadToken)return;
      state.images[entry.slotId] = value;
    }
    if (value && stableKey !== legacyKey && !await getStored("images", stableKey)) await putStored("images", stableKey, value);
  }));
  await Promise.all(state.plan.map(async (item) => {
    const stableKey = keyFor("asset", item.asset_id);
    const legacyKey = `${state.sourceName}:${state.content.contentId}:asset:${item.asset_id}`;
    const value = await getStored("assets", stableKey) || (legacyKey !== stableKey ? await getStored("assets", legacyKey) : null);
    if (token !== state.contentLoadToken) return;
    if (value) {
      const sourceRevision = assetSourceRevision(item);
      state.assets[item.asset_id] = { ...value, sourceRevision: value.sourceRevision || sourceRevision, stale: value.semanticKey !== assetSemanticKey(item) || isStoredAssetStale(item, value, state.images) };
      if (stableKey !== legacyKey && !await getStored("assets", stableKey)) await putStored("assets", stableKey, value);
    }
  }));
  if (token !== state.contentLoadToken) return;
  for(const entry of state.manifest.entries){try{const review=JSON.parse(localStorage.getItem(slotReviewKey(entry.slotId))||'null');if(review?.imageRevision===state.images[entry.slotId]?.revision)state.imageReviews[entry.slotId]=review;}catch{/* Malformed local review is ignored. */}}
  refreshStale();
  state.visualQcConfirmedFor = localStorage.getItem(`capc:visual:${keyFor("review", "visual")}`) || "";
  renderSlots();
  renderAssets();
  renderQc();
}

function applyContent(content) {
  state.contentLoadToken += 1;
  const token = state.contentLoadToken;
  state.unmatched = []; renderUnmatched();
  $("persistentError").hidden = true;
  state.originalContent=content;
  const savedWork=state.workById[content.contentId];
  const applied=applyEditorialWork(content,savedWork,savedWork?.review?.sourceFingerprint);
  state.appliedWork=applied.content!==content&&!savedWork?.stale;
  state.content = { ...applied.content, pageProfile: state.pageProfile || content.pageProfile || null };
  state.images = {};
  state.imageReviews = {};
  state.assets = {};
  state.editorialReviewRecord = null;
  state.workflow = {stage:initialWorkflowStage(content),actor:'',note:'',updatedAt:null};
  state.currentPublicationId = "";
  state.visualQcConfirmedFor = "";
  state.plan = state.content.resolvedAssetPlan;
  state.manifest = buildGenerationManifest(state.content);
  localStorage.setItem(`capc:selectedContent:${sourceKey()}`, state.content.contentId);
  $("sideRecipe").textContent = state.content.title;
  $("sideId").textContent = state.content.contentId;
  $("contentId").textContent = state.content.contentId;
  $("category").textContent = state.content.topic;
  const queueStatus=currentQueueRow()?.contentStatus||((runEditorialReview(state.content).status==='PASS')?'READY':'NEEDS IMPROVEMENT');
  $("status").textContent = `${queueStatus} · SOURCE ${state.content.lifecycleStatus}`;
  $("selectedContentStatus").textContent=queueStatus;
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
  $("slotHelper").textContent = `Match files by sequence or slot name: ${state.manifest.entries.map((entry) => entry.label).join(" → ")}.`;
  $("assetHeading").textContent = `${state.plan.length} planned Facebook assets`;
  renderEditorialForm(state.content.editorialReview || {});
  renderEditorialWorkspace();
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
  refreshStale();
  const stale = state.manifest.entries.filter((entry) => state.images[entry.slotId] && state.images[entry.slotId].semanticKey !== entry.semanticKey);
  const contractStatus = qc.failures.length ? "FAIL" : stale.length || qc.warnings.length ? "WARNING" : "PASS";
  const allFinalAssetsBuilt = state.plan.length > 0 && state.plan.every((item) => {
    const built = state.assets[item.asset_id];
    return built?.qc_status === "PASS" && !built.stale && built.sourceRevision === assetSourceRevision(item);
  });
  const requiredImagesPresent = state.manifest.entries.filter((entry) => entry.required).every((entry) => Boolean(state.images[entry.slotId]));
  const allSlotsReviewed=state.manifest.entries.filter(entry=>entry.required).every(slotReviewPassed);
  const visualQcStatus = !allFinalAssetsBuilt ? "NOT RUN" : allSlotsReviewed&&state.visualQcConfirmedFor === reviewSignature() ? "PASS" : "REVIEW REQUIRED";
  const publishing = derivePublishingReadiness(state.content, {
    generationReadiness: generation,
    requiredImagesPresent,
    finalAssetsPresent: allFinalAssetsBuilt,
    visualQcStatus: visualQcStatus === "REVIEW REQUIRED" ? "NOT CONFIRMED" : visualQcStatus,
    pageProfileReady: state.pageProfileComplete
  });
  const quality = auditContent(state.content);
  const gates = productionGates({contract:qc,editorial,generation,manifest:state.manifest,images:state.images,plan:state.plan,assets:state.assets,visualReviewed:visualQcStatus === "PASS",monetization:quality});
  if(!gates.technicalImageQc || stale.length) { publishing.ready=false; if(publishing.status!=="PUBLISHED")publishing.status="NOT_READY"; publishing.blockers.push("Technical image QC and current source definitions must pass."); }
  state.gates=gates;
  $("monetizationScore").textContent=`${quality.score}/100 heuristic score · human editorial approval is separate`;
  $("monetizationDetails").textContent=quality.issues.map(i=>i.repair).join(" ") || "Complete human editorial and visual review before posting. This internal score does not guarantee Meta eligibility.";
  setGate("sourceImagesGate","sourceImagesStatus",gates.sourceImagesComplete?"COMPLETE":"INCOMPLETE");
  setGate("technicalGate","technicalStatus",gates.technicalImageQc?"PASS":"NOT READY");
  setGate("finalAssetsGate","finalAssetsStatus",gates.finalAssetsBuilt?"BUILT":"REBUILD REQUIRED");
  setGate("exportGate","exportStatus",gates.exportReady?"READY":"NOT READY");
  $("downloadAll").disabled=!gates.exportReady || state.busy;
  $("exportHint").textContent=gates.exportReady?"Review the numbered thumbnails, then download one ZIP with images, caption and manifest.":"ZIP requires editorial approval, current images and final assets, technical QC and manual visual review of every required slot and final asset.";
  $("nextAction").textContent=!generation.ready?"Next: resolve editorial and generation blockers below.":!gates.sourceImagesComplete?"Next: copy the prompt, generate images, and import the named files.":!gates.finalAssetsBuilt?"Next: build or rebuild the final assets.":visualQcStatus!=="PASS"?"Next: inspect every preview and confirm the visual review checklist.":"Next: download your ordered production ZIP.";
  const combinedStatus = contractStatus === "FAIL" ? "fail" : editorial.status === "BLOCKED" ? "blocked" : editorial.status === "REVIEW" || generation.status === "GENERATION_BLOCKED" ? "review" : "pass";
  const details = [
    ...qc.failures.map((item) => `${item.code}: ${item.detail}`),
    ...qc.warnings.map((item) => `${item.code}: ${item.detail}`),
    ...stale.map((entry) => `REGEN REQUIRED: ${entry.label} — source definition changed`),
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
  $("visualQcCheck").disabled = !allFinalAssetsBuilt||!allSlotsReviewed;
  $("visualQcCheck").checked = allSlotsReviewed&&state.visualQcConfirmedFor === reviewSignature();
  $("visualQcHint").textContent = allFinalAssetsBuilt
    ? "Review realism, continuity, correct objects and stages, comparison accuracy, safe crop, readable text, logos and AI artifacts. Confirmation survives reload and resets when dependencies change."
    : "Review each imported image against ten criteria and build all final assets before confirming final visual QC.";
  $("copyPrompt").disabled = !generation.ready;
  $("importAll").disabled = !generation.ready;
  $("buildAssets").disabled = !generation.ready || !gates.technicalImageQc || stale.length > 0 || state.busy;
  $("copyCaption").disabled = editorial.status !== "PASS";
  $("copyCaptionBottom").disabled = editorial.status !== "PASS";
  $("writeHint").textContent = state.writable
    ? (publishing.ready && publicationRecorded && workflowPublished ? "Production gates and publication record pass. Mark Posted writes only the Status field." : `Sheet status write is blocked: ${publishing.blockers[0] || (!publicationRecorded ? "save the matching post URL and publish date" : "advance the workflow to Scheduled / Published")}`)
    : "This source is read-only; production data will not be changed.";
  state.editorialReview = editorial;
  state.generationReadiness = generation;
  state.publishingReadiness = publishing;
  $("workCopyMaster").disabled=!generation.ready;
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
  $("sourceSetupStatus").textContent = `${readiness.replaceAll("_", " ")} · PAGE PROFILE ${state.pageProfileComplete ? "COMPLETE" : "INCOMPLETE"}`;
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
  const [workflowData, resultsData] = await Promise.all([
    apiJson(`/api/production/workflow?${query}`),
    apiJson(`/api/production/results?${new URLSearchParams({ sheetId: String(state.sourceId), pageProfileId: state.pageProfile?.profileId || "" })}`)
  ]);
  if (token !== state.contentLoadToken) return;
  // The selected /api/recipes response already contains the Sheet review.
  // Re-reading the entire worksheet here caused a redundant Apps Script request per selection.
  state.editorialReviewRecord = state.content.editorialReviewPresent ? {source:'sheet',review:state.content.editorialReview} : null;
  state.workflow = workflowData.workflow || {stage:initialWorkflowStage(state.content),actor:'',note:'',updatedAt:null};
  state.resultsSummary = resultsData.summary;
  renderEditorialForm(state.content.editorialReview || {});
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
      visualQcPass: state.visualQcConfirmedFor === reviewSignature()
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
  state.filtered = [];
  state.plan = [];
  state.manifest = { entries: [], expectedAssets: 0 };
  state.images = {};
  state.assets = {};
  state.editorialReviewRecord = null;
  state.workflow = null;
  state.resultsSummary = null;
  state.gates = null;
  state.generationReadiness = null;
  state.publishingReadiness = null;
  state.visualQcConfirmedFor = "";
  $("recipeSelect").innerHTML = "";
  $("title").textContent = message;
  $("selectedContentStatus").textContent="NO RECORD";
  $("contentId").textContent = "—";
  for (const id of ["contentType", "templateType", "visualProfile", "hookType", "hookText"]) $(id).textContent = "—";
  $("captionPreview").textContent = "";
  $("publishHeading").textContent = "NOT READY TO POST";
  $("monetizationScore").textContent = "Not evaluated";
  $("monetizationDetails").textContent = message;
  $("editorialNote").textContent = "Choose a valid content record to run the editorial check.";
  $("nextAction").textContent = message;
  $("exportHint").textContent = "Choose a valid content record before exporting.";
  $("writeHint").textContent = "No content record is selected; status writes are blocked.";
  for (const [container, status] of [["contractGate", "qcStatus"], ["editorialGate", "editorialStatus"], ["generationGate", "generationStatus"], ["sourceImagesGate", "sourceImagesStatus"], ["technicalGate", "technicalStatus"], ["finalAssetsGate", "finalAssetsStatus"], ["exportGate", "exportStatus"], ["visualGate", "visualStatus"], ["publishingGate", "publishingStatus"]]) setGate(container, status, "NOT RUN");
  $("visualQcCheck").checked = false;
  $("visualQcCheck").disabled = true;
  $("sideRecipe").textContent = message;
  $("sideId").textContent = "";
  clearPreviewUrls("slots"); clearPreviewUrls("assets");
  $("slots").innerHTML = "";
  $("assetGrid").innerHTML = "";
  $("downloadAll").disabled = true;
  state.unmatched=[];renderUnmatched();
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

function queueKey(row) { return recordKey(row.sheetId, row.contentId); }
function currentQueueRow() { return state.editorialRows.find(row => Number(row.sheetId)===Number(state.sourceId) && row.contentId===state.content?.contentId); }
function batchItem(row) { return state.editorialBatch?.items?.find(item=>Number(item.sheetId)===Number(row.sheetId)&&item.contentId===row.contentId); }
function renderEditorialQueue() {
  const filter=$('queueFilter').value,search=$('queueSearch').value.trim().toLowerCase(),showDup=$('queueShowDuplicates').checked;
  const selected=state.editorialRows.filter(row=>{
    if(!showDup&&filter!=='DUPLICATE'&&row.duplicateStatus==='HOLD_DUPLICATE')return false;
    if(search&&![row.contentId,row.title,row.source,row.contentType].some(value=>String(value||'').toLowerCase().includes(search)))return false;
    if(filter==='ALL')return true;
    if(filter==='BATCH 01')return Boolean(batchItem(row));
    if(filter==='DUPLICATE')return row.duplicateStatus==='HOLD_DUPLICATE'||row.duplicateStatus==='REWORK';
    if(filter==='EDITORIAL REVIEW REQUIRED')return row.editorialStatus!=='HUMAN APPROVED';
    if(filter==='SOURCE REVIEW REQUIRED')return row.issueCodes.includes('SOURCE_REVIEW_REQUIRED');
    if(filter==='MISSING FACTS')return row.issueCodes.some(code=>/MISSING|QUANTIT|WHY_NOT_EXPLICIT/.test(code));
    if(filter==='IMAGE READY')return row.imageReady;
    if(filter==='PUBLISHED')return ['PUBLISHED','Posted'].includes(row.lifecycleStatus);
    return row.contentStatus===filter;
  });
  $('queueSummary').textContent=`${selected.length} shown · ${state.editorialRows.length} source records · ${state.editorialRows.filter(row=>row.duplicateStatus==='HOLD_DUPLICATE').length} held duplicate copies · ranked by editorial priority`;
  const batch=state.editorialBatch?.items||[],inBatch=key=>state.editorialRows.find(row=>queueKey(row)===key),approved=batch.filter(item=>inBatch(recordKey(item.sheetId,item.contentId))?.editorialStatus==='HUMAN APPROVED').length,needs=batch.filter(item=>inBatch(recordKey(item.sheetId,item.contentId))?.editorialStatus==='NEEDS CHANGES').length;
  $('batchProgress').textContent=`Production Batch 01 · Approved ${approved} / ${batch.length} · Needs Fix ${needs} · Remaining ${batch.length-approved-needs} · AI prepared ${batch.length}`;
  $('queueRows').innerHTML=selected.map(row=>`<tr><td><button type="button" class="queue-open" data-queue-key="${escapeHtml(queueKey(row))}">${escapeHtml(row.contentId)}</button><br>${escapeHtml(row.title)}</td><td>${escapeHtml(row.source)}<br><small>${escapeHtml(row.contentType)}</small></td><td>${row.score}/100<br><small>${escapeHtml(row.contentStatus)}</small></td><td>${escapeHtml(row.issueCodes.slice(0,3).join(', ')||'No heuristic issue')}<br><small>${escapeHtml(row.duplicateStatus)}${row.canonicalKey&&row.duplicateStatus==='HOLD_DUPLICATE'?` → ${escapeHtml(row.canonicalKey)}`:''}</small></td><td>${escapeHtml(row.editorialStatus)}</td><td>${escapeHtml(row.nextAction)}</td></tr>`).join('')||'<tr><td colspan="6">No records match this filter.</td></tr>';
  $('queueRows').querySelectorAll('[data-queue-key]').forEach(button=>button.addEventListener('click',()=>openQueueItem(state.editorialRows.find(row=>queueKey(row)===button.dataset.queueKey))));
  if(state.content){const current=currentQueueRow();if(current)$('status').textContent=`${current.contentStatus} · SOURCE ${state.content.lifecycleStatus}`;}
  if(state.content){const current=currentQueueRow();if(current)$('selectedContentStatus').textContent=current.contentStatus;}
}
async function loadEditorialQueue() {
  $('queueLoad').disabled=true;$('queueSummary').textContent='Loading all three production worksheets…';
  try {
    const [batchResult,mapResult,...sourceResults]=await Promise.all([
      apiJson('/api/editorial/batch'),apiJson('/api/editorial/canonical-map'),
      ...state.sources.filter(source=>['2026091901','812541719','433728120'].includes(String(source.sheetId))).map(source=>apiJson(`/api/recipes?sheetId=${source.sheetId}`))
    ]);
    state.editorialBatch=batchResult.batch;state.canonicalMap=mapResult.map;
    const dup=new Map();for(const group of state.canonicalMap.groups||[]){const canonical=recordKey(group.canonical.sheetId,group.canonical.contentId);dup.set(canonical,{status:'CANONICAL',canonical});for(const item of group.duplicates)dup.set(recordKey(item.sheetId,item.contentId),{status:'HOLD_DUPLICATE',canonical});}
    const rework=new Set((state.canonicalMap.reviewPairs||[]).flatMap(pair=>[pair.left,pair.right].map(item=>`${item.source}:${item.contentId}`)));
    const rows=[];
    for(const data of sourceResults){const sheetId=Number(data.sheetId||data.sourceState?.sheetId||data.sheet?.sheetId||data.records?.[0]?.Sheet_ID||0),source=state.sources.find(item=>Number(item.sheetId)===sheetId)||state.sources.find(item=>item.title===data.sourceName);
      const resolvedId=sheetId||Number(source?.sheetId);if(!resolvedId)throw Error('Worksheet identity missing from queue source response.');
      for(const content of normalizeContentRecordsSafely(data.records||data.recipes||[]).records){const quality=auditContent(content),key=recordKey(resolvedId,content.contentId),assignment=dup.get(key),work=data.editorialWork?.[content.contentId],decision=work?.stale?'STALE':work?.review?.decision||'',editorialStatus=decision==='APPROVED'?'HUMAN APPROVED':decision==='NEEDS_CHANGES'?'NEEDS CHANGES':decision==='HOLD'?'HOLD':decision==='SKIP'?'SKIPPED':decision==='STALE'?'STALE REVIEW':'EDITORIAL REVIEW REQUIRED';
        const editorial=runEditorialReview(content),contract=runContentQc(content);const issues=[...new Set([...quality.issues.map(issue=>issue.code),...editorial.issues.map(issue=>issue.code)])];const contentStatus=contract.failures.length?"INVALID":decision==="HOLD"||assignment?.status==="HOLD_DUPLICATE"?"HOLD":(decision==="APPROVED"&&!work?.stale)||(!work&&editorial.status==="PASS")?"READY":quality.status==="HOLD"?"HOLD":"NEEDS IMPROVEMENT";const row={sheetId:resolvedId,source:source?.title||source?.name||String(resolvedId),contentId:content.contentId,title:content.title,contentType:content.contentType,lifecycleStatus:content.lifecycleStatus,score:quality.score,contentStatus,issueCodes:issues,dimensions:quality.dimensions,riskTier:classifyClaimRisk(content).tier,duplicateStatus:assignment?.status||(rework.has(`${source?.title||source?.name}:${content.contentId}`)?'REWORK':'UNIQUE'),canonicalKey:assignment?.canonical,editorialStatus,work,content,imageReady:false};
        row.nextAction=row.duplicateStatus==='HOLD_DUPLICATE'?'Use canonical record or rework':decision==='STALE'?'Re-review changed source':editorialStatus==='HUMAN APPROVED'?'Generate or review images':editorialStatus==='NEEDS CHANGES'?'Fix proposed content':editorialStatus==='HOLD'?'Resolve hold':quality.issues[0]?.repair||'Review and approve editorial';row.priority=queuePriority(row);rows.push(row);
      }
    }
    await Promise.all(rows.map(async row=>{if(row.editorialStatus!=='HUMAN APPROVED')return;const manifest=buildGenerationManifest(row.content);row.imageReady=manifest.entries.filter(entry=>entry.required).every(entry=>false);const images=await Promise.all(manifest.entries.filter(entry=>entry.required).map(entry=>getStored('images',`${row.sheetId}:${row.contentId}:image:${entry.slotId}`).catch(()=>null)));row.imageReady=images.length>0&&images.every(Boolean);}));
    state.editorialRows=rows.sort((a,b)=>b.priority-a.priority||b.score-a.score||a.contentId.localeCompare(b.contentId));renderEditorialQueue();renderEditorialWorkspace();
    const loadedSources=new Set(rows.map(row=>row.sheetId));
    $('platformStatus').textContent=loadedSources.size===3?'PRODUCTION READY':loadedSources.size>0?'PRODUCTION READY WITH WARNINGS':'NOT PRODUCTION READY';
    $('platformHint').textContent=`${loadedSources.size}/3 production Sheets loaded · ${rows.length} records · content approval remains per item.`;
  } catch(error){$('platformStatus').textContent='NOT PRODUCTION READY';$('platformHint').textContent='A production source or editorial service failed to load.';$('queueSummary').textContent=`Editorial Queue unavailable: ${error.message}`;toast(error.message,true);}finally{$('queueLoad').disabled=false;}
}
async function openQueueItem(row) {
  if(!row)return;
  if(Number(state.sourceId)===Number(row.sheetId)&&state.records.some(item=>item.contentId===row.contentId))applyContent(state.records.find(item=>item.contentId===row.contentId));
  else await loadSource(String(row.sheetId),row.contentId);
  $('recipe').scrollIntoView({behavior:'smooth',block:'start'});
}
function nextEditorialReview(){const rows=$('queueFilter').value==='BATCH 01'?state.editorialRows.filter(row=>batchItem(row)).sort((a,b)=>batchItem(a).batchOrder-batchItem(b).batchOrder):state.editorialRows.filter(row=>row.duplicateStatus!=='HOLD_DUPLICATE');if(!rows.length)return;const index=rows.findIndex(row=>Number(row.sheetId)===Number(state.sourceId)&&row.contentId===state.content?.contentId);openQueueItem(rows[(index+1)%rows.length]);}

function renderEditorialWorkspace(){
  const source=state.originalContent,row=currentQueueRow();if(!source)return;
  const item=row&&batchItem(row),work=state.workById[source.contentId],draft=work?.review?.proposal||item?.proposed||prepareEditorialProposal(source),prepared=prepareEditorialProposal(source),review=work?.review?.editorial||{};
  $('workspaceState').textContent=work?.stale?'SOURCE CHANGED · RE-REVIEW':work?.review?.decision==='APPROVED'?'HUMAN APPROVED':work?.review?.decision||'AI PREPARED';
  $('workspaceScore').textContent=`Heuristic score ${row?.score??auditContent(source).score}/100`;
  $('workspaceRisk').textContent=`${classifyClaimRisk(source).tier} RISK`;
  $('workspaceSource').textContent=`${state.sourceName} · ${source.contentId}`;
  $('duplicateStatus').textContent=`Duplicate ${row?.duplicateStatus||'UNASSESSED'}`;
  $('sourceEvidenceStatus').textContent=`Evidence ${review.source_evidence_status||source.editorialReview?.source_evidence_status||'UNVERIFIED'}`;
  $('originalTitle').textContent=source.title;$('originalBody').textContent=source.contentBody;$('originalCaption').textContent=source.caption;
  for(const [id,value] of Object.entries({proposalTitle:draft.title,proposalHook:draft.hook,proposalBody:draft.body,proposalCaption:draft.caption,proposalChanges:(work?.review?.changes||item?.changesMade||prepared.changes).join('\n'),proposalQuestions:(work?.review?.questions||item?.remainingFactualQuestions||prepared.questions).join('\n'),workReviewer:work?.reviewer||localStorage.getItem('capc:reviewer')||'',workAudienceNeed:review.audience_need||'',workReaderValue:review.reader_value||item?.readerValue||'',workEvidenceReferences:(review.evidence?.references||[]).join('\n'),workEvidenceNotes:review.evidence?.notes||'',workReviewNote:review.review_note||''}))setFormValue(id,value);
  const checkMap={workConsistency:'internal_consistency_checked',workCaptionApproved:'caption_review_status',workReaderCopyReviewed:'reader_facing_copy_reviewed',workClaimSafety:'claim_safety_ok',workNoInternal:'internal_note_leakage',workEvidenceVerified:'source_evidence_status',workPageFit:'page_fit_status'};
  for(const [id,key] of Object.entries(checkMap))$(id).checked=key==='caption_review_status'?review[key]==='PASS':key==='internal_note_leakage'?review[key]===false:key==='source_evidence_status'?review[key]==='VERIFIED':key==='page_fit_status'?review[key]==='PASS':review[key]===true;
  $('workspaceAssetPlan').innerHTML=(item?.assetPlan||prepared.assetPlan).map(asset=>`<p><strong>${escapeHtml(String(asset.sequence||'').padStart(2,'0'))} · ${escapeHtml(asset.type)}</strong> ${escapeHtml(asset.title)}<br><small>${escapeHtml(asset.overlayText)}</small></p>`).join('');
  $('workspaceActionHint').textContent=work?.stale?'Source row changed after the saved decision. Review current facts and save a fresh decision.':item?'Production Batch 01 · AI prepared. Human approval remains separate.': 'Source text is preserved. Edit the proposed copy, review the facts, and record a named decision.';
  $('workCopyMaster').disabled=!state.generationReadiness?.ready;
}
async function saveEditorialWork(decision){
  if(!state.originalContent||!state.sourceId)return toast('Choose a connected content record first.',true);
  const reviewer=$('workReviewer').value.trim();if(!reviewer)return toast('Enter the human reviewer name.',true);
  const body={sheetId:state.sourceId,contentId:state.originalContent.contentId,sourceFingerprint:await sourceFingerprint(state.originalContent.raw),decision,reviewer,
    proposal:{title:$('proposalTitle').value,hook:$('proposalHook').value,body:$('proposalBody').value,caption:$('proposalCaption').value},
    changes:splitLines($('proposalChanges').value),questions:splitLines($('proposalQuestions').value),audienceNeed:$('workAudienceNeed').value,readerValue:$('workReaderValue').value,
    evidenceReferences:splitLines($('workEvidenceReferences').value),evidenceNotes:$('workEvidenceNotes').value,reviewNote:$('workReviewNote').value,
    consistencyChecked:$('workConsistency').checked,captionApproved:$('workCaptionApproved').checked,readerFacingCopyReviewed:$('workReaderCopyReviewed').checked,claimSafetyOk:$('workClaimSafety').checked,noInternalNotes:$('workNoInternal').checked,evidenceVerified:$('workEvidenceVerified').checked,pageFitApproved:$('workPageFit').checked};
  try{const saved=await apiJson('/api/production/editorial-work',{method:'POST',headers:writeHeaders(),body:JSON.stringify(body)});if(saved.item?.review?.decision!==decision)throw Error('Editorial review readback did not match.');
    localStorage.setItem('capc:reviewer',reviewer);state.workById[state.originalContent.contentId]={...saved.item,stale:false};const row=currentQueueRow();if(row){row.work=state.workById[state.originalContent.contentId];row.editorialStatus=decision==='APPROVED'?'HUMAN APPROVED':decision==='NEEDS_CHANGES'?'NEEDS CHANGES':decision==='HOLD'?'HOLD':'SKIPPED';row.contentStatus=decision==='APPROVED'?'READY':decision==='HOLD'?'HOLD':'NEEDS IMPROVEMENT';row.nextAction=decision==='APPROVED'?'Generate or review images':decision==='NEEDS_CHANGES'?'Fix proposed content':decision==='HOLD'?'Resolve hold':'Next review';}
    applyContent(state.originalContent);renderEditorialQueue();toast(`Editorial ${decision.replace('_',' ')} saved and read back; original Sheet row preserved.`);
  }catch(error){toast(`${error.message}${error.issues?.length?` ${error.issues.map(issue=>issue.code).join(', ')}`:''}`,true);}
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

let renderOverflow=[];
function linesFor(context, text, maxWidth) { return wrapText(text,maxWidth,value=>context.measureText(value).width); }
function drawLines(context,text,x,y,width,lineHeight,maxLines) {
  const originalFont=context.font;
  const size=Number(originalFont.match(/(\d+(?:\.\d+)?)px/)?.[1]||38);
  const bottom=Math.min(1720,y+lineHeight*(maxLines||99));
  const fit=fitText(text,{width,height:bottom-y,maxSize:size,minSize:Math.min(size,30),measure:(value,fontSize)=>{context.font=originalFont.replace(/[\d.]+px/,`${fontSize}px`);return context.measureText(value).width;}});
  context.font=originalFont.replace(/[\d.]+px/,`${fit.size}px`);
  fit.lines.forEach((line,index)=>context.fillText(line,x,y+index*fit.lineHeight));
  if(fit.overflow.length)renderOverflow.push(fit.overflow.join("\n"));
  context.font=originalFont;return fit.lines.length;
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
  const heading = assetItem.local_heading || "";
  const body = String(assetItem.overlay_text || assetItem.purpose).replace(/；/g, "\n").replace(/。$/g, "");
  context.font = '500 50px "Noto Sans SC", "PingFang SC", sans-serif';
  const metrics = calculateAdaptivePanel({ label, heading, body, measure: (text) => context.measureText(text).width });
  metrics.panelHeight=Math.max(metrics.panelHeight, Math.min(1200,180+linesFor(context,body,1170).length*70));
  metrics.imageHeight=1800-metrics.panelHeight;
  coverDraw(context, await firstImageFor(assetItem), 0, 0, 1440, metrics.imageHeight + 70);
  context.fillStyle = "#fff";
  context.fillRect(70, metrics.imageHeight, 1300, metrics.panelHeight - 70);
  context.fillStyle = "#f96332";
  context.font = '700 44px Montserrat, "Noto Sans SC", sans-serif';
  drawLines(context,label,130,metrics.imageHeight+70,1170,58,1);
  let cursorY = metrics.imageHeight + 145;
  if (heading) {
    context.fillStyle = "#252422";
    context.font = '700 58px "Noto Sans SC", "PingFang SC", sans-serif';
    context.textBaseline = "top";
    cursorY += drawLines(context, heading, 130, cursorY, 1170, 72, 3) * 72 + 18;
  }
  context.fillStyle = "#252422";
  context.font = '500 50px "Noto Sans SC", "PingFang SC", sans-serif';
  context.textBaseline = "top";
  drawLines(context, body, 130, cursorY, 1170, 67, Math.floor((1720-cursorY)/67));
  return canvas;
}

async function buildMethodGrid(assetItem) {
  const outputs=[];
  const inputs=assetItem.generation_inputs;
  for(let offset=0;offset<inputs.length;offset+=2) {
    const {canvas,context}=canvas2d();
    context.fillStyle="#f4f3ef";context.fillRect(0,0,1440,1800);
    const group=inputs.slice(offset,offset+2);
    for(let local=0;local<group.length;local++) {
      const input=group[local],index=offset+local;
      const cellHeight=group.length===1?1800:900,y=local*cellHeight,captionHeight=group.length===1?390:270,imageHeight=cellHeight-captionHeight;
      const image=await loadImage(state.images[input.slot_id].blob);
      coverDraw(context,image,8,y+8,1424,imageHeight-8);
      context.fillStyle="#fff";context.fillRect(8,y+imageHeight,1424,captionHeight-8);
      context.fillStyle="#f96332";context.beginPath();context.arc(88,y+imageHeight+70,43,0,Math.PI*2);context.fill();
      context.fillStyle="#fff";context.textAlign="center";context.textBaseline="middle";context.font="700 38px Montserrat,sans-serif";context.fillText(String(index+1),88,y+imageHeight+70);
      context.fillStyle="#252422";context.textAlign="left";context.textBaseline="top";
      const caption=String(input.overlay_text||`${input.step_heading||input.label}\n${input.step_supporting_text||""}`);
      const [heading,...body]=caption.split("\n");context.font='700 50px "Noto Sans SC", "PingFang SC", sans-serif';
      drawLines(context,heading,165,y+imageHeight+29,1190,65,1);
      context.font='500 43px "Noto Sans SC", "PingFang SC", sans-serif';
      const support=body.join(" ")||input.step_supporting_text||"";
      const before=renderOverflow.length;
      drawLines(context,support,165,y+imageHeight+112,1190,60,group.length===1?4:2);
      if(renderOverflow.length>before)renderOverflow[renderOverflow.length-1]=`步骤 ${index+1} ${heading}\n${renderOverflow[renderOverflow.length-1]}`;
    }
    outputs.push(canvas);
  }
  return outputs;
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
  if (assetItem.layout_type === "cover_overlay") return [await buildCoverAsset(assetItem)];
  if (assetItem.layout_type === "detail_overlay") return [await buildDetailAsset(assetItem)];
  return [await buildInformationAsset(assetItem)];
}

function canvasBlob(canvas) {
  return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Canvas export failed.")), "image/png", 1));
}

async function buildAssets() {
  if (!state.generationReadiness?.ready) return toast("Build is blocked until editorial and generation readiness pass.", true);
  const missing = state.manifest.entries.filter((entry) => entry.required && !state.images[entry.slotId]).map((entry) => entry.label);
  if (missing.length) return toast(`Missing required images: ${missing.join(", ")}.`, true);
  if(state.busy)return;
  state.busy=true;invalidateReview();
  const token=state.contentLoadToken;
  const button = $("buildAssets");
  button.disabled = true;
  button.textContent = `Building ${state.plan.length} assets…`;
  try {
    await document.fonts.ready;
    await document.fonts.load('500 38px "PingFang SC"', '食材做法熟透');
    for (const assetItem of state.plan) {
      try {
        if(state.assets[assetItem.asset_id] && !state.assets[assetItem.asset_id].stale && state.assets[assetItem.asset_id].sourceRevision===assetSourceRevision(assetItem))continue;
        const dependency=assetSourceRevision(assetItem),semantic=assetSemanticKey(assetItem);
        const storageKey=keyFor("asset",assetItem.asset_id);
        renderOverflow=[];
        const canvases = await buildAssetCanvas(assetItem);
        const pages=[];
        for (const canvas of canvases) { if(canvas.width!==1440 || canvas.height!==1800)throw Error("Incorrect output dimensions."); pages.push({blob:await canvasBlob(canvas)});canvas.width=1;canvas.height=1; }
        const overflow=renderOverflow.join("\n\n");
        if(overflow) {
          let remaining=overflow;
          while(remaining) {
            const {canvas:extra,context:ctx}=canvas2d();ctx.fillStyle="#f4f3ef";ctx.fillRect(0,0,1440,1800);ctx.textBaseline="top";ctx.fillStyle="#f96332";ctx.font='700 36px "PingFang SC",sans-serif';ctx.fillText("补充说明",100,90);
            const fit=fitText(remaining,{width:1240,height:1470,maxSize:46,minSize:36,measure:(value,size)=>{ctx.font=`500 ${size}px "Noto Sans SC", "PingFang SC", sans-serif`;return ctx.measureText(value).width;}});
            ctx.fillStyle="#252422";ctx.font=`500 ${fit.size}px "Noto Sans SC", "PingFang SC", sans-serif`;fit.lines.forEach((line,index)=>ctx.fillText(line,100,210+index*fit.lineHeight));
            pages.push({blob:await canvasBlob(extra)});extra.width=1;extra.height=1;remaining=fit.overflow.join("\n");
            if(pages.length>30)throw Error("Text exceeds 30 continuation pages; restructure the source.");
          }
        }
        if(token!==state.contentLoadToken || dependency!==assetSourceRevision(assetItem) || semantic!==assetSemanticKey(assetItem))throw Error("Content or images changed during build; rebuild required.");
        const value = {
          blob: pages[0].blob,
          pages,
          filename: buildAssetFilename(state.content, assetItem),
          width: 1440,
          height: 1800,
          qc_status: "PASS",
          semanticKey: assetSemanticKey(assetItem),
          sourceRevision: assetSourceRevision(assetItem),
          stale: false,
          updatedAt: Date.now()
        };
        await putStored("assets", storageKey, value);
        if(token!==state.contentLoadToken)return;
        state.assets[assetItem.asset_id] = value;
      } catch (error) {
        throw new Error(`${assetItem.title} failed: ${error.message}`);
      }
    }
    renderAssets();
    renderQc();
    toast(`${Object.values(state.assets).reduce((n,a)=>n+(a.pages?.length||1),0)} final assets are ready.`);
  } catch (error) {
    renderAssets();
    renderQc();
    toast(error.message, true);
  } finally {
    state.busy=false;
    renderQc();
    button.innerHTML = "<span>04</span>Build Final Assets";
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
      body: JSON.stringify({ technicalImageQcPass: state.gates.technicalImageQc, noStaleAssets: state.gates.finalAssetsBuilt, status: "Posted", sheetId: state.sourceId, requiredImagesPresent: true, finalAssetsPresent: true, visualQcPass: state.visualQcConfirmedFor === reviewSignature() })
    });
    if(result.contentId!==state.content.contentId || Number(result.sheetId)!==state.sourceId || result.status!=="Posted")throw Error("Status readback did not match the selected record.");
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
  $('queueLoad').addEventListener('click',loadEditorialQueue);
  for(const id of ['queueFilter','queueSearch','queueShowDuplicates'])$(id).addEventListener(id==='queueSearch'?'input':'change',renderEditorialQueue);
  for(const [id,decision] of [['workApprove','APPROVED'],['workNeeds','NEEDS_CHANGES'],['workHold','HOLD'],['workSkip','SKIP']])$(id).addEventListener('click',()=>saveEditorialWork(decision));
  $('workNext').addEventListener('click',nextEditorialReview);
  $('workCopyMaster').addEventListener('click',()=>state.generationReadiness?.ready?copyText(buildSessionPrompt(state.content),'Master ChatGPT session prompt copied.'):toast('Human editorial approval and generation specification are required before image production.',true));
  document.addEventListener('keydown',event=>{if(event.altKey&&event.key.toLowerCase()==='n'&&!['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName)){event.preventDefault();nextEditorialReview();}});
  $("sheetSelect").addEventListener("change", (event) => loadSource(event.target.value));
  $("recipeSelect").addEventListener("change", (event) => {
    const content = state.records.find((item) => item.contentId === event.target.value);
    if (content && !state.busy) applyContent(content);
  });
  $("search").addEventListener("input", (event) => {
    const query = event.target.value.trim().toLowerCase();
    const records = query ? state.records.filter((content) => [content.contentId, content.title, content.topic, content.contentType, content.templateType].some((value) => String(value).toLowerCase().includes(query))) : state.records;
    renderOptions(records);
  });
  $("prev").addEventListener("click", () => { if(!state.busy)moveContent(-1); });
  $("next").addEventListener("click", () => { if(!state.busy)moveContent(1); });
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
  $("refreshSheets").addEventListener("click", () => refreshSheets(true, true));
  $("assignPageProfile").addEventListener("click", assignPageProfile);
  $("savePageProfile").addEventListener("click", savePageProfile);
  $("targetPageProfile").addEventListener("change", (event) => fillProfileForm(state.profiles.find((profile) => profile.profileId === event.target.value) || {}));
  $("openAddSheet").addEventListener("click", openAddSheet);
  $("closeAddSheet").addEventListener("click", () => { $("addSheetPanel").hidden = true; });
  $("newSheetTemplate").addEventListener("change", renderSheetTemplatePreview);
  $("createSheet").addEventListener("click", createSheet);
  $("visualQcCheck").addEventListener("change", (event) => {
    state.visualQcConfirmedFor = event.target.checked ? reviewSignature() : "";
    localStorage.setItem(`capc:visual:${keyFor("review", "visual")}`, state.visualQcConfirmedFor);
    renderQc();
  });
  $("downloadAll").addEventListener("click", downloadPackage);
  for(const event of ["dragover","drop"]) $("images").addEventListener(event,e=>e.preventDefault());
  $("images").addEventListener("drop",e=>{if(!e.target.closest(".slot"))importMany(e.dataTransfer.files);});

}

function renderSourceOptions() {
  const currentValue = state.source === "approved-opportunities" ? APPROVED_OPPORTUNITIES_SOURCE : String(state.sourceId || "");
  const options = state.sources.map((source) => `<option value="${escapeHtml(source.sheetId)}">${escapeHtml(sourceLabel(source))}</option>`);
  let localCount = 'count unavailable';
  try { const handoffs = JSON.parse(localStorage.getItem('content-ai-v4-2-approved') || '[]'); if (Array.isArray(handoffs)) localCount = `${handoffs.filter(item => item?.production_draft).length} records`; } catch { /* The handoff loader reports malformed data. */ }
  options.push(`<option value="${escapeHtml(APPROVED_OPPORTUNITIES_SOURCE)}">V4.2 Approved Opportunities · ${localCount} · Local handoff · read-only</option>`);
  $("sheetSelect").innerHTML = options.join("");
  if ([...$("sheetSelect").options].some((option) => option.value === currentValue)) $("sheetSelect").value = currentValue;
}

async function refreshSheets(keepCurrent = false, forceLiveRefresh = false) {
  try {
    const data = await apiJson(forceLiveRefresh ? "/api/sheets?refresh=1" : "/api/sheets");
    state.sources = Array.isArray(data.sheets) ? data.sheets : [];
    state.profiles = Array.isArray(data.profiles) ? data.profiles : [];
    renderSourceOptions();
    const stored = localStorage.getItem("capc:selectedSourceId") || localStorage.getItem("capc:selectedSource") || "";
    const legacyMatch = state.sources.find((source) => source.title === stored || source.name === stored);
    const preferred = keepCurrent && state.sourceId ? String(state.sourceId) : legacyMatch ? String(legacyMatch.sheetId) : stored;
    const chosen = state.sources.find((source) => String(source.sheetId) === preferred) || state.sources.find((source) => source.active && source.schemaStatus === "READY") || state.sources[0];
    if (stored === APPROVED_OPPORTUNITIES_SOURCE) await loadSource(APPROVED_OPPORTUNITIES_SOURCE);
    else if (chosen) await loadSource(String(chosen.sheetId));
    else { clearContentView("No supported content worksheets were discovered."); $("connection").lastElementChild.textContent = "No content worksheets"; }
  } catch (error) {
    $("connection").className = "connection offline";
    $("connection").lastElementChild.textContent = "Sheet discovery unavailable";
    toast(error.message, true);
  }
}

async function loadSource(sourceValue, targetContentId = '') {
  if(state.busy)return toast("Wait for the current build or export.",true);
  const sourceToken=++state.sourceLoadToken;
  state.contentLoadToken++;
  reportRejectedRecords([]);
  if (sourceValue === APPROVED_OPPORTUNITIES_SOURCE) {
    let approved; try { approved = JSON.parse(localStorage.getItem("content-ai-v4-2-approved") || "[]"); if(!Array.isArray(approved))throw Error("Invalid handoff list"); } catch(error) { clearContentView("Local handoff data is malformed.");return toast(error.message,true); }
    const rawRecords = approved.map((item) => item.production_draft).filter(Boolean);
    const normalized = normalizeContentRecordsSafely(rawRecords);
    state.records = normalized.records;
    state.workById={};
    state.writable = false;
    state.source = "approved-opportunities";
    state.sourceId = null;
    state.currentSheet = null;
    state.pageProfile = null; state.pageProfileComplete = false;
    state.sourceName = APPROVED_OPPORTUNITIES_SOURCE;
    localStorage.setItem("capc:selectedSource", state.sourceName);
    localStorage.setItem("capc:selectedSourceId", APPROVED_OPPORTUNITIES_SOURCE);
    renderSourceOptions();
    $("connection").className = "connection offline";
    $("connection").lastElementChild.textContent = `Development handoffs · ${state.records.length} · read-only`;
    $("writeHint").textContent = "Idea approved for development only. Complete the content specification and editorial review before generation; nothing is published automatically.";
    renderPageProfiles();
    if (!state.records.length) { clearContentView("No valid V4.2 handoffs have been approved for development yet."); reportRejectedRecords(normalized.rejected); return; }
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
    if(sourceToken!==state.sourceLoadToken)return;
    state.source=data.source || "sheet";
    state.currentSheet = { ...source, ...(data.sourceState || {}), setupStatus: data.setupStatus || source.setupStatus, setupReasons: data.setupReasons || source.setupReasons };
    state.profiles = data.profiles || state.profiles;
    state.pageProfile = data.pageProfile || state.profiles.find((item) => item.profileId === state.currentSheet.targetPageProfileId) || null;
    renderPageProfiles();
    const rawRecords = data.records || data.recipes || [];
    if (!Array.isArray(rawRecords)) throw new Error("Worksheet source did not return a records array.");
    const normalized = normalizeContentRecordsSafely(rawRecords);
    state.records = normalized.records;
    state.workById=data.editorialWork||{};
    source.rowCount = data.totalRows ?? rawRecords.length;
    source.source = data.source;
    source.writable = Boolean(data.writable && data.source === "sheet");
    renderSourceOptions();
    normalized.rejected.push(...(data.rejected || []));
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
    applyContent(state.records.find((item) => item.contentId === targetContentId) || state.records.find((item) => item.contentId === saved) || state.records[0]);
    reportRejectedRecords(normalized.rejected);
  } catch (error) {
    if(sourceToken!==state.sourceLoadToken)return;
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
    await refreshSheets(false, true);
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
  await loadEditorialQueue();
}

start();

async function downloadPackage() {
  renderQc();if(!state.gates?.exportReady || state.busy)return toast("Complete the export gates first.",true);
  state.busy=true;renderQc();
  try {
    const entries=exportEntries(state.content,state.plan,state.assets);
    const folder=safeFilename(`${state.content.contentId}_${state.content.title}`);
    const metadata={Content_ID:state.content.contentId,Title:state.content.title,source:{name:state.sourceName,sheetId:state.sourceId,kind:state.source},template:state.content.templateType,builtAt:new Date(Math.max(...Object.values(state.assets).map(a=>a.updatedAt))).toISOString(),exportedAt:new Date().toISOString(),qc:state.gates,heuristicContentScore:auditContent(state.content).score,editorialStatus:state.editorialReview.status,assetOrder:entries.map(({blob,...entry})=>entry)};
    const files=entries.map(e=>({name:`${folder}/${e.filename}`,blob:e.blob}));
    files.push({name:`${folder}/caption.txt`,blob:new Blob([state.content.caption],{type:"text/plain;charset=utf-8"})},{name:`${folder}/manifest.json`,blob:new Blob([JSON.stringify(metadata,null,2)],{type:"application/json"})});
    downloadBlob(await createZip(files),`${folder}.zip`);toast("One ordered production ZIP downloaded.");
  }catch(error){toast(error.message,true);}finally{state.busy=false;renderQc();}
}
