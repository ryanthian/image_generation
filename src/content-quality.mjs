/** Explainable heuristic audit. Scores are not measured performance or human approval. */
const clean=v=>String(v||'').normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]/gu,'');
export function auditContent(content,{duplicateSignals=[]}={}) {
  const body=String(content.contentBody||''),caption=String(content.caption||''),hook=String(content.hookText||content.title||'');
  const plan=content.resolvedAssetPlan||[],metadata=content.editorialReview||{};
  const copy=[hook,caption,...plan.map(a=>a.overlay_text||'')].join('\n');
  const action=/(?:先|再|检查|观察|挑|选|放|加入|切|煮|炒|蒸|冷藏|避免|不要)/.test(body+copy);
  const why=/(?:因为|因此|原因|导致|以免|才会|否则|容易|防止)/.test(body+copy) || !!metadata.cause_explanation;
  const bait=/(?:留言[「“"']?\d|转发.{0,8}(?:好运|中奖)|不转不是|赶快分享|点赞.{0,8}才)/.test(copy);
  const ai=/(?:你知道吗|原来如此|赶快分享|记得收藏|不容错过|颠覆你的认知|解锁美味)/g;
  const generic=(copy.match(ai)||[]).length;
  const risky=/(?:治愈|治疗|降血糖|排毒|保证瘦|百分百|保证赚钱|guaranteed)/i.test(copy);
  const price=/RM\s*\d|省下\s*\d|\d+%/.test(copy) && !content.priceClaim?.verified;
  const evidence=metadata.source_evidence_status==='VERIFIED' && (metadata.evidence?.references?.length || metadata.claim_evidence);
  const distinct=new Set(plan.filter(a=>a.asset_type!=='COVER').map(a=>clean(a.overlay_text))).size;
  const dimensions={
    hook_quality:{max:10,score:hook.length>=8 && hook.length<=65 && generic===0?9:hook?5:0},
    usefulness:{max:10,score:body.length>80 && action?9:action?6:2},
    save_value:{max:10,score:action && /\d|步骤|检查|标准|食材|做法/.test(body+copy)?9:action?6:2},
    share_value:{max:5,score:body.length>80 && !bait?4:2},
    uniqueness:{max:10,score:duplicateSignals.some(s=>s.kind==='body'||s.kind==='recipe')?1:duplicateSignals.length?5:8},
    clarity:{max:10,score:action && hook && caption?9:5},
    information_density:{max:10,score:distinct>=Math.max(2,plan.length-1) && why?9:distinct>=2?7:3},
    visual_potential:{max:5,score:plan.every(a=>a.generation_inputs?.length || a.source_input_ids?.length)?4:1},
    caption_quality:{max:10,score:caption.length>=30 && caption.length<=2000 && !bait?9:caption?5:0},
    source_claim_quality:{max:10,score:risky||price?0:evidence?9:content.source?5:1},
    repetition:{max:3,score:duplicateSignals.length?0:3},
    natural_language:{max:3,score:Math.max(0,3-generic)},
    monetisation_fit:{max:3,score:!risky&&!bait&&!price?3:0},
    affiliate_fit:{max:1,score:1,note:content.affiliateFit && content.affiliateFit!=='NONE'?'Declared fit; no conversion prediction.':'Not applicable; no affiliate placement required.'}
  };
  const score=Object.values(dimensions).reduce((sum,d)=>sum+d.score,0);
  const issues=[];
  if(!why)issues.push({code:'WHY_NOT_EXPLICIT',repair:'Explain the reason only if supported by the existing source; otherwise request evidence.'});
  if(!action)issues.push({code:'ACTION_MISSING',repair:'Add an actionable step supported by the source.'});
  if(!evidence)issues.push({code:'SOURCE_REVIEW_REQUIRED',repair:'Verify the cited source and claims; the presence of a URL is not verification.'});
  if(risky||price)issues.push({code:'CLAIM_REVIEW_REQUIRED',repair:'Verify or remove unsupported health, price or absolute claims before posting.'});
  if(bait||generic)issues.push({code:'GENERIC_OR_BAIT_COPY',repair:'Use a specific reader benefit or a contextual CTA; retain factual details.'});
  if(duplicateSignals.length)issues.push({code:'DUPLICATE_REVIEW',repair:'Compare the linked records; rework the treatment without deleting source rows.'});
  const status=risky||price||bait||score<70?'HOLD':score>=85?'READY':'NEEDS IMPROVEMENT';
  return {contentId:content.contentId,title:content.title,score,status,mode:'HEURISTIC_NOT_PERFORMANCE',dimensions,issues,duplicateSignals,whatWhyAction:{what:!!hook,why,action},humanEditorialApproval:metadata.review_status==='PASS',guaranteesMonetisation:false};
}
function similarity(a,b){const grams=s=>new Set(Array.from({length:Math.max(0,s.length-1)},(_,i)=>s.slice(i,i+2)));const x=grams(a),y=grams(b);if(!x.size||!y.size)return 0;return 2*[...x].filter(v=>y.has(v)).length/(x.size+y.size);}
export function findDuplicates(records){
  const pairs=[];
  const prepared=records.map(r=>({...r,titleKey:clean(r.content.title),bodyKey:clean(r.content.contentBody),hookKey:clean(r.content.hookText),captionKey:clean(r.content.caption),conceptKey:clean(r.content.resolvedAssetPlan.flatMap(a=>a.generation_inputs.map(i=>i.image_prompt)).join(' '))}));
  for(let i=0;i<prepared.length;i++)for(let j=i+1;j<prepared.length;j++){
    const a=prepared[i],b=prepared[j],kinds=[];
    if(a.titleKey && a.titleKey===b.titleKey)kinds.push('title');else if(similarity(a.titleKey,b.titleKey)>=.84)kinds.push('near-title');
    if(a.bodyKey.length>35 && a.bodyKey===b.bodyKey)kinds.push(a.content.contentType==='RECIPE'?'recipe':'body');
    if(a.hookKey.length>12 && a.hookKey===b.hookKey)kinds.push('hook');
    if(a.captionKey.length>35 && similarity(a.captionKey,b.captionKey)>.9)kinds.push('caption');
    if(a.conceptKey.length>60 && a.conceptKey===b.conceptKey)kinds.push('asset-concept');
    if(!kinds.length)continue;
    const rank=r=>r.bodyKey.length + r.captionKey.length + (r.content.source?100:0);
    const keep=rank(a)>=rank(b)?a:b,other=keep===a?b:a;
    pairs.push({kinds,left:{source:a.source,contentId:a.content.contentId},right:{source:b.source,contentId:b.content.contentId},recommendations:[{source:keep.source,contentId:keep.content.contentId,action:'KEEP'},{source:other.source,contentId:other.content.contentId,action:kinds.includes('body')||kinds.includes('recipe')?'HOLD':'REWORK'}],basis:'Heuristic completeness and textual similarity; human comparison required. No rows removed.'});
  }return pairs;
}
