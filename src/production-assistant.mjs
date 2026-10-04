/** Source-based automatic production compiler. Never confers human editorial approval. */
import {runContentQc,runEditorialReview,buildGenerationManifest,TEMPLATE_REGISTRY} from './content-model.mjs';
import {classifyClaimRisk} from './editorial-pipeline.mjs';
import {auditContent} from './content-quality.mjs';
import {resolveFastVisualPlan} from './fast-visual-plan.mjs';
export const ASSISTANT_VERSION='2026-10-04.1';
const text=v=>String(v??'').trim();
const lines=v=>text(v).split(/\n+/).map(text).filter(Boolean);
const generic=/(?:你知道吗[？?！!]?|原来如此[！!]?|一定要收藏[！!]?|赶快分享[！!]?|太实用了[！!]?|学起来[！!]?|记得收藏[！!]?|不容错过[！!]?|解锁美味[！!]?)/g;
function natural(v){return text(v).replace(generic,'').replace(/\n{3,}/g,'\n\n').trim();}
/** Compact browser change token; human approvals retain the server SHA-256 fingerprint. */
export function changeToken(value){let a=2166136261,b=2246822507;const data=String(value);for(let i=0;i<data.length;i++){a=Math.imul(a^data.charCodeAt(i),16777619);b=Math.imul(b^data.charCodeAt(i),3266489909);}return `${data.length}:${(a>>>0).toString(16)}:${(b>>>0).toString(16)}`;}
export function sourceStamp(content){return changeToken(JSON.stringify([ASSISTANT_VERSION,content.contentId,content.title,content.hookText,content.contentBody,content.caption,content.resolvedAssetPlan,content.sourceIngredients,content.coveragePoints]));}
export function currentSession(content,saved={}){return saved.sourceStamp===sourceStamp(content)?saved:{version:ASSISTANT_VERSION,sourceStamp:sourceStamp(content),iteration:0};}
function compactPlan(content){
  const plan=structuredClone(content.resolvedAssetPlan||[]),required=new Set(TEMPLATE_REGISTRY[content.templateType]?.required_asset_types||[]),removed=[];
  // Remove a decorative repeat only when every source point stays represented.
  const result=plan.filter((asset,index)=>{
    if(plan.length-removed.length<=6||required.has(asset.asset_type)||!['CLOSEUP','DETAIL'].includes(asset.asset_type))return true;
    const covered=new Set(plan.filter((_,i)=>i!==index).flatMap(a=>a.coverage_point_ids||[]));
    if((asset.coverage_point_ids||[]).some(id=>!covered.has(id)))return true;
    const copy=text(asset.overlay_text);if(copy&&!plan.some((a,i)=>i!==index&&text(a.overlay_text).includes(copy)))return true;
    removed.push(asset.asset_id);return false;
  });
  return {plan:result.map((a,i)=>({...a,sequence:i+1})),removed};
}
export function optimiseContent(source,{iteration=0,compact=true}={}){
  const originalTitle=text(source.title),title=natural(originalTitle),body=natural(source.contentBody);
  const planResult=compact?compactPlan(source):{plan:structuredClone(source.resolvedAssetPlan),removed:[]};
  let plan=planResult.plan.map(a=>({...a,overlay_text:natural(a.overlay_text),generation_inputs:(a.generation_inputs||[]).map(i=>({...i,overlay_text:natural(i.overlay_text)}))}));
  const steps=plan.flatMap(a=>a.method_steps||a.generation_inputs||[]).map(i=>text(i.overlay_text)).filter(Boolean);
  const sentences=body.split(/(?<=[。！？；])|\n/).map(text).filter(Boolean);
  const why=sentences.filter(s=>/(?:因为|原因|因此|所以|导致|否则|以免|避免|防止|容易|不能单凭|不能保证|不一定|刚熟)/.test(s)).slice(0,2).join('\n');
  const action=steps.length?steps.join('\n'):sentences.filter(s=>/(?:先|再|检查|观察|挑|选|加入|切|煮|炒|蒸|放|用|保持|避免|不要)/.test(s)).slice(0,6).join('\n');
  const recipe=['RECIPE','DRINK','LOCAL_DRINK_HACK'].includes(source.contentType);
  const need=recipe?'想在家照着材料和步骤完成这道料理的读者':/SELECTION|COMPARISON|REFERENCE|PRODUCT/.test(source.contentType)?'买东西时需要清楚判断重点的读者':'想解决这个日常问题的读者';
  const value=recipe?'材料与做法放在一起，煮的时候方便对照':source.contentType==='MISTAKE_FIX'?'对照问题与正确做法，找到可以调整的步骤':'把来源里的重点整理成可操作的判断和步骤';
  let hook=natural(source.hookText)||title;
  if(hook===title&&/[？?]$/.test(hook))hook=`${hook.replace(/[？?]$/,'')}，先看这几个重点。`;
  const cta=recipe?'煮的时候，可以对照图里的材料和步骤。':'下次用到时，可以对照最后一张的重点。';
  let caption=natural(source.caption);
  if(!caption||caption.length<30)caption=[hook,caption,body,cta].filter(Boolean).join('\n\n');
  else {
    caption=caption.replace(/^(?:#?)(?:你知道吗[？?]?\s*)/,'');
    if(!caption.startsWith(title)&&!caption.startsWith(hook)&&hook!==title)caption=`${hook}\n\n${caption}`;
    if(!/(?:收藏|对照|参考|下次|步骤|重点).{0,15}[。！]?$/.test(caption))caption+=`\n\n${cta}`;
  }
  // A second version changes presentation only; every factual sentence stays intact.
  if(iteration>0&&caption.startsWith(hook+'\n\n'))caption=caption.slice(hook.length+2)+'\n\n'+hook;
  let coveragePoints=source.coveragePoints||[];
  if(!coveragePoints.length&&/SELECTION|COMPARISON|REFERENCE/.test(source.contentType)){
    const criteria=plan.filter(a=>!/COVER|CLOSEUP/.test(a.asset_type)&&text(a.overlay_text).length>=8);
    if(criteria.length>=2){coveragePoints=criteria.map((a,i)=>({id:`AUTO_POINT_${i+1}`,text:text(a.overlay_text),required:true}));plan=plan.map(a=>{const index=criteria.findIndex(c=>c.asset_id===a.asset_id);return index<0?a:{...a,coverage_point_ids:[coveragePoints[index].id]};});}
  }
  const ingredientAsset=plan.find(a=>a.asset_type==='INGREDIENTS');
  const sourceIngredients=source.sourceIngredients?.length?source.sourceIngredients:(ingredientAsset?.ingredient_items||[]).map(i=>typeof i==='string'?i:i.name).filter(Boolean);
  const content=resolveFastVisualPlan({...source,title,hookText:hook,contentBody:body,caption,resolvedAssetPlan:plan,coveragePoints,sourceIngredients});
  const finalCard=plan.find(a=>/CHECKLIST|SUMMARY|SAVE|TIPS/.test(a.asset_type));
  const structure=recipe?'Result → Ingredients → Method → Important tip → Final result':source.contentType==='MISTAKE_FIX'?'Problem → Wrong method → Source-backed reason → Correct method → Result':/SELECTION/.test(source.contentType)?'What to inspect → Good/bad signs → Choice → Checklist':/COMPARISON/.test(source.contentType)?'Options → Source-backed differences → Suitability → Decision':/KNOWLEDGE/.test(source.contentType)?'Question → Explanation → Practical implication → Action':'Situation → Practical points → Action → Recap';
  const changes=[];
  if(title!==originalTitle||body!==text(source.contentBody))changes.push('Removed generic phrases; factual details retained.');
  if(hook!==text(source.hookText))changes.push('Made the opening specific to the source topic.');
  if(caption!==text(source.caption))changes.push('Organised caption and added a practical CTA.');
  if(planResult.removed.length)changes.push(`Removed ${planResult.removed.length} redundant decorative asset(s); source coverage retained.`);
  if(!changes.length)changes.push('Source copy already clear; kept factual wording and quantities.');
  return {content,title,hook,body,caption,what:sentences[0]||title,why,action,audienceNeed:need,readerValue:value,saveValue:text(finalCard?.overlay_text)||action,cta,structure,changes,iteration,engine:'SOURCE_BASED_COMPILER',humanApproved:false};
}
const factualCodes=new Set(['RECIPE_INGREDIENTS_MISSING','RECIPE_QUANTITIES_OR_APPROXIMATION_MISSING','RECIPE_METHOD_INCOMPLETE','RECIPE_TIMING_GUIDANCE_MISSING','RECIPE_TEMPERATURE_GUIDANCE_MISSING','RECIPE_COOKING_SAFETY_CUE_MISSING','MISTAKE_CAUSE_MISSING','MISTAKE_CORRECTION_MISSING','MISTAKE_CONSEQUENCE_MISSING','SELECTION_CRITERIA_INCOMPLETE','INTERNAL_NOTE_IN_SOURCE_BODY','INTERNAL_NOTE_LEAKAGE_CONFIRMED','CLAIM_SAFETY_FAILED']);
const friendly={RECIPE_INGREDIENTS_MISSING:'NEEDS FACT: ingredient list is missing.',RECIPE_QUANTITIES_OR_APPROXIMATION_MISSING:'NEEDS FACT: ingredient quantities are incomplete.',RECIPE_METHOD_INCOMPLETE:'NEEDS FACT: cooking steps are incomplete.',RECIPE_TIMING_GUIDANCE_MISSING:'NEEDS FACT: cooking time or observable doneness cue is missing.',RECIPE_TEMPERATURE_GUIDANCE_MISSING:'NEEDS FACT: this temperature-sensitive recipe has no temperature.',RECIPE_COOKING_SAFETY_CUE_MISSING:'NEEDS FACT: confirm how to tell when the meat is fully cooked.',MISTAKE_CAUSE_MISSING:'NEEDS FACT: source does not explain why the mistake happens.',MISTAKE_CORRECTION_MISSING:'NEEDS FACT: the corrective method is missing.',MISTAKE_CONSEQUENCE_MISSING:'NEEDS FACT: the practical consequence is missing.',SELECTION_CRITERIA_INCOMPLETE:'NEEDS FACT: selection criteria are incomplete.',INTERNAL_NOTE_IN_SOURCE_BODY:'Source contains internal production instructions.',INTERNAL_NOTE_LEAKAGE_CONFIRMED:'Source was marked as containing internal notes.',CLAIM_SAFETY_FAILED:'Source was marked as unsafe or unsupported.'};
export function assessProduction(source,{session={},duplicateStatus='UNIQUE',optimised=true,compact=true}={}){
  session=currentSession(source,session);
  const proposal=optimiseContent(source,{iteration:session.iteration||0,compact});
  const content=optimised?proposal.content:source,risk=classifyClaimRisk(content),qc=runContentQc(content);
  const issues=runEditorialReview(content).issues.filter(i=>factualCodes.has(i.code));
  const gaps=[...qc.failures.map(i=>`NEEDS FACT: ${i.detail}`),...issues.map(i=>friendly[i.code]||i.detail)];
  if(!text(content.contentBody))gaps.push('NEEDS FACT: source body is missing.');
  if(content.editorialReview?.review_status==='BLOCKED')gaps.push('Source is explicitly blocked. Resolve the original reason.');
  if(/(?:待补|待填写|TODO|TBD|待核实)/i.test(content.contentBody))gaps.push('NEEDS FACT: source still contains unresolved placeholders.');
  let manifest;
  try{manifest=buildGenerationManifest(content);for(const e of manifest.entries)if(e.required&&!text(e.imagePrompt))gaps.push(`NEEDS FACT: scene for ${e.label} is missing.`);}catch(error){gaps.push(error.message);manifest={entries:[]};}
  const claims=risk.tier==='LOW'?[]:[...new Set([content.hookText,...lines(content.contentBody),...lines(content.caption),...content.resolvedAssetPlan.map(a=>a.overlay_text)].filter(s=>/(?:保存|冷藏|冷冻|保鲜|营养|蛋白质|维生素|热量|低脂|省|RM|治疗|治愈|疾病|血糖|血压|抗癌|排毒|保证|原理|因为|导致)/.test(s)))].slice(0,8);
  const verified=risk.tier==='LOW'||session.claimConfirmation?.sourceStamp===sourceStamp(source)&&text(session.claimConfirmation.reference).length>=8;
  const duplicate=duplicateStatus==='HOLD_DUPLICATE';
  if(duplicateStatus==='UNASSESSED')gaps.push('Checking duplicate status. Wait for content sources to load.');
  const sourceAudit=auditContent(source),audit=auditContent(content);
  const dimensions={Hook:audit.dimensions.hook_quality.score,Usefulness:content.resolvedAssetPlan.filter(a=>text(a.overlay_text).length>=8).length>=3&&text(content.contentBody).length>=25?9:audit.dimensions.usefulness.score,'Save Value':audit.dimensions.save_value.score,'Share Potential':audit.dimensions.share_value.score*2,'Visual Potential':audit.dimensions.visual_potential.score*2,'Information Quality':gaps.length?3:9,Originality:duplicate?1:duplicateStatus==='REWORK'?5:8};
  const score=Math.round(Object.values(dimensions).reduce((a,b)=>a+b,0)/70*100);
  const fixable=!optimised&&[content.title,content.hookText,content.caption].some(v=>natural(v)!==text(v))||!optimised&&text(content.caption).length<30;
  let recommendation=duplicate||gaps.length||risk.tier==='HIGH'&&!verified||score<60?'SKIP':!verified||fixable||score<78?'IMPROVE':'PRODUCE';
  if(session.override==='SKIP')recommendation='SKIP';
  if(session.override==='IMPROVE'&&!duplicate&&!gaps.length)recommendation='IMPROVE';
  if(session.override==='PRODUCE'&&!duplicate&&!gaps.length&&verified)recommendation='PRODUCE';
  const blockers=[...new Set(gaps)];if(duplicate)blockers.unshift('Duplicate: use the canonical record.');if(!verified)blockers.push(`VERIFY CLAIM: ${risk.reasons.join('; ')}`);if(recommendation!=='PRODUCE'&&!blockers.length)blockers.push(recommendation==='SKIP'?'Skipped for production.':'Auto Improve before generating images.');
  const findings=[gaps.length?gaps[0]:'✓ Source information is complete',duplicate?'Duplicate copy — use the better version':'✓ Practical source-backed steps',!verified?`VERIFY CLAIM · ${risk.tier} RISK`:'✓ AI check complete',`✓ ${manifest.entries.length} images · ${content.resolvedAssetPlan.length} planned assets`];
  return {content,proposal,risk,claims,verified,gaps,blockers,recommendation,score,sourceScore:sourceAudit.score,dimensions,findings,duplicateStatus,contract:qc,ready:recommendation==='PRODUCE'&&blockers.length===0,mode:'AI_CHECKED_NOT_HUMAN_APPROVED',humanApproved:false};
}
export function nextProductionAction(assessment,{manifest={entries:[]},images={},assets={},plan=[],visualReviewed=false}={}){
  if(assessment.duplicateStatus==='HOLD_DUPLICATE')return {kind:'CANONICAL',label:'View Better Version',detail:'Duplicate · use the canonical content'};
  if(assessment.gaps.length)return {kind:'FACT',label:'View Missing Information',detail:assessment.gaps[0]};
  if(!assessment.verified)return {kind:'CLAIM',label:'Verify Claim',detail:`${assessment.risk.tier} RISK · check the affected claim`};
  if(assessment.recommendation==='SKIP')return {kind:'NEXT',label:'Next Content →',detail:'Skipped · choose the next strong item'};
  if(!assessment.ready)return {kind:'IMPROVE',label:'Auto Improve',detail:'Improve the source presentation'};
  const required=manifest.entries.filter(e=>e.required),missing=required.find(e=>!images[e.slotId]||images[e.slotId].semanticKey!==e.semanticKey||images[e.slotId].qc?.status!=='PASS');
  if(missing){const count=required.filter(e=>images[e.slotId]?.semanticKey===e.semanticKey&&images[e.slotId]?.qc?.status==='PASS').length;return {kind:'IMAGES',label:count?'Continue Images →':'Generate Images →',detail:`${count}/${required.length} ready · next ${String(missing.sequence).padStart(2,'0')} ${missing.label}`,slotId:missing.slotId};}
  if(!plan.length||plan.some(a=>!assets[a.asset_id]||assets[a.asset_id].stale||assets[a.asset_id].qc_status!=='PASS'))return {kind:'BUILD',label:'Build Final Assets →',detail:'Images complete · build the post'};
  if(!visualReviewed)return {kind:'FINAL',label:'View Final Post →',detail:'Final preview · Looks Good or fix the affected image'};
  return {kind:'DOWNLOAD',label:'Download Post Package',detail:'READY TO DOWNLOAD'};
}
export function canImport(assessment){return assessment.contract.failures.length===0;}

export function duplicateAssignments(map){
  const assignments={...(map?.assignments||{})};
  for(const group of map?.groups||[]){const canonicalKey=`${Number(group.canonical.sheetId)}:${group.canonical.contentId}`;assignments[canonicalKey]={status:'CANONICAL',canonicalKey};for(const duplicate of group.duplicates||[])assignments[`${Number(duplicate.sheetId)}:${duplicate.contentId}`]={status:'HOLD_DUPLICATE',canonicalKey};}
  return assignments;
}
