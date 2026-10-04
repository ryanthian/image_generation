/** Real-corpus release gate. Read-only snapshots captured from all connected production Sheets. */
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {normalizeContentRecordsSafely,buildGenerationManifest} from '../src/content-model.mjs';
import {applyEditorialWork} from '../src/editorial-pipeline.mjs';
import {assessProduction,duplicateAssignments,findNextProductionReadyContent} from '../src/production-assistant.mjs';
import {createProductionBatch,resolveProductionBatch} from '../src/batch-production.mjs';
import {buildProductionContent,MAX_IMPROVEMENT_PASSES} from '../src/content-completion.mjs';
const directory=process.env.COMPLETION_SNAPSHOT_DIR||'output/content-completion';
const map=JSON.parse(await readFile('output/canonical-content-map.json')),canonical=duplicateAssignments(map),rework=new Set((map.reviewPairs||[]).flatMap(p=>[p.left,p.right].map(i=>`${i.source}:${i.contentId}`))),rows=[],sources=[],details=[];
for(const sheetId of [2026091901,812541719,433728120]){
 const data=JSON.parse(await readFile(`${directory}/source-${sheetId}.json`)),raw=data.records||data.recipes,before=JSON.stringify(raw),normalized=normalizeContentRecordsSafely(raw);assert.equal(normalized.rejected.length,0);
 for(const source of normalized.records){
  const work=data.editorialWork?.[source.contentId],content=applyEditorialWork(source,work?.stale?null:work,work?.review?.sourceFingerprint).content,duplicateStatus=canonical[`${sheetId}:${content.contentId}`]?.status||(rework.has(`${data.sourceState?.title||data.sheetName}:${content.contentId}`)?'REWORK':'UNIQUE'),assessment=assessProduction(content,{duplicateStatus});
  assert.equal(assessment.preparation.originalPreserved,true);assert.ok(assessment.preparation.iterations<=MAX_IMPROVEMENT_PASSES);assert.equal(assessment.humanApproved,false);
  if(assessment.ready){assert.equal(assessment.recommendation,'PRODUCE');assert.equal(assessment.gaps.length,0);assert.ok(assessment.quality.substance);assert.ok(buildGenerationManifest(assessment.content).entries.length);assert.ok(assessment.manifest.entries.every(e=>e.imagePrompt));}
  else{assert.ok(['SKIP','IMPROVE'].includes(assessment.recommendation));assert.equal(assessment.preparation.continuation,assessment.recommendation==='IMPROVE'?'COMPLETE_THIS_CONTENT':'NEXT_GOOD_CONTENT');assert.equal(assessment.productionOverride.imagePrompts.length,0);}
  const row={sheetId,contentId:content.contentId,title:content.title,contentType:content.contentType,duplicateStatus,content,assessment};rows.push(row);
  details.push({sheetId,id:content.contentId,type:content.contentType,duplicateStatus,recommendation:assessment.recommendation,quality:assessment.score,sourceQuality:assessment.preparation.history[0].score,iterations:assessment.preparation.iterations,autoFixed:assessment.repair.autoFixed.length,reason:assessment.skipReason,issues:assessment.blockers,source:content.contentBody,production:assessment.content.contentBody,caption:assessment.content.caption,what:assessment.proposal.what,why:assessment.proposal.why,action:assessment.proposal.action,saveValue:assessment.proposal.saveValue,images:assessment.manifest.entries.length});
 }
 assert.equal(JSON.stringify(raw),before);sources.push({sheetId,count:raw.length,rawHash:createHash('sha256').update(before).digest('hex')});
}
let skipped=0;for(const row of rows){if(!row.assessment.ready){const next=findNextProductionReadyContent(rows,{excludeKeys:[`${row.sheetId}:${row.contentId}`]});assert.ok(next,'Every rejected item must have a screened next candidate');skipped++;}}
const batch=createProductionBatch(rows,20),resolved=resolveProductionBatch(batch,rows);assert.equal(batch.posts.length,20);assert.equal(batch.reserve.length,10);assert.ok(batch.posts.every(p=>p.productionContent?.completion?.continuation==='GENERATE_IMAGES'));assert.ok(resolved.posts.every(p=>p.valid));
const draft100=rows.find(r=>r.sheetId===812541719);const adapterProbe=buildProductionContent(draft100.content);assert.equal(adapterProbe.ready,true);
const sampleIds=['EN-NEW-003','EN-NEW-009','EN-NEW-125','EN-NEW-136','GS-V4-EXP-002','GS-V4-SG-002','GS-V4-EXP-038','GS-V4-EXP-047','GS-V4-EXP-016','GS-V4-EXP-054'];
const samples=[...details.filter(d=>sampleIds.includes(d.id)),...sources.map(s=>details.find(d=>d.sheetId===s.sheetId&&d.duplicateStatus==='HOLD_DUPLICATE')).filter(Boolean)];
assert.ok(sources.every(s=>samples.some(d=>d.sheetId===s.sheetId)));assert.ok(samples.some(s=>s.reason==='CRITICAL_INFO_MISSING'));assert.ok(samples.some(s=>s.recommendation==='PRODUCE'&&s.autoFixed));assert.ok(samples.some(s=>s.duplicateStatus==='HOLD_DUPLICATE'));
const summary={mode:'REAL_SHEET_RECORDS_READ_ONLY; heuristic quality is not human approval',sources,total:rows.length,produce:rows.filter(r=>r.assessment.ready).length,notYetReady:skipped,needsCompletion:rows.filter(r=>r.assessment.recommendation==='IMPROVE').length,skip:rows.filter(r=>r.assessment.recommendation==='SKIP').length,deadEnds:0,maxIterations:MAX_IMPROVEMENT_PASSES,samples: samples.map(({source,production,caption,what,why,action,saveValue,...s})=>s),batch:{posts:20,images:resolved.totalImages,reserve:10,preparedObjects:20,types:batch.posts.map(p=>p.contentType),ids:batch.posts.map(p=>p.contentId)},legacyDraft100Probe:{id:draft100.contentId,ready:adapterProbe.ready,images:adapterProbe.manifest.entries.length,productionAdmission:'Still held when duplicate status applies'},passed:true};
await mkdir(directory,{recursive:true});await writeFile(`${directory}/release-report.json`,JSON.stringify(summary,null,2));await writeFile(`${directory}/production-content-samples.json`,JSON.stringify(samples,null,2));await writeFile(`${directory}/prepared-batch-01.json`,JSON.stringify(batch,null,2));await writeFile(`${directory}/assessments.json`,JSON.stringify(details,null,2));console.log(JSON.stringify(summary));
