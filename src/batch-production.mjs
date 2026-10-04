/** Deterministic, browser-independent batch selection, identity, progress and import matching. */
import {isStoredAssetStale} from './content-model.mjs';
import {assetSemanticKey,sessionSignature} from './production-core.mjs';
import {COMPLETION_VERSION} from './content-completion.mjs';
import {changeToken,sourceStamp,assessProduction} from './production-assistant.mjs';
export const BATCH_VERSION='BATCH_IMAGE_2026-10-04.1';
const slotLabel=id=>id.toUpperCase().replace(/^(?:\d+|fast)[_-]/i,'');
const key=row=>`${row.sheetId}:${row.contentId}`;
export const productionSkipReason=row=>['HOLD_DUPLICATE','REWORK'].includes(row.duplicateStatus)?'DUPLICATE':published(row)||row.publicationRecorded?'ALREADY_PUBLISHED':row.assessment?.gaps?.length?'CRITICAL_INFO_MISSING':row.assessment?.risk?.tier!=='LOW'&&!row.assessment?.verified?'HIGH_RISK_UNVERIFIED':'LOW_QUALITY';
const published=row=>[row.lifecycleStatus,row.content?.lifecycleStatus].some(s=>/^(?:posted|published|scheduled_published|results_recorded)$/i.test(s||''));
export function eligibleForBatch(row){const a=row.assessment;return a?.ready&&a.recommendation==='PRODUCE'&&a.risk.tier==='LOW'&&['UNIQUE','CANONICAL'].includes(row.duplicateStatus)&&!published(row)&&!row.publicationRecorded&&!row.downloaded;}
function rankedCandidates(rows,count){
 const available=rows.filter(eligibleForBatch).sort((a,b)=>b.assessment.score-a.assessment.score||key(a).localeCompare(key(b))),selected=[],types=new Map(),topics=new Map();
 const topic=row=>String(row.title||'').match(/鸡|虾|鱼|蛋|豆腐|南瓜|牛肉|猪肉|面|饭|水果/)?.[0]||row.contentType;
 while(selected.length<count&&available.length){available.sort((a,b)=>((b.assessment.score-7*(types.get(b.contentType)||0)-3*(topics.get(topic(b))||0))-(a.assessment.score-7*(types.get(a.contentType)||0)-3*(topics.get(topic(a))||0)))||key(a).localeCompare(key(b)));const row=available.shift();selected.push(row);types.set(row.contentType,(types.get(row.contentType)||0)+1);topics.set(topic(row),(topics.get(topic(row))||0)+1);}
 return selected;
}
export function selectBatchCandidates(rows,count){if(![5,10,20].includes(count))throw Error('Choose 5, 10 or 20 posts.');return rankedCandidates(rows,count);}
export function screenProductionRows(rows){return rows.map(row=>{const a=row.assessment,stamp=a?.productionOverride;return stamp?.version===COMPLETION_VERSION&&stamp?.sourceStamp===sourceStamp(row.content)&&stamp.inputStamp===changeToken(JSON.stringify(row.content.raw||{}))?row:{...row,assessment:assessProduction(row.content,{session:row.session||{},duplicateStatus:row.duplicateStatus})};});}
const savedCandidate=(row,postNumber)=>({sheetId:row.sheetId,contentId:row.contentId,postNumber,title:row.assessment.content.title,contentType:row.contentType,stamp:batchPostStamp(row),productionContent:row.assessment.productionOverride});
function batchSummary(rows,selected,reserve,batch={}){const skipped={};for(const row of rows.filter(r=>!eligibleForBatch(r))){const reason=productionSkipReason(row);skipped[reason]=(skipped[reason]||0)+1;}return {requested:batch.requestedCount||selected.length,evaluated:rows.length,selected:selected.length,autoRepaired:selected.filter(r=>r.assessment.repair?.autoFixed.length).length,skippedIncomplete:skipped.CRITICAL_INFO_MISSING||0,skippedDuplicate:skipped.DUPLICATE||0,skippedLowQuality:skipped.LOW_QUALITY||0,skippedPublished:skipped.ALREADY_PUBLISHED||0,skippedUnverified:skipped.HIGH_RISK_UNVERIFIED||0,reserve:reserve.length,replaced:(batch.replacements||[]).filter(r=>!r.restoredAfterSourceRecovery).length,skippedReasons:skipped};}
export function batchPostStamp(row){return changeToken(JSON.stringify([sourceStamp(row.content),row.assessment.content.caption,row.assessment.content.resolvedAssetPlan]));}
export function createProductionBatch(rows,count,number=1){
 const screened=screenProductionRows(rows),selected=selectBatchCandidates(screened,count);if(!selected.length)throw Error('No complete, low-risk, non-duplicate PRODUCE content is available.');
 const selectedKeys=new Set(selected.map(key)),reserve=rankedCandidates(screened.filter(r=>!selectedKeys.has(key(r))),Math.max(5,Math.ceil(count/2))).map(r=>savedCandidate(r));
 const batch={version:BATCH_VERSION,id:`B${String(number).padStart(2,'0')}`,number,requestedCount:count,createdAt:new Date().toISOString(),posts:selected.map((row,i)=>savedCandidate(row,i+1)),reserve,replacements:[]};batch.summary=batchSummary(screened,selected,reserve,batch);return batch;
}
/** Replace unsafe posts only BEFORE image production; preserve every original image/asset namespace. */
export function reconcileProductionBatch(batch,rows,{imagesByKey=new Map(),assetsByKey=new Map()}={}){
 if(!batch||batch.version!==BATCH_VERSION||!rows.length)return {batch,changed:false,replacements:[]};
 const next=structuredClone(batch),screened=screenProductionRows(rows),byKey=new Map(screened.map(r=>[key(r),r])),used=new Set(next.posts.map(key)),excluded=new Set((next.replacements||[]).map(r=>r.previousKey)),replacements=[];let changed=false;
 // An unavailable source is not evidence of bad content. Preserve posts AND reserves.
 if([...next.posts,...(next.reserve||[])].some(post=>!byKey.has(key(post))))return {batch,changed:false,replacements:[]};
 const started=post=>[...imagesByKey.keys()].some(k=>k.startsWith(`${key(post)}:image:`))||[...assetsByKey.keys()].some(k=>k.startsWith(`${key(post)}:asset:`));
 // Recover only pre-production replacements made by older versions during a partial source read.
 // Keep the immutable replacement history and never displace media the user has started.
 if(Number.isFinite(batch.summary?.evaluated)&&batch.summary.evaluated<rows.length){
  for(const previous of [...(next.replacements||[])].reverse()){
   if(previous.reason!=='CRITICAL_INFO_MISSING'||previous.restoredAfterSourceRecovery)continue;
   const index=next.posts.findIndex(p=>p.postNumber===previous.postNumber&&key(p)===previous.replacementKey),original=byKey.get(previous.previousKey);
   if(index<0||!original||!eligibleForBatch(original)||used.has(previous.previousKey)||started(next.posts[index]))continue;
   const current=next.posts[index];used.delete(key(current));used.add(previous.previousKey);
   next.posts[index]={...savedCandidate(original,current.postNumber),replacementGeneration:Math.max(0,(current.replacementGeneration||1)-1)};
   previous.restoredAfterSourceRecovery=true;changed=true;
  }
 }
 for(let i=0;i<next.posts.length;i++){const post=next.posts[i],row=byKey.get(key(post));if(row&&eligibleForBatch({...row,downloaded:false})){const version=row.assessment.productionOverride;if(post.productionContent?.version!==version.version||post.productionContent?.sourceStamp!==version.sourceStamp||post.productionContent?.inputStamp!==version.inputStamp){next.posts[i]={...post,productionContent:version};changed=true;}if(!started(post)&&(post.stamp!==batchPostStamp(row)||post.productionContent?.version!==COMPLETION_VERSION)){next.posts[i]={...post,stamp:batchPostStamp(row),productionContent:row.assessment.productionOverride};changed=true;}continue;}if(row?.assessment?.recommendation==='IMPROVE'||row?.assessment?.gaps?.length)continue;if(started(post))continue;
  const reserveKeys=new Set((next.reserve||[]).map(key)),pool=rankedCandidates(screened.filter(r=>!used.has(key(r))&&!excluded.has(key(r))),screened.length),similar=pool.filter(r=>r.contentType===(row?.contentType||post.contentType)),candidate=similar.find(r=>reserveKeys.has(key(r)))||similar[0]||pool.find(r=>reserveKeys.has(key(r)))||pool[0];if(!candidate)continue;
  const replacement={postNumber:post.postNumber,previousKey:key(post),contentId:post.contentId,replacementKey:key(candidate),replacementContentId:candidate.contentId,reason:row?productionSkipReason(row):'CRITICAL_INFO_MISSING'};replacements.push(replacement);excluded.add(key(post));used.delete(key(post));used.add(key(candidate));next.posts[i]={...savedCandidate(candidate,post.postNumber),replacementGeneration:(post.replacementGeneration||0)+1};changed=true;
 }
 // Refill an under-sized batch only from the same screened pool, never with weak padding.
 const fill=rankedCandidates(screened.filter(r=>!used.has(key(r))&&!excluded.has(key(r))),Math.max(0,next.requestedCount-next.posts.length));for(const row of fill){next.posts.push(savedCandidate(row,next.posts.length+1));used.add(key(row));changed=true;}
 next.replacements=[...(next.replacements||[]),...replacements];next.reserve=rankedCandidates(screened.filter(r=>!used.has(key(r))&&!excluded.has(key(r))),Math.max(5,Math.ceil(next.requestedCount/2))).map(r=>savedCandidate(r));next.summary=batchSummary(screened,next.posts.map(p=>byKey.get(key(p))).filter(Boolean),next.reserve,next);if(JSON.stringify(next.reserve)!==JSON.stringify(batch.reserve)||JSON.stringify(next.summary)!==JSON.stringify(batch.summary))changed=true;return {batch:next,changed,replacements};
}
export function resolveProductionBatch(batch,rows,{imagesByKey=new Map(),assetsByKey=new Map(),visualByKey=new Map(),reviewsByKey=new Map()}={}){
 if(!batch||batch.version!==BATCH_VERSION||!rows.length)return {posts:[],entries:[],totalImages:0,imagesReady:0,builtCount:0,downloadReady:0,readyToBuild:0,next:null,invalid:true};
 const rowMap=new Map(screenProductionRows(rows).map(row=>[key(row),row])),posts=[],entries=[];
 for(const saved of batch.posts){
  const row=rowMap.get(key(saved)),assessment=row?.assessment,content=assessment?.content,manifest=assessment?.manifest||{entries:[]},plan=content?.resolvedAssetPlan||[],valid=Boolean(row&&eligibleForBatch({...row,downloaded:false})&&batchPostStamp(row)===saved.stamp),images={},assets={};
  for(const e of manifest.entries)images[e.slotId]=imagesByKey.get(`${key(saved)}:image:${e.slotId}`);
  for(const a of plan){const value=assetsByKey.get(`${key(saved)}:asset:${a.asset_id}`);if(value)assets[a.asset_id]={...value,stale:value.semanticKey!==assetSemanticKey(a)||isStoredAssetStale(a,value,images)};}
  const postEntries=manifest.entries.map(e=>({...e,sheetId:saved.sheetId,contentId:saved.contentId,postNumber:saved.postNumber,postKey:key(saved),batchId:batch.id,replacementGeneration:saved.replacementGeneration||0,batchFilename:`${batch.id}_P${String(saved.postNumber).padStart(2,'0')}${saved.replacementGeneration?`R${String(saved.replacementGeneration).padStart(2,'0')}`:''}_${String(e.sequence).padStart(2,'0')}_${slotLabel(e.slotId)}.png`,valid,ready:valid&&images[e.slotId]?.qc?.status==='PASS'&&images[e.slotId]?.semanticKey===e.semanticKey}));
  const imageCount=postEntries.filter(e=>e.ready).length,imagesComplete=valid&&postEntries.length>0&&imageCount===postEntries.length,built=imagesComplete&&plan.length>0&&plan.every(a=>assets[a.asset_id]?.qc_status==='PASS'&&!assets[a.asset_id].stale);
  const repairPending=manifest.entries.some(e=>{const r=reviewsByKey.get(`${key(saved)}:image-review:${e.slotId}`);return Boolean(r&&images[e.slotId]&&r.imageRevision===images[e.slotId].revision&&['FIX IMAGE','REGENERATE'].includes(r.status));});
  const reviewed=built&&!repairPending&&visualByKey.get(key(saved))===changeToken(sessionSignature(content,manifest,images,assets));
  posts.push({...saved,row,content,assessment,manifest,plan,images,assets,entries:postEntries,imageCount,valid,built,reviewed,readyToBuild:imagesComplete&&!built,status:!valid?(assessment?.recommendation==='IMPROVE'||assessment?.gaps?.length?'COMPLETE THIS CONTENT · KEPT IN BATCH':'PLAN CHANGED · REFRESH THIS POST'):reviewed?'READY TO DOWNLOAD':built?'FINAL PREVIEW':imagesComplete?'READY TO BUILD':`${imageCount}/${postEntries.length} images`});entries.push(...postEntries);
 }
 return {posts,entries,totalImages:entries.length,imagesReady:entries.filter(e=>e.ready).length,builtCount:posts.filter(p=>p.built).length,downloadReady:posts.filter(p=>p.reviewed).length,readyToBuild:posts.filter(p=>p.readyToBuild).length,next:entries.find(e=>e.valid&&!e.ready)||null,invalid:false};
}
export function matchBatchFilename(filename,resolved){
 const stem=String(filename).normalize('NFC').replace(/\.(?:png|jpe?g|webp)$/i,''),tokens=[...stem.matchAll(/(?:^|[^A-Za-z0-9])B(\d+)[_ -]+P(\d+)(?:R(\d+))?[_ -]+(\d+)[_ -]+([A-Za-z0-9_-]+)/gi)];
 if(tokens.length!==1)return null;
 const [,batch,post,generation,sequence,label]=tokens[0],id=`B${String(Number(batch)).padStart(2,'0')}`,candidates=resolved.entries.filter(e=>e.valid&&e.batchId===id&&e.postNumber===Number(post)&&e.sequence===Number(sequence)&&e.replacementGeneration===Number(generation||0));
 if(candidates.length!==1)return null;
 const e=candidates[0],expected=slotLabel(e.slotId);if(!label.toUpperCase().startsWith(expected))return null;
 const suffix=label.slice(expected.length);if(suffix&&!/^[_ -](?:\d+|copy|download|fixture|chatgpt|image)(?:[_ -].*)?$/i.test(suffix))return null;
 // Conflicting explicit batch/post/sequence identifiers are never mapped by upload order.
 return e;
}
export function planBatchImports(files,resolved){
 const candidates=Array.from(files).map(file=>({file,entry:matchBatchFilename(file.name,resolved)})),counts=new Map();for(const c of candidates)if(c.entry){const k=c.entry.batchFilename;counts.set(k,(counts.get(k)||0)+1);}
 return {matched:candidates.filter(c=>c.entry&&counts.get(c.entry.batchFilename)===1),unmatched:candidates.filter(c=>!c.entry||counts.get(c.entry.batchFilename)>1).map(c=>({...c,reason:c.entry?'Multiple files target this image. Choose the intended version.':'Missing, conflicting, stale or unknown batch/post/slot identifier. Choose an explicit destination.'}))};
}
export function batchImagePrompt(batch,resolved,{postNumber,entry}={}){
 if(postNumber&&!resolved.posts.find(p=>p.postNumber===postNumber)?.valid)throw Error('This post is stale or incomplete. Continue another screened post.');
 const posts=(postNumber?resolved.posts.filter(p=>p.postNumber===postNumber):resolved.posts).filter(p=>p.valid&&p.entries.some(e=>!e.ready));
 const header=[`CHATGPT BATCH IMAGE SESSION — ${batch.id}`,`N = next image; R = regenerate current image; FIX: = fix current image. Generate exactly ONE image per response. R and FIX never advance. N advances one slot only; after the last image stop.`,`RESET VISUAL IDENTITY at every new post. Do not carry dish, plate, ingredients, environment, people or character identity from the previous post. Maintain continuity only WITHIN the current post.`,`Generate only the pending images listed below. Existing imported images are omitted to avoid unnecessary generations.`,`Portrait 4:5, realistic source-faithful photography. No random text, labels, logos or watermarks. Never invent ingredients, quantities, stages or claims. Retain the deterministic filename exactly.`];
 if(entry){const post=resolved.posts.find(p=>p.postNumber===entry.postNumber);if(!post?.valid)throw Error('Batch post is stale. Refresh its plan.');return [...header,`ACTIVATE POST ${entry.postNumber} (reset identity only when changing to this post): ${post.title}\nSOURCE CONTENT:\n${post.content.contentBody}\nWITHIN-POST CONTINUITY:\n${(post.content.consistencyRules||[]).join('\n')}`,`GENERATE ONLY THIS IMAGE\nSAVE AS: ${entry.batchFilename}\nSLOT: ${entry.label}\n${entry.imagePrompt}`].join('\n\n');}
 if(!posts.length)throw Error('No pending production-ready images remain.');
 return [...header,...posts.map(p=>`RESET VISUAL IDENTITY — POST ${String(p.postNumber).padStart(2,'0')}: ${p.title}\nCONTENT ID: ${p.contentId}\nSOURCE CONTENT:\n${p.content.contentBody}\nWITHIN-POST CONTINUITY:\n${(p.content.consistencyRules||[]).join('\n')}\n${p.entries.filter(e=>!e.ready).map(e=>`SAVE AS: ${e.batchFilename}\n${e.label}: ${e.imagePrompt}`).join('\n\n')}`)].join('\n\n');
}
