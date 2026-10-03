import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {normalizeContentRecord,runContentQc,buildGenerationManifest,buildSessionPrompt,buildSlotPrompt} from '../src/content-model.mjs';
import {buildCanonicalMap,classifyClaimRisk,prepareEditorialProposal,queuePriority,recordKey} from '../src/editorial-pipeline.mjs';
const audit=JSON.parse(await readFile('output/content-quality-audit.json','utf8'));
const rows=[],byKey=new Map();
for(const source of audit.sources){const snapshot=JSON.parse(await readFile(`output/audit/source-${source.sheetId}.json`,'utf8'));
  const byId=new Map(source.records.map(row=>[row.contentId,row]));
  for(const raw of snapshot.records){const content=normalizeContentRecord(raw),quality=byId.get(content.contentId);if(!quality)throw Error(`Audit missing ${source.sheetId}:${content.contentId}`);
    const row={...quality,sheetId:source.sheetId,source:source.name,content,bodyLength:content.contentBody.length,captionLength:content.caption.length,riskTier:classifyClaimRisk(content).tier};
    rows.push(row);byKey.set(recordKey(row.sheetId,row.contentId),row);
  }}
const canonical=buildCanonicalMap(rows,audit.duplicates);
const canonicalOutput={generatedAt:new Date().toISOString(),sourceAuditCommit:'c0d29224cb4974e9124c550baf127aa1df5c0dd4',candidatePairs:audit.duplicates.length,strongGroups:canonical.groups.length,heldDuplicates:Object.values(canonical.assignments).filter(x=>x.status==='HOLD_DUPLICATE').length,groups:canonical.groups,reviewPairs:canonical.reviewPairs};
const md=['# Canonical content map — 2026-10-03','','Strong duplicate evidence produces a proposed canonical record and HOLD_DUPLICATE recommendation. Caption-only or near-title similarities remain REWORK review candidates. No source row was deleted or edited.','','| Canonical | Held duplicates | Signals | Reason |','|---|---|---|---|'];
for(const group of canonical.groups)md.push(`| ${group.canonical.source}: ${group.canonical.contentId} | ${group.duplicates.map(x=>`${x.source}: ${x.contentId}`).join('<br>')} | ${group.signals.join(', ')} | ${group.reason} |`);
md.push('',`Weak review pairs: ${canonical.reviewPairs.length}; all pairs and treatments are in the JSON map.`,'');
const eligible=rows.filter(row=>{
  const codes=new Set([...row.issueCodes,...row.editorialIssueCodes]);
  const scaffold=/(?:用可观察的外观、触感、包装或用途做选择|按用途和实际差异比较|用“错误做法 → 原因 → 正确做法 → 成品”解释|步骤简单，照着做就可以)/.test(row.content.contentBody+' '+row.content.caption);
  return canonical.assignments[recordKey(row.sheetId,row.contentId)]?.status!=='HOLD_DUPLICATE'
    && ['RECIPE','DRINK','LOCAL_DRINK_HACK','SELECTION_GUIDE','MISTAKE_FIX','STORAGE_GUIDE','KITCHEN_HACK','KITCHEN_KNOWLEDGE','COMPARISON'].includes(row.content.contentType)
    && row.content.lifecycleStatus!=='Posted' && row.content.lifecycleStatus!=='PUBLISHED'
    && row.riskTier!=='HIGH' && runContentQc(row.content).failures.length===0
    && row.bodyLength>25 && row.captionLength>35 && !scaffold
    && ![...codes].some(code=>/RECIPE_(?:QUANTITIES|INGREDIENTS|METHOD)_|INTERNAL_NOTE_(?:IN_SOURCE_BODY|IN_READER_COPY|LEAKAGE_CONFIRMED)|UNSUPPORTED_BENEFIT|CLAIM_SAFETY_FAILED/.test(code));
}).map(row=>({...row,duplicateStatus:canonical.assignments[recordKey(row.sheetId,row.contentId)]?.status||'UNIQUE'}));
eligible.sort((a,b)=>queuePriority(b)-queuePriority(a)||b.score-a.score||recordKey(a.sheetId,a.contentId).localeCompare(recordKey(b.sheetId,b.contentId)));
const quotas={RECIPE:12,SELECTION_GUIDE:1,LOCAL_DRINK_HACK:3,DRINK:1,STORAGE_GUIDE:2,KITCHEN_HACK:1};
const selected=[],used=new Set();
const isWeakCopy=row=>canonical.reviewPairs.some(pair=>{const a=rows.find(x=>x.source===pair.left.source&&x.contentId===pair.left.contentId),b=rows.find(x=>x.source===pair.right.source&&x.contentId===pair.right.contentId);const key=recordKey(row.sheetId,row.contentId);return a&&b&&(recordKey(a.sheetId,a.contentId)===key&&used.has(recordKey(b.sheetId,b.contentId))||recordKey(b.sheetId,b.contentId)===key&&used.has(recordKey(a.sheetId,a.contentId)));});
for(const [type,count] of Object.entries(quotas))for(const row of eligible.filter(x=>x.content.contentType===type)){if(selected.filter(x=>x.content.contentType===type).length>=count)break;const key=recordKey(row.sheetId,row.contentId);if(!used.has(key)&&!isWeakCopy(row)){selected.push(row);used.add(key);}}
for(const row of eligible){if(selected.length>=20)break;const key=recordKey(row.sheetId,row.contentId);if(!used.has(key)&&!isWeakCopy(row)){selected.push(row);used.add(key);}}
if(selected.length!==20)throw Error(`Only ${selected.length} viable candidates for Batch 01.`);
selected.sort((a,b)=>queuePriority(b)-queuePriority(a)||b.score-a.score);
const items=selected.map((row,index)=>{
  const c=row.content,proposal=prepareEditorialProposal(c),manifest=buildGenerationManifest(c);
  const questions=[...proposal.questions];
  if(row.issueCodes.includes('SOURCE_REVIEW_REQUIRED'))questions.push(row.riskTier==='LOW'?'Human consistency and safe-claim review required; an academic URL is not automatically needed.':'Verify a supporting source for the medium-risk claim.');
  const output={batchOrder:index+1,sheetId:row.sheetId,source:row.source,contentId:row.contentId,contentType:c.contentType,template:c.templateType,score:row.score,queuePriority:queuePriority(row),contentStatus:row.status,preparationStatus:'AI_PREPARED',humanApprovalStatus:'NOT_APPROVED',riskTier:row.riskTier,
    original:{title:c.title,hook:c.hookText,body:c.contentBody,caption:c.caption,sourceReferences:c.sourceReferences||c.source},
    proposed:{title:proposal.title,hook:proposal.hook,body:proposal.body,caption:proposal.caption,what:proposal.what,why:proposal.why,action:proposal.action,saveValue:proposal.saveValue},
    readerValue:(proposal.action||proposal.what).slice(0,140),changesMade:proposal.changes,issuesResolved:proposal.changes,remainingFactualQuestions:[...new Set(questions)],sourceEvidenceStatus:c.editorialReview?.source_evidence_status||'UNVERIFIED',duplicateStatus:row.duplicateStatus,
    assetPlan:proposal.assetPlan,imageGenerationSlots:manifest.entries.map(entry=>({sequence:entry.sequence,slotId:entry.slotId,role:entry.assetType,expectedFilename:entry.expectedFilename,prompt:buildSlotPrompt(c,entry.slotId)})),
    masterSessionPrompt:buildSessionPrompt(c),finalAssetOrder:c.resolvedAssetPlan.map(item=>({sequence:item.sequence,assetId:item.asset_id,type:item.asset_type,title:item.title}))};
  return output;
});
const batch={generatedAt:new Date().toISOString(),name:'PRODUCTION BATCH 01',selection:'Ranked useful, visually strong, lower-risk non-duplicate candidates with format diversity; source facts preserved.',count:items.length,aiPrepared:items.length,humanApproved:0,needsFix:0,items};
await mkdir('output',{recursive:true});
await writeFile('output/canonical-content-map.json',JSON.stringify(canonicalOutput,null,2)+'\n');
await writeFile('output/canonical-content-map.md',md.join('\n'));
await writeFile('output/production-batch-01.json',JSON.stringify(batch,null,2)+'\n');
let bm='# Production Batch 01 — AI prepared, awaiting human review\n\nTwenty ranked, non-held candidates. No AI-prepared text is human-approved. Source quantities and claims were not invented.\n\n';
for(const item of items){bm+=`## ${String(item.batchOrder).padStart(2,'0')} · ${item.contentId} · ${item.proposed.title}\n\n- Source: ${item.source} (sheetId ${item.sheetId}); ${item.contentType}; score ${item.score}; risk ${item.riskTier}; ${item.preparationStatus}; ${item.humanApprovalStatus}.\n- Reader value: ${item.readerValue}\n- Hook: ${item.proposed.hook}\n- WHAT: ${item.proposed.what}\n- WHY: ${item.proposed.why||'Unresolved; do not invent.'}\n- ACTION: ${item.proposed.action||'Unresolved; do not invent.'}\n- Save value: ${item.proposed.saveValue}\n- Changes: ${item.changesMade.join('; ')}\n- Open questions: ${item.remainingFactualQuestions.join('; ')||'Human source and visual review still required.'}\n- Asset order: ${item.finalAssetOrder.map(x=>`${x.sequence} ${x.type}`).join(' → ')}\n- Image slots: ${item.imageGenerationSlots.map(x=>x.expectedFilename).join(', ')}\n\n**Proposed caption**\n\n${item.proposed.caption}\n\n**Content body**\n\n${item.proposed.body}\n\n**Asset plan and overlays**\n\n${item.assetPlan.map(asset=>`- ${asset.sequence} ${asset.type}: ${asset.title}; overlay: ${asset.overlayText.replaceAll('\n',' / ')}`).join('\n')}\n\n**Master ChatGPT session prompt**\n\n\x60\x60\x60text\n${item.masterSessionPrompt}\n\x60\x60\x60\n\n${item.imageGenerationSlots.map(slot=>`**${slot.expectedFilename} · slot ${slot.slotId}**\n\n\x60\x60\x60text\n${slot.prompt}\n\x60\x60\x60`).join('\n\n')}\n\n`;}
await writeFile('output/production-batch-01.md',bm.split('\n').map(line=>line.trimEnd()).join('\n').trimEnd()+'\n');
console.log(JSON.stringify({canonicalGroups:canonical.groups.length,held:canonicalOutput.heldDuplicates,weakPairs:canonical.reviewPairs.length,batch:items.map(x=>({id:x.contentId,type:x.contentType,score:x.score,risk:x.riskTier,questions:x.remainingFactualQuestions.length}))},null,2));
