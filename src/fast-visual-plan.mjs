/** Non-destructive photo economy. Text steps and final information cards stay complete. */
import {buildGenerationManifest} from './content-model.mjs';
export const VISUAL_PLAN_VERSION='FAST_VISUAL_2026-10-04.1';
export const IMAGE_TARGETS={RECIPE:[4,6],DRINK:[4,6],LOCAL_DRINK_HACK:[4,6],SELECTION_GUIDE:[4,6],MISTAKE_FIX:[3,5],KITCHEN_HACK:[3,5],REFERENCE_GUIDE:[3,5],COMPARISON_GUIDE:[3,5],PRODUCT_GUIDE:[3,5],KITCHEN_KNOWLEDGE:[3,5],COLLECTION:[3,5]};
const copy=v=>structuredClone(v),text=v=>String(v||'').trim();
export function resolveFastVisualPlan(source){
 if(source.fastVisualPlan?.version===VISUAL_PLAN_VERSION)return copy(source);
 const content={...source,resolvedAssetPlan:copy(source.resolvedAssetPlan)},plan=content.resolvedAssetPlan,originalManifest=buildGenerationManifest(source),mapping=[],reused=[];
 const recipe=['RECIPE','DRINK','LOCAL_DRINK_HACK'].includes(content.contentType),method=plan.find(a=>a.asset_type==='METHOD'&&a.generation_inputs.length>=3);
 if(recipe&&method){
  const steps=copy(method.method_steps||method.generation_inputs),n=steps.length;
  // Two representative states for ordinary methods; add a third for an independent shaping/batter stage.
  const action=Math.max(0,steps.findIndex(s=>/(?:炒|煎|蒸|烤|煮|拌|炸|sauté|fry|cook|steam|bake)/i.test([s.overlay_text,s.image_prompt].join(' '))));
  let done=steps.findLastIndex(s=>/(?:熟透|达到|测温|金黄|收汁|完成|fully cooked|doneness|finished)/i.test([s.overlay_text,s.image_prompt].join(' ')));if(done<=action)done=n-1;
  const special=steps.findIndex((s,i)=>i>action&&i<done&&/(?:裹粉|挂糊|整形|揉面|打发|batter|shape|knead|whip)/i.test([s.overlay_text,s.image_prompt].join(' ')));
  const indices=[action,...(special>=0?[special]:[]),done].filter((v,i,a)=>a.indexOf(v)===i).sort((a,b)=>a-b);
  const inputs=indices.map((index,i)=>({slot_id:i===0?'fast-cooking':i===indices.length-1?'fast-doneness':'fast-technique',label:i===0?'Cooking':i===indices.length-1?'Doneness':'Technique',image_prompt:`REPRESENTATIVE PHOTO: depict ONLY this source cooking state, not a collage or multiple time stages. ${steps[index].image_prompt}\nSource instruction for the depicted state: ${steps[index].overlay_text||[steps[index].step_heading,steps[index].step_supporting_text].join('\n')}\nOther written method steps will appear separately as Console typography. Do not imply this photo depicts every listed step.`,overlay_text:steps[index].overlay_text,source_role:'REPRESENTATIVE_METHOD_STATE',required:true}));
  method.generation_inputs=inputs;method.method_steps=steps.map((step,index)=>{const group=indices.findIndex((anchor,i)=>index<=Math.floor((anchor+(indices[i+1]??n-1))/2)||i===indices.length-1);return {...step,image_slot_id:inputs[Math.max(0,group)].slot_id};});
  method.method_photo_groups=inputs.map(input=>({slot_id:input.slot_id,step_ids:method.method_steps.filter(s=>s.image_slot_id===input.slot_id).map((s,i)=>s.method_step_id||s.slot_id||`M${i+1}`)}));
  for(const step of method.method_steps)mapping.push({informationId:step.method_step_id||step.slot_id,sourceSlot:step.slot_id,photoSlot:step.image_slot_id,text:step.overlay_text});
 }
 const cover=plan.find(a=>/^(?:COVER|HOOK_COVER|HOOK)$/.test(a.asset_type))?.generation_inputs?.[0];
 // A checklist/summary adds useful typography, but rarely needs a new photograph.
 for(const asset of plan){
  if(!cover||asset.generation_inputs.length!==1)continue;
  const summary=/CHECKLIST|SUMMARY|SAVE_CARD/.test(asset.asset_type),detailText=[asset.purpose,asset.overlay_text,asset.generation_inputs[0].image_prompt].join(' '),uniqueDetail=/(?:interior|cut.open|cross.section|inspect|texture|内部|剖|果肉|纹理|损|裂|虫)/i.test(detailText),decorative=!recipe&&asset.asset_type==='CLOSEUP'&&!uniqueDetail;
  if(summary||decorative){const old=asset.generation_inputs[0];asset.generation_inputs=[];asset.source_input_ids=[cover.slot_id];asset.photo_reuse_reason=summary?'Information is rendered as typography over the existing subject photo.':'The source defines no new instructional state; reuse the established subject.';reused.push({assetId:asset.asset_id,sourceSlot:old.slot_id,photoSlot:cover.slot_id,reason:asset.photo_reuse_reason});}
 }
 const aliases=new Map(reused.map(r=>[r.sourceSlot,r.photoSlot]));for(const a of plan)if(a.source_input_ids)a.source_input_ids=a.source_input_ids.map(id=>aliases.get(id)||id);
 const manifest=buildGenerationManifest(content);
 const target=IMAGE_TARGETS[content.contentType]||[3,5];
 content.fastVisualPlan={version:VISUAL_PLAN_VERSION,previousImageCount:originalManifest.entries.length,imageCount:manifest.entries.length,target,informationLost:[],methodMapping:mapping,reusedPhotos:reused,aboveTargetReason:manifest.entries.length>target[1]?'Distinct source-defined instructional states retained; reducing them would conceal useful visual information.':'',jobs:manifest.entries.map(e=>({slotId:e.slotId,label:e.label,purpose:e.imagePrompt,filename:e.expectedFilename}))};
 return content;
}
/** Source information is independently traceable even when a photo represents multiple text steps. */
export function informationSnapshot(content){return {body:content.contentBody,caption:content.caption,ingredients:content.sourceIngredients,coverage:content.coveragePoints,assets:content.resolvedAssetPlan.map(a=>({id:a.asset_id,text:a.overlay_text,ingredients:a.ingredient_items,steps:(a.method_steps||a.generation_inputs.filter(i=>i.method_step_id||/^m\d+$/i.test(i.slot_id))).map(s=>({id:s.method_step_id||s.slot_id,text:s.overlay_text,heading:s.step_heading,support:s.step_supporting_text}))}))};}
