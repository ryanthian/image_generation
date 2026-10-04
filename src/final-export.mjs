/** One-post final PNG export. No source images, rendering, network or publication writes. */
import {assetSemanticKey,exportEntries,safeFilename} from './production-core.mjs';
import {isStoredAssetStale} from './content-model.mjs';
export function collectFinalImages({content,plan,assets,images={},exportReady=false}){
 if(!exportReady||!content||!plan?.length)throw Error('Build current final assets and choose Looks Good before export.');
 const ordered=[...plan].sort((a,b)=>a.sequence-b.sequence),sequences=new Set(),ids=new Set();
 for(const item of ordered){
  if(!Number.isInteger(item.sequence)||item.sequence<1||sequences.has(item.sequence)||!item.asset_id||ids.has(item.asset_id))throw Error('Final asset order is invalid. Rebuild required.');
  sequences.add(item.sequence);ids.add(item.asset_id);
  const value=assets[item.asset_id];
  if(!value||value.qc_status!=='PASS'||value.semanticKey!==assetSemanticKey(item)||isStoredAssetStale(item,value,images))throw Error('Rebuild required: final assets must be current.');
  if(value.width!==1440||value.height!==1800)throw Error('Rebuild required: use final 1440 × 1800 PNG assets.');
 }
 return exportEntries(content,ordered,assets).map(entry=>{
  if(!(entry.blob instanceof Blob)||entry.blob.type!=='image/png'||!entry.blob.size)throw Error('Rebuild required: a final PNG is unavailable.');
  const item=ordered.find(a=>a.asset_id===entry.assetId);
  const type=item.asset_type==='CLOSEUP'?'FINAL':item.asset_type;
  return {...entry,filename:`${String(entry.sequence).padStart(2,'0')}_${safeFilename(type).toUpperCase()}.png`,label:`${String(entry.sequence).padStart(2,'0')} ${item.title||type}`};
 });
}
export function finalImageFiles(entries,FileType=globalThis.File){
 if(typeof FileType!=='function')return [];
 return entries.map(e=>new FileType([e.blob],e.filename,{type:'image/png',lastModified:0}));
}
export function canShareFinalFiles(files,navigatorApi=globalThis.navigator){
 if(!files.length||typeof navigatorApi?.share!=='function'||typeof navigatorApi?.canShare!=='function')return false;
 try{return navigatorApi.canShare({files})===true;}catch{return false;}
}
/** share() is called synchronously from this function, before awaiting its result. Invoke from a click. */
export function shareFinalFiles(files,navigatorApi=globalThis.navigator){
 if(!canShareFinalFiles(files,navigatorApi))return Promise.resolve({status:'UNAVAILABLE'});
 try{return Promise.resolve(navigatorApi.share({files})).then(()=>({status:'SHARED'}),error=>({status:error?.name==='AbortError'?'CANCELLED':'UNAVAILABLE'}));}
 catch(error){return Promise.resolve({status:error?.name==='AbortError'?'CANCELLED':'UNAVAILABLE'});}
}
/** A native folder picker avoids unreliable multiple automatic downloads. Invoke from a click. */
export async function saveFinalFilesToFolder(files,{showDirectoryPicker=globalThis.showDirectoryPicker,isCurrent=()=>true,folderName}={}){
 if(typeof showDirectoryPicker!=='function')return {status:'UNAVAILABLE'};
 try{
  // This native picker call happens before the first await, preserving activation.
  const root=await showDirectoryPicker({mode:'readwrite'}),directory=folderName?await root.getDirectoryHandle(safeFilename(folderName),{create:true}):root;
  for(const file of files){if(!isCurrent())return {status:'STALE'};const handle=await directory.getFileHandle(file.name,{create:true}),stream=await handle.createWritable();try{if(!isCurrent()){await stream.abort();return {status:'STALE'};}await stream.write(file);await stream.close();}catch(error){await stream.abort().catch(()=>{});throw error;}}
  return {status:'SAVED',count:files.length};
 }catch(error){return {status:error?.name==='AbortError'?'CANCELLED':'UNAVAILABLE'};}
}
