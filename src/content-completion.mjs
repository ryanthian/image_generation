/** Central source-material → production-content compiler. No provider calls or Sheet writes. */
import {normalizeContentRecord,runContentQc,runEditorialReview,buildGenerationManifest,TEMPLATE_REGISTRY} from './content-model.mjs';
import {classifyClaimRisk} from './editorial-pipeline.mjs';
import {resolveFastVisualPlan} from './fast-visual-plan.mjs';
import {repairProductionSource,recoverySources} from './production-repair.mjs';
export const COMPLETION_VERSION='CONTENT_COMPLETION_2026-10-04.1';
export const MAX_IMPROVEMENT_PASSES=2;
const text=v=>String(v??'').trim();
const generic=/(?:你知道吗[？?！!]?|原来如此[！!]?|一定要收藏[！!]?|赶快分享[！!]?|太实用了[！!]?|学起来[！!]?|记得收藏[！!]?|不容错过[！!]?|解锁美味[！!]?)/g;
function natural(v){return text(v).replace(generic,'').replace(/\n{3,}/g,'\n\n').trim();}
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
export function optimiseContent(source,{iteration=0,compact=true,prepareVisual=true}={}){
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
  caption=[...new Set(caption.split(/\n{2,}/).map(text).filter(Boolean))].join('\n\n');
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
  const prepared={...source,title,hookText:hook,contentBody:body,caption,resolvedAssetPlan:plan,coveragePoints,sourceIngredients};
  const content=prepareVisual?resolveFastVisualPlan(prepared):prepared;
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
const recipeTypes=new Set(['RECIPE','DRINK','LOCAL_DRINK_HACK']);
const actionable=/(?:先|再|检查|观察|挑|选|加入|切|煮|炒|蒸|放|用|量|拌|确认|不要|避免|比较|打开|倒|搅)/;
const canonical=v=>natural(v).replace(/[\s\p{P}\p{S}]/gu,'');
const unique=values=>[...new Map(values.map(v=>[canonical(v),natural(v)]).filter(([k])=>k)).values()];
const genericSource=/(?:用家常材料和清楚步骤完成|按用途和实际差异比较|步骤简单，照着做就可以|用可观察的外观、触感、包装或用途做选择|整理常见文化或民间说法|下次.{0,25}(?:重点|检查|对照|参考)|材料先备齐|材料和步骤.{0,30}(?:对照|图里|准备)|这些说法可以当文化参考|不是谁比较好|都是酸，但香气|步骤简单|先把判断重点看清楚)/;
function contentFacts(content){
 if(content.productionFacts)return content.productionFacts;
 const ingredients=(content.resolvedAssetPlan.find(a=>a.asset_type==='INGREDIENTS')?.ingredient_items||[]).map(i=>typeof i==='string'?i:[i.name,i.quantity].filter(Boolean).join(' '));
 const method=content.resolvedAssetPlan.find(a=>a.asset_type==='METHOD');
 const stepInputs=method?.method_steps||method?.generation_inputs||content.resolvedAssetPlan.filter(a=>['MIX','FINAL'].includes(a.asset_type)).map(a=>({overlay_text:a.overlay_text,step_supporting_text:a.overlay_text}));
 const steps=unique(stepInputs.map(s=>text(s.step_supporting_text)||text(s.overlay_text).split('\n').slice(1).join('\n')||text(s.overlay_text)).filter(s=>actionable.test(s)));
 const title=canonical(content.title),points=unique([...(content.coveragePoints||[]).map(p=>p.text),...content.resolvedAssetPlan.filter(a=>!/COVER|INGREDIENTS|METHOD/.test(a.asset_type)).map(a=>a.overlay_text),...recoverySources(content).filter(e=>/(?:Content_Body|body|Ready_To_Post_Caption|caption|Full_Recipe)$/i.test(e.path)).flatMap(e=>e.text.split(/\n|(?<=[。；])/))]).filter(p=>canonical(p)!==title&&p.length>=8&&!genericSource.test(p)&&!/^#/.test(p));
 return {ingredients,steps,points};
}
/** Fill useful copy from recovered facts, rather than asking users to fill editorial metadata. */
function completePresentation(proposal,{pass=1}={}){
 const content={...proposal.content,resolvedAssetPlan:structuredClone(proposal.content.resolvedAssetPlan)},facts=contentFacts(content),recipe=recipeTypes.has(content.contentType),changes=[],confidence=[];
 const causal=unique([content.contentBody,...facts.steps,...facts.points].flatMap(s=>s.split(/\n|(?<=[。；])/))).filter(s=>/(?:因为|因此|导致|以免|否则|含水|避免|不能单凭|不能保证|不一定)/.test(s));
 let body=natural(content.contentBody),hook=natural(content.hookText),caption=natural(content.caption);
 const weakBody=!body||genericSource.test(body)||body.length<45;
 if(recipe&&facts.ingredients.length&&facts.steps.length>=2&&(!/食材|材料|Ingredients/i.test(body)||!/做法|步骤|Method/i.test(body))){
  body=[body&&!genericSource.test(body)?body:'','食材\n'+facts.ingredients.join('；'),'做法\n'+facts.steps.map((s,i)=>`${i+1}. ${s}`).join('\n'),facts.points.length?'小提醒\n'+facts.points.slice(0,2).join('\n'):''].filter(Boolean).join('\n\n');changes.push('Completed ingredients, ordered method and practical reminders from this record.');
 }else if(!recipe&&weakBody&&facts.points.length>=2){body=[content.title,...facts.points].join('\n\n');changes.push('Completed the guide with the recovered practical points.');}
 const practical=facts.points.find(p=>actionable.test(p)&&p.length>=8&&p.length<=65&&!p.includes('\n'));
 if(!hook||canonical(hook)===canonical(content.title)||genericSource.test(hook)){
  hook=practical|| (recipe&&facts.steps.length?`${content.title}：材料和${facts.steps.length}步做法一次看清`:`${content.title}，先把判断重点看清楚`);
  changes.push('Created a specific opening from the topic and available practical instructions.');
 }
 const action=recipe?facts.steps.join('\n'):facts.points.filter(p=>actionable.test(p)).join('\n');
 const saveValue=recipe?[facts.ingredients.join('；'),facts.steps.at(-1)].filter(Boolean).join('\n'):facts.points.slice(-3).join('\n');
 const cta=recipe?'材料先备齐，做的时候对照这份步骤。':'下次遇到同样的问题，可以按这些重点逐项检查。';
 if(!caption||caption.length<60||genericSource.test(caption)||pass===2&&caption.length>1600){
  // Do not discard a safety/nutrition/price claim just because its wording is weak.
  const originalClaim=classifyClaimRisk(content).tier!=='LOW'?caption:'';
  caption=unique([hook,recipe?body: facts.points.join('\n\n'),originalClaim,cta]).join('\n\n');
  changes.push('Completed the Facebook caption with concrete content and a contextual CTA.');
 }
 content.contentBody=body;content.hookText=hook;content.caption=caption;
 for(const field of ['hookText','caption'])if(content[field]!==proposal.content[field])confidence.push({field,confidence:'AI COMPLETION',basis:'Presentation derived from same-record instructions; no new precision facts.'});
 if(body!==proposal.content.contentBody)confidence.push({field:'contentBody',confidence:'DERIVED',basis:'Reconstructed from explicit same-record ingredients, steps and guide points.'});
 return {...proposal,content,body,hook,caption,what:recipe?`${content.title}；${facts.ingredients.join('；')}`:facts.points[0]||content.title,why:causal.slice(0,2).join('\n'),action,saveValue:saveValue||proposal.saveValue,cta,changes:[...proposal.changes,...changes],completionConfidence:confidence,facts};
}
/** Scores describe visible editorial substance, not predicted engagement or human approval. */
export function evaluateProductionQuality(content,{duplicateStatus='UNIQUE',critical=[]}={}){
 const {ingredients,steps,points}=contentFacts(content),recipe=recipeTypes.has(content.contentType),body=text(content.contentBody),caption=text(content.caption),hook=text(content.hookText),concrete=points.filter(p=>actionable.test(p)||/\d|[×✓]|比|适合|区别|不要|错误|正确/.test(p));
 const count=recipe?steps.length:concrete.length,substance=recipe?ingredients.length>=2&&steps.length>=2:concrete.length>=2;
 const repetition=new Set(points.map(canonical)).size,questionOnly=count===0;
 const dimensions={
  Hook:hook.length>=8&&hook.length<=65&&!genericSource.test(hook)?9:5,
  Usefulness:substance?9:count?6:2,
  'Information Density':recipe?Math.min(10,3+ingredients.length*.5+steps.length*.6):Math.min(10,3+concrete.length*1.2),
  'Save Value':substance&&(recipe||repetition>=2)?9:count?6:2,
  'Share Potential':substance&&body.length>80?8:4,
  Clarity:substance&&caption.length>=60&&caption.length<=2000?9:5,
  Originality:duplicateStatus==='HOLD_DUPLICATE'?1:duplicateStatus==='REWORK'?5:8,
  'Visual Potential':substance&&count>=2?9:3,
  'Natural Chinese':genericSource.test(caption.replace(/下次[^。]*。|材料先备齐[^。]*。/g,''))||generic.test(caption)?4:caption.length>=30?9:5,
  'Factual Coherence':critical.length?2:substance?9:4
 };
 generic.lastIndex=0;
 const weaknesses=[];if(!substance)weaknesses.push('Not enough concrete instructions or decision criteria.');if(dimensions.Hook<8)weaknesses.push('Opening is vague or too long.');if(dimensions.Clarity<8)weaknesses.push('Caption needs useful content and clearer ordering.');if(dimensions['Natural Chinese']<8)weaknesses.push('Caption contains generic placeholder wording.');
 return {score:Math.round(Object.values(dimensions).reduce((sum,n)=>sum+n,0)),dimensions,weaknesses,substance:substance&&!questionOnly,mode:'EXPLAINABLE_EDITORIAL_HEURISTIC_NOT_PERFORMANCE'};
}
function prepareVisuals(content){
 const prepared={...content,resolvedAssetPlan:structuredClone(content.resolvedAssetPlan)},facts=contentFacts(content);
 for(const asset of prepared.resolvedAssetPlan){
  if(!text(asset.overlay_text)||canonical(asset.overlay_text)===canonical(content.title)){
   if(/COVER/.test(asset.asset_type))asset.overlay_text=content.hookText;
   else if(/INGREDIENTS/.test(asset.asset_type))asset.overlay_text=facts.ingredients.join('\n');
   else if(/CHECKLIST|SUMMARY|TIP/.test(asset.asset_type))asset.overlay_text=facts.points.slice(-3).join('\n');
  }
  for(const input of asset.generation_inputs||[]){if(!text(input.image_prompt))input.image_prompt=`Photorealistic ${content.title}. Depict only this production content: ${input.overlay_text||asset.overlay_text||content.title}. Accurate ingredients, objects and stage. No random text, logo or watermark. Do not invent quantities or stages.`;}
 }
 return resolveFastVisualPlan(prepared);
}
/** Accept a normalized record or raw Sheet row. The original raw object is never mutated. */
export function buildProductionContent(record,{duplicateStatus='UNIQUE',claimVerified=false,compact=true,complete=true,iteration=0,maxIterations=MAX_IMPROVEMENT_PASSES}={}){
 let source;
 try{source=record.resolvedAssetPlan?record:normalizeContentRecord(record);}catch(error){
  const detail=`Source could not be normalized safely: ${error.message}`,content={contentId:record.Content_ID||record.content_id||'',title:record.Title||record.Draft_Title||'',contentBody:record.Content_Body||record.Full_Recipe||'',caption:record.Ready_To_Post_Caption||'',resolvedAssetPlan:[],raw:record};
  const repair={autoFixed:[],warnings:[],critical:[{state:'CRITICAL_UNRESOLVED',code:'SOURCE_INVALID',detail}],evidence:[],derivedFields:{},originalPreserved:true};
  return {content,proposal:{content,changes:[]},repair,risk:{tier:'LOW',reasons:[]},claims:[],verified:false,gaps:[detail],blockers:[detail],recommendation:'SKIP',score:0,dimensions:{},quality:{score:0,substance:false,weaknesses:[detail]},contract:{failures:[{code:'SOURCE_INVALID',detail}],warnings:[]},manifest:{entries:[]},ready:false,preparation:{version:COMPLETION_VERSION,stages:['Source analysed'],iterations:0,maxIterations:MAX_IMPROVEMENT_PASSES,history:[],continuation:'NEXT_GOOD_CONTENT',originalPreserved:true},factConfidence:[],findings:[detail],skipReason:'CRITICAL_INFO_MISSING',humanApproved:false};
 }
 const original=JSON.stringify(source.raw),recovered=repairProductionSource(source,{prepareImages:false}),repair=recovered.repair;
 recovered.content.productionFacts=contentFacts(recovered.content);
 let proposal=optimiseContent(recovered.content,{compact,prepareVisual:false}),quality=evaluateProductionQuality(source,{duplicateStatus,critical:repair.critical});
 const history=[{stage:'SOURCE',score:quality.score,weaknesses:quality.weaknesses}],confidence=[...recoverySources(source).map(e=>({field:e.path,confidence:'SOURCE FACT',text:e.text})),...repair.evidence.map(e=>({field:e.path,confidence:'DERIVED',text:e.text}))];
 const limit=Math.max(1,Math.min(MAX_IMPROVEMENT_PASSES,Number(maxIterations)||MAX_IMPROVEMENT_PASSES));
 if(complete)for(let pass=1;pass<=limit;pass++){
  proposal=completePresentation(proposal,{pass});quality=evaluateProductionQuality(proposal.content,{duplicateStatus,critical:repair.critical});confidence.push(...proposal.completionConfidence);history.push({stage:'IMPROVEMENT',iteration:pass,score:quality.score,weaknesses:quality.weaknesses});if(quality.score>=85&&quality.substance)break;
 }
 let content=complete?proposal.content:source;
 const factual=runEditorialReview(content).issues.filter(i=>factualCodes.has(i.code));
 for(const i of factual)if(!repair.critical.some(c=>c.code===i.code))repair.critical.push({...i,state:'CRITICAL_UNRESOLVED',detail:friendly[i.code]?.replace(/^NEEDS FACT: /,'')||i.detail});
 if(!text(content.contentBody))repair.critical.push({state:'CRITICAL_UNRESOLVED',code:'BODY_MISSING',detail:'No useful production content could be recovered.'});
 if(content.editorialReview?.review_status==='BLOCKED')repair.critical.push({state:'CRITICAL_UNRESOLVED',code:'EXPLICIT_SOURCE_BLOCK',detail:'Source is explicitly blocked.'});
 if(/(?:待补|待填写|TODO|TBD|待核实)/i.test(content.contentBody))repair.critical.push({state:'CRITICAL_UNRESOLVED',code:'UNRESOLVED_PLACEHOLDER',detail:'Source contains unresolved factual placeholders.'});
 if(duplicateStatus==='UNASSESSED')repair.critical.push({state:'CRITICAL_UNRESOLVED',code:'DUPLICATES_LOADING',detail:'Checking duplicate status. Wait for content sources to load.'});
 quality=evaluateProductionQuality(content,{duplicateStatus,critical:repair.critical});
 const risk=classifyClaimRisk(content),verified=risk.tier==='LOW'||claimVerified,duplicate=['HOLD_DUPLICATE','REWORK'].includes(duplicateStatus);
 const claims=risk.tier==='LOW'?[]:unique([content.hookText,...text(content.contentBody).split('\n'),...text(content.caption).split('\n'),...content.resolvedAssetPlan.map(a=>a.overlay_text)]).filter(s=>/(?:保存|冷藏|营养|维生素|热量|低脂|RM|治疗|疾病|血糖|血压|抗癌|排毒|保证|导致)/.test(s)).slice(0,8);
 confidence.push(...claims.map(claim=>({field:'claim',confidence:verified?'SOURCE FACT':'UNVERIFIED CLAIM',text:claim})));
 const gaps=[...new Set(repair.critical.map(i=>i.detail))];
 let recommendation=duplicate||gaps.length||!verified?'SKIP':quality.substance&&quality.score>=78?'PRODUCE':complete?'SKIP':'IMPROVE';
 let manifest={entries:[]},contract={failures:[],warnings:[]};
 // No newly generated scene prompts for weak or incomplete production content.
 if(recommendation==='PRODUCE'){
  try{content=prepareVisuals(content);contract=runContentQc(content);manifest=buildGenerationManifest(content);const missing=manifest.entries.filter(e=>e.required&&!text(e.imagePrompt));if(!manifest.entries.length||missing.length||contract.failures.length){gaps.push(...contract.failures.map(i=>i.detail),...missing.map(e=>`Scene for ${e.label} could not be prepared.`));if(!manifest.entries.length)gaps.push('No feasible image slots.');recommendation='SKIP';manifest={entries:[]};}}
  catch(error){gaps.push(`Visual plan unavailable: ${error.message}`);recommendation='SKIP';manifest={entries:[]};}
 }
 if(!complete&&[source.title,source.hookText,source.caption].some(v=>natural(v)!==text(v))&&!gaps.length&&verified&&!duplicate)recommendation='IMPROVE';
 repair.autoFixed.push(...unique(proposal.changes.filter(detail=>!detail.startsWith('Source copy already'))).map(detail=>({state:'AUTO_FIXED',code:'CONTENT_COMPLETED',detail})));
 const blockers=[...gaps];if(duplicate)blockers.unshift('Duplicate: use the canonical record.');if(!verified)blockers.push(`VERIFY CLAIM: ${risk.reasons.join('; ')}`);if(recommendation==='SKIP'&&!blockers.length)blockers.push(...quality.weaknesses,'Content remained below production quality after automatic improvement.');
 const ready=recommendation==='PRODUCE'&&!blockers.length,preparation={version:COMPLETION_VERSION,stages:['Source analysed','Missing information recovered','Content improved','Quality checked',...(ready?['Visual plan prepared']:[])],iterations:history.filter(h=>h.stage==='IMPROVEMENT').length,maxIterations:limit,history,qualityMode:quality.mode,continuation:ready?'GENERATE_IMAGES':recommendation==='IMPROVE'?'AUTO_IMPROVE':'NEXT_GOOD_CONTENT',originalPreserved:original===JSON.stringify(source.raw)};
 return {content,proposal:{...proposal,content},repair,risk,claims,verified,gaps,blockers,recommendation,score:quality.score,dimensions:quality.dimensions,quality,contract,manifest,ready,preparation,factConfidence:confidence,findings:[ready?'✓ Production content prepared':blockers[0],`✓ Quality ${quality.score}/100`,ready?`✓ ${manifest.entries.length} images · ${content.resolvedAssetPlan.length} planned assets`:'Continue with the next suitable item'],skipReason:duplicate?'DUPLICATE':gaps.length?'CRITICAL_INFO_MISSING':!verified?'HIGH_RISK_UNVERIFIED':recommendation==='SKIP'?'LOW_QUALITY':null,humanApproved:false};
}
