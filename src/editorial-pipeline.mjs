/** Editorial preparation and review primitives. Source rows are never changed here. */
const text = value => String(value ?? '').trim();
export const recordKey = (sheetId, contentId) => `${Number(sheetId)}:${text(contentId)}`;

export function classifyClaimRisk(content) {
  const copy = [content.title, content.hookText, content.contentBody, content.caption,
    ...(content.resolvedAssetPlan || []).map(item => item.overlay_text)].join(' ');
  const reasons = [];
  if (/(?:治疗|治愈|预防.{0,8}疾病|降血糖|降血压|抗癌|排毒|保证瘦|medical treatment|cure|guaranteed returns)/i.test(copy)) reasons.push('Medical, disease, or strong regulated claim');
  if (reasons.length) return {tier:'HIGH',reasons};
  if (/(?:保存|冷藏|冷冻|保鲜).{0,24}(?:\d+\s*(?:天|日|小时|周)|安全|不会坏)|(?:\d+\s*(?:天|日|小时|周)).{0,24}(?:保存|冷藏|冷冻|保鲜)/.test(copy)) reasons.push('Specific storage duration or safety claim');
  if (content.contentType === 'STORAGE_GUIDE') reasons.push('Food-storage guidance');
  if (/(?:营养|蛋白质|维生素|低糖|低脂|卡路里|热量|省下|节省|便宜\s*\d|RM\s*\d|\d+\s*%)/i.test(copy)) reasons.push('Nutrition, cost, savings, or numerical claim');
  if (content.contentType === 'KITCHEN_KNOWLEDGE' || content.contentType === 'MISTAKE_FIX') reasons.push('Technical or causal explanation');
  return reasons.length ? {tier:'MEDIUM',reasons} : {tier:'LOW',reasons:['Ordinary cooking or visual guidance; reviewer must still check consistency and safety.']};
}

export async function sourceFingerprint(raw) {
  const semantic = Object.fromEntries(Object.entries(raw || {}).filter(([key]) => !/^(?:Status|Lifecycle_Status|Posted_At)$/i.test(key)).sort(([a],[b])=>a.localeCompare(b)));
  const bytes = new TextEncoder().encode(JSON.stringify(semantic));
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256',bytes));
  return Array.from(hash,b=>b.toString(16).padStart(2,'0')).join('');
}

export function applyEditorialWork(content, stored, fingerprint) {
  if (!stored?.review) return {content,work:null,stale:false};
  const work=stored.review;
  const stale=work.sourceFingerprint !== fingerprint;
  if(stale || work.decision!=='APPROVED' || stored.status!=='PASS') return {content,work,stale};
  const proposal=work.proposal||{};
  const resolved={...content,title:text(proposal.title)||content.title,hookText:text(proposal.hook)||content.hookText,
    contentBody:text(proposal.body)||content.contentBody,caption:text(proposal.caption)||content.caption,
    editorialReview:work.editorial||{},editorialReviewPresent:true,editorialReviewParseError:''};
  return {content:resolved,work,stale:false};
}

export function prepareEditorialProposal(content) {
  const body=text(content.contentBody),caption=text(content.caption),hook=text(content.hookText)||text(content.title);
  const sentences=body.split(/(?<=[。！？；;])|\n/).map(text).filter(Boolean);
  const supporting=[...sentences,...caption.split(/[。！？\n]/).map(text),...(content.resolvedAssetPlan||[]).map(item=>text(item.overlay_text))].filter(Boolean);
  const why=supporting.filter(s=>/(?:因为|原因|所以|导致|容易|否则|以免|避免|防止|含水|口感|更容易|不能单凭|不能保证|不一定|才会|刚熟)/.test(s)).slice(0,2).join(' ');
  const action=sentences.filter(s=>/(?:先|再|检查|观察|挑|选|加入|切|煮|炒|蒸|放|用|保持|避免|不要)/.test(s)).slice(0,4).join(' ');
  const what=sentences[0]||text(content.title);
  const risk=classifyClaimRisk(content);
  const questions=[];
  if(!why)questions.push('WHY: source has no explicit supported explanation; verify before adding one.');
  if(!action)questions.push('ACTION: confirm a concrete step or decision from the source.');
  if(risk.tier!=='LOW')questions.push(`Verify supporting evidence for ${risk.reasons.join('; ')}.`);
  const issues=[];
  if(!caption)issues.push('Caption is missing.');
  if(!body)issues.push('Content body is missing.');
  const captionAlreadyNamesTitle=caption.startsWith(`#${text(content.title)}`)||caption.startsWith(text(content.title));
  const normalizedCaption=caption && hook.length>=12 && !caption.startsWith(hook) && !captionAlreadyNamesTitle ? `${hook}\n\n${caption}` : caption;
  const finalCard=(content.resolvedAssetPlan||[]).find(item=>/CHECKLIST|TIPS|SUMMARY/.test(item.asset_type||''));
  return {title:text(content.title),hook,body,caption:normalizedCaption,what,why,action,
    saveValue:text(finalCard?.overlay_text)||text(action.slice(0,100))||'Confirm a source-backed checklist before production.',
    changes:normalizedCaption!==caption?['Placed the existing hook before the unchanged source caption.']:['Preserved source wording; no unsupported factual rewrite.'],
    questions,issues,riskTier:risk.tier,sourceReferences:text(content.sourceReferences||content.source),
    assetPlan:(content.resolvedAssetPlan||[]).map(item=>({sequence:item.sequence,assetId:item.asset_id,type:item.asset_type,title:item.title,overlayText:item.overlay_text,slotIds:(item.generation_inputs||[]).map(input=>input.slot_id)}))};
}

export function buildCanonicalMap(rows,pairs) {
  const byNameId=new Map(rows.map(row=>[`${row.source}:${row.contentId}`,row]));
  const parent=new Map(rows.map(row=>[recordKey(row.sheetId,row.contentId),recordKey(row.sheetId,row.contentId)]));
  const find=key=>{let p=parent.get(key);if(p!==key){p=find(p);parent.set(key,p);}return p;};
  const join=(a,b)=>{const x=find(a),y=find(b);if(x!==y)parent.set(y,x);};
  const strong=p=>p.kinds.includes('recipe')||p.kinds.includes('body')||(p.kinds.includes('title')&&(p.kinds.includes('caption')||p.kinds.includes('asset-concept')));
  const weak=[];
  for(const pair of pairs){const left=byNameId.get(`${pair.left.source}:${pair.left.contentId}`),right=byNameId.get(`${pair.right.source}:${pair.right.contentId}`);if(!left||!right)continue;
    if(strong(pair))join(recordKey(left.sheetId,left.contentId),recordKey(right.sheetId,right.contentId));
    else weak.push({...pair,recommendedTreatment:'REWORK',reason:'Textual similarity requires human comparison; no automatic duplicate hold.'});}
  const groups=new Map();for(const row of rows){const key=find(recordKey(row.sheetId,row.contentId));if(!groups.has(key))groups.set(key,[]);groups.get(key).push(row);}
  const canonicalGroups=[],assignments={};
  for(const members of groups.values()){if(members.length<2)continue;
    const rank=row=>row.score+(row.editorialStatus==='PASS'?15:0)+(row.bodyLength||0)/200+(row.captionLength||0)/400-(row.issueCodes||[]).filter(code=>/MISSING|INVALID|UNSUPPORTED/.test(code)).length*2;
    members.sort((a,b)=>rank(b)-rank(a)||recordKey(a.sheetId,a.contentId).localeCompare(recordKey(b.sheetId,b.contentId)));
    const canonical=members[0],canonicalKey=recordKey(canonical.sheetId,canonical.contentId);
    const memberKeys=new Set(members.map(row=>recordKey(row.sheetId,row.contentId)));
    const signals=pairs.filter(pair=>{const a=byNameId.get(`${pair.left.source}:${pair.left.contentId}`),b=byNameId.get(`${pair.right.source}:${pair.right.contentId}`);return a&&b&&memberKeys.has(recordKey(a.sheetId,a.contentId))&&memberKeys.has(recordKey(b.sheetId,b.contentId))&&strong(pair);}).flatMap(p=>p.kinds);
    canonicalGroups.push({canonical:{sheetId:canonical.sheetId,source:canonical.source,contentId:canonical.contentId,title:canonical.title},duplicates:members.slice(1).map(row=>({sheetId:row.sheetId,source:row.source,contentId:row.contentId,title:row.title,treatment:'HOLD_DUPLICATE'})),signals:[...new Set(signals)],reason:'Strong title/body/recipe/caption evidence; chosen by completeness, review status and source detail. Human confirmation is still required.'});
    assignments[canonicalKey]={status:'CANONICAL',canonicalKey};for(const row of members.slice(1))assignments[recordKey(row.sheetId,row.contentId)]={status:'HOLD_DUPLICATE',canonicalKey};
  }
  return {groups:canonicalGroups.sort((a,b)=>a.canonical.contentId.localeCompare(b.canonical.contentId)),assignments,reviewPairs:weak};
}

export function queuePriority(row) {
  const d=row.dimensions||{},score=key=>d[key]?.score||0;
  const risk=row.riskTier||'LOW';
  return score('usefulness')*2+score('save_value')*2+score('share_value')*2+score('visual_potential')*2+score('information_density')*2+score('clarity')+score('hook_quality')+score('caption_quality')
    -(risk==='HIGH'?35:risk==='MEDIUM'?10:0)-(row.duplicateStatus==='HOLD_DUPLICATE'?100:0)-(row.issueCodes||[]).filter(code=>/RECIPE_(?:INGREDIENTS|QUANTITIES|METHOD)_|INTERNAL_NOTE|UNSUPPORTED/.test(code)).length*12;
}
