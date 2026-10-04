import {collectFinalImages,finalImageFiles,canShareFinalFiles,shareFinalFiles,saveFinalFilesToFolder} from '/final-export.mjs';
import {assessProduction,currentSession,sourceStamp,nextProductionAction,canImport,duplicateAssignments,changeToken,findNextProductionReadyContent,buildContentCompletionPrompt,deriveProductionProgress} from '/production-assistant.mjs';
import {
  buildAssetFilename,
  buildSlotPrompt,
  buildAssetSourceRevision,
  buildGenerationManifest,
  buildSessionPrompt,
  calculateAdaptivePanel,
  calculateMethodGrid,
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
import {applyEditorialWork,recordKey} from "/editorial-pipeline.mjs";
import {createProductionBatch,createProductionBatchFromSelection,eligibleForBatch,resolveProductionBatch,planBatchImports,batchImagePrompt,batchPostStamp,reconcileProductionBatch} from '/batch-production.mjs';

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
  visualQcConfirmedFor: "",
  currentSheet: null,
  contentLoadToken: 0,
  editingProfileId: "",
  editorialRows: [], editorialBatch: null, canonicalMap: null, workById: {}, originalContent: null, appliedWork: false, imageReviews: {},
  batchSelectedKeys: new Set(), batchSelectionSourceId: null
};
const APPROVED_OPPORTUNITIES_SOURCE = "V4.2 Approved Opportunities";
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
function reviewSignature() { return changeToken(sessionSignature(state.content, state.manifest, state.images, state.assets)); }
function slotReviewKey(slotId){return `capc:image-review:${keyFor('image-review',slotId)}`;}
function slotReviewPassed(entry){const image=state.images[entry.slotId],review=state.imageReviews[entry.slotId];return Boolean(image&&review?.status==='PASS'&&review.imageRevision===image.revision&&review.semanticKey===entry.semanticKey);}
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
    const generationBlocked = !state.assessment || !canImport(state.assessment);
    const node = document.createElement("article");
    const stale = Boolean(stored && stored.semanticKey !== entry.semanticKey);
    node.className = `slot${stored ? " ready" : ""}${stale ? " stale" : ""}`;
    node.dataset.slot = entry.slotId;
    node.innerHTML = `
      <div class="slot-preview">${stored ? `<img alt="${escapeHtml(entry.label)} imported image">` : `<div class="slot-empty"><b>${String(entry.sequence).padStart(2, "0")} · ${escapeHtml(entry.label)}</b><span>${escapeHtml(entry.assetType)} · Drop PNG, JPG or WebP</span></div>`}</div>
      <div class="slot-footer">
        <div><div class="slot-name">${String(entry.sequence).padStart(2, "0")} · ${escapeHtml(entry.label)}</div><div class="slot-state">${stale ? `REGEN REQUIRED · source definition changed` : stored ? "READY" : entry.required ? "Missing" : "Optional"}</div></div>
        <small class="image-facts">${escapeHtml(entry.expectedFilename)}${stored?.qc ? `<br>${stored.qc.width} × ${stored.qc.height} · ${stored.qc.orientation}${stored.qc.cropFraction > .03 ? " · Crop required" : ""}<br>${escapeHtml(stored.qc.warnings.join(" "))}` : ""}</small>
        <p class="slot-purpose">Purpose: ${escapeHtml(entry.imagePrompt.slice(0,130))}</p><div class="slot-actions"><button type="button" data-copy-slot ${!state.assessment?.ready ? "disabled" : ""}>Copy Prompt</button><button type="button" data-choose ${generationBlocked ? "disabled" : ""}>${stored ? "Replace" : "Upload"}</button>${stored ? `<button type="button" data-view>View</button><button type="button" data-remove ${generationBlocked ? "disabled" : ""}>Remove</button>` : ""}</div>
        ${stored?`<div class="slot-review"><span>${slotReviewPassed(entry)?'LOOKS GOOD':state.imageReviews[entry.slotId]?.status||'Inspect in Final preview'}</span><button type="button" data-image-good>Looks Good</button><button type="button" data-image-fix>Fix Image</button><button type="button" data-image-regen>Regenerate</button><button type="button" data-copy-repair>Copy FIX Prompt</button></div>`:''}
        <input type="file" accept="image/png,image/jpeg,image/webp" hidden>
      </div>`;
    if (stored) node.querySelector("img").src = previewUrl(stored.blob, "slots");
    node.querySelector("[data-copy-slot]").addEventListener("click", () => state.assessment?.ready && copyText(buildSlotPrompt(state.content, entry.slotId), "Slot prompt copied."));
    const input = node.querySelector("input[type=file]");
    node.querySelector("[data-choose]").addEventListener("click", () => input.click());
    input.addEventListener("change", () => input.files[0] && saveImage(entry.slotId, input.files[0]));
    node.querySelector("[data-view]")?.addEventListener("click",()=>{const dialog=document.createElement("dialog");dialog.className="image-dialog";const image=document.createElement("img");image.src=previewUrl(stored.blob,"slots");image.alt=entry.label;const close=document.createElement("button");close.textContent="Close";close.className="btn btn-neutral";close.onclick=()=>dialog.close();dialog.append(image,close);document.body.append(dialog);dialog.addEventListener("close",()=>dialog.remove());dialog.showModal();});
    node.querySelector("[data-remove]")?.addEventListener("click", () => removeImage(entry.slotId));
    if(stored){for(const [selector,status] of [['[data-image-good]','PASS'],['[data-image-fix]','FIX IMAGE'],['[data-image-regen]','REGENERATE']])node.querySelector(selector).addEventListener('click',()=>saveSimpleImageReview(entry.slotId,status));node.querySelector('[data-copy-repair]').addEventListener('click',()=>copyText(buildSlotPrompt(state.content,entry.slotId),'Image prompt copied.'));}
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
      node.innerHTML=`<div class="asset-preview">${page ? `<img alt="${escapeHtml(item.title)} page ${order}">` : "Not built"}</div><div class="asset-footer"><div><strong>${String(order).padStart(2,"0")} · ${escapeHtml(item.title)}</strong><small>${stored?.stale ? "STALE — REBUILD REQUIRED" : stored ? "CURRENT · 1440 × 1800" : "Build required"}</small></div><button type="button" ${stored && !stored.stale && state.gates?.exportReady ? "" : "disabled"}>Download</button></div>`;
      if(page)node.querySelector("img").src=previewUrl(page.blob,"assets");
      node.querySelector("button").addEventListener("click",()=>{refreshStale();downloadOneFinalImage(order);});node.querySelector(".asset-preview").addEventListener("click",()=>{state.previewIndex=order-1;renderFinalPreview();});container.appendChild(node);
    }
  }
  updateProgress();renderFinalPreview();
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
  if(state.busy||state.batchBusy) { toast("Wait for the current build or export to finish.",true); return false; }
  if (!state.assessment || !canImport(state.assessment)) { toast("Load a valid image specification before importing.",true); return false; }
  const token=state.contentLoadToken,entry=state.manifest.entries.find(item=>item.slotId===slotId),key=keyFor("image",slotId);
  if(!entry)return false;
  try {
    const value=await prepareStoredImage(file,entry,state.images);
    if(token!==state.contentLoadToken)return false;
    await putStored("images",key,value);
    if(token!==state.contentLoadToken)return false;
    state.images[slotId]=value;delete state.imageReviews[slotId];localStorage.removeItem(slotReviewKey(slotId));invalidateReview();refreshStale();renderSlots();renderAssets();renderQc();await refreshProductionBatch();return true;
  } catch(error){toast(`${file.name}: ${error.message}`,true);return false;}
}
async function prepareStoredImage(file,entry,existing={}){
 if(!/^image\/(png|jpeg|webp)$/.test(file.type)||file.size>35*1024*1024)throw Error('Use PNG, JPEG or WebP up to 35 MB.');
 if(!await verifyImageSignature(file))throw Error('File signature does not match its declared image type.');
 const decoded=await loadImage(file),qc=imageQc({type:file.type,size:file.size,width:decoded.naturalWidth,height:decoded.naturalHeight});if(qc.status==='FAIL')throw Error(qc.errors.join(' '));
 const hash=await hashBlob(file),duplicate=Object.entries(existing).find(([id,image])=>id!==entry.slotId&&image?.hash===hash);if(duplicate)qc.warnings.push(`Identical image also used in ${duplicate[0]}; inspect the assigned state.`);
 return {blob:file,name:file.name,type:file.type,semanticKey:entry.semanticKey,hash,revision:crypto.randomUUID(),qc,updatedAt:Date.now()};
}
async function removeImage(slotId) {
  if(state.busy||state.batchBusy)return;
  const token=state.contentLoadToken;
  await deleteStored("images",keyFor("image",slotId));
  if(token!==state.contentLoadToken)return;
  delete state.images[slotId];delete state.imageReviews[slotId];localStorage.removeItem(slotReviewKey(slotId));invalidateReview();refreshStale();renderSlots();renderAssets();renderQc();await refreshProductionBatch();
}
async function importMany(files) {
  if(state.busy||state.batchBusy || !state.assessment || !canImport(state.assessment))return toast("Load a valid image specification before importing.",true);
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
  const applied=applyEditorialWork(content,savedWork?.stale?null:savedWork,savedWork?.review?.sourceFingerprint);
  state.appliedWork=applied.content!==content&&!savedWork?.stale;
  state.originalContent={...applied.content,pageProfile:state.pageProfile||content.pageProfile||null};
  state.productionSession=readProductionSession(state.originalContent);
  $('optimiseState').textContent='AI REPAIRING…';
  state.assessment=assessSelected();
  state.content=state.assessment.content;
  state.previewIndex=0;
  state.images = {};
  state.imageReviews = {};
  state.assets = {};
  state.editorialReviewRecord = null;
  state.workflow = {stage:initialWorkflowStage(content),actor:'',note:'',updatedAt:null};
  state.visualQcConfirmedFor = "";
  state.plan = state.assessment.ready?state.content.resolvedAssetPlan:[];
  state.manifest = state.assessment.ready?state.assessment.manifest:{entries:[],expectedAssets:0};
  localStorage.setItem(`capc:selectedContent:${sourceKey()}`, state.content.contentId);
  $("sideRecipe").textContent = state.content.title;
  $("sideId").textContent = state.content.contentId;
  $("contentId").textContent = state.content.contentId;
  $("category").textContent = state.content.topic;
  const queueStatus=state.assessment.recommendation;
  $("status").textContent = queueStatus;
  $("status").classList.toggle("posted", state.content.lifecycleStatus === "PUBLISHED" || state.content.lifecycleStatus === "Posted");
  $("title").textContent = state.content.title;
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
  const productionOverrideKey=keyFor('production-override','version');
  $('productionProgress').setAttribute('aria-busy','true');renderProductionProgress();
  state.contentReady=Promise.all([putStored('assets',productionOverrideKey,state.assessment.productionOverride).catch(error=>toast(`Production override could not be persisted: ${error.message}`,true)),loadContentState(token).catch(error=>toast(error.message,true)),loadContentOperations(token).catch(error=>toast(`Saved production state could not be loaded: ${error.message}`,true))]).finally(()=>{if(token===state.contentLoadToken){$('productionProgress').setAttribute('aria-busy','false');renderProductionProgress();}});
}

function renderQc() {
  const qc = runContentQc(state.content);
  const editorial = runEditorialReview(state.content);
  state.assessment=assessSelected();
  const generation={status:state.assessment.ready?'GENERATION_READY':'GENERATION_BLOCKED',ready:state.assessment.ready,blockers:state.assessment.blockers};
  refreshStale();
  const stale = state.manifest.entries.filter((entry) => state.images[entry.slotId] && state.images[entry.slotId].semanticKey !== entry.semanticKey);
  const allFinalAssetsBuilt = state.plan.length > 0 && state.plan.every((item) => {
    const built = state.assets[item.asset_id];
    return built?.qc_status === "PASS" && !built.stale && built.sourceRevision === assetSourceRevision(item);
  });
  const requiredImagesPresent = state.manifest.entries.filter((entry) => entry.required).every((entry) => Boolean(state.images[entry.slotId]));
  const noImageRepairPending=!state.manifest.entries.some(entry=>['FIX IMAGE','REGENERATE'].includes(state.imageReviews[entry.slotId]?.status));
  const allSlotsReviewed=noImageRepairPending;
  const visualQcStatus = !allFinalAssetsBuilt ? "NOT RUN" : allSlotsReviewed&&state.visualQcConfirmedFor === reviewSignature() ? "PASS" : "REVIEW REQUIRED";
  const publishing = derivePublishingReadiness(state.content, {
    generationReadiness: generation,
    requiredImagesPresent,
    finalAssetsPresent: allFinalAssetsBuilt,
    visualQcStatus: visualQcStatus === "REVIEW REQUIRED" ? "NOT CONFIRMED" : visualQcStatus,
    pageProfileReady: state.pageProfileComplete
  });
  const quality = auditContent(state.content);
  const gates = productionGates({contract:qc,editorial,generation,manifest:state.manifest,images:state.images,plan:state.plan,assets:state.assets,visualReviewed:visualQcStatus === "PASS",monetization:quality,productionDecision:state.assessment});
  if(editorial.status!=='PASS'){publishing.ready=false;publishing.blockers.push('Historical publishing approval is not supplied by an AI check.');}
  if(!gates.technicalImageQc || stale.length) { publishing.ready=false; if(publishing.status!=="PUBLISHED")publishing.status="NOT_READY"; publishing.blockers.push("Technical image QC and current source definitions must pass."); }
  state.gates=gates;
  $("downloadAll").disabled=!gates.exportReady || state.busy;
  $("exportHint").textContent=gates.exportReady?"Share/save the ordered final PNGs, then copy the Facebook caption. ZIP remains available under More download options.":"Download needs current images, built final assets, automatic QC and Looks Good for this post.";
  $("copyPrompt").disabled = !generation.ready;
  $("importAll").disabled = !canImport(state.assessment);
  $("buildAssets").disabled = !generation.ready || !gates.technicalImageQc || stale.length > 0 || state.busy;
  $("copyCaption").disabled = !state.assessment.ready;
  state.editorialReview = editorial;
  state.generationReadiness = generation;
  state.publishingReadiness = publishing;
  renderProductionSummary();
}

function setFormValue(id, value) {
  const node = $(id);
  if (node) node.value = value ?? "";
}

function renderEditorialForm(review = {}) { $('reviewHistory').textContent=JSON.stringify(review,null,2); }

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
  renderQc();
  renderSlots();
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
  state.assessment=null;
  state.gates = null;
  state.generationReadiness = null;
  state.publishingReadiness = null;
  state.visualQcConfirmedFor = "";
  $("recipeSelect").innerHTML = "";
  $("title").textContent = message;
  $("contentId").textContent = "—";
  for (const id of ["contentType", "templateType", "visualProfile", "hookType", "hookText"]) $(id).textContent = "—";
  $("nextAction").textContent = message;
  $("exportHint").textContent = "Choose a valid content record before exporting.";
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

  renderEditorialForm({});
  renderProductionProgress();
}

function renderOptions(records) {
  state.filtered = records;
  const select = $("recipeSelect");
  select.innerHTML = records.map((content) => `<option value="${escapeHtml(content.contentId)}">${escapeHtml(content.contentId)} · ${escapeHtml(content.title)}</option>`).join("");
  if (state.content && records.some((content) => content.contentId === state.content.contentId)) select.value = state.content.contentId;
}

function queueKey(row) { return recordKey(row.sheetId, row.contentId); }
function currentQueueRow() { return state.editorialRows.find(row => Number(row.sheetId)===Number(state.sourceId) && row.contentId===state.content?.contentId); }
function batchItem(row) { const current=state.productionBatch?.number===1?state.productionBatch.posts:null;return (current||state.editorialBatch?.items||[]).find(item=>Number(item.sheetId)===Number(row.sheetId)&&item.contentId===row.contentId); }
function renderEditorialQueue(){
  const filter=$('queueFilter').value,search=$('queueSearch').value.trim().toLowerCase(),showDup=$('queueShowDuplicates').checked;
  for(const row of state.editorialRows){const a=assessProduction(row.content,{session:readProductionSession(row.content,row.sheetId),duplicateStatus:row.duplicateStatus});row.assessment=a;row.recommendation=a.recommendation;row.score=a.score;row.riskTier=a.risk.tier;}
  const selected=state.editorialRows.filter(row=>{if(!showDup&&row.duplicateStatus==='HOLD_DUPLICATE')return false;if(search&&![row.contentId,row.title,row.source,row.contentType].some(v=>String(v||'').toLowerCase().includes(search)))return false;if(filter==='ALL')return true;if(filter==='BATCH 01')return Boolean(batchItem(row));if(filter==='PUBLISHED')return ['PUBLISHED','Posted'].includes(row.lifecycleStatus);if(filter==='IN PROGRESS')return row.imageCount>0&&!row.downloaded;if(filter==='READY TO DOWNLOAD')return row.readyToDownload;return row.recommendation===filter;});
  $('queueSummary').textContent=`${selected.length} shown · ${state.editorialRows.length} source records · ${state.editorialRows.filter(r=>r.duplicateStatus==='HOLD_DUPLICATE').length} duplicates hidden by default`;
  const batch=state.editorialRows.filter(row=>batchItem(row));$('batchProgress').textContent=`Production Batch 01 · ${batch.length} prepared · ${batch.filter(r=>r.recommendation==='PRODUCE').length} PRODUCE · ${batch.filter(r=>r.recommendation==='IMPROVE').length} IMPROVE · ${batch.filter(r=>r.recommendation==='SKIP').length} SKIP`;
  $('queueRows').innerHTML=selected.map(row=>`<tr><td><button type="button" class="queue-open" data-queue-key="${escapeHtml(queueKey(row))}">${escapeHtml(row.title)}</button><br><small>${escapeHtml(row.contentId)}</small></td><td>${escapeHtml(row.contentType)}<br><small>${escapeHtml(row.source)}</small></td><td><strong>${row.score}</strong><br><span class="badge">${row.recommendation}</span></td><td>${row.riskTier}<br><small>${row.duplicateStatus==='HOLD_DUPLICATE'?'Duplicate':row.duplicateStatus==='REWORK'?'Possible duplicate':'No duplicate'}</small></td><td>${row.imageCount||0}/${row.imageTotal||0} images${row.readyToDownload?' · Ready to download':row.downloaded?' · Downloaded':''}</td><td><button type="button" data-queue-key="${escapeHtml(queueKey(row))}">${row.imageCount?'Continue →':row.recommendation==='PRODUCE'?'Start →':row.recommendation==='IMPROVE'?'Improve →':'View →'}</button></td></tr>`).join('')||'<tr><td colspan="6">No content matches.</td></tr>';
  $('queueRows').querySelectorAll('[data-queue-key]').forEach(button=>button.addEventListener('click',()=>openQueueItem(state.editorialRows.find(row=>queueKey(row)===button.dataset.queueKey))));
}
async function loadEditorialQueue(){
  $('productionProgress').dataset.queueReady='false';$('queueLoad').disabled=true;$('queueSummary').textContent='Loading production content…';
  try{
    const queueSources=state.sources.filter(s=>s.active&&s.schemaStatus==='READY'&&Number.isSafeInteger(Number(s.sheetId))&&Number(s.sheetId)>0);
    const [batchResult,mapResult,...sourceResults]=await Promise.all([apiJson('/api/editorial/batch'),apiJson('/api/editorial/canonical-map'),...queueSources.map(s=>apiJson(`/api/recipes?sheetId=${s.sheetId}`))]);
    state.editorialBatch=batchResult.batch;state.canonicalMap=mapResult.map;
    state.duplicateAssignments=duplicateAssignments(state.canonicalMap);
    const dup=state.duplicateAssignments,rework=new Set((state.canonicalMap.reviewPairs||[]).flatMap(p=>[p.left,p.right].map(i=>`${i.source}:${i.contentId}`))),rows=[];
    for(const data of sourceResults){const sheetId=Number(data.sheetId||data.sourceState?.sheetId),source=state.sources.find(s=>Number(s.sheetId)===sheetId);if(!sheetId)throw Error('Source identity missing.');
      for(const original of normalizeContentRecordsSafely(data.records||data.recipes||[]).records){const work=data.editorialWork?.[original.contentId],content={...applyEditorialWork(original,work?.stale?null:work,work?.review?.sourceFingerprint).content,pageProfile:data.pageProfile||original.pageProfile||null},key=recordKey(sheetId,content.contentId),assignment=dup[key];const row={sheetId,source:source?.title||source?.name,contentId:content.contentId,title:content.title,contentType:content.contentType,lifecycleStatus:content.lifecycleStatus,duplicateStatus:assignment?.status||(rework.has(`${source?.title||source?.name}:${content.contentId}`)?'REWORK':'UNIQUE'),canonicalKey:assignment?.canonicalKey,content,work};
        const a=assessProduction(content,{session:readProductionSession(content,sheetId),duplicateStatus:row.duplicateStatus});Object.assign(row,{assessment:a,recommendation:a.recommendation,score:a.score,riskTier:a.risk.tier});rows.push(row);
      }
    }
    const publicationResults=await Promise.all([...new Set(rows.map(row=>row.sheetId))].map(sheetId=>apiJson(`/api/production/results?sheetId=${sheetId}`)));
    const publishedKeys=new Set(publicationResults.flatMap(data=>(data.summary?.rows||[]).filter(p=>p.postUrl&&Number.isFinite(Date.parse(p.publishedAt))).map(p=>recordKey(p.sheetId,p.contentId))));
    for(const row of rows)row.publicationRecorded=publishedKeys.has(queueKey(row));
    // One cursor per store replaces hundreds of per-slot IndexedDB connections.
    const [imageKeys,assetKeys]=await Promise.all(['images','assets'].map(store=>idb(store,'readonly',objectStore=>objectStore.getAllKeys())));
    const imageRecords=await idb('images','readonly',o=>o.getAll()),assetRecords=await idb('assets','readonly',o=>o.getAll());
    const imagesByKey=new Map(imageKeys.map((key,i)=>[key,imageRecords[i]])),assetsByKey=new Map(assetKeys.map((key,i)=>[key,assetRecords[i]]));
    for(const row of rows){const a=row.assessment,manifest=a.manifest,images=Object.fromEntries(manifest.entries.map(e=>[e.slotId,imagesByKey.get(`${row.sheetId}:${row.contentId}:image:${e.slotId}`)])),plan=a.content.resolvedAssetPlan,assets=Object.fromEntries(plan.map(p=>[p.asset_id,assetsByKey.get(`${row.sheetId}:${row.contentId}:asset:${p.asset_id}`)]));
      row.imageTotal=manifest.entries.length;row.imageCount=manifest.entries.filter(e=>images[e.slotId]?.semanticKey===e.semanticKey&&images[e.slotId]?.qc?.status==='PASS').length;row.downloaded=!!readProductionSession(row.content,row.sheetId).downloadedAt;
      const currentAssets=plan.length&&plan.every(p=>assets[p.asset_id]?.qc_status==='PASS'&&assets[p.asset_id]?.semanticKey===assetSemanticKey(p)&&!isStoredAssetStale(p,assets[p.asset_id],images));
      const repairPending=manifest.entries.some(e=>{try{const r=JSON.parse(localStorage.getItem(`capc:image-review:${row.sheetId}:${row.contentId}:image-review:${e.slotId}`)||'null');return r&&r.imageRevision===images[e.slotId]?.revision&&['FIX IMAGE','REGENERATE'].includes(r.status);}catch{return false;}});
      const visual=localStorage.getItem(`capc:visual:${row.sheetId}:${row.contentId}:review:visual`);
      row.readyToDownload=a.ready&&!repairPending&&row.imageCount===row.imageTotal&&currentAssets&&visual===changeToken(sessionSignature(a.content,manifest,images,assets));
    }
    state.editorialRows=rows.sort((a,b)=>(b.recommendation==='PRODUCE')-(a.recommendation==='PRODUCE')||b.score-a.score||a.contentId.localeCompare(b.contentId));renderEditorialQueue();await refreshProductionBatch();
    if(state.originalContent){
      // Duplicate/source discovery can change the completed object after initial hydration.
      // Restore media against that object's slots, never leave the initial raw plan active.
      const selected=currentQueueRow()?.content||state.originalContent;
      const completed=assessProduction(selected,{session:readProductionSession(selected),duplicateStatus:currentQueueRow()?.duplicateStatus||'UNIQUE'});
      if(sourceStamp(state.content)!==sourceStamp(completed.content)||changeToken(JSON.stringify(state.originalContent.raw))!==changeToken(JSON.stringify(selected.raw))){applyContent(selected);await state.contentReady;}
      else{state.assessment=completed;renderQc();renderEditorialWorkspace();renderSlots();}
    }
    // Missing content stays selected until its production version is completed.
    $('productionProgress').dataset.queueReady='true';renderProductionProgress();
  }catch(error){$('productionProgress').dataset.queueReady='false';$('queueSummary').textContent=`Content loading failed: ${error.message}`;toast(error.message,true);}finally{$('queueLoad').disabled=false;}
}

async function openQueueItem(row) {
  state.deliberateContentSelection=true;
  if(!row||state.batchBusy&&!state.batchInternal)return;
  if(Number(state.sourceId)===Number(row.sheetId)&&state.records.some(item=>item.contentId===row.contentId))applyContent(row.content);
  else await loadSource(String(row.sheetId),row.contentId);
  $('recipe').scrollIntoView({behavior:'smooth',block:'start'});
}
function productionSessionKey(sheetId=state.sourceId,contentId=state.originalContent?.contentId){return `capc:production:${sheetId||state.sourceName}:${contentId}`;}
function readProductionSession(content,sheetId=state.sourceId){try{return currentSession(content,JSON.parse(localStorage.getItem(productionSessionKey(sheetId,content.contentId))||'{}'));}catch{return currentSession(content);}}
function saveProductionSession(patch){state.productionSession={...state.productionSession,...patch,sourceStamp:sourceStamp(state.originalContent),updatedAt:new Date().toISOString()};localStorage.setItem(productionSessionKey(),JSON.stringify(state.productionSession));}
function assessSelected(){const row=currentQueueRow();return assessProduction(state.originalContent,{session:state.productionSession,duplicateStatus:row?.duplicateStatus||state.duplicateAssignments?.[recordKey(state.sourceId,state.originalContent.contentId)]?.status||(state.canonicalMap?'UNIQUE':'UNASSESSED')});}
function renderEditorialWorkspace(){
  if(!state.originalContent)return;
  const a=state.assessment||assessSelected(),p=a.proposal,source=state.originalContent;
  $('originalTitle').textContent=source.title;$('originalBody').textContent=source.contentBody;$('originalCaption').textContent=source.caption;
  for(const [id,value] of Object.entries({optimisedTitle:p.title,optimisedHook:p.hook,optimisedCaption:p.caption,optimisedWhat:p.what,optimisedWhy:p.why||'来源没有说明原因；保留现有做法，不补写推测。',optimisedAction:p.action,optimisedValue:p.readerValue,optimisedSave:p.saveValue,optimisedCta:p.cta,optimiseChanges:p.changes.join('\n'),reviewHistory:JSON.stringify({sheet:source.editorialReview,stored:state.workById[source.contentId]||null},null,2)}))$(id).textContent=value;
  $('optimiseEngine').textContent=`Content Completion Engine · ${p.structure}. A production version prepared from your source material.`;
  $('workspaceAssetPlan').innerHTML=state.plan.map(asset=>`<p><strong>${asset.sequence} · ${escapeHtml(asset.title)}</strong><br><small>${escapeHtml(asset.overlay_text)}</small></p>`).join('');
  $('optimiseState').textContent=`AI OPTIMISED · ${a.recommendation}`;
  const repair=a.repair,details=[...repair.autoFixed,...repair.warnings,...repair.critical];
  $('factQuestions').hidden=false;$('factQuestions').classList.toggle('repair-ready',a.ready);$('factQuestions').innerHTML=`<p class="eyebrow">AI CONTENT PREPARATION</p><strong>${a.gaps.length?'COMPLETE THIS CONTENT · YOUR RECORD IS KEPT':a.ready?'✓ AI FIXED · READY TO PRODUCE':a.recommendation==='IMPROVE'?'AI PREPARED · IMPROVE':'SKIP · source support or quality insufficient'}</strong><p>${a.preparation.stages.map(s=>`✓ ${escapeHtml(s)}`).join(' · ')}</p><p>Quality ${a.score} / 100 · ${a.ready?`${a.manifest.entries.length} images`:`${repair.critical.length} unresolved source gaps`} · AI repaired ${repair.autoFixed.length} content issues${repair.warnings.length?` · ${repair.warnings.length} warnings`:""}</p>${a.gaps.length?`<p>${escapeHtml(a.gaps[0])}</p>`:''}${a.recommendation==='IMPROVE'||a.gaps.length?'<button id="repairComplete" class="btn btn-primary" type="button">Fix This Content &amp; Continue →</button>':''}<details id="repairDetails"><summary>View AI Changes</summary>${details.map(i=>`<p>${escapeHtml(i.detail)}</p>`).join('')}${a.verified?'':`<p>${escapeHtml(a.risk.reasons.join(' · '))}</p>`}</details>`;
  if($('repairComplete'))$('repairComplete').onclick=openContentCompletion;
  $('contentCompletion').hidden=a.ready;
  $('completionNeeded').textContent=a.gaps.join('\n')||'Add concrete practical instructions or decision points. The compiler handles the hook, caption and CTA.';
  if(document.activeElement!==$('completionText'))$('completionText').value=state.productionSession.completionDraft??state.productionSession.completion?.text??'';
  $('claimVerification').hidden=a.verified;$('claimReason').textContent=a.risk.reasons.join(' · ');$('claimList').innerHTML=a.claims.map(c=>`<li>${escapeHtml(c)}</li>`).join('');
}
function renderProductionSummary(){
  if(!state.assessment)return;
  const a=state.assessment,action=nextProductionAction(a,{manifest:state.manifest,images:state.images,assets:state.assets,plan:state.plan,visualReviewed:state.visualQcConfirmedFor===reviewSignature()});
  state.nextBestAction=action;$('potentialScore').textContent=`${a.score} / 100`;$('recommendation').textContent=a.recommendation;$('riskLevel').textContent=a.risk.tier;$('duplicateLabel').textContent=a.duplicateStatus==='HOLD_DUPLICATE'?'YES':a.duplicateStatus==='REWORK'?'POSSIBLE':'NO';
  $('decisionHint').textContent=action.detail;$('primaryAction').textContent=action.label;$('primaryAction').disabled=state.busy||state.batchBusy;$('nextAction').textContent=action.detail;
  $('potentialDimensions').innerHTML=Object.entries(a.dimensions).map(([name,value])=>`<div><dt>${escapeHtml(name)}</dt><dd>${value}/10</dd></div>`).join('');
  $('qualityFindings').innerHTML=a.findings.slice(0,5).map(f=>`<li>${escapeHtml(f)}</li>`).join('');
  $('autoImprove').textContent=!a.ready?'Fix This Content':'Improve Again';
  $('primaryAction').className='btn btn-primary';$('autoImprove').className='btn btn-info';$('workNext').className='btn btn-neutral';
  renderVisualPlan();
  $('imageQueueProgress').textContent=`${state.manifest.entries.filter(e=>state.images[e.slotId]?.semanticKey===e.semanticKey&&state.images[e.slotId]?.qc?.status==='PASS').length} / ${state.manifest.entries.length} READY`;
  const next=state.manifest.entries.find(e=>!state.images[e.slotId]||state.images[e.slotId].semanticKey!==e.semanticKey||state.images[e.slotId].qc?.status!=='PASS');
  $('imageQueueNext').textContent=next?`NEXT IMAGE · ${String(next.sequence).padStart(2,'0')} — ${next.label}`:'Images complete · Build Final Assets';
  $('copyNextPrompt').disabled=!a.ready||!next;$('copyMaster').disabled=!a.ready;$('imageImport').disabled=!canImport(a);$('imageBuild').disabled=$('buildAssets').disabled;
  for(const id of ['downloadPost','previewDownload'])$(id).disabled=!state.gates?.exportReady||state.busy;
  renderExportCard();
  const row=currentQueueRow();if(row){row.assessment=a;row.recommendation=a.recommendation;row.score=a.score;row.progress=action.detail;row.nextAction=action.label;row.imageTotal=state.manifest.entries.length;row.imageCount=state.manifest.entries.filter(e=>state.images[e.slotId]?.semanticKey===e.semanticKey&&state.images[e.slotId]?.qc?.status==='PASS').length;row.readyToDownload=Boolean(state.gates?.exportReady);row.downloaded=Boolean(state.productionSession.downloadedAt);}
  const imageCount=state.manifest.entries.filter(e=>state.images[e.slotId]?.semanticKey===e.semanticKey&&state.images[e.slotId]?.qc?.status==='PASS').length;
  const suggested=findNextProductionReadyContent(state.editorialRows);
  state.quickRow=imageCount||!a.ready?null:suggested;
  $('resumeHint').textContent=!a.ready?`CONTINUE THIS CONTENT · ${state.content.contentId} · ${action.detail}`:imageCount?`CONTINUE PRODUCTION · ${state.content.contentId} · Images ${imageCount}/${state.manifest.entries.length} · ${action.detail}`:suggested?`NEXT BEST CONTENT · ${suggested.score} · PRODUCE`:`CONTINUE PRODUCTION · ${state.content.contentId} · ${action.detail}`;
  renderProductionProgress();
  localStorage.setItem('capc:lastProduction',JSON.stringify({sheetId:state.sourceId,contentId:state.content.contentId}));
  renderFinalPreview();
}
function renderProductionProgress(){
  const progress=deriveProductionProgress(state.editorialRows),next=nextSuggested();
  $('productionMetrics').innerHTML=[['In progress',progress.inProgress],['Ready for images',progress.readyForImages],['Images ready',progress.imagesReady],['Ready to post',progress.readyToPost]].map(([label,count])=>`<div class="numbers"><span class="card-category">${label}</span><strong class="card-title">${count}</strong></div>`).join('');
  $('quickTitle').textContent=state.content?.title||'Choose content to begin';
  $('productionNextTitle').textContent=next?`${next.title} · ${next.assessment.score} · PRODUCE`:'No further produce-ready content in this queue.';
  const loading=$('productionProgress').getAttribute('aria-busy')==='true';
  $('progressNext').disabled=!next||loading||state.busy||state.batchBusy;
  $('quickStart').disabled=loading||state.busy||state.batchBusy;
  $('productionProgressScope').textContent='Saved on this browser · ready to post counts reviewed final assets.';
}
function goStage(id){location.hash=id;$(id)?.scrollIntoView({behavior:'smooth',block:'start'});document.querySelectorAll('.workflow-nav a').forEach(a=>a.classList.toggle('active',a.hash===`#${id}`));}
async function primaryProductionAction(){
  if(state.busy||state.batchBusy||!state.nextBestAction)return;
  const {kind}=state.nextBestAction;
  if(kind==='CANONICAL'){const row=currentQueueRow(),better=state.editorialRows.find(r=>queueKey(r)===row?.canonicalKey);return openQueueItem(better);}
  if(kind==='NEXT')return continueWithGoodContent();
  if(kind==='COMPLETE'||kind==='FACT'||kind==='CLAIM')return openContentCompletion();
  if(kind==='IMPROVE')return autoImprove();
  if(kind==='IMAGES'){renderVisualPlan();return goStage('images');}
  if(kind==='BUILD'){await buildAssets();return goStage('assets');}
  if(kind==='FINAL')return goStage('assets');
  if(kind==='DOWNLOAD'){goStage('download');return exportFinalImages();}
}
function autoImprove(){
  if(state.busy||state.batchBusy||!state.originalContent)return;
  if(!state.assessment.ready)return openContentCompletion();
  const before=state.assessment.score;
  saveProductionSession({iteration:(state.productionSession.iteration||0)+1,override:undefined});
  const selected=state.originalContent;applyContent(selected);renderEditorialQueue();goStage('optimise');
  toast(`Auto Improve complete · ${before} → ${state.assessment.score} · ${state.assessment.recommendation}. Facts preserved.`);
}

function openContentCompletion(){
 if(!state.originalContent||state.busy||state.batchBusy)return;
 goStage('optimise');$('contentCompletion').hidden=false;$('contentCompletion').open=true;$('completionText').focus();
}
async function applyContentCompletion(){
 if(!state.originalContent||state.busy||state.batchBusy)return;
 const draft=$('completionText').value.trim();if(!draft)return toast('Add the missing facts or paste the completed body here. Your content stays selected.',true);
 if(draft.length>24000)return toast('Use a production draft of at most 24,000 characters.',true);
 try{saveProductionSession({completion:{text:draft,sourceStamp:sourceStamp(state.originalContent),inputStamp:changeToken(JSON.stringify(state.originalContent.raw||{})),provenance:'USER_PROVIDED_PRODUCTION_ADDITIONS'},completionDraft:draft,override:undefined});
 const selected=state.originalContent;applyContent(selected);await state.contentReady;renderEditorialQueue();await refreshProductionBatch();
 if(state.assessment.ready){goStage('images');toast('Content completed. Continue generating images for '+selected.contentId+'. Original Sheet preserved.');}
 else{openContentCompletion();toast('Production draft saved. '+(state.assessment.gaps[0]||state.assessment.quality.weaknesses[0]||'More supported detail is needed.')+' The same content is kept.',true);}
 }catch(error){toast('Completion could not be saved: '+error.message,true);}
}

function overrideDecision(decision){
  if(state.busy||state.batchBusy||!state.originalContent)return;
  if(decision==='PRODUCE'&&(state.assessment.gaps.length||!state.assessment.verified||state.assessment.duplicateStatus==='HOLD_DUPLICATE'))return toast('Resolve the specific fact, claim or duplicate first.',true);
  saveProductionSession({override:decision});state.assessment=assessSelected();renderQc();renderEditorialWorkspace();renderEditorialQueue();
}
function nextSuggested(){return findNextProductionReadyContent(state.editorialRows,{excludeKeys:[recordKey(state.sourceId,state.content?.contentId)]});}
function nextEditorialReview(){return continueWithGoodContent();}
async function continueWithGoodContent({quick=false}={}){
 if(state.busy||state.batchBusy||state.screeningProduction)return;state.screeningProduction=true;const previous=state.content?.contentId,reason=state.assessment?.skipReason,excluded=quick?[]:[recordKey(state.sourceId,previous)];
 try{if(!state.editorialRows.length)await loadEditorialQueue();for(let attempt=0;attempt<state.editorialRows.length;attempt++){const candidate=findNextProductionReadyContent(state.editorialRows,{excludeKeys:excluded});if(!candidate)break;excluded.push(recordKey(candidate.sheetId,candidate.contentId));await loadSource(String(candidate.sheetId),candidate.contentId);await state.contentReady;candidate.lifecycleStatus=state.originalContent?.lifecycleStatus;candidate.publicationRecorded=(state.resultsSummary?.rows||[]).some(r=>r.contentId===candidate.contentId&&r.postUrl&&Number.isFinite(Date.parse(r.publishedAt)));candidate.downloaded=!!readProductionSession(state.originalContent,candidate.sheetId).downloadedAt;if(state.assessment?.ready&&!candidate.publicationRecorded&&!candidate.downloaded&&!/^(?:posted|published|scheduled_published|results_recorded)$/i.test(candidate.lifecycleStatus||'')){state.deliberateContentSelection=false;goStage('images');if(reason)toast(`Opened next production-ready content after ${previous}. Your previous work is preserved.`);return;}candidate.assessment=state.assessment;candidate.recommendation=state.assessment.recommendation;}
 toast('No complete, low-risk content remains. Current work is preserved; choose another source record to inspect.',true);
 }catch(error){toast(error.message,true);}finally{state.screeningProduction=false;}
}
function finalPages(){return state.plan.flatMap(item=>{const asset=state.assets[item.asset_id];return asset?(asset.pages?.length?asset.pages:[asset]).map(page=>({page,item,asset})):[];});}
function renderFinalPreview(){
  clearPreviewUrls('final');const pages=finalPages();state.previewIndex=Math.max(0,Math.min(state.previewIndex||0,pages.length-1));const current=pages[state.previewIndex];
  $('finalImage').hidden=!current;$('finalEmpty').hidden=!!current;$('previewPosition').textContent=`${current?state.previewIndex+1:0} / ${pages.length}`;
  if(current)$('finalImage').src=previewUrl(current.page.blob,'final');else $('finalImage').removeAttribute('src');
  $('finalCaption').textContent=state.content?.caption||'';
  $('looksGood').disabled=!state.gates?.finalAssetsBuilt||!state.gates?.technicalImageQc||!state.assessment?.ready;
  for(const id of ['fixFinal','regenerateFinal'])$(id).disabled=!current;
  $('previewReviewHint').textContent=current?.asset.stale?'This preview is stale. Rebuild before download.':state.visualQcConfirmedFor===reviewSignature()?'LOOKS GOOD · current post reviewed':'Inspect the image sequence and caption. Looks Good confirms the current complete post.';
  $('previewPrev').disabled=!pages.length;$('previewNext').disabled=!pages.length;
}
function confirmLooksGood(){
  if(state.batchBusy||state.busy)return;
  renderQc();if(!state.gates?.finalAssetsBuilt||!state.gates?.technicalImageQc||!state.assessment.ready)return toast('Build all current final assets before Looks Good.',true);
  if(state.manifest.entries.some(e=>['FIX IMAGE','REGENERATE'].includes(state.imageReviews[e.slotId]?.status)))return toast('Replace the images marked Fix or Regenerate first.',true);
  for(const entry of state.manifest.entries){const image=state.images[entry.slotId];if(!image)continue;const review={status:'PASS',method:'SIMPLE_FINAL_POST_REVIEW',imageRevision:image.revision,semanticKey:entry.semanticKey,reviewedAt:new Date().toISOString()};state.imageReviews[entry.slotId]=review;localStorage.setItem(slotReviewKey(entry.slotId),JSON.stringify(review));}
  state.visualQcConfirmedFor=reviewSignature();localStorage.setItem(`capc:visual:${keyFor('review','visual')}`,state.visualQcConfirmedFor);renderQc();renderSlots();refreshProductionBatch().catch(e=>toast(e.message,true));goStage('download');toast('Looks Good saved for this current post.');
}
function repairFinal(status){if(state.busy||state.batchBusy)return;const current=finalPages()[state.previewIndex||0];if(!current)return;const ids=[...(current.item.generation_inputs||[]).map(i=>i.slot_id),...(current.item.source_input_ids||[])];state.repairSlotIds=ids;goStage('images');$('imageQueueNext').textContent=`Choose the affected image below · ${ids.join(', ')}`;if(ids.length===1)saveSimpleImageReview(ids[0],status);else{for(const id of ids)document.querySelector(`[data-slot="${CSS.escape(id)}"]`)?.classList.add('repair-target');toast('Choose Fix Image or Regenerate on the affected slot. Unaffected images remain.');}}
function saveSimpleImageReview(slotId,status){if(state.busy||state.batchBusy)return;const image=state.images[slotId],entry=state.manifest.entries.find(e=>e.slotId===slotId);if(!image||!entry)return;const review={status,method:'SIMPLE_IMAGE_REVIEW',imageRevision:image.revision,semanticKey:entry.semanticKey,reviewedAt:new Date().toISOString()};state.imageReviews[slotId]=review;localStorage.setItem(slotReviewKey(slotId),JSON.stringify(review));invalidateReview();renderSlots();renderQc();if(status!=='PASS')copyText(`FIX / REGENERATE THIS IMAGE ONLY. Preserve other images.\n\n${buildSlotPrompt(state.content,slotId)}`,'Affected image prompt copied.');}

function moveContent(direction) {
  state.deliberateContentSelection=true;
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
  if(assetItem.method_steps){
    for(const input of assetItem.generation_inputs){
      const steps=assetItem.method_steps.filter(s=>s.image_slot_id===input.slot_id);if(!steps.length)continue;
      const {canvas,context}=canvas2d();context.fillStyle='#f4f3ef';context.fillRect(0,0,1440,1800);
      coverDraw(context,await loadImage(state.images[input.slot_id].blob),0,0,1440,710);
      context.fillStyle='#fff';context.fillRect(70,660,1300,1070);context.fillStyle='#f96332';context.textBaseline='top';context.font='700 42px "PingFang SC",sans-serif';
      context.fillText(`做法 · 步骤 ${assetItem.method_steps.indexOf(steps[0])+1}–${assetItem.method_steps.indexOf(steps.at(-1))+1}`,120,725);
      context.fillStyle='#66615b';context.font='500 32px "PingFang SC",sans-serif';context.fillText('照片展示其中一个关键状态；完整做法如下',120,790);
      const copy=steps.map(step=>`${assetItem.method_steps.indexOf(step)+1}. ${step.overlay_text||[step.step_heading,step.step_supporting_text].join('\n')}`).join('\n\n');
      context.fillStyle='#252422';context.font='500 45px "PingFang SC",sans-serif';drawLines(context,copy,120,858,1200,62,13);outputs.push(canvas);
    }
    return outputs;
  }
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
  if (["method_grid_2x3", "method_grid_adaptive"].includes(assetItem.layout_type) && (assetItem.method_steps || assetItem.generation_inputs).length > 1) return buildMethodGrid(assetItem);
  if (assetItem.layout_type === "cover_overlay") return [await buildCoverAsset(assetItem)];
  if (assetItem.layout_type === "detail_overlay") return [await buildDetailAsset(assetItem)];
  return [await buildInformationAsset(assetItem)];
}

function canvasBlob(canvas) {
  return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Canvas export failed.")), "image/png", 1));
}

async function buildAssets(batchOperation=false) {
  if (!state.generationReadiness?.ready) return toast("Build is blocked until the content is ready to produce.", true);
  const missing = state.manifest.entries.filter((entry) => entry.required && !state.images[entry.slotId]).map((entry) => entry.label);
  if (missing.length) return toast(`Missing required images: ${missing.join(", ")}.`, true);
  if(state.busy||(state.batchBusy&&batchOperation!==true))return;
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

function renderVisualPlan(){
 if(!state.content||!$('visualPlanCount'))return;
 const plan=state.content.fastVisualPlan,entries=state.manifest.entries;
 $('visualPlanCount').textContent=`${entries.length} images required · estimated generations: ${entries.length}`;
 $('visualPlanJobs').innerHTML=entries.map(e=>`<li><b>${String(e.sequence).padStart(2,'0')} ${escapeHtml(e.label)}</b> <small>${escapeHtml(e.expectedFilename)}</small></li>`).join('');
 $('visualPlanHint').textContent=plan?`${plan.previousImageCount} → ${plan.imageCount} source images · all source instructions retained.${plan.aboveTargetReason?' '+plan.aboveTargetReason:''}`:'Every image has a distinct source-defined job.';
 $('startImageProduction').disabled=state.busy||state.batchBusy||!state.assessment;$('startImageProduction').textContent=state.assessment?.ready?'Start Image Production →':'Fix This Content & Continue →';
 if(state.assessment&&!state.assessment.ready)$('slotHelper').textContent=`${state.assessment.gaps.length?'Source incomplete': 'Source support or quality insufficient'} · ${state.assessment.gaps[0]||state.assessment.risk.reasons.join(' · ')} Use Fix This Content & Continue; this record is kept.`;
 $('regenerateVisualPlan').disabled=state.busy||state.batchBusy;
}
function activeProductionBatch(){try{const value=JSON.parse(localStorage.getItem('capc:activeImageBatch')||'null');return value&&Array.isArray(value.posts)?value:null;}catch{return null;}}
function persistProductionBatch(batch){localStorage.setItem('capc:activeImageBatch',JSON.stringify(batch));state.productionBatch=batch;}
async function storedMap(store){const db=await openDb();return new Promise((resolve,reject)=>{const tx=db.transaction(store,'readonly'),s=tx.objectStore(store),keys=s.getAllKeys(),values=s.getAll();tx.oncomplete=()=>resolve(new Map(keys.result.map((key,i)=>[key,values.result[i]])));tx.onerror=()=>reject(tx.error);}).finally(()=>db.close());}
async function refreshProductionBatch(){
 const token=state.batchProgressToken=(state.batchProgressToken||0)+1;state.productionBatch=activeProductionBatch();
 for(const row of state.editorialRows||[]){row.assessment=assessProduction(row.content,{session:readProductionSession(row.content,row.sheetId),duplicateStatus:row.duplicateStatus});row.downloaded=!!readProductionSession(row.content,row.sheetId).downloadedAt;}
 const [imagesByKey,assetsByKey]=state.productionBatch?await Promise.all([storedMap('images'),storedMap('assets')]):[new Map(),new Map()];if(token!==state.batchProgressToken)return;
 const visualByKey=new Map(),reviewsByKey=new Map();for(const post of state.productionBatch?.posts||[]){const key=`${post.sheetId}:${post.contentId}`;visualByKey.set(key,localStorage.getItem(`capc:visual:${key}:review:visual`));for(const storageKey of imagesByKey.keys())if(storageKey.startsWith(`${key}:image:`)){const slot=storageKey.slice(`${key}:image:`.length);try{reviewsByKey.set(`${key}:image-review:${slot}`,JSON.parse(localStorage.getItem(`capc:image-review:${key}:image-review:${slot}`)||'null'));}catch{}}}
 const cleanup=reconcileProductionBatch(state.productionBatch,state.editorialRows||[],{imagesByKey,assetsByKey});if(cleanup.changed){persistProductionBatch(cleanup.batch);renderEditorialQueue();}if(cleanup.replacements.length)toast(`${cleanup.replacements.length} ineligible batch posts replaced with screened reserve content.`);
 state.productionBatchResolved=resolveProductionBatch(state.productionBatch,state.editorialRows||[],{imagesByKey,assetsByKey,visualByKey,reviewsByKey});
 for(const post of state.productionBatchResolved.posts){const row=state.editorialRows.find(r=>queueKey(r)===`${post.sheetId}:${post.contentId}`);if(row){row.imageCount=post.imageCount;row.imageTotal=post.entries.length;row.readyToDownload=post.valid&&post.reviewed;}}
 renderProductionProgress();renderProductionBatch();
}
function batchPickerRows(){
 const sourceId=Number(state.sourceId),query=String($('batchTitleSearch')?.value||'').trim().toLowerCase();
 if(state.batchSelectionSourceId!==sourceId){state.batchSelectionSourceId=sourceId;state.batchSelectedKeys=new Set();}
 const rows=(state.editorialRows||[]).filter(row=>!sourceId||Number(row.sheetId)===sourceId);
 return rows.filter(row=>!query||[row.title,row.contentId,row.contentType,row.source].some(value=>String(value||'').toLowerCase().includes(query)));
}
function renderBatchTitlePicker(){
 const list=$('batchTitleList');if(!list)return;
 const rows=batchPickerRows(),eligible=rows.filter(eligibleForBatch),allKeys=new Set((state.editorialRows||[]).map(queueKey));
 for(const key of [...state.batchSelectedKeys])if(!allKeys.has(key))state.batchSelectedKeys.delete(key);
 const source=state.sources.find(item=>Number(item.sheetId)===Number(state.sourceId));
 $('batchPickerSource').textContent=source?`Current source: ${source.title||source.name}`:'Current source: all production sources';
 const selected=[...state.batchSelectedKeys].filter(key=>allKeys.has(key));
 $('batchSelectedCount').textContent=`${selected.length} selected · ${eligible.length}/${rows.length} shown are production-ready`;
 $('batchCreateSelected').textContent=`Create Selected Batch (${selected.length})`;
 $('batchCreateSelected').disabled=state.batchBusy||state.busy||!selected.length;
 $('batchSelectVisible').disabled=state.batchBusy||state.busy||!eligible.length;
 $('batchClearSelection').disabled=state.batchBusy||state.busy||!selected.length;
 list.innerHTML=rows.map(row=>{const ready=eligibleForBatch(row),key=queueKey(row),checked=state.batchSelectedKeys.has(key);const reason=ready?'PRODUCE':row.assessment?.gaps?.length?'NEEDS COMPLETION':row.assessment?.risk?.tier&&row.assessment.risk.tier!=='LOW'?`${row.assessment.risk.tier} RISK`:row.duplicateStatus==='HOLD_DUPLICATE'||row.duplicateStatus==='REWORK'?'DUPLICATE':row.recommendation||'NOT READY';return `<label class="batch-title-row${ready?'':' batch-title-disabled'}"><input type="checkbox" data-batch-title-key="${escapeHtml(key)}" ${checked?'checked':''} ${ready?'':'disabled'}><span><strong>${escapeHtml(row.title)}</strong><small>${escapeHtml(row.contentId)} · ${escapeHtml(row.contentType)} · score ${escapeHtml(row.score)} · ${escapeHtml(reason)}</small></span></label>`;}).join('')||'<p class="helper">No content matches this source/search.</p>';
 list.querySelectorAll('[data-batch-title-key]').forEach(input=>input.onchange=()=>{const key=input.dataset.batchTitleKey;if(input.checked){if(state.batchSelectedKeys.size>=20){input.checked=false;return toast('Select at most 20 titles per batch.',true);}state.batchSelectedKeys.add(key);}else state.batchSelectedKeys.delete(key);renderBatchTitlePicker();});
}
function selectVisibleBatchTitles(){
 const rows=batchPickerRows().filter(eligibleForBatch);let added=0;for(const row of rows){const key=queueKey(row);if(state.batchSelectedKeys.has(key))continue;if(state.batchSelectedKeys.size>=20)break;state.batchSelectedKeys.add(key);added+=1;}renderBatchTitlePicker();if(rows.length>added&&state.batchSelectedKeys.size>=20)toast('Selected the first 20 production-ready titles.');
}
async function createSelectedProductionBatch(){
 if(state.batchBusy||state.busy)return;
 try{await refreshProductionBatch();const keys=[...state.batchSelectedKeys],number=Number(localStorage.getItem('capc:imageBatchCounter')||0)+1,batch=createProductionBatchFromSelection(state.editorialRows,keys,number);persistProductionBatch(batch);localStorage.setItem('capc:imageBatchCounter',String(number));state.batchUnmatched=[];renderBatchExceptions();await refreshProductionBatch();goStage('batchProduction');}catch(error){toast(error.message,true);}
}
function renderProductionBatch(){
 const batch=state.productionBatch,r=state.productionBatchResolved||{posts:[],entries:[]},busy=state.batchBusy||state.busy;
 $('productionBatchTitle').textContent=batch?`BATCH ${String(batch.number).padStart(2,'0')} · ${r.posts.length} posts`:'Batch image production';
 $('productionBatchHint').textContent=batch?`${r.posts.length} selected / ${batch.requestedCount} requested · ${r.totalImages} images required · ${r.posts.length?(r.totalImages/r.posts.length).toFixed(1):0} per post${r.posts.length<batch.requestedCount?' · Only strong eligible content selected.':''}`:'Strong complete low-risk posts, with variety and duplicates excluded.';
 $('productionBatchStats').innerHTML=batch?[['Posts Ready',r.posts.filter(p=>p.valid).length],['Images Ready',`${r.imagesReady} / ${r.totalImages}`],['Posts Built',`${r.builtCount} / ${r.posts.length}`],['Ready to Download',r.downloadReady]].map(([name,value])=>`<div class="card card-stats"><span>${name}</span><strong>${value}</strong></div>`).join(''):'';
 $('batchScreeningSummary').textContent=batch?.summary?`Requested ${batch.requestedCount} · Evaluated ${batch.summary.evaluated} · Selected ${batch.summary.selected} · Auto repaired ${batch.summary.autoRepaired} · Need completion ${batch.summary.skippedIncomplete} · Duplicate ${batch.summary.skippedDuplicate} · Low quality ${batch.summary.skippedLowQuality} · Reserve ${batch.summary.reserve} · Replaced ${batch.summary.replaced}`:'';
 renderBatchTitlePicker();
 const next=r.next,needsCompletion=r.posts.filter(p=>p.assessment?.recommendation==='IMPROVE'||p.assessment?.gaps?.length);$('batchNextImage').textContent=next?`NEXT IMAGE · P${String(next.postNumber).padStart(2,'0')} · ${String(next.sequence).padStart(2,'0')} ${next.label}`:needsCompletion.length?`${needsCompletion.length} posts need completion · kept in this batch. Use Fix This Content.`:batch?'Images complete · build and inspect ready posts.':'Select a batch to begin.';
 $('batchContinue').hidden=!batch;$('batchResumeLabel').textContent=batch?`CONTINUE BATCH ${String(batch.number).padStart(2,'0')} · ${r.imagesReady}/${r.totalImages} images ready`:'';
 for(const id of ['batchCopyNext','batchCopyPost'])$(id).disabled=busy||!next;
 $('batchCopyAll').disabled=busy||!next||!r.posts.length;$('batchImport').disabled=busy||!r.entries.some(e=>e.valid);$('batchBuildReady').disabled=busy||!r.readyToBuild;$('batchBuildReady').textContent=`Build ${r.readyToBuild||0} Ready Posts`;
 $('batchDownloadReady').disabled=busy||!r.downloadReady;$('batchDownloadReady').textContent=`Download ${r.downloadReady||0} Ready Posts`;
 document.querySelectorAll('[data-batch-size]').forEach(b=>b.disabled=busy||!state.editorialRows?.length);
 $('productionBatchRows').innerHTML=r.posts.map(p=>`<tr data-batch-post="${p.postNumber}"><td><b>P${String(p.postNumber).padStart(2,'0')} · ${escapeHtml(p.title)}</b><br><small>${escapeHtml(p.contentId)} · ${escapeHtml(p.content?.contentType||'Source unavailable')}</small></td><td>${p.imageCount}/${p.entries.length}</td><td>${escapeHtml(p.status)}</td><td><button type="button" class="btn btn-neutral" data-batch-open="${p.postNumber}" ${busy?'disabled':''}>${p.assessment?.recommendation==='IMPROVE'||p.assessment?.gaps?.length?'Fix This Content →':p.built?'Preview Final →':'Open Post →'}</button>${p.reviewed?`<button type="button" class="btn btn-info" data-batch-share="${p.postNumber}" ${busy||state.exportBusy?'disabled':''}>Share This Post</button><button type="button" class="btn btn-neutral" data-batch-caption="${p.postNumber}" ${busy?'disabled':''}>Copy Caption</button>`:''}${!p.valid&&p.assessment?.ready?`<button class="btn btn-neutral" data-batch-refresh="${p.postNumber}" ${busy?'disabled':''}>Refresh This Plan</button>`:''}</td></tr>`).join('');
 $('batchImageQueue').innerHTML=r.posts.map(p=>`<li class="batch-post-label"><strong>P${String(p.postNumber).padStart(2,'0')} · ${escapeHtml(p.title)}</strong></li>${p.entries.map(e=>`<li data-batch-filename="${escapeHtml(e.batchFilename)}"><b>${e.ready?'✓':'○'}</b><span>${escapeHtml(e.label)}</span><small>${escapeHtml(e.batchFilename)}</small></li>`).join('')}`).join('');
 $('productionBatchRows').querySelectorAll('[data-batch-open]').forEach(b=>b.onclick=()=>openBatchPost(Number(b.dataset.batchOpen)));
 $('productionBatchRows').querySelectorAll('[data-batch-share]').forEach(b=>b.onclick=()=>shareBatchPost(Number(b.dataset.batchShare)));
 $('productionBatchRows').querySelectorAll('[data-batch-caption]').forEach(b=>b.onclick=()=>{const p=r.posts.find(p=>p.postNumber===Number(b.dataset.batchCaption));if(p?.reviewed)return copyText(p.content.caption,'✓ Caption copied');});
 $('productionBatchRows').querySelectorAll('[data-batch-refresh]').forEach(b=>b.onclick=async()=>{const p=r.posts.find(p=>p.postNumber===Number(b.dataset.batchRefresh));if(!p?.row?.assessment.ready||p.row.assessment.risk.tier!=='LOW'||!['UNIQUE','CANONICAL'].includes(p.row.duplicateStatus))return toast('This post is no longer eligible. Select a new batch or resolve its source issue.',true);p.stamp=batchPostStamp(p.row);persistProductionBatch({...batch,posts:batch.posts.map(saved=>saved.postNumber===p.postNumber?{...saved,stamp:p.stamp}:saved)});await refreshProductionBatch();});
}
function setBatchBusy(value){state.batchBusy=value;for(const id of ['sheetSelect','recipeSelect','search','prev','next','autoImprove','workNext','quickStart','primaryAction','queueLoad','confirmClaim','startImageProduction','regenerateVisualPlan','imageImport','imageBuild','allFiles','batchTitleSearch','batchSelectVisible','batchClearSelection','batchCreateSelected'])$(id).disabled=value;renderProductionBatch();if(!value&&state.content){renderQc();renderVisualPlan();}}
async function chooseProductionBatch(count){
 if(state.batchBusy||state.busy)return;
 try{await refreshProductionBatch();const number=Number(localStorage.getItem('capc:imageBatchCounter')||0)+1,pool=state.sourceId?state.editorialRows.filter(row=>Number(row.sheetId)===Number(state.sourceId)):state.editorialRows,batch=createProductionBatch(pool,count,number);persistProductionBatch(batch);localStorage.setItem('capc:imageBatchCounter',String(number));state.batchUnmatched=[];renderBatchExceptions();await refreshProductionBatch();goStage('batchProduction');}catch(error){toast(error.message,true);}
}
async function activateBatchPost(post){
 if(!post?.valid)throw Error('Post source or plan changed. Refresh the affected plan first.');
 state.batchInternal=true;try{await openQueueItem(post.row);}finally{state.batchInternal=false;}await state.contentReady;
 if(state.content?.contentId!==post.contentId||Number(state.sourceId)!==Number(post.sheetId)||!state.assessment.ready||batchPostStamp({...post.row,assessment:state.assessment})!==post.stamp)throw Error('Post changed while loading. Refresh the affected batch plan.');
}
async function openBatchPost(number){if(state.batchBusy||state.busy)return;try{await refreshProductionBatch();const post=state.productionBatchResolved.posts.find(p=>p.postNumber===number);if(post?.row&&!post.valid){await openQueueItem(post.row);return openContentCompletion();}await activateBatchPost(post);goStage(post.built?'assets':'images');}catch(error){toast(error.message,true);}}
function renderBatchExceptions(){const list=state.batchUnmatched||[];$('batchExceptions').hidden=!list.length;$('batchExceptionRows').innerHTML=list.map((item,i)=>`<div class="unmatched-row"><span>${escapeHtml(item.file.name)} · ${escapeHtml(item.reason)}</span><select data-batch-destination="${i}" aria-label="Batch destination for ${escapeHtml(item.file.name)}"><option value="">Choose post and slot…</option>${state.productionBatchResolved.entries.filter(e=>e.valid).map(e=>`<option value="${escapeHtml(e.batchFilename)}">${escapeHtml(e.batchFilename)}</option>`).join('')}</select><button data-batch-assign="${i}" class="btn btn-neutral" type="button">Assign Image</button></div>`).join('');$('batchExceptionRows').querySelectorAll('[data-batch-assign]').forEach(b=>b.onclick=async()=>{if(state.batchBusy)return;const i=Number(b.dataset.batchAssign),filename=$('batchExceptionRows').querySelector(`[data-batch-destination="${i}"]`).value;if(!filename)return toast('Choose an explicit destination.',true);setBatchBusy(true);try{await refreshProductionBatch();const e=state.productionBatchResolved.entries.find(e=>e.valid&&e.batchFilename===filename);if(!e)throw Error('Destination is no longer current.');await storeBatchImage(e,list[i].file);list.splice(i,1);await refreshProductionBatch();renderBatchExceptions();if(state.content)await loadContentState();}catch(error){toast(error.message,true);}finally{setBatchBusy(false);}});}
async function storeBatchImage(entry,file){
 const post=state.productionBatchResolved.posts.find(p=>p.postNumber===entry.postNumber);if(!post?.valid)throw Error('Batch plan is no longer current.');
 const value=await prepareStoredImage(file,entry,post.images);await putStored('images',`${entry.postKey}:image:${entry.slotId}`,value);post.images[entry.slotId]=value;
 localStorage.removeItem(`capc:image-review:${entry.postKey}:image-review:${entry.slotId}`);localStorage.removeItem(`capc:visual:${entry.postKey}:review:visual`);
}
async function importBatchImages(files){
 if(state.batchBusy||state.busy)return;const list=Array.from(files);if(list.length>200||list.reduce((n,f)=>n+f.size,0)>1024*1024*1024)return toast('Import up to 200 images / 1 GB at a time. Each image remains limited to 35 MB.',true);
 setBatchBusy(true);try{await refreshProductionBatch();const {matched,unmatched}=planBatchImports(list,state.productionBatchResolved);state.batchUnmatched=unmatched;let imported=0;for(const {file,entry} of matched){try{await storeBatchImage(entry,file);imported++;}catch(error){state.batchUnmatched.push({file,reason:error.message});}}await refreshProductionBatch();renderBatchExceptions();if(state.content)await loadContentState();toast(`${imported} matched · ${state.batchUnmatched.length} need attention.`);}catch(error){toast(error.message,true);}finally{$('batchFiles').value='';setBatchBusy(false);}
}
async function buildReadyBatchPosts(){
 if(state.batchBusy||state.busy)return;setBatchBusy(true);try{await refreshProductionBatch();const posts=state.productionBatchResolved.posts.filter(p=>p.readyToBuild);let built=0;const failed=[];for(const post of posts){try{$('productionBatchHint').textContent=`Building P${post.postNumber} · ${post.title}`;await activateBatchPost(post);await buildAssets(true);refreshStale();if(!state.gates?.finalAssetsBuilt)throw Error(`P${post.postNumber} did not build. See its error.`);built++;}catch(error){failed.push(`P${post.postNumber}: ${error.message}`);}}await refreshProductionBatch();goStage('batchProduction');toast(`${built} posts built. ${failed.length?`${failed.length} posts need attention: ${failed.join(" · ")}.`:"Inspect each Final preview; completed posts can download independently."}`,!!failed.length);}catch(error){toast(error.message,true);}finally{setBatchBusy(false);}
}
function packageFiles(content,plan,assets,assessment,source,extra={}){
 const entries=exportEntries(content,plan,assets),folder=safeFilename(`${content.contentId}_${content.title}`),prefix=extra.batchPostPrefix?`${extra.batchPostPrefix}_${folder}`:folder;
 const metadata={Content_ID:content.contentId,Title:content.title,source,template:content.templateType,productionDecision:assessment.recommendation,productionCheck:assessment.mode,editorialStatus:runEditorialReview(content).status,exportedAt:new Date().toISOString(),fastVisualPlan:content.fastVisualPlan,assetOrder:entries.map(({blob,...entry})=>entry),...extra};
 return {folder:prefix,files:[...entries.map(e=>({name:`${prefix}/${e.filename}`,blob:e.blob})),{name:`${prefix}/caption.txt`,blob:new Blob([content.caption],{type:'text/plain;charset=utf-8'})},{name:`${prefix}/manifest.json`,blob:new Blob([JSON.stringify(metadata,null,2)],{type:'application/json'})}]};
}
async function downloadReadyBatchPosts(){
 if(state.batchBusy||state.busy)return;setBatchBusy(true);try{await refreshProductionBatch();const batch=state.productionBatch,r=state.productionBatchResolved,posts=r.posts.filter(p=>p.reviewed);if(!posts.length)throw Error('Inspect a built Final preview and choose Looks Good before downloading.');
 const files=posts.flatMap(p=>packageFiles(p.content,p.plan,p.assets,p.assessment,{sheetId:p.sheetId,name:p.row.source},{batchId:batch.id,postNumber:p.postNumber,batchPostPrefix:`P${String(p.postNumber).padStart(2,'0')}`}).files);
 files.push({name:'batch-manifest.json',blob:new Blob([JSON.stringify({batchId:batch.id,selectedCount:r.posts.length,exportedCount:posts.length,posts:posts.map(p=>({postNumber:p.postNumber,contentId:p.contentId,sheetId:p.sheetId}))},null,2)],{type:'application/json'})});
 downloadBlob(await createZip(files),`${batch.id}_${posts.length}_ready_posts.zip`);
 for(const post of posts){const saved=readProductionSession(post.row.content,post.sheetId);localStorage.setItem(productionSessionKey(post.sheetId,post.contentId),JSON.stringify({...saved,sourceStamp:sourceStamp(post.row.content),downloadedAt:new Date().toISOString()}));}await refreshProductionBatch();toast(`${posts.length} current reviewed posts downloaded. Unfinished posts remain in the batch.`);
 }catch(error){toast(error.message,true);}finally{setBatchBusy(false);}
}
function bindBatchEvents(){
 const open=()=>{$('batchProduction').hidden=false;refreshSheets(true,true).then(()=>loadEditorialQueue()).then(()=>goStage('batchProduction')).catch(e=>toast(e.message,true));};$('openBatch').onclick=open;$('quickBatch').onclick=open;
 document.querySelectorAll('[data-batch-size]').forEach(b=>b.onclick=()=>chooseProductionBatch(Number(b.dataset.batchSize)));
 $('batchTitleSearch').oninput=renderBatchTitlePicker;$('batchSelectVisible').onclick=selectVisibleBatchTitles;$('batchClearSelection').onclick=()=>{state.batchSelectedKeys.clear();renderBatchTitlePicker();};$('batchCreateSelected').onclick=createSelectedProductionBatch;
 $('refreshProductionBatch').onclick=()=>{if(state.batchBusy||state.busy)return;return loadEditorialQueue().catch(e=>toast(e.message,true));};$('continueBatch').onclick=()=>{const e=state.productionBatchResolved?.next;return e?openBatchPost(e.postNumber):goStage('batchProduction');};
 $('batchImport').onclick=()=>$('batchFiles').click();$('batchFiles').onchange=()=>importBatchImages($('batchFiles').files);
 const zone=$('batchDropzone');for(const event of ['dragenter','dragover'])zone.addEventListener(event,e=>{e.preventDefault();zone.classList.add('dragover');});for(const event of ['dragleave','drop'])zone.addEventListener(event,e=>{e.preventDefault();zone.classList.remove('dragover');});zone.addEventListener('drop',e=>importBatchImages(e.dataTransfer.files));
 $('batchCopyNext').onclick=()=>{const e=state.productionBatchResolved?.next;if(e)copyText(batchImagePrompt(state.productionBatch,state.productionBatchResolved,{entry:e}),'Next batch image prompt copied.');};
 for(const [id,scope] of [['batchCopyPost','post'],['batchCopyAll','all']])$(id).onclick=()=>{try{copyText(batchImagePrompt(state.productionBatch,state.productionBatchResolved,scope==='post'?{postNumber:state.productionBatchResolved.next?.postNumber}:{}),'Batch production prompt copied.');}catch(error){toast(error.message,true);}};
 $('batchBuildReady').onclick=buildReadyBatchPosts;$('batchDownloadReady').onclick=downloadReadyBatchPosts;
 $('startImageProduction').onclick=()=>{if(!state.assessment?.ready)return openContentCompletion();goStage('images');$('copyNextPrompt').focus();};$('regenerateVisualPlan').onclick=()=>{if(!state.originalContent||state.busy||state.batchBusy)return;applyContent(state.originalContent);renderVisualPlan();toast('Source-based image plan recalculated. Original information preserved.');};
 if(activeProductionBatch())$('batchProduction').hidden=false;
}

function bindEvents() {
  bindBatchEvents();
  $('queueLoad').addEventListener('click',loadEditorialQueue);
  for(const id of ['queueFilter','queueSearch','queueShowDuplicates'])$(id).addEventListener(id==='queueSearch'?'input':'change',renderEditorialQueue);
  $('primaryAction').addEventListener('click',primaryProductionAction);
  $('autoImprove').addEventListener('click',autoImprove);
  $('copyCompletionPrompt').onclick=()=>copyText(buildContentCompletionPrompt(state.originalContent,state.assessment),'Completion prompt copied. Use it in ChatGPT, then paste the completed body here.');
  $('applyCompletion').onclick=applyContentCompletion;
  $('completionText').addEventListener('input',()=>{try{saveProductionSession({completionDraft:$('completionText').value});}catch(error){toast('Draft could not be saved: '+error.message,true);}});
  $('workNext').addEventListener('click',nextEditorialReview);
  document.querySelectorAll('[data-decision]').forEach(button=>button.addEventListener('click',()=>overrideDecision(button.dataset.decision)));
  $('quickStart').addEventListener('click',()=>state.assessment?primaryProductionAction():continueWithGoodContent({quick:true}));
  $('progressNext').addEventListener('click',()=>continueWithGoodContent());
  $('startNext').addEventListener('click',()=>continueWithGoodContent());
  $('confirmClaim').addEventListener('click',()=>{if(!state.originalContent||state.busy)return;const reference=$('claimReference').value.trim();if(reference.length<8)return toast('Identify the checked support for this claim.',true);saveProductionSession({claimConfirmation:{sourceStamp:sourceStamp(state.originalContent),reference,confirmedAt:new Date().toISOString()},override:undefined});applyContent(state.originalContent);renderEditorialQueue();});
  for(const [id,tab] of [['showOriginal','original'],['showOptimised','optimised']])$(id).addEventListener('click',()=>{document.querySelector('.compare-columns').dataset.compare=tab;$('showOriginal').setAttribute('aria-selected',String(tab==='original'));$('showOptimised').setAttribute('aria-selected',String(tab==='optimised'));});
  $('copyNextPrompt').addEventListener('click',()=>{const next=state.manifest.entries.find(e=>!state.images[e.slotId]||state.images[e.slotId].semanticKey!==e.semanticKey||state.images[e.slotId].qc?.status!=='PASS');if(next&&state.assessment.ready)copyText(buildSlotPrompt(state.content,next.slotId),'Next image prompt copied.');});
  $('copyMaster').addEventListener('click',()=>state.assessment?.ready&&copyText(buildSessionPrompt(state.content),'Master Session Prompt copied.'));
  $('imageImport').addEventListener('click',()=>$('allFiles').click());$('imageBuild').addEventListener('click',async()=>{await buildAssets();goStage('assets');});
  $('looksGood').addEventListener('click',confirmLooksGood);
  $('fixFinal').addEventListener('click',()=>repairFinal('FIX IMAGE'));$('regenerateFinal').addEventListener('click',()=>repairFinal('REGENERATE'));
  $('rebuildFinal').addEventListener('click',buildAssets);
  $('previewPrev').addEventListener('click',()=>{const n=finalPages().length;state.previewIndex=(state.previewIndex-1+n)%n;renderFinalPreview();});$('previewNext').addEventListener('click',()=>{const n=finalPages().length;state.previewIndex=(state.previewIndex+1)%n;renderFinalPreview();});
  $('downloadPost').addEventListener('click',downloadPackage);$('previewDownload').addEventListener('click',()=>{goStage('download');return exportFinalImages();});
  $('shareFinalImages').onclick=exportFinalImages;$('downloadFinalImages').onclick=downloadFinalImages;$('showIndividualImages').onclick=()=>showIndividualDownloads();
  $('copyFinalCaption').onclick=()=>{if(!state.assessment?.ready)return;return copyText(state.content.caption,'✓ Caption copied');};
  $('downloadFinalManifest').onclick=()=>{try{const entries=currentFinalEntries();downloadBlob(new Blob([JSON.stringify({contentId:state.content.contentId,assetOrder:entries.map(({blob,...entry})=>entry)},null,2)],{type:'application/json'}),'manifest.json');}catch(error){toast(error.message,true);}};
  $('exportRebuild').onclick=()=>{goStage('assets');return buildAssets();};
  document.addEventListener('keydown',event=>{if(event.altKey&&event.key.toLowerCase()==='n'&&!['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName)){event.preventDefault();nextEditorialReview();}});
  $("sheetSelect").addEventListener("change", (event) => {state.deliberateContentSelection=true;loadSource(event.target.value);});
  $("recipeSelect").addEventListener("change", (event) => {
    state.deliberateContentSelection=true;
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
    if (!state.generationReadiness?.ready) return toast("Generation is blocked. Resolve the specific fact or claim blockers first.", true);
    return copyText(buildSessionPrompt(state.content), "One deterministic ChatGPT image session prompt copied.");
  });
  $("importAll").addEventListener("click", () => {
    if (!state.assessment || !canImport(state.assessment)) return toast("Load a valid image specification first.", true);
    return $("allFiles").click();
  });
  $("allFiles").addEventListener("change", (event) => importMany(event.target.files));
  $("buildAssets").addEventListener("click", buildAssets);
  $("copyCaption").addEventListener("click", () => {
    if (!state.assessment?.ready) return toast("Resolve the specific content blocker first.", true);
    return copyText(state.content.caption, "✓ Caption copied");
  });
  $("refreshSheets").addEventListener("click", () => refreshSheets(true, true));
  $("assignPageProfile").addEventListener("click", assignPageProfile);
  $("savePageProfile").addEventListener("click", savePageProfile);
  $("targetPageProfile").addEventListener("change", (event) => fillProfileForm(state.profiles.find((profile) => profile.profileId === event.target.value) || {}));
  $("openAddSheet").addEventListener("click", openAddSheet);
  $("closeAddSheet").addEventListener("click", () => { $("addSheetPanel").hidden = true; });
  $("newSheetTemplate").addEventListener("change", renderSheetTemplatePreview);
  $("createSheet").addEventListener("click", createSheet);
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


function currentFinalEntries(){
 refreshStale();return collectFinalImages({content:state.content,plan:state.plan,assets:state.assets,images:state.images,exportReady:state.gates?.exportReady});
}
function renderExportCard(){
 if(!$('shareFinalImages'))return;
 let entries=[];try{entries=currentFinalEntries();}catch{ /* Existing gates explain what needs building/review. */ }
 const ready=entries.length>0,files=finalImageFiles(entries),native=ready&&canShareFinalFiles(files),blocked=state.busy||state.batchBusy||state.exportBusy;
 state.finalShareSupported=native;
 $('shareFinalImages').textContent=native?`Share / Save ${entries.length} Images`:'Download All Images';
 for(const id of ['shareFinalImages','downloadFinalImages','showIndividualImages','downloadFinalManifest','downloadPost'])$(id).disabled=!ready||blocked;
 $('copyFinalCaption').disabled=!state.assessment?.ready||state.busy||state.batchBusy;
 const stale=state.plan.some(p=>state.assets[p.asset_id]?.stale);
 $('downloadHeading').textContent=ready?'Ready to Post':'Download';$('downloadState').textContent=ready?`${entries.length} images · 1440 × 1800 · Caption ready`:stale?'Rebuild required':'Build current assets and choose Looks Good in the final preview.';
 $('finalExportSummary').textContent=ready?(native?'Choose a save/share destination in your device’s share sheet.':'Save the PNGs to a folder where supported, or use the individual Download buttons.'):'Only current final rendered PNGs can be shared or saved.';
 $('exportRebuild').hidden=!stale;$('exportRebuild').disabled=state.busy||state.batchBusy;
 if(state.nextBestAction?.kind==='DOWNLOAD')$('primaryAction').textContent=$('shareFinalImages').textContent;
 $('previewDownload').textContent=ready?$('shareFinalImages').textContent:'Download';
 $('previewDownload').disabled=!ready||blocked;if(state.nextBestAction?.kind==='DOWNLOAD')$('primaryAction').disabled=blocked;
 const next=ready?nextSuggested():null;$('nextContentCard').hidden=!next;$('nextContentTitle').textContent=next?`${next.title} · ${next.assessment.score} · PRODUCE`:'';
 const signature=ready?reviewSignature():'';if(state.finalDownloadPanelSignature!==signature){state.finalDownloadPanelSignature=signature;clearPreviewUrls('downloads');$('finalImageDownloads').replaceChildren();if(ready)for(const entry of entries){const article=document.createElement('article');article.className='card final-download-image';const image=document.createElement('img');image.src=previewUrl(entry.blob,'downloads');image.alt=entry.label;const label=document.createElement('strong');label.textContent=entry.label;const filename=document.createElement('small');filename.textContent=entry.filename;const button=document.createElement('button');button.className='btn btn-neutral';button.type='button';button.textContent='Download';button.dataset.finalSequence=entry.sequence;button.onclick=()=>downloadOneFinalImage(entry.sequence);article.append(image,label,filename,button);$('finalImageDownloads').append(article);}}
 $('finalImageDownloads').querySelectorAll('button').forEach(b=>b.disabled=!ready||blocked);
 document.querySelectorAll('#assets .asset-footer button').forEach(b=>b.disabled=!ready||blocked);
}
function showIndividualDownloads(message='Download each numbered image. Your post remains ready.'){
 renderExportCard();$('moreExportOptions').open=true;$('finalImageDownloads').hidden=false;$('imageExportStatus').textContent=message;goStage('download');
}
function downloadOneFinalImage(sequence){
 if(state.busy||state.batchBusy||state.exportBusy)return;
 try{const entry=currentFinalEntries().find(e=>e.sequence===sequence);if(!entry)throw Error('Rebuild required.');downloadBlob(entry.blob,entry.filename);}catch(error){renderQc();toast(error.message,true);}
}
function handleShareResult(result){
 if(result.status==='SHARED'){$('imageExportStatus').textContent='Share sheet completed. Copy Facebook Caption next.';toast('Images shared. Copy Facebook Caption next.');}
 else if(result.status!=='CANCELLED')showIndividualDownloads('Native sharing unavailable. Save to a folder, download images individually, or use ZIP.');
}
function exportFinalImages(){
 if(state.busy||state.batchBusy||state.exportBusy)return;
 try{const files=finalImageFiles(currentFinalEntries());if(!canShareFinalFiles(files))return downloadFinalImages();
 // Native share is invoked now, before any await, load, timer or rendering.
 const result=shareFinalFiles(files);state.exportBusy=true;renderExportCard();
 result.then(handleShareResult).finally(()=>{state.exportBusy=false;renderExportCard();});
 }catch(error){renderQc();toast(error.message,true);}
}
function downloadFinalImages(){
 if(state.busy||state.batchBusy||state.exportBusy)return;
 try{const files=finalImageFiles(currentFinalEntries()),signature=reviewSignature();
 if(!files.length||typeof window.showDirectoryPicker!=='function')return showIndividualDownloads('Download the ordered PNGs below. This browser cannot reliably save several files from one tap.');
 const folderName=safeFilename(`${state.content.contentId}_${state.content.title}_${Date.now()}`);
 const result=saveFinalFilesToFolder(files,{showDirectoryPicker:window.showDirectoryPicker.bind(window),folderName,isCurrent:()=>{try{return reviewSignature()===signature&&currentFinalEntries().length===files.length;}catch{return false;}}});
 state.exportBusy=true;renderExportCard();result.then(r=>{if(r.status==='SAVED'){$('imageExportStatus').textContent=`✓ ${r.count} final images saved. Copy Facebook Caption next.`;toast(`${r.count} final PNGs saved.`);}else if(r.status==='STALE'){renderQc();toast('Rebuild required. Remaining files were not saved.',true);}else if(r.status!=='CANCELLED')showIndividualDownloads('Folder saving unavailable. Download images individually or use ZIP.');}).finally(()=>{state.exportBusy=false;renderExportCard();});
 }catch(error){renderQc();toast(error.message,true);}
}
function shareBatchPost(number){
 if(state.busy||state.batchBusy||state.exportBusy)return;
 const post=state.productionBatchResolved?.posts.find(p=>p.postNumber===number);
 try{if(!post?.valid||!post.reviewed)throw Error('Build and inspect this post before sharing.');
 // Use live selected state when it is this post, so a newer image revision cannot reuse old batch readiness.
 const entries=state.content?.contentId===post.contentId&&Number(state.sourceId)===post.sheetId?currentFinalEntries():collectFinalImages({content:post.content,plan:post.plan,assets:post.assets,images:post.images,exportReady:post.reviewed&&post.valid});
 const files=finalImageFiles(entries);if(!canShareFinalFiles(files))return openBatchPost(number).then(()=>showIndividualDownloads('Save or download this post’s final images below.'));
 const result=shareFinalFiles(files);state.exportBusy=true;renderProductionBatch();result.then(r=>{if(r.status==='SHARED')toast('Post images shared. Use Copy Caption beside this post.');else if(r.status!=='CANCELLED')return openBatchPost(number).then(()=>showIndividualDownloads('Native sharing unavailable. Download this post’s final images below.'));}).finally(()=>{state.exportBusy=false;renderProductionBatch();});
 }catch(error){toast(error.message,true);}
}

async function downloadPackage() {
  renderQc();if(!state.gates?.exportReady || state.busy||state.batchBusy||state.exportBusy)return toast("Complete the export gates first.",true);
  state.busy=true;renderQc();
  try {
    const metadata={builtAt:new Date(Math.max(...Object.values(state.assets).map(a=>a.updatedAt))).toISOString(),qc:state.gates,heuristicContentScore:state.assessment.score};
    const {folder,files}=packageFiles(state.content,state.plan,state.assets,state.assessment,{name:state.sourceName,sheetId:state.sourceId,kind:state.source},metadata);
    downloadBlob(await createZip(files),`${folder}.zip`);toast("One ordered production ZIP downloaded.");saveProductionSession({downloadedAt:new Date().toISOString()});const next=nextSuggested();$("nextContentCard").hidden=!next;$("nextContentTitle").textContent=next?`${next.title} · ${next.assessment.score} · PRODUCE`:"No further produce-ready content in this queue.";
  }catch(error){toast(error.message,true);}finally{state.busy=false;renderQc();}
}
