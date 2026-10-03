import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {normalizeContentRecord,normalizeContentRecordsSafely,buildGenerationManifest,matchGenerationSlot,buildAssetSourceRevision,isStoredAssetStale,buildSessionPrompt,buildSlotPrompt,deriveGenerationReadiness} from '../src/content-model.mjs';
import {imageQc,verifyImageSignature,planImports,fitText,wrapText,safeFilename,sourceLabel,createZip,exportEntries,productionGates,assetSemanticKey,sessionSignature} from '../src/production-core.mjs';
import {auditContent,findDuplicates} from '../src/content-quality.mjs';
const legacy=JSON.parse(await readFile(new URL('../data/recipes.json',import.meta.url))).recipes[0];
const v4=JSON.parse(await readFile(new URL('../data/content-v4-canary.json',import.meta.url))).records;
const content=normalizeContentRecord(legacy),manifest=buildGenerationManifest(content);
test('random-order imports use unique slot identifiers, never upload order',()=>{
 const files=manifest.entries.map(e=>({name:e.expectedFilename})).reverse();const plan=planImports(files,manifest,matchGenerationSlot);
 assert.equal(plan.unmatched.length,0);assert.deepEqual(plan.matched.map(i=>i.slotId),manifest.entries.map(e=>e.slotId).reverse());
 const unknown=planImports([{name:'ChatGPT Image Oct 3 2026.png'},{name:'03_COVER.png'},{name:'m10.png'}],manifest,matchGenerationSlot);assert.equal(unknown.matched.length,0);
 const collision=planImports([{name:'01_COVER.png'},{name:'cover.png'}],manifest,matchGenerationSlot);assert.equal(collision.matched.length,0);assert.equal(collision.unmatched.length,2);
});
test('source-image revisions invalidate every consuming composition including same-millisecond replacement',()=>{
 const a={generation_inputs:[{slot_id:'cover'}],source_input_ids:['m1']};const images={cover:{updatedAt:1,revision:'a'},m1:{updatedAt:1,revision:'b'}};
 const stored={sourceRevision:buildAssetSourceRevision(a,images),updatedAt:2};assert.equal(isStoredAssetStale(a,stored,images),false);
 images.m1.revision='c';assert.equal(isStoredAssetStale(a,stored,images),true);delete images.m1;assert.equal(isStoredAssetStale(a,stored,images),true);
 assert.equal(isStoredAssetStale(a,{...stored,stale:true},images),true);
});
test('source body, prompts, layout and headings invalidate signatures',()=>{
 const updated=normalizeContentRecord({...legacy,Full_Recipe:legacy.Full_Recipe+'\nSource correction'});assert.notEqual(buildGenerationManifest(updated).entries[0].semanticKey,manifest.entries[0].semanticKey);
 const a=content.resolvedAssetPlan[0];assert.notEqual(assetSemanticKey(a),assetSemanticKey({...a,local_heading:'Different'}));
 assert.notEqual(sessionSignature(content,manifest,{},{}),sessionSignature({...content,caption:'Different'},manifest,{},{}));
});
test('invalid and duplicate rows are isolated without losing valid siblings',()=>{
 const raw=[legacy,null,{...v4[0],Content_ID:'BAD',assets:undefined,Asset_Plan_JSON:'{'},{...legacy,Content_ID:'DUPE'},{...legacy,Content_ID:'DUPE'}];const result=normalizeContentRecordsSafely(raw);assert.equal(result.records.length,1);assert.equal(result.rejected.length,4);assert.ok(result.rejected.every(r=>r.field&&r.suggestedRepair&&r.rowNumber));
});
test('technical image QC tolerates usable portrait crops and warns on softness',()=>{
 const q=imageQc({type:'image/png',size:50000,width:1024,height:1536});assert.equal(q.status,'PASS');assert.ok(q.cropFraction>0);assert.ok(q.warnings.length>=2);
 for(const input of [{width:0,height:0},{width:20,height:20},{type:'image/svg+xml'},{size:36*1024*1024},{width:12000,height:12000}])assert.equal(imageQc({type:'image/png',size:50000,width:1440,height:1800,...input}).status,'FAIL');
});
test('Chinese text fitting preserves all characters across overflow pages',()=>{
 const text='加入姜葱后保持小火，观察汤汁浓度。'.repeat(200);const measure=(s,size)=>Array.from(s).length*size;
 let pending=text,reassembled='';let count=0;
 while(pending){const fit=fitText(pending,{width:1180,height:1000,maxSize:58,minSize:36,measure});assert.ok(fit.size>=36);assert.ok(fit.lines.every(l=>measure(l,fit.size)<=1180));assert.ok(fit.lines.length*fit.lineHeight<=1000);reassembled+=fit.lines.join('');pending=fit.overflow.join('\n');assert.ok(++count<50);}
 assert.equal(reassembled,text);assert.ok(count>1);
 assert.ok(wrapText('长中文句子混合 English 123 然后继续做法'.repeat(20),100,s=>s.length*10).every(l=>l.length<=10));
});
test('safe filenames and dynamic source counts do not invent a fourth Sheet',()=>{
 assert.equal(sourceLabel({title:'Draft 20',rowCount:120,source:'sheet',writable:true}),'Draft 20 · 120 records · Google Sheet · writable');assert.match(sourceLabel({title:'Ideas',source:'approved-opportunities',rowCount:0,writable:false}),/Local handoff · read-only/);
 assert.doesNotMatch(safeFilename('../a:b/食谱?. '),/[\\/:?]/);assert.equal(safeFilename('CON'),'_CON');
});
test('ZIP contains ordered final images, exact caption and parseable manifest with valid UTF-8 paths',async()=>{
 const assets=Object.fromEntries(content.resolvedAssetPlan.map(a=>[a.asset_id,{blob:new Blob(['PNG']),stale:false}]));const entries=exportEntries(content,content.resolvedAssetPlan,assets);assert.deepEqual(entries.map(e=>e.filename),['01_COVER.png','02_INGREDIENTS.png','03_METHOD.png','04_CLOSEUP.png']);
 const files=[...entries.map(e=>({name:'食谱/'+e.filename,blob:e.blob})),{name:'食谱/caption.txt',blob:new Blob(['原文\n配白饭'])},{name:'食谱/manifest.json',blob:new Blob([JSON.stringify({Content_ID:content.contentId})])}];
 const bytes=new Uint8Array(await (await createZip(files)).arrayBuffer()),view=new DataView(bytes.buffer),decoded=[];let pos=0;
 while(view.getUint32(pos,true)===0x04034b50){const size=view.getUint32(pos+18,true),n=view.getUint16(pos+26,true);assert.equal(view.getUint16(pos+6,true),0x800);const name=new TextDecoder().decode(bytes.slice(pos+30,pos+30+n));const value=new TextDecoder().decode(bytes.slice(pos+30+n,pos+30+n+size));decoded.push({name,value});pos+=30+n+size;}
 assert.deepEqual(decoded.map(e=>e.name),files.map(f=>f.name));assert.equal(decoded.at(-2).value,'原文\n配白饭');assert.equal(JSON.parse(decoded.at(-1).value).Content_ID,content.contentId);assert.equal(view.getUint32(pos,true),0x02014b50);
 assets.cover.stale=true;assert.throws(()=>exportEntries(content,content.resolvedAssetPlan,assets),/current/);await assert.rejects(createZip([{name:'../oops',blob:new Blob(['x'])}]),/Unsafe/);
});
test('export and publish preparation fail closed without technical or manual review',()=>{
 const args={contract:{failures:[]},editorial:{status:'PASS'},generation:{ready:true},manifest,images:Object.fromEntries(manifest.entries.map(e=>[e.slotId,{semanticKey:e.semanticKey,qc:{status:'PASS'}}])),plan:content.resolvedAssetPlan,assets:Object.fromEntries(content.resolvedAssetPlan.map(a=>[a.asset_id,{qc_status:'PASS',stale:false}])),visualReviewed:false,monetization:{status:'READY'}};
 assert.equal(productionGates(args).exportReady,false);args.visualReviewed=true;assert.equal(productionGates(args).exportReady,true);args.monetization.status='NEEDS IMPROVEMENT';assert.equal(productionGates(args).exportReady,false);args.monetization.status='READY';args.images.cover.qc.status='FAIL';assert.equal(productionGates(args).exportReady,false);args.images.cover.qc.status='PASS';args.assets.cover.stale=true;assert.equal(productionGates(args).exportReady,false);
});
test('prompts define portrait framing, source facts, safe crop, continuity, one-image controls and per-slot filenames',()=>{
 const prompt=buildSessionPrompt(content);for(const term of ['N =','R =','FIX:','4:5','safe area','CONTINUITY','no','SAVE AS','01_COVER.png'])assert.ok(prompt.toLowerCase().includes(term.toLowerCase()));assert.match(buildSlotPrompt(content,'m1'),/CURRENT SLOT ONLY/);
});
test('all repository source contracts resolve manifests and prompts including dynamic plans',()=>{
 const sizes=new Set();for(const raw of [legacy,...v4]){const c=normalizeContentRecord(raw);sizes.add(c.resolvedAssetPlan.length);assert.ok(buildGenerationManifest(c).entries.length);assert.ok(buildSessionPrompt(c).includes(c.contentId));}assert.deepEqual([...sizes].sort(),[3,4,5,6,7]);
});
test('heuristic quality and duplicate findings never impersonate measured performance or approval',()=>{
 const q=auditContent(content);assert.equal(Object.values(q.dimensions).reduce((s,d)=>s+d.max,0),100);assert.ok(q.score<=100);assert.equal(q.mode,'HEURISTIC_NOT_PERFORMANCE');assert.equal(q.guaranteesMonetisation,false);
 const pairs=findDuplicates([{source:'A',content},{source:'B',content:{...content,contentId:'copy'}}]);assert.equal(pairs.length,1);assert.ok(pairs[0].recommendations.some(r=>r.action==='HOLD'));
 const unreviewed={...content,editorialReview:{},editorialReviewPresent:false};assert.equal(deriveGenerationReadiness(unreviewed).ready,false);
});

test('SVG or spoofed image bytes cannot be imported under an allowed MIME type',async()=>{
 assert.equal(await verifyImageSignature(new Blob(['<svg xmlns="http://www.w3.org/2000/svg"/>'],{type:'image/png'})),false);
 assert.equal(await verifyImageSignature(new Blob([Uint8Array.from([137,80,78,71,13,10,26,10,0,0])],{type:'image/png'})),true);
});
