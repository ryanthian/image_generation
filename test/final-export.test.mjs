import test from 'node:test';
import assert from 'node:assert/strict';
import {collectFinalImages,finalImageFiles,canShareFinalFiles,shareFinalFiles,saveFinalFilesToFolder} from '../src/final-export.mjs';
import {assetSemanticKey,createZip} from '../src/production-core.mjs';
import {buildAssetSourceRevision} from '../src/content-model.mjs';
function fixture(){
 const plan=['COVER','INGREDIENTS','METHOD','METHOD','FINAL'].map((type,i)=>({asset_id:`a${i}`,sequence:i+1,asset_type:type,title:type,generation_inputs:[{slot_id:`s${i}`}]}));
 const images=Object.fromEntries(plan.map((p,i)=>[`s${i}`,{revision:`r${i}`}]));
 const assets=Object.fromEntries([...plan].reverse().map((p,i)=>[p.asset_id,{blob:new Blob([`final-${i}`],{type:'image/png'}),width:1440,height:1800,qc_status:'PASS',semanticKey:assetSemanticKey(p),sourceRevision:buildAssetSourceRevision(p,images)}]));
 return {content:{contentId:'QA'},plan:[...plan].reverse(),assets,images,exportReady:true};
}
test('final collection uses manifest sequence, deterministic names and original final blobs',async()=>{
 const f=fixture(),entries=collectFinalImages(f);assert.deepEqual(entries.map(e=>e.filename),['01_COVER.png','02_INGREDIENTS.png','03_METHOD.png','04_METHOD.png','05_FINAL.png']);
 for(const e of entries){assert.equal(e.blob,f.assets[e.assetId].blob);assert.equal(e.width,1440);assert.equal(e.height,1800);}
 const files=finalImageFiles(entries);assert.deepEqual(files.map(f=>f.name),entries.map(e=>e.filename));for(let i=0;i<files.length;i++)assert.deepEqual(await files[i].arrayBuffer(),await entries[i].blob.arrayBuffer());
});
test('all continuation pages are preserved in final carousel order',()=>{
 const f=fixture();f.assets.a2.pages=[{blob:f.assets.a2.blob},{blob:new Blob(['continuation'],{type:'image/png'})}];assert.deepEqual(collectFinalImages(f).map(e=>e.filename),['01_COVER.png','02_INGREDIENTS.png','03_METHOD.png','04_METHOD.png','05_METHOD.png','06_FINAL.png']);
});
for(const [name,modify] of Object.entries({unreviewed:f=>f.exportReady=false,stale:f=>f.assets.a1.stale=true,changedSource:f=>f.images.s1.revision='changed',changedPlan:f=>f.plan[0].title='changed',qcFailed:f=>f.assets.a1.qc_status='FAIL',missingFinal:f=>delete f.assets.a1,rawDimensions:f=>f.assets.a1.width=1024,wrongFormat:f=>f.assets.a1.blob=new Blob(['raw'],{type:'image/jpeg'}),emptyPng:f=>f.assets.a1.blob=new Blob([],{type:'image/png'}),duplicateSequence:f=>f.plan[0].sequence=f.plan[1].sequence,duplicateAsset:f=>f.plan[0].asset_id=f.plan[1].asset_id}))test(`final collection fails closed: ${name}`,()=>{const f=fixture();modify(f);assert.throws(()=>collectFinalImages(f));});
test('multi-file capability checks real File payload; share existence alone is insufficient',()=>{
 const files=finalImageFiles(collectFinalImages(fixture()));let payload;assert.equal(canShareFinalFiles(files,{share(){},canShare(p){payload=p;return true;}}),true);assert.deepEqual(payload,{files});
 for(const n of [{share(){}},{share(){},canShare:()=>false},{share(){},canShare(){throw Error('unsupported');}},{canShare:()=>true}])assert.equal(canShareFinalFiles(files,n),false);assert.equal(canShareFinalFiles([],{share(){},canShare:()=>true}),false);
});
test('share invokes native method synchronously with files only and no publication side effects',async()=>{
 const files=finalImageFiles(collectFinalImages(fixture()));let calls=0,payload;const result=shareFinalFiles(files,{canShare:()=>true,share(p){calls++;payload=p;return Promise.resolve();}});assert.equal(calls,1);assert.deepEqual(Object.keys(payload),['files']);assert.equal(payload.files,files);assert.equal((await result).status,'SHARED');
});
test('unsupported share, user cancellation, synchronous errors and rejection return normal fallback states',async()=>{
 const files=finalImageFiles(collectFinalImages(fixture()));assert.equal((await shareFinalFiles(files,{share(){throw Error('must not call');},canShare:()=>false})).status,'UNAVAILABLE');
 for(const sync of [false,true])for(const name of ['AbortError','NotAllowedError','DataError']){const error=Object.assign(Error(name),{name});const r=await shareFinalFiles(files,{canShare:()=>true,share(){if(sync)throw error;return Promise.reject(error);}});assert.equal(r.status,name==='AbortError'?'CANCELLED':'UNAVAILABLE');}
});
function folderMock(log){return {async getDirectoryHandle(name,options){log.push(['folder',name,options]);return this;},async getFileHandle(name){return {async createWritable(){return {async write(file){log.push(['write',name,file]);},async close(){},async abort(){log.push(['abort',name]);}};}};}};}
test('Download All opens picker synchronously and writes exact ordered PNG Files to a post folder',async()=>{
 const files=finalImageFiles(collectFinalImages(fixture())),log=[];let invoked=false;const result=saveFinalFilesToFolder(files,{showDirectoryPicker(options){invoked=true;assert.deepEqual(options,{mode:'readwrite'});return Promise.resolve(folderMock(log));},folderName:'QA POST'});assert.equal(invoked,true);assert.deepEqual(await result,{status:'SAVED',count:5});assert.deepEqual(log.filter(v=>v[0]==='write').map(v=>v[1]),files.map(f=>f.name));assert.equal(log[1][2],files[0]);
});
test('folder cancellation, unavailable picker and save error expose fallback without losing assets',async()=>{
 const files=finalImageFiles(collectFinalImages(fixture()));for(const name of ['AbortError','SecurityError'])assert.equal((await saveFinalFilesToFolder(files,{showDirectoryPicker(){throw Object.assign(Error(),{name});}})).status,name==='AbortError'?'CANCELLED':'UNAVAILABLE');assert.equal((await saveFinalFilesToFolder(files,{showDirectoryPicker:null})).status,'UNAVAILABLE');const log=[],folder=folderMock(log);folder.getFileHandle=async()=>{throw Error('disk');};assert.equal((await saveFinalFilesToFolder(files,{showDirectoryPicker:()=>folder})).status,'UNAVAILABLE');assert.equal(files.length,5);
});
test('pending picker rechecks freshness before saving any files',async()=>{
 let resolvePicker,current=true;const log=[],files=finalImageFiles(collectFinalImages(fixture()));const result=saveFinalFilesToFolder(files,{showDirectoryPicker:()=>new Promise(resolve=>resolvePicker=resolve),isCurrent:()=>current});current=false;resolvePicker(folderMock(log));assert.deepEqual(await result,{status:'STALE'});assert.deepEqual(log,[]);
});
test('source change between individual folder writes stops remaining files',async()=>{
 const log=[],files=finalImageFiles(collectFinalImages(fixture()));assert.equal((await saveFinalFilesToFolder(files,{showDirectoryPicker:()=>folderMock(log),isCurrent:()=>log.filter(v=>v[0]==='write').length<1})).status,'STALE');assert.equal(log.length,1);
});
test('direct PNG collection preserves ZIP STORE output and ordered image bytes',async()=>{
 const entries=collectFinalImages(fixture()),files=entries.map(e=>({name:e.filename,blob:e.blob})),bytes=new Uint8Array(await(await createZip(files)).arrayBuffer()),view=new DataView(bytes.buffer);let offset=0;for(const f of files){assert.equal(view.getUint32(offset,true),0x04034b50);assert.equal(view.getUint16(offset+8,true),0);const size=view.getUint32(offset+18,true),length=view.getUint16(offset+26,true);assert.equal(new TextDecoder().decode(bytes.slice(offset+30,offset+30+length)),f.name);assert.deepEqual(bytes.slice(offset+30+length,offset+30+length+size),new Uint8Array(await f.blob.arrayBuffer()));offset+=30+length+size;}
});

test('legacy closeup final output is named FINAL without modifying the underlying manifest',()=>{const f=fixture(),p=f.plan[0];p.asset_type='CLOSEUP';f.assets[p.asset_id].semanticKey=assetSemanticKey(p);assert.equal(collectFinalImages(f).at(-1).filename,'05_FINAL.png');assert.equal(p.asset_type,'CLOSEUP');});
