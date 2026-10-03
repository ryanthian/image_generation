import {readFile,writeFile} from 'node:fs/promises';
import {normalizeContentRecord,runContentQc,runEditorialReview,deriveGenerationReadiness,buildGenerationManifest,matchGenerationSlot} from '../src/content-model.mjs';
import {classifyClaimRisk,applyEditorialWork,sourceFingerprint} from '../src/editorial-pipeline.mjs';
import {productionGates,exportEntries,createZip} from '../src/production-core.mjs';

const selections=[{sheetId:2026091901,contentId:'EN-NEW-009',label:'Draft 20'},{sheetId:812541719,contentId:'EN-NEW-022',label:'Draft 100'},{sheetId:433728120,contentId:'GS-V4-SG-002',label:'V4'}];
const results=[];
for(const selected of selections){
  const snapshot=JSON.parse(await readFile(`output/audit/source-${selected.sheetId}.json`,'utf8'));
  const raw=snapshot.records.find(row=>row.Content_ID===selected.contentId);if(!raw)throw Error(`Missing captured source ${selected.contentId}`);
  const source=normalizeContentRecord(raw),contract=runContentQc(source),risk=classifyClaimRisk(source);
  const fixtureReview={...source.editorialReview,review_status:'PASS',reviewer:'ISOLATED DRY-RUN FIXTURE; NOT A HUMAN APPROVAL',reviewed_at:'2026-10-03T00:00:00.000Z',audience_need:'家庭读者需要清楚可操作的内容步骤和判断标准',reader_value:'根据来源内容提供明确步骤或检查点',evidence_type:risk.tier==='LOW'?'SOURCE_INTERNAL':'SOURCE_DIRECT',evidence:{type:risk.tier==='LOW'?'SOURCE_INTERNAL':'SOURCE_DIRECT',references:risk.tier==='LOW'?[]:['DRY-RUN FIXTURE ONLY; not verified for publication'],notes:''},source_evidence_status:risk.tier==='LOW'?'INTERNAL_REVIEWED':'VERIFIED',internal_consistency_checked:true,caption_review_status:'PASS',reader_facing_copy_reviewed:true,internal_note_leakage:false,claim_safety_ok:true};
  const hash=await sourceFingerprint(raw),stored={status:'PASS',review:{decision:'APPROVED',sourceFingerprint:hash,proposal:{title:source.title,hook:source.hookText,body:source.contentBody,caption:source.caption},editorial:fixtureReview}};
  const resolved=applyEditorialWork(source,stored,hash).content,editorial=runEditorialReview(resolved),generation=deriveGenerationReadiness(resolved,{structuralQc:contract,editorialReview:editorial}),manifest=buildGenerationManifest(resolved);
  const matches=manifest.entries.every(entry=>matchGenerationSlot(entry.expectedFilename,manifest)===entry.slotId);
  const syntheticImages=Object.fromEntries(manifest.entries.map(entry=>[entry.slotId,{semanticKey:entry.semanticKey,qc:{status:'PASS'}}]));
  const syntheticAssets=Object.fromEntries(resolved.resolvedAssetPlan.map(item=>[item.asset_id,{blob:new Blob(['PNG fixture']),qc_status:'PASS',stale:false}]));
  const gates=productionGates({contract,editorial,generation,manifest,images:syntheticImages,plan:resolved.resolvedAssetPlan,assets:syntheticAssets,visualReviewed:true,monetization:{status:'HOLD'}});
  const entries=exportEntries(resolved,resolved.resolvedAssetPlan,syntheticAssets),zip=await createZip(entries.map(entry=>({name:entry.filename,blob:entry.blob})));
  const result={...selected,sourceRowsUnchanged:JSON.stringify(raw)===JSON.stringify(source.raw),riskTier:risk.tier,contract:contract.status,editorialFixtureStatus:editorial.status,generationFixtureStatus:generation.status,slots:manifest.entries.length,deterministicFilenameMatching:matches,syntheticGatePass:gates.exportReady,orderedSyntheticZipFiles:entries.map(entry=>entry.filename),syntheticZipBytes:zip.size,realImageValidation:'NOT RUN',humanApproval:'NOT GRANTED',sourceMutation:'NONE'};
  if(contract.failures.length||editorial.status!=='PASS'||!generation.ready||!matches||!gates.exportReady||zip.size===0)throw Error(`${selected.label} dry run failed: ${JSON.stringify(result)}`);
  results.push(result);
}
await writeFile('output/editorial-dry-runs.json',JSON.stringify({generatedAt:new Date().toISOString(),warning:'Fixture review, synthetic image QC, and synthetic ZIP only. No human approval, real image, or Sheet mutation.',results},null,2)+'\n');
console.log(JSON.stringify(results,null,2));
