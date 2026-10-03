import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {normalizeContentRecord,runEditorialReview,deriveGenerationReadiness,runContentQc} from '../src/content-model.mjs';
import {applyEditorialWork,buildCanonicalMap,classifyClaimRisk,sourceFingerprint,recordKey} from '../src/editorial-pipeline.mjs';
import {MemoryProductionStore,handleProductionOperationsApi} from '../src/production-operations.mjs';

const canary=JSON.parse(await readFile(new URL('../data/content-v4-canary.json',import.meta.url),'utf8'));
const selection=normalizeContentRecord(canary.records.find(row=>row.Content_ID==='V4-SG-002'));

test('risk tiers permit internal review for ordinary cooking while storage needs evidence',()=>{
  assert.equal(classifyClaimRisk({title:'家常炒饭',contentType:'RECIPE',contentBody:'先炒饭再加入鸡蛋',caption:'家常炒饭'}).tier,'LOW');
  assert.equal(classifyClaimRisk({title:'冷藏三天安全吗',contentType:'STORAGE_GUIDE',contentBody:'冷藏3天',caption:'冷藏3天'}).tier,'MEDIUM');
  assert.equal(classifyClaimRisk({title:'治愈糖尿病',contentType:'KITCHEN_KNOWLEDGE',contentBody:'治愈疾病',caption:'治疗'}).tier,'HIGH');
});

test('editorial override applies only to approved, source-current reviews',async()=>{
  const hash=await sourceFingerprint(selection.raw),original=selection.title;
  const saved={status:'PASS',review:{decision:'APPROVED',sourceFingerprint:hash,proposal:{title:'人审标题',hook:'人审 Hook',body:selection.contentBody,caption:selection.caption},editorial:{review_status:'PASS'}}};
  assert.equal(applyEditorialWork(selection,saved,hash).content.title,'人审标题');
  assert.equal(selection.title,original);
  assert.equal(applyEditorialWork(selection,saved,'changed').content,selection);
  assert.equal(applyEditorialWork(selection,{...saved,review:{...saved.review,decision:'NEEDS_CHANGES'}},hash).content,selection);
  assert.equal(await sourceFingerprint({...selection.raw,Status:'Posted'}),hash,'A posting status write does not invalidate editorial copy.');
});

test('canonical grouping holds only strongly matched copies',()=>{
  const rows=[{sheetId:1,source:'A',contentId:'A1',score:70,bodyLength:100,captionLength:50},{sheetId:2,source:'B',contentId:'B1',score:80,bodyLength:150,captionLength:80},{sheetId:1,source:'A',contentId:'A2',score:80,bodyLength:150,captionLength:80}];
  const pair=(left,right,kinds)=>({left:{source:left.source,contentId:left.contentId},right:{source:right.source,contentId:right.contentId},kinds});
  const map=buildCanonicalMap(rows,[pair(rows[0],rows[1],['recipe']),pair(rows[1],rows[2],['near-title'])]);
  assert.equal(map.groups.length,1);assert.equal(map.assignments[recordKey(1,'A1')].status,'HOLD_DUPLICATE');assert.equal(map.assignments[recordKey(2,'B1')].status,'CANONICAL');assert.equal(map.reviewPairs.length,1);
});

test('D1 editorial work saves with readback and leaves the Sheet source unchanged',async()=>{
  const store=new MemoryProductionStore(),raw=structuredClone(selection.raw),original=JSON.stringify(raw);
  const context={validateContentRef:async()=>({ok:true,content:{...selection,raw}})};
  const body={sheetId:433728120,contentId:selection.contentId,sourceFingerprint:await sourceFingerprint(raw),decision:'NEEDS_CHANGES',reviewer:'Test reviewer',proposal:{title:'Revised draft',hook:selection.hookText,body:selection.contentBody,caption:selection.caption},changes:['Draft only']};
  const request=new Request('https://console.example/api/production/editorial-work',{method:'POST',headers:{'content-type':'application/json','x-content-intelligence-request':'1','sec-fetch-site':'same-origin'},body:JSON.stringify(body)});
  const response=await handleProductionOperationsApi(request,{},new URL(request.url),store,context),data=await response.json();
  assert.equal(response.status,201);assert.equal(data.item.review.decision,'NEEDS_CHANGES');assert.equal((await store.getReview(433728120,selection.contentId)).review.proposal.title,'Revised draft');assert.equal(JSON.stringify(raw),original);
  const changed={...raw,Content_Body:`${raw.Content_Body} Changed.`};
  const conflictRequest=new Request(request.url,{method:'POST',headers:request.headers,body:JSON.stringify(body)});
  const conflict=await handleProductionOperationsApi(conflictRequest,{},new URL(request.url),store,{validateContentRef:async()=>({ok:true,content:{...selection,raw:changed}})});
  assert.equal(conflict.status,409);
  const duplicateRequest=new Request(request.url,{method:'POST',headers:request.headers,body:JSON.stringify({...body,decision:'APPROVED'})});
  const duplicate=await handleProductionOperationsApi(duplicateRequest,{},new URL(request.url),store,{...context,isHeldDuplicate:()=>true});
  assert.equal(duplicate.status,422);
  const unresolvedRequest=new Request(request.url,{method:'POST',headers:request.headers,body:JSON.stringify({...body,decision:'APPROVED',questions:['Unsupported reason']})});
  const unresolved=await handleProductionOperationsApi(unresolvedRequest,{},new URL(request.url),store,context);
  assert.equal(unresolved.status,422);
});

test('legacy adapter can reach generation-ready with explicit fixture review, without changing raw',async()=>{
  const data=JSON.parse(await readFile(new URL('../data/recipes.json',import.meta.url),'utf8'));const raw=structuredClone(data.recipes[0]);
  const source=normalizeContentRecord(raw),before=JSON.stringify(raw);
  const review={...source.editorialReview,review_status:'PASS',reviewer:'Fixture only',reviewed_at:'2026-10-03T00:00:00.000Z',audience_need:'家庭晚餐需要容易复现的主食做法',reader_value:'清楚的材料和分步做法',evidence_type:'SOURCE_INTERNAL',evidence:{type:'SOURCE_INTERNAL',references:[]},source_evidence_status:'INTERNAL_REVIEWED',internal_consistency_checked:true,caption_review_status:'PASS',reader_facing_copy_reviewed:true,internal_note_leakage:false,claim_safety_ok:true};
  const resolved={...source,editorialReview:review,editorialReviewPresent:true};
  assert.equal(runContentQc(source).failures.length,0);assert.equal(runEditorialReview(resolved).status,'PASS');assert.equal(deriveGenerationReadiness(resolved).ready,true);assert.equal(JSON.stringify(raw),before);
});
