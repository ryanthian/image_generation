/** Browser/Node deterministic production safety primitives. No credentials or network. */
export const RENDER_VERSION = '2026-10-03.2';
export const IMAGE_LIMIT = 35 * 1024 * 1024;
export const BATCH_LIMIT = 160 * 1024 * 1024;
export function safeFilename(value, fallback = 'content') {
  const cleaned = String(value ?? '').normalize('NFC').replace(/[\x00-\x1f\x7f<>:"/\\|?*]/g, '-').replace(/[. ]+$/g, '').trim().slice(0, 100);
  return !cleaned ? fallback : /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(cleaned) ? `_${cleaned}` : cleaned;
}
export function sourceLabel(source) {
  const count = Number.isInteger(source.rowCount) ? `${source.rowCount} records` : 'count pending load';
  const kind = source.source === 'approved-opportunities' ? 'Local handoff' : source.source === 'local-preview' || source.source === 'snapshot' ? 'Snapshot' : 'Google Sheet';
  const write = source.writable === true ? 'writable' : source.writable === false ? 'read-only' : 'write access pending load';
  return `${source.title || source.name} · ${count} · ${kind} · ${write}`;
}
export function imageQc({type, size, width, height}) {
  const errors = [], warnings = [];
  if (!/^image\/(png|jpeg|webp)$/.test(type || '')) errors.push('Use PNG, JPEG or WebP.');
  if (!size || size > IMAGE_LIMIT) errors.push('Image must be non-empty and at most 35 MB.');
  if (!Number.isFinite(width) || !Number.isFinite(height) || Math.min(width, height) < 128) errors.push('Image could not decode or is smaller than 128 pixels.');
  if (width * height > 60_000_000) errors.push('Image exceeds the 60 megapixel decode limit.');
  const ratio = width / height;
  const cropFraction = 1 - Math.min(ratio / .8, .8 / ratio);
  if (width < 1440 || height < 1800) warnings.push('Upscaling to 1440 × 1800 may look soft; inspect the final preview.');
  if (cropFraction > .03) warnings.push(`${Math.round(cropFraction * 100)}% centre crop; keep the subject within the visible safe area.`);
  if (cropFraction > .45) warnings.push('Significant crop: verify that no essential subject is lost.');
  return {status: errors.length ? 'FAIL' : 'PASS', errors, warnings, width, height, aspectRatio: ratio, cropFraction, orientation: width === height ? 'Square' : width < height ? 'Portrait' : 'Landscape'};
}
export async function verifyImageSignature(blob) {
  const bytes=new Uint8Array(await blob.slice(0,12).arrayBuffer());
  const png=bytes.length>=8 && [137,80,78,71,13,10,26,10].every((n,i)=>bytes[i]===n);
  const jpeg=bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
  const webp=String.fromCharCode(...bytes.slice(0,4))==='RIFF'&&String.fromCharCode(...bytes.slice(8,12))==='WEBP';
  return (blob.type==='image/png'&&png)||(blob.type==='image/jpeg'&&jpeg)||(blob.type==='image/webp'&&webp);
}
export async function hashBlob(blob) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())), x => x.toString(16).padStart(2, '0')).join('');
}
export function assetSemanticKey(item) {
  return JSON.stringify({renderer: RENDER_VERSION, ...item});
}
export function sessionSignature(content, manifest, images, assets) {
  return JSON.stringify({contentId:content.contentId, body:content.contentBody, caption:content.caption, profile:content.pageProfile, plan:content.resolvedAssetPlan, images:manifest.entries.map(e=>[e.slotId,e.semanticKey,images[e.slotId]?.revision || images[e.slotId]?.updatedAt]), assets:Object.entries(assets).map(([id,a])=>[id,a.semanticKey,a.sourceRevision,a.updatedAt,a.stale])});
}
export function planImports(files, manifest, matcher) {
  const candidates = files.map(file => ({file, slotId:matcher(file.name, manifest)}));
  const counts = new Map();
  for (const c of candidates) if (c.slotId) counts.set(c.slotId, (counts.get(c.slotId)||0)+1);
  return {
    matched:candidates.filter(c=>c.slotId && counts.get(c.slotId)===1),
    unmatched:candidates.filter(c=>!c.slotId || counts.get(c.slotId)>1).map(c=>({...c,reason:c.slotId?'Multiple files target this slot; choose the intended image.':'No unambiguous slot name. Choose a destination explicitly.'}))
  };
}
export function wrapText(text, width, measure) {
  const lines=[];
  for(const paragraph of String(text || '').split('\n')) {
    let line='';
    for(const char of Array.from(paragraph)) {
      if(line && measure(line+char)>width){lines.push(line.trimEnd());line=char.trimStart();}else line+=char;
    }
    lines.push(line.trimEnd());
  }
  return lines;
}
export function fitText(text, {width,height,maxSize=58,minSize=30,lineRatio=1.4,measure}) {
  for(let size=maxSize;size>=minSize;size-=2){const lines=wrapText(text,width,t=>measure(t,size));const lineHeight=size*lineRatio;if(lines.length*lineHeight<=height)return {size,lineHeight,lines,overflow:[]};}
  const lines=wrapText(text,width,t=>measure(t,minSize));const lineHeight=minSize*lineRatio;const capacity=Math.max(1,Math.floor(height/lineHeight));
  return {size:minSize,lineHeight,lines:lines.slice(0,capacity),overflow:lines.slice(capacity)};
}
export function productionGates({contract,editorial,generation,manifest,images,plan,assets,visualReviewed,monetization,productionDecision}) {
  const required=manifest.entries.filter(e=>e.required);
  const sourceImagesComplete=required.length>0 && required.every(e=>images[e.slotId] && images[e.slotId].semanticKey===e.semanticKey);
  const technicalImageQc=sourceImagesComplete && required.every(e=>images[e.slotId]?.qc?.status==='PASS');
  const finalAssetsBuilt=plan.length>0 && plan.every(a=>assets[a.asset_id]?.qc_status==='PASS' && !assets[a.asset_id].stale);
  const exportReady=contract.failures.length===0 && (productionDecision ? productionDecision.ready && productionDecision.recommendation==='PRODUCE' : editorial.status==='PASS') && generation.ready && technicalImageQc && finalAssetsBuilt && visualReviewed;
  return {contractValid:contract.failures.length===0,editorialReview:editorial.status,generationReady:generation.ready,sourceImagesComplete,technicalImageQc,visualReview:visualReviewed,finalAssetsBuilt,exportReady};
}
export function exportEntries(content, plan, assets) {
  let sequence=0;
  return plan.flatMap(item=>{const stored=assets[item.asset_id];if(!stored || stored.stale)throw Error('All final assets must be current before export.');return (stored.pages?.length?stored.pages:[stored]).map((page,index)=>({blob:page.blob,assetId:item.asset_id,sequence:++sequence,filename:`${String(sequence).padStart(2,'0')}_${safeFilename(item.asset_type)}${index?`_${index+1}`:''}.png`,width:1440,height:1800}));});
}
const crcTable=Uint32Array.from({length:256},(_,n)=>{for(let k=0;k<8;k++)n=(n&1)?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
async function crc32(blob){let crc=0xffffffff;const reader=blob.stream().getReader();try{for(;;){const {done,value}=await reader.read();if(done)break;for(const b of value)crc=crcTable[(crc^b)&255]^(crc>>>8);}}finally{reader.releaseLock();}return (crc^0xffffffff)>>>0;}
/** ZIP STORE: PNG is already compressed. Blob parts avoid copying all image buffers. */
export async function createZip(files) {
  if(files.length>1000)throw Error('Too many ZIP entries.');
  const chunks=[],directory=[];let offset=0,dirSize=0;const names=new Set();
  for(const {name,blob} of files){if(!name || /(^|\/)\.\.(\/|$)|^[/\\]|\\/.test(name) || names.has(name))throw Error('Unsafe or duplicate ZIP path.');names.add(name);if(!(blob instanceof Blob))throw Error('ZIP entry must be a Blob.');
    const nameBytes=new TextEncoder().encode(name),crc=await crc32(blob);
    const header=new Uint8Array(30+nameBytes.length),v=new DataView(header.buffer);v.setUint32(0,0x04034b50,true);v.setUint16(4,20,true);v.setUint16(6,0x800,true);v.setUint16(12,33,true);v.setUint32(14,crc,true);v.setUint32(18,blob.size,true);v.setUint32(22,blob.size,true);v.setUint16(26,nameBytes.length,true);header.set(nameBytes,30);
    const central=new Uint8Array(46+nameBytes.length),d=new DataView(central.buffer);d.setUint32(0,0x02014b50,true);d.setUint16(4,20,true);d.setUint16(6,20,true);d.setUint16(8,0x800,true);d.setUint16(14,33,true);d.setUint32(16,crc,true);d.setUint32(20,blob.size,true);d.setUint32(24,blob.size,true);d.setUint16(28,nameBytes.length,true);d.setUint32(42,offset,true);central.set(nameBytes,46);
    chunks.push(header,blob);directory.push(central);offset+=header.length+blob.size;dirSize+=central.length;
    if(offset+dirSize>0xffffffff)throw Error('Package exceeds the ZIP size limit.');
  }
  const end=new Uint8Array(22),v=new DataView(end.buffer);v.setUint32(0,0x06054b50,true);v.setUint16(8,files.length,true);v.setUint16(10,files.length,true);v.setUint32(12,dirSize,true);v.setUint32(16,offset,true);
  return new Blob([...chunks,...directory,end],{type:'application/zip'});
}
